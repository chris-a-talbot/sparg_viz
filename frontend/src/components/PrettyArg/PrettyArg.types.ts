export interface PrettyArgNode {
    id: number;
    index: number;
    label: string;
    ts_flags: number;
    time: number;
    child_of: number[];
    parent_of: number[];
    size: number;
    symbol: string;
    fill: string;
    stroke: string;
    stroke_width: number;
    include_label: boolean;
    fx?: number | undefined;
    fy?: number | undefined;
    x: number;
    y: number;
    vx: number;
    vy: number;
    x_pos_reference?: number;
}

export interface PrettyArgLink {
    id: number;
    source: number;
    target: number;
    bounds: string;
    alt_parent?: number;
    alt_child?: number;
    region_fraction: number;
    color: string;
}

export interface PrettyArgBreakpoint {
    start: number;
    stop: number;
    x_pos_01: number;
    x_pos: number;
    width_01: number;
    width: number;
    included: boolean;
}

export interface PrettyArgYAxis {
    include_labels: boolean;
    ticks: number[];
    text: string[];
    max_min: [number, number];
    scale: 'rank' | 'time' | 'log_time';
}

export interface PrettyArgNodeConfig {
    size: number;
    symbol: string;
    sample_symbol: string;
    subset_nodes: number[] | null;
    include_labels: boolean;
}

export interface PrettyArgEdgeConfig {
    type: 'line' | 'ortho';
    variable_width: boolean;
    include_underlink: boolean;
}

export interface PrettyArgData {
    data: {
        nodes: PrettyArgNode[];
        links: PrettyArgLink[];
        breakpoints: PrettyArgBreakpoint[];
    };
    evenly_distributed_positions: number[];
    width: number;
    height: number;
    y_axis: PrettyArgYAxis;
    nodes: PrettyArgNodeConfig;
    edges: PrettyArgEdgeConfig;
    tree_highlighting: boolean;
    title: string;
}

export interface PrettyArgVisualizationProps {
    data: PrettyArgData;
    genomicStart?: number;
    genomicEnd?: number;
    edgeType?: 'line' | 'ortho';
} 