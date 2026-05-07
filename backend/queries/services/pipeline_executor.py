# queries/services/pipeline_executor.py
#
# Executes multi-stage query pipelines where the output of one APIC query
# feeds as input to the next. Each stage is a self-contained sub-graph
# (class nodes + filters + post-processors) connected by pipeline edges.
#
# Pipeline edges carry configuration that controls how upstream data
# flows into the downstream query:
#   - filter_values: Build APIC filter expression from extracted values
#   - dn_scope:      Run MO queries scoped to each upstream DN, merge results
#   - iterate:       Fan-out — run downstream query once per upstream value
#
# The executor reuses the existing QueryIntent + QueryExecutor for per-stage
# query generation, and PostProcessorEngine for per-stage data transformation.

import logging
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional
from django.utils import timezone

from apic_connections.apic_client import APICClient
from queries.models import ChainExecutionJob, ChainIterationResult
from queries.services.postprocessor import PostProcessorEngine
from queries.services.response_flattener import maybe_flatten_response

logger = logging.getLogger(__name__)

# Safety limits
MAX_PIPELINE_STAGES = 10
MAX_FILTER_VALUES = 200
MAX_DN_SCOPE_VALUES = 50
MAX_ITERATE_VALUES = 100


class PipelineStage:
    """Parsed representation of a single pipeline stage."""

    def __init__(self, index: int, nodes: list, edges: list,
                 inject_config: Optional[dict] = None) -> None:
        self.index = index
        self.nodes = nodes
        self.edges = edges
        self.inject_config = inject_config or {}
        self.class_name = self._find_class_name()

    def _find_class_name(self) -> Optional[str]:
        for node in self.nodes:
            if node.get('type') == 'classNode':
                return node.get('data', {}).get('className')
        return None

    @property
    def inject_mode(self) -> str:
        return self.inject_config.get('injectAs', 'filter_values')

    @property
    def extract_field(self) -> str:
        return self.inject_config.get('extractField', 'dn')

    @property
    def inject_property(self) -> Optional[str]:
        return self.inject_config.get('injectProperty')


class PipelineExecutor:
    """Runs a multi-stage query pipeline against a single APIC connection."""

    def __init__(self, job: ChainExecutionJob, apic_client: APICClient) -> None:
        self.job = job
        self.apic_client = apic_client
        self.stage_results: List[dict] = []

    def execute(self) -> dict:
        """Run all pipeline stages sequentially.

        Returns a summary dict with per-stage results. Each stage's output
        feeds into the next stage as filter input according to the pipeline
        edge configuration.
        """
        stages = self._parse_pipeline_stages()
        if not stages:
            raise ValueError("No pipeline stages found in flow_data")

        if len(stages) > MAX_PIPELINE_STAGES:
            raise ValueError(f"Pipeline exceeds maximum of {MAX_PIPELINE_STAGES} stages")

        self.job.total_iterations = len(stages)
        self.job.pipeline_stages = [
            {'index': s.index, 'class_name': s.class_name,
             'inject_mode': s.inject_mode}
            for s in stages
        ]
        self.job.save(update_fields=['total_iterations', 'pipeline_stages'])

        upstream_result = None

        for stage in stages:
            self.job.current_stage_index = stage.index
            self.job.save(update_fields=['current_stage_index'])

            self._emit_progress(stage, 'executing')

            stage_start = time.time()
            try:
                result = self._execute_stage(stage, upstream_result)
                elapsed_ms = int((time.time() - stage_start) * 1000)

                stage_data = {
                    'stage_index': stage.index,
                    'class_name': stage.class_name,
                    'status': 'success',
                    'result': result,
                    'result_count': self._count_results(result),
                    'execution_time_ms': elapsed_ms,
                    'inject_mode': stage.inject_mode,
                }
                self.stage_results.append(stage_data)

                # Record as ChainIterationResult for per-stage tracking
                ChainIterationResult.objects.create(
                    job=self.job,
                    iteration_index=stage.index,
                    extracted_value=stage.class_name or f'stage_{stage.index}',
                    query_url=stage_data.get('query_url', ''),
                    status=ChainIterationResult.STATUS_SUCCESS,
                    result=result,
                    result_count=stage_data['result_count'],
                    execution_time_ms=elapsed_ms,
                    started_at=timezone.now() - timedelta(milliseconds=elapsed_ms),
                    completed_at=timezone.now(),
                )

                self.job.completed_iterations += 1
                self.job.save(update_fields=['completed_iterations'])

                upstream_result = result

            except Exception as e:
                elapsed_ms = int((time.time() - stage_start) * 1000)
                error_msg = str(e)
                logger.error(f"Pipeline stage {stage.index} failed: {error_msg}")

                self.stage_results.append({
                    'stage_index': stage.index,
                    'class_name': stage.class_name,
                    'status': 'failed',
                    'error': error_msg,
                    'execution_time_ms': elapsed_ms,
                })

                ChainIterationResult.objects.create(
                    job=self.job,
                    iteration_index=stage.index,
                    extracted_value=stage.class_name or f'stage_{stage.index}',
                    query_url='',
                    status=ChainIterationResult.STATUS_FAILED,
                    error_type=type(e).__name__,
                    error_message=error_msg,
                    execution_time_ms=elapsed_ms,
                    started_at=timezone.now() - timedelta(milliseconds=elapsed_ms),
                    completed_at=timezone.now(),
                )

                self.job.failed_iterations += 1
                self.job.save(update_fields=['failed_iterations'])

                # Pipeline stops on stage failure — partial results are still returned
                break

        return {
            'stages': self.stage_results,
            'total_stages': len(stages),
            'completed_stages': self.job.completed_iterations,
            'failed_stages': self.job.failed_iterations,
            'final_result': self.stage_results[-1].get('result') if self.stage_results else None,
        }

    def _parse_pipeline_stages(self) -> List[PipelineStage]:
        """Detect pipeline edges in flow_data and split into ordered stages.

        A pipeline edge is any edge with data.edgeType === 'pipeline'.
        Each group of connected nodes between pipeline edges forms one stage.
        """
        flow_data = self.job.chain_config.get('flow_data', {})
        all_nodes = flow_data.get('nodes', [])
        all_edges = flow_data.get('edges', [])

        # Separate pipeline edges from containment/normal edges
        pipeline_edges = [e for e in all_edges if e.get('data', {}).get('edgeType') == 'pipeline']
        normal_edges = [e for e in all_edges if e.get('data', {}).get('edgeType') != 'pipeline']

        if not pipeline_edges:
            # No pipeline edges — treat entire canvas as a single stage
            return [PipelineStage(index=0, nodes=all_nodes, edges=normal_edges)]

        # Build node-to-subgraph assignment using connected components on normal edges
        node_ids = {n['id'] for n in all_nodes}
        adj: Dict[str, set] = {nid: set() for nid in node_ids}
        for edge in normal_edges:
            src, tgt = edge.get('source'), edge.get('target')
            if src in node_ids and tgt in node_ids:
                adj[src].add(tgt)
                adj[tgt].add(src)

        visited = set()
        components: List[set] = []

        def bfs(start: str) -> set:
            queue = [start]
            comp = set()
            while queue:
                nid = queue.pop(0)
                if nid in visited:
                    continue
                visited.add(nid)
                comp.add(nid)
                for neighbor in adj[nid]:
                    if neighbor not in visited:
                        queue.append(neighbor)
            return comp

        for nid in node_ids:
            if nid not in visited:
                comp = bfs(nid)
                if comp:
                    components.append(comp)

        # Map each node to its component index
        node_to_comp: Dict[str, int] = {}
        for idx, comp in enumerate(components):
            for nid in comp:
                node_to_comp[nid] = idx

        # Build a DAG of component dependencies from pipeline edges
        # pipeline edge: source component → target component
        comp_order: List[int] = []
        comp_inject_config: Dict[int, dict] = {}
        in_edges: Dict[int, list] = {}

        for pe in pipeline_edges:
            src_comp = node_to_comp.get(pe['source'])
            tgt_comp = node_to_comp.get(pe['target'])
            if src_comp is not None and tgt_comp is not None and src_comp != tgt_comp:
                if tgt_comp not in in_edges:
                    in_edges[tgt_comp] = []
                in_edges[tgt_comp].append(src_comp)
                # Store injection config from the pipeline edge
                comp_inject_config[tgt_comp] = pe.get('data', {})

        # Topological sort of components (simple BFS-based)
        in_degree: Dict[int, int] = {i: 0 for i in range(len(components))}
        comp_adj: Dict[int, list] = {i: [] for i in range(len(components))}

        for pe in pipeline_edges:
            src_comp = node_to_comp.get(pe['source'])
            tgt_comp = node_to_comp.get(pe['target'])
            if src_comp is not None and tgt_comp is not None and src_comp != tgt_comp:
                comp_adj[src_comp].append(tgt_comp)
                in_degree[tgt_comp] += 1

        queue = [i for i in range(len(components)) if in_degree[i] == 0]
        while queue:
            ci = queue.pop(0)
            comp_order.append(ci)
            for neighbor in comp_adj.get(ci, []):
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # Build PipelineStage objects in topological order
        stages = []
        for order_idx, comp_idx in enumerate(comp_order):
            comp_node_ids = components[comp_idx]
            stage_nodes = [n for n in all_nodes if n['id'] in comp_node_ids]
            stage_edges = [e for e in normal_edges
                           if e['source'] in comp_node_ids and e['target'] in comp_node_ids]
            inject_config = comp_inject_config.get(comp_idx, {})

            # Only include stages that have at least one classNode
            has_class = any(n.get('type') == 'classNode' for n in stage_nodes)
            if has_class:
                stages.append(PipelineStage(
                    index=order_idx,
                    nodes=stage_nodes,
                    edges=stage_edges,
                    inject_config=inject_config,
                ))

        return stages

    def _execute_stage(self, stage: PipelineStage, upstream_result: Optional[Any]) -> Any:
        """Run a single pipeline stage: generate query, inject upstream data, execute."""
        from queries.services.optimizer import QueryIntent, QueryExecutor

        # Build the query from this stage's sub-graph
        flow_data = {'nodes': stage.nodes, 'edges': stage.edges}

        try:
            intent = QueryIntent(flow_data)
        except ValueError as e:
            raise ValueError(f"Stage {stage.index}: {e}")

        # If we have upstream data and this isn't the first stage, inject it
        if upstream_result is not None and stage.inject_config:
            upstream_values = self._extract_values(upstream_result, stage.extract_field)
            if not upstream_values:
                logger.warning(f"Stage {stage.index}: No values extracted from upstream result")
                return {'totalCount': '0', 'imdata': []}

            return self._execute_with_injection(stage, intent, upstream_values)

        # First stage or no injection — run normally
        executor = QueryExecutor()
        query_url, metadata = executor.execute(intent)

        success, result, error = self.apic_client.execute_query(query_url)
        if not success:
            raise RuntimeError(f"APIC query failed: {error}")

        # Normalize multi-class chain responses before PostProcessors run.
        if isinstance(result, dict):
            result = maybe_flatten_response(result, query_url)

        # Apply stage's post-processors
        result = self._apply_stage_postprocessors(stage, result)
        return result

    def _execute_with_injection(self, stage: PipelineStage, intent,
                                upstream_values: list) -> Any:
        """Execute a stage with upstream data injected as filters or DN scope."""
        mode = stage.inject_mode

        if mode == 'filter_values':
            return self._inject_as_filter(stage, intent, upstream_values)
        elif mode == 'dn_scope':
            return self._inject_as_dn_scope(stage, upstream_values)
        elif mode == 'iterate':
            return self._inject_as_iterate(stage, upstream_values)
        else:
            raise ValueError(f"Unknown inject mode: {mode}")

    def _inject_as_filter(self, stage: PipelineStage, intent,
                          upstream_values: list) -> Any:
        """Build a single query with upstream values as filter expressions."""
        if len(upstream_values) > MAX_FILTER_VALUES:
            logger.warning(
                f"Stage {stage.index}: Truncating {len(upstream_values)} values "
                f"to {MAX_FILTER_VALUES} for filter injection"
            )
            upstream_values = upstream_values[:MAX_FILTER_VALUES]

        from queries.services.optimizer import QueryExecutor
        executor = QueryExecutor()
        query_url, metadata = executor.execute(intent)

        # Build filter expression from upstream values
        inject_prop = stage.inject_property or f'{stage.class_name}.dn'
        filter_parts = [f'eq({inject_prop},"{v}")' for v in upstream_values]

        if len(filter_parts) == 1:
            injected_filter = filter_parts[0]
        else:
            injected_filter = f'or({",".join(filter_parts)})'

        # Append the injected filter to the query URL
        separator = '&' if '?' in query_url else '?'
        if 'query-target-filter=' in query_url:
            # Merge with existing filter using and()
            query_url = query_url.replace(
                'query-target-filter=',
                f'query-target-filter=and({injected_filter},'
            )
            # Close the and() — find the end of the existing filter value
            # Simple approach: append closing paren before next & or end of string
            parts = query_url.split('&')
            for i, part in enumerate(parts):
                if part.startswith('query-target-filter='):
                    parts[i] = part + ')'
                    break
            query_url = '&'.join(parts)
        else:
            query_url = f'{query_url}{separator}query-target-filter={injected_filter}'

        success, result, error = self.apic_client.execute_query(query_url)
        if not success:
            raise RuntimeError(f"APIC query failed: {error}")

        if isinstance(result, dict):
            result = maybe_flatten_response(result, query_url)

        result = self._apply_stage_postprocessors(stage, result)
        return result

    def _inject_as_dn_scope(self, stage: PipelineStage, upstream_values: list) -> Any:
        """Run MO queries scoped to each upstream DN, merge results."""
        if len(upstream_values) > MAX_DN_SCOPE_VALUES:
            logger.warning(
                f"Stage {stage.index}: Truncating {len(upstream_values)} DNs "
                f"to {MAX_DN_SCOPE_VALUES} for dn_scope injection"
            )
            upstream_values = upstream_values[:MAX_DN_SCOPE_VALUES]

        merged_imdata = []
        target_class = stage.class_name

        for dn in upstream_values:
            query_url = f'/api/mo/{dn}.json?query-target=subtree&target-subtree-class={target_class}'

            success, result, error = self.apic_client.execute_query(query_url)
            if success and isinstance(result, dict):
                # Defensive flatten: target-subtree-class usually yields flat
                # imdata, but stays correct if APIC ever returns nested.
                result = maybe_flatten_response(result, query_url)
                merged_imdata.extend(result.get('imdata', []))

        merged_result = {
            'totalCount': str(len(merged_imdata)),
            'imdata': merged_imdata,
        }

        merged_result = self._apply_stage_postprocessors(stage, merged_result)
        return merged_result

    def _inject_as_iterate(self, stage: PipelineStage, upstream_values: list) -> Any:
        """Fan-out: run downstream query once per upstream value."""
        if len(upstream_values) > MAX_ITERATE_VALUES:
            logger.warning(
                f"Stage {stage.index}: Truncating {len(upstream_values)} values "
                f"to {MAX_ITERATE_VALUES} for iterate injection"
            )
            upstream_values = upstream_values[:MAX_ITERATE_VALUES]

        from queries.services.optimizer import QueryIntent, QueryExecutor

        merged_imdata = []

        for value in upstream_values:
            # Clone the stage's flow_data and inject the value as a filter
            modified_nodes = self._inject_value_into_nodes(stage.nodes, value, stage)
            flow_data = {'nodes': modified_nodes, 'edges': stage.edges}

            try:
                intent = QueryIntent(flow_data)
                executor = QueryExecutor()
                query_url, _ = executor.execute(intent)

                success, result, error = self.apic_client.execute_query(query_url)
                if success and isinstance(result, dict):
                    result = maybe_flatten_response(result, query_url)
                    merged_imdata.extend(result.get('imdata', []))
            except Exception as e:
                logger.warning(f"Stage {stage.index} iterate failed for value '{value}': {e}")
                continue

        merged_result = {
            'totalCount': str(len(merged_imdata)),
            'imdata': merged_imdata,
        }

        merged_result = self._apply_stage_postprocessors(stage, merged_result)
        return merged_result

    def _inject_value_into_nodes(self, nodes: list, value: str,
                                 stage: PipelineStage) -> list:
        """Clone nodes and add a filter for the injected value.

        Adds a synthetic filter node connected to the class node that
        constrains the query to the injected value.
        """
        import copy
        modified = copy.deepcopy(nodes)

        # Find the class node
        class_node = next((n for n in modified if n.get('type') == 'classNode'), None)
        if not class_node:
            return modified

        inject_prop = stage.inject_property or 'dn'

        # Add a synthetic filter node
        synth_filter = {
            'id': f'_pipeline_inject_{stage.index}',
            'type': 'filterNode',
            'data': {
                'label': 'Pipeline Inject',
                'id': f'_pipeline_inject_{stage.index}',
                'filterType': 'property',
                'property': inject_prop,
                'operator': 'eq',
                'value': value,
            },
            'position': {'x': 0, 'y': 0},
        }
        modified.append(synth_filter)

        return modified

    def _extract_values(self, result: Any, field: str) -> list:
        """Extract values from APIC result for downstream injection.

        Supports extracting from standard imdata format or flat lists.
        """
        values = []

        if isinstance(result, dict):
            imdata = result.get('imdata', [])
            for item in imdata:
                val = self._extract_field_from_item(item, field)
                if val is not None:
                    values.append(str(val))
        elif isinstance(result, list):
            for item in result:
                if isinstance(item, dict):
                    val = self._extract_field_from_item(item, field)
                    if val is not None:
                        values.append(str(val))
                elif isinstance(item, str):
                    values.append(item)

        # Deduplicate while preserving order
        seen = set()
        unique = []
        for v in values:
            if v not in seen:
                seen.add(v)
                unique.append(v)

        return unique

    def _extract_field_from_item(self, item: dict, field: str) -> Any:
        """Extract a field from an APIC imdata item.

        APIC imdata items have the form: {"fvTenant": {"attributes": {"dn": "...", "name": "..."}}}
        We need to look inside the class wrapper to find the field.
        """
        if not isinstance(item, dict):
            return None

        # Try direct field access first (for post-processed flat data)
        if field in item:
            return item[field]

        # Try APIC envelope format: {className: {attributes: {field: value}}}
        for class_name, class_data in item.items():
            if isinstance(class_data, dict):
                attrs = class_data.get('attributes', {})
                if field in attrs:
                    return attrs[field]

        # Try dot-notation path
        parts = field.split('.')
        current = item
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        return current

    def _apply_stage_postprocessors(self, stage: PipelineStage, result: Any) -> Any:
        """Apply post-processors defined within this stage's sub-graph."""
        pp_nodes = [n for n in stage.nodes
                    if n.get('type') in ('postProcessorNode', 'post-processor')
                    and not n.get('data', {}).get('isPaused')]

        if not pp_nodes:
            return result

        try:
            return PostProcessorEngine.execute(result, pp_nodes)
        except Exception as e:
            logger.warning(f"Stage {stage.index} post-processor failed: {e}")
            return result

    def _count_results(self, result: Any) -> int:
        if isinstance(result, dict):
            if 'totalCount' in result:
                return int(result['totalCount'])
            if 'imdata' in result:
                return len(result['imdata'])
        if isinstance(result, list):
            return len(result)
        return 0

    def _emit_progress(self, stage: PipelineStage, status: str):
        """Emit pipeline progress via WebSocket."""
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        channel_layer = get_channel_layer()
        if not channel_layer:
            return

        total = self.job.total_iterations
        progress = int(((stage.index + 1) / max(total, 1)) * 100)
        message = f'Stage {stage.index + 1}/{total}: {stage.class_name or "processing"}...'

        async_to_sync(channel_layer.group_send)(
            f'execution_{self.job.id}',
            {
                'type': 'execution_progress',
                'progress': progress,
                'message': message,
                'stage_index': stage.index,
                'stage_status': status,
            }
        )
