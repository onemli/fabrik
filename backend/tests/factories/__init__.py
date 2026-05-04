"""Test factories for generating test data"""
from .user_factory import UserFactory, AdminUserFactory, StaffUserFactory
from .apic_factory import APICConnectionFactory, PublicAPICConnectionFactory, CiscoSandboxAPICFactory
from .query_factory import (
    SavedQueryFactory,
    TimeMachineEnabledQueryFactory,
    TemplateQueryFactory,
    ScheduledTaskFactory,
    HourlyScheduledTaskFactory,
    WeeklyScheduledTaskFactory,
    MonthlyScheduledTaskFactory,
    OnceScheduledTaskFactory,
    PausedScheduledTaskFactory,
    CategoryFactory,
)
from .awx_factory import (
    AWXConnectionFactory,
    PublicAWXConnectionFactory,
    TemplateCategoryFactory,
    AutomationTemplateFactory,
    ApprovalRequiredTemplateFactory,
    AutomationRequestFactory,
    PendingApprovalRequestFactory,
    ApprovedRequestFactory,
    AutomationExecutionFactory,
    RunningExecutionFactory,
    SuccessfulExecutionFactory,
    FailedExecutionFactory,
)

__all__ = [
    # User factories
    'UserFactory',
    'AdminUserFactory',
    'StaffUserFactory',
    # APIC factories
    'APICConnectionFactory',
    'PublicAPICConnectionFactory',
    'CiscoSandboxAPICFactory',
    # AWX factories
    'AWXConnectionFactory',
    'PublicAWXConnectionFactory',
    'TemplateCategoryFactory',
    'AutomationTemplateFactory',
    'ApprovalRequiredTemplateFactory',
    'AutomationRequestFactory',
    'PendingApprovalRequestFactory',
    'ApprovedRequestFactory',
    'AutomationExecutionFactory',
    'RunningExecutionFactory',
    'SuccessfulExecutionFactory',
    'FailedExecutionFactory',
    # Query factories
    'SavedQueryFactory',
    'TimeMachineEnabledQueryFactory',
    'TemplateQueryFactory',
    'CategoryFactory',
    # Task factories
    'ScheduledTaskFactory',
    'HourlyScheduledTaskFactory',
    'WeeklyScheduledTaskFactory',
    'MonthlyScheduledTaskFactory',
    'OnceScheduledTaskFactory',
    'PausedScheduledTaskFactory',
]
