"""AWX model factories for testing"""

import factory
from factory.django import DjangoModelFactory
from awx.models import (
    AWXConnection,
    TemplateCategory,
    AutomationTemplate,
    AutomationRequest,
    AutomationExecution,
)
from .user_factory import UserFactory


class AWXConnectionFactory(DjangoModelFactory):
    """Factory for creating test AWX connections"""

    class Meta:
        model = AWXConnection

    name = factory.Sequence(lambda n: f'AWX Connection {n}')
    description = factory.Faker('sentence')
    url = 'https://test-awx.example.com'
    auth_type = AWXConnection.AUTH_TYPE_TOKEN
    verify_ssl = True
    timeout = 30
    created_by = factory.SubFactory(UserFactory)
    is_public = False

    @factory.post_generation
    def token(self, create, extracted, **kwargs):
        """Set encrypted token after creation"""
        if not create:
            return

        token = extracted if extracted else 'test_awx_token_12345'
        self.set_token(token)
        self.save()

    @factory.post_generation
    def shared_with(self, create, extracted, **kwargs):
        """Add users to shared_with after creation"""
        if not create:
            return

        if extracted:
            for user in extracted:
                self.shared_with.add(user)


class PublicAWXConnectionFactory(AWXConnectionFactory):
    """Factory for creating public AWX connections"""

    is_public = True


class TemplateCategoryFactory(DjangoModelFactory):
    """Factory for creating template categories"""

    class Meta:
        model = TemplateCategory

    name = factory.Sequence(lambda n: f'Category {n}')
    description = factory.Faker('sentence')
    color = '#6366f1'
    icon = 'folder'
    is_system = False
    created_by = factory.SubFactory(UserFactory)


class AutomationTemplateFactory(DjangoModelFactory):
    """Factory for creating automation templates"""

    class Meta:
        model = AutomationTemplate

    name = factory.Sequence(lambda n: f'Template {n}')
    description = factory.Faker('sentence')
    awx_connection = factory.SubFactory(AWXConnectionFactory)
    awx_template_id = factory.Sequence(lambda n: n + 1)
    awx_type = AutomationTemplate.AWX_TYPE_JOB
    awx_template_name = factory.Sequence(lambda n: f'AWX Template {n}')
    category = factory.SubFactory(TemplateCategoryFactory)
    created_by = factory.SubFactory(UserFactory)


class ApprovalRequiredTemplateFactory(AutomationTemplateFactory):
    """Kept for test compatibility — approval workflow removed in migration 0016."""


class AutomationRequestFactory(DjangoModelFactory):
    """Factory for creating automation requests"""

    class Meta:
        model = AutomationRequest

    title = factory.Sequence(lambda n: f'Request {n}')
    description = factory.Faker('sentence')
    template = factory.SubFactory(AutomationTemplateFactory)
    awx_connection = factory.LazyAttribute(lambda obj: obj.template.awx_connection)
    requested_by = factory.SubFactory(UserFactory)
    status = AutomationRequest.STATUS_PENDING
    input_data = {}
    metadata = {}


class PendingApprovalRequestFactory(AutomationRequestFactory):
    """Factory for requests pending approval"""

    status = AutomationRequest.STATUS_PENDING


class ApprovedRequestFactory(AutomationRequestFactory):
    """Factory for approved requests"""

    status = AutomationRequest.STATUS_RUNNING


class AutomationExecutionFactory(DjangoModelFactory):
    """Factory for creating automation executions"""

    class Meta:
        model = AutomationExecution

    automation_request = factory.SubFactory(AutomationRequestFactory)
    awx_connection = factory.LazyAttribute(lambda obj: obj.automation_request.awx_connection)
    awx_job_id = factory.Sequence(lambda n: n + 1000)
    status = AutomationExecution.STATUS_PENDING
    execution_mode = 'bulk'
    batch_number = 1


class RunningExecutionFactory(AutomationExecutionFactory):
    """Factory for running executions"""

    status = AutomationExecution.STATUS_RUNNING


class SuccessfulExecutionFactory(AutomationExecutionFactory):
    """Factory for successful executions"""

    status = AutomationExecution.STATUS_SUCCESSFUL


class FailedExecutionFactory(AutomationExecutionFactory):
    """Factory for failed executions"""

    status = AutomationExecution.STATUS_FAILED
