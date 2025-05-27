# main.py

import logging
import math
import os
import sys
import tempfile
from collections import defaultdict
from typing import Dict, Any, List, Tuple, Optional

import numpy as np
import tskit
import tszip
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Constants
DEFAULT_GRAPH_WIDTH = 800
DEFAULT_GRAPH_HEIGHT = 600
DEFAULT_MIN_SPACING = 15
DEFAULT_MARGIN = 50
DEFAULT_NODE_SIZE_SAMPLE = 200
DEFAULT_NODE_SIZE_INTERNAL = 150
DEFAULT_STROKE_WIDTH = 2
BASE_SEQUENCE_LENGTH = 3000
BASE_TIME_STEP = 0.1
MIN_RECOMBINATION_LENGTH = 100.0
DEFAULT_RECOMBINATION_PROB = 0.15
DEFAULT_COALESCENCE_RATE = 1.0
DEFAULT_EDGE_DENSITY = 0.8
SPATIAL_NOISE_FACTOR = 0.1

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add fastgaia to path and import
backend_path = os.path.dirname(__file__)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

try:
    from fastgaia.main import infer_locations
except ImportError:
    logger.warning("Could not import fastgaia. Location inference will be unavailable.")
    infer_locations = None

app = FastAPI(title="SPARG Visualization API", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# File storage
class FileStorage:
    def __init__(self):
        self._uploaded_files = {}
        self._uploaded_tree_sequences = {}
    
    def store_file(self, filename: str, contents: bytes):
        self._uploaded_files[filename] = contents
    
    def store_tree_sequence(self, filename: str, ts: tskit.TreeSequence):
        self._uploaded_tree_sequences[filename] = ts
    
    def get_tree_sequence(self, filename: str) -> Optional[tskit.TreeSequence]:
        return self._uploaded_tree_sequences.get(filename)
    
    def get_file_list(self) -> List[str]:
        return list(self._uploaded_tree_sequences.keys())
    
    def delete_file(self, filename: str):
        self._uploaded_files.pop(filename, None)
        self._uploaded_tree_sequences.pop(filename, None)

file_storage = FileStorage()

# Pydantic models
class SpargvizSimulationRequest(BaseModel):
    num_samples: int
    num_trees: int
    spatial_dims: int = 0
    num_generations: int = 2
    x_range: float = 10.0
    y_range: Optional[float] = None
    recombination_probability: float = DEFAULT_RECOMBINATION_PROB
    coalescence_rate: float = DEFAULT_COALESCENCE_RATE
    edge_density: float = DEFAULT_EDGE_DENSITY
    
    # Backwards compatibility
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
    local_trees: int = 15
    generations: int = 2

class FastLocationInferenceRequest(BaseModel):
    filename: str
    weight_span: bool = True
    weight_branch_length: bool = True

# Utility functions
def check_spatial_completeness(ts: tskit.TreeSequence) -> Dict[str, bool]:
    """Check spatial information completeness in tree sequence."""
    logger.info(f"Checking spatial info for {ts.num_individuals} individuals, {ts.num_nodes} nodes")
    
    sample_has_spatial = True
    all_has_spatial = True
    
    for node in ts.nodes():
        individual_id = node.individual
        
        if individual_id == -1:
            all_has_spatial = False
            if node.flags & tskit.NODE_IS_SAMPLE:
                sample_has_spatial = False
        else:
            individual = ts.individual(individual_id)
            if individual.location is None or len(individual.location) < 2:
                all_has_spatial = False
                if node.flags & tskit.NODE_IS_SAMPLE:
                    sample_has_spatial = False
    
    spatial_status = "all" if all_has_spatial else ("sample_only" if sample_has_spatial else "none")
    
    return {
        "has_sample_spatial": sample_has_spatial,
        "has_all_spatial": all_has_spatial,
        "spatial_status": spatial_status
    }

def validate_simulation_params(num_samples: int, num_trees: int, spatial_dims: int, 
                             num_generations: int, coalescence_rate: float, 
                             edge_density: float, recombination_probability: float):
    """Validate simulation parameters."""
    if num_samples < 2:
        raise ValueError("num_samples must be at least 2")
    if num_trees < 1:
        raise ValueError("num_trees must be at least 1")
    if spatial_dims not in [0, 1, 2]:
        raise ValueError("spatial_dims must be 0, 1, or 2")
    if num_generations < 1:
        raise ValueError("num_generations must be at least 1")
    if not 0.0 <= recombination_probability <= 1.0:
        raise ValueError("recombination_probability must be between 0 and 1")
    if coalescence_rate <= 0:
        raise ValueError("coalescence_rate must be positive")
    if edge_density <= 0:
        raise ValueError("edge_density must be positive")

def load_tree_sequence_from_file(contents: bytes, filename: str) -> tskit.TreeSequence:
    """Load tree sequence from file contents."""
    if filename.endswith(".tsz"):
        import io
        with io.BytesIO(contents) as tsz_stream:
            with tszip.open(tsz_stream, "rb") as decompressed:
                with tempfile.NamedTemporaryFile(suffix=".trees", delete=False) as tmp:
                    try:
                        tmp.write(decompressed.read())
                        tmp.close()
                        return tskit.load(tmp.name)
                    finally:
                        os.unlink(tmp.name)
    elif filename.endswith(".trees"):
        with tempfile.NamedTemporaryFile(suffix=".trees", delete=False) as tmp:
            try:
                tmp.write(contents)
                tmp.close()
                return tskit.load(tmp.name)
            finally:
                os.unlink(tmp.name)
    else:
        raise ValueError("Unsupported file type. Please upload a .trees or .tsz file.")

# API endpoints
@app.get("/")
async def root():
    return {"message": "SPARG Visualization API", "status": "running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/upload-tree-sequence")
async def upload_tree_sequence(file: UploadFile = File(...)):
    """Upload and process tree sequence files."""
    logger.info(f"Processing upload: {file.filename}")
    
    try:
        contents = await file.read()
        file_storage.store_file(file.filename, contents)
        
        ts = load_tree_sequence_from_file(contents, file.filename)
        file_storage.store_tree_sequence(file.filename, ts)
        
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_completeness(ts)
        
        logger.info(f"Successfully loaded tree sequence: {ts.num_nodes} nodes, {ts.num_edges} edges")
        
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
            **spatial_info
        }
    except Exception as e:
        logger.error(f"Failed to load tree sequence {file.filename}: {str(e)}")
        file_storage.delete_file(file.filename)
        raise HTTPException(status_code=400, detail=f"Failed to load tree sequence: {str(e)}")

@app.get("/uploaded-files")
async def list_uploaded_files():
    """List all currently uploaded files."""
    return {"uploaded_tree_sequences": file_storage.get_file_list()}

@app.get("/tree-sequence-metadata/{filename}")
async def get_tree_sequence_metadata(filename: str):
    """Get metadata for a specific tree sequence."""
    ts = file_storage.get_tree_sequence(filename)
    if ts is None:
        raise HTTPException(status_code=404, detail=f"Tree sequence not found")
    
    try:
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_completeness(ts)
        
        return {
            "filename": filename,
            "num_nodes": ts.num_nodes,
            "num_edges": ts.num_edges,
            "num_samples": ts.num_samples,
            "num_trees": ts.num_trees,
            "sequence_length": ts.sequence_length,
            "has_temporal": has_temporal,
            **spatial_info
        }
    except Exception as e:
        logger.error(f"Error getting metadata for {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get metadata: {str(e)}")

@app.delete("/tree-sequence/{filename}")
async def delete_tree_sequence(filename: str):
    """Delete a tree sequence from memory."""
    if file_storage.get_tree_sequence(filename) is None:
        raise HTTPException(status_code=404, detail="Tree sequence not found")
    
    try:
        file_storage.delete_file(filename)
        logger.info(f"Deleted tree sequence: {filename}")
        
        return {
            "message": f"Tree sequence '{filename}' deleted successfully",
            "remaining_files": file_storage.get_file_list()
        }
    except Exception as e:
        logger.error(f"Error deleting tree sequence {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete tree sequence: {str(e)}")

@app.get("/download-tree-sequence/{filename}")
async def download_tree_sequence(filename: str):
    """Download tree sequence as .tsz file."""
    ts = file_storage.get_tree_sequence(filename)
    if ts is None:
        raise HTTPException(status_code=404, detail="Tree sequence not found")

    try:
        import io
        tsz_buffer = io.BytesIO()
        ts.dump(tsz_buffer, zlib_compression=tszip.ZLIB_DEFAULT_COMPRESSION)
        tsz_buffer.seek(0)

        download_filename = filename if filename.endswith(".tsz") else f"{filename}.tsz"

        return StreamingResponse(
            tsz_buffer,
            media_type="application/octet-stream",
            headers={'Content-Disposition': f'attachment; filename="{download_filename}"'}
        )
    except Exception as e:
        logger.error(f"Error downloading tree sequence {filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download: {e}")

@app.get("/graph-data/{filename}")
async def get_graph_data(
    filename: str, 
    max_samples: int = 25,
    genomic_start: float = None,
    genomic_end: float = None
):
    """Extract graph data from tree sequence with genomic filtering."""
    ts = file_storage.get_tree_sequence(filename)
    if ts is None:
        raise HTTPException(status_code=404, detail="Tree sequence not found")
    
    logger.info(f"Generating graph data for {filename} with max_samples={max_samples}")
    
    if max_samples < 2 or max_samples > ts.num_samples:
        raise HTTPException(status_code=400, detail="Invalid max_samples value")
    
    if genomic_start is None:
        genomic_start = 0
    if genomic_end is None:
        genomic_end = ts.sequence_length
        
    try:
        # Get evenly spaced samples
        sample_nodes = [node for node in ts.nodes() if node.is_sample()]
        sample_nodes.sort(key=lambda x: x.time)
        
        if len(sample_nodes) > max_samples:
            indices = [int(i * (len(sample_nodes) - 1) / (max_samples - 1)) for i in range(max_samples)]
            selected_samples = [sample_nodes[i] for i in indices]
        else:
            selected_samples = sample_nodes
        
        sample_ids = [node.id for node in selected_samples]
        ts_simplified = ts.simplify(samples=sample_ids)
        
        # Filter edges by genomic range
        filtered_edges = [
            edge for edge in ts_simplified.edges()
            if edge.left < genomic_end and edge.right > genomic_start
        ]
        
        # Build node and edge data
        connected_node_ids = set()
        for edge in filtered_edges:
            connected_node_ids.update([edge.parent, edge.child])
        
        nodes = []
        for node in ts_simplified.nodes():
            if node.is_sample() or node.id in connected_node_ids:
                time = node.time
                log_time = math.log(time + 1e-10) if time > 0 else 0
                
                node_data = {
                    'id': node.id,
                    'time': time,
                    'log_time': log_time,
                    'is_sample': node.is_sample(),
                    'individual': node.individual
                }
                
                # Add spatial location if available
                if node.individual != -1 and node.individual < ts_simplified.num_individuals:
                    individual = ts_simplified.individual(node.individual)
                    if individual.location is not None and len(individual.location) >= 2:
                        node_data['location'] = {
                            'x': float(individual.location[0]),
                            'y': float(individual.location[1])
                        }
                        if len(individual.location) >= 3 and individual.location[2] != 0:
                            node_data['location']['z'] = float(individual.location[2])
                
                nodes.append(node_data)
        
        edges = [
            {
                'source': edge.parent,
                'target': edge.child,
                'left': edge.left,
                'right': edge.right
            }
            for edge in filtered_edges
        ]
        
        # Count local trees in range
        num_local_trees = sum(
            1 for tree in ts_simplified.trees()
            if tree.interval.left < genomic_end and tree.interval.right > genomic_start
        )
        
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
        logger.error(f"Error generating graph data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate graph data: {str(e)}")

@app.post("/simulate-spargviz")
async def simulate_spargviz(request: SpargvizSimulationRequest):
    """Generate a spARGviz simulation."""
    logger.info(f"Received spARGviz simulation request: {request}")
    
    try:
        validate_simulation_params(
            request.num_samples, request.num_trees, request.spatial_dims,
            request.num_generations, request.coalescence_rate, 
            request.edge_density, request.recombination_probability
        )
        
        from simulation_models import generate_spargviz_simulation
        
        ts = generate_spargviz_simulation(
            num_samples=request.num_samples,
            num_trees=request.num_trees,
            spatial_dims=request.spatial_dims,
            num_generations=request.num_generations,
            x_range=request.x_range,
            y_range=request.y_range,
            recombination_probability=request.recombination_probability,
            coalescence_rate=request.coalescence_rate,
            edge_density=request.edge_density
        )
        
        filename = f"spargviz_sim_s{request.num_samples}_t{request.num_trees}_d{request.spatial_dims}.trees"
        file_storage.store_tree_sequence(filename, ts)
        
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_completeness(ts)
        
        logger.info(f"spARGviz simulation completed: {filename}")
        
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
            **spatial_info,
            "parameters": {
                "num_samples": request.num_samples,
                "num_trees": request.num_trees,
                "spatial_dimensions": request.spatial_dims,
                "x_range": request.x_range,
                "y_range": request.y_range,
                "num_generations": request.num_generations,
                "recombination_probability": request.recombination_probability,
                "coalescence_rate": request.coalescence_rate,
                "edge_density": request.edge_density
            }
        }
        
    except Exception as e:
        logger.error(f"Error in spARGviz simulation: {str(e)}")
        raise HTTPException(status_code=400, detail=f"spARGviz simulation failed: {str(e)}")

@app.post("/simulate-msprime")
async def simulate_msprime(request: MsprimeSimulationRequest):
    """Generate an msprime simulation with proper ARG structure."""
    logger.info(f"Received msprime simulation request: {request}")
    
    try:
        from simulation_models import generate_msprime_simulation
        
        ts = generate_msprime_simulation(
            sample_number=request.sample_number,
            spatial_dimensions=request.spatial_dimensions,
            spatial_boundary_size=request.spatial_boundary_size,
            dispersal_range=request.dispersal_range,
            local_trees=request.local_trees,
            generations=request.generations
        )
        
        filename = f"msprime_arg_s{request.sample_number}_t{request.local_trees}_g{request.generations}_dim{request.spatial_dimensions}.trees"
        file_storage.store_tree_sequence(filename, ts)
        
        has_temporal = any(node.time != 0 for node in ts.nodes() if node.flags & tskit.NODE_IS_SAMPLE == 0)
        spatial_info = check_spatial_completeness(ts)
        
        # Count recombination nodes
        recomb_nodes = [n for n in ts.nodes() if n.flags & 131072]  # NODE_IS_RE_EVENT
        
        logger.info(f"msprime ARG simulation completed: {filename}")
        
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
            **spatial_info,
            "parameters": {
                "sample_number": request.sample_number,
                "local_trees": request.local_trees,
                "generations": request.generations,
                "spatial_dimensions": request.spatial_dimensions,
                "spatial_boundary_size": request.spatial_boundary_size,
                "dispersal_range": request.dispersal_range
            }
        }
        
    except Exception as e:
        logger.error(f"Error in msprime ARG simulation: {str(e)}")
        raise HTTPException(status_code=400, detail=f"msprime ARG simulation failed: {str(e)}")

@app.post("/infer-locations-fast")
async def infer_locations_fast(request: FastLocationInferenceRequest):
    """Infer locations using the fastgaia package for fast spatial inference."""
    if infer_locations is None:
        raise HTTPException(status_code=503, detail="fastgaia not available")
    
    logger.info(f"Received fast location inference request for file: {request.filename}")
    
    ts = file_storage.get_tree_sequence(request.filename)
    if ts is None:
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_ts_path = os.path.join(temp_dir, "temp.trees")
            ts.dump(temp_ts_path)
            
            output_inferred_continuous = os.path.join(temp_dir, "inferred_locations.csv")
            output_debug = os.path.join(temp_dir, "debug_info.csv")
            
            logger.info(f"Running fastgaia inference for {ts.num_nodes} nodes...")
            
            result_summary = infer_locations(
                tree_path=temp_ts_path,
                continuous_sample_locations_path=None,
                discrete_sample_locations_path=None,
                cost_matrix_path=None,
                weight_span=request.weight_span,
                weight_branch_length=request.weight_branch_length,
                output_inferred_continuous=output_inferred_continuous,
                output_inferred_discrete=None,
                output_locations_continuous=None,
                output_debug=output_debug,
                verbosity=1
            )
            
            if os.path.exists(output_inferred_continuous):
                import pandas as pd
                locations_df = pd.read_csv(output_inferred_continuous)
                logger.info(f"Read {len(locations_df)} inferred locations")
                
                ts_with_locations = apply_inferred_locations_to_tree_sequence(ts, locations_df)
                
                new_filename = f"{request.filename.rsplit('.', 1)[0]}_fast_inferred.trees"
                file_storage.store_tree_sequence(new_filename, ts_with_locations)
                
                spatial_info = check_spatial_completeness(ts_with_locations)
                
                return {
                    "status": "success",
                    "message": "Fast location inference completed successfully",
                    "original_filename": request.filename,
                    "new_filename": new_filename,
                    "num_inferred_locations": len(locations_df),
                    "num_nodes": ts_with_locations.num_nodes,
                    "num_samples": ts_with_locations.num_samples,
                    **spatial_info,
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
        logger.error(f"Error during fast location inference: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Fast location inference failed: {str(e)}")

def apply_inferred_locations_to_tree_sequence(ts: tskit.TreeSequence, locations_df) -> tskit.TreeSequence:
    """Apply inferred locations from fastgaia to a tree sequence."""
    logger.info("Applying inferred locations to tree sequence...")
    
    tables = ts.dump_tables()
    tables.individuals.clear()
    
    dim_columns = [col for col in locations_df.columns if col != 'node_id']
    num_dims = len(dim_columns)
    
    logger.info(f"Found {num_dims} spatial dimensions in inferred locations")
    
    node_to_location = {}
    for _, row in locations_df.iterrows():
        node_id = int(row['node_id'])
        location_3d = np.zeros(3)
        for i, dim_col in enumerate(dim_columns):
            if i < 3:
                location_3d[i] = float(row[dim_col])
        node_to_location[node_id] = location_3d
    
    node_to_individual = {}
    for node_id, location in node_to_location.items():
        individual_id = tables.individuals.add_row(
            flags=0,
            location=location,
            parents=[]
        )
        node_to_individual[node_id] = individual_id
    
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
    
    result_ts = tables.tree_sequence()
    logger.info(f"Applied inferred locations to {len(node_to_location)} nodes")
    
    return result_ts

@app.get("/pretty-arg-data/{filename}")
async def get_pretty_arg_data(
    filename: str, 
    max_samples: int = 25,
    focus: int = None,
    mode: str = None
):
    """Get Pretty ARG data for visualization."""
    logger.info(f"Requesting Pretty ARG data for file: {filename}")
    if focus is not None:
        logger.info(f"Focus mode: {mode} on node {focus}")
    
    ts = file_storage.get_tree_sequence(filename)
    if ts is None:
        raise HTTPException(status_code=404, detail="Tree sequence not found")
    
    original_nodes = ts.num_nodes
    logger.info(f"Found tree sequence with {ts.num_nodes} nodes and {ts.num_edges} edges")
    
    if max_samples < 2:
        raise HTTPException(status_code=400, detail="max_samples must be at least 2")
    if max_samples > ts.num_samples:
        max_samples = ts.num_samples
    
    try:
        from visualization_utils import convert_to_d3arg, apply_focus_filter
        
        # Apply filtering if focus and mode are specified
        filtered_ts = ts
        if focus is not None and mode is not None:
            filtered_ts = apply_focus_filter(ts, focus, mode)
            logger.info(f"Applied {mode} filter on node {focus}: {filtered_ts.num_nodes} nodes, {filtered_ts.num_edges} edges")
        
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
        logger.error(f"Error generating Pretty ARG data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate Pretty ARG data: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)