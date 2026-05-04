# awx/services/job_monitor.py
#
# Fetches current job status from AWX for all non-terminal executions and
# updates the local DB records. Called from the sync_running_jobs Beat task
# every 10 seconds. Also broadcasts status changes via WebSocket so the
# frontend request detail page updates in real time without polling.
#
# One client per AWX connection is created per sync cycle. Executions grouped
# by connection are processed together to reuse the same HTTP session.

import logging
from typing import Dict, Any

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from awx.models import AutomationExecution, AWXConnection, AutomationTemplate
from awx.services.awx_client import AWXClient

logger = logging.getLogger(__name__)


class JobMonitorError(Exception):
    """Base exception for job monitoring errors"""


class JobMonitor:
    # Polls AWX for job status and keeps AutomationExecution rows in sync.

    TERMINAL_STATUSES = ['successful', 'failed', 'error', 'canceled']

    # AWX status → Fabrik status mapping
    STATUS_MAPPING = {
        'pending': 'pending',
        'waiting': 'pending',
        'running': 'running',
        'successful': 'successful',
        'failed': 'failed',
        'error': 'failed',
        'canceled': 'canceled',
    }

    def __init__(self):
        self.awx_client = None

    def sync_running_jobs(self) -> Dict[str, Any]:
        try:
            # Find all non-terminal executions
            executions = AutomationExecution.objects.filter(
                status__in=['pending', 'running']
            ).select_related('awx_connection', 'automation_request__template')

            synced_count = 0
            failed_count = 0

            for execution in executions:
                try:
                    success = self.sync_job_status(execution.id)
                    if success:
                        synced_count += 1
                    else:
                        failed_count += 1
                except Exception as e:
                    logger.exception(f"Error syncing execution {execution.id}: {str(e)}")
                    failed_count += 1

            logger.info(
                f"Job sync completed: {synced_count} synced, {failed_count} failed, "
                f"{executions.count()} total"
            )

            return {
                'total': executions.count(),
                'synced': synced_count,
                'failed': failed_count
            }

        except Exception as e:
            logger.exception(f"Error in sync_running_jobs: {str(e)}")
            return {'total': 0, 'synced': 0, 'failed': 0, 'error': str(e)}

    def sync_job_status(self, execution_id) -> bool:
        # select_for_update prevents concurrent modification by overlapping sync cycles.
        try:
            # Lock the execution row to prevent concurrent modification
            with transaction.atomic():
                execution = AutomationExecution.objects.select_for_update(
                    skip_locked=True
                ).select_related(
                    'awx_connection',
                    'automation_request__template'
                ).filter(id=execution_id).first()

                if execution is None:
                    # Row is locked by another process or doesn't exist
                    logger.debug(f"Execution {execution_id} skipped (locked or not found)")
                    return True

                # Skip if already in terminal status
                if execution.status in self.TERMINAL_STATUSES:
                    return True

            # Configure AWX client
            self._configure_awx_client(execution.awx_connection)

            # Get template
            template = execution.automation_request.template

            # Sync based on template type
            if template.awx_type == AutomationTemplate.AWX_TYPE_JOB:
                success = self._sync_job_template_status(execution)
            elif template.awx_type == AutomationTemplate.AWX_TYPE_WORKFLOW:
                success = self._sync_workflow_status(execution)
            else:
                logger.error(f"Unknown template type: {template.awx_type}")
                return False

            if success:
                # Emit WebSocket update (placeholder for Phase 3)
                self._emit_websocket_update(execution)

            return success

        except AutomationExecution.DoesNotExist:
            logger.error(f"Execution {execution_id} not found")
            return False
        except Exception as e:
            logger.exception(f"Error syncing job status for {execution_id}: {str(e)}")
            return False

    def _sync_job_template_status(self, execution: AutomationExecution) -> bool:
        try:
            job_id = int(execution.awx_job_id)

            # Get job status from AWX
            success, job_data, error = self.awx_client.get_job_status(job_id)

            if not success:
                logger.error(f"Failed to get job status for {job_id}: {error}")
                return False

            # Extract status info
            awx_status = job_data.get('status', 'unknown')
            fabrik_status = self.STATUS_MAPPING.get(awx_status, 'running')

            # Build update fields list for targeted save (prevents overwriting unrelated fields)
            update_fields = ['status', 'awx_job_data', 'progress_percentage', 'current_task']

            execution.status = fabrik_status
            execution.awx_job_data = job_data
            execution.progress_percentage = self._calculate_progress(job_data)
            execution.current_task = self._extract_current_task(job_data)

            # Playbook counts
            if 'playbook_counts' in job_data:
                execution.playbook_counts = job_data['playbook_counts']
                update_fields.append('playbook_counts')

            # Terminal status handling
            if awx_status in self.TERMINAL_STATUSES:
                execution.finished_at = timezone.now()
                update_fields.append('finished_at')

                # Calculate elapsed time
                if execution.started_at:
                    elapsed = (execution.finished_at - execution.started_at).total_seconds()
                    execution.elapsed_seconds = int(elapsed)
                    update_fields.append('elapsed_seconds')

                # Get artifacts if available
                if 'artifacts' in job_data:
                    execution.artifacts = job_data['artifacts']
                    update_fields.append('artifacts')

                # Atomically update request status
                from awx.models import AutomationRequest
                with transaction.atomic():
                    request = AutomationRequest.objects.select_for_update().get(
                        id=execution.automation_request_id
                    )
                    if fabrik_status == 'successful':
                        request.status = AutomationRequest.STATUS_SUCCESSFUL
                    elif fabrik_status in ['failed', 'error']:
                        request.status = AutomationRequest.STATUS_FAILED
                    elif fabrik_status == 'canceled':
                        request.status = AutomationRequest.STATUS_CANCELLED
                    request.save(update_fields=['status'])

                # Update template execution statistics (uses its own update_fields)
                self._update_template_stats(execution.automation_request.template, fabrik_status)

                # Notify user of terminal status
                self._notify_terminal_status(execution, request, fabrik_status)

            execution.save(update_fields=update_fields)

            logger.info(
                f"Synced job {job_id}: status={fabrik_status}, "
                f"progress={execution.progress_percentage}%"
            )

            return True

        except Exception as e:
            logger.exception(f"Error syncing job template status: {str(e)}")
            return False

    def _sync_workflow_status(self, execution: AutomationExecution) -> bool:
        try:
            workflow_job_id = int(execution.awx_job_id)

            # Get workflow job status
            success, workflow_data, error = self.awx_client.get_workflow_job_status(workflow_job_id)

            if not success:
                logger.error(f"Failed to get workflow status for {workflow_job_id}: {error}")
                return False

            # Extract workflow status
            awx_status = workflow_data.get('status', 'unknown')
            fabrik_status = self.STATUS_MAPPING.get(awx_status, 'running')

            # Get workflow nodes
            nodes_success, nodes_response, _ = self.awx_client.get_workflow_job_nodes(workflow_job_id)

            # Extract nodes array from API response
            nodes_data = []
            if nodes_success and nodes_response:
                if isinstance(nodes_response, dict) and 'results' in nodes_response:
                    nodes_data = nodes_response['results']
                elif isinstance(nodes_response, list):
                    # Fallback: if API returns list directly
                    nodes_data = nodes_response

            # Calculate workflow progress based on node completion
            if nodes_data:
                total_nodes = len(nodes_data)
                completed_nodes = sum(
                    1 for node in nodes_data
                    if node.get('status') in self.TERMINAL_STATUSES
                )
                progress = int((completed_nodes / total_nodes) * 100) if total_nodes > 0 else 0
            else:
                # Fallback to simple progress
                progress = 100 if awx_status in self.TERMINAL_STATUSES else 50

            # Build update fields list for targeted save
            update_fields = ['status', 'awx_job_data', 'progress_percentage']

            execution.status = fabrik_status
            execution.awx_job_data = workflow_data
            execution.progress_percentage = progress

            # Extract current task from active nodes
            if nodes_data:
                active_nodes = [n for n in nodes_data if n.get('status') == 'running']
                if active_nodes:
                    node_name = active_nodes[0].get('summary_fields', {}).get('job', {}).get('name')
                    execution.current_task = f"Running: {node_name}"
                elif awx_status == 'running':
                    execution.current_task = f"Workflow running ({completed_nodes}/{total_nodes} nodes complete)"
                update_fields.append('current_task')

                # Merge node details into metadata (read-modify-write within atomic block)
                # Re-read metadata to prevent overwriting concurrent changes
                with transaction.atomic():
                    fresh = AutomationExecution.objects.select_for_update().get(id=execution.id)
                    metadata = fresh.execution_metadata or {}
                    metadata['workflow_nodes'] = nodes_data

                    # For failed workflows, collect failed node details
                    if awx_status in ['failed', 'error']:
                        failed_nodes = [
                            n for n in nodes_data
                            if n.get('status') in ['failed', 'error']
                        ]
                        if failed_nodes:
                            failure_details = []
                            for node in failed_nodes:
                                node_job = node.get('summary_fields', {}).get('job', {})
                                failure_details.append({
                                    'node_id': node.get('id'),
                                    'job_name': node_job.get('name'),
                                    'job_id': node_job.get('id'),
                                    'status': node.get('status')
                                })
                            metadata['failed_nodes'] = failure_details

                    fresh.execution_metadata = metadata
                    fresh.save(update_fields=['execution_metadata'])

                # Keep local copy in sync
                execution.execution_metadata = metadata

            # Terminal status handling
            if awx_status in self.TERMINAL_STATUSES:
                execution.finished_at = timezone.now()
                update_fields.append('finished_at')

                if execution.started_at:
                    elapsed = (execution.finished_at - execution.started_at).total_seconds()
                    execution.elapsed_seconds = int(elapsed)
                    update_fields.append('elapsed_seconds')

                # Atomically update request status
                from awx.models import AutomationRequest
                with transaction.atomic():
                    request = AutomationRequest.objects.select_for_update().get(
                        id=execution.automation_request_id
                    )
                    if fabrik_status == 'successful':
                        request.status = AutomationRequest.STATUS_SUCCESSFUL
                    elif fabrik_status in ['failed', 'error']:
                        request.status = AutomationRequest.STATUS_FAILED
                    elif fabrik_status == 'canceled':
                        request.status = AutomationRequest.STATUS_CANCELLED
                    request.save(update_fields=['status'])

                # Update template execution statistics (uses its own update_fields)
                self._update_template_stats(execution.automation_request.template, fabrik_status)

                # Notify user of terminal status
                self._notify_terminal_status(execution, request, fabrik_status)

                # Reap the ephemeral workflow_job_template clone Fabrik created
                # for this launch. No-op for executions without a clone.
                if execution.clone_template_id:
                    from awx.tasks import delete_workflow_clone
                    delete_workflow_clone.delay(str(execution.id))

            execution.save(update_fields=update_fields)

            logger.info(
                f"Synced workflow {workflow_job_id}: status={fabrik_status}, "
                f"progress={execution.progress_percentage}%"
            )

            return True

        except Exception as e:
            logger.exception(f"Error syncing workflow status: {str(e)}")
            return False

    def _calculate_progress(self, job_data: Dict) -> int:
        try:
            # Check if job has explicit percent field
            if 'percent' in job_data:
                return int(job_data['percent'])

            # Calculate from playbook counts
            playbook_counts = job_data.get('playbook_counts', {})
            if playbook_counts:
                total_tasks = sum([
                    playbook_counts.get('ok', 0),
                    playbook_counts.get('changed', 0),
                    playbook_counts.get('failed', 0),
                    playbook_counts.get('skipped', 0),
                ])

                if total_tasks > 0:
                    completed_tasks = sum([
                        playbook_counts.get('ok', 0),
                        playbook_counts.get('changed', 0),
                        playbook_counts.get('failed', 0),
                    ])
                    return min(int((completed_tasks / total_tasks) * 100), 100)

            # Fallback based on status
            status = job_data.get('status', '')
            if status == 'pending':
                return 0
            elif status == 'running':
                return 50
            elif status in self.TERMINAL_STATUSES:
                return 100
            else:
                return 0

        except Exception as e:
            logger.exception(f"Error calculating progress: {str(e)}")
            return 0

    def _extract_current_task(self, job_data: Dict) -> str:
        try:
            status = job_data.get('status', '')

            if status == 'pending':
                return 'Waiting to start...'
            elif status == 'running':
                # Try to get current playbook/task
                if 'current_play' in job_data:
                    return f"Running: {job_data['current_play']}"
                elif 'playbook' in job_data:
                    return f"Running playbook: {job_data['playbook']}"
                else:
                    return 'Running...'
            elif status == 'successful':
                return 'Completed successfully'
            elif status in ['failed', 'error']:
                return 'Failed'
            elif status == 'canceled':
                return 'Canceled'
            else:
                return status.capitalize()

        except Exception as e:
            logger.exception(f"Error extracting current task: {str(e)}")
            return 'Unknown'

    def _notify_terminal_status(self, execution, request, fabrik_status):
        try:
            from notifications.services import create_notification

            if fabrik_status == 'successful':
                create_notification(
                    user=request.requested_by,
                    type='success',
                    title=f'AWX job completed: {request.title}',
                    message=f'Job #{execution.awx_job_id} finished successfully',
                    source='awx_execution_success',
                    related_execution_id=request.id,
                )
            elif fabrik_status in ('failed', 'error'):
                tb = execution.result_traceback[:200] if execution.result_traceback else f'Job ended with status: {fabrik_status}'
                create_notification(
                    user=request.requested_by,
                    type='error',
                    title=f'AWX job failed: {request.title}',
                    message=tb,
                    source='awx_execution_failure',
                    related_execution_id=request.id,
                )
            elif fabrik_status == 'canceled':
                create_notification(
                    user=request.requested_by,
                    type='warning',
                    title=f'AWX job canceled: {request.title}',
                    message=f'Job #{execution.awx_job_id} was canceled',
                    source='awx_execution_failure',
                    related_execution_id=request.id,
                )
        except Exception:
            logger.exception('Failed to send terminal status notification')

    def _update_template_stats(self, template: AutomationTemplate, status: str) -> None:
        # Atomic F() increment — safe under concurrent workers.
        try:
            update_kwargs = {
                'execution_count': F('execution_count') + 1,
                'last_executed_at': timezone.now(),
            }

            if status == 'successful':
                update_kwargs['success_count'] = F('success_count') + 1
            elif status in ['failed', 'error']:
                update_kwargs['failure_count'] = F('failure_count') + 1

            AutomationTemplate.objects.filter(id=template.id).update(**update_kwargs)

            logger.info(f"Updated template {template.id} stats: status={status}")

        except Exception as e:
            # Don't fail job sync if stats update fails
            logger.exception(f"Error updating template stats: {str(e)}")

    def _configure_awx_client(self, awx_connection: AWXConnection) -> None:
        try:
            self.awx_client = AWXClient.for_connection(awx_connection)

        except Exception as e:
            logger.exception(f"Error configuring AWX client: {str(e)}")
            raise JobMonitorError(f"AWX client configuration failed: {str(e)}")

    def _emit_websocket_update(self, execution: AutomationExecution) -> None:
        try:
            from awx.services.websocket_service import get_websocket_service
            from awx.serializers import AutomationExecutionSerializer

            ws_service = get_websocket_service()

            # Serialize execution data
            serialized_data = AutomationExecutionSerializer(execution).data

            # Emit to request channel (for request detail page)
            ws_service.emit_execution_update(
                str(execution.automation_request_id),
                serialized_data
            )

            # Emit progress to execution channel (for execution detail view)
            ws_service.emit_progress_update(
                str(execution.id),
                execution.progress_percentage,
                execution.current_task or 'Processing...',
                execution.current_task
            )

            # Emit status to execution channel
            # Use result_traceback for error message (error_message field doesn't exist)
            error_msg = execution.result_traceback if execution.status in ['failed', 'error'] else None
            ws_service.emit_execution_status(
                str(execution.id),
                execution.status,
                execution.awx_job_id,
                error_msg,
                execution.finished_at.isoformat() if execution.finished_at else None
            )

            logger.debug(
                f"WebSocket update sent: execution={execution.id}, "
                f"status={execution.status}, progress={execution.progress_percentage}%"
            )

        except Exception as e:
            # Don't fail job sync if WebSocket fails
            logger.exception(f"Error emitting WebSocket update: {str(e)}")
