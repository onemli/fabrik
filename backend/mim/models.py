# mim/models.py
#
# Postgres-backed metadata for the MIM (Managed Information Model) Explorer.
# This is NOT where MIM graph data lives — that's in Neo4j. These models store
# user-specific preferences: favorite classes and saved table display configs.
#
# FavoriteClass: quick-access starred classes per user.
# TableTemplate: saved column layouts for specific ACI classes.

from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class FavoriteClass(models.Model):
    """Starred ACI class, saved per user for the MIM Explorer quick-access panel."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='favorite_classes',
        null=True,  # Temporary: Allow null for development without auth
        blank=True  # TODO: Remove when authentication is implemented
    )

    # Class information
    class_name = models.CharField(max_length=255, db_index=True)
    label = models.CharField(max_length=255, blank=True)
    class_pkg = models.CharField(max_length=100, blank=True)

    # Optional user note
    note = models.TextField(blank=True, null=True)

    # Metadata
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [['user', 'class_name']]
        indexes = [
            models.Index(fields=['class_name']),
            models.Index(fields=['-created_at']),
        ]

    def __str__(self):
        username = self.user.username if self.user else "Anonymous"
        return f"{username} - {self.class_name}"


class RecentClass(models.Model):
    """Recently used ACI class, tracked per user for quick re-access in the
    class browser. Promoted from frontend localStorage so the list syncs across
    devices and feeds the org-wide trending aggregation. Ordering is by
    use_count then last_used_at — power users' top classes float to the top
    even when not just-used."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='recent_classes',
        null=True,
        blank=True,
    )

    class_name = models.CharField(max_length=255, db_index=True)
    label = models.CharField(max_length=255, blank=True)
    class_pkg = models.CharField(max_length=100, blank=True)

    use_count = models.PositiveIntegerField(default=1)
    last_used_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-use_count', '-last_used_at']
        unique_together = [['user', 'class_name']]
        indexes = [
            models.Index(fields=['user', '-last_used_at']),
            models.Index(fields=['user', '-use_count']),
            models.Index(fields=['class_name']),
        ]

    def __str__(self):
        username = self.user.username if self.user else "Anonymous"
        return f"{username} - {self.class_name} (×{self.use_count})"


class TableTemplate(models.Model):
    """
    Table display templates for different APIC class types

    Defines how query results should be displayed in table format:
    - Which columns to show
    - Column ordering and sizing
    - Default filters and sorting
    - User-specific customizations
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='table_templates',
        null=True,
        blank=True
    )

    # Template identification
    class_name = models.CharField(max_length=255, db_index=True)  # e.g., 'fvTenant', 'fvBD'
    template_name = models.CharField(max_length=255)  # User-friendly name
    description = models.TextField(blank=True, null=True)

    # Column configuration (JSON)
    # [{"field": "name", "label": "Tenant Name", "visible": true, "order": 1, "width": 200, ...}, ...]
    columns = models.JSONField(default=list)

    # Display preferences
    preferences = models.JSONField(default=dict)  # {auto_hide_empty, nested_display, etc.}

    # Default filters and sorting
    default_filters = models.JSONField(default=list, blank=True)
    default_sorting = models.JSONField(default=list, blank=True)  # [{"field": "name", "direction": "asc"}]

    # Metadata
    is_default = models.BooleanField(default=False)  # User's default for this class
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    last_used = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-last_used', '-updated_at']
        indexes = [
            models.Index(fields=['user', 'class_name']),
            models.Index(fields=['class_name', 'is_default']),
        ]

    def __str__(self):
        username = self.user.username if self.user else "Anonymous"
        return f"{username} - {self.template_name} ({self.class_name})"


class UserTablePreference(models.Model):
    """
    User-specific table display preferences

    Stores per-user customizations for table display:
    - Hidden columns
    - Column visibility and order
    - Auto-hide settings
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='table_preferences',
        null=True,
        blank=True
    )

    class_name = models.CharField(max_length=255, db_index=True)

    # User's customizations
    visible_columns = models.JSONField(default=list)  # List of visible column fields
    column_order = models.JSONField(default=list)     # Ordered list of column fields
    hidden_columns = models.JSONField(default=list)   # Always hidden for this user
    always_visible = models.JSONField(default=list)   # Always visible (locked)

    # Preferences
    auto_hide_empty = models.BooleanField(default=True)
    nested_display = models.CharField(
        max_length=50,
        default='inline-summary',
        choices=[
            ('inline-summary', 'Inline Summary'),
            ('inline-expanded', 'Inline Expanded'),
            ('modal', 'Modal View'),
        ]
    )
    max_inline_children = models.IntegerField(default=3)

    # Metadata
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [['user', 'class_name']]
        indexes = [
            models.Index(fields=['user', 'class_name']),
        ]

    def __str__(self):
        username = self.user.username if self.user else "Anonymous"
        return f"{username} - Preferences for {self.class_name}"
