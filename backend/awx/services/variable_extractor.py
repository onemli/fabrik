# awx/services/variable_extractor.py
#
# Extracts variable names from AWX survey specs and Jinja2 playbook templates.
# Used when importing an AWX template into Fabrik to pre-populate the schema
# designer with the variables the playbook expects.
#
# Fuzzy matching (SequenceMatcher) is used for auto-mapping: if the survey has
# a variable "tenant_name" and the Fabrik schema has a column "TenantName",
# the matcher suggests a link rather than requiring exact-string equality.

import re
import logging
from typing import List, Dict, Tuple
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


class VariableExtractorError(Exception):
    """Base exception for variable extraction errors"""


class VariableExtractor:

    @staticmethod
    def extract_from_survey_spec(survey_spec: dict) -> Tuple[List[str], Dict[str, dict]]:
        variables = []
        metadata = {}

        try:
            spec_list = survey_spec.get('spec', [])

            for item in spec_list:
                var_name = item.get('variable')
                if not var_name:
                    logger.warning(f"Survey spec item missing 'variable' field: {item}")
                    continue

                variables.append(var_name)

                # Extract metadata
                var_meta = {
                    'name': var_name,
                    'question': item.get('question_name', var_name),
                    'description': item.get('question_description', ''),
                    'type': VariableExtractor._map_survey_type(item.get('type', 'text')),
                    'required': item.get('required', False),
                    'default': item.get('default'),
                }

                # Add type-specific constraints
                if item.get('type') in ['integer', 'float']:
                    if 'min' in item:
                        var_meta['min'] = item['min']
                    if 'max' in item:
                        var_meta['max'] = item['max']

                # Handle choices (for dropdown/multiplechoice)
                if 'choices' in item and item['choices']:
                    # AWX stores choices as newline-separated string
                    choices_str = item['choices']
                    if isinstance(choices_str, str):
                        var_meta['choices'] = [c.strip() for c in choices_str.split('\n') if c.strip()]
                    else:
                        var_meta['choices'] = choices_str

                # Regex validation (custom field if exists)
                if 'validation_regex' in item:
                    var_meta['validation'] = item['validation_regex']

                metadata[var_name] = var_meta

            logger.info(f"Extracted {len(variables)} variables from survey spec")
            return variables, metadata

        except Exception as e:
            logger.error(f"Error extracting variables from survey spec: {e}")
            raise VariableExtractorError(f"Failed to extract variables from survey spec: {e}")

    @staticmethod
    def _map_survey_type(awx_type: str) -> str:
        type_mapping = {
            'text': 'text',
            'textarea': 'text',
            'password': 'text',
            'integer': 'number',
            'float': 'number',
            'multiplechoice': 'dropdown',
            'multiselect': 'dropdown',
        }
        return type_mapping.get(awx_type, 'text')

    @staticmethod
    def extract_from_jinja2_template(yaml_content: str) -> List[str]:
        try:
            # Regex to find {{ variable_name }} patterns
            # Supports:
            # - {{ variable }}
            # - {{ variable | filter }}
            # - {{ variable.attribute }}
            # - {{variable}} (no spaces)
            pattern = r'\{\{\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*(?:\|[^}]*)?\}\}'

            matches = re.findall(pattern, yaml_content)

            # Remove duplicates and Ansible built-in variables
            builtin_vars = {
                'ansible_user', 'ansible_host', 'ansible_connection',
                'inventory_hostname', 'hostvars', 'groups', 'group_names',
                'ansible_facts', 'playbook_dir', 'role_path',
                'item', 'ansible_loop'  # Loop variables
            }

            # Filter out built-ins and split dotted variables (keep only base)
            variables = []
            for var in matches:
                # Split dotted access (e.g., "item.name" → "item")
                base_var = var.split('.')[0]
                if base_var not in builtin_vars and base_var not in variables:
                    variables.append(base_var)

            logger.info(f"Extracted {len(variables)} variables from Jinja2 template")
            return sorted(variables)

        except Exception as e:
            logger.error(f"Error extracting Jinja2 variables: {e}")
            raise VariableExtractorError(f"Failed to extract Jinja2 variables: {e}")

    @staticmethod
    def auto_map_columns_to_variables(
        column_names: List[str],
        variable_names: List[str],
        threshold: float = 0.6
    ) -> Dict[str, str]:
        # Fuzzy-matches column names to Ansible variable names (SequenceMatcher).
        mapping = {}

        try:
            for col_name in column_names:
                best_match = None
                best_score = 0.0

                col_lower = col_name.lower()

                for var_name in variable_names:
                    var_lower = var_name.lower()

                    # Exact match (case-insensitive)
                    if col_lower == var_lower:
                        best_match = var_name
                        best_score = 1.0
                        break

                    # Substring match (column contains variable or vice versa)
                    if var_lower in col_lower or col_lower in var_lower:
                        score = 0.85
                        if score > best_score:
                            best_match = var_name
                            best_score = score
                        continue

                    # Fuzzy string matching
                    score = SequenceMatcher(None, col_lower, var_lower).ratio()
                    if score > best_score:
                        best_match = var_name
                        best_score = score

                # Only map if score meets threshold
                if best_match and best_score >= threshold:
                    mapping[col_name] = best_match
                    logger.debug(f"Mapped '{col_name}' → '{best_match}' (score: {best_score:.2f})")
                else:
                    logger.warning(f"No good match found for column '{col_name}' (best score: {best_score:.2f})")

            logger.info(f"Auto-mapped {len(mapping)}/{len(column_names)} columns to variables")
            return mapping

        except Exception as e:
            logger.error(f"Error in auto-mapping: {e}")
            raise VariableExtractorError(f"Failed to auto-map columns to variables: {e}")

    @staticmethod
    def generate_table_schema_from_survey(
        survey_spec: dict,
        table_name: str = "data",
        display_name: str = "Data Configuration"
    ) -> Dict:
        try:
            variables, metadata = VariableExtractor.extract_from_survey_spec(survey_spec)

            columns = []
            for var_name, meta in metadata.items():
                column = {
                    'name': var_name,
                    'display_name': meta['question'],
                    'type': meta['type'],
                    'required': meta['required'],
                }

                if meta.get('description'):
                    column['help_text'] = meta['description']

                if meta.get('default') is not None:
                    column['default'] = meta['default']

                if meta.get('min') is not None:
                    column['min'] = meta['min']
                if meta.get('max') is not None:
                    column['max'] = meta['max']

                if meta.get('choices'):
                    column['choices'] = meta['choices']
                    column['type'] = 'dropdown'

                if meta.get('validation'):
                    column['validation'] = meta['validation']

                columns.append(column)

            schema = {
                'table_name': table_name,
                'display_name': display_name,
                'columns': columns
            }

            # Auto-generate variable mappings (1-to-1 since names match)
            variable_mappings = {var: f"{{{{ {var} }}}}" for var in variables}

            logger.info(f"Generated table schema with {len(columns)} columns")
            return schema, variable_mappings

        except Exception as e:
            logger.error(f"Error generating table schema from survey: {e}")
            raise VariableExtractorError(f"Failed to generate table schema: {e}")

    @staticmethod
    def validate_mapping(
        variable_mappings: Dict[str, str],
        detected_variables: List[str]
    ) -> Tuple[bool, List[str]]:
        try:
            # Extract variable names from mappings
            mapped_vars = set()
            for mapping_value in variable_mappings.values():
                # Parse {{ variable_name }} format
                match = re.search(r'\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}', mapping_value)
                if match:
                    mapped_vars.add(match.group(1))

            # Check for missing variables
            missing = [var for var in detected_variables if var not in mapped_vars]

            if missing:
                logger.warning(f"Unmapped variables: {missing}")
                return False, missing

            logger.info("All variables are properly mapped")
            return True, []

        except Exception as e:
            logger.error(f"Error validating mapping: {e}")
            return False, [f"Validation error: {e}"]


# Convenience instance
variable_extractor = VariableExtractor()
