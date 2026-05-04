# awx/services/survey_converter.py
#
# Converts an AWX survey spec into a Fabrik table_schema. AWX surveys define
# the variables a playbook needs at launch time — Fabrik's table schemas define
# the columns the wizard UI shows. They're structurally different but semantically
# the same, so this converter lets teams onboard existing AWX templates without
# manually recreating the schema.
#
# TYPE_MAPPING handles the AWX → Fabrik type translation. Not every AWX type
# has a perfect Fabrik equivalent (e.g. AWX "multiselect" is rare), so we map
# to the closest sensible type and let the team adjust in the schema designer.

import logging
import re
from typing import Dict, List, Any, Tuple, Optional

logger = logging.getLogger(__name__)


class SurveyConversionError(Exception):
    """Raised when survey conversion fails"""


class SurveyToSchemaConverter:

    # AWX survey type → Fabrik column type mapping
    TYPE_MAPPING = {
        'text': 'text',
        'textarea': 'textarea',
        'password': 'password',
        'integer': 'number',
        'float': 'number',
        'multiplechoice': 'select',
        'multiselect': 'multiselect',
    }

    def __init__(self):
        pass

    def convert(
        self,
        survey_spec: Dict[str, Any],
        template_type: str,
        template_name: str = None
    ) -> List[Dict[str, Any]]:
        # Converts AWX survey spec fields into Fabrik table schema columns
        try:
            if not survey_spec:
                raise SurveyConversionError("Survey spec is empty")

            if 'spec' not in survey_spec:
                raise SurveyConversionError("Survey spec missing 'spec' field")

            survey_fields = survey_spec.get('spec', [])
            if not survey_fields:
                raise SurveyConversionError("Survey spec has no fields")

            # Convert each field to column definition
            columns = []
            for field in survey_fields:
                try:
                    column = self.convert_field(field)
                    columns.append(column)
                except Exception as e:
                    logger.warning(f"Failed to convert field {field.get('variable')}: {str(e)}")
                    # Continue with other fields

            if not columns:
                raise SurveyConversionError("No valid columns converted from survey")

            # Create schema
            sheet_name = template_name or survey_spec.get('name', 'Data')
            schema = {
                'sheet_name': self._sanitize_sheet_name(sheet_name),
                'columns': columns,
                'min_rows': 1,
                'max_rows': 100  # Default limit
            }

            # For job templates, return single schema
            # For workflows, could extend to support multiple sheets
            return [schema]

        except SurveyConversionError:
            raise
        except Exception as e:
            logger.exception(f"Error converting survey spec: {str(e)}")
            raise SurveyConversionError(f"Conversion failed: {str(e)}")

    def convert_field(self, field: Dict[str, Any]) -> Dict[str, Any]:
        # Extract basic info
        variable_name = field.get('variable', field.get('question_name', ''))
        if not variable_name:
            raise ValueError("Field missing variable/question_name")

        awx_type = field.get('type', 'text')
        fabrik_type = self.TYPE_MAPPING.get(awx_type, 'text')

        # Build column definition
        column = {
            'name': variable_name,
            'display_name': field.get('question_description', variable_name),
            'type': fabrik_type,
            'required': field.get('required', False),
            'help_text': field.get('question_description', ''),
        }

        # Add default value if present
        if 'default' in field and field['default']:
            column['default'] = field['default']

        # Add placeholder
        if fabrik_type in ['text', 'textarea', 'password']:
            column['placeholder'] = f"Enter {column['display_name']}"

        # Type-specific conversions
        if fabrik_type == 'number':
            self._add_number_constraints(column, field)
        elif fabrik_type in ['text', 'textarea', 'password']:
            self._add_text_constraints(column, field)
        elif fabrik_type in ['select', 'multiselect']:
            self._add_choice_constraints(column, field)

        return column

    def _add_number_constraints(self, column: Dict, field: Dict) -> None:
        if 'min' in field:
            try:
                column['min'] = float(field['min'])
            except (ValueError, TypeError):
                pass

        if 'max' in field:
            try:
                column['max'] = float(field['max'])
            except (ValueError, TypeError):
                pass

        # Generate validation regex if min/max present
        if 'min' in column or 'max' in column:
            validation_pattern = self.generate_number_validation_regex(
                column.get('min'),
                column.get('max'),
                field.get('type') == 'integer'
            )
            if validation_pattern:
                column['validation'] = validation_pattern

    def _add_text_constraints(self, column: Dict, field: Dict) -> None:
        if 'min' in field:
            try:
                column['min_length'] = int(field['min'])
            except (ValueError, TypeError):
                pass

        if 'max' in field:
            try:
                column['max_length'] = int(field['max'])
            except (ValueError, TypeError):
                pass

        # Generate validation regex
        validation_pattern = self.generate_text_validation_regex(
            column.get('min_length'),
            column.get('max_length')
        )
        if validation_pattern:
            column['validation'] = validation_pattern

    def _add_choice_constraints(self, column: Dict, field: Dict) -> None:
        choices = field.get('choices', '')

        if isinstance(choices, str):
            # AWX stores choices as newline-separated string
            choices_list = [c.strip() for c in choices.split('\n') if c.strip()]
        elif isinstance(choices, list):
            choices_list = choices
        else:
            choices_list = []

        if choices_list:
            column['enum_values'] = choices_list
        else:
            # No choices provided - this is unusual for select fields
            logger.warning(f"Select field '{column['name']}' has no choices")

    def generate_text_validation_regex(
        self,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None
    ) -> Optional[str]:
        if min_length is None and max_length is None:
            return None

        # Basic pattern: alphanumeric, spaces, dashes, underscores
        if min_length is not None and max_length is not None:
            return f"^[a-zA-Z0-9 _-]{{{min_length},{max_length}}}$"
        elif min_length is not None:
            return f"^[a-zA-Z0-9 _-]{{{min_length},}}$"
        elif max_length is not None:
            return f"^[a-zA-Z0-9 _-]{{1,{max_length}}}$"

        return None

    def generate_number_validation_regex(
        self,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        is_integer: bool = False
    ) -> Optional[str]:
        # Regex is for format validation only; complex min/max checks happen in backend
        if is_integer:
            # Integer pattern: optional minus, digits
            return r'^-?\d+$'
        else:
            # Float pattern: optional minus, digits, optional decimal point and digits
            return r'^-?\d+(\.\d+)?$'

    def _sanitize_sheet_name(self, name: str) -> str:
        # Remove invalid characters for Excel sheet names
        # Excel doesn't allow: : \ / ? * [ ]
        sanitized = re.sub(r'[:\\\/\?\*\[\]]', '_', name)

        # Limit length (Excel sheet names max 31 chars)
        if len(sanitized) > 31:
            sanitized = sanitized[:31]

        # Ensure not empty
        if not sanitized:
            sanitized = "Sheet1"

        return sanitized

    def validate_survey_spec(self, survey_spec: Dict[str, Any]) -> Tuple[bool, List[str]]:
        errors = []

        if not survey_spec:
            errors.append("Survey spec is empty")
            return False, errors

        if 'spec' not in survey_spec:
            errors.append("Survey spec missing 'spec' field")
            return False, errors

        spec_fields = survey_spec.get('spec', [])
        if not isinstance(spec_fields, list):
            errors.append("Survey 'spec' must be a list")
            return False, errors

        if not spec_fields:
            errors.append("Survey has no fields")
            return False, errors

        # Validate each field
        for i, field in enumerate(spec_fields):
            if not isinstance(field, dict):
                errors.append(f"Field {i}: Must be a dict")
                continue

            # Check required fields
            if 'variable' not in field and 'question_name' not in field:
                errors.append(f"Field {i}: Missing 'variable' or 'question_name'")

            if 'type' not in field:
                errors.append(f"Field {i}: Missing 'type'")
            elif field['type'] not in self.TYPE_MAPPING:
                errors.append(f"Field {i}: Unknown type '{field['type']}'")

        is_valid = len(errors) == 0
        return is_valid, errors
