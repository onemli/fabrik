"""Query model factories"""
import factory
from factory.django import DjangoModelFactory
from datetime import time
from django.utils import timezone
from queries.models import SavedQuery, ScheduledTask, Category
from .user_factory import UserFactory


class CategoryFactory(DjangoModelFactory):
    """Factory for creating test categories"""

    class Meta:
        model = Category
        django_get_or_create = ('name',)

    name = factory.Sequence(lambda n: f'Category {n}')
    description = factory.Faker('sentence')
    color = '#3b82f6'
    icon = 'folder'


class SavedQueryFactory(DjangoModelFactory):
    """Factory for creating test saved queries"""

    class Meta:
        model = SavedQuery

    name = factory.Sequence(lambda n: f'Test Query {n}')
    description = factory.Faker('sentence')

    flow_data = factory.LazyFunction(lambda: {
        'nodes': [
            {
                'id': '1',
                'type': 'class',
                'position': {'x': 100, 'y': 100},
                'data': {'className': 'fvTenant', 'label': 'Tenant'}
            },
            {
                'id': '2',
                'type': 'output',
                'position': {'x': 300, 'y': 100},
                'data': {'enableTimeMachine': False}
            }
        ],
        'edges': [
            {'id': 'e1-2', 'source': '1', 'target': '2'}
        ]
    })

    generated_query = '/api/class/fvTenant.json'

    is_template = False
    variables = None
    enable_time_machine = False

    category = factory.SubFactory(CategoryFactory)
    tags = factory.Faker('words', nb=3)

    created_by = factory.SubFactory(UserFactory)
    is_public = False

    execution_count = 0
    last_executed_at = None

    @factory.post_generation
    def shared_with(self, create, extracted, **kwargs):
        """Add users to shared_with after creation"""
        if not create:
            return

        if extracted:
            for user in extracted:
                self.shared_with.add(user)

    @factory.post_generation
    def favorited_by(self, create, extracted, **kwargs):
        """Add users to favorited_by after creation"""
        if not create:
            return

        if extracted:
            for user in extracted:
                self.favorited_by.add(user)


class TimeMachineEnabledQueryFactory(SavedQueryFactory):
    """Factory for creating queries with Time Machine enabled"""

    enable_time_machine = True

    flow_data = factory.LazyFunction(lambda: {
        'nodes': [
            {
                'id': '1',
                'type': 'class',
                'position': {'x': 100, 'y': 100},
                'data': {'className': 'fvTenant', 'label': 'Tenant'}
            },
            {
                'id': '2',
                'type': 'output',
                'position': {'x': 300, 'y': 100},
                'data': {'enableTimeMachine': True}
            }
        ],
        'edges': [
            {'id': 'e1-2', 'source': '1', 'target': '2'}
        ]
    })


class TemplateQueryFactory(SavedQueryFactory):
    """Factory for creating template queries"""

    is_template = True

    variables = factory.LazyFunction(lambda: [
        {
            'id': 'var1',
            'label': 'Tenant Name',
            'type': 'text',
            'binding': {'nodeId': '1', 'field': 'filter.name'}
        }
    ])


class ScheduledTaskFactory(DjangoModelFactory):
    """Factory for creating test scheduled tasks"""

    class Meta:
        model = ScheduledTask

    name = factory.Sequence(lambda n: f'Scheduled Task {n}')
    description = factory.Faker('sentence')

    priority = ScheduledTask.PRIORITY_MEDIUM
    order = 0

    created_by = factory.SubFactory(UserFactory)
    saved_query = factory.SubFactory(SavedQueryFactory)

    apic_connection_ids = factory.LazyFunction(lambda: [1])
    variable_values = None

    retry_enabled = False
    retry_count = 3
    retry_interval_minutes = 5

    email_on_success = False
    email_on_failure = True
    email_recipients = factory.LazyFunction(lambda: [])

    log_retention_days = 30

    frequency = ScheduledTask.FREQ_DAILY
    minute_of_hour = None
    time_of_day = time(9, 0)
    day_of_week = None
    day_of_month = None
    scheduled_datetime = None
    timezone = 'UTC'

    status = ScheduledTask.STATUS_ACTIVE

    last_run_at = None
    next_run_at = factory.LazyFunction(lambda: timezone.now() + timezone.timedelta(hours=1))

    execution_count = 0
    success_count = 0
    failure_count = 0


class HourlyScheduledTaskFactory(ScheduledTaskFactory):
    """Factory for hourly scheduled tasks"""

    frequency = ScheduledTask.FREQ_HOURLY
    minute_of_hour = 0
    time_of_day = None


class WeeklyScheduledTaskFactory(ScheduledTaskFactory):
    """Factory for weekly scheduled tasks"""

    frequency = ScheduledTask.FREQ_WEEKLY
    day_of_week = 'monday'
    time_of_day = time(9, 0)


class MonthlyScheduledTaskFactory(ScheduledTaskFactory):
    """Factory for monthly scheduled tasks"""

    frequency = ScheduledTask.FREQ_MONTHLY
    day_of_month = 1
    time_of_day = time(9, 0)


class OnceScheduledTaskFactory(ScheduledTaskFactory):
    """Factory for one-time scheduled tasks"""

    frequency = ScheduledTask.FREQ_ONCE
    scheduled_datetime = factory.LazyFunction(lambda: timezone.now() + timezone.timedelta(hours=1))
    time_of_day = None


class PausedScheduledTaskFactory(ScheduledTaskFactory):
    """Factory for paused scheduled tasks"""

    status = ScheduledTask.STATUS_PAUSED
