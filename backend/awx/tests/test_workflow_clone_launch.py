"""Tests for the ephemeral-clone workflow launch path.

ExecutionEngine clones the user's workflow_job_template per launch, binds
credentials to the clone's nodes, launches the clone, and lets the reaper
delete it after terminal status. These tests pin that contract.
"""

import uuid
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from awx.models import AWXConnection, AutomationTemplate, TemplateCategory
from awx.services.execution_engine import (
    ExecutionEngine,
    LaunchResult,
    _CLONE_NAME_PREFIX,
)

User = get_user_model()


def _node(
    node_id: int,
    unified_job_type: str = 'job',
    fk: int = 100,
    include_summary: bool = True,
) -> dict:
    """Build a workflow_job_template_node payload as AWX returns it.

    `fk` is the unified_job_template FK on the node (None means an unattached
    or approval-only node, which the eligibility filter rejects upfront).
    `include_summary` controls whether AWX has expanded summary_fields yet —
    fresh clones sometimes return the FK without the summary expansion.
    """
    node: dict = {'id': node_id, 'unified_job_template': fk}
    if include_summary:
        node['summary_fields'] = {
            'unified_job_template': {'unified_job_type': unified_job_type},
        }
    return node


class WorkflowCloneLaunchTestCase(TestCase):
    """Cover clone → bind → launch happy path and pre-launch error handling."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='clone-user',
            email='c@example.com',
            password='x',
        )
        self.category = TemplateCategory.objects.create(
            name='Clone Cat',
            created_by=self.user,
        )
        self.connection = AWXConnection.objects.create(
            name='AWX',
            url='https://awx.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN,
            created_by=self.user,
        )
        self.connection.set_token('t')
        self.connection.save()

        self.template = AutomationTemplate.objects.create(
            name='WF Template',
            awx_type=AutomationTemplate.AWX_TYPE_WORKFLOW,
            awx_template_id=777,
            awx_template_name='WF',
            awx_connection=self.connection,
            category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            table_schemas=[{'sheet_name': 'Data', 'columns': []}],
            created_by=self.user,
        )

        self.engine = ExecutionEngine()
        self.client = MagicMock()
        self.engine.awx_client = self.client

        # Reasonable defaults: AWX returns a fresh clone with id=12345.
        self.client.copy_workflow_template.return_value = (
            True,
            {'id': 12345, 'name': 'cloned'},
            None,
        )
        self.client.list_workflow_nodes.return_value = (True, [_node(1)], None)
        self.client.get_credential.return_value = (
            True,
            {'credential_type': 42},
            None,
        )
        self.client.list_node_credentials.return_value = (True, [], None)
        self.client.associate_node_credential.return_value = (True, {}, None)
        self.client.launch_workflow.return_value = (True, {'id': 1001}, None)
        self.client.delete_workflow_template.return_value = (True, None)

        self.request_id = uuid.uuid4()

    # ── Happy path ─────────────────────────────────────────────────────────

    def test_clones_template_with_fabrik_prefixed_name(self):
        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.client.copy_workflow_template.assert_called_once()
        source_id, name = self.client.copy_workflow_template.call_args.args
        self.assertEqual(source_id, 777)
        self.assertTrue(name.startswith(_CLONE_NAME_PREFIX))

    def test_credentials_attached_to_clone_nodes_only(self):
        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        # list_workflow_nodes must be called with the CLONE id, not source.
        self.client.list_workflow_nodes.assert_called_once_with(12345)

    def test_clone_id_returned_in_launch_result(self):
        result = self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.assertTrue(result.success)
        self.assertEqual(result.clone_template_id, 12345)
        self.assertEqual(result.job_data, {'id': 1001})
        self.assertIsNone(result.error)

    def test_clone_kept_on_launch_success_for_reaper(self):
        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        # The clone lives until JobMonitor's terminal-status hook deletes it.
        self.client.delete_workflow_template.assert_not_called()

    def test_launch_called_with_credentials_none(self):
        # Credentials are bound on nodes — passing them again at launch would
        # attach them to the workflow_job too (pointless noise).
        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={'a': 1},
            check_mode=True,
            credentials=[99],
            request_id=self.request_id,
        )
        kwargs = self.client.launch_workflow.call_args.kwargs
        self.assertEqual(kwargs['workflow_template_id'], 12345)
        self.assertEqual(kwargs['extra_vars'], {'a': 1})
        self.assertTrue(kwargs['check_mode'])
        self.assertIsNone(kwargs['credentials'])

    def test_no_credentials_still_clones_and_launches(self):
        result = self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[],
            request_id=self.request_id,
        )
        self.assertTrue(result.success)
        self.client.copy_workflow_template.assert_called_once()
        self.client.associate_node_credential.assert_not_called()
        self.client.launch_workflow.assert_called_once()

    # ── Async copy: nodes appear after a delay ─────────────────────────────
    #
    # AWX's /copy/ endpoint returns the clone id immediately but populates
    # workflow_nodes asynchronously. ExecutionEngine polls until the nodes
    # show up before binding credentials — the bug we fixed had us binding to
    # an empty clone, leaving downstream nodes without apic_host injection.

    def test_polls_until_nodes_appear(self):
        # First two list_workflow_nodes calls return empty (AWX still copying);
        # third call returns the populated set. Bind must run on those nodes.
        self.client.list_workflow_nodes.side_effect = [
            (True, [], None),
            (True, [], None),
            (True, [_node(1), _node(2)], None),
        ]

        with patch('awx.services.execution_engine.time.sleep') as mock_sleep:
            self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )

        # Polled three times, slept twice between attempts.
        self.assertEqual(self.client.list_workflow_nodes.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)
        # Bind ran on both nodes once they showed up.
        bound_node_ids = sorted(
            call.args[0] for call in self.client.associate_node_credential.call_args_list
        )
        self.assertEqual(bound_node_ids, [1, 2])

    def test_polling_returns_immediately_when_nodes_present(self):
        # First call already returns nodes — no polling needed.
        self.client.list_workflow_nodes.return_value = (
            True,
            [_node(1), _node(2), _node(3)],
            None,
        )

        with patch('awx.services.execution_engine.time.sleep') as mock_sleep:
            self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )

        self.assertEqual(self.client.list_workflow_nodes.call_count, 1)
        mock_sleep.assert_not_called()

    def test_polling_gives_up_after_max_attempts(self):
        # AWX never populates nodes (severe bug or permission issue).
        # Engine logs a warning and proceeds with launch — better to launch
        # an empty workflow than crash the request entirely.
        self.client.list_workflow_nodes.return_value = (True, [], None)

        with patch('awx.services.execution_engine.time.sleep') as mock_sleep:
            result = self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )

        # Polled the configured max number of times.
        self.assertEqual(
            self.client.list_workflow_nodes.call_count,
            self.engine.CLONE_NODE_POLL_ATTEMPTS,
        )
        # Slept between every attempt (n-1 sleeps for n calls is fine; the
        # implementation sleeps after each attempt for simplicity, so we
        # accept either count as long as it matches the loop body).
        self.assertEqual(
            mock_sleep.call_count,
            self.engine.CLONE_NODE_POLL_ATTEMPTS,
        )
        # No bind happened — but launch still ran and returned success.
        self.client.associate_node_credential.assert_not_called()
        self.client.launch_workflow.assert_called_once()
        self.assertTrue(result.success)

    def test_polling_propagates_list_nodes_failure(self):
        # If AWX returns an HTTP error during polling, give up immediately
        # and let the caller's try/finally reap the clone.
        self.client.list_workflow_nodes.return_value = (
            False,
            [],
            'HTTP 500 Server Error',
        )

        with patch('awx.services.execution_engine.time.sleep'):
            with self.assertRaises(Exception) as ctx:
                self.engine._launch_workflow_via_clone(
                    self.template,
                    extra_vars={},
                    check_mode=False,
                    credentials=[99],
                    request_id=self.request_id,
                )

        self.assertIn('HTTP 500', str(ctx.exception))
        # Polled exactly once before bailing — no retry on hard failure.
        self.assertEqual(self.client.list_workflow_nodes.call_count, 1)
        self.client.delete_workflow_template.assert_called_once_with(12345)

    # ── Eligibility filtering ──────────────────────────────────────────────

    def test_associates_only_on_job_template_nodes(self):
        self.client.list_workflow_nodes.return_value = (
            True,
            [
                _node(1, 'job'),
                _node(2, 'project_update'),  # skip
                _node(3, 'inventory_update'),  # skip
                _node(4, 'workflow_approval'),  # skip
                _node(5, 'workflow_job'),  # skip (nested wf)
                _node(6, 'job'),
            ],
            None,
        )

        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )

        called_node_ids = sorted(
            call.args[0] for call in self.client.associate_node_credential.call_args_list
        )
        self.assertEqual(called_node_ids, [1, 6])

    def test_eligibility_skips_node_with_no_unified_job_template_fk(self):
        # Approval nodes and unattached nodes have no unified_job_template FK;
        # they cannot accept credentials and must be skipped before the AWX
        # eligibility query, otherwise associate would 400.
        self.client.list_workflow_nodes.return_value = (
            True,
            [
                _node(1, fk=200),  # has FK → eligible
                _node(2, fk=None),  # approval / unattached → skip
                _node(3, fk=300),  # has FK → eligible
            ],
            None,
        )

        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )

        bound_node_ids = sorted(
            call.args[0] for call in self.client.associate_node_credential.call_args_list
        )
        self.assertEqual(bound_node_ids, [1, 3])

    def test_eligibility_accepts_node_when_summary_fields_missing(self):
        # Fresh clone race condition: AWX has populated `unified_job_template`
        # FK but hasn't expanded summary_fields yet. We must still treat the
        # node as job-eligible — assuming approval would mean no credentials
        # ever bind on warm clones, which is exactly the bug we're fixing.
        self.client.list_workflow_nodes.return_value = (
            True,
            [
                _node(1, include_summary=False),  # FK present, no summary
                _node(2, include_summary=False),
            ],
            None,
        )

        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )

        bound_node_ids = sorted(
            call.args[0] for call in self.client.associate_node_credential.call_args_list
        )
        self.assertEqual(bound_node_ids, [1, 2])

    # ── Same-type credential semantics ─────────────────────────────────────

    def test_skips_node_with_existing_same_type_credential(self):
        self.client.list_node_credentials.return_value = (
            True,
            [{'id': 500, 'credential_type': 42}],
            None,
        )
        self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.client.associate_node_credential.assert_not_called()

    # ── Pre-launch failure → reap clone immediately ────────────────────────

    def test_clone_deleted_when_list_nodes_fails(self):
        self.client.list_workflow_nodes.return_value = (False, [], 'HTTP 500')
        with self.assertRaises(Exception):
            self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )
        self.client.delete_workflow_template.assert_called_once_with(12345)
        self.client.launch_workflow.assert_not_called()

    def test_clone_deleted_when_get_credential_fails(self):
        self.client.get_credential.return_value = (False, {}, 'HTTP 404')
        with self.assertRaises(Exception):
            self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )
        self.client.delete_workflow_template.assert_called_once_with(12345)

    def test_clone_deleted_when_associate_fails(self):
        self.client.associate_node_credential.return_value = (
            False,
            {},
            'HTTP 500',
        )
        with self.assertRaises(Exception):
            self.engine._launch_workflow_via_clone(
                self.template,
                extra_vars={},
                check_mode=False,
                credentials=[99],
                request_id=self.request_id,
            )
        self.client.delete_workflow_template.assert_called_once_with(12345)

    def test_clone_deleted_when_launch_workflow_fails(self):
        self.client.launch_workflow.return_value = (False, None, 'HTTP 400')
        result = self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.assertFalse(result.success)
        self.assertEqual(result.error, 'HTTP 400')
        self.client.delete_workflow_template.assert_called_once_with(12345)

    # ── Copy failure → no clone to delete ──────────────────────────────────

    def test_copy_failure_returns_error_without_calling_anything_else(self):
        self.client.copy_workflow_template.return_value = (
            False,
            {},
            'HTTP 403',
        )
        result = self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.assertFalse(result.success)
        self.assertIn('Failed to clone workflow', result.error)
        self.client.list_workflow_nodes.assert_not_called()
        self.client.launch_workflow.assert_not_called()
        self.client.delete_workflow_template.assert_not_called()

    def test_copy_returns_clone_without_id_is_handled(self):
        self.client.copy_workflow_template.return_value = (
            True,
            {'name': 'no-id-here'},
            None,
        )
        result = self.engine._launch_workflow_via_clone(
            self.template,
            extra_vars={},
            check_mode=False,
            credentials=[99],
            request_id=self.request_id,
        )
        self.assertFalse(result.success)
        self.assertIn('id', result.error)


class LaunchAwxJobDispatchTestCase(TestCase):
    """Verify _launch_awx_job dispatches workflow vs job correctly."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='dispatch',
            email='d@example.com',
            password='x',
        )
        self.category = TemplateCategory.objects.create(
            name='Dispatch',
            created_by=self.user,
        )
        self.connection = AWXConnection.objects.create(
            name='AWX2',
            url='https://awx2.example.com',
            auth_type=AWXConnection.AUTH_TYPE_TOKEN,
            created_by=self.user,
        )
        self.connection.set_token('t2')
        self.connection.save()

        self.workflow_template = AutomationTemplate.objects.create(
            name='WF',
            awx_type=AutomationTemplate.AWX_TYPE_WORKFLOW,
            awx_template_id=999,
            awx_template_name='WF',
            awx_connection=self.connection,
            category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            table_schemas=[{'sheet_name': 'Data', 'columns': []}],
            created_by=self.user,
        )
        self.job_template = AutomationTemplate.objects.create(
            name='Job',
            awx_type=AutomationTemplate.AWX_TYPE_JOB,
            awx_template_id=888,
            awx_template_name='Job',
            awx_connection=self.connection,
            category=self.category,
            execution_mode=AutomationTemplate.EXECUTION_MODE_BULK,
            table_schemas=[{'sheet_name': 'Data', 'columns': []}],
            created_by=self.user,
        )
        self.engine = ExecutionEngine()
        self.engine.awx_client = MagicMock()

    def test_workflow_with_credentials_uses_clone_path(self):
        with patch.object(
            self.engine,
            '_launch_workflow_via_clone',
            return_value=LaunchResult(True, {'id': 2}, None, clone_template_id=42),
        ) as clone_path:
            result = self.engine._launch_awx_job(
                self.workflow_template,
                extra_vars={'k': 'v'},
                request_id=uuid.uuid4(),
                check_mode=False,
                credentials=[42],
            )
        self.assertTrue(result.success)
        self.assertEqual(result.clone_template_id, 42)
        clone_path.assert_called_once()
        self.engine.awx_client.launch_workflow.assert_not_called()

    def test_workflow_without_credentials_still_uses_clone_path(self):
        # The clone path is uniform for workflows now — credentials don't
        # change which code branch runs.
        with patch.object(
            self.engine,
            '_launch_workflow_via_clone',
            return_value=LaunchResult(True, {'id': 3}, None, clone_template_id=43),
        ) as clone_path:
            result = self.engine._launch_awx_job(
                self.workflow_template,
                extra_vars={},
                request_id=uuid.uuid4(),
                check_mode=False,
                credentials=None,
            )
        self.assertTrue(result.success)
        clone_path.assert_called_once()

    def test_job_template_does_not_clone(self):
        self.engine.awx_client.launch_job.return_value = (
            True,
            {'id': 555},
            None,
        )
        result = self.engine._launch_awx_job(
            self.job_template,
            extra_vars={},
            request_id=uuid.uuid4(),
            check_mode=False,
            credentials=[1],
        )
        self.assertTrue(result.success)
        self.assertIsNone(result.clone_template_id)
        self.engine.awx_client.launch_job.assert_called_once()

    def test_unknown_template_type_returns_error(self):
        self.workflow_template.awx_type = 'something_else'
        self.workflow_template.save(update_fields=['awx_type'])
        result = self.engine._launch_awx_job(
            self.workflow_template,
            extra_vars={},
            request_id=uuid.uuid4(),
            check_mode=False,
            credentials=None,
        )
        self.assertFalse(result.success)
        self.assertIn('Unknown template type', result.error)
