
from django.db import models
from django.contrib.auth.models import User
from django.core.validators import MinLengthValidator


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    color = models.CharField(max_length=7, default='#3b82f6', help_text='Hex color code')
    icon = models.CharField(max_length=50, blank=True, null=True, help_text='Lucide icon name')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'Categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class SavedQuery(models.Model):
    # flow_data holds the full React Flow graph so the canvas can be
    # reconstructed exactly. generated_query is re-derived on each save.

    name = models.CharField(max_length=200, validators=[MinLengthValidator(3)])
    description = models.TextField(blank=True, null=True)

    flow_data = models.JSONField(help_text='React Flow nodes and edges')
    generated_query = models.TextField(help_text='Generated APIC query string')

    is_template = models.BooleanField(default=False, help_text='Is this a reusable template?')
    variables = models.JSONField(
        null=True, blank=True,
        help_text='Template variable definitions (id, label, type, binding, etc.)'
    )

    enable_time_machine = models.BooleanField(
        default=False, help_text='Track execution history in Time Machine'
    )

    # Pagination and Time Machine are mutually exclusive
    enable_pagination = models.BooleanField(
        default=False, help_text='Enable pagination for query results'
    )
    page_size = models.IntegerField(
        default=50, help_text='Number of results per page (max: 1000)'
    )

    # Semantic versioning for Time Machine snapshots
    major_version = models.IntegerField(
        default=1, help_text='Major version number (increments on structural changes)'
    )
    minor_version = models.IntegerField(
        default=0, help_text='Minor version number (increments on filter/processor changes)'
    )
    current_version_hash = models.CharField(
        max_length=8, blank=True, db_index=True,
        help_text='Hash of current query structure for change detection'
    )
    version_history = models.JSONField(
        default=list, blank=True,
        help_text='Version changelog: [{ version, hash, changes, created_at, created_by }]'
    )

    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='queries'
    )
    tags = models.CharField(max_length=500, blank=True, help_text='Comma-separated tags')

    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_queries')
    shared_with = models.ManyToManyField(User, blank=True, related_name='shared_queries')
    is_public = models.BooleanField(default=False, help_text='Visible to all users')

    execution_count = models.IntegerField(default=0, help_text='Number of times executed')
    last_executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    favorited_by = models.ManyToManyField(User, blank=True, related_name='favorite_queries')

    is_validation_query = models.BooleanField(
        default=False, db_index=True,
        help_text='Is this query used for validation purposes?'
    )
    validation_description = models.TextField(
        blank=True, help_text='Description of what this validation query checks'
    )
    validation_error_message = models.CharField(
        max_length=500, blank=True,
        help_text='Error message to show when validation fails'
    )
    validation_error_title = models.CharField(
        max_length=100, blank=True,
        help_text='Short error title for validation failures'
    )
    validation_value_field = models.CharField(
        max_length=500, blank=True,
        help_text=(
            'Dotted path to extract list values from APIC response. '
            'E.g. "fvTenant.attributes.name" extracts name from each imdata item.'
        )
    )
    validation_usage_count = models.IntegerField(
        default=0, help_text='Number of templates/columns using this validation query'
    )
    last_validated_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Last time this query was used for validation'
    )

    class Meta:
        verbose_name = 'Saved Query'
        verbose_name_plural = 'Saved Queries'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['created_by', '-created_at']),
            models.Index(fields=['category', '-created_at']),
            models.Index(fields=['is_validation_query', '-created_at']),
        ]

    def __str__(self):
        return f"{self.name} (by {self.created_by.username})"

    @property
    def is_favorite(self):
        return hasattr(self, '_is_favorite')

    @property
    def version_string(self):
        from queries.version_utils import format_version
        return format_version(self.major_version, self.minor_version)

    def save(self, *args, **kwargs):
        # Safety net: ensure every row has a version hash for Time Machine
        if not self.current_version_hash and self.flow_data:
            from queries.version_utils import generate_query_version_hash
            self.current_version_hash = generate_query_version_hash(self.flow_data)

        if not self.major_version:
            self.major_version = 1
        if self.minor_version is None:
            self.minor_version = 0

        super().save(*args, **kwargs)

    def update_version_if_changed(self, new_flow_data: dict, user: 'User | None' = None) -> tuple[bool, str, list]:
        """Compare incoming flow_data against stored version and bump if needed.
        Returns (version_changed, change_type, changes_list).
        """
        from queries.version_utils import (
            generate_query_version_hash,
            detect_version_change_type,
            increment_version,
            create_version_history_entry,
            format_version,
        )

        new_hash = generate_query_version_hash(new_flow_data)

        if not self.current_version_hash:
            self.current_version_hash = new_hash
            self.major_version = 1
            self.minor_version = 0

            if not self.version_history:
                self.version_history = []

            self.version_history.append(
                create_version_history_entry(
                    version=self.version_string,
                    version_hash=new_hash,
                    changes=['Initial version'],
                    user_id=user.id if user else None,
                    username=user.username if user else None,
                )
            )
            return (True, 'initial', ['Initial version'])

        if new_hash == self.current_version_hash:
            return (False, 'none', [])

        change_type, changes = detect_version_change_type(
            old_flow_data=self.flow_data,
            new_flow_data=new_flow_data,
        )

        if change_type == 'none':
            return (False, 'none', [])

        new_major, new_minor = increment_version(
            current_major=self.major_version,
            current_minor=self.minor_version,
            change_type=change_type,
        )

        self.major_version = new_major
        self.minor_version = new_minor
        self.current_version_hash = new_hash

        if not self.version_history:
            self.version_history = []

        self.version_history.append(
            create_version_history_entry(
                version=format_version(new_major, new_minor),
                version_hash=new_hash,
                changes=changes,
                user_id=user.id if user else None,
                username=user.username if user else None,
            )
        )

        return (True, change_type, changes)


class QueryExecutionLog(models.Model):
    query = models.ForeignKey(SavedQuery, on_delete=models.CASCADE, related_name='execution_logs')
    executed_by = models.ForeignKey(User, on_delete=models.CASCADE)
    executed_at = models.DateTimeField(auto_now_add=True)
    execution_time_ms = models.IntegerField(null=True, blank=True, help_text='Execution time in milliseconds')
    result_count = models.IntegerField(null=True, blank=True, help_text='Number of results returned')
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True, null=True)

    class Meta:
        verbose_name = 'Query Execution Log'
        ordering = ['-executed_at']
        indexes = [
            models.Index(fields=['query', '-executed_at']),
            models.Index(fields=['executed_by', '-executed_at']),
        ]

    def __str__(self):
        return f"{self.query.name} - {self.executed_at}"
