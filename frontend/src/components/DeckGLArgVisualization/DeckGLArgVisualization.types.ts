// Re-export the existing types from the D3 implementation
export type {
    GraphNode,
    GraphEdge,
    GraphData,
    ForceDirectedGraphProps
} from '../ForceDirectedGraph/ForceDirectedGraph.types';

import type { GraphNode, GraphEdge, GraphData } from '../ForceDirectedGraph/ForceDirectedGraph.types';

// Additional types specific to deck.gl implementation
export interface DeckGLGraphProps {
    data: GraphData | null;
    width?: number;
    height?: number;
    onNodeClick?: (node: GraphNode) => void;
    onNodeHover?: (node: GraphNode | null) => void;
    focalNode?: GraphNode | null;
}

export interface PositionedNode extends GraphNode {
    x: number;
    y: number;
    radius: number;
    color: [number, number, number, number];
}

export interface PositionedEdge extends GraphEdge {
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    color: [number, number, number, number];
    width: number;
} 