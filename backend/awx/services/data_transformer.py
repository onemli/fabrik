# awx/services/data_transformer.py
#
# Turns the wizard's input_data (user-filled table rows) into the Ansible
# extra_vars dict that AWX expects. Also handles schema validation before
# execution so we reject bad data here rather than letting Ansible fail mid-run.
#
# Variable mappings support dot-notation paths (e.g. "network.vlan_id") so the
# playbook can receive nested dicts without the wizard UI needing to know about
# the Ansible variable structure.

import logging
import re
from typing import Dict, List, Tuple, Any

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    """Raised when data validation fails"""


class DataTransformer:
    # Validates and reshapes wizard input data for AWX. Dot-notation variable
    # paths (e.g. "network.vlan_id") are expanded into nested dicts.
    TYPE_TEXT = 'text'
    TYPE_TEXTAREA = 'textarea'
    TYPE_PASSWORD = 'password'
    TYPE_NUMBER = 'number'
    TYPE_BOOLEAN = 'boolean'
    TYPE_SELECT = 'select'
    TYPE_MULTISELECT = 'multiselect'

    def __init__(self):
        pass

    def transform_input_to_ansible_vars(
        self, input_data: Dict[str, Any], variable_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        try:
            rows = input_data.get('data', [])
            if not rows:
                return {}

            # If no mappings provided, return data as-is
            if not variable_mappings:
                return {'data': rows}

            # Transform each row
            transformed_rows = []
            for row in rows:
                transformed_row = self._transform_row(row, variable_mappings)
                transformed_rows.append(transformed_row)

            # Wrap in data array
            return {'data': transformed_rows}

        except Exception as e:
            logger.exception(f'Error transforming input to ansible vars: {str(e)}')
            raise ValidationError(f'Transformation failed: {str(e)}')

    def validate_against_schema(
        self, input_data: Dict[str, Any], table_schemas: List[Dict[str, Any]]
    ) -> Tuple[bool, List[str]]:
        try:
            errors = []

            # Normalize input_data format - accept:
            # 1. List: [...]  (single-schema legacy)
            # 2. Dict with 'data': {'data': [...]}  (single-schema legacy)
            # 3. Dict with schema keys: {'tenants': [...], 'vrfs': [...]}  (multi-schema workflow)

            # Dict format — single or multi-schema.
            # The wizard always sends {'var_name': [...rows...]} regardless of schema count.
            if isinstance(input_data, dict):
                if len(table_schemas) > 1:
                    # Multi-schema: execution_engine handles per-schema validation
                    return True, []

                # Single-schema: extract rows from the schema's variable name or 'data' key
                schema_var = table_schemas[0].get('awx_variable_name') if table_schemas else None
                if schema_var and schema_var in input_data:
                    rows = input_data[schema_var]
                elif 'data' in input_data:
                    rows = input_data['data']
                else:
                    # Last resort: if dict has exactly one key whose value is a list, use that
                    list_values = [v for v in input_data.values() if isinstance(v, list)]
                    if len(list_values) == 1:
                        rows = list_values[0]
                    elif not input_data:
                        rows = []
                    else:
                        errors.append(
                            'Input data must be a list or a dict with schema variable name'
                        )
                        return False, errors
            elif isinstance(input_data, list):
                rows = input_data
            elif not input_data:
                rows = []
            else:
                errors.append('Input data must be a list or a dict')
                return False, errors

            # Check if there's at least one schema
            if not table_schemas or not table_schemas[0].get('columns'):
                # No schema defined - skip validation
                return True, []

            # Use first schema (for single-sheet templates)
            schema = table_schemas[0]
            columns = schema.get('columns', [])

            # Build column lookup
            column_map = {col['name']: col for col in columns}

            # Validate row count
            min_rows = schema.get('min_rows', 0)
            max_rows = schema.get('max_rows', 10000)

            if len(rows) < min_rows:
                errors.append(f'Minimum {min_rows} rows required, found {len(rows)}')

            if len(rows) > max_rows:
                errors.append(f'Maximum {max_rows} rows allowed, found {len(rows)}')

            # Validate each row
            for row_idx, row in enumerate(rows, start=1):
                row_errors = self._validate_row(row, column_map, row_idx)
                errors.extend(row_errors)

                # Limit error count to prevent huge lists
                if len(errors) > 50:
                    errors.append('... and more errors (stopped at 50)')
                    break

            is_valid = len(errors) == 0
            return is_valid, errors

        except Exception as e:
            logger.exception(f'Error validating data: {str(e)}')
            return False, [f'Validation error: {str(e)}']

    def apply_variable_mapping(
        self, row_data: Dict[str, Any], column_mapping: Dict[str, str]
    ) -> Dict[str, Any]:
        # Dot-notation paths (e.g. "vlan.id") become nested dicts.
        try:
            result = {}

            for column_name, awx_var_name in column_mapping.items():
                if column_name not in row_data:
                    # Column not in row data, skip
                    continue

                value = row_data[column_name]

                # Handle nested paths (e.g., "vlan.id")
                if '.' in awx_var_name:
                    self._set_nested_value(result, awx_var_name, value)
                else:
                    # Simple mapping
                    result[awx_var_name] = value

            return result

        except Exception as e:
            logger.exception(f'Error applying variable mapping: {str(e)}')
            raise ValidationError(f'Mapping failed: {str(e)}')

    def _transform_row(
        self, row: Dict[str, Any], variable_mappings: Dict[str, str]
    ) -> Dict[str, Any]:
        transformed = {}

        for column_name, value in row.items():
            # Strip whitespace and CR/LF from string values — pasted cells often
            # carry a trailing '\r' from Excel/Windows line endings, which can
            # break downstream regex checks, APIC name rules, or AWX playbooks.
            if isinstance(value, str):
                value = value.strip()

            # Get mapped variable name
            awx_var_name = variable_mappings.get(column_name, column_name)

            # Handle nested paths
            if '.' in awx_var_name:
                self._set_nested_value(transformed, awx_var_name, value)
            else:
                transformed[awx_var_name] = value

        return transformed

    def _set_nested_value(self, target: Dict[str, Any], path: str, value: Any) -> None:
        parts = path.split('.')
        current = target

        # Navigate/create nested structure
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]

        # Set final value
        current[parts[-1]] = value

    def _validate_row(
        self, row: Dict[str, Any], column_map: Dict[str, Dict], row_idx: int
    ) -> List[str]:
        errors = []

        # Check required columns
        for column_name, column_def in column_map.items():
            is_required = column_def.get('required', False)
            value = row.get(column_name)

            # Match the transform-time strip so validation sees the same value
            # that gets sent to AWX — keeps pasted '\r' from slipping past.
            if isinstance(value, str):
                value = value.strip()

            # Required field check
            if is_required and (value is None or value == ''):
                errors.append(
                    f"Row {row_idx}: Required field '{column_def.get('display_name', column_name)}' is missing"
                )
                continue

            # Skip validation if value is empty and not required
            if value is None or value == '':
                continue

            # Type-specific validation
            field_type = column_def.get('type', self.TYPE_TEXT)
            validation_errors = self._validate_field_value(
                value, column_def, field_type, column_name, row_idx
            )
            errors.extend(validation_errors)

        return errors

    def _validate_field_value(
        self, value: Any, column_def: Dict, field_type: str, column_name: str, row_idx: int
    ) -> List[str]:
        errors = []
        display_name = column_def.get('display_name', column_name)

        try:
            # Type validation
            if field_type == self.TYPE_NUMBER:
                # Validate number
                try:
                    num_value = float(value)

                    # Min/max validation
                    if 'min' in column_def and num_value < column_def['min']:
                        errors.append(
                            f"Row {row_idx}: '{display_name}' must be at least {column_def['min']}"
                        )

                    if 'max' in column_def and num_value > column_def['max']:
                        errors.append(
                            f"Row {row_idx}: '{display_name}' must be at most {column_def['max']}"
                        )

                except (ValueError, TypeError):
                    errors.append(f"Row {row_idx}: '{display_name}' must be a number")

            elif field_type == self.TYPE_BOOLEAN:
                # Validate boolean
                if not isinstance(value, bool) and value not in ['true', 'false', '1', '0', 1, 0]:
                    errors.append(f"Row {row_idx}: '{display_name}' must be a boolean (true/false)")

            elif field_type in [self.TYPE_SELECT, self.TYPE_MULTISELECT]:
                # Validate enum values
                enum_values = column_def.get('enum_values', [])
                if enum_values:
                    if field_type == self.TYPE_MULTISELECT:
                        # Multiselect: value should be list
                        if not isinstance(value, list):
                            errors.append(
                                f"Row {row_idx}: '{display_name}' must be a list of values"
                            )
                        else:
                            invalid_values = [v for v in value if v not in enum_values]
                            if invalid_values:
                                errors.append(
                                    f"Row {row_idx}: '{display_name}' contains invalid values: {invalid_values}"
                                )
                    else:
                        # Single select
                        if value not in enum_values:
                            errors.append(
                                f"Row {row_idx}: '{display_name}' must be one of: {', '.join(map(str, enum_values))}"
                            )

            elif field_type in [self.TYPE_TEXT, self.TYPE_TEXTAREA, self.TYPE_PASSWORD]:
                # Validate string
                str_value = str(value)

                # Length validation
                if 'min_length' in column_def and len(str_value) < column_def['min_length']:
                    errors.append(
                        f"Row {row_idx}: '{display_name}' must be at least {column_def['min_length']} characters"
                    )

                if 'max_length' in column_def and len(str_value) > column_def['max_length']:
                    errors.append(
                        f"Row {row_idx}: '{display_name}' must be at most {column_def['max_length']} characters"
                    )

                # Regex validation — honor validation_mode and prefer the live
                # RegexPattern record so edits to a shared pattern propagate
                # without having to re-save every template.
                validation_mode = column_def.get('validation_mode', 'regex')
                validation_pattern = None
                if validation_mode == 'regex':
                    pattern_id = column_def.get('regex_pattern_id')
                    if pattern_id:
                        from awx.models.validation import RegexPattern

                        try:
                            validation_pattern = (
                                RegexPattern.objects.only('pattern').get(pk=pattern_id).pattern
                            )
                        except RegexPattern.DoesNotExist:
                            validation_pattern = None
                    if not validation_pattern:
                        validation_pattern = column_def.get('validation')
                if validation_pattern:
                    try:
                        if not re.match(validation_pattern, str_value):
                            help_text = column_def.get('help_text', 'Invalid format')
                            errors.append(
                                f"Row {row_idx}: '{display_name}' format is invalid. {help_text}"
                            )
                    except re.error as e:
                        logger.error(f"Invalid regex pattern '{validation_pattern}': {str(e)}")
                        errors.append(
                            f"Row {row_idx}: '{display_name}' validation pattern is invalid"
                        )

        except Exception as e:
            logger.exception(f'Error validating field {column_name}: {str(e)}')
            errors.append(f"Row {row_idx}: Error validating '{display_name}': {str(e)}")

        return errors
