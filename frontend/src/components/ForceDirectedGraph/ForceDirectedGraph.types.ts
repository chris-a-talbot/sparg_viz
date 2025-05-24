export interface GraphNode {
    id: number;
    time: number;
    is_sample: boolean;
    individual: number;
    timeIndex?: number;
    layer?: number;  // For layered layout
    degree?: number; // For connectivity-based positioning
    location?: {
        x: number;
        y: number;
        z?: number;  // Optional Z coordinate for 3D locations
    };
    // D3 force simulation will add these properties
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
    // New properties for combined nodes
    is_combined?: boolean;
    combined_nodes?: number[]; // Array of original node IDs that were combined
}

export interface GraphEdge {
    source: number | GraphNode;
    target: number | GraphNode;
    left: number;
    right: number;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    metadata: {
        num_nodes: number;
        num_edges: number;
        num_samples: number;
        sequence_length: number;
        is_subset: boolean;
        original_num_nodes: number;
        original_num_edges: number;
        genomic_start?: number;
        genomic_end?: number;
        num_local_trees?: number;
    };
}

export interface ForceDirectedGraphProps {
    data: GraphData | null;
    width?: number;
    height?: number;
    onNodeClick?: (node: GraphNode) => void;
    onNodeRightClick?: (node: GraphNode) => void;  // Right click handler for nodes
    onEdgeClick?: (edge: GraphEdge) => void;
    focalNode?: GraphNode | null;  // The node to focus on, if any
} 