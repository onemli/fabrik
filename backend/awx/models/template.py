# awx/models/template.py
#
# TemplateCategory + AutomationTemplate — template definitions and validation logic
import uuid
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class TemplateCategory(models.Model):
    """
    User-defined template categories
    Allows organizing 90+ templates efficiently
    System categories cannot be deleted or renamed
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True, null=True)
    color = models.CharField(
        max_length=7,
        default='#6366f1',
        help_text="Hex color code for UI (e.g., #6366f1)"
    )
    icon = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        help_text="Icon name (e.g., 'network', 'server')"
    )
    display_order = models.IntegerField(default=0, help_text="Sort order in UI")
    is_system = models.BooleanField(
        default=False,
        help_text="System categories cannot be deleted or renamed"
    )

    created_by = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'awx_template_category'
        ordering = ['display_order', 'name']
        verbose_name = 'Template Category'
        verbose_name_plural = 'Template Categories'

    def __str__(self) -> str:
        return self.name


class AutomationTemplate(models.Model):
    """A Fabrik wrapper around an AWX job template or workflow template.

    The template defines:
      - Which AWX template to launch (awx_template_id + awx_connection)
      - What data the user needs to fill in (table_schemas — one per Excel sheet)
      - How that data maps to AWX extra_vars (variable_mappings)
      - Whether the data needs column validation before execution

    Execution is always bulk: all rows go in one JSON structure → one AWX job.
    """
    AWX_TYPE_JOB = 'job_template'
    AWX_TYPE_WORKFLOW = 'workflow_template'

    AWX_TYPE_CHOICES = [
        (AWX_TYPE_JOB, 'Job Template'),
        (AWX_TYPE_WORKFLOW, 'Workflow Template'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, db_index=True)
    description = models.TextField(blank=True, null=True)

    # AWX Integration (CORE)
    awx_connection = models.ForeignKey(
        'AWXConnection',
        on_delete=models.PROTECT,
        help_text="AWX connection to use"
    )
    awx_type = models.CharField(
        max_length=20,
        choices=AWX_TYPE_CHOICES,
        help_text="Job Template or Workflow Template"
    )
    awx_template_id = models.IntegerField(
        help_text="AWX Job Template ID or Workflow Template ID"
    )
    awx_template_name = models.CharField(
        max_length=200,
        help_text="Cached name from AWX"
    )

    # Workflow Details (only if awx_type == workflow_template)
    workflow_job_nodes = models.JSONField(
        default=list,
        blank=True,
        help_text="""
        Workflow job nodes in execution order (fetched from AWX).
        Example:
        [
            {
                "order": 1,
                "job_template_id": 42,
                "name": "Create L3Out",
                "identifier": "node-1"
            },
            {
                "order": 2,
                "job_template_id": 43,
                "name": "Configure BGP",
                "identifier": "node-2"
            }
        ]
        """
    )

    # Table Schemas (supports multi-table for workflows)
    table_schemas = models.JSONField(
        default=list,
        help_text="""
        Table schemas for data input. Each schema represents one Excel sheet.

        For Job Template (single playbook):
        [
            {
                "sheet_name": "Tenants",
                "job_template_id": null,
                "columns": [
                    {
                        "name": "tenant_name",
                        "display_name": "Tenant Name",
                        "type": "text",
                        "required": true,
                        "validation": "^[a-zA-Z0-9_-]{1,64}$",
                        "help_text": "Alphanumeric, dash, underscore only"
                    }
                ],
                "min_rows": 1,
                "max_rows": 100
            }
        ]

        For Workflow Template (multiple playbooks):
        [
            {
                "sheet_name": "Create_L3Out",
                "job_template_id": 42,
                "columns": [...]
            },
            {
                "sheet_name": "Configure_BGP",
                "job_template_id": 43,
                "columns": [...]
            }
        ]
        """
    )

    # Variable Mappings (maps table columns to AWX variables)
    variable_mappings = models.JSONField(
        default=dict,
        blank=True,
        help_text="""
        Maps table column data to AWX extra_vars.
        Example:
        {
            "tenant_name": "tenant",
            "vrf_name": "vrf"
        }
        """
    )

    # Categorization & Tags
    category = models.ForeignKey(
        'TemplateCategory',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='templates'
    )
    tags = models.JSONField(
        default=list,
        help_text="List of tags for filtering (e.g., ['l3out', 'bgp', 'bfd'])"
    )

    # Validation Control
    requires_validation = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Requires column validation before execution"
    )
    allow_validation_bypass = models.BooleanField(
        default=False,
        help_text="Allow users with 'awx.bypass_validation' permission to skip validation"
    )

    # Check Mode (Dry-Run) Control
    enable_check_mode = models.BooleanField(
        default=False,
        help_text="Enable Ansible check mode (dry-run) by default for this template"
    )
    allow_check_mode_override = models.BooleanField(
        default=True,
        help_text="Allow users to override check mode setting when creating requests"
    )

    # Usage Statistics
    execution_count = models.IntegerField(default=0)
    success_count = models.IntegerField(default=0)
    failure_count = models.IntegerField(default=0)
    last_executed_at = models.DateTimeField(null=True, blank=True)

    # Execution Mode — bulk only (per_row and hybrid were removed)
    EXECUTION_MODE_BULK = 'bulk'

    EXECUTION_MODE_CHOICES = [
        (EXECUTION_MODE_BULK, 'Bulk (Single Job)'),
    ]

    execution_mode = models.CharField(
        max_length=20,
        choices=EXECUTION_MODE_CHOICES,
        default=EXECUTION_MODE_BULK,
        help_text="All rows are sent as structured JSON in a single AWX job."
    )

    # Ownership & Sharing
    created_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='automation_templates_created'
    )
    is_public = models.BooleanField(default=False)

    # Approval workflow — when enabled, requests go to awaiting_approval before execution
    requires_approval = models.BooleanField(default=False)
    approver_users = models.ManyToManyField(
        User, blank=True, related_name='approvable_templates',
    )
    approver_groups = models.ManyToManyField(
        'auth.Group', blank=True, related_name='approvable_templates',
    )
    auto_approve_for_owner = models.BooleanField(
        default=False,
        help_text='Skip approval when the requester owns the template',
    )

    # Rollback — link to a compensating template that undoes this one
    rollback_template = models.ForeignKey(
        'self', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='rollback_for',
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'awx_automation_template'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['category', '-created_at']),
            models.Index(fields=['awx_type']),
            models.Index(fields=['is_public']),
            models.Index(fields=['name']),
            models.Index(fields=['requires_validation']),
        ]
        verbose_name = 'Automation Template'
        verbose_name_plural = 'Automation Templates'
        permissions = [
            ('bypass_validation', 'Can bypass validation for templates'),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_awx_type_display()})"

    def validate_input_data(
        self,
        input_data: dict | list,
        connection_id: int | None = None,
    ) -> tuple[bool, list]:
        """Check every row/column against the template's validation rules.

        Supports three validation modes per column:
          regex        — regex match against cell value
          static_list  — cell value must (or must not) be in a predefined list
          query_list   — runs a SavedQuery against APIC and uses results as allowed values

        input_data can be:
          list  — legacy single-schema: [{col1: val1, col2: val2}, ...]
          dict  — multi-schema (workflow templates): {schema_var_name: [{...}, ...]}

        connection_id is required for query_list mode — it's used as part of the
        cache key so that values from one APIC don't leak into validation for another.
        """
        import logging

        logger = logging.getLogger(__name__)
        errors = []

        logger.info(f'[Validation] Starting validation for template: {self.name}')
        logger.info(f'[Validation] Input data type: {type(input_data)}')
        logger.info(f'[Validation] Connection ID: {connection_id}')

        # If no input data provided
        if not input_data:
            logger.info('[Validation] No input data provided, returning valid')
            return True, []

        # If table_schemas not defined, skip validation
        if not self.table_schemas:
            logger.info('[Validation] No table schemas defined, returning valid')
            return True, []

        # Pre-fetch live regex patterns for all columns that reference one.
        # Doing this once here instead of per-row keeps validation O(schema)
        # instead of O(rows × columns) against the DB.
        regex_patterns_by_id = self._load_referenced_regex_patterns()

        # Handle dict format (normalized single-schema or multi-schema workflow templates)
        if isinstance(input_data, dict):
            logger.info(f'[Validation] Multi-schema validation for {len(self.table_schemas)} schemas')

            # Validate each schema
            for schema_idx, schema in enumerate(self.table_schemas):
                var_name = schema.get('awx_variable_name')
                if not var_name or var_name not in input_data:
                    logger.warning(f'[Validation] Schema {schema_idx} variable "{var_name}" not found in input data')
                    continue

                rows = input_data[var_name]
                if not isinstance(rows, list):
                    errors.append({
                        "schema_index": schema_idx,
                        "message": f"Data for '{var_name}' must be a list of objects"
                    })
                    continue

                columns = schema.get('columns', [])
                logger.info(f'[Validation] Schema "{var_name}": {len(rows)} rows, {len(columns)} columns')

                # Validate each row in this schema
                for row_idx, row in enumerate(rows):
                    for column in columns:
                        self._validate_column(column, row, row_idx, schema_idx, errors, connection_id, logger, regex_patterns_by_id)

            return len(errors) == 0, errors

        # Single-schema template (legacy): [...]
        elif isinstance(input_data, list):
            logger.info(f'[Validation] Single-schema validation: {len(input_data)} rows')

            if not self.table_schemas or len(self.table_schemas) == 0:
                return True, []

            schema = self.table_schemas[0]
            columns = schema.get('columns', [])

            logger.info(f'[Validation] Schema columns: {len(columns)}')

            # Validate each row
            for row_idx, row in enumerate(input_data):
                if not isinstance(row, dict):
                    errors.append({
                        "row": row_idx,
                        "column": "",
                        "schema_index": 0,
                        "message": "Input data must be a list of objects"
                    })
                    continue

                for column in columns:
                    self._validate_column(column, row, row_idx, 0, errors, connection_id, logger, regex_patterns_by_id)

            return len(errors) == 0, errors

        else:
            logger.warning(f'[Validation] Invalid input data type: {type(input_data)}')
            errors.append({
                "row": 0,
                "column": "",
                "schema_index": 0,
                "message": "Input data must be a list of objects or a dict of schema data"
            })
            return False, errors

    def _load_referenced_regex_patterns(self) -> dict:
        """Collect all regex_pattern_ids from the template's columns and fetch
        their current patterns in a single query.

        Returns {pattern_id: pattern_string}. Called once per validation run.
        """
        ids = set()
        for schema in (self.table_schemas or []):
            for column in schema.get('columns', []):
                pid = column.get('regex_pattern_id')
                if pid:
                    ids.add(pid)
        if not ids:
            return {}
        from awx.models.validation import RegexPattern
        return {
            str(pk): pattern
            for pk, pattern in RegexPattern.objects.filter(pk__in=ids).values_list('id', 'pattern')
        }

    def _validate_column(
        self,
        column: dict,
        row: dict,
        row_idx: int,
        schema_idx: int,
        errors: list,
        connection_id: int | None,
        logger,
        regex_patterns_by_id: dict | None = None,
    ) -> None:
        """Helper method to validate a single column"""
        import re

        try:
            column_name = column.get('name')
            cell_value = row.get(column_name, '')

            # Required check runs before everything else. An empty cell on a
            # required column is an error regardless of validation_mode, and
            # downstream checks (regex, static_list, query_list) all short-circuit
            # on empty values so they'd never catch a missing required field.
            is_empty = cell_value is None or (isinstance(cell_value, str) and cell_value.strip() == '')
            if column.get('required') and is_empty:
                display_name = column.get('display_name', column_name)
                errors.append({
                    'row': row_idx,
                    'column': column_name,
                    'value': cell_value,
                    'schema_index': schema_idx,
                    'message': f"'{display_name}' is required",
                })
                return

            # Enforce enum_values for select columns before any validation_mode
            # logic — acts as a hard gate independent of how the column is configured.
            column_type = column.get('type', 'text')
            enum_values = column.get('enum_values', [])
            if column_type in ('select', 'multiselect') and enum_values and cell_value:
                str_value = str(cell_value)
                if str_value not in [str(v) for v in enum_values]:
                    display_name = column.get('display_name', column_name)
                    errors.append({
                        'row': row_idx,
                        'column': column_name,
                        'value': cell_value,
                        'schema_index': schema_idx,
                        'message': f"'{display_name}' must be one of: {', '.join(str(v) for v in enum_values)}",
                        'allowed_values': enum_values,
                    })
                    return  # enum check is definitive for select columns

            # Get validation config
            validation_mode = column.get('validation_mode', 'regex')  # Default to regex for backward compatibility

            # Skip if no validation mode or mode is 'none'
            if not validation_mode or validation_mode == 'none':
                return

            # Regex validation (existing + new mode)
            if validation_mode == 'regex':
                # Prefer the live pattern from the referenced RegexPattern record
                # so edits to a shared regex propagate to all templates using it.
                # The inline `validation` string remains as a fallback for columns
                # without a reference (legacy or ad-hoc patterns).
                validation_pattern = None
                pattern_id = column.get('regex_pattern_id')
                if pattern_id and regex_patterns_by_id:
                    validation_pattern = regex_patterns_by_id.get(str(pattern_id))
                if not validation_pattern:
                    validation_pattern = column.get('validation')
                if validation_pattern and cell_value:
                    try:
                        if not re.match(validation_pattern, str(cell_value)):
                            errors.append({
                                'row': row_idx,
                                'column': column_name,
                                'value': cell_value,
                                'schema_index': schema_idx,
                                'message': f'Does not match pattern: {validation_pattern}'
                            })
                    except re.error as e:
                        logger.error(f'Invalid regex pattern "{validation_pattern}": {e}')

            # Static list validation
            elif validation_mode == 'static_list':
                validation_list = column.get('validation_list', [])
                case_sensitive = column.get('validation_case_sensitive', False)
                validation_invert = column.get('validation_invert', False)  # NEW: Invert logic (conflict check)

                if validation_list and cell_value:
                    is_in_list = self._is_in_list(cell_value, validation_list, case_sensitive)

                    # Invert logic: If validation_invert=True, FAIL when value IS in list (conflict check)
                    should_fail = is_in_list if validation_invert else not is_in_list

                    if should_fail:
                        # Use custom error message if provided
                        custom_msg = column.get('validation_error_message')

                        if validation_invert:
                            # Conflict detected
                            default_msg = 'Value already exists (conflict detected)'
                            errors.append({
                                'row': row_idx,
                                'column': column_name,
                                'value': cell_value,
                                'schema_index': schema_idx,
                                'message': custom_msg if custom_msg else default_msg,
                                'allowed_values': validation_list[:10]
                            })
                        else:
                            # Not in allowed list
                            default_msg = 'Value not in allowed list'
                            errors.append({
                                'row': row_idx,
                                'column': column_name,
                                'value': cell_value,
                                'schema_index': schema_idx,
                                'message': custom_msg if custom_msg else default_msg,
                                'allowed_values': validation_list[:10]
                            })

            # Query-based list validation
            elif validation_mode == 'query_list':
                validation_query_id = column.get('validation_query')
                case_sensitive = column.get('validation_case_sensitive', False)
                validation_invert = column.get('validation_invert', False)  # NEW: Invert logic (conflict check)

                if validation_query_id and cell_value:
                    allowed_values, query_error = self._get_query_validation_list(validation_query_id, connection_id)

                    logger.info(f'[Validation] Column: {column_name}, Row: {row_idx}, Value: {cell_value}')
                    logger.info(f'[Validation] Query ID: {validation_query_id}, Allowed values count: {len(allowed_values) if allowed_values else 0}')
                    logger.info(f'[Validation] First 10 allowed values: {allowed_values[:10] if allowed_values else []}')
                    logger.info(f'[Validation] Case sensitive: {case_sensitive}, Invert: {validation_invert}')

                    # Use custom error message if provided
                    custom_msg = column.get('validation_error_message')

                    if query_error:
                        logger.error(f'[Validation] Query error: {query_error}')
                        default_msg = f'Query validation error: {query_error}'
                        errors.append({
                            'row': row_idx,
                            'column': column_name,
                            'value': cell_value,
                            'schema_index': schema_idx,
                            'message': custom_msg if custom_msg else default_msg
                        })
                    elif allowed_values:
                        is_in_list = self._is_in_list(cell_value, allowed_values, case_sensitive)

                        # Invert logic: If validation_invert=True, FAIL when value IS in list (conflict check)
                        should_fail = is_in_list if validation_invert else not is_in_list

                        if should_fail:
                            if validation_invert:
                                # Conflict detected
                                logger.warning(f'[Validation] CONFLICT: Value "{cell_value}" already exists in list')
                                default_msg = 'Value already exists (conflict detected)'
                                errors.append({
                                    'row': row_idx,
                                    'column': column_name,
                                    'value': cell_value,
                                    'schema_index': schema_idx,
                                    'message': custom_msg if custom_msg else default_msg,
                                    'allowed_values': allowed_values[:10]
                                })
                            else:
                                # Not in allowed list
                                logger.warning(f'[Validation] Value "{cell_value}" not in allowed list')
                                default_msg = 'Value not in query output list'
                                errors.append({
                                    'row': row_idx,
                                    'column': column_name,
                                    'value': cell_value,
                                    'schema_index': schema_idx,
                                    'message': custom_msg if custom_msg else default_msg,
                                    'allowed_values': allowed_values[:10]
                                })
                        else:
                            logger.info(f'[Validation] Value "{cell_value}" is valid')

        except Exception as e:
            logger.error(f'[Validation] Error validating column {column.get("name")}: {e}', exc_info=True)

    def _is_in_list(self, value, allowed_list: list, case_sensitive: bool) -> bool:
        """Check if value is in allowed list"""
        if case_sensitive:
            return str(value) in [str(v) for v in allowed_list]
        else:
            return str(value).lower() in [str(v).lower() for v in allowed_list]

    def _get_query_validation_list(
        self,
        query_id: int,
        connection_id: int | None = None,
    ) -> tuple[list, str | None]:
        """Run a SavedQuery and extract its output as a flat list of allowed values.

        Results are cached for 5 minutes (keyed by query_id + connection_id) so
        that validating 100 rows against the same query doesn't fire 100 APIC calls.
        Cache failures are handled — we just skip the cache and run the query.

        The connection_id is part of the cache key intentionally: the same query
        against two different APICs can return different results, and we don't want
        tenant names from fabric A to appear as valid options for fabric B.

        If the query returns a multi-column dict, we log a warning and use the first
        column. The user is responsible for pointing to a query with single-column output.
        """
        from django.core.cache import cache
        from queries.models import SavedQuery
        import logging

        logger = logging.getLogger(__name__)

        # Cache key includes connection_id to avoid cross-APIC data leakage
        cache_key = f'validation_query_{query_id}_conn_{connection_id}'

        # Check cache first (5 min TTL) - graceful degradation if Redis unavailable
        try:
            cached = cache.get(cache_key)
            if cached is not None:
                logger.debug(f'[Validation] Cache hit for query {query_id}')
                return cached
        except Exception as cache_err:
            logger.warning(f'[Validation] Cache read failed, proceeding without cache: {cache_err}')
            cached = None

        # Connection ID is required for query execution
        if not connection_id:
            return [], 'APIC connection ID is required for query-based validation'

        try:
            SavedQuery.objects.get(id=query_id)
        except SavedQuery.DoesNotExist:
            return [], f'Validation query not found (ID: {query_id})'

        # Execute query (user must ensure it returns list-compatible output)
        try:
            # Import here to avoid circular dependency
            from queries.tasks import execute_saved_query_sync

            logger.info(f'[Validation] Executing query {query_id} for validation list')
            results = execute_saved_query_sync(query_id, connection_id)
            logger.info(f'[Validation] Query returned {len(results) if results else 0} results')

            if not results or len(results) == 0:
                logger.warning(f'[Validation] Query {query_id} returned empty results')
                return [], None

            # Check if result is dict format (user responsibility warning)
            logger.info(f'[Validation] Result type: {type(results[0])}')
            logger.info(f'[Validation] First result sample: {results[0]}')

            if isinstance(results[0], dict) and len(results[0].keys()) > 1:
                logger.warning(
                    f'Validation query {query_id} returns multi-column dict format. '
                    f'User is responsible for ensuring single-column output. '
                    f'Using first column only.'
                )

            # Extract values from first column
            if isinstance(results[0], dict):
                first_key = list(results[0].keys())[0]
                values = [str(row[first_key]) for row in results if first_key in row]
                logger.info(f'[Validation] Extracted values from dict key "{first_key}": {len(values)} values')
            elif isinstance(results[0], (str, int, float)):
                # Already simple list
                values = [str(v) for v in results]
                logger.info(f'[Validation] Using simple list: {len(values)} values')
            else:
                # Unknown format
                logger.error(f'Validation query {query_id} returned unsupported format: {type(results[0])}')
                return [], 'Query returned unsupported format. Expected simple list or single-column dict.'

            # Cache for 5 minutes - graceful degradation if Redis unavailable
            try:
                cache.set(cache_key, (values, None), 300)
            except Exception as cache_err:
                logger.warning(f'[Validation] Cache write failed, continuing without cache: {cache_err}')

            logger.info(f'[Validation] Final allowed values list ({len(values)} items): {values[:10]}...')

            return values, None

        except Exception as e:
            logger.error(f'Error executing validation query {query_id}: {e}')
            return [], f'Error executing query: {str(e)}'
