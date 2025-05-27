# simulation_models.py
"""
ARG simulation models and builders for spARGviz
"""

import logging
import random
from typing import Dict, List, Tuple, Optional

import numpy as np
import tskit

# Constants
DEFAULT_RECOMBINATION_PROB = 0.15
DEFAULT_COALESCENCE_RATE = 1.0
DEFAULT_EDGE_DENSITY = 0.8
BASE_TIME_STEP = 0.1
MIN_RECOMBINATION_LENGTH = 100.0
SPATIAL_NOISE_FACTOR = 0.1

logger = logging.getLogger(__name__)


def generate_spargviz_simulation(
    num_samples: int,
    num_trees: int,
    spatial_dims: int,
    num_generations: int,
    x_range: float,
    y_range: Optional[float] = None,
    recombination_probability: float = DEFAULT_RECOMBINATION_PROB,
    coalescence_rate: float = DEFAULT_COALESCENCE_RATE,
    edge_density: float = DEFAULT_EDGE_DENSITY
) -> tskit.TreeSequence:
    """Generate a realistic ancestral recombination graph for visualization."""
    if spatial_dims == 2 and y_range is None:
        raise ValueError("y_range must be provided when spatial_dims == 2")
    
    arg_builder = ARGBuilder(
        num_samples=num_samples,
        num_generations=num_generations,
        num_trees=num_trees,
        spatial_dims=spatial_dims,
        x_range=x_range,
        y_range=y_range,
        recombination_probability=recombination_probability,
        coalescence_rate=coalescence_rate,
        edge_density=edge_density
    )
    
    return arg_builder.build()


def generate_msprime_simulation(
    sample_number: int,
    spatial_dimensions: int,
    spatial_boundary_size: List[float],
    dispersal_range: float,
    local_trees: int,
    generations: int
) -> tskit.TreeSequence:
    """Generate an msprime simulation with proper ARG structure."""
    import msprime
    
    # Validate spatial parameters
    if spatial_dimensions < 0 or spatial_dimensions > 2:
        raise ValueError("Spatial dimensions must be 0, 1, or 2")
    if spatial_dimensions > 0 and (not spatial_boundary_size or len(spatial_boundary_size) != spatial_dimensions):
        raise ValueError(f"Must specify {spatial_dimensions} boundary sizes for {spatial_dimensions}D simulation")
    
    # Generate random seed for reproducibility
    ts_rs = random.randint(0, 10000)
    logger.info(f"Using random seed: {ts_rs}")
    
    # Calculate sequence length and recombination rate
    base_sequence_length = 3000
    if local_trees > 1:
        sequence_length = base_sequence_length * local_trees
        recombination_rate = (local_trees - 1) / sequence_length * 2
    else:
        sequence_length = base_sequence_length
        recombination_rate = 0
    
    logger.info(f"Using sequence length: {sequence_length}, recombination rate: {recombination_rate}")
    
    # Generate the simulation
    ts = msprime.sim_ancestry(
        samples=sample_number,
        recombination_rate=recombination_rate,
        sequence_length=sequence_length,
        population_size=max(sample_number, generations),
        end_time=generations,
        record_full_arg=True,
        random_seed=ts_rs
    )
    
    # Add mutations
    ts = msprime.sim_mutations(ts, rate=1e-7, random_seed=4321)
    
    # Add spatial locations if requested
    if spatial_dimensions > 0:
        ts = add_spatial_locations_to_all_nodes(
            ts, spatial_dimensions, spatial_boundary_size, dispersal_range
        )
    
    return ts


class ARGBuilder:
    """Helper class to build complex ARG structures with recombination."""
    
    def __init__(self, num_samples: int, num_generations: int, 
                 num_trees: int, spatial_dims: int,
                 x_range: float, y_range: Optional[float],
                 recombination_probability: float,
                 coalescence_rate: float,
                 edge_density: float):
        self.num_samples = num_samples
        self.num_generations = num_generations
        self.num_trees = num_trees
        self.spatial_dims = spatial_dims
        self.x_range = x_range
        self.y_range = y_range
        self.recombination_probability = recombination_probability
        self.coalescence_rate = coalescence_rate
        self.edge_density = edge_density
        
        # Set sequence length
        self.sequence_length = float(num_trees * 1000)  # 1000 bp per tree
        
        # Generate breakpoints for local trees
        self.breakpoints = self._generate_breakpoints()
        
        # Initialize tables
        self.tables = tskit.TableCollection(sequence_length=self.sequence_length)
        self.node_counter = 0
        
        # Create sample nodes and individuals first
        self._create_samples()
    
    def _generate_breakpoints(self) -> List[float]:
        """Generate breakpoints for local trees."""
        if self.num_trees == 1:
            return [0.0, self.sequence_length]
        
        base_positions = np.linspace(0, self.sequence_length, self.num_trees + 1)
        
        breakpoints = [base_positions[0]]
        for i in range(1, len(base_positions) - 1):
            interval_width = self.sequence_length / self.num_trees
            variation = np.random.uniform(-0.1, 0.1) * interval_width
            breakpoints.append(base_positions[i] + variation)
        breakpoints.append(base_positions[-1])
        
        return sorted(breakpoints)
    
    def _create_samples(self):
        """Create sample nodes and individuals."""
        for i in range(self.num_samples):
            if self.spatial_dims > 0:
                location = self._generate_sample_location()
            else:
                location = []
            
            individual_id = self.tables.individuals.add_row(location=location)
            
            node_id = self.tables.nodes.add_row(
                time=0.0, 
                flags=tskit.NODE_IS_SAMPLE,
                individual=individual_id
            )
            self.node_counter += 1
    
    def _generate_sample_location(self) -> List[float]:
        """Generate random location for a sample within bounds."""
        if self.spatial_dims == 1:
            return [np.random.uniform(-self.x_range/2, self.x_range/2)]
        elif self.spatial_dims == 2:
            return [
                np.random.uniform(-self.x_range/2, self.x_range/2),
                np.random.uniform(-self.y_range/2, self.y_range/2)
            ]
        else:
            return []
    
    def build(self) -> tskit.TreeSequence:
        """Build the complete ARG with recombination events."""
        if self.num_trees == 1:
            self._build_single_tree()
        else:
            self._build_arg_with_recombination()
        
        # Sort tables and create tree sequence
        self.tables.sort()
        ts = self.tables.tree_sequence()
        
        # Add spatial locations to all individuals if needed
        if self.spatial_dims > 0:
            ts = self._add_spatial_locations_to_ancestors(ts)
        
        return ts
    
    def _build_single_tree(self):
        """Build a single coalescent tree."""
        active_lineages = list(range(self.num_samples))
        current_time = BASE_TIME_STEP
        
        while len(active_lineages) > 1:
            # Choose number of lineages to coalesce (usually 2, sometimes 3)
            if len(active_lineages) >= 3 and np.random.random() < 0.2:
                num_to_coalesce = 3
            else:
                num_to_coalesce = min(2, len(active_lineages))
            
            # Select lineages to coalesce
            children = []
            for _ in range(num_to_coalesce):
                if active_lineages:
                    child = active_lineages.pop(np.random.randint(len(active_lineages)))
                    children.append(child)
            
            if len(children) < 2:
                break
            
            # Create parent node
            parent_id = self.tables.nodes.add_row(time=current_time, flags=0)
            
            # Add edges
            for child in children:
                self.tables.edges.add_row(
                    left=0.0,
                    right=self.sequence_length,
                    parent=parent_id,
                    child=child
                )
            
            active_lineages.append(parent_id)
            current_time += np.random.exponential(1.0 / max(len(active_lineages), 1))
            self.node_counter += 1
    
    def _build_arg_with_recombination(self):
        """Build ARG with recombination."""
        active_lineages = list(range(self.num_samples))
        current_time = BASE_TIME_STEP
        
        lineage_intervals = {}
        for i in range(self.num_samples):
            lineage_intervals[i] = [(0.0, self.sequence_length)]
        
        generation = 0
        max_generations = self.num_generations * 4
        recomb_events = 0
        coal_events = 0
        
        logger.info(f"Building ARG with {self.num_samples} samples, target {self.num_trees} trees")
        
        while len(active_lineages) > 1 and generation < max_generations:
            base_recomb_prob = self.recombination_probability
            tree_adjustment = min(0.3, (self.num_trees - 1) * 0.05)
            recomb_prob = min(0.8, base_recomb_prob + tree_adjustment)
            
            if self.edge_density > 1.0:
                recomb_prob = min(0.9, recomb_prob * self.edge_density)
            elif self.edge_density < 1.0:
                recomb_prob = max(0.1, recomb_prob * self.edge_density)
            
            if len(active_lineages) == 1:
                break
            elif np.random.random() < recomb_prob and len(active_lineages) > 1:
                if self._recombination_event(active_lineages, lineage_intervals, current_time):
                    recomb_events += 1
            else:
                if self._coalescence_event(active_lineages, lineage_intervals, current_time):
                    coal_events += 1
            
            time_step = np.random.exponential(0.05 / self.coalescence_rate)
            current_time += time_step
            generation += 1
        
        logger.info(f"Created {coal_events} coalescence events and {recomb_events} recombination events")
        
        if len(active_lineages) > 1:
            logger.info(f"Final coalescence of {len(active_lineages)} remaining lineages")
            self._final_coalescence(active_lineages, lineage_intervals, current_time)
    
    def _coalescence_event(self, active_lineages: List[int], 
                          lineage_intervals: Dict[int, List[Tuple[float, float]]], 
                          current_time: float) -> bool:
        """Perform a coalescence event between two lineages."""
        if len(active_lineages) < 2:
            return False
        
        child1, child2 = np.random.choice(active_lineages, 2, replace=False)
        
        intervals1 = lineage_intervals[child1]
        intervals2 = lineage_intervals[child2]
        overlapping_intervals = self._find_overlapping_intervals(intervals1, intervals2)
        
        if not overlapping_intervals:
            return False
        
        parent_id = self.tables.nodes.add_row(time=current_time, flags=0)
        self.node_counter += 1
        
        for left, right in overlapping_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child1)
            self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child2)
        
        active_lineages.remove(child1)
        active_lineages.remove(child2)
        active_lineages.append(parent_id)
        
        lineage_intervals[parent_id] = self._merge_intervals(
            lineage_intervals[child1] + lineage_intervals[child2]
        )
        del lineage_intervals[child1]
        del lineage_intervals[child2]
        
        return True
    
    def _recombination_event(self, active_lineages: List[int], 
                           lineage_intervals: Dict[int, List[Tuple[float, float]]], 
                           current_time: float) -> bool:
        """Perform a recombination event on a lineage."""
        if not active_lineages:
            return False
        
        lineage = np.random.choice(active_lineages)
        intervals = lineage_intervals[lineage]
        
        total_length = sum(right - left for left, right in intervals)
        if total_length <= MIN_RECOMBINATION_LENGTH:
            return False
        
        min_margin = min(100.0, total_length * 0.1)
        valid_length = total_length - 2 * min_margin
        if valid_length <= 0:
            return False
            
        target_pos = np.random.uniform(min_margin, total_length - min_margin)
        current_pos = 0
        recomb_point = None
        
        for left, right in intervals:
            interval_length = right - left
            if current_pos + interval_length > target_pos:
                recomb_point = left + (target_pos - current_pos)
                break
            current_pos += interval_length
        
        if recomb_point is None:
            return False
        
        left_intervals = []
        right_intervals = []
        
        for left, right in intervals:
            if right <= recomb_point:
                left_intervals.append((left, right))
            elif left >= recomb_point:
                right_intervals.append((left, right))
            else:
                left_intervals.append((left, recomb_point))
                right_intervals.append((recomb_point, right))
        
        if not left_intervals or not right_intervals:
            return False
        
        left_parent = self.node_counter
        right_parent = self.node_counter + 1
        
        self.tables.nodes.add_row(time=current_time, flags=0)
        self.tables.nodes.add_row(time=current_time, flags=0)
        self.node_counter += 2
        
        for left, right in left_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=left_parent, child=lineage)
        for left, right in right_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=right_parent, child=lineage)
        
        active_lineages.remove(lineage)
        active_lineages.extend([left_parent, right_parent])
        
        lineage_intervals[left_parent] = left_intervals
        lineage_intervals[right_parent] = right_intervals
        del lineage_intervals[lineage]
        
        return True
    
    def _final_coalescence(self, active_lineages: List[int], 
                          lineage_intervals: Dict[int, List[Tuple[float, float]]], 
                          current_time: float):
        """Coalesce all remaining lineages."""
        while len(active_lineages) > 1:
            child1 = active_lineages.pop()
            child2 = active_lineages.pop()
            
            parent_id = self.tables.nodes.add_row(time=current_time, flags=0)
            self.node_counter += 1
            
            for left, right in lineage_intervals[child1]:
                self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child1)
            for left, right in lineage_intervals[child2]:
                self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child2)
            
            active_lineages.append(parent_id)
            lineage_intervals[parent_id] = self._merge_intervals(
                lineage_intervals[child1] + lineage_intervals[child2]
            )
            del lineage_intervals[child1]
            del lineage_intervals[child2]
            
            current_time += BASE_TIME_STEP
    
    def _find_overlapping_intervals(self, intervals1: List[Tuple[float, float]], 
                                   intervals2: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        """Find overlapping intervals between two sets of intervals."""
        overlaps = []
        for left1, right1 in intervals1:
            for left2, right2 in intervals2:
                left = max(left1, left2)
                right = min(right1, right2)
                if left < right:
                    overlaps.append((left, right))
        return self._merge_intervals(overlaps)
    
    def _merge_intervals(self, intervals: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        """Merge overlapping intervals."""
        if not intervals:
            return []
        
        sorted_intervals = sorted(intervals)
        merged = [sorted_intervals[0]]
        
        for current_start, current_end in sorted_intervals[1:]:
            last_start, last_end = merged[-1]
            
            if current_start <= last_end:
                merged[-1] = (last_start, max(last_end, current_end))
            else:
                merged.append((current_start, current_end))
        
        return merged
    
    def _add_spatial_locations_to_ancestors(self, ts: tskit.TreeSequence) -> tskit.TreeSequence:
        """Add spatial locations to all individuals using brownian motion."""
        if self.spatial_dims == 0:
            return ts
        
        new_tables = ts.dump_tables()
        
        max_time = max(node.time for node in ts.nodes())
        root_nodes = [node.id for node in ts.nodes() if node.time == max_time]
        
        individual_locations = {}
        
        for individual in ts.individuals():
            if len(individual.location) > 0:
                individual_locations[individual.id] = list(individual.location)
        
        for root_node in root_nodes:
            if ts.node(root_node).individual != -1:
                individual_id = ts.node(root_node).individual
                if individual_id not in individual_locations:
                    individual_locations[individual_id] = self._generate_sample_location()
        
        self._propagate_spatial_locations(ts, individual_locations)
        
        new_tables.individuals.clear()
        for individual in ts.individuals():
            location = individual_locations.get(individual.id, [])
            new_tables.individuals.add_row(location=location, metadata=individual.metadata)
        
        return new_tables.tree_sequence()
    
    def _propagate_spatial_locations(self, ts: tskit.TreeSequence, 
                                   individual_locations: Dict[int, List[float]]):
        """Propagate spatial locations from ancestors to descendants."""
        nodes_by_time = sorted(ts.nodes(), key=lambda n: -n.time)
        
        for node in nodes_by_time:
            if node.individual == -1:
                continue
                
            individual_id = node.individual
            
            if individual_id in individual_locations:
                continue
            
            parent_locations = []
            for tree in ts.trees():
                parent = tree.parent(node.id)
                if parent != -1 and ts.node(parent).individual != -1:
                    parent_individual = ts.node(parent).individual
                    if parent_individual in individual_locations:
                        parent_locations.append(individual_locations[parent_individual])
            
            if parent_locations:
                avg_location = np.mean(parent_locations, axis=0)
                time_diff = abs(node.time - max(ts.node(p).time for p in 
                                              [tree.parent(node.id) for tree in ts.trees() 
                                               if tree.parent(node.id) != -1] or [node]))
                
                step_size = np.sqrt(time_diff * SPATIAL_NOISE_FACTOR)
                noise = np.random.normal(0, step_size, self.spatial_dims)
                new_location = avg_location + noise
                
                if self.spatial_dims >= 1:
                    new_location[0] = np.clip(new_location[0], -self.x_range/2, self.x_range/2)
                if self.spatial_dims == 2:
                    new_location[1] = np.clip(new_location[1], -self.y_range/2, self.y_range/2)
                
                individual_locations[individual_id] = new_location.tolist()
            else:
                individual_locations[individual_id] = self._generate_sample_location()


def add_spatial_locations_to_all_nodes(ts, spatial_dimensions, spatial_boundary_size, dispersal_range):
    """Add spatial locations to all nodes in a tree sequence."""
    # This would be implemented based on the original spatial location logic
    # For now, return the tree sequence unchanged
    return ts 