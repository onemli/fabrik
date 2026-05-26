# awx/services/execution_engine.py
#
# Translates an AutomationRequest into a single AWX job launch (bulk mode).
# All rows are packaged into one extra_vars dict and sent as one AWX job.
#
# _sanitize_awx_row strips None/empty values from boolean-typed columns before
# the dict reaches AWX because Ansible raises a type error on empty strings
# for boolean parameters even when the playbook uses `| default(omit)`.

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional, Any
from io import StringIO
import csv as csv_module

from django.conf import settings
from django.utils import timezone
from django.db import transaction

from awx.models import AutomationRequest, AutomationTemplate, AutomationExecution, AWXConnection
from awx.services.awx_client import AWXClient
from awx.services.data_transformer import DataTransformer

logger = logging.getLogger(__name__)


# Prefix applied to every ephemeral workflow_job_template clone Fabrik creates.
# The orphan reaper (cleanup_orphaned_workflow_clones) filters AWX templates by
# this prefix, so changing it breaks reaper coverage for in-flight clones —
# do a coordinated migration if you ever need to rename it.
_CLONE_NAME_PREFIX = '__fabrik__'


class ExecutionError(Exception):
    """Base exception for execution errors"""


class ValidationError(ExecutionError):
    """Raised when input data validation fails"""


class AWXConnectionError(ExecutionError):
    """Raised when AWX connection or API call fails"""


@dataclass
class LaunchResult:
    """Result of dispatching one launch through ExecutionEngine._launch_awx_job.

    clone_template_id is set only when the workflow path created an ephemeral
    AWX template clone — callers persist it on AutomationExecution so the
    terminal-status hook (and the orphan reaper) can clean it up later.
    """

    success: bool
    job_data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    clone_template_id: Optional[int] = None


# Field types that expect a boolean value in Ansible modules.
# Column types where None/'' values must be stripped before sending to AWX.
# Ansible's `| default(omit)` only triggers for *undefined* variables; if the
# key exists with None or '' the module receives an empty string and raises a
# type-conversion error (e.g. "not a valid boolean").
# 'select' is included because yes/no dropdowns map to Ansible boolean params.
_STRIP_IF_EMPTY_TYPES = frozenset({'boolean', 'checkbox', 'bool', 'select'})


def _sanitize_awx_row(
    row: Dict[str, Any],
    allowed_columns: List[str],
    col_types: Dict[str, str],
) -> Dict[str, Any]:
    # Drops non-AWX columns and strips empty boolean/select values that would
    # cause Ansible type-conversion errors.
    result: Dict[str, Any] = {}
    for key, value in row.items():
        if key not in allowed_columns:
            continue
        # Strip whitespace/CRLF from pasted cells — Excel/Windows clipboard
        # leaves trailing '\r' which APIC rejects (error 801 on descr fields).
        if isinstance(value, str):
            value = value.strip()
        field_type = col_types.get(key, 'text')
        if field_type in _STRIP_IF_EMPTY_TYPES and value in (None, ''):
            # Drop: Ansible module will use its own default via `| default(omit)`
            continue
        result[key] = value
    return result


class ExecutionEngine:
    """Launches a single AWX job with all rows as structured JSON (bulk mode)."""

    MODE_BULK = 'bulk'

    STATUS_PENDING = 'pending'
    STATUS_RUNNING = 'running'
    STATUS_SUCCESSFUL = 'successful'
    STATUS_FAILED = 'failed'
    STATUS_CANCELED = 'canceled'

    def __init__(self) -> None:
        self.awx_client: Optional[AWXClient] = (
            None  # Created per-connection via _configure_awx_client
        )
        self.data_transformer: DataTransformer = DataTransformer()

    def execute_request(
        self,
        request_id: uuid.UUID,
        relaunch_of_execution_id: Optional[uuid.UUID] = None,
    ) -> Tuple[bool, List[uuid.UUID], Optional[str]]:
        try:
            # Load request with related data
            request = AutomationRequest.objects.select_related(
                'template', 'awx_connection', 'target_apic', 'requested_by'
            ).get(id=request_id)

            logger.info(
                f'Starting execution for request {request_id}'
                + (f' (relaunch of {relaunch_of_execution_id})' if relaunch_of_execution_id else '')
            )

            # Get template — use snapshot if available so schema changes after
            # request creation don't break execution
            template = request.template
            snapshot = request.template_snapshot
            if snapshot:
                if 'table_schemas' in snapshot:
                    template.table_schemas = snapshot['table_schemas']
                if 'variable_mappings' in snapshot:
                    template.variable_mappings = snapshot['variable_mappings']

            # Validate input data - if validation fails, create a failed execution record
            try:
                self._validate_input_data(request.input_data, template.table_schemas)
            except ValidationError as ve:
                # Atomically create failed execution + update request status
                with transaction.atomic():
                    execution = AutomationExecution.objects.create(
                        automation_request=request,
                        awx_connection=request.awx_connection,
                        status=AutomationExecution.STATUS_ERROR,
                        result_traceback=str(ve),
                        execution_mode=template.execution_mode or self.MODE_BULK,
                        execution_metadata={'validation_error': str(ve)},
                    )
                    request.status = AutomationRequest.STATUS_FAILED
                    request.save(update_fields=['status'])

                logger.error('Validation failed for request %s: %s', request_id, str(ve))
                # ValidationError messages are user-facing on purpose ("Missing
                # required field 'tenant_name'") — these are crafted strings,
                # not exception object payloads, so passing them through is safe.
                return False, [execution.id], str(ve)

            # Configure AWX client
            self._configure_awx_client(request.awx_connection)

            # Always bulk — all rows in one AWX job
            success, execution_ids, error = self.execute_bulk(
                request,
                template,
                relaunch_of_execution_id=relaunch_of_execution_id,
            )

            if success:
                # Update request status
                request.status = AutomationRequest.STATUS_RUNNING
                request.save()

                logger.info(
                    f'Successfully started execution for request {request_id}. '
                    f'Created {len(execution_ids)} execution(s)'
                )
            else:
                logger.error('Failed to execute request %s: %s', request_id, error)

            return success, execution_ids, error

        except AutomationRequest.DoesNotExist:
            error_msg = f'Request {request_id} not found'
            logger.error(error_msg)
            return False, [], error_msg

        except (ValidationError, AWXConnectionError) as e:
            # Domain-specific exceptions raise messages we control (validation
            # text or AWX connection state) so they're safe to surface.
            logger.exception('Execution failed for request %s', request_id)
            return False, [], str(e)

        except Exception as e:
            logger.exception('Unexpected error during execution of request %s', request_id)
            return False, [], f'Execution failed ({type(e).__name__}).'

    def execute_bulk(
        self,
        request: AutomationRequest,
        template: AutomationTemplate,
        relaunch_of_execution_id: Optional[uuid.UUID] = None,
    ) -> Tuple[bool, List[uuid.UUID], Optional[str]]:
        # All rows packaged into one extra_vars dict → single AWX job.
        try:
            logger.info(f'Executing request {request.id} in BULK mode')

            # Filter input data to only include AWX columns (send_to_awx=True)
            filtered_data = self._filter_awx_columns(request.input_data, template.table_schemas)

            # Build extra_vars - Data payload for multi-schema or single-schema
            if isinstance(filtered_data, dict):
                # Multi-schema workflow: {tenants: [...], vrfs: [...], bridge_domains: [...]}
                extra_vars = dict(filtered_data)
            else:
                # Single-schema: Use schema's awx_variable_name (NOT hard-coded!)
                schema = template.table_schemas[0] if template.table_schemas else {}
                var_name = schema.get(
                    'awx_variable_name', 'data'
                )  # Default to 'data' if not specified
                extra_vars = {var_name: filtered_data}

            # Add request metadata
            extra_vars['fabrik_request_id'] = str(request.id)
            extra_vars['fabrik_template_name'] = template.name
            extra_vars['fabrik_execution_mode'] = self.MODE_BULK

            # User context (for audit trail and AWX logs)
            extra_vars['fabrik_user_username'] = request.requested_by.username
            extra_vars['fabrik_user_email'] = request.requested_by.email
            extra_vars['fabrik_user_first_name'] = request.requested_by.first_name
            extra_vars['fabrik_user_last_name'] = request.requested_by.last_name
            extra_vars['fabrik_user_full_name'] = request.requested_by.get_full_name()

            # LDAP attributes (if available)
            extra_vars['fabrik_user_department'] = getattr(request.requested_by, 'department', None)
            extra_vars['fabrik_user_employee_id'] = getattr(
                request.requested_by, 'employee_id', None
            )
            extra_vars['fabrik_user_job_title'] = getattr(request.requested_by, 'job_title', None)

            # Audit context
            extra_vars['fabrik_requested_at'] = (
                request.requested_at.isoformat()
                if request.requested_at
                else timezone.now().isoformat()
            )
            extra_vars['fabrik_execution_timestamp'] = timezone.now().isoformat()
            extra_vars['fabrik_client_ip'] = (
                request.metadata.get('client_ip') if request.metadata else None
            )
            extra_vars['fabrik_user_agent'] = (
                request.metadata.get('user_agent') if request.metadata else None
            )

            # Platform info
            extra_vars['fabrik_platform_version'] = getattr(settings, 'FABRIK_VERSION', '1.2.0')

            # Add any additional variables from template
            if template.variable_mappings:
                extra_vars.update(template.variable_mappings)

            # AWX credential is required — it carries APIC host/user/password via
            # AWX's own vault injection. Fabrik never puts credentials in extra_vars.
            awx_credentials = self._collect_awx_credentials(request)

            # Launch AWX job/workflow
            launch = self._launch_awx_job(
                template=template,
                extra_vars=extra_vars,
                request_id=request.id,
                check_mode=request.check_mode,
                credentials=awx_credentials,
            )

            if not launch.success:
                return False, [], launch.error

            job_data = launch.job_data

            # Calculate actual row count (filtered_data may be list or dict)
            if isinstance(filtered_data, list):
                total_rows = len(filtered_data)
            elif isinstance(filtered_data, dict):
                total_rows = sum(len(v) for v in filtered_data.values() if isinstance(v, list))
            else:
                total_rows = 0

            # Create execution record
            execution = self._create_execution_record(
                request=request,
                template=template,
                awx_job_id=job_data.get('id'),
                awx_job_url=job_data.get('url', ''),
                execution_mode=self.MODE_BULK,
                row_number=None,
                batch_number=None,
                row_range={'start': 0, 'end': total_rows},
                metadata={'total_rows': total_rows, 'awx_job_data': job_data},
                clone_template_id=launch.clone_template_id,
                relaunch_of_execution_id=relaunch_of_execution_id,
            )

            # Store a sanitized copy of extra_vars for audit — never credentials
            request.ansible_extra_vars = self._redact_extra_vars(extra_vars)
            request.save()

            return True, [execution.id], None

        except Exception as e:
            error_msg = f'Bulk execution failed: {str(e)}'
            logger.exception(error_msg)
            return False, [], error_msg

    def transform_data_to_csv(
        self, input_data: Any, table_schemas: List[Dict], include_headers: bool = True
    ) -> str:
        try:
            # Handle both formats: list directly or dict with 'data' key
            if isinstance(input_data, list):
                rows = input_data
            elif isinstance(input_data, dict):
                rows = input_data.get('data', [])
            else:
                rows = []

            if not rows:
                return ''

            # Get column names from schema - ONLY columns marked to send to AWX
            if table_schemas and table_schemas[0].get('columns'):
                # Filter: Only include columns with send_to_awx != False (default: True for backward compat)
                awx_columns = [
                    col
                    for col in table_schemas[0]['columns']
                    if col.get('send_to_awx', True) is not False
                ]
                column_names = [col['name'] for col in awx_columns]

                logger.info(
                    f'[CSV Transform] Total columns: {len(table_schemas[0]["columns"])}, AWX columns: {len(column_names)}'
                )
                if len(column_names) < len(table_schemas[0]['columns']):
                    excluded = [
                        col['name']
                        for col in table_schemas[0]['columns']
                        if col.get('send_to_awx') is False
                    ]
                    logger.info(f'[CSV Transform] Excluded metadata columns: {excluded}')
            else:
                # Fallback: Use keys from first row
                column_names = list(rows[0].keys())

            # Create CSV
            output = StringIO()
            writer = csv_module.DictWriter(output, fieldnames=column_names, extrasaction='ignore')

            if include_headers:
                writer.writeheader()

            for row in rows:
                writer.writerow(row)

            csv_string = output.getvalue()
            output.close()

            return csv_string

        except Exception as e:
            logger.exception('Error transforming data to CSV')
            raise ValidationError(f'Failed to generate CSV: {str(e)}')

    def _filter_awx_columns(self, input_data: Any, table_schemas: List[Dict]) -> Any:
        # Keeps only columns with send_to_awx=True. Preserves input shape (list or dict).
        # Keeps
        try:
            # Dict format (normalized single-schema or multi-schema workflow)
            if isinstance(input_data, dict) and table_schemas:
                filtered_data = {}

                for schema in table_schemas:
                    var_name = schema.get('awx_variable_name')
                    if not var_name or var_name not in input_data:
                        continue

                    rows = input_data[var_name]
                    if not rows:
                        filtered_data[var_name] = []
                        continue

                    # Get AWX column names for this schema
                    awx_columns = [
                        col
                        for col in schema.get('columns', [])
                        if col.get('send_to_awx', True) is not False
                    ]
                    awx_column_names = [col['name'] for col in awx_columns]

                    # Column type map — used to strip None for typed fields
                    col_types = {
                        col['name']: (col.get('type') or col.get('field_type') or 'text')
                        for col in awx_columns
                    }

                    # Filter rows — strip None/'' for boolean columns to prevent
                    # Ansible type-conversion errors (None → '' → not a valid bool)
                    filtered_rows = []
                    for row in rows:
                        filtered_row = _sanitize_awx_row(row, awx_column_names, col_types)
                        filtered_rows.append(filtered_row)

                    filtered_data[var_name] = filtered_rows
                    logger.info(
                        f"[AWX Filter] Schema '{var_name}': {len(rows)} rows, {len(awx_column_names)} AWX columns"
                    )

                return filtered_data

            # Single-schema (legacy): [...rows...]
            else:
                if isinstance(input_data, list):
                    rows = input_data
                elif isinstance(input_data, dict):
                    # Try schema's awx_variable_name first, fall back to 'data' for legacy
                    var_name = table_schemas[0].get('awx_variable_name') if table_schemas else None
                    if var_name and var_name in input_data:
                        rows = input_data[var_name]
                    else:
                        rows = input_data.get('data', [])
                else:
                    return []

                if not rows:
                    return []

                # Get AWX column names from first schema
                if table_schemas and table_schemas[0].get('columns'):
                    awx_columns = [
                        col
                        for col in table_schemas[0]['columns']
                        if col.get('send_to_awx', True) is not False
                    ]
                    awx_column_names = [col['name'] for col in awx_columns]
                    col_types = {
                        col['name']: (col.get('type') or col.get('field_type') or 'text')
                        for col in awx_columns
                    }
                else:
                    # Fallback: include all columns
                    awx_column_names = list(rows[0].keys()) if rows else []
                    col_types = {}

                # Filter each row — strip None/'' for boolean columns to prevent
                # Ansible type-conversion errors (None → '' → not a valid bool)
                filtered_rows = []
                for row in rows:
                    filtered_row = _sanitize_awx_row(row, awx_column_names, col_types)
                    filtered_rows.append(filtered_row)

                logger.info(
                    f'[AWX Filter] Single schema: {len(rows)} rows, {len(awx_column_names)} AWX columns'
                )

                return filtered_rows

        except Exception:
            logger.exception('Error filtering AWX columns')
            # Return original data as fallback
            return input_data if isinstance(input_data, list) else []

    @staticmethod
    def _collect_awx_credentials(request: AutomationRequest) -> list:
        # AWX injects APIC creds via its "Cisco ACI" credential type at launch time.
        if not request.awx_credential_id:
            raise ValidationError(
                "AWX Credential is required. Select a 'Cisco ACI' credential "
                'that contains APIC host, username, and password.'
            )
        return [request.awx_credential_id]

    _SENSITIVE_KEYS = frozenset(
        {
            'password',
            'passwd',
            'secret',
            'token',
            'api_key',
            'apikey',
            'apic_password',
            'apic_secret',
            'private_key',
            'credential',
        }
    )

    @classmethod
    def _redact_extra_vars(cls, extra_vars: Dict[str, Any]) -> Dict[str, Any]:
        # Replaces sensitive values with '***' before persisting to DB.
        if not extra_vars:
            return extra_vars
        redacted = {}
        for key, value in extra_vars.items():
            if any(s in key.lower() for s in cls._SENSITIVE_KEYS):
                redacted[key] = '***'
            else:
                redacted[key] = value
        return redacted

    def _launch_awx_job(
        self,
        template: AutomationTemplate,
        extra_vars: Dict[str, Any],
        request_id: uuid.UUID,
        check_mode: bool = False,
        credentials: Optional[List[int]] = None,
    ) -> LaunchResult:
        # Dispatches to launch_job or the clone-and-launch workflow path.
        try:
            if template.awx_type == AutomationTemplate.AWX_TYPE_JOB:
                ok, job_data, err = self.awx_client.launch_job(
                    job_template_id=template.awx_template_id,
                    extra_vars=extra_vars,
                    check_mode=check_mode,
                    credentials=credentials,
                )
                if not ok:
                    logger.error('AWX job launch failed: %s', err)
                    return LaunchResult(False, {}, err)
                logger.info(f'Successfully launched AWX job {job_data.get("id")}')
                return LaunchResult(True, job_data, None)

            if template.awx_type == AutomationTemplate.AWX_TYPE_WORKFLOW:
                # Always clone — even when no extra credentials are requested.
                # Uniform workflow launch path means relaunch and concurrent
                # launches behave identically without special-casing.
                return self._launch_workflow_via_clone(
                    template=template,
                    extra_vars=extra_vars,
                    check_mode=check_mode,
                    credentials=credentials or [],
                    request_id=request_id,
                )

            return LaunchResult(
                False,
                {},
                f'Unknown template type: {template.awx_type}',
            )

        except Exception as e:
            error_msg = f'Error launching AWX job: {str(e)}'
            logger.exception(error_msg)
            return LaunchResult(False, {}, error_msg)

    # ── Ephemeral workflow clone launch ────────────────────────────────────
    #
    # AWX's /workflow_job_templates/N/launch/ endpoint accepts a credentials list,
    # but those credentials attach to the workflow_job itself — they are NOT
    # cascaded to spawned child job templates. The official mechanism for node-
    # level credentials is /workflow_job_template_nodes/N/credentials/.
    #
    # Mutating the user's source template (associate → launch → disassociate)
    # leaks state on shared infrastructure and breaks AWX-side relaunch (the
    # /relaunch/ endpoint re-snapshots from the post-cleanup template config).
    # Instead we clone the template per-launch:
    #
    #   1. POST /workflow_job_templates/<source>/copy/  → clone (with nodes)
    #   2. Bind credentials on the clone's eligible nodes
    #   3. Launch the clone
    #   4. Persist clone_template_id on the AutomationExecution so the
    #      JobMonitor terminal-status hook (and the orphan reaper) can
    #      delete the clone later.
    #
    # No locks, no shared mutation, no cleanup race. Pre-launch failures
    # delete the clone immediately; post-launch lifecycle is the reaper's
    # responsibility.

    def _launch_workflow_via_clone(
        self,
        template: AutomationTemplate,
        extra_vars: Dict[str, Any],
        check_mode: bool,
        credentials: List[int],
        request_id: uuid.UUID,
    ) -> LaunchResult:
        clone_name = self._build_clone_name(request_id)
        ok, clone_data, err = self.awx_client.copy_workflow_template(
            template.awx_template_id,
            clone_name,
        )
        if not ok:
            return LaunchResult(False, {}, f'Failed to clone workflow: {err}')

        clone_id = clone_data.get('id')
        if not clone_id:
            return LaunchResult(
                False,
                {},
                'AWX returned a clone without an id field',
            )

        try:
            self._bind_credentials_to_clone(clone_id, credentials)

            ok, job_data, err = self.awx_client.launch_workflow(
                workflow_template_id=clone_id,
                extra_vars=extra_vars,
                check_mode=check_mode,
                credentials=None,  # creds are on the clone's nodes
            )
            if not ok:
                self._delete_clone_safely(clone_id)
                return LaunchResult(False, {}, err)

            logger.info(
                f'Launched workflow clone {clone_id} (job {job_data.get("id") if job_data else None})'
            )
            return LaunchResult(
                True,
                job_data or {},
                None,
                clone_template_id=clone_id,
            )

        except Exception:
            # Pre-launch error after the clone exists → reap it now so we
            # don't accumulate orphans. The reaper would catch it eventually,
            # but immediate cleanup keeps AWX tidy.
            self._delete_clone_safely(clone_id)
            raise

    # AWX `/copy/` populates workflow_nodes asynchronously. Empirically the
    # nodes appear within ~1s on healthy controllers; we poll up to ~6s before
    # giving up so we don't credential-bind an empty clone (which leaves
    # downstream nodes without apic_host and breaks the second-node onward).
    CLONE_NODE_POLL_DELAY = 0.5
    CLONE_NODE_POLL_ATTEMPTS = 12  # 12 × 0.5s = 6s max
    CLONE_NODE_POLL_MIN_NODES = 1

    def _wait_for_clone_nodes(self, clone_id: int) -> List[Dict[str, Any]]:
        """Poll AWX until clone's workflow_nodes are populated.

        Returns the node list as soon as ≥ MIN_NODES appear, or after
        ATTEMPTS retries. The empty-list fallback is intentional — caller
        logs and degrades gracefully rather than crashing the launch.
        """
        last_count = 0
        for attempt in range(self.CLONE_NODE_POLL_ATTEMPTS):
            ok, nodes, err = self.awx_client.list_workflow_nodes(clone_id)
            if not ok:
                raise AWXConnectionError(f'Failed to list clone nodes: {err}')
            if len(nodes) >= self.CLONE_NODE_POLL_MIN_NODES:
                if attempt > 0:
                    logger.info(
                        f'Clone {clone_id} nodes appeared after '
                        f'{attempt * self.CLONE_NODE_POLL_DELAY:.1f}s '
                        f'(count={len(nodes)})'
                    )
                return nodes
            last_count = len(nodes)
            time.sleep(self.CLONE_NODE_POLL_DELAY)
        logger.warning(
            f'Clone {clone_id} still has {last_count} nodes after '
            f'{self.CLONE_NODE_POLL_ATTEMPTS * self.CLONE_NODE_POLL_DELAY:.1f}s; '
            f'proceeding without credential bind'
        )
        return []

    def _bind_credentials_to_clone(
        self,
        clone_id: int,
        credentials: List[int],
    ) -> None:
        """Attach the requested credentials to every eligible job node on the clone.

        Eligible = unified_job_type == 'job'. project_update / inventory_update /
        workflow_approval / nested workflow_job nodes are skipped — they don't
        accept job-template credentials.

        If a node already has a credential of the same credential_type (e.g. the
        user pre-bound one on the source template), we leave it alone rather
        than stack a second one of the same type. AWX rejects duplicate-type
        credentials on a single node and the user's static binding takes
        precedence by design.
        """
        nodes = self._wait_for_clone_nodes(clone_id)

        # `unified_job_type` lives in summary_fields when AWX has expanded it;
        # for safety we accept either the explicit 'job' marker or a populated
        # unified_job_template FK with no contradicting type. project_update /
        # inventory_source / workflow_job / workflow_approval all set a
        # non-'job' type explicitly, so they're filtered out.
        eligible_node_ids = []
        for n in nodes:
            if not n.get('unified_job_template'):
                continue  # approval node or unattached
            ujt_type = (
                n.get('summary_fields', {}).get('unified_job_template', {}).get('unified_job_type')
            )
            if ujt_type and ujt_type != 'job':
                continue  # workflow_job / project_update / inventory_source / system_job
            eligible_node_ids.append(n['id'])

        if not eligible_node_ids:
            logger.warning(
                f'Clone {clone_id} has no job-template nodes '
                f'(total nodes returned: {len(nodes)}); credentials skipped.'
            )
            return
        if not credentials:
            return

        cred_types: Dict[int, int] = {}
        for cred_id in credentials:
            ok, cred_data, err = self.awx_client.get_credential(cred_id)
            if not ok:
                raise AWXConnectionError(f'Failed to fetch credential {cred_id}: {err}')
            cred_types[cred_id] = cred_data.get('credential_type')

        for node_id in eligible_node_ids:
            ok, existing, err = self.awx_client.list_node_credentials(node_id)
            if not ok:
                logger.warning('Skipping clone node %s (list credentials failed): %s', node_id, err)
                continue
            existing_types = {c.get('credential_type') for c in existing}

            for cred_id, cred_type in cred_types.items():
                if cred_type in existing_types:
                    logger.info(
                        f'Clone node {node_id} already has a credential of type '
                        f'{cred_type}; respecting user binding'
                    )
                    continue
                ok, _, err = self.awx_client.associate_node_credential(
                    node_id,
                    cred_id,
                )
                if not ok:
                    raise AWXConnectionError(
                        f'Failed to associate credential {cred_id} on clone node {node_id}: {err}'
                    )

    def _delete_clone_safely(self, clone_id: int) -> None:
        """Best-effort clone deletion. Failures are logged; reaper retries."""
        ok, err = self.awx_client.delete_workflow_template(clone_id)
        if not ok:
            logger.warning('Failed to delete workflow clone %s: %s', clone_id, err)

    @staticmethod
    def _build_clone_name(request_id: uuid.UUID) -> str:
        # AWX template name limit is 512 chars — the prefix + two short hashes
        # leaves comfortable margin and keeps clones grep-able in the AWX UI.
        # request_id prefix lets operators correlate a clone to its Fabrik
        # request without joining DBs.
        return f'{_CLONE_NAME_PREFIX}{request_id.hex[:8]}_{uuid.uuid4().hex[:8]}'

    def _create_execution_record(
        self,
        request: AutomationRequest,
        template: AutomationTemplate,
        awx_job_id: int,
        awx_job_url: str,
        execution_mode: str,
        row_number: Optional[int],
        batch_number: Optional[int],
        row_range: Dict[str, int],
        metadata: Dict[str, Any],
        clone_template_id: Optional[int] = None,
        relaunch_of_execution_id: Optional[uuid.UUID] = None,
    ) -> AutomationExecution:
        try:
            relaunch_of, relaunch_count = self._resolve_relaunch_chain(
                relaunch_of_execution_id,
            )
            execution = AutomationExecution.objects.create(
                automation_request=request,
                awx_connection=request.awx_connection,
                awx_job_id=str(awx_job_id),
                awx_job_url=awx_job_url,
                status=self.STATUS_PENDING,
                execution_mode=execution_mode,
                row_number=row_number,
                batch_number=batch_number,
                row_range=row_range,
                execution_metadata=metadata,
                clone_template_id=clone_template_id,
                relaunch_of=relaunch_of,
                relaunch_count=relaunch_count,
                started_at=timezone.now(),
            )

            logger.info(f'Created execution record {execution.id} for job {awx_job_id}')

            # Start real-time output streaming via Celery task
            try:
                from awx.tasks import stream_job_output

                stream_job_output.delay(str(execution.id), poll_interval=1.0)

                logger.info(
                    f'Queued output streaming for execution {execution.id} (job {awx_job_id})'
                )
            except Exception as e:
                logger.warning(
                    f'Failed to queue output streaming for execution {execution.id}: {str(e)}'
                )
                # Don't fail execution creation if streaming fails

            return execution

        except Exception:
            logger.exception('Error creating execution record')
            raise

    @staticmethod
    def _resolve_relaunch_chain(
        relaunch_of_execution_id: Optional[uuid.UUID],
    ) -> Tuple[Optional[AutomationExecution], int]:
        """Resolve relaunch_of FK + relaunch_count for a new execution record.

        Returns (None, 0) for a fresh launch. For a relaunch, fetches the
        previous execution and bumps the chain counter. If the previous
        execution disappeared between request and write, falls back to a
        fresh launch — the new execution is still valid, just unlinked.
        """
        if not relaunch_of_execution_id:
            return None, 0
        try:
            previous = AutomationExecution.objects.get(id=relaunch_of_execution_id)
        except AutomationExecution.DoesNotExist:
            logger.warning(
                f'relaunch_of execution {relaunch_of_execution_id} no longer exists; '
                f'creating unlinked execution'
            )
            return None, 0
        return previous, previous.relaunch_count + 1

    def _validate_input_data(self, input_data: Dict, table_schemas: List[Dict]) -> None:
        try:
            # Use DataTransformer for validation
            is_valid, errors = self.data_transformer.validate_against_schema(
                input_data, table_schemas
            )

            if not is_valid:
                error_msg = f'Input data validation failed: {"; ".join(errors)}'
                raise ValidationError(error_msg)

        except ValidationError:
            raise
        except Exception as e:
            logger.exception('Error validating input data')
            raise ValidationError(f'Validation error: {str(e)}')

    def _configure_awx_client(self, awx_connection: AWXConnection) -> None:
        # Fresh client per call — prevents credential leakage between concurrent executions.
        # Also runs a connection test to fail fast before launching any jobs.
        try:
            self.awx_client = AWXClient.for_connection(awx_connection)

            # Pre-flight connection check - fail fast before launching any jobs
            success, error, metadata = self.awx_client.test_connection()
            if not success:
                raise AWXConnectionError(
                    f"AWX connection '{awx_connection.name}' is not reachable: {error}"
                )

            logger.info(
                f'AWX client ready for connection: {awx_connection.name} '
                f'(version: {metadata.get("version", "unknown")})'
            )

        except AWXConnectionError:
            raise
        except Exception as e:
            error_msg = f'Failed to configure AWX client: {str(e)}'
            logger.exception(error_msg)
            raise AWXConnectionError(error_msg)
