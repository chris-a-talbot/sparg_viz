# main.py

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import io
import tskit
import tszip
import tempfile
import os
import sys
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Tuple, Optional
import random
import math
import numpy as np
from pydantic import BaseModel
import shutil
from collections import defaultdict

# Add the backend directory to Python path to access fastgaia
backend_path = os.path.dirname(__file__)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

# Import fastgaia functions by importing the module and accessing the function
import importlib.util
fastgaia_main_path = os.path.join(os.path.dirname(__file__), 'fastgaia', 'main.py')
spec = importlib.util.spec_from_file_location("fastgaia_main", fastgaia_main_path)
fastgaia_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fastgaia_main)

# Get the infer_locations function
infer_locations = fastgaia_main.infer_locations

app = FastAPI(title="SPARG Visualization API", version="1.0.0")

# Configure CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for uploaded files (for demo/testing only)
uploaded_files = {}
uploaded_tree_sequences = {}

# Pydantic models for simulation requests
class SpargvizSimulationRequest(BaseModel):
    num_samples: int
    num_trees: int
    spatial_dims: int = 0
    num_generations: int = 6
    x_range: float = 10.0
    y_range: Optional[float] = None
    
    # For backwards compatibility, also accept old parameter names
    sample_number: Optional[int] = None
    local_trees: Optional[int] = None
    spatial_dimensions: Optional[int] = None
    spatial_boundary_size: List[float] = []
    dispersal_range: float = 1.0
    
    def __init__(self, **data):
        # Handle backwards compatibility
        if data.get('sample_number') is not None:
            data['num_samples'] = data.pop('sample_number')
        if data.get('local_trees') is not None:
            data['num_trees'] = data.pop('local_trees')
        if data.get('spatial_dimensions') is not None:
            data['spatial_dims'] = data.pop('spatial_dimensions')
        
        # Convert old spatial parameters to new format
        if data.get('spatial_boundary_size'):
            boundary_size = data['spatial_boundary_size']
            if len(boundary_size) >= 1:
                data['x_range'] = boundary_size[0]
            if len(boundary_size) >= 2:
                data['y_range'] = boundary_size[1]
        
        super().__init__(**data)

class MsprimeSimulationRequest(BaseModel):
    sample_number: int
    spatial_dimensions: int
    spatial_boundary_size: List[float] = []
    dispersal_range: float = 1.0
    local_trees: int = 5  # Add parameter for controlling number of local trees
    generations: int = 6  # Add parameter for limiting simulation time

class FastLocationInferenceRequest(BaseModel):
    filename: str
    weight_span: bool = True
    weight_branch_length: bool = True

def check_spatial_info(ts: tskit.TreeSequence) -> Dict[str, bool]:
    """
    Check for spatial information completeness in samples and all nodes.
    Returns a dict with spatial status information.
    """
    print("\nChecking spatial information completeness...")
    print(f"Number of individuals: {ts.num_individuals}")
    print(f"Number of nodes: {ts.num_nodes}")

    # Initialize flags assuming all nodes/samples have spatial data
    sample_has_spatial = True
    all_has_spatial = True

    # Iterate through all nodes to check spatial info completeness
    for node in ts.nodes():
        individual_id = node.individual

        if individual_id == -1:
            # If a node is not associated with an individual, spatial info is incomplete for all nodes
            if all_has_spatial:
                print(f"DEBUG: Node {node.id} is not associated with an individual. Setting all_has_spatial to False.")
            all_has_spatial = False
            # If it's a sample node, spatial info is also incomplete for samples
            if node.flags & tskit.NODE_IS_SAMPLE:
                if sample_has_spatial:
                    print(f"DEBUG: Sample node {node.id} is not associated with an individual. Setting sample_has_spatial to False.")
                sample_has_spatial = False
        else:
            individual = ts.individual(individual_id)
            # Check if the individual's location is missing or has less than 2 coordinates
            if individual.location is None or len(individual.location) < 2:
                if all_has_spatial:
                    print(f"DEBUG: Individual {individual_id} linked to node {node.id} has invalid location: {individual.location}. Setting all_has_spatial to False.")
                all_has_spatial = False
                # If it's a sample node, spatial info is also incomplete for samples
                if node.flags & tskit.NODE_IS_SAMPLE:
                    if sample_has_spatial:
                        print(f"DEBUG: Individual {individual_id} linked to sample node {node.id} has invalid location: {individual.location}. Setting sample_has_spatial to False.")
                    sample_has_spatial = False

    # Determine overall spatial status based on final flag values
    if all_has_spatial:
        spatial_status = "all"
    elif sample_has_spatial:
        spatial_status = "sample_only"
    else:
        spatial_status = "none"

    print(f"Final spatial status - sample_has_spatial: {sample_has_spatial}, all_has_spatial: {all_has_spatial}, status: {spatial_status}\n")

    return {
        "has_sample_spatial": sample_has_spatial,
        "has_all_spatial": all_has_spatial,
        "spatial_status": spatial_status
    }

def generate_ts(
    num_samples: int,
    num_trees: int,
    spatial_dims: int,
    num_generations: int,
    x_range: float,
    y_range: Optional[float] = None
) -> tskit.TreeSequence:
    """
    Generate a realistic ancestral recombination graph for visualization.
    
    Args:
        num_samples: Number of sample nodes
        num_trees: Number of local trees in the ARG
        spatial_dims: Number of spatial dimensions (0, 1, or 2)
        num_generations: Number of generations from root to samples
        x_range: Range of possible x locations
        y_range: Range of possible y locations (required if spatial_dims == 2)
    
    Returns:
        tskit.TreeSequence: The generated ARG as a tree sequence
    """
    if spatial_dims == 2 and y_range is None:
        raise ValueError("y_range must be provided when spatial_dims == 2")
    
    # Validate inputs
    if num_samples < 2:
        raise ValueError("num_samples must be at least 2")
    if num_trees < 1:
        raise ValueError("num_trees must be at least 1")
    if spatial_dims not in [0, 1, 2]:
        raise ValueError("spatial_dims must be 0, 1, or 2")
    if num_generations < 1:
        raise ValueError("num_generations must be at least 1")
    
    # Create the ARG structure
    arg_builder = ARGBuilder(
        num_samples=num_samples,
        num_generations=num_generations,
        num_trees=num_trees,
        spatial_dims=spatial_dims,
        x_range=x_range,
        y_range=y_range
    )
    
    return arg_builder.build()


class ARGBuilder:
    """Helper class to build complex ARG structures with recombination."""
    
    def __init__(self, num_samples: int, num_generations: int, 
                 num_trees: int, spatial_dims: int,
                 x_range: float, y_range: Optional[float]):
        self.num_samples = num_samples
        self.num_generations = num_generations
        self.num_trees = num_trees
        self.spatial_dims = spatial_dims
        self.x_range = x_range
        self.y_range = y_range
        
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
        
        # Create evenly spaced breakpoints with some random variation
        base_positions = np.linspace(0, self.sequence_length, self.num_trees + 1)
        
        # Add small random perturbations to interior breakpoints
        breakpoints = [base_positions[0]]  # Keep 0.0 exact
        for i in range(1, len(base_positions) - 1):
            # Add random variation of up to 10% of interval width
            interval_width = self.sequence_length / self.num_trees
            variation = np.random.uniform(-0.1, 0.1) * interval_width
            breakpoints.append(base_positions[i] + variation)
        breakpoints.append(base_positions[-1])  # Keep end exact
        
        return sorted(breakpoints)
    
    def _create_samples(self):
        """Create sample nodes and individuals."""
        for i in range(self.num_samples):
            # Add individual first
            if self.spatial_dims > 0:
                location = self._generate_sample_location()
            else:
                location = []
            
            individual_id = self.tables.individuals.add_row(location=location)
            
            # Add sample node
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
        current_time = 0.1
        
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
        """Build ARG with recombination using the standard coalescent-with-recombination process."""
        # Start with all samples as active lineages
        active_lineages = list(range(self.num_samples))
        current_time = 0.1
        
        # We'll track which lineages are active in which genomic regions
        # Each lineage is represented as a list of genomic intervals
        lineage_intervals = {}
        for i in range(self.num_samples):
            lineage_intervals[i] = [(0.0, self.sequence_length)]
        
        # Continue until we have a single lineage covering the entire sequence
        generation = 0
        max_generations = self.num_generations * 4  # More generations to allow recombination
        recomb_events = 0
        coal_events = 0
        
        print(f"  Building ARG with {self.num_samples} samples, target {self.num_trees} trees")
        
        while len(active_lineages) > 1 and generation < max_generations:
            # Adjust probability based on how many trees we want
            # More recombination if we want more trees
            recomb_prob = min(0.6, 0.2 + (self.num_trees - 1) * 0.1)
            
            # Decide whether to have a coalescence or recombination event
            if len(active_lineages) == 1:
                break
            elif np.random.random() < recomb_prob and len(active_lineages) > 1:
                # Recombination event
                if self._recombination_event(active_lineages, lineage_intervals, current_time):
                    recomb_events += 1
            else:
                # Coalescence event
                if self._coalescence_event(active_lineages, lineage_intervals, current_time):
                    coal_events += 1
            
            current_time += np.random.exponential(0.05)  # Shorter time steps
            generation += 1
        
        print(f"  Created {coal_events} coalescence events and {recomb_events} recombination events")
        
        # If we still have multiple lineages, coalesce them all
        if len(active_lineages) > 1:
            print(f"  Final coalescence of {len(active_lineages)} remaining lineages")
            self._final_coalescence(active_lineages, lineage_intervals, current_time)
    
    def _coalescence_event(self, active_lineages: List[int], 
                          lineage_intervals: Dict[int, List[Tuple[float, float]]], 
                          current_time: float) -> bool:
        """Perform a coalescence event between two lineages."""
        if len(active_lineages) < 2:
            return False
        
        # Choose two lineages to coalesce
        child1, child2 = np.random.choice(active_lineages, 2, replace=False)
        
        # Find overlapping intervals
        intervals1 = lineage_intervals[child1]
        intervals2 = lineage_intervals[child2]
        overlapping_intervals = self._find_overlapping_intervals(intervals1, intervals2)
        
        if not overlapping_intervals:
            return False  # No overlap, can't coalesce
        
        # Create new parent node
        parent_id = self.tables.nodes.add_row(time=current_time, flags=0)
        self.node_counter += 1
        
        # Add edges for overlapping intervals
        for left, right in overlapping_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child1)
            self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child2)
        
        # Update lineage tracking
        active_lineages.remove(child1)
        active_lineages.remove(child2)
        active_lineages.append(parent_id)
        
        # Parent inherits the union of child intervals
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
        
        # Choose a lineage to recombine
        lineage = np.random.choice(active_lineages)
        intervals = lineage_intervals[lineage]
        
        # Find a valid recombination point
        total_length = sum(right - left for left, right in intervals)
        if total_length <= 100.0:  # Much less restrictive - allow recombination on shorter segments
            return False
        
        # Choose a recombination point - avoid breakpoints too close to ends
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
                # Recombination point is in this interval
                recomb_point = left + (target_pos - current_pos)
                break
            current_pos += interval_length
        
        if recomb_point is None:
            return False
        
        # Split the lineage at the recombination point
        left_intervals = []
        right_intervals = []
        
        for left, right in intervals:
            if right <= recomb_point:
                left_intervals.append((left, right))
            elif left >= recomb_point:
                right_intervals.append((left, right))
            else:
                # Interval spans the recombination point
                left_intervals.append((left, recomb_point))
                right_intervals.append((recomb_point, right))
        
        if not left_intervals or not right_intervals:
            return False  # Invalid split
        
        # Create two new lineages
        left_lineage = self.node_counter
        right_lineage = self.node_counter + 1
        
        self.tables.nodes.add_row(time=current_time, flags=0)
        self.tables.nodes.add_row(time=current_time, flags=0)
        self.node_counter += 2
        
        # Add edges from original lineage to split lineages
        for left, right in left_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=lineage, child=left_lineage)
        for left, right in right_intervals:
            self.tables.edges.add_row(left=left, right=right, parent=lineage, child=right_lineage)
        
        # Update lineage tracking
        active_lineages.remove(lineage)
        active_lineages.extend([left_lineage, right_lineage])
        
        lineage_intervals[left_lineage] = left_intervals
        lineage_intervals[right_lineage] = right_intervals
        del lineage_intervals[lineage]
        
        return True
    
    def _final_coalescence(self, active_lineages: List[int], 
                          lineage_intervals: Dict[int, List[Tuple[float, float]]], 
                          current_time: float):
        """Coalesce all remaining lineages."""
        while len(active_lineages) > 1:
            # Take two lineages
            child1 = active_lineages.pop()
            child2 = active_lineages.pop()
            
            # Create parent
            parent_id = self.tables.nodes.add_row(time=current_time, flags=0)
            self.node_counter += 1
            
            # Add edges for all intervals
            for left, right in lineage_intervals[child1]:
                self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child1)
            for left, right in lineage_intervals[child2]:
                self.tables.edges.add_row(left=left, right=right, parent=parent_id, child=child2)
            
            # Update tracking
            active_lineages.append(parent_id)
            lineage_intervals[parent_id] = self._merge_intervals(
                lineage_intervals[child1] + lineage_intervals[child2]
            )
            del lineage_intervals[child1]
            del lineage_intervals[child2]
            
            current_time += 0.1
    
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
        
        # Sort intervals by start position
        sorted_intervals = sorted(intervals)
        merged = [sorted_intervals[0]]
        
        for current_start, current_end in sorted_intervals[1:]:
            last_start, last_end = merged[-1]
            
            if current_start <= last_end:
                # Overlapping intervals, merge them
                merged[-1] = (last_start, max(last_end, current_end))
            else:
                # Non-overlapping interval
                merged.append((current_start, current_end))
        
        return merged
    
    def _add_spatial_locations_to_ancestors(self, ts: tskit.TreeSequence) -> tskit.TreeSequence:
        """Add spatial locations to all individuals using brownian motion."""
        if self.spatial_dims == 0:
            return ts
        
        # Create new tables with spatial information
        new_tables = ts.dump_tables()
        
        # Find root node(s)
        max_time = max(node.time for node in ts.nodes())
        root_nodes = [node.id for node in ts.nodes() if node.time == max_time]
        
        # Generate locations for all individuals
        individual_locations = {}
        
        # Start with sample locations (already set)
        for individual in ts.individuals():
            if len(individual.location) > 0:
                individual_locations[individual.id] = list(individual.location)
        
        # Generate locations for root individuals
        for root_node in root_nodes:
            if ts.node(root_node).individual != -1:
                individual_id = ts.node(root_node).individual
                if individual_id not in individual_locations:
                    individual_locations[individual_id] = self._generate_sample_location()
        
        # Propagate locations using brownian motion
        self._propagate_spatial_locations(ts, individual_locations)
        
        # Update individual table with new locations
        new_tables.individuals.clear()
        for individual in ts.individuals():
            location = individual_locations.get(individual.id, [])
            new_tables.individuals.add_row(location=location, metadata=individual.metadata)
        
        return new_tables.tree_sequence()
    
    def _propagate_spatial_locations(self, ts: tskit.TreeSequence, 
                                   individual_locations: Dict[int, List[float]]):
        """Propagate spatial locations from ancestors to descendants."""
        # Sort nodes by time (oldest first)
        nodes_by_time = sorted(ts.nodes(), key=lambda n: -n.time)
        
        for node in nodes_by_time:
            if node.individual == -1:
                continue
                
            individual_id = node.individual
            
            if individual_id in individual_locations:
                continue  # Already has location
            
            # Find parent locations
            parent_locations = []
            for tree in ts.trees():
                parent = tree.parent(node.id)
                if parent != -1 and ts.node(parent).individual != -1:
                    parent_individual = ts.node(parent).individual
                    if parent_individual in individual_locations:
                        parent_locations.append(individual_locations[parent_individual])
            
            if parent_locations:
                # Use average of parent locations with brownian motion
                avg_location = np.mean(parent_locations, axis=0)
                time_diff = abs(node.time - max(ts.node(p).time for p in 
                                              [tree.parent(node.id) for tree in ts.trees() 
                                               if tree.parent(node.id) != -1] or [node]))
                
                # Add brownian motion
                step_size = np.sqrt(time_diff * 0.1)
                noise = np.random.normal(0, step_size, self.spatial_dims)
                new_location = avg_location + noise
                
                # Keep within bounds
                if self.spatial_dims >= 1:
                    new_location[0] = np.clip(new_location[0], -self.x_range/2, self.x_range/2)
                if self.spatial_dims == 2:
                    new_location[1] = np.clip(new_location[1], -self.y_range/2, self.y_range/2)
                
                individual_locations[individual_id] = new_location.tolist()
            else:
                # Fallback: random location
                individual_locations[individual_id] = self._generate_sample_location()

@app.get("/")
async def root():
    return {"message": "SPARG Visualization API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/upload-tree-sequence")
async def upload_tree_sequence(file: UploadFile = File(...)):
    """Upload and process tree sequence files - robust loading for later processing"""
    print("\n" + "="*50)
    print(f"Starting upload process for file: {file.filename}")
    print(f"File content type: {file.content_type}")
    print(f"Currently loaded files: {list(uploaded_files.keys())}")
    print(f"Currently loaded tree sequences: {list(uploaded_tree_sequences.keys())}")
    
    try:
        # Read file contents
        contents = await file.read()
        print(f"Successfully read file contents ({len(contents)} bytes)")
        
        # Store raw contents
        uploaded_files[file.filename] = contents
        print(f"Stored raw file contents in memory under key: {file.filename}")
        print(f"Updated uploaded_files keys: {list(uploaded_files.keys())}")
        
        # Process based on file type
        if file.filename.endswith(".tsz"):
            print("Processing .tsz file")
            with io.BytesIO(contents) as tsz_stream:
                print("Created BytesIO stream for tszip")
                with tszip.open(tsz_stream, "rb") as decompressed:
                    print("Opened tszip stream")
                    tmp = tempfile.NamedTemporaryFile(suffix=".trees", delete=False)
                    try:
                        decompressed_contents = decompressed.read()
                        print(f"Decompressed file ({len(decompressed_contents)} bytes)")
                        tmp.write(decompressed_contents)
                        tmp.close()
                        print(f"Wrote decompressed contents to temporary file: {tmp.name}")
                        ts = tskit.load(tmp.name)
                        print("Successfully loaded tree sequence with tskit")
                    finally:
                        os.unlink(tmp.name)
                        print("Cleaned up temporary file")
        elif file.filename.endswith(".trees"):
            print("Processing .trees file")
            tmp = tempfile.NamedTemporaryFile(suffix=".trees", delete=False)
            try:
                tmp.write(contents)
                tmp.close()
                print(f"Wrote contents to temporary file: {tmp.name}")
                ts = tskit.load(tmp.name)
                print("Successfully loaded tree sequence with tskit")
            finally:
                os.unlink(tmp.name)
                print("Cleaned up temporary file")
        else:
            raise ValueError("Unsupported file type. Please upload a .trees or .tsz file.")

        # Store the tree sequence
        uploaded_tree_sequences[file.filename] = ts
        print(f"Successfully stored tree sequence in memory under key: {file.filename}")
        print(f"Updated uploaded_tree_sequences keys: {list(uploaded_tree_sequences.keys())}")
        print(f"Tree sequence details:")
        print(f"- Nodes: {ts.num_nodes}")
        print(f"- Edges: {ts.num_edges}")
        print(f"- Samples: {ts.num_samples}")
        print(f"- Sequence length: {ts.sequence_length}")

        # Check for temporal and spatial information
        print("\nChecking tree sequence properties...")
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_info(ts)

        print(f"\nTree sequence summary:")
        print(f"- Has temporal info: {has_temporal}")
        print(f"- Spatial status: {spatial_info['spatial_status']}")
        print("="*50 + "\n")

        return {
            "filename": file.filename,
            "size": len(contents),
            "content_type": file.content_type,
            "status": "tree_sequence_loaded",
            "num_nodes": ts.num_nodes,
            "num_edges": ts.num_edges,
            "num_samples": ts.num_samples,
            "num_trees": ts.num_trees,
            "has_temporal": has_temporal,
            "has_sample_spatial": spatial_info["has_sample_spatial"],
            "has_all_spatial": spatial_info["has_all_spatial"],
            "spatial_status": spatial_info["spatial_status"]
        }
    except Exception as e:
        print(f"\nERROR during upload process:")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        print(f"Error details: {e.__dict__ if hasattr(e, '__dict__') else 'No additional details'}")
        print("="*50 + "\n")
        
        # Clean up any partial uploads
        if file.filename in uploaded_files:
            print(f"Cleaning up uploaded_files entry for: {file.filename}")
            del uploaded_files[file.filename]
        if file.filename in uploaded_tree_sequences:
            print(f"Cleaning up uploaded_tree_sequences entry for: {file.filename}")
            del uploaded_tree_sequences[file.filename]
        
        raise HTTPException(
            status_code=400,
            detail=f"Failed to load tree sequence: {str(e)}"
        )

@app.get("/uploaded-files")
async def list_uploaded_files():
    """List all currently uploaded files and tree sequences"""
    print("\nListing uploaded files:")
    print(f"uploaded_files: {list(uploaded_files.keys())}")
    print(f"uploaded_tree_sequences: {list(uploaded_tree_sequences.keys())}")
    return {
        "uploaded_files": list(uploaded_files.keys()),
        "uploaded_tree_sequences": list(uploaded_tree_sequences.keys())
    }

@app.get("/tree-sequence-metadata/{filename}")
async def get_tree_sequence_metadata(filename: str):
    """Get metadata for a specific tree sequence without loading graph data"""
    if filename not in uploaded_tree_sequences:
        raise HTTPException(status_code=404, detail=f"Tree sequence not found. Available files: {list(uploaded_tree_sequences.keys())}")
    
    ts = uploaded_tree_sequences[filename]
    
    try:
        # Check for temporal and spatial information
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_info(ts)
        
        return {
            "filename": filename,
            "num_nodes": ts.num_nodes,
            "num_edges": ts.num_edges,
            "num_samples": ts.num_samples,
            "num_trees": ts.num_trees,
            "sequence_length": ts.sequence_length,
            "has_temporal": has_temporal,
            "has_sample_spatial": spatial_info["has_sample_spatial"],
            "has_all_spatial": spatial_info["has_all_spatial"],
            "spatial_status": spatial_info["spatial_status"]
        }
    except Exception as e:
        print(f"Error getting metadata for {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get metadata: {str(e)}")

@app.delete("/tree-sequence/{filename}")
async def delete_tree_sequence(filename: str):
    """Delete a tree sequence from memory"""
    if filename not in uploaded_tree_sequences:
        raise HTTPException(status_code=404, detail=f"Tree sequence not found. Available files: {list(uploaded_tree_sequences.keys())}")
    
    try:
        # Remove from both dictionaries
        if filename in uploaded_files:
            del uploaded_files[filename]
        del uploaded_tree_sequences[filename]
        
        print(f"Successfully deleted tree sequence: {filename}")
        print(f"Remaining uploaded_files: {list(uploaded_files.keys())}")
        print(f"Remaining uploaded_tree_sequences: {list(uploaded_tree_sequences.keys())}")
        
        return {
            "message": f"Tree sequence '{filename}' deleted successfully",
            "remaining_files": list(uploaded_tree_sequences.keys())
        }
    except Exception as e:
        print(f"Error deleting tree sequence {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete tree sequence: {str(e)}")

@app.get("/download-tree-sequence/{filename}")
async def download_tree_sequence(filename: str):
    """Download the currently loaded tree sequence as a .tsz file"""
    if filename not in uploaded_tree_sequences:
        raise HTTPException(status_code=404, detail="Tree sequence not found")

    ts = uploaded_tree_sequences[filename]

    try:
        # Zip the tree sequence to a bytes buffer
        tsz_buffer = io.BytesIO()
        ts.dump(tsz_buffer, zlib_compression=tszip.ZLIB_DEFAULT_COMPRESSION)
        tsz_buffer.seek(0)

        # Create a StreamingResponse
        # Use the original filename but change extension to .tsz if it was .trees
        download_filename = filename
        if not download_filename.lower().endswith(".tsz"):
             download_filename += ".tsz"

        return StreamingResponse(
            tsz_buffer,
            media_type="application/octet-stream",
            headers={
                'Content-Disposition': f'attachment; filename="{download_filename}"'
            }
        )
    except Exception as e:
        print(f"Error zipping and downloading tree sequence {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to zip and download tree sequence: {e}")

@app.get("/graph-data/{filename}")
async def get_graph_data(
    filename: str, 
    max_samples: int = 25,
    genomic_start: float = None,
    genomic_end: float = None
):
    print("\n" + "="*50)
    print(f"Requesting graph data for file: {filename}")
    print(f"Genomic range: {genomic_start} - {genomic_end}")
    print(f"Currently loaded files: {list(uploaded_files.keys())}")
    print(f"Currently loaded tree sequences: {list(uploaded_tree_sequences.keys())}")
    
    if filename not in uploaded_tree_sequences:
        print(f"File {filename} not found in uploaded_tree_sequences")
        raise HTTPException(status_code=404, detail=f"File not found. Available files: {list(uploaded_tree_sequences.keys())}")
    
    ts = uploaded_tree_sequences[filename]
    print(f"Found tree sequence with {ts.num_nodes} nodes and {ts.num_edges} edges")
    
    # Validate max_samples parameter
    if max_samples < 2:
        raise HTTPException(status_code=400, detail="max_samples must be at least 2")
    if max_samples > ts.num_samples:
        raise HTTPException(status_code=400, detail=f"max_samples cannot exceed the number of samples ({ts.num_samples})")
    
    # Set default genomic range if not provided
    if genomic_start is None:
        genomic_start = 0
    if genomic_end is None:
        genomic_end = ts.sequence_length
        
    print(f"\nGenerating graph data for {filename} with max_samples={max_samples}")
    print(f"Total samples in tree sequence: {ts.num_samples}")
    print(f"Genomic range filter: {genomic_start} - {genomic_end}")
    
    try:
        # Get all sample nodes with their times
        sample_nodes = []
        for node in ts.nodes():
            if node.is_sample():
                # Use log(time) for y-axis position, adding a small constant to handle time=0
                time = node.time
                log_time = math.log(time + 1e-10) if time > 0 else 0
                sample_nodes.append({
                    'id': node.id,
                    'time': time,
                    'log_time': log_time  # Add log_time for y-axis positioning
                })
        
        # Sort by time and select evenly spaced samples if needed
        sample_nodes.sort(key=lambda x: x['time'])
        if len(sample_nodes) > max_samples:
            # Select evenly spaced samples
            indices = [int(i * (len(sample_nodes) - 1) / (max_samples - 1)) for i in range(max_samples)]
            selected_samples = [sample_nodes[i] for i in indices]
        else:
            selected_samples = sample_nodes
        
        # Get the node IDs for simplification
        sample_ids = [node['id'] for node in selected_samples]
        
        # Simplify the tree sequence
        print(f"Simplifying tree sequence with {len(sample_ids)} samples")
        ts_simplified = ts.simplify(samples=sample_ids)
        print(f"Simplified tree sequence has {ts_simplified.num_nodes} nodes and {ts_simplified.num_edges} edges")
        
        # Filter edges by genomic range
        filtered_edges = []
        for edge in ts_simplified.edges():
            # Check if edge overlaps with the requested genomic range
            edge_overlaps = (edge.left < genomic_end) and (edge.right > genomic_start)
            if edge_overlaps:
                filtered_edges.append(edge)
        
        print(f"After genomic filtering: {len(filtered_edges)} edges remain")
        
        # Calculate number of local trees in the genomic range
        num_local_trees = 0
        if genomic_start < genomic_end:
            for tree in ts_simplified.trees():
                # Check if tree interval overlaps with genomic range
                tree_overlaps = (tree.interval.left < genomic_end) and (tree.interval.right > genomic_start)
                if tree_overlaps:
                    num_local_trees += 1
        
        print(f"Number of local trees in range: {num_local_trees}")
        
        # Get all nodes that are connected by the filtered edges
        connected_node_ids = set()
        for edge in filtered_edges:
            connected_node_ids.add(edge.parent)
            connected_node_ids.add(edge.child)
        
        # Extract nodes and edges from simplified tree sequence
        nodes = []
        for node in ts_simplified.nodes():
            # Include nodes that are either samples or connected by filtered edges
            if node.is_sample() or node.id in connected_node_ids:
                # Use log(time) for y-axis position
                time = node.time
                log_time = math.log(time + 1e-10) if time > 0 else 0
                
                node_data = {
                    'id': node.id,
                    'time': time,
                    'log_time': log_time,  # Add log_time for y-axis positioning
                    'is_sample': node.is_sample(),
                    'individual': node.individual  # Include individual ID
                }
                
                # Add spatial location if available
                if node.individual != -1 and node.individual < ts_simplified.num_individuals:
                    individual = ts_simplified.individual(node.individual)
                    if individual.location is not None and len(individual.location) >= 2:
                        # Extract spatial coordinates (exclude Z if it exists)
                        location = individual.location
                        if len(location) >= 2:
                            node_data['location'] = {
                                'x': float(location[0]),
                                'y': float(location[1])
                            }
                            # Add Z coordinate if it exists and is non-zero
                            if len(location) >= 3 and location[2] != 0:
                                node_data['location']['z'] = float(location[2])
                
                nodes.append(node_data)
        
        edges = []
        for edge in filtered_edges:
            edges.append({
                'source': edge.parent,
                'target': edge.child,
                'left': edge.left,
                'right': edge.right
            })
        
        return {
            'nodes': nodes,
            'edges': edges,
            'metadata': {
                'num_nodes': len(nodes),
                'num_edges': len(edges),
                'num_samples': len(sample_ids),
                'sequence_length': ts_simplified.sequence_length,
                'genomic_start': genomic_start,
                'genomic_end': genomic_end,
                'is_subset': genomic_start > 0 or genomic_end < ts_simplified.sequence_length,
                'num_local_trees': num_local_trees,
                'original_nodes': ts_simplified.num_nodes,
                'auto_filtered': False
            }
        }
    except Exception as e:
        print(f"Error generating graph data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate graph data: {str(e)}")

@app.post("/simulate-spargviz")
async def simulate_spargviz(request: SpargvizSimulationRequest):
    """Generate a spARGviz simulation"""
    print(f"\nReceived spARGviz simulation request: {request}")
    
    try:
        # Generate the simulation
        ts = generate_ts(
            num_samples=request.num_samples,
            num_trees=request.num_trees,
            spatial_dims=request.spatial_dims,
            num_generations=request.num_generations,
            x_range=request.x_range,
            y_range=request.y_range
        )
        
        # Store the tree sequence with a generated filename
        filename = f"spargviz_sim_s{request.num_samples}_t{request.num_trees}_d{request.spatial_dims}.trees"
        uploaded_tree_sequences[filename] = ts
        
        # Check spatial and temporal information
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_info(ts)
        
        print(f"spARGviz simulation completed: {filename}")
        
        return {
            "filename": filename,
            "status": "tree_sequence_generated",
            "simulator": "spargviz",
            "num_nodes": ts.num_nodes,
            "num_edges": ts.num_edges,
            "num_samples": ts.num_samples,
            "num_trees": ts.num_trees,
            "sequence_length": ts.sequence_length,
            "has_temporal": has_temporal,
            "has_sample_spatial": spatial_info["has_sample_spatial"],
            "has_all_spatial": spatial_info["has_all_spatial"],
            "spatial_status": spatial_info["spatial_status"],
            "parameters": {
                "num_samples": request.num_samples,
                "num_trees": request.num_trees,
                "spatial_dimensions": request.spatial_dims,
                "x_range": request.x_range,
                "y_range": request.y_range,
                "num_generations": request.num_generations
            }
        }
        
    except Exception as e:
        print(f"Error in spARGviz simulation: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"spARGviz simulation failed: {str(e)}"
        )

@app.post("/simulate-msprime")
async def simulate_msprime(request: MsprimeSimulationRequest):
    """Generate an msprime simulation with proper ARG structure using record_full_arg=True"""
    print(f"\nReceived msprime simulation request: {request}")
    
    try:
        import msprime
        import random
        
        # Validate spatial parameters
        if request.spatial_dimensions < 0 or request.spatial_dimensions > 2:
            raise ValueError("Spatial dimensions must be 0, 1, or 2")
        if request.spatial_dimensions > 0 and (not request.spatial_boundary_size or len(request.spatial_boundary_size) != request.spatial_dimensions):
            raise ValueError(f"Must specify {request.spatial_dimensions} boundary sizes for {request.spatial_dimensions}D simulation")
        
        # Generate random seed for reproducibility
        ts_rs = random.randint(0, 10000)
        print(f"Using random seed: {ts_rs}")
        
        # Calculate sequence length and recombination rate based on desired local trees
        # More local trees = higher recombination rate or longer sequence
        base_sequence_length = 3000  # Base 3kb sequence
        if request.local_trees > 1:
            # Increase sequence length proportionally to get more recombination events
            sequence_length = base_sequence_length * request.local_trees
            # Use a recombination rate that should give approximately the desired number of trees
            recombination_rate = (request.local_trees - 1) / sequence_length * 2  # Roughly target number of recombinations
        else:
            sequence_length = base_sequence_length
            recombination_rate = 0  # No recombination for single tree
        
        print(f"Using sequence length: {sequence_length}, recombination rate: {recombination_rate}")
        print(f"Limiting simulation to {request.generations} generations")
        
        # Generate the simulation with proper ARG recording and limited generations
        ts = msprime.sim_ancestry(
            samples=request.sample_number,  # Use the user-provided sample number
            recombination_rate=recombination_rate,
            sequence_length=sequence_length,
            population_size=max(request.sample_number, request.generations),  # Ensure population size allows coalescence within time limit
            end_time=request.generations,  # Limit simulation to specified generations
            record_full_arg=True,  # This is key - records all recombination nodes
            random_seed=ts_rs
        )
        
        print(f"Generated ARG with {ts.num_nodes} nodes, {ts.num_edges} edges, {ts.num_trees} trees")
        
        # Add mutations to make it more realistic
        ts = msprime.sim_mutations(ts, rate=1e-7, random_seed=4321)
        
        print(f"Added mutations: {ts.num_mutations} mutations at {ts.num_sites} sites")
        
        # Add spatial locations if requested
        if request.spatial_dimensions > 0:
            ts = add_spatial_locations_to_all_nodes(
                ts, 
                request.spatial_dimensions, 
                request.spatial_boundary_size, 
                request.dispersal_range
            )

        # Store the tree sequence with a generated filename
        filename = f"msprime_arg_s{request.sample_number}_t{request.local_trees}_g{request.generations}_dim{request.spatial_dimensions}_seed{ts_rs}.trees"
        uploaded_tree_sequences[filename] = ts
        
        # Check spatial and temporal information
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_info(ts)
        
        # Count recombination nodes to verify ARG structure
        recomb_nodes = [n for n in ts.nodes() if n.flags & 131072]  # NODE_IS_RE_EVENT
        
        print(f"msprime ARG simulation completed: {filename}")
        print(f"Requested {request.local_trees} local trees, got {ts.num_trees} trees")
        print(f"Recombination nodes: {len(recomb_nodes)}")
        
        return {
            "filename": filename,
            "status": "tree_sequence_generated",
            "simulator": "msprime_arg",
            "num_nodes": ts.num_nodes,
            "num_edges": ts.num_edges,
            "num_samples": ts.num_samples,
            "num_trees": ts.num_trees,
            "num_mutations": ts.num_mutations,
            "num_sites": ts.num_sites,
            "num_recombination_nodes": len(recomb_nodes),
            "sequence_length": ts.sequence_length,
            "has_temporal": has_temporal,
            "has_sample_spatial": spatial_info["has_sample_spatial"],
            "has_all_spatial": spatial_info["has_all_spatial"],
            "spatial_status": spatial_info["spatial_status"],
            "parameters": {
                "sample_number": request.sample_number,
                "local_trees": request.local_trees,
                "generations": request.generations,
                "spatial_dimensions": request.spatial_dimensions,
                "spatial_boundary_size": request.spatial_boundary_size,
                "dispersal_range": request.dispersal_range,
                "random_seed": ts_rs,
                "recombination_rate": recombination_rate,
                "mutation_rate": 1e-7,
                "sequence_length": sequence_length
            }
        }
        
    except Exception as e:
        print(f"Error in msprime ARG simulation: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"msprime ARG simulation failed: {str(e)}"
        )

@app.post("/infer-locations-fast")
async def infer_locations_fast(request: FastLocationInferenceRequest):
    """
    Infer locations using the fastgaia package for fast spatial inference.
    Available for ARGs with spatial information for samples but not all nodes,
    or for ARGs with spatial information for all nodes (re-inference).
    """
    print(f"\nReceived fast location inference request for file: {request.filename}")
    
    if request.filename not in uploaded_tree_sequences:
        raise HTTPException(
            status_code=404, 
            detail=f"File not found. Available files: {list(uploaded_tree_sequences.keys())}"
        )
    
    ts = uploaded_tree_sequences[request.filename]
    
    try:
        # Create a temporary directory for fastgaia operations
        with tempfile.TemporaryDirectory() as temp_dir:
            # Save the tree sequence to a temporary file
            temp_ts_path = os.path.join(temp_dir, "temp.trees")
            ts.dump(temp_ts_path)
            
            # Set up output paths
            output_inferred_continuous = os.path.join(temp_dir, "inferred_locations.csv")
            output_debug = os.path.join(temp_dir, "debug_info.csv")
            
            print(f"Running fastgaia inference for {ts.num_nodes} nodes...")
            
            # Call fastgaia infer_locations function
            result_summary = infer_locations(
                tree_path=temp_ts_path,
                continuous_sample_locations_path=None,  # Let fastgaia infer from tree sequence
                discrete_sample_locations_path=None,
                cost_matrix_path=None,
                weight_span=request.weight_span,
                weight_branch_length=request.weight_branch_length,
                output_inferred_continuous=output_inferred_continuous,
                output_inferred_discrete=None,
                output_locations_continuous=None,
                output_debug=output_debug,
                verbosity=1  # Minimal verbosity
            )
            
            print(f"Fastgaia inference completed. Result summary: {result_summary}")
            
            # Read the inferred locations
            if os.path.exists(output_inferred_continuous):
                import pandas as pd
                locations_df = pd.read_csv(output_inferred_continuous)
                print(f"Read {len(locations_df)} inferred locations")
                
                # Apply the inferred locations to the tree sequence
                ts_with_locations = apply_inferred_locations_to_tree_sequence(ts, locations_df)
                
                # Store the updated tree sequence with a new filename
                new_filename = f"{request.filename.rsplit('.', 1)[0]}_fast_inferred.trees"
                uploaded_tree_sequences[new_filename] = ts_with_locations
                
                # Check spatial information for the updated tree sequence
                spatial_info = check_spatial_info(ts_with_locations)
                
                return {
                    "status": "success",
                    "message": "Fast location inference completed successfully",
                    "original_filename": request.filename,
                    "new_filename": new_filename,
                    "num_inferred_locations": len(locations_df),
                    "num_nodes": ts_with_locations.num_nodes,
                    "num_samples": ts_with_locations.num_samples,
                    "has_sample_spatial": spatial_info["has_sample_spatial"],
                    "has_all_spatial": spatial_info["has_all_spatial"],
                    "spatial_status": spatial_info["spatial_status"],
                    "inference_parameters": {
                        "weight_span": request.weight_span,
                        "weight_branch_length": request.weight_branch_length
                    }
                }
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Inference completed but no output file was generated"
                )
                
    except Exception as e:
        print(f"Error during fast location inference: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Fast location inference failed: {str(e)}"
        )

def apply_inferred_locations_to_tree_sequence(ts: tskit.TreeSequence, locations_df) -> tskit.TreeSequence:
    """
    Apply inferred locations from fastgaia to a tree sequence.
    
    Parameters:
    - ts: Original tree sequence
    - locations_df: DataFrame with columns 'node_id', 'dim1', 'dim2', etc.
    
    Returns:
    - Updated tree sequence with spatial locations
    """
    print(f"Applying inferred locations to tree sequence...")
    
    # Convert to table collection for modification
    tables = ts.dump_tables()
    
    # Clear existing individuals table
    tables.individuals.clear()
    
    # Get dimension columns (all columns except node_id)
    dim_columns = [col for col in locations_df.columns if col != 'node_id']
    num_dims = len(dim_columns)
    
    print(f"Found {num_dims} spatial dimensions in inferred locations")
    
    # Create a mapping from node_id to location
    node_to_location = {}
    for _, row in locations_df.iterrows():
        node_id = int(row['node_id'])
        location_3d = np.zeros(3)  # Always use 3D array for tskit compatibility
        for i, dim_col in enumerate(dim_columns):
            if i < 3:  # Only use first 3 dimensions
                location_3d[i] = float(row[dim_col])
        node_to_location[node_id] = location_3d
    
    # Create individuals for all nodes with inferred locations
    node_to_individual = {}
    for node_id, location in node_to_location.items():
        individual_id = tables.individuals.add_row(
            flags=0,
            location=location,
            parents=[]
        )
        node_to_individual[node_id] = individual_id
    
    # Update nodes table to associate nodes with their corresponding individuals
    new_nodes = tables.nodes.copy()
    new_nodes.clear()
    
    for node in ts.nodes():
        individual_id = node_to_individual.get(node.id, -1)
        new_nodes.add_row(
            time=node.time,
            flags=node.flags,
            population=node.population,
            individual=individual_id,
            metadata=node.metadata
        )
    
    tables.nodes.replace_with(new_nodes)
    
    # Rebuild tree sequence
    result_ts = tables.tree_sequence()
    print(f"Applied inferred locations to {len(node_to_location)} nodes")
    
    return result_ts

def convert_to_d3arg(ts: tskit.TreeSequence, max_samples: int = 25) -> Dict[str, Any]:
    """
    Convert a tskit.TreeSequence to D3ARG format following tskit_arg_visualizer patterns
    """
    print(f"Converting tree sequence to D3ARG format with max_samples={max_samples}")
    
    # Simplify if needed
    if ts.num_samples > max_samples:
        sample_nodes = [node for node in ts.nodes() if node.is_sample()]
        sample_nodes.sort(key=lambda x: x.time)
        
        # Select evenly spaced samples
        indices = [int(i * (len(sample_nodes) - 1) / (max_samples - 1)) for i in range(max_samples)]
        selected_sample_ids = [sample_nodes[i].id for i in indices]
        ts = ts.simplify(samples=selected_sample_ids)
        print(f"Simplified to {max_samples} samples")
    
    # Step 1: Identify recombination node pairs (following tskit_arg_visualizer pattern)
    recomb_node_pairs = {}
    recomb_merged_to = {}  # Maps original node ID to merged node ID
    
    # Find recombination nodes - use every second one as in tskit_arg_visualizer
    recomb_nodes = []
    for node in ts.nodes():
        if node.flags & 131072:  # msprime.NODE_IS_RE_EVENT
            recomb_nodes.append(node.id)
    
    # Merge every second recombination node (following tskit_arg_visualizer [1::2] pattern)
    recomb_nodes_to_merge = recomb_nodes[1::2] if len(recomb_nodes) > 1 else []
    
    for node_id in recomb_nodes_to_merge:
        # Find its pair (the previous recombination node)
        pair_id = node_id - 1
        if pair_id in recomb_nodes:
            recomb_node_pairs[pair_id] = node_id
            recomb_merged_to[pair_id] = pair_id  # Keep the smaller ID
            recomb_merged_to[node_id] = pair_id  # Merge to the smaller ID
    
    print(f"Found {len(recomb_node_pairs)} recombination node pairs to merge")
    
    # Step 2: Create merged nodes with improved positioning
    nodes = []
    node_mapping = {}  # Original ID -> new node data
    processed_nodes = set()
    
    for node in ts.nodes():
        if node.id in processed_nodes:
            continue
            
        if node.id in recomb_merged_to:
            # This is a recombination node
            merged_id = recomb_merged_to[node.id]
            if merged_id == node.id:  # This is the representative node
                other_id = recomb_node_pairs.get(node.id)
                if other_id:
                    label = f"{node.id}/{other_id}"
                    processed_nodes.add(other_id)
                else:
                    label = str(node.id)
                processed_nodes.add(node.id)
                
                # Recombination nodes get diamond shape and special color
                node_data = {
                    'id': node.id,
                    'index': node.id,
                    'label': label,
                    'ts_flags': node.flags,
                    'time': node.time,
                    'child_of': [],
                    'parent_of': [],
                    'size': 150,
                    'symbol': 'd3.symbolDiamond',
                    'fill': '#ff6b6b',  # Red for recombination
                    'stroke': '#2c3e50',
                    'stroke_width': 2,
                    'include_label': True,
                    'x': 0,
                    'y': 0,
                    'vx': 0,
                    'vy': 0
                }
                nodes.append(node_data)
                node_mapping[node.id] = node_data
                if other_id:
                    node_mapping[other_id] = node_data
        else:
            # Regular node
            node_data = {
                'id': node.id,
                'index': node.id,
                'label': str(node.id),
                'ts_flags': node.flags,
                'time': node.time,
                'child_of': [],
                'parent_of': [],
                'size': 200 if node.is_sample() else 150,
                'symbol': 'd3.symbolSquare' if node.is_sample() else 'd3.symbolCircle',
                'fill': '#4ecdc4' if node.is_sample() else '#95a5a6',
                'stroke': '#2c3e50',
                'stroke_width': 2,
                'include_label': True,
                'x': 0,
                'y': 0,
                'vx': 0,
                'vy': 0
            }
            nodes.append(node_data)
            node_mapping[node.id] = node_data
            processed_nodes.add(node.id)
    
    # Step 3: Group and merge edges (improved algorithm)
    edge_groups = defaultdict(list)
    
    for edge in ts.edges():
        # Map parent and child to merged node IDs
        parent_id = recomb_merged_to.get(edge.parent, edge.parent)
        child_id = recomb_merged_to.get(edge.child, edge.child)
        
        # Skip self-loops that might occur from merging
        if parent_id != child_id:
            edge_groups[(parent_id, child_id)].append(edge)
    
    # Step 4: Create merged links with better bounds representation
    links = []
    link_id = 0
    
    for (parent_id, child_id), edge_list in edge_groups.items():
        # Merge overlapping intervals more carefully
        intervals = []
        for edge in edge_list:
            intervals.append((edge.left, edge.right))
        
        # Sort intervals by start position
        intervals.sort()
        merged_intervals = []
        
        for start, end in intervals:
            if merged_intervals and start <= merged_intervals[-1][1]:
                # Overlapping or adjacent intervals - merge them
                merged_intervals[-1] = (merged_intervals[-1][0], max(merged_intervals[-1][1], end))
            else:
                merged_intervals.append((start, end))
        
        # Create bounds string with proper formatting
        bounds_parts = []
        for start, end in merged_intervals:
            if abs(start - int(start)) < 1e-10 and abs(end - int(end)) < 1e-10:
                bounds_parts.append(f"{int(start)}-{int(end)}")
            else:
                bounds_parts.append(f"{start:.1f}-{end:.1f}")
        bounds = " ".join(bounds_parts)
        
        # Calculate region fraction
        total_length = sum(end - start for start, end in merged_intervals)
        region_fraction = total_length / ts.sequence_length
        
        link_data = {
            'id': link_id,
            'source': parent_id,
            'target': child_id,
            'bounds': bounds,
            'region_fraction': region_fraction,
            'color': '#34495e'
        }
        links.append(link_data)
        
        # Update parent_of and child_of relationships
        if parent_id in node_mapping:
            node_mapping[parent_id]['parent_of'].append(child_id)
        if child_id in node_mapping:
            node_mapping[child_id]['child_of'].append(parent_id)
        
        link_id += 1
    
    # Step 5: Calculate breakpoints with better precision
    breakpoints = []
    for i, tree in enumerate(ts.trees()):
        start_pos = tree.interval[0] / ts.sequence_length
        width = (tree.interval[1] - tree.interval[0]) / ts.sequence_length
        
        breakpoint = {
            'start': tree.interval[0],
            'stop': tree.interval[1],
            'x_pos_01': start_pos,
            'x_pos': start_pos * 800,  # Assuming 800px width
            'width_01': width,
            'width': width * 800,
            'included': True
        }
        breakpoints.append(breakpoint)
    
    # Step 6: Improved y-axis setup with better time handling
    node_times = [node['time'] for node in nodes]
    unique_times = sorted(set(node_times))
    
    # Create evenly spaced ranks for y-axis
    y_ticks = list(range(len(unique_times)))
    y_labels = [f"{time:.3f}" if time != int(time) else str(int(time)) for time in unique_times]
    
    # Step 7: Calculate positions for samples (following tskit_arg_visualizer pattern)
    sample_nodes = [node for node in nodes if node['ts_flags'] & 1]  # NODE_IS_SAMPLE = 1
    
    # Evenly distributed positions for samples
    if sample_nodes:
        sample_spacing = 800 / (len(sample_nodes) + 1)
        evenly_distributed_positions = [(i + 1) * sample_spacing for i in range(len(sample_nodes))]
        
        # Set initial x positions for samples
        for i, node in enumerate(sample_nodes):
            node['x'] = evenly_distributed_positions[i]
    else:
        evenly_distributed_positions = []
    
    # Create the final D3ARG object (matching tskit_arg_visualizer structure)
    d3arg_data = {
        'data': {
            'nodes': nodes,
            'links': links,
            'breakpoints': breakpoints
        },
        'evenly_distributed_positions': evenly_distributed_positions,
        'width': 800,
        'height': max(600, len(unique_times) * 60 + 150),  # More spacing for better visualization
        'y_axis': {
            'include_labels': True,
            'ticks': y_ticks,
            'text': y_labels,
            'max_min': [max(y_ticks), min(y_ticks)] if y_ticks else [0, 0],
            'scale': 'rank'
        },
        'nodes': {
            'size': 150,
            'symbol': 'd3.symbolCircle',
            'sample_symbol': 'd3.symbolSquare',
            'subset_nodes': None,
            'include_labels': True
        },
        'edges': {
            'type': 'ortho',  # Use orthogonal pathing for Pretty ARG
            'variable_width': False,
            'include_underlink': False
        },
        'tree_highlighting': True,
        'title': f"Pretty ARG - {len(sample_nodes)} samples, {len(links)} edges"
    }
    
    print(f"D3ARG conversion complete: {len(nodes)} nodes, {len(links)} links, {len(breakpoints)} trees")
    print(f"Recombination nodes merged: {len(recomb_node_pairs)}")
    return d3arg_data

@app.get("/pretty-arg-data/{filename}")
async def get_pretty_arg_data(
    filename: str, 
    max_samples: int = 25,
    focus: int = None,
    mode: str = None
):
    print(f"\nRequesting Pretty ARG data for file: {filename}")
    if focus is not None:
        print(f"Focus mode: {mode} on node {focus}")
    
    if filename not in uploaded_tree_sequences:
        print(f"File {filename} not found")
        raise HTTPException(status_code=404, detail=f"File not found. Available files: {list(uploaded_tree_sequences.keys())}")
    
    ts = uploaded_tree_sequences[filename]
    original_nodes = ts.num_nodes
    print(f"Found tree sequence with {ts.num_nodes} nodes and {ts.num_edges} edges")
    
    # Validate max_samples parameter
    if max_samples < 2:
        raise HTTPException(status_code=400, detail="max_samples must be at least 2")
    if max_samples > ts.num_samples:
        max_samples = ts.num_samples
    
    try:
        # Apply filtering if focus and mode are specified
        filtered_ts = ts
        if focus is not None and mode is not None:
            filtered_ts = apply_focus_filter(ts, focus, mode)
            print(f"Applied {mode} filter on node {focus}: {filtered_ts.num_nodes} nodes, {filtered_ts.num_edges} edges")
        
        d3arg_data = convert_to_d3arg(filtered_ts, max_samples)
        
        # Add focus information to the response
        if focus is not None:
            d3arg_data['focus'] = {
                'node_id': focus,
                'mode': mode,
                'original_nodes': original_nodes,
                'filtered_nodes': filtered_ts.num_nodes
            }
        
        return d3arg_data
    except Exception as e:
        print(f"Error generating Pretty ARG data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate Pretty ARG data: {str(e)}")

def apply_focus_filter(ts: tskit.TreeSequence, focus_node: int, mode: str) -> tskit.TreeSequence:
    """
    Apply focus filtering to show subgraph or parent graph
    """
    print(f"Applying {mode} filter on node {focus_node}")
    
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
        
        print(f"Subgraph includes {len(nodes_to_keep)} nodes")
        
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
        
        print(f"Parent graph includes {len(nodes_to_keep)} nodes")
    
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)