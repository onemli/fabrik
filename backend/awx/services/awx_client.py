# awx/services/awx_client.py
#
# Low-level HTTP client for the AWX REST API v2. Each instance owns its own
# requests.Session so concurrent requests against different AWX connections
# don't share cookies or auth headers.
#
# Typical usage pattern:
#   client = AWXClient.for_connection(connection_model_instance)
#   success, data, error = client.launch_job(template_id, extra_vars)
#
# All public methods return (success: bool, data: dict|str, error: str|None)
# so callers never need to unwrap exceptions for expected error cases.
# Unexpected exceptions propagate normally and are caught at the task layer.
import json
import requests
from typing import Optional, Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)


class AWXClient:
    # One instance per connection — don't share across threads.
    # Use for_connection() factory; constructor is for manual test setup.

    def __init__(self):
        self.session = requests.Session()
        self.base_url = None
        self.token = None
        self.verify_ssl = True
        self.timeout = 30

    @classmethod
    def for_connection(cls, awx_connection) -> 'AWXClient':
        # Reads auth_type to pick get_token() or get_password() — both Fernet-decrypted at call time.
        client = cls()

        # Determine auth type from connection model
        auth_type = getattr(awx_connection, 'auth_type', 'token')

        if auth_type == 'basic' and hasattr(awx_connection, 'get_password'):
            client.configure(
                url=awx_connection.url,
                username=awx_connection.username,
                password=awx_connection.get_password(),
                verify_ssl=awx_connection.verify_ssl,
                timeout=awx_connection.timeout,
            )
        else:
            token = awx_connection.get_token()
            client.configure(
                url=awx_connection.url,
                token=token,
                verify_ssl=awx_connection.verify_ssl,
                timeout=awx_connection.timeout,
            )

        return client

    def configure(
        self,
        url: str,
        token: str = None,
        verify_ssl: bool = True,
        timeout: int = 30,
        username: str = None,
        password: str = None,
    ):
        # Token auth (preferred) or basic auth (username + password) fallback.
        self.base_url = url.rstrip('/')
        self.verify_ssl = verify_ssl
        self.timeout = timeout

        if token:
            self.token = token
            self.session.headers.update(
                {
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                }
            )
        elif username and password:
            self.token = None
            self.session.auth = (username, password)
            self.session.headers.update(
                {
                    'Content-Type': 'application/json',
                }
            )
        else:
            raise ValueError("Either 'token' or 'username'+'password' must be provided")

        logger.info(f'AWX Client configured for {self.base_url}')

    def test_connection(self) -> Tuple[bool, Optional[str], Optional[Dict]]:
        if not self.base_url or (not self.token and not self.session.auth):
            return False, 'Client not configured. Call configure() first.', None

        try:
            # Step 1: reachability check (ping is public, no auth needed)
            ping_url = f'{self.base_url}/api/v2/ping/'
            ping_resp = self.session.get(ping_url, verify=self.verify_ssl, timeout=10)

            if ping_resp.status_code != 200:
                error_msg = f'AWX unreachable: HTTP {ping_resp.status_code}'
                logger.error(error_msg)
                return False, error_msg, None

            ping_data = ping_resp.json()

            # Step 2: auth check (/me requires valid credentials)
            me_url = f'{self.base_url}/api/v2/me/'
            me_resp = self.session.get(me_url, verify=self.verify_ssl, timeout=10)

            if me_resp.status_code == 401:
                return False, 'Authentication failed — token is invalid or expired.', None
            if me_resp.status_code == 403:
                return False, 'Authentication failed — insufficient permissions.', None
            if me_resp.status_code != 200:
                error_msg = f'Auth check failed: HTTP {me_resp.status_code}'
                return False, error_msg, None

            logger.info(f'AWX connection test successful: {self.base_url}')
            return (
                True,
                None,
                {
                    'version': ping_data.get('version'),
                    'active_node': ping_data.get('active_node'),
                    'install_uuid': ping_data.get('install_uuid'),
                },
            )

        except requests.exceptions.SSLError as e:
            error_msg = 'SSL certificate verification failed. Try disabling SSL verification.'
            logger.error(f'AWX SSL Error: {str(e)}')
            return False, error_msg, None
        except requests.exceptions.ConnectionError as e:
            error_msg = 'Connection refused - check URL and network connectivity'
            logger.error(f'AWX Connection Error: {str(e)}')
            return False, error_msg, None
        except requests.exceptions.Timeout:
            error_msg = 'Request timeout - AWX is not responding'
            logger.error(f'AWX Timeout: {self.base_url}')
            return False, error_msg, None
        except Exception as e:
            error_msg = f'Unexpected error: {str(e)}'
            logger.exception(f'AWX unexpected error: {error_msg}')
            return False, error_msg, None

    def list_job_templates(
        self, page: int = 1, page_size: int = 50, name_filter: str = None
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/job_templates/'
            params = {'page': page, 'page_size': min(page_size, 200)}

            if name_filter:
                params['name__icontains'] = name_filter

            response = self.session.get(
                url, params=params, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}: {response.text[:200]}'

        except Exception as e:
            logger.exception(f'Error listing job templates: {str(e)}')
            return False, None, str(e)

    def get_job_template(self, template_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/job_templates/{template_id}/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Job template {template_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting job template {template_id}: {str(e)}')
            return False, None, str(e)

    def get_job_template_survey(self, template_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/job_templates/{template_id}/survey_spec/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                # Survey doesn't exist for this template
                logger.info(f'No survey spec found for job template {template_id}')
                return True, {}, None  # Empty survey is valid
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting survey spec for template {template_id}: {str(e)}')
            return False, None, str(e)

    def get_project(self, project_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/projects/{project_id}/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Project {project_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting project {project_id}: {str(e)}')
            return False, None, str(e)

    def launch_job(
        self,
        job_template_id: int,
        extra_vars: Dict = None,
        inventory_id: int = None,
        limit: str = None,
        tags: str = None,
        check_mode: bool = False,
        credentials: list = None,
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/job_templates/{job_template_id}/launch/'

            payload = {}
            if extra_vars:
                payload['extra_vars'] = json.dumps(extra_vars)
            if inventory_id:
                payload['inventory'] = inventory_id
            if limit:
                payload['limit'] = limit
            if tags:
                payload['tags'] = tags
            if check_mode:
                payload['job_type'] = 'check'
            if credentials:
                payload['credentials'] = credentials

            logger.info(f'Launching job template {job_template_id}')

            response = self.session.post(
                url, json=payload, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code in [200, 201]:
                job_data = response.json()
                logger.info(f'Job launched successfully: {job_data.get("id")}')
                return True, job_data, None
            else:
                error_msg = f'Launch failed: HTTP {response.status_code} - {response.text[:500]}'
                logger.error(error_msg)
                return False, None, error_msg

        except Exception as e:
            error_msg = f'Exception during job launch: {str(e)}'
            logger.exception(error_msg)
            return False, None, error_msg

    def get_job_status(self, job_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/jobs/{job_id}/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Job {job_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting job status for {job_id}: {str(e)}')
            return False, None, str(e)

    def get_job_stdout(self, job_id: int, format: str = 'txt') -> Tuple[bool, str, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/jobs/{job_id}/stdout/'
            params = {'format': format}

            response = self.session.get(
                url, params=params, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                if format == 'json':
                    return True, response.json(), None
                else:
                    return True, response.text, None
            else:
                return False, '', f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting stdout for job {job_id}: {str(e)}')
            return False, '', str(e)

    def cancel_job(self, job_id: int) -> Tuple[bool, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/jobs/{job_id}/cancel/'

            logger.info(f'Cancelling job {job_id}')

            response = self.session.post(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code in [200, 202]:
                logger.info(f'Job {job_id} cancelled successfully')
                return True, None
            else:
                error_msg = f'HTTP {response.status_code}: {response.text[:200]}'
                logger.error(f'Failed to cancel job {job_id}: {error_msg}')
                return False, error_msg

        except Exception as e:
            error_msg = str(e)
            logger.exception(f'Error cancelling job {job_id}: {error_msg}')
            return False, error_msg

    def relaunch_job(
        self, job_id: int, is_workflow: bool = False
    ) -> Tuple[bool, Dict, Optional[str]]:
        # AWX /relaunch/ preserves original extra_vars, credentials, and inventory.
        try:
            job_type = 'workflow_jobs' if is_workflow else 'jobs'
            url = f'{self.base_url}/api/v2/{job_type}/{job_id}/relaunch/'

            logger.info('Relaunching %s job %s', job_type, job_id)

            response = self.session.post(url, json={}, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code in [200, 201]:
                job_data = response.json()
                new_job_id = job_data.get('id')
                logger.info('Job %s relaunched → new job %s', job_id, new_job_id)
                return True, job_data, None
            else:
                error_msg = f'HTTP {response.status_code}: {response.text[:200]}'
                logger.error('Failed to relaunch job %s: %s', job_id, error_msg)
                return False, {}, error_msg

        except Exception as e:
            error_msg = str(e)
            logger.exception('Error relaunching job %s: %s', job_id, error_msg)
            return False, {}, error_msg

    def list_credentials(
        self,
        credential_type_id: int = None,
        page: int = 1,
        page_size: int = 50,
        search: str = None,
        name_startswith: str = None,
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/credentials/'
            params = {'page': page, 'page_size': page_size}
            if credential_type_id:
                params['credential_type'] = credential_type_id
            if search:
                params['search'] = search
            if name_startswith:
                params['name__startswith'] = name_startswith

            response = self.session.get(
                url,
                params=params,
                verify=self.verify_ssl,
                timeout=self.timeout,
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error listing credentials: {e}')
            return False, None, str(e)

    def list_credential_types(
        self,
        page: int = 1,
        page_size: int = 50,
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/credential_types/'
            params = {'page': page, 'page_size': page_size}

            response = self.session.get(
                url,
                params=params,
                verify=self.verify_ssl,
                timeout=self.timeout,
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error listing credential types: {e}')
            return False, None, str(e)

    def list_inventories(
        self, page: int = 1, page_size: int = 50
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/inventories/'
            params = {'page': page, 'page_size': page_size}

            response = self.session.get(
                url, params=params, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error listing inventories: {str(e)}')
            return False, None, str(e)

    def get_job_events(
        self, job_id: int, event_type: str = None
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/jobs/{job_id}/job_events/'
            params = {}

            if event_type:
                params['event'] = event_type

            response = self.session.get(
                url, params=params, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting job events for {job_id}: {str(e)}')
            return False, None, str(e)

    def list_workflow_templates(
        self, page: int = 1, page_size: int = 50, name_filter: str = None
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/'
            params = {'page': page, 'page_size': min(page_size, 200)}

            if name_filter:
                params['name__icontains'] = name_filter

            response = self.session.get(
                url, params=params, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code == 200:
                return True, response.json(), None
            else:
                return False, None, f'HTTP {response.status_code}: {response.text[:200]}'

        except Exception as e:
            logger.exception(f'Error listing workflow templates: {str(e)}')
            return False, None, str(e)

    def get_workflow_template(self, template_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{template_id}/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Workflow template {template_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting workflow template {template_id}: {str(e)}')
            return False, None, str(e)

    def get_workflow_nodes(self, workflow_template_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{workflow_template_id}/workflow_nodes/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Workflow template {workflow_template_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting workflow nodes for {workflow_template_id}: {str(e)}')
            return False, None, str(e)

    def get_workflow_template_survey(self, template_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{template_id}/survey_spec/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                # Survey doesn't exist for this workflow template
                logger.info(f'No survey spec found for workflow template {template_id}')
                return True, {}, None  # Empty survey is valid
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(
                f'Error getting survey spec for workflow template {template_id}: {str(e)}'
            )
            return False, None, str(e)

    def list_workflow_nodes(self, workflow_template_id: int) -> Tuple[bool, list, Optional[str]]:
        """List all nodes attached to a workflow_job_template, paginating until exhausted.

        Used by the credential-patching launch path: we need each node's id so we can
        associate the user-selected credential before launch and disassociate after.
        """
        try:
            results: list = []
            next_url = (
                f'{self.base_url}/api/v2/workflow_job_templates/'
                f'{workflow_template_id}/workflow_nodes/?page_size=200'
            )
            while next_url:
                r = self.session.get(next_url, verify=self.verify_ssl, timeout=self.timeout)
                if r.status_code != 200:
                    return False, [], f'HTTP {r.status_code}: {r.text[:200]}'
                data = r.json()
                results.extend(data.get('results') or [])
                nxt = data.get('next')
                if nxt and not nxt.startswith('http'):
                    nxt = f'{self.base_url}{nxt}'
                next_url = nxt
            return True, results, None
        except Exception as e:
            logger.exception(f'Error listing workflow nodes for {workflow_template_id}: {e}')
            return False, [], str(e)

    def list_node_credentials(self, node_id: int) -> Tuple[bool, list, Optional[str]]:
        """List credentials currently associated with a workflow_job_template_node."""
        try:
            url = (
                f'{self.base_url}/api/v2/workflow_job_template_nodes/'
                f'{node_id}/credentials/?page_size=200'
            )
            r = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)
            if r.status_code != 200:
                return False, [], f'HTTP {r.status_code}: {r.text[:200]}'
            return True, r.json().get('results') or [], None
        except Exception as e:
            logger.exception(f'Error listing credentials for node {node_id}: {e}')
            return False, [], str(e)

    def associate_node_credential(
        self, node_id: int, credential_id: int
    ) -> Tuple[bool, dict, Optional[str]]:
        """Attach a credential to a workflow_job_template_node."""
        try:
            url = f'{self.base_url}/api/v2/workflow_job_template_nodes/{node_id}/credentials/'
            r = self.session.post(
                url,
                json={'id': credential_id},
                verify=self.verify_ssl,
                timeout=self.timeout,
            )
            if r.status_code in (200, 201, 204):
                return True, {}, None
            return False, {}, f'HTTP {r.status_code}: {r.text[:200]}'
        except Exception as e:
            logger.exception(f'Error associating cred {credential_id} on node {node_id}: {e}')
            return False, {}, str(e)

    def disassociate_node_credential(
        self, node_id: int, credential_id: int
    ) -> Tuple[bool, dict, Optional[str]]:
        """Detach a credential from a workflow_job_template_node."""
        try:
            url = f'{self.base_url}/api/v2/workflow_job_template_nodes/{node_id}/credentials/'
            r = self.session.post(
                url,
                json={'id': credential_id, 'disassociate': True},
                verify=self.verify_ssl,
                timeout=self.timeout,
            )
            if r.status_code in (200, 201, 204):
                return True, {}, None
            return False, {}, f'HTTP {r.status_code}: {r.text[:200]}'
        except Exception as e:
            logger.exception(f'Error disassociating cred {credential_id} from node {node_id}: {e}')
            return False, {}, str(e)

    def get_credential(self, credential_id: int) -> Tuple[bool, dict, Optional[str]]:
        """Fetch a credential's metadata (used to read its credential_type)."""
        try:
            url = f'{self.base_url}/api/v2/credentials/{credential_id}/'
            r = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)
            if r.status_code == 200:
                return True, r.json(), None
            return False, {}, f'HTTP {r.status_code}: {r.text[:200]}'
        except Exception as e:
            logger.exception(f'Error fetching credential {credential_id}: {e}')
            return False, {}, str(e)

    def launch_workflow(
        self,
        workflow_template_id: int,
        extra_vars: Dict = None,
        check_mode: bool = False,
        credentials: list = None,
    ) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{workflow_template_id}/launch/'

            payload = {}
            if extra_vars:
                payload['extra_vars'] = json.dumps(extra_vars)
            if credentials:
                payload['credentials'] = credentials
            # Note: Workflows inherit check_mode from individual job templates
            # We pass it in extra_vars for jobs to use
            if check_mode:
                payload['extra_vars'] = payload.get('extra_vars', {})
                payload['extra_vars']['ansible_check_mode'] = True

            logger.info(f'Launching workflow template {workflow_template_id}')

            response = self.session.post(
                url, json=payload, verify=self.verify_ssl, timeout=self.timeout
            )

            if response.status_code in [200, 201]:
                workflow_job_data = response.json()
                logger.info(f'Workflow launched successfully: {workflow_job_data.get("id")}')
                return True, workflow_job_data, None
            else:
                error_msg = f'Launch failed: HTTP {response.status_code} - {response.text[:500]}'
                logger.error(error_msg)
                return False, None, error_msg

        except Exception as e:
            error_msg = f'Exception during workflow launch: {str(e)}'
            logger.exception(error_msg)
            return False, None, error_msg

    def get_workflow_job_status(self, workflow_job_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_jobs/{workflow_job_id}/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Workflow job {workflow_job_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting workflow job status for {workflow_job_id}: {str(e)}')
            return False, None, str(e)

    def get_workflow_job_nodes(self, workflow_job_id: int) -> Tuple[bool, Any, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_jobs/{workflow_job_id}/workflow_nodes/'
            response = self.session.get(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code == 200:
                return True, response.json(), None
            elif response.status_code == 404:
                return False, None, f'Workflow job {workflow_job_id} not found'
            else:
                return False, None, f'HTTP {response.status_code}'

        except Exception as e:
            logger.exception(f'Error getting workflow job nodes for {workflow_job_id}: {str(e)}')
            return False, None, str(e)

    # ── Ephemeral workflow template lifecycle ─────────────────────────────────
    #
    # Fabrik launches a fresh clone of the user's workflow_job_template per run
    # (ExecutionEngine._launch_workflow_via_clone). These three methods are the
    # AWX-side primitives for that pattern: copy → bind credentials → launch →
    # delete (after terminal). The reaper relies on list-by-prefix to sweep
    # any clones whose deletion hook missed.

    def copy_workflow_template(
        self,
        source_id: int,
        new_name: str,
    ) -> Tuple[bool, Dict[str, Any], Optional[str]]:
        """Clone an existing workflow_job_template via AWX's official copy endpoint.

        AWX copies all child workflow_job_template_nodes and their relationships,
        so callers don't need to recreate the graph manually.
        """
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{source_id}/copy/'
            response = self.session.post(
                url,
                json={'name': new_name},
                verify=self.verify_ssl,
                timeout=self.timeout,
            )
            if response.status_code in (200, 201):
                return True, response.json(), None
            return False, {}, f'HTTP {response.status_code}: {response.text[:200]}'
        except Exception as e:
            logger.exception(f'Error copying workflow template {source_id}: {e}')
            return False, {}, str(e)

    def delete_workflow_template(self, template_id: int) -> Tuple[bool, Optional[str]]:
        """Delete a workflow_job_template. 404 is treated as success (idempotent)."""
        try:
            url = f'{self.base_url}/api/v2/workflow_job_templates/{template_id}/'
            response = self.session.delete(
                url,
                verify=self.verify_ssl,
                timeout=self.timeout,
            )
            if response.status_code in (204, 202, 200):
                return True, None
            if response.status_code == 404:
                return True, None
            return False, f'HTTP {response.status_code}: {response.text[:200]}'
        except Exception as e:
            logger.exception(f'Error deleting workflow template {template_id}: {e}')
            return False, str(e)

    def list_workflow_templates_by_prefix(
        self,
        prefix: str,
        page_size: int = 200,
    ) -> Tuple[bool, list, Optional[str]]:
        """List all workflow_job_templates whose name starts with the given prefix.

        Paginates until the cursor is exhausted. Used by the orphan reaper.
        """
        try:
            results: list = []
            next_url = (
                f'{self.base_url}/api/v2/workflow_job_templates/'
                f'?name__startswith={prefix}&page_size={page_size}'
            )
            while next_url:
                r = self.session.get(
                    next_url,
                    verify=self.verify_ssl,
                    timeout=self.timeout,
                )
                if r.status_code != 200:
                    return False, [], f'HTTP {r.status_code}: {r.text[:200]}'
                data = r.json()
                results.extend(data.get('results') or [])
                nxt = data.get('next')
                if nxt and not nxt.startswith('http'):
                    nxt = f'{self.base_url}{nxt}'
                next_url = nxt
            return True, results, None
        except Exception as e:
            logger.exception(f"Error listing workflow templates by prefix '{prefix}': {e}")
            return False, [], str(e)

    def cancel_workflow_job(self, workflow_job_id: int) -> Tuple[bool, Optional[str]]:
        try:
            url = f'{self.base_url}/api/v2/workflow_jobs/{workflow_job_id}/cancel/'

            logger.info(f'Cancelling workflow job {workflow_job_id}')

            response = self.session.post(url, verify=self.verify_ssl, timeout=self.timeout)

            if response.status_code in [200, 202]:
                logger.info(f'Workflow job {workflow_job_id} cancelled successfully')
                return True, None
            else:
                error_msg = f'HTTP {response.status_code}: {response.text[:200]}'
                logger.error(f'Failed to cancel workflow job {workflow_job_id}: {error_msg}')
                return False, error_msg

        except Exception as e:
            error_msg = str(e)
            logger.exception(f'Error cancelling workflow job {workflow_job_id}: {error_msg}')
            return False, error_msg
