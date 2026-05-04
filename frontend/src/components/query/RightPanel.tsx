// query/RightPanel.tsx
//
// Slide-in panel on the right side of the Query Builder canvas. Opens when a
// node is selected and renders the appropriate config form (ClassNodeConfig,
// FilterNodeConfig, etc.) based on the selected node type. Can be pinned open
// so it stays visible while the user clicks around the canvas.

import React, { useEffect } from 'react';
import { X, Pin, PinOff, CirclePlay, Boxes, SlidersHorizontal, Workflow, ArrowDownToLine, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/store/queryBuilderStore';
import { NodeType } from '@/types';
import { ClassNodeConfig } from '@/components/panels/ClassNodeConfig';
import { FilterNodeConfig } from '@/components/panels/FilterNodeConfig';
import { OutputNodeConfig } from '@/components/panels/OutputNodeConfig';
import { PostProcessorNodeConfig } from '@/components/panels/PostProcessorNodeConfig';
import { PipelineEdgeConfig } from '@/components/panels/PipelineEdgeConfig';
import ResizeHandle from './ResizeHandle';

interface RightPanelProps {
  className?: string;
}

export const RightPanel: React.FC<RightPanelProps> = ({ className }) => {
  const panelState = useQueryBuilderStore(state => state.panelState);
  const nodes = useQueryBuilderStore(state => state.nodes);
  const edges = useQueryBuilderStore(state => state.edges);
  const setPanelOpen = useQueryBuilderStore(state => state.setPanelOpen);
  const setPanelPinned = useQueryBuilderStore(state => state.setPanelPinned);
  const setPanelWidth = useQueryBuilderStore(state => state.setPanelWidth);

  const selectedNode = nodes.find(n => n.id === panelState.selectedNodeId);
  const selectedEdge = edges.find(e => e.id === panelState.selectedEdgeId);
  const isPipelineEdge = selectedEdge?.data?.edgeType === 'pipeline';

  // Auto-close on Escape (if not pinned)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelState.isOpen && !panelState.isPinned) {
        setPanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [panelState.isOpen, panelState.isPinned, setPanelOpen]);

  // Get node/edge type display
  const getNodeTypeDisplay = () => {
    if (isPipelineEdge) {
      return { icon: Zap, label: 'Pipeline Connection', description: 'Configure data flow between stages' };
    }
    switch (selectedNode?.type) {
      case NodeType.START:
        return { icon: CirclePlay, label: 'Start Node', description: 'Query entry point' };
      case NodeType.CLASS:
        return { icon: Boxes, label: 'Class Node', description: 'ACI class query' };
      case NodeType.FILTER:
        return { icon: SlidersHorizontal, label: 'Filter Node', description: 'Apply filters' };
      case NodeType.OUTPUT:
        return { icon: ArrowDownToLine, label: 'Output Node', description: 'Query results' };
      case NodeType.POST_PROCESSOR:
        return { icon: Workflow, label: 'Post Processor', description: 'Transform data' };
      default:
        return { icon: Boxes, label: 'Node', description: 'Configuration' };
    }
  };

  const nodeDisplay = getNodeTypeDisplay();
  const IconComponent = nodeDisplay.icon;

  // Don't render if not open
  if (!panelState.isOpen && !selectedNode && !isPipelineEdge) return null;

  return (
    <div
      className={cn(
        'fixed right-0 top-[112px] bottom-0',
        'bg-background border-l border-border',
        'flex flex-col transition-transform duration-300 ease-in-out',
        panelState.isOpen ? 'translate-x-0' : 'translate-x-full',
        className
      )}
      style={{ width: `${panelState.width}px` }}
    >
      {/* Header */}
      <div className="border-b border-border bg-muted/30">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded flex items-center justify-center bg-muted">
              <IconComponent className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-foreground">
                {nodeDisplay.label}
              </h3>
              <p className="text-xs text-muted-foreground">
                {nodeDisplay.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Pin button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanelPinned(!panelState.isPinned)}
              title={panelState.isPinned ? 'Unpin panel' : 'Pin panel'}
              className={cn(
                "h-8 w-8 p-0",
                panelState.isPinned && "bg-muted"
              )}
            >
              {panelState.isPinned ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
            </Button>

            {/* Close button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPanelOpen(false)}
              disabled={panelState.isPinned}
              title={panelState.isPinned ? 'Unpin to close' : 'Close panel'}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* START node */}
        {selectedNode?.type === NodeType.START && (
          <div className="p-6">
            <div className="bg-muted/50 rounded p-4 border border-border">
              <div className="text-sm text-foreground space-y-2">
                <p className="font-medium">Start Node</p>
                <p className="text-muted-foreground text-xs">
                  This is the entry point for your query. Connect it to CLASS nodes to begin building your query.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* CLASS node */}
        {selectedNode?.type === NodeType.CLASS && selectedNode.data && (
          <ClassNodeConfig nodeId={selectedNode.id} data={selectedNode.data as any} />
        )}

        {/* FILTER node */}
        {selectedNode?.type === NodeType.FILTER && selectedNode.data && (
          <FilterNodeConfig nodeId={selectedNode.id} data={selectedNode.data as any} />
        )}

        {/* OUTPUT node */}
        {selectedNode?.type === NodeType.OUTPUT && selectedNode.data && (
          <OutputNodeConfig nodeId={selectedNode.id} data={selectedNode.data as any} />
        )}

        {/* POST PROCESSOR node */}
        {selectedNode?.type === NodeType.POST_PROCESSOR && selectedNode.data && (
          <PostProcessorNodeConfig nodeId={selectedNode.id} data={selectedNode.data as any} />
        )}

        {/* PIPELINE edge */}
        {isPipelineEdge && selectedEdge && (
          <div className="p-6">
            <PipelineEdgeConfig edgeId={selectedEdge.id} />
          </div>
        )}
      </div>

      {/* Resize handle */}
      <ResizeHandle
        currentWidth={panelState.width}
        onWidthChange={setPanelWidth}
      />
    </div>
  );
};

export default RightPanel;
