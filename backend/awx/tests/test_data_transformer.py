"""
DataTransformer Service Tests

Tests for transform_input_to_ansible_vars, validate_against_schema,
apply_variable_mapping, and nested path support.
"""

from django.test import SimpleTestCase

from awx.services.data_transformer import DataTransformer


class TransformInputToAnsibleVarsTests(SimpleTestCase):
    """Tests for DataTransformer.transform_input_to_ansible_vars"""

    def setUp(self):
        self.dt = DataTransformer()

    def test_basic_flat_mapping(self):
        input_data = {'data': [{'tenant_name': 'prod', 'vrf_name': 'default'}]}
        mappings = {'tenant_name': 'tenant', 'vrf_name': 'vrf'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        self.assertEqual(result, {'data': [{'tenant': 'prod', 'vrf': 'default'}]})

    def test_nested_path_mapping(self):
        input_data = {'data': [{'vlan_id': 100}]}
        mappings = {'vlan_id': 'vlan.id'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        self.assertEqual(result['data'][0], {'vlan': {'id': 100}})

    def test_deep_nested_path(self):
        input_data = {'data': [{'encap': 'vlan-100'}]}
        mappings = {'encap': 'network.vlan.encap'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        self.assertEqual(result['data'][0], {'network': {'vlan': {'encap': 'vlan-100'}}})

    def test_mixed_flat_and_nested(self):
        input_data = {'data': [{'tenant': 'prod', 'vlan_id': 100}]}
        mappings = {'tenant': 'tenant', 'vlan_id': 'vlan.id'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        row = result['data'][0]
        self.assertEqual(row['tenant'], 'prod')
        self.assertEqual(row['vlan']['id'], 100)

    def test_multiple_rows_transformed(self):
        input_data = {'data': [
            {'tenant_name': 'prod'},
            {'tenant_name': 'dev'},
        ]}
        mappings = {'tenant_name': 'tenant'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        self.assertEqual(len(result['data']), 2)
        self.assertEqual(result['data'][0]['tenant'], 'prod')
        self.assertEqual(result['data'][1]['tenant'], 'dev')

    def test_empty_data_returns_empty_dict(self):
        result = self.dt.transform_input_to_ansible_vars({'data': []}, {'a': 'b'})
        self.assertEqual(result, {})

    def test_no_mappings_returns_data_as_is(self):
        input_data = {'data': [{'col': 'val'}]}
        result = self.dt.transform_input_to_ansible_vars(input_data, {})
        self.assertEqual(result, {'data': [{'col': 'val'}]})

    def test_unmapped_column_uses_original_name(self):
        """Columns not in mappings are passed through with their original name."""
        input_data = {'data': [{'tenant_name': 'prod', 'extra_col': 'x'}]}
        mappings = {'tenant_name': 'tenant'}
        result = self.dt.transform_input_to_ansible_vars(input_data, mappings)
        row = result['data'][0]
        self.assertEqual(row['tenant'], 'prod')
        self.assertEqual(row['extra_col'], 'x')


# ── apply_variable_mapping ────────────────────────────────────────────────────

class ApplyVariableMappingTests(SimpleTestCase):
    """Tests for DataTransformer.apply_variable_mapping"""

    def setUp(self):
        self.dt = DataTransformer()

    def test_flat_mapping(self):
        row = {'tenant_name': 'prod'}
        mapping = {'tenant_name': 'tenant'}
        result = self.dt.apply_variable_mapping(row, mapping)
        self.assertEqual(result, {'tenant': 'prod'})

    def test_nested_path(self):
        row = {'vlan_id': 200}
        mapping = {'vlan_id': 'vlan.id'}
        result = self.dt.apply_variable_mapping(row, mapping)
        self.assertEqual(result, {'vlan': {'id': 200}})

    def test_column_not_in_row_is_skipped(self):
        row = {'existing_col': 'value'}
        mapping = {'existing_col': 'var', 'missing_col': 'other_var'}
        result = self.dt.apply_variable_mapping(row, mapping)
        self.assertIn('var', result)
        self.assertNotIn('other_var', result)

    def test_multiple_nested_paths_merged(self):
        row = {'vlan_id': 100, 'vlan_name': 'prod'}
        mapping = {'vlan_id': 'vlan.id', 'vlan_name': 'vlan.name'}
        result = self.dt.apply_variable_mapping(row, mapping)
        self.assertEqual(result, {'vlan': {'id': 100, 'name': 'prod'}})

    def test_empty_row_returns_empty_dict(self):
        result = self.dt.apply_variable_mapping({}, {'a': 'b'})
        self.assertEqual(result, {})

    def test_empty_mapping_returns_empty_dict(self):
        result = self.dt.apply_variable_mapping({'col': 'val'}, {})
        self.assertEqual(result, {})


# ── validate_against_schema ───────────────────────────────────────────────────

class ValidateAgainstSchemaTests(SimpleTestCase):
    """Tests for DataTransformer.validate_against_schema"""

    def setUp(self):
        self.dt = DataTransformer()
        self.schema = [{
            'name': 'Sheet1',
            'awx_variable_name': 'sheet1',
            'columns': [
                {'name': 'tenant_name', 'type': 'text', 'required': True},
                {'name': 'vlan_id', 'type': 'number', 'required': False},
            ],
        }]

    def test_valid_data_passes(self):
        data = {'data': [{'tenant_name': 'prod', 'vlan_id': 100}]}
        is_valid, errors = self.dt.validate_against_schema(data, self.schema)
        self.assertTrue(is_valid)
        self.assertEqual(errors, [])

    def test_missing_required_field_fails(self):
        data = {'data': [{'tenant_name': ''}]}
        is_valid, errors = self.dt.validate_against_schema(data, self.schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('tenant_name' in e or 'Required' in e or 'missing' in e.lower() for e in errors))

    def test_invalid_number_type_fails(self):
        data = {'data': [{'tenant_name': 'prod', 'vlan_id': 'not-a-number'}]}
        is_valid, errors = self.dt.validate_against_schema(data, self.schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('number' in e.lower() or 'vlan_id' in e for e in errors))

    def test_list_input_format_accepted(self):
        data = [{'tenant_name': 'prod'}]
        is_valid, errors = self.dt.validate_against_schema(data, self.schema)
        self.assertTrue(is_valid)

    def test_empty_data_is_valid(self):
        is_valid, errors = self.dt.validate_against_schema({'data': []}, self.schema)
        self.assertTrue(is_valid)

    def test_no_schema_returns_valid(self):
        is_valid, errors = self.dt.validate_against_schema({'data': [{'x': 1}]}, [])
        self.assertTrue(is_valid)

    def test_min_rows_constraint(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'col', 'type': 'text', 'required': True}],
            'min_rows': 2,
        }]
        data = {'data': [{'col': 'only-one-row'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('minimum' in e.lower() or 'min' in e.lower() for e in errors))

    def test_max_rows_constraint(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'col', 'type': 'text', 'required': True}],
            'max_rows': 2,
        }]
        data = {'data': [{'col': 'a'}, {'col': 'b'}, {'col': 'c'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('maximum' in e.lower() or 'max' in e.lower() for e in errors))

    def test_number_min_constraint(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'vlan_id', 'type': 'number', 'required': False, 'min': 1, 'max': 4094}],
        }]
        data = {'data': [{'vlan_id': 0}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('at least' in e or 'minimum' in e.lower() for e in errors))

    def test_number_max_constraint(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'vlan_id', 'type': 'number', 'required': False, 'min': 1, 'max': 4094}],
        }]
        data = {'data': [{'vlan_id': 9999}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)
        self.assertTrue(any('at most' in e or 'maximum' in e.lower() for e in errors))

    def test_text_max_length_constraint(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'name', 'type': 'text', 'required': True, 'max_length': 5}],
        }]
        data = {'data': [{'name': 'toolongvalue'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)

    def test_regex_validation_passes(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'tenant_name', 'type': 'text', 'required': True,
                'validation': r'^[a-zA-Z0-9_-]+$',
            }],
        }]
        data = {'data': [{'tenant_name': 'valid-name_123'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertTrue(is_valid)

    def test_regex_validation_fails(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'tenant_name', 'type': 'text', 'required': True,
                'validation': r'^[a-z]+$',
            }],
        }]
        data = {'data': [{'tenant_name': 'Invalid Name 123'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)

    def test_boolean_invalid_value_fails(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'enabled', 'type': 'boolean', 'required': False}],
        }]
        data = {'data': [{'enabled': 'maybe'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)

    def test_boolean_valid_values_pass(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'enabled', 'type': 'boolean', 'required': False}],
        }]
        for val in [True, False, 'true', 'false', '1', '0', 1, 0]:
            data = {'data': [{'enabled': val}]}
            is_valid, _ = self.dt.validate_against_schema(data, schema)
            self.assertTrue(is_valid, f"Expected valid for boolean value: {val!r}")

    def test_select_valid_enum_passes(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'env', 'type': 'select', 'required': False,
                'enum_values': ['prod', 'dev', 'staging'],
            }],
        }]
        data = {'data': [{'env': 'prod'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertTrue(is_valid)

    def test_select_invalid_enum_fails(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'env', 'type': 'select', 'required': False,
                'enum_values': ['prod', 'dev'],
            }],
        }]
        data = {'data': [{'env': 'invalid'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)

    def test_multiselect_valid_list_passes(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'tags', 'type': 'multiselect', 'required': False,
                'enum_values': ['a', 'b', 'c'],
            }],
        }]
        data = {'data': [{'tags': ['a', 'b']}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertTrue(is_valid)

    def test_multiselect_invalid_value_fails(self):
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{
                'name': 'tags', 'type': 'multiselect', 'required': False,
                'enum_values': ['a', 'b'],
            }],
        }]
        data = {'data': [{'tags': ['a', 'unknown']}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)

    def test_error_count_capped_at_50(self):
        """Should stop collecting errors after 50 to prevent huge error lists."""
        schema = [{
            'name': 'S', 'awx_variable_name': 's',
            'columns': [{'name': 'col', 'type': 'text', 'required': True}],
        }]
        # 100 rows with missing required field
        data = {'data': [{'col': ''} for _ in range(100)]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertFalse(is_valid)
        # Should be capped: 50 errors + 1 "... and more errors" message = 52 max
        self.assertLessEqual(len(errors), 52)

    def test_multi_schema_dict_input_returns_valid(self):
        """Multi-schema workflow dict input is accepted as-is (no schema-level validation)."""
        schema = [
            {'name': 'S1', 'awx_variable_name': 'tenants', 'columns': []},
            {'name': 'S2', 'awx_variable_name': 'vrfs', 'columns': []},
        ]
        data = {'tenants': [{'name': 'prod'}], 'vrfs': [{'name': 'default'}]}
        is_valid, errors = self.dt.validate_against_schema(data, schema)
        self.assertTrue(is_valid)


# ── _set_nested_value ─────────────────────────────────────────────────────────

class SetNestedValueTests(SimpleTestCase):
    """Unit tests for the private _set_nested_value helper."""

    def setUp(self):
        self.dt = DataTransformer()

    def test_single_level(self):
        target = {}
        self.dt._set_nested_value(target, 'key', 'val')
        self.assertEqual(target, {'key': 'val'})

    def test_two_levels(self):
        target = {}
        self.dt._set_nested_value(target, 'a.b', 42)
        self.assertEqual(target, {'a': {'b': 42}})

    def test_three_levels(self):
        target = {}
        self.dt._set_nested_value(target, 'a.b.c', True)
        self.assertEqual(target, {'a': {'b': {'c': True}}})

    def test_does_not_overwrite_sibling_keys(self):
        target = {'a': {'existing': 1}}
        self.dt._set_nested_value(target, 'a.new_key', 2)
        self.assertEqual(target, {'a': {'existing': 1, 'new_key': 2}})

    def test_overwrites_existing_leaf(self):
        target = {'a': {'b': 'old'}}
        self.dt._set_nested_value(target, 'a.b', 'new')
        self.assertEqual(target['a']['b'], 'new')
