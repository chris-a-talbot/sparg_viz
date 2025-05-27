# visualization_utils.py
"""
Visualization utilities for Pretty ARG and other complex visualizations
"""

import logging
import math
from collections import defaultdict
from typing import Dict, Any, List

import numpy as np
import tskit

# Constants
DEFAULT_GRAPH_WIDTH = 800
DEFAULT_GRAPH_HEIGHT = 600
DEFAULT_MIN_SPACING = 15
DEFAULT_MARGIN = 50

logger = logging.getLogger(__name__)


def convert_to_d3arg(ts: tskit.TreeSequence, max_samples: int = 25) -> Dict[str, Any]:
    """Convert a tskit.TreeSequence to D3ARG format with sophisticated positioning."""
    logger.info(f"Converting tree sequence to D3ARG format with max_samples={max_samples}")
    
    # Simplify if needed
    if ts.num_samples > max_samples:
        sample_nodes = [node for node in ts.nodes() if node.is_sample()]
        sample_nodes.sort(key=lambda x: x.time)
        
        # Select evenly spaced samples
        indices = [int(i * (len(sample_nodes) - 1) / (max_samples - 1)) for i in range(max_samples)]
        selected_sample_ids = [sample_nodes[i].id for i in indices]
        ts = ts.simplify(samples=selected_sample_ids)
        logger.info(f"Simplified to {max_samples} samples")
    
    # Build comprehensive graph structure
    parent_map = defaultdict(set)  # child -> set of parents
    child_map = defaultdict(set)   # parent -> set of children
    edge_info = {}  # (parent, child) -> edge data
    
    for edge in ts.edges():
        parent_map[edge.child].add(edge.parent)
        child_map[edge.parent].add(edge.child)
        key = (edge.parent, edge.child)
        if key not in edge_info:
            edge_info[key] = []
        edge_info[key].append(edge)
    
    # Calculate sample ordering
    ordered_samples = calculate_sample_ordering(ts)
    
    # Calculate optimal positions
    nodes = calculate_optimal_positions(ts, ordered_samples, parent_map, child_map, edge_info)
    
    logger.info(f"Applied positioning: {len(ordered_samples)} samples optimally ordered")
    
    # Create links with bounds information
    links = create_links_with_bounds(edge_info, ts)
    
    # Calculate breakpoints
    breakpoints = create_breakpoints(ts)
    
    # Y-axis setup
    y_axis_data = create_y_axis_data(nodes)
    
    # Create final D3ARG object
    d3arg_data = {
        'data': {
            'nodes': nodes,
            'links': links,
            'breakpoints': breakpoints
        },
        'evenly_distributed_positions': [node['x'] for node in nodes if node['ts_flags'] & 1],
        'width': DEFAULT_GRAPH_WIDTH,
        'height': max(DEFAULT_GRAPH_HEIGHT, len(y_axis_data['unique_times']) * 60 + 150),
        'y_axis': y_axis_data,
        'nodes': {
            'size': 150,
            'symbol': 'd3.symbolCircle',
            'sample_symbol': 'd3.symbolSquare',
            'subset_nodes': None,
            'include_labels': True
        },
        'edges': {
            'type': 'ortho',
            'variable_width': False,
            'include_underlink': False
        },
        'tree_highlighting': True,
        'title': f"Pretty ARG - {len(ordered_samples)} samples, {len(links)} edges (Optimized)",
        'sample_order': [node['id'] for node in nodes if node['ts_flags'] & 1]
    }
    
    logger.info(f"D3ARG conversion complete: {len(nodes)} nodes, {len(links)} links, {len(breakpoints)} trees")
    
    return d3arg_data


def calculate_sample_ordering(ts: tskit.TreeSequence) -> List:
    """Calculate optimal sample ordering using multi-tree ancestry analysis."""
    sample_nodes = [node for node in ts.nodes() if node.is_sample()]
    
    if len(sample_nodes) <= 2:
        return sample_nodes
    
    # Build pairwise similarity matrix based on shared ancestry across all trees
    n_samples = len(sample_nodes)
    similarity_matrix = np.zeros((n_samples, n_samples))
    
    # Analyze each tree to build comprehensive ancestry relationships
    for tree in ts.trees():
        tree_weight = tree.span / ts.sequence_length  # Weight by genomic coverage
        
        for i in range(n_samples):
            for j in range(i + 1, n_samples):
                sample1, sample2 = sample_nodes[i], sample_nodes[j]
                
                # Find MRCA in this tree
                mrca = tree.mrca(sample1.id, sample2.id)
                if mrca != -1:
                    # Calculate similarity based on MRCA time and path lengths
                    mrca_time = ts.node(mrca).time
                    path1_length = sample1.time - mrca_time
                    path2_length = sample2.time - mrca_time
                    
                    # Closer MRCA time = higher similarity
                    similarity = tree_weight / (1.0 + mrca_time + path1_length + path2_length)
                    similarity_matrix[i][j] += similarity
                    similarity_matrix[j][i] += similarity
    
    # Use hierarchical clustering approach for optimal ordering
    remaining = set(range(n_samples))
    ordered_indices = []
    
    # Find best starting sample
    total_similarities = np.sum(similarity_matrix, axis=1)
    start_idx = np.argmax(total_similarities)
    ordered_indices.append(start_idx)
    remaining.remove(start_idx)
    
    # Greedily add samples that maximize local similarity
    while remaining:
        last_idx = ordered_indices[-1]
        
        # Find remaining sample with highest similarity to the last added
        best_similarity = -1
        best_idx = -1
        
        for candidate_idx in remaining:
            similarity = similarity_matrix[last_idx][candidate_idx]
            
            # Bonus for samples that are similar to recently added samples
            recent_bonus = 0
            for recent_idx in ordered_indices[-3:]:  # Consider last 3 samples
                recent_bonus += similarity_matrix[candidate_idx][recent_idx] * 0.3
            
            total_score = similarity + recent_bonus
            
            if total_score > best_similarity:
                best_similarity = total_score
                best_idx = candidate_idx
        
        if best_idx != -1:
            ordered_indices.append(best_idx)
            remaining.remove(best_idx)
        else:
            # Fallback: add any remaining sample
            best_idx = remaining.pop()
            ordered_indices.append(best_idx)
    
    return [sample_nodes[i] for i in ordered_indices]


def calculate_optimal_positions(ts: tskit.TreeSequence, ordered_samples: List, 
                              parent_map: Dict, child_map: Dict, edge_info: Dict) -> List[Dict]:
    """Calculate optimal X positions using iterative crossing minimization."""
    nodes = []
    
    # Create initial node data
    for node in ts.nodes():
        node_data = {
            'id': node.id,
            'index': node.id,
            'label': str(node.id),
            'ts_flags': node.flags,
            'time': node.time,
            'child_of': list(parent_map[node.id]),
            'parent_of': list(child_map[node.id]),
            'size': 200 if node.is_sample() else 150,
            'symbol': 'd3.symbolSquare' if node.is_sample() else 'd3.symbolCircle',
            'fill': '#4ecdc4' if node.is_sample() else '#95a5a6',
            'stroke': '#2c3e50',
            'stroke_width': 2,
            'include_label': True,
            'x': 0,  # Will be calculated
            'y': 0,
            'vx': 0,
            'vy': 0
        }
        nodes.append(node_data)
    
    node_map = {node['id']: node for node in nodes}
    
    # Set initial sample positions based on optimal ordering
    available_width = DEFAULT_GRAPH_WIDTH - 2 * DEFAULT_MARGIN
    
    if len(ordered_samples) > 1:
        sample_spacing = available_width / (len(ordered_samples) - 1)
    else:
        sample_spacing = 0
    
    for i, sample in enumerate(ordered_samples):
        node_map[sample.id]['x'] = DEFAULT_MARGIN + i * sample_spacing
    
    # Position internal nodes using weighted centroid with crossing minimization
    positioned = set(sample.id for sample in ordered_samples)
    
    # Sort nodes by time (process from samples upward)
    time_sorted_nodes = sorted([n for n in nodes if not (n['ts_flags'] & 1)], 
                             key=lambda x: x['time'])
    
    for node in time_sorted_nodes:
        if node['id'] in positioned:
            continue
            
        children = [node_map[child_id] for child_id in node['child_of'] 
                   if child_id in positioned]
        
        if children:
            # Calculate position based on children
            child_positions = [child['x'] for child in children]
            
            # Test several positioning options
            candidates = []
            
            # Weighted centroid
            if edge_info:
                total_weight = 0
                weighted_sum = 0
                for child in children:
                    edge_weight = sum(edge.right - edge.left 
                                    for edge in edge_info.get((node['id'], child['id']), []))
                    if edge_weight > 0:
                        weighted_sum += child['x'] * edge_weight
                        total_weight += edge_weight
                if total_weight > 0:
                    candidates.append(weighted_sum / total_weight)
            
            # Simple centroid
            candidates.append(sum(child_positions) / len(child_positions))
            
            # Slightly left and right of centroid for crossing optimization
            centroid = sum(child_positions) / len(child_positions)
            candidates.extend([centroid - 20, centroid + 20])
            
            # Filter candidates to reasonable range
            candidates = [x for x in candidates 
                         if DEFAULT_MARGIN <= x <= DEFAULT_GRAPH_WIDTH - DEFAULT_MARGIN]
            if not candidates:
                candidates = [centroid]
            
            # Choose position that minimizes crossings
            current_positions = {n['id']: n['x'] for n in nodes if n['id'] in positioned}
            
            best_x = candidates[0]
            best_score = float('inf')
            
            for candidate_x in candidates:
                current_positions[node['id']] = candidate_x
                score = calculate_crossing_score(current_positions, edge_info)
                
                if score < best_score:
                    best_score = score
                    best_x = candidate_x
            
            node['x'] = best_x
        else:
            # Default position for nodes without positioned children
            node['x'] = DEFAULT_GRAPH_WIDTH / 2
        
        positioned.add(node['id'])
    
    # Final collision resolution while preserving optimal ordering
    apply_collision_resolution(nodes, available_width)
    
    return nodes


def calculate_crossing_score(positions: Dict, edge_info: Dict) -> int:
    """Calculate total number of edge crossings given node positions."""
    crossings = 0
    edges = list(edge_info.keys())
    
    for i, (p1, c1) in enumerate(edges):
        for j, (p2, c2) in enumerate(edges[i+1:], i+1):
            if p1 in positions and c1 in positions and p2 in positions and c2 in positions:
                x1, x2 = positions[p1], positions[c1]
                x3, x4 = positions[p2], positions[c2]
                
                # Check if edges cross (different relative orders at parent vs child levels)
                if ((x1 < x3) != (x2 < x4)) and p1 != p2 and c1 != c2:
                    crossings += 1
    
    return crossings


def apply_collision_resolution(nodes: List[Dict], available_width: float):
    """Apply final collision resolution while preserving optimal ordering."""
    final_positions = {}
    
    # Group nodes by time (Y level)
    time_groups = defaultdict(list)
    for node in nodes:
        time_groups[node['time']].append(node)
    
    # Process each time level separately
    for time_val, time_nodes in time_groups.items():
        # Sort nodes by their current X position
        time_nodes.sort(key=lambda n: n['x'])
        
        if len(time_nodes) > 1:
            # Calculate required width for all nodes with minimum spacing
            required_width = (len(time_nodes) - 1) * DEFAULT_MIN_SPACING
            
            if required_width > available_width:
                # Use minimum spacing
                for i, node in enumerate(time_nodes):
                    final_positions[node['id']] = DEFAULT_MARGIN + i * DEFAULT_MIN_SPACING
            else:
                # Preserve relative positions while ensuring minimum spacing
                current_positions = [n['x'] for n in time_nodes]
                
                # Adjust positions to ensure minimum spacing
                adjusted = [current_positions[0]]
                for i in range(1, len(current_positions)):
                    min_allowed = adjusted[-1] + DEFAULT_MIN_SPACING
                    adjusted.append(max(current_positions[i], min_allowed))
                
                # Scale to fit within available width if needed
                if adjusted[-1] > DEFAULT_GRAPH_WIDTH - DEFAULT_MARGIN:
                    scale = available_width / (adjusted[-1] - adjusted[0])
                    adjusted = [DEFAULT_MARGIN + (pos - adjusted[0]) * scale for pos in adjusted]
                
                for i, node in enumerate(time_nodes):
                    final_positions[node['id']] = adjusted[i]
        else:
            final_positions[time_nodes[0]['id']] = time_nodes[0]['x']
    
    # Apply final positions
    for node in nodes:
        node['x'] = final_positions[node['id']]


def create_links_with_bounds(edge_info: Dict, ts: tskit.TreeSequence) -> List[Dict]:
    """Create links with bounds information."""
    links = []
    link_id = 0
    
    for (parent_id, child_id), edge_list in edge_info.items():
        # Merge overlapping intervals
        intervals = [(edge.left, edge.right) for edge in edge_list]
        intervals.sort()
        merged_intervals = []
        
        for start, end in intervals:
            if merged_intervals and start <= merged_intervals[-1][1]:
                merged_intervals[-1] = (merged_intervals[-1][0], max(merged_intervals[-1][1], end))
            else:
                merged_intervals.append((start, end))
        
        # Create bounds string
        bounds_parts = []
        for start, end in merged_intervals:
            if abs(start - int(start)) < 1e-10 and abs(end - int(end)) < 1e-10:
                bounds_parts.append(f"{int(start)}-{int(end)}")
            else:
                bounds_parts.append(f"{start:.1f}-{end:.1f}")
        bounds = " ".join(bounds_parts)
        
        total_length = sum(end - start for start, end in merged_intervals)
        region_fraction = total_length / ts.sequence_length
        
        link_data = {
            'id': link_id,
            'source': parent_id,
            'target': child_id,
            'bounds': bounds,
            'region_fraction': region_fraction,
            'edge_weight': total_length,
            'color': '#34495e'
        }
        links.append(link_data)
        link_id += 1
    
    return links


def create_breakpoints(ts: tskit.TreeSequence) -> List[Dict]:
    """Calculate breakpoints for tree visualization."""
    breakpoints = []
    for tree in ts.trees():
        start_pos = tree.interval[0] / ts.sequence_length
        width = (tree.interval[1] - tree.interval[0]) / ts.sequence_length
        
        breakpoint = {
            'start': tree.interval[0],
            'stop': tree.interval[1],
            'x_pos_01': start_pos,
            'x_pos': start_pos * DEFAULT_GRAPH_WIDTH,
            'width_01': width,
            'width': width * DEFAULT_GRAPH_WIDTH,
            'included': True
        }
        breakpoints.append(breakpoint)
    
    return breakpoints


def create_y_axis_data(nodes: List[Dict]) -> Dict:
    """Create Y-axis setup data."""
    node_times = [node['time'] for node in nodes]
    unique_times = sorted(set(node_times))
    y_ticks = list(range(len(unique_times)))
    y_labels = [f"{time:.3f}" if time != int(time) else str(int(time)) for time in unique_times]
    
    return {
        'include_labels': True,
        'ticks': y_ticks,
        'text': y_labels,
        'max_min': [max(y_ticks), min(y_ticks)] if y_ticks else [0, 0],
        'scale': 'rank',
        'unique_times': unique_times
    }


def apply_focus_filter(ts: tskit.TreeSequence, focus_node: int, mode: str) -> tskit.TreeSequence:
    """Apply focus filtering to show subgraph or parent graph."""
    logger.info(f"Applying {mode} filter on node {focus_node}")
    
    if focus_node >= ts.num_nodes:
        raise ValueError(f"Focus node {focus_node} does not exist (max: {ts.num_nodes - 1})")
    
    # Build parent-child relationships
    parent_map = {}  # child -> set of parents
    child_map = {}   # parent -> set of children
    
    for edge in ts.edges():
        if edge.parent not in child_map:
            child_map[edge.parent] = set()
        if edge.child not in parent_map:
            parent_map[edge.child] = set()
        child_map[edge.parent].add(edge.child)
        parent_map[edge.child].add(edge.parent)
    
    nodes_to_keep = set()
    
    if mode == 'subgraph':
        # Include focus node and all its descendants
        nodes_to_keep.add(focus_node)
        queue = [focus_node]
        
        while queue:
            current = queue.pop(0)
            if current in child_map:
                for child in child_map[current]:
                    if child not in nodes_to_keep:
                        nodes_to_keep.add(child)
                        queue.append(child)
        
        logger.info(f"Subgraph includes {len(nodes_to_keep)} nodes")
        
    elif mode == 'parent':
        # Include focus node and all its ancestors
        nodes_to_keep.add(focus_node)
        queue = [focus_node]
        
        while queue:
            current = queue.pop(0)
            if current in parent_map:
                for parent in parent_map[current]:
                    if parent not in nodes_to_keep:
                        nodes_to_keep.add(parent)
                        queue.append(parent)
        
        logger.info(f"Parent graph includes {len(nodes_to_keep)} nodes")
    
    else:
        raise ValueError(f"Unknown mode: {mode}. Use 'subgraph' or 'parent'")
    
    # Create filtered tree sequence
    if len(nodes_to_keep) == ts.num_nodes:
        # No filtering needed
        return ts
    
    # For now, return simplified version with all samples
    # This is a simplified implementation - could be enhanced to preserve structure better
    sample_nodes = [node.id for node in ts.nodes() if node.is_sample()]
    simplified_ts = ts.simplify(samples=sample_nodes)
    
    return simplified_ts 