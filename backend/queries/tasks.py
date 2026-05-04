# queries/tasks.py
#
# Celery tasks for query execution — scheduled and pipeline.
#
# Task overview:
#   check_scheduled_tasks     — Beat heartbeat (every 1 min); finds due tasks and
#                               dispatches execute_scheduled_task for each
#   execute_scheduled_task    — runs a ScheduledTask; handles both APIC queries and
#                               system tasks (cleanup, snapshots, etc.)
#   execute_saved_query_sync  — blocking helper used by column validation at save time

import logging
import traceback
from typing import Any
from celery import shared_task
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from queries.models import ScheduledTask, ScheduledTaskExecution
from notifications.services import create_notification
from apic_connections.models import APICConnection
from apic_connections.apic_client import APICClient
from queries.services.postprocessor import PostProcessorEngine

logger = logging.getLogger(__name__)


def emit_status(execution_id: str, status: str) -> None:
    # Status-only event — no DB write needed here because mark_as_success/failed
    # already updated the row. This just pushes the final state to the WebSocket.
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f'execution_{execution_id}',
            {
                'type': 'execution_status',
                'status': status,
            }
        )


def apply_post_processors(data: Any, post_processor_nodes: list) -> Any:
    # Post-processor failures should never kill the whole query execution —
    # the raw APIC data is still useful even if a transformation step breaks.
    # We log the error and return the untransformed data as a safe fallback.
    try:
        return PostProcessorEngine.execute(data, post_processor_nodes)
    except Exception as e:
        logger.error("Post-processor execution failed: %s", e, exc_info=True)
        return data


def get_result_count(result: Any) -> int:
    # APIC responses can come back in two shapes:
    #   {"totalCount": "42", "imdata": [...]}  — standard APIC envelope
    #   [...]                                   — post-processed flat list
    # totalCount is a string in the APIC protocol, hence the int() cast.
    if isinstance(result, dict):
        if 'totalCount' in result:
            return int(result['totalCount'])
        if 'imdata' in result and isinstance(result['imdata'], list):
            return len(result['imdata'])

    if isinstance(result, list):
        return len(result)

    return 0


@shared_task(name='queries.check_scheduled_tasks')
def check_scheduled_tasks():
    """Heartbeat task — runs every minute via Celery Beat.

    Finds every active ScheduledTask whose next_run_at is in the past and
    dispatches an async execute_scheduled_task for each. Uses select_for_update
    inside transaction.atomic to prevent duplicate dispatches when the previous
    beat cycle is still running.
    """
    from django.db import transaction

    now = timezone.now()

    with transaction.atomic():
        due_tasks = list(
            ScheduledTask.objects.select_for_update(skip_locked=True).filter(
                status=ScheduledTask.STATUS_ACTIVE,
                next_run_at__lte=now,
                next_run_at__isnull=False
            )
        )

        for task in due_tasks:
            # Advance next_run_at before dispatching so the next beat cycle
            # won't pick up the same task while it's still running.
            task.next_run_at = task.calculate_next_run()
            task.save(update_fields=['next_run_at'])

    for task in due_tasks:
        execute_scheduled_task.delay(str(task.id))


def execute_system_task(task: ScheduledTask) -> dict:
    """Route a system task to its registered Celery handler by task path.

    System tasks (cleanup, snapshots, monitoring) don't run APIC queries —
    they call other Celery tasks that are already registered in the task registry.
    The handler name is stored as a dotted task path in task.system_task_handler
    (e.g. 'awx.cleanup_old_output_chunks').
    """
    from celery import current_app

    logger.info(f"[System Task] Executing: {task.name} (handler: {task.system_task_handler})")

    task.last_run_at = timezone.now()
    task.execution_count += 1
    task.next_run_at = task.calculate_next_run()
    task.save(update_fields=['last_run_at', 'execution_count', 'next_run_at'])

    handler = task.system_task_handler
    if not handler:
        logger.error(f"[System Task] No handler defined for task: {task.name}")
        task.failure_count += 1
        task.save(update_fields=['failure_count'])
        return {'status': 'error', 'message': 'No handler defined'}

    try:
        celery_task = current_app.tasks.get(handler)

        if not celery_task:
            logger.error(f"[System Task] Handler not found: {handler}")
            task.failure_count += 1
            task.save(update_fields=['failure_count'])
            return {'status': 'error', 'message': f'Handler not found: {handler}'}

        result = celery_task.delay()

        logger.info(f"[System Task] Launched: {task.name} (Celery task ID: {result.id})")

        task.success_count += 1
        task.save(update_fields=['success_count'])

        return {
            'status': 'success',
            'celery_task_id': result.id,
            'handler': handler,
        }

    except Exception as e:
        logger.exception(f"[System Task] Error executing {task.name}: {str(e)}")
        task.failure_count += 1
        task.save(update_fields=['failure_count'])

        return {
            'status': 'error',
            'message': str(e),
            'traceback': traceback.format_exc(),
        }


@shared_task(name='queries.execute_scheduled_task')
def execute_scheduled_task(task_id: str) -> None:
    """Execute a ScheduledTask — either an APIC query or a system task.

    For APIC queries: iterates over all configured connections and runs the
    query against each one. Time Machine snapshots are captured inline after
    each successful run if the query has enable_time_machine=True.

    For system tasks: delegates to execute_system_task() which looks up the
    Celery task by name and fires it asynchronously.

    One-time tasks (FREQ_ONCE) are auto-paused after execution so they don't
    run again on the next beat cycle.
    """
    try:
        task = ScheduledTask.objects.get(id=task_id)

        if task.status != ScheduledTask.STATUS_ACTIVE:
            return

        # System tasks skip the APIC logic entirely
        if task.is_system_task:
            return execute_system_task(task)

        saved_query = task.saved_query
        if not saved_query:
            return

        import json

        # generated_query can be a JSON string or already a dict depending
        # on when the query was last saved — handle both
        if isinstance(saved_query.generated_query, str):
            try:
                generated_query = json.loads(saved_query.generated_query)
            except Exception:
                # If it won't parse, assume it's a plain URL string
                generated_query = {'url': saved_query.generated_query}
        else:
            generated_query = saved_query.generated_query or {}

        query_data = {
            'flow_data': saved_query.flow_data,
            'generated_query': generated_query,
        }

        if saved_query.is_template and task.variable_values:
            query_data = apply_template_variables(query_data, task.variable_values)

        success_count = 0
        failure_count = 0

        for connection_id in task.apic_connection_ids:
            try:
                execution = ScheduledTaskExecution.objects.create(
                    scheduled_task=task,
                    apic_connection_id=connection_id,
                    status=ScheduledTaskExecution.STATUS_PENDING
                )

                try:
                    apic_connection = APICConnection.objects.get(id=connection_id)
                    # Cache the name on the execution row — survives connection rename/delete
                    execution.apic_connection_name = apic_connection.name
                    execution.save(update_fields=['apic_connection_name'])
                except APICConnection.DoesNotExist:
                    execution.status = ScheduledTaskExecution.STATUS_FAILED
                    execution.error_message = f'APIC connection {connection_id} not found'
                    execution.completed_at = timezone.now()
                    execution.save()
                    failure_count += 1
                    continue

                execution.status = ScheduledTaskExecution.STATUS_RUNNING
                execution.started_at = timezone.now()
                execution.save()

                apic_client = APICClient(
                    url=apic_connection.url,
                    username=apic_connection.username,
                    password=apic_connection.get_password(),
                    verify_ssl=apic_connection.verify_ssl,
                    timeout=apic_connection.timeout
                )

                login_success, login_error = apic_client.login()
                if not login_success:
                    execution.status = ScheduledTaskExecution.STATUS_FAILED
                    execution.error_message = f'Authentication failed: {login_error}'
                    execution.completed_at = timezone.now()
                    execution.save()
                    failure_count += 1
                    continue

                generated_query = query_data.get('generated_query', {})
                query_url = generated_query.get('url', '')
                query_params = generated_query.get('params', {})

                if query_params:
                    param_str = '&'.join([f"{k}={v}" for k, v in query_params.items()])
                    query_url = f"{query_url}?{param_str}" if '?' not in query_url else f"{query_url}&{param_str}"

                success, result, error = apic_client.execute_query(query_url)

                if not success:
                    execution.status = ScheduledTaskExecution.STATUS_FAILED
                    execution.error_message = f'Query execution failed: {error}'
                    execution.completed_at = timezone.now()
                    execution.save()
                    failure_count += 1

                    try:
                        from audit.services import AuditService
                        AuditService.log(
                            user=task.created_by,
                            action='query_executed',
                            category='query_execution',
                            resource_type='ScheduledTask',
                            resource_id=task.id,
                            resource_name=task.name,
                            description=f"Scheduled task '{task.name}' execution failed on connection '{apic_connection.name}': {error}",
                            metadata={
                                'scheduled_task_id': str(task.id),
                                'scheduled_task_name': task.name,
                                'execution_id': str(execution.id),
                                'apic_connection_id': connection_id,
                                'apic_connection_name': apic_connection.name,
                            },
                            success=False,
                            error_message=error,
                        )
                    except Exception as e:
                        # Audit failures shouldn't abort the task
                        logger.warning("Audit logging failed: %s", e)

                    continue

                result_count = get_result_count(result)
                execution.status = ScheduledTaskExecution.STATUS_SUCCESS
                execution.result = result
                execution.result_count = result_count
                execution.completed_at = timezone.now()

                if execution.started_at:
                    delta = execution.completed_at - execution.started_at
                    execution.execution_time_ms = int(delta.total_seconds() * 1000)

                execution.save()
                success_count += 1

                try:
                    from audit.services import AuditService
                    AuditService.log(
                        user=task.created_by,
                        action='query_executed',
                        category='query_execution',
                        resource_type='ScheduledTask',
                        resource_id=task.id,
                        resource_name=task.name,
                        description=f"Scheduled task '{task.name}' executed successfully on connection '{apic_connection.name}' ({result_count} results)",
                        metadata={
                            'scheduled_task_id': str(task.id),
                            'scheduled_task_name': task.name,
                            'execution_id': str(execution.id),
                            'apic_connection_id': connection_id,
                            'apic_connection_name': apic_connection.name,
                            'execution_time_ms': execution.execution_time_ms,
                            'result_count': result_count,
                        },
                        content=str(result) if result else None,
                        success=True,
                    )
                except Exception as e:
                    logger.warning("Audit logging failed: %s", e)

                # Capture a Time Machine snapshot after each successful run.
                # Failures here should never kill the task — the query result
                # has already been saved, we just miss the snapshot this time.
                if saved_query.enable_time_machine:
                    try:
                        from time_machine.services import time_machine_service

                        class_name = None
                        if saved_query.flow_data and 'nodes' in saved_query.flow_data:
                            class_nodes = [n for n in saved_query.flow_data['nodes'] if n.get('type') == 'class']
                            if class_nodes:
                                class_name = class_nodes[0].get('data', {}).get('className')

                        time_machine_service.capture_snapshot(
                            result_data=result,
                            user_id=task.created_by.id if task.created_by else None,
                            apic_connection_id=connection_id,
                            apic_connection_name=apic_connection.name,
                            saved_query_id=saved_query.id,
                            query_name=saved_query.name,
                            class_name=class_name,
                            query_structure=saved_query.flow_data,
                            execution_time_ms=execution.execution_time_ms,
                            scheduled_task_id=str(task.id),
                            scheduled_task_execution_id=str(execution.id),
                            execution_type='scheduled',
                        )
                    except Exception as e:
                        logger.error("Time Machine snapshot failed: %s", e, exc_info=True)

            except Exception as e:
                try:
                    execution.status = ScheduledTaskExecution.STATUS_FAILED
                    execution.error_message = f'Unexpected error: {str(e)}'
                    execution.completed_at = timezone.now()
                    execution.save()
                except Exception:
                    pass
                failure_count += 1

        # Update aggregate counters on the task itself
        task.execution_count += 1
        task.success_count += success_count
        task.failure_count += failure_count
        task.last_run_at = timezone.now()

        if task.frequency == ScheduledTask.FREQ_ONCE:
            # One-time task — park it so it doesn't run again next minute
            task.status = ScheduledTask.STATUS_PAUSED
            task.next_run_at = None
        else:
            task.next_run_at = task.calculate_next_run()

        task.save()

        # Notify the user — only create a notification if there's something to report.
        # A clean run with zero failures gets a success notification;
        # any failure gets an error/warning depending on whether anything succeeded.
        if failure_count > 0:
            create_notification(
                user=task.created_by,
                type='error' if success_count == 0 else 'warning',
                title=f'Task "{task.name}" completed with errors',
                message=f'Executed against {len(task.apic_connection_ids)} connections. Success: {success_count}, Failed: {failure_count}',
                source='scheduled_task_failure',
                related_task_id=task.id,
            )
        elif success_count > 0:
            create_notification(
                user=task.created_by,
                type='success',
                title=f'Task "{task.name}" completed successfully',
                message=f'Executed successfully against {success_count} connection(s)',
                source='scheduled_task_success',
                related_task_id=task.id,
            )

    except ScheduledTask.DoesNotExist:
        return
    except Exception as e:
        logger.error("Scheduled task %s failed: %s", task_id, e, exc_info=True)


@shared_task(bind=True, name='queries.execute_pipeline',
             soft_time_limit=3600, time_limit=3900)
def execute_pipeline(self, job_id: str) -> None:
    """Run a multi-stage query pipeline with WebSocket progress updates.

    Each stage runs sequentially — the output of stage N is extracted and
    injected as filter input into stage N+1. Pipeline edges in the canvas
    define the injection mode (filter_values, dn_scope, or iterate).
    """
    from queries.models import ChainExecutionJob
    from queries.services.pipeline_executor import PipelineExecutor

    try:
        job = ChainExecutionJob.objects.get(id=job_id)
        job.mark_as_started()

        apic_connection = APICConnection.objects.get(
            id=job.chain_config.get('apic_connection_id')
        )

        apic_client = APICClient(
            url=apic_connection.url,
            username=apic_connection.username,
            password=apic_connection.get_password(),
            verify_ssl=apic_connection.verify_ssl,
            timeout=apic_connection.timeout
        )

        login_success, login_error = apic_client.login()
        if not login_success:
            job.mark_as_failed(f'APIC login failed: {login_error}')
            emit_status(str(job.id), 'failed')
            return

        executor = PipelineExecutor(job, apic_client)
        summary = executor.execute()

        # Store aggregated results
        job.aggregated_results = summary
        job.save(update_fields=['aggregated_results'])

        if job.failed_iterations > 0:
            job.mark_as_failed(
                f'{job.failed_iterations} of {job.total_iterations} stages failed'
            )
            emit_status(str(job.id), 'failed')
        else:
            job.mark_as_completed()
            emit_status(str(job.id), 'success')

    except ChainExecutionJob.DoesNotExist:
        return

    except APICConnection.DoesNotExist:
        try:
            job = ChainExecutionJob.objects.get(id=job_id)
            job.mark_as_failed('APIC connection not found')
            emit_status(str(job.id), 'failed')
        except ChainExecutionJob.DoesNotExist:
            pass

    except Exception as e:
        error_traceback = traceback.format_exc()
        logger.error(f"Pipeline execution failed: {e}\n{error_traceback}")
        try:
            job = ChainExecutionJob.objects.get(id=job_id)
            job.mark_as_failed(str(e))
            emit_status(str(job.id), 'failed')
        except ChainExecutionJob.DoesNotExist:
            pass


def apply_template_variables(query_data: dict, variable_values: dict) -> dict:
    # Substitute ${variableId} placeholders in the generated query URL and params
    # with URL-encoded values so the APIC query string stays valid.
    import json
    from urllib.parse import quote

    if not variable_values:
        return query_data

    serialized = json.dumps(query_data)
    for var_id, var_value in variable_values.items():
        encoded_value = quote(str(var_value), safe='')
        serialized = serialized.replace(f'${{{var_id}}}', encoded_value)

    return json.loads(serialized)


def execute_saved_query_sync(query_id: int, connection_id: int) -> Any:
    """Run a SavedQuery synchronously — blocking, no Celery.

    Used during AWX column validation at save time, where we need the result
    immediately to populate the dropdown options. Not suitable for large queries
    since it blocks the request thread.
    """
    from queries.models import SavedQuery
    from apic_connections.models import APICConnection
    from apic_connections.apic_client import APICClient

    query = SavedQuery.objects.get(id=query_id)
    apic_connection = APICConnection.objects.get(id=connection_id)

    apic_client = APICClient(
        url=apic_connection.url,
        username=apic_connection.username,
        password=apic_connection.get_password(),
        verify_ssl=apic_connection.verify_ssl,
        timeout=apic_connection.timeout
    )

    login_success, login_error = apic_client.login()
    if not login_success:
        raise Exception(f'APIC login failed: {login_error}')

    # generated_query can be either a dict (new format) or a raw URL string (old format)
    if isinstance(query.generated_query, dict):
        query_url = query.generated_query.get('url', '')
        query_params = query.generated_query.get('params', {})
    else:
        query_url = str(query.generated_query)
        query_params = {}

    if query_params:
        param_str = '&'.join([f"{k}={v}" for k, v in query_params.items()])
        query_url = f"{query_url}?{param_str}" if '?' not in query_url else f"{query_url}&{param_str}"

    success, result, error = apic_client.execute_query(query_url)
    if not success:
        raise Exception(f'Query execution failed: {error}')

    flow_data = query.flow_data or {}
    nodes = flow_data.get('nodes', [])
    post_processor_nodes = [n for n in nodes if n.get('type') in ['post-processor', 'postProcessorNode']]

    if post_processor_nodes:
        result = apply_post_processors(result, post_processor_nodes)

    return result
