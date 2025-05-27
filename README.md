# SPARG Visualization

A comprehensive web-based framework for visualizing and analyzing Ancestral Recombination Graphs (ARGs) built on the tskit tree sequence ecosystem.

## Overview

SPARG Visualization provides an interactive platform for exploring complex genomic data structures through multiple visualization paradigms. The application supports both 2D force-directed layouts and 3D spatiotemporal representations, enabling researchers to gain insights into population genetics, evolutionary history, and spatial patterns of genetic variation.

### Key Features

- **Multi-modal Visualization**: 2D force simulations and 3D spatiotemporal representations
- **File Format Support**: Native support for tskit (.trees) and tszip (.tsz) formats
- **Simulation Capabilities**: Built-in ARG generation using msprime and custom spARGviz simulators
- **Spatial Inference**: Integration with fastGAIA for rapid spatial location inference
- **Interactive Analysis**: Node selection, ancestry tracing, and genomic/temporal filtering
- **Export Functionality**: Download processed tree sequences and visualizations

## Scientific Background

Ancestral Recombination Graphs represent the complete genealogical history of a set of DNA sequences, capturing both coalescent and recombination events. Unlike simple phylogenetic trees, ARGs can model:

- **Recombination Events**: Historical genetic exchange between lineages
- **Population Structure**: Spatial and temporal organization of genetic variation
- **Migration Patterns**: Gene flow between populations through time
- **Selective Pressures**: Signatures of natural selection in genomic regions

This visualization framework enables researchers to explore these complex evolutionary processes through intuitive visual interfaces.

## Architecture

### System Design

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   React + TS    │◄──►│   FastAPI        │◄──►│   tskit         │
│   Frontend      │    │   Backend        │    │   Ecosystem     │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│                 │    │                  │    │                 │
│   D3.js         │    │   Scientific     │    │   msprime       │
│   Visualizations│    │   Computing      │    │   Simulations   │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Technology Stack

**Frontend**
- React 18 with TypeScript for type-safe UI development
- Vite for fast development and optimized builds
- D3.js for interactive 2D visualizations
- ShadCN UI components with Tailwind CSS styling
- Zustand for lightweight state management

**Backend**
- FastAPI for high-performance API endpoints
- Uvicorn ASGI server for concurrent request handling
- Scientific Python ecosystem (NumPy, SciPy)
- tskit integration for tree sequence manipulation

**Scientific Computing**
- tskit: Core tree sequence operations
- msprime: Coalescent simulation with recombination
- fastGAIA: Rapid spatial location inference
- tszip: Efficient tree sequence compression

## Installation & Setup

### Prerequisites

- Docker and Docker Compose
- Git
- 8GB+ RAM (recommended for large ARGs)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/sparg_viz.git
   cd sparg_viz
   ```

2. **Launch with Docker Compose**
   ```bash
   docker compose up --build
   ```

3. **Access the application**
   - Frontend: http://localhost:5173
   - API Documentation: http://localhost:8000/docs

### Development Setup

**Backend Development**
```bash
cd backend
conda env create -f environment.yml
conda activate sparg_viz
uvicorn main:app --reload --port 8000
```

**Frontend Development**
```bash
cd frontend
npm install
npm run dev
```

## Usage Guide

### Data Input

The application accepts multiple input formats:

1. **Tree Sequence Files**: Upload .trees or .tsz files via drag-and-drop
2. **Simulation Parameters**: Generate ARGs using built-in simulators
3. **External APIs**: Load data from compatible genomic databases (future)

### Visualization Modes

#### 2D Force-Directed Layout
- **No Temporal Data**: Pure force simulation for node positioning
- **With Temporal Data**: Time-constrained y-axis, force simulation for x-axis
- **Interactive Features**: Click-drag nodes, ancestry highlighting, genomic filtering

#### 3D Spatiotemporal View
- **Spatial Coordinates**: Geographic or abstract 2D positioning
- **Temporal Axis**: Time progression along z-axis
- **Navigation**: Full 3D pan, zoom, and rotation
- **Filtering**: Genomic and temporal sliders for data exploration

### Simulation Parameters

The spARGviz simulator supports fine-grained control over ARG structure:

- **Population Parameters**
  - `num_samples`: Number of sampled individuals (2-25)
  - `num_trees`: Target number of local trees (1-25)
  - `num_generations`: Coalescent depth (1-50)

- **Recombination Control**
  - `recombination_probability`: Rate of recombination vs coalescence (0.0-1.0)
  - `coalescence_rate`: Timing control for coalescent events (>0.0)
  - `edge_density`: Multiplier for recombination frequency (>0.0)

- **Spatial Structure**
  - `spatial_dims`: Dimensionality (0, 1, or 2)
  - `x_range`, `y_range`: Geographic bounds for spatial placement

### Spatial Inference

For ARGs with temporal but no spatial data, the fastGAIA integration provides:

- **Rapid Inference**: Computational complexity O(n²) for n nodes
- **Brownian Motion Models**: Spatially coherent location estimation
- **Flexible Weighting**: Branch length and genomic span considerations

## API Reference

### Core Endpoints

```http
POST /simulate-spargviz
Content-Type: application/json

{
  "num_samples": 10,
  "num_trees": 5,
  "spatial_dims": 2,
  "num_generations": 8,
  "x_range": 10.0,
  "y_range": 8.0,
  "recombination_probability": 0.3,
  "coalescence_rate": 1.0,
  "edge_density": 1.0
}
```

```http
POST /upload-tree-sequence
Content-Type: multipart/form-data

file: <tree-sequence-file>
```

```http
GET /graph-data/{filename}?max_samples=25&genomic_start=0&genomic_end=1000
```

```http
POST /infer-locations-fast
Content-Type: application/json

{
  "filename": "example.trees",
  "weight_span": true,
  "weight_branch_length": true
}
```

## Performance Considerations

### Scalability
- **Node Limits**: Efficiently handles ARGs up to ~10,000 nodes in browser
- **Memory Usage**: Optimized data structures for large tree sequences
- **Rendering**: Level-of-detail algorithms for complex visualizations

### Optimization Strategies
- **Data Simplification**: Sample-based reduction for large datasets
- **Lazy Loading**: On-demand data fetching for genomic regions
- **WebGL Acceleration**: GPU-accelerated rendering for 3D visualizations

## Citation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: Comprehensive guides at [project-docs-url]
- **Issues**: Bug reports and feature requests via GitHub Issues
- **Discussions**: Community support through GitHub Discussions
- **Contact**: [maintainer-email] for technical inquiries

---

**Version**: 1.0.0  
**Last Updated**: 5/24/2025  
**Maintained by**: Chris Talbot