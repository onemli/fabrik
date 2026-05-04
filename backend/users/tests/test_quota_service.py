"""
QuotaService Tests — Resource Limits & Feature Flags

Tests cover:
  - Default quota for users without group quotas
  - Superuser always gets unlimited
  - Multi-group merge (most permissive wins)
  - 0 = unlimited beats any number
  - Boolean feature flags: True beats False
  - check_can_create enforcement
  - check_feature enforcement
"""
from django.test import TestCase
from django.contrib.auth.models import User, Group

from users.models import GroupQuota
from users.quota_service import QuotaService


class QuotaServiceDefaultsTest(TestCase):
    """Tests for users without any group quota"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='noquota', email='noquota@test.com', password='pass123!'
        )

    def test_default_quota_all_unlimited(self):
        """User without group quota gets global defaults (all unlimited)"""
        quota = QuotaService.get_effective_quota(self.user)
        self.assertEqual(quota['max_saved_queries'], 0)  # 0 = unlimited
        self.assertTrue(quota['can_create_queries'])
        self.assertTrue(quota['can_use_awx'])

    def test_superuser_always_unlimited(self):
        """Superuser gets unlimited everything regardless of group quotas"""
        self.user.is_superuser = True
        self.user.save()
        quota = QuotaService.get_effective_quota(self.user)
        self.assertEqual(quota['max_saved_queries'], 0)
        self.assertTrue(quota['can_use_awx'])


class QuotaServiceGroupTest(TestCase):
    """Tests for group quota resolution"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='quotauser', email='quotauser@test.com', password='pass123!'
        )

    def test_single_group_quota(self):
        """Single group quota is applied correctly"""
        group = Group.objects.create(name='Limited')
        self.user.groups.add(group)
        GroupQuota.objects.create(
            group=group,
            max_saved_queries=10,
            max_awx_concurrent=3,
            can_use_time_machine=False,
        )

        quota = QuotaService.get_effective_quota(self.user)
        self.assertEqual(quota['max_saved_queries'], 10)
        self.assertEqual(quota['max_awx_concurrent'], 3)
        self.assertFalse(quota['can_use_time_machine'])

    def test_multi_group_most_permissive_numeric(self):
        """With multiple groups, the highest numeric limit wins"""
        g1 = Group.objects.create(name='Group1')
        g2 = Group.objects.create(name='Group2')
        self.user.groups.add(g1, g2)

        GroupQuota.objects.create(group=g1, max_saved_queries=10, max_awx_concurrent=2)
        GroupQuota.objects.create(group=g2, max_saved_queries=50, max_awx_concurrent=5)

        quota = QuotaService.get_effective_quota(self.user)
        self.assertEqual(quota['max_saved_queries'], 50)  # max wins
        self.assertEqual(quota['max_awx_concurrent'], 5)

    def test_multi_group_zero_beats_everything(self):
        """0 (unlimited) in any group overrides all other limits"""
        g1 = Group.objects.create(name='Limited')
        g2 = Group.objects.create(name='Unlimited')
        self.user.groups.add(g1, g2)

        GroupQuota.objects.create(group=g1, max_saved_queries=10)
        GroupQuota.objects.create(group=g2, max_saved_queries=0)  # unlimited

        quota = QuotaService.get_effective_quota(self.user)
        self.assertEqual(quota['max_saved_queries'], 0)  # unlimited wins

    def test_multi_group_true_beats_false_for_features(self):
        """Boolean feature flags: True in any group beats False"""
        g1 = Group.objects.create(name='NoAWX')
        g2 = Group.objects.create(name='WithAWX')
        self.user.groups.add(g1, g2)

        GroupQuota.objects.create(group=g1, can_use_awx=False, can_use_time_machine=False)
        GroupQuota.objects.create(group=g2, can_use_awx=True, can_use_time_machine=False)

        quota = QuotaService.get_effective_quota(self.user)
        self.assertTrue(quota['can_use_awx'])  # True wins
        self.assertFalse(quota['can_use_time_machine'])  # both False = False


class QuotaServiceFeatureCheckTest(TestCase):
    """Tests for check_feature()"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='featureuser', email='feat@test.com', password='pass123!'
        )

    def test_feature_allowed_by_default(self):
        """Features are allowed when no group quota exists"""
        allowed, reason = QuotaService.check_feature(self.user, 'can_use_awx')
        self.assertTrue(allowed)
        self.assertEqual(reason, '')

    def test_feature_denied_by_quota(self):
        """Features are denied when group quota disables them"""
        group = Group.objects.create(name='NoAWXGroup')
        self.user.groups.add(group)
        GroupQuota.objects.create(group=group, can_use_awx=False)

        allowed, reason = QuotaService.check_feature(self.user, 'can_use_awx')
        self.assertFalse(allowed)
        self.assertIn('not enabled', reason)

    def test_feature_always_allowed_for_superuser(self):
        """Superuser bypasses feature flags"""
        group = Group.objects.create(name='RestrictedGroup')
        self.user.groups.add(group)
        GroupQuota.objects.create(group=group, can_use_awx=False)

        self.user.is_superuser = True
        self.user.save()

        allowed, _ = QuotaService.check_feature(self.user, 'can_use_awx')
        self.assertTrue(allowed)


class QuotaServiceUsageTest(TestCase):
    """Tests for get_usage()"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='usageuser', email='usage@test.com', password='pass123!'
        )

    def test_usage_returns_counts(self):
        """get_usage returns resource counts"""
        usage = QuotaService.get_usage(self.user)
        self.assertIn('saved_queries', usage)
        self.assertIn('query_executions_today', usage)
        self.assertIn('scheduled_tasks', usage)
        self.assertIn('apic_connections', usage)
        self.assertEqual(usage['saved_queries'], 0)
