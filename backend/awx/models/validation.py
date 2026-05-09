# awx/models/validation.py
#
# ValidationList, ValidationUsage, ColumnTemplate — reusable validation and column definitions
import re
import uuid
from django.db import models
from django.core.exceptions import ValidationError
from django.contrib.auth import get_user_model
from django.utils import timezone

User = get_user_model()


class ValidationList(models.Model):
    """A named, reusable set of allowed values for column validation.

    Think of it as a shared enum library. Instead of typing the same
    ['prod', 'staging', 'dev'] into every template that has an environment
    column, admins create one list here and reference it by FK.

    usage_count is denormalized (not computed on the fly) because the
    "most-used templates" query runs on every list-view load. Keeping it
    denormalized is worth the extra increment/decrement bookkeeping.
    is_public lets an admin publish a list so all users can use it without
    making every user an admin.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Metadata
    name = models.CharField(
        max_length=200,
        unique=True,
        db_index=True,
        help_text="Unique validation list name (e.g., 'ACI Tenant Names')",
    )
    description = models.TextField(blank=True, help_text='Explain what this list validates and why')

    # Validation Data
    values = models.JSONField(help_text="Array of allowed values ['value1', 'value2', ...]")
    case_sensitive = models.BooleanField(default=False, help_text='Case-sensitive matching')

    # Error Message (MANDATORY)
    error_message = models.CharField(
        max_length=500, help_text='Error message shown when value not in list (max 500 chars)'
    )
    error_message_title = models.CharField(
        max_length=100, help_text='Short error title (max 100 chars)'
    )

    # Metadata
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='validation_lists_created'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_public = models.BooleanField(
        default=False, help_text='Visible to all users (vs. creator only)'
    )

    # Usage tracking (denormalized for performance)
    usage_count = models.IntegerField(default=0, help_text='Number of columns using this list')
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'awx_validation_list'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['-created_at']),
        ]
        verbose_name = 'Validation List'
        verbose_name_plural = 'Validation Lists'

    def __str__(self):
        return self.name

    def increment_usage(self):
        """Called when list is attached to a column. Uses F() for atomic increment."""
        from django.db.models import F

        type(self).objects.filter(pk=self.pk).update(
            usage_count=F('usage_count') + 1,
            last_used_at=timezone.now(),
        )
        self.refresh_from_db(fields=['usage_count', 'last_used_at'])

    def decrement_usage(self):
        """Called when list is detached from a column. Uses F() for atomic decrement."""
        from django.db.models import F
        from django.db.models.functions import Greatest

        type(self).objects.filter(pk=self.pk).update(
            usage_count=Greatest(F('usage_count') - 1, 0),
        )
        self.refresh_from_db(fields=['usage_count'])


class ValidationUsage(models.Model):
    """Junction model tracking which column in which template uses which validation rule.

    We need this so that when someone edits a ValidationList, they can see
    "hey, this list is used in 3 templates" and know what they're about to affect.
    The unique_together on (template, sheet_name, column_name) means one column
    can only have one validation rule — which is the right constraint, you don't
    want overlapping validators on the same field.

    validation_list and validation_query are both nullable because only one of
    them is set depending on validation_type. A database-level check constraint
    would be cleaner but Django doesn't do those portably, so it's enforced in
    the serializer instead.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # What is being validated
    template = models.ForeignKey(
        'AutomationTemplate', on_delete=models.CASCADE, related_name='validation_usages'
    )
    sheet_name = models.CharField(max_length=200)
    column_name = models.CharField(max_length=200)

    # Validation source (exactly ONE of these must be set)
    validation_type = models.CharField(
        max_length=20,
        choices=[
            ('regex', 'Regex Pattern'),
            ('static_list', 'Static List'),
            ('query_list', 'Query List'),
        ],
    )
    validation_list = models.ForeignKey(
        'ValidationList', on_delete=models.CASCADE, null=True, blank=True, related_name='usages'
    )
    validation_query = models.ForeignKey(
        'queries.SavedQuery',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='validation_usages',
    )

    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='validation_usages_created'
    )

    class Meta:
        db_table = 'awx_validation_usage'
        unique_together = [('template', 'sheet_name', 'column_name')]
        indexes = [
            models.Index(fields=['validation_list']),
            models.Index(fields=['validation_query']),
        ]
        verbose_name = 'Validation Usage'
        verbose_name_plural = 'Validation Usages'

    def __str__(self):
        return f'{self.template.name} - {self.column_name}'


class RegexPattern(models.Model):
    # Reusable regex patterns for column validation. Users build patterns via the
    # visual regex builder or type them manually, test against sample strings, then
    # save here for reuse across templates. The ColumnEditor can reference a saved
    # pattern by FK instead of duplicating the regex inline.

    CATEGORY_CHOICES = [
        ('network', 'Network'),
        ('naming', 'Naming Convention'),
        ('format', 'Data Format'),
        ('security', 'Security'),
        ('custom', 'Custom'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(
        max_length=200,
        unique=True,
        db_index=True,
        help_text="Unique pattern name (e.g., 'IPv4 Address')",
    )
    description = models.TextField(
        blank=True, help_text='Explain what this pattern matches and when to use it'
    )
    pattern = models.TextField(help_text="The regex pattern string (e.g., '^[a-zA-Z0-9_-]+$')")
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        default='custom',
        db_index=True,
    )
    test_strings = models.JSONField(
        default=list,
        blank=True,
        help_text="Sample test strings saved with the pattern [{'value': '...', 'should_match': true}]",
    )
    flags = models.JSONField(
        default=list,
        blank=True,
        help_text="Regex flags: ['i'] for case-insensitive, ['m'] for multiline, etc.",
    )

    # Error message shown when validation fails
    error_message = models.CharField(
        max_length=500, blank=True, help_text="Custom error message when a value doesn't match"
    )

    # Ownership and sharing
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name='regex_patterns_created'
    )
    is_public = models.BooleanField(
        default=False, help_text='Visible to all users (vs. creator only)'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Usage tracking (denormalized)
    usage_count = models.IntegerField(default=0, help_text='Number of columns using this pattern')
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'awx_regex_pattern'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['category']),
            models.Index(fields=['-created_at']),
        ]
        verbose_name = 'Regex Pattern'
        verbose_name_plural = 'Regex Patterns'

    def __str__(self):
        return self.name

    def clean(self):
        r"""Strip whitespace and verify the pattern compiles.

        Prevents saving bogus regex like a trailing backtick copied from
        markdown (`^...$` → `^...$\``) or any other malformed pattern.
        re.compile() parses the regex — if the syntax is broken, it raises
        re.error and we convert that into a user-friendly ValidationError.
        """
        if self.pattern:
            self.pattern = self.pattern.strip()
        if not self.pattern:
            raise ValidationError({'pattern': 'Pattern cannot be empty.'})
        try:
            re.compile(self.pattern)
        except re.error as exc:
            raise ValidationError({'pattern': f'Invalid regex: {exc}'})

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def increment_usage(self):
        from django.db.models import F

        type(self).objects.filter(pk=self.pk).update(
            usage_count=F('usage_count') + 1,
            last_used_at=timezone.now(),
        )
        self.refresh_from_db(fields=['usage_count', 'last_used_at'])

    def decrement_usage(self):
        from django.db.models import F
        from django.db.models.functions import Greatest

        type(self).objects.filter(pk=self.pk).update(
            usage_count=Greatest(F('usage_count') - 1, 0),
        )
        self.refresh_from_db(fields=['usage_count'])


class ColumnTemplate(models.Model):
    """Saved column definitions that users can drop into the schema designer.

    When someone builds their fifth template with a "Tenant Name" column, they
    shouldn't have to type the same regex and help text again. ColumnTemplate
    lets them save the column_data JSON and reuse it across templates.

    scope=company means org-wide shared templates (set by admins); scope=user
    is personal. shared_with allows point-to-point sharing without making
    something fully public. usage_count is ordered descending in the default
    ordering so the most-reused templates bubble up in the picker.
    """

    SCOPE_USER = 'user'
    SCOPE_COMPANY = 'company'

    SCOPE_CHOICES = [
        (SCOPE_USER, 'User Template'),
        (SCOPE_COMPANY, 'Company-wide Template'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True, null=True)

    # Column definition (same structure as table schema column)
    column_data = models.JSONField(
        help_text="""
        Full column definition.
        Example:
        {
            "name": "tenant_name",
            "display_name": "Tenant Name",
            "type": "text",
            "required": true,
            "validation": "^[a-zA-Z0-9_-]{1,64}$",
            "help_text": "Alphanumeric, dash, underscore only",
            "min_length": 1,
            "max_length": 64
        }
        """
    )

    # Sharing and visibility
    scope = models.CharField(
        max_length=20,
        choices=SCOPE_CHOICES,
        default=SCOPE_USER,
        help_text='Template scope: user-specific or company-wide',
    )
    is_public = models.BooleanField(
        default=False, help_text='True if publicly available to all users'
    )
    created_by = models.ForeignKey(
        'auth.User', on_delete=models.CASCADE, related_name='column_templates_created'
    )
    shared_with = models.ManyToManyField(
        'auth.User', blank=True, related_name='column_templates_shared'
    )

    # Usage statistics
    usage_count = models.IntegerField(
        default=0, help_text='Number of times this template has been applied'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Column Template'
        verbose_name_plural = 'Column Templates'
        db_table = 'awx_column_template'
        ordering = ['-usage_count', 'name']
        indexes = [
            models.Index(fields=['created_by', '-created_at']),
            models.Index(fields=['scope', '-usage_count']),
            models.Index(fields=['is_public', '-usage_count']),
        ]

    def __str__(self):
        return f'{self.name} ({self.scope})'
