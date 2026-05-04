# queries/services/postprocessor.py
#
# This is the backend implementation of the post-processor pipeline. It mirrors
# what the frontend PostProcessorEngine does — same processor types, same config
# keys — so that scheduled tasks produce identical output to what the user sees
# in the query builder UI.
#
# Each processor gets the output of the previous one as input. The pipeline is
# defined by the list of PostProcessor nodes attached to a SavedQuery in flow_data.
#
# Processor types:
#   dn-extract        — pull specific attributes (usually dn) out of raw APIC imdata
#   regex-transform   — sed-like substitution on strings/lists
#   array-sort        — sort with optional dedup, numeric, reverse
#   pattern-filter    — include/exclude filtering by regex (like grep)
#   field-extract     — pick specific fields from objects, optionally preserving nesting
#   flatten           — flatten nested arrays or dict keys
#   map-transform     — project each item to a field or leave it as-is
#   text-operations   — split, join, trim, upper/lower, replace, substring
#   aggregate         — count, sum, avg, min, max, group-by
#
# Design note: if a processor step fails, the exception propagates up to the caller
# (execute_scheduled_task) which logs the error and
# falls back to the original unprocessed data. We never silently eat errors here.

import copy
import re
from typing import Any, Dict, List


class PostProcessorEngine:

    @staticmethod
    def execute(data: Any, processors: List[Dict[str, Any]]) -> Any:
        """Run the full processor chain on data.

        Each processor receives the output of the previous one. If a processor
        raises, we wrap and re-raise with enough context to identify which step
        failed — makes debugging scheduled task logs much easier.
        """
        # Normalize APIC envelope to flat imdata list before the PP chain.
        # Most processors expect a list; without this, any PP other than
        # dn-extract would fail silently when used as the first processor.
        result = data
        if isinstance(data, dict) and 'imdata' in data:
            result = data['imdata']

        for processor in processors:
            try:
                processor_type = processor.get('data', {}).get('processorType')
                config = processor.get('data', {}).get('config', {})

                # Nodes without a processorType are probably non-processor canvas nodes
                # (output nodes, etc.) — just skip them.
                if not processor_type:
                    continue

                result = PostProcessorEngine._execute_processor(result, processor_type, config)
            except Exception as e:
                raise Exception(f"Post-processor '{processor_type}' failed: {str(e)}")

        return result

    @staticmethod
    def _execute_processor(data: Any, processor_type: str, config: Dict[str, Any]) -> Any:
        # Dispatch table keeps the execute() method clean and makes it easy to
        # add new processor types without touching the main loop.
        processors = {
            'filter_rows': PostProcessorEngine._filter_rows,
            'dn-extract': PostProcessorEngine._dn_extract,
            'regex-transform': PostProcessorEngine._regex_transform,
            'array-sort': PostProcessorEngine._array_sort,
            'pattern-filter': PostProcessorEngine._pattern_filter,
            'field-extract': PostProcessorEngine._field_extract,
            'flatten': PostProcessorEngine._flatten,
            'map-transform': PostProcessorEngine._map_transform,
            'text-operations': PostProcessorEngine._text_operations,
            'aggregate': PostProcessorEngine._aggregate,
        }

        if processor_type not in processors:
            raise ValueError(f"Unknown processor type: {processor_type}")

        return processors[processor_type](data, config)

    # ========================================================================
    # Filter Rows
    # ========================================================================

    @staticmethod
    def _filter_rows(data: Any, config: Dict[str, Any]) -> List[Any]:
        """Filter array items by a simple condition expression.

        Condition syntax: item.FIELD OP VALUE
          item.operSt !== 'established'
          item.count > 0
          item.attributes.state === 'active'

        Supported operators: === == !== != > < >= <=
        Value literals: 'string', "string", number, true, false, null

        Intentionally limited — no eval(), no arbitrary code. The expression
        parser handles the patterns that come up constantly in APIC data.
        """
        if not isinstance(data, list):
            raise ValueError("Filter Rows requires array input")

        condition = (config.get('condition') or '').strip()
        if not condition:
            return data

        m = re.match(
            r'item\.([a-zA-Z0-9_.]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)',
            condition,
        )
        if not m:
            raise ValueError(
                f"Unsupported condition format: {condition!r}. "
                "Expected: item.field op value  "
                "(e.g.  item.operSt !== 'established')"
            )

        field, op, raw = m.groups()
        raw = raw.strip()

        # Parse the value literal
        if (raw.startswith("'") and raw.endswith("'")) or \
                (raw.startswith('"') and raw.endswith('"')):
            value: Any = raw[1:-1]
        elif raw == 'true':
            value = True
        elif raw == 'false':
            value = False
        elif raw in ('null', 'undefined', 'None'):
            value = None
        else:
            try:
                value = int(raw)
            except ValueError:
                try:
                    value = float(raw)
                except ValueError:
                    value = raw  # bare word treated as string

        def passes(item: Any) -> bool:
            item_val = PostProcessorEngine._get_nested_value(item, field)

            if op in ('===', '=='):
                # Coerce numeric item value against string literal and vice-versa
                if isinstance(item_val, (int, float)) and isinstance(value, str):
                    try:
                        return item_val == float(value)
                    except ValueError:
                        pass
                return item_val == value

            if op in ('!==', '!='):
                if isinstance(item_val, (int, float)) and isinstance(value, str):
                    try:
                        return item_val != float(value)
                    except ValueError:
                        pass
                return item_val != value

            # Numeric comparisons — coerce both sides to float
            try:
                a, b = float(item_val), float(value)  # type: ignore[arg-type]
            except (TypeError, ValueError):
                return False

            if op == '>': return a > b
            if op == '<': return a < b
            if op == '>=': return a >= b
            if op == '<=': return a <= b
            return True

        return [item for item in data if passes(item)]

    # ========================================================================
    # DN Extract
    # ========================================================================

    @staticmethod
    def _dn_extract(data: Any, config: Dict[str, Any]) -> List[str]:
        """Pull attribute values out of an APIC imdata response.

        APIC always returns objects in this shape:
            { "imdata": [ { "fvTenant": { "attributes": { "dn": "uni/tn-Prod", ... } } } ] }

        By default we extract the dn field, but extractField can be set to pull
        any other attribute (e.g. "name", "status", "modTs").

        removePrefix strips a leading string/pattern after extraction.
        extractPattern lets you pull a sub-match — use a capture group to get
        just the part you want, or no group to get the full match.
        """
        field = config.get('extractField', 'dn')
        dns = []

        # Accept both APIC envelope dict and pre-normalized imdata list.
        # execute() now normalizes to list, but we keep dict support for
        # callers that invoke _dn_extract directly.
        if isinstance(data, dict) and 'imdata' in data:
            items = data['imdata']
        elif isinstance(data, list):
            items = data
        else:
            return dns

        for item in items:
            if not isinstance(item, dict):
                continue
            for class_name, obj in item.items():
                if isinstance(obj, dict) and 'attributes' in obj:
                    attrs = obj['attributes']
                    if isinstance(attrs, dict) and field in attrs:
                        value = str(attrs[field])

                        if config.get('removePrefix'):
                            value = re.sub(config['removePrefix'], '', value)

                        if config.get('extractPattern'):
                            match = re.search(config['extractPattern'], value)
                            if match:
                                value = match.group(1) if match.groups() else match.group(0)

                        dns.append(value)

        return dns

    # ========================================================================
    # Regex Transform
    # ========================================================================

    @staticmethod
    def _regex_transform(data: Any, config: Dict[str, Any]) -> Any:
        """Apply a regex substitution across strings or lists of strings.

        The frontend uses JavaScript-style flags ('g', 'i', 'm', 'gi', etc.)
        and JavaScript-style replacement back-references ('$1', '$2', '$&').
        We ignore 'g' because Python's re.sub() always replaces all matches.
        We translate 'i' and 'm' to Python flags, and rewrite '$N' / '$&'
        back-references to Python's '\\N' / '\\g<0>' form so capture groups
        actually expand instead of being inserted literally.

        For dict items inside a list, an optional ``field`` config selects
        the value to transform in place (e.g. field='dn' rewrites only the
        DN string and leaves the rest of the row untouched). Without
        ``field``, dicts pass through unchanged — applying a regex to
        repr(dict) is almost never what the user wants.
        """
        pattern = config.get('pattern', '')
        replacement = config.get('replacement', '')
        flags_str = config.get('flags', 'g')
        # The frontend type calls this `applyTo`; accept either name.
        field = config.get('applyTo') or config.get('field')

        flags = 0
        if 'i' in flags_str:
            flags |= re.IGNORECASE
        if 'm' in flags_str:
            flags |= re.MULTILINE

        regex = re.compile(pattern, flags)
        py_replacement = PostProcessorEngine._js_to_python_replacement(replacement)

        def transform_str(value: str) -> str:
            return regex.sub(py_replacement, value)

        # Deep-copy any dict items we mutate so other processors / preview
        # consumers see the original data, not our in-place rewrites.
        if isinstance(data, list):
            out = []
            for item in data:
                if isinstance(item, str):
                    out.append(transform_str(item))
                elif isinstance(item, dict) and field:
                    new_item = copy.deepcopy(item)
                    val = PostProcessorEngine._get_nested_value(new_item, field)
                    if isinstance(val, str):
                        PostProcessorEngine._set_nested_value(new_item, field, transform_str(val))
                    out.append(new_item)
                else:
                    out.append(item)
            return out
        elif isinstance(data, str):
            return transform_str(data)
        elif isinstance(data, dict) and field:
            new_item = copy.deepcopy(data)
            val = PostProcessorEngine._get_nested_value(new_item, field)
            if isinstance(val, str):
                PostProcessorEngine._set_nested_value(new_item, field, transform_str(val))
            return new_item

        return data

    @staticmethod
    def _js_to_python_replacement(replacement: str) -> str:
        """Translate JS-style back-references ($1, $&) to Python's \\1, \\g<0>.

        Also escapes any literal backslashes the user typed so they survive
        the substitution unchanged.
        """
        if not replacement:
            return replacement
        # Escape literal backslashes first so we don't double-process below.
        out = replacement.replace('\\', '\\\\')
        # $$  → literal $
        out = out.replace('$$', '\x00ESC_DOLLAR\x00')
        # $&  → entire match
        out = re.sub(r'\$&', r'\\g<0>', out)
        # $1..$99 → \1..\99
        out = re.sub(r'\$(\d{1,2})', r'\\\1', out)
        # restore literal $
        out = out.replace('\x00ESC_DOLLAR\x00', '$')
        return out

    # ========================================================================
    # Array Sort
    # ========================================================================

    @staticmethod
    def _array_sort(data: Any, config: Dict[str, Any]) -> List[Any]:
        """Sort an array with optional dedup, numeric comparison, and reversal.

        Order of operations: sort first, then dedup, then reverse. This means
        reverse=True with unique=True gives you the largest/last unique values,
        which is usually what you want.

        For numeric sort, we coerce to float so "10" sorts after "9" instead of
        before it (lexicographic ordering bites people constantly with APIC data).
        """
        if not isinstance(data, list):
            raise ValueError("Array Sort requires array input")

        result = list(data)
        field = config.get('field')

        if config.get('numeric'):
            if field:
                result.sort(key=lambda x: float(PostProcessorEngine._get_nested_value(x, field) or 0))
            else:
                result.sort(key=lambda x: float(x) if isinstance(x, (int, float, str)) else 0)
        else:
            if field:
                result.sort(key=lambda x: str(PostProcessorEngine._get_nested_value(x, field) or ''))
            else:
                result.sort(key=lambda x: str(x))

        if config.get('unique'):
            if field:
                seen = set()
                unique_result = []
                for item in result:
                    val = str(PostProcessorEngine._get_nested_value(item, field))
                    if val not in seen:
                        seen.add(val)
                        unique_result.append(item)
                result = unique_result
            else:
                # dict.fromkeys() preserves insertion order while dropping dupes —
                # cleaner than the seen-set approach for flat lists.
                result = list(dict.fromkeys(result))

        if config.get('reverse'):
            result.reverse()

        return result

    # ========================================================================
    # Pattern Filter
    # ========================================================================

    @staticmethod
    def _pattern_filter(data: Any, config: Dict[str, Any]) -> List[Any]:
        """Filter items by include/exclude regex patterns.

        Include patterns use OR logic — an item passes if it matches ANY of them.
        Exclude patterns use OR logic too — an item is dropped if it matches ANY.
        Exclude check runs after include, so exclude always wins.

        If field is specified, the pattern is tested against that field's value
        rather than the whole item stringified.
        """
        if not isinstance(data, list):
            raise ValueError("Pattern Filter requires array input")

        field = config.get('field')
        case_sensitive = config.get('caseSensitive', False)
        include_patterns = config.get('includePatterns', [])
        exclude_patterns = config.get('excludePatterns', [])

        flags = 0 if case_sensitive else re.IGNORECASE

        def matches_item(item):
            value = str(PostProcessorEngine._get_nested_value(item, field) if field else item)

            if include_patterns:
                if not any(re.search(pattern, value, flags) for pattern in include_patterns):
                    return False

            if exclude_patterns:
                if any(re.search(pattern, value, flags) for pattern in exclude_patterns):
                    return False

            return True

        return [item for item in data if matches_item(item)]

    # ========================================================================
    # Field Extract
    # ========================================================================

    @staticmethod
    def _field_extract(data: Any, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract specific fields from each object in an array.

        Two modes:
          keepStructure=False (default): flatten everything — all extracted
            values end up as top-level keys named by the last path segment.
            Good for table views.

          keepStructure=True: rebuild the original nesting. If you extract
            'attributes.dn' and 'attributes.name', you get back an object
            that still has the attributes.dn / attributes.name hierarchy.
            Useful when downstream processors expect nested input.
        """
        if not isinstance(data, list):
            raise ValueError("Field Extract requires array input")

        fields = config.get('fields', [])
        if not fields:
            raise ValueError("Field Extract requires at least one field")

        keep_structure = config.get('keepStructure', False)

        result = []
        for item in data:
            if keep_structure:
                extracted = {}
                for field in fields:
                    value = PostProcessorEngine._get_nested_value(item, field)
                    if value is not None:
                        # Walk the dotted path and build the nested dict on the way
                        keys = field.split('.')
                        current = extracted
                        for key in keys[:-1]:
                            if key not in current:
                                current[key] = {}
                            current = current[key]
                        current[keys[-1]] = value
                result.append(extracted)
            else:
                extracted = {}
                for field in fields:
                    value = PostProcessorEngine._get_nested_value(item, field)
                    if value is not None:
                        # Strip the path prefix — 'attributes.dn' becomes just 'dn'
                        last_key = field.split('.')[-1]
                        extracted[last_key] = value
                result.append(extracted)

        return result

    # ========================================================================
    # Flatten
    # ========================================================================

    @staticmethod
    def _flatten(data: Any, config: Dict[str, Any]) -> Any:
        """Flatten nested arrays or nested dicts.

        For arrays: depth controls how many levels to unwrap. depth=0 means
        flatten completely (we convert it to infinity internally). depth=1
        is the default — only unwrap one level.

        For dicts: keys are joined with the separator to create a flat key
        space. Useful after dn-extract when you want a flat object for a
        table renderer.
        """
        if isinstance(data, list):
            depth = config.get('depth', 1)
            # depth=0 is the UI's "unlimited" value
            if depth == 0:
                depth = float('inf')

            def flatten_array(arr, d):
                if d <= 0:
                    return arr
                result = []
                for item in arr:
                    if isinstance(item, list):
                        result.extend(flatten_array(item, d - 1))
                    else:
                        result.append(item)
                return result

            return flatten_array(data, depth)

        elif isinstance(data, dict):
            separator = config.get('separator', '.')
            result = {}

            def flatten_dict(obj, prefix=''):
                for key, value in obj.items():
                    new_key = f"{prefix}{separator}{key}" if prefix else key
                    if isinstance(value, dict):
                        flatten_dict(value, new_key)
                    else:
                        result[new_key] = value

            flatten_dict(data)
            return result

        return data

    # ========================================================================
    # Map Transform
    # ========================================================================

    @staticmethod
    def _map_transform(data: Any, config: Dict[str, Any]) -> List[Any]:
        """Project each item through a simple expression.

        We deliberately don't use eval() here. The expression language is
        intentionally limited to 'item' (identity) and 'item.some.path'
        (field access). Anything more complex should be done on the frontend
        where the user has a full JavaScript engine available.

        If the expression doesn't match either pattern, we return the item
        unchanged rather than raising. Silent passthrough is better than
        breaking the whole pipeline for a misconfigured expression.
        """
        if not isinstance(data, list):
            raise ValueError("Map Transform requires array input")

        expression = config.get('expression', 'item')

        result = []
        for item in data:
            if expression == 'item':
                result.append(item)
            elif expression.startswith('item.'):
                field_path = expression[5:]  # strip the "item." prefix
                value = PostProcessorEngine._get_nested_value(item, field_path)
                result.append(value)
            else:
                # Unknown expression — pass through rather than crashing
                result.append(item)

        return result

    # ========================================================================
    # Text Operations
    # ========================================================================

    @staticmethod
    def _text_operations(data: Any, config: Dict[str, Any]) -> Any:
        """Common string operations across scalars or lists.

        'join' is special-cased before the list check because when you join
        a list you get a single string back — you don't want to apply join
        to each element individually.

        For everything else, if data is a list we map the operation over
        every element. If it's a scalar we apply it once.
        """
        operation = config.get('operation', 'trim')

        def process_string(text: str) -> Any:
            if operation == 'split':
                separator = config.get('separator', ',')
                limit = config.get('limit')
                return text.split(separator, limit) if limit else text.split(separator)

            elif operation == 'join':
                # This path only runs when data is a scalar (edge case)
                if isinstance(data, list):
                    delimiter = config.get('delimiter', ',')
                    return delimiter.join(str(x) for x in data)
                return text

            elif operation == 'trim':
                return text.strip()

            elif operation == 'upper':
                return text.upper()

            elif operation == 'lower':
                return text.lower()

            elif operation == 'replace':
                find = config.get('find', '')
                replace_with = config.get('replaceWith', '')
                return re.sub(find, replace_with, text)

            elif operation == 'substring':
                start = config.get('start', 0)
                end = config.get('end')
                return text[start:end] if end else text[start:]

            return text

        # Handle join on the whole list before element-wise dispatch
        if operation == 'join' and isinstance(data, list):
            delimiter = config.get('delimiter', ',')
            return delimiter.join(str(x) for x in data)

        if isinstance(data, list):
            return [process_string(str(item)) for item in data]

        return process_string(str(data))

    # ========================================================================
    # Aggregate
    # ========================================================================

    @staticmethod
    def _aggregate(data: Any, config: Dict[str, Any]) -> Any:
        """Aggregate an array down to a single value or a grouped dict.

        For sum/avg/min/max, APIC often returns numbers as strings (e.g.
        "1024" not 1024). We try to coerce to float and silently skip items
        that can't be converted — better than crashing on one bad row.

        'group' is the exception: it returns a dict of {group_key: [items]}
        rather than a scalar. Subsequent processors need to handle that shape.
        """
        if not isinstance(data, list):
            raise ValueError("Aggregate requires array input")

        operation = config.get('operation', 'count')

        if operation == 'count':
            return len(data)

        elif operation == 'sum':
            field = config.get('field')
            if not field:
                raise ValueError("Sum requires a field")
            total = 0
            for item in data:
                value = PostProcessorEngine._get_nested_value(item, field)
                if isinstance(value, (int, float)):
                    total += value
                elif isinstance(value, str):
                    try:
                        total += float(value)
                    except ValueError:
                        pass
            return total

        elif operation == 'avg':
            field = config.get('field')
            if not field:
                raise ValueError("Average requires a field")
            total = 0
            count = 0
            for item in data:
                value = PostProcessorEngine._get_nested_value(item, field)
                if isinstance(value, (int, float)):
                    total += value
                    count += 1
                elif isinstance(value, str):
                    try:
                        total += float(value)
                        count += 1
                    except ValueError:
                        pass
            return total / count if count > 0 else 0

        elif operation == 'min':
            field = config.get('field')
            if not field:
                raise ValueError("Min requires a field")
            values = []
            for item in data:
                value = PostProcessorEngine._get_nested_value(item, field)
                if isinstance(value, (int, float)):
                    values.append(value)
                elif isinstance(value, str):
                    try:
                        values.append(float(value))
                    except ValueError:
                        pass
            return min(values) if values else None

        elif operation == 'max':
            field = config.get('field')
            if not field:
                raise ValueError("Max requires a field")
            values = []
            for item in data:
                value = PostProcessorEngine._get_nested_value(item, field)
                if isinstance(value, (int, float)):
                    values.append(value)
                elif isinstance(value, str):
                    try:
                        values.append(float(value))
                    except ValueError:
                        pass
            return max(values) if values else None

        elif operation == 'group':
            group_by = config.get('groupBy')
            if not group_by:
                raise ValueError("Group requires groupBy field")

            groups = {}
            for item in data:
                key = str(PostProcessorEngine._get_nested_value(item, group_by))
                if key not in groups:
                    groups[key] = []
                groups[key].append(item)

            return groups

        else:
            raise ValueError(f"Unknown aggregate operation: {operation}")

    # ========================================================================
    # Helpers
    # ========================================================================

    @staticmethod
    def _get_nested_value(obj: Any, path: str) -> Any:
        """Walk a dot-separated path through a dict and return the value.

        Returns None if any segment along the way is missing or if obj isn't
        a dict to begin with. Callers handle None by skipping the item rather
        than raising, which keeps the pipeline resilient to missing fields.

        Transparently unwraps APIC envelope format: if the root dict has a
        single key whose value is another dict (e.g. {"fvTenant": {"attributes": ...}}),
        and the path doesn't match at the root level, we retry inside the
        envelope so users can write "attributes.name" instead of "fvTenant.attributes.name".
        """
        if not isinstance(obj, dict):
            return None

        result = PostProcessorEngine._walk_path(obj, path)
        if result is not None:
            return result

        # APIC envelope unwrap: single-key dict wrapping the real object
        if len(obj) == 1:
            inner = next(iter(obj.values()))
            if isinstance(inner, dict):
                return PostProcessorEngine._walk_path(inner, path)

        return None

    @staticmethod
    def _set_nested_value(obj: Any, path: str, value: Any) -> None:
        """In-place write of a dot-separated path. Walks the same APIC
        envelope as _get_nested_value so set('dn', ...) on
        {"fvTenant": {"attributes": {...}}} writes to the nested dict.
        Silently no-ops if obj isn't a dict.
        """
        if not isinstance(obj, dict):
            return

        target = obj
        # Try direct path first; if the first segment isn't present, fall
        # through the single-key APIC envelope.
        head = path.split('.')[0]
        if head not in target and len(target) == 1:
            inner = next(iter(target.values()))
            if isinstance(inner, dict):
                target = inner

        parts = path.split('.')
        for segment in parts[:-1]:
            if not isinstance(target, dict) or segment not in target:
                return
            target = target[segment]
        if isinstance(target, dict):
            target[parts[-1]] = value

    @staticmethod
    def _walk_path(obj: dict, path: str) -> Any:
        """Walk a dot-separated path and return the value, or None."""
        current = obj
        for key in path.split('.'):
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None
        return current
