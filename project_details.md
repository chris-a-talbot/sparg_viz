# SPARG Visualization Project - Complete Setup Reference

## Project Overview
**Project Name:** SPARG Visualization (sparg_viz)  
**Architecture:** Full-stack web application with React TypeScript frontend and FastAPI Python backend  
**Containerization:** Docker Compose for development environment  
**Primary Purpose:** Design a visualization framework for ancestral recombination graphs (ARGs) built off the tskit tree sequence framework

## Project Goal
Design a visualization framework for ancestral recombination graphs built off of the tskit tree sequence framework with multiple visualization modes:

1. **2D Visualization (No temporal/spatial data):** Force simulations for both x and y axes
2. **2D Visualization (Temporal only):** Force simulation for x-axis, constrained y-axis representing time
3. **3D Visualization (Temporal + Spatial):** Constrained x,y coordinates with time on z-axis
4. **3D Visualization (Temporal + Sample Spatial):** Spatial information only on samples, inferred using fastGAIA, with constrained x,y coordinates and time on z-axis

## Application Architecture
- **Distribution:** Initially standalone, locally hosted product; may transition to public hosting via Railway and AWS
- **Backend:** Python with scientific computing stack
- **Frontend:** Vite + React + TypeScript
- **Containerization:** Docker with Docker Compose
- **Future Scaling:** Designed for potential public hosting with efficient computational resources and SQL storage

## Input Requirements

### Supported File Formats
- **Input Files:** tsinfer/tskit/tszip/tsdate .trees or .tsz files
- **Automatic Detection:** Automatically detects tree sequence formatting
  - Without temporal nor spatial information
  - With temporal but without spatial information  
  - With both temporal and spatial information
- **SLiM Compatibility:** Spatial information formatted according to SLiM v5 standards

### Data Processing Capabilities
- **tsdate Integration:** Easy addition of temporal data to tree sequences without it
- **fastGAIA Integration:** Easy addition of basic spatial data (requires temporal data)
- **GAIA Integration:** Detailed spatial data addition with size restrictions (requires temporal data)
- **Simulation:** msprime/pyslim integration for generating simulated tree sequences

## Application Features

### Home Screen Functionality
- **Drag-and-Drop Upload:** Tree sequence processing with options:
  - "Visualize"
  - "Infer Times" 
  - "Infer Locations (fast)"
  - "Infer Locations (slow)"
- **Simulation Interface:** Sliders/input boxes for msprime/pyslim simulation parameters
  - With/without temporal recording
  - With/without spatial recording
- **Download Capability:** Download current tree sequence version as .tsz file at any point

### 2D Visualization Features
- **Force Simulation:** Similar to tskit_arg_visualizer for node placement
- **Interactive Nodes:** Click-and-drag rearrangement
- **Node Selection:** 
  - First click: highlights ancestry
  - Second click: highlights descendants
- **Export Options:** Download tree sequence and/or plot

### 3D Visualization Features
- **3D Node Placement:** Known x, y, z coordinates
- **Navigation:** Pan, zoom, and drag for 3D exploration
- **Genome Slider:** Rescalable, highlights nodes/edges in selected genomic window
- **Temporal Slider:** Rescalable, highlights nodes/edges in selected temporal window
  - Can reduce to single time slice
- **Node Selection:** Same ancestry/descendant highlighting as 2D
- **Export Options:** Download tree sequence and/or plot

## Future Development Ideas
- **Ancestry Coefficients:** Mechanism to discretize samples for calculations
- **Map Integration:** Polygon features with discrete locations vs continuous
- **Node Clustering:** System for handling dense node areas
- **Statistics Display:** Metadata and statistics window
- **Migration Analysis:** GAIA-style migration direction calculations through time

## Technical Constraints & Considerations
- **World Map Integration:** Support for 3D globe and polygon display
- **Scalability:** Handle ARGs up to millions of nodes
- **Size Constraints:** Inherent limitations due to ARG complexity
- **Public Hosting Requirements:** 
  - Highly efficient computational resources
  - Strong SQL storage with rapid data cleanup
  - Automatic removal of unneeded data

## Complete Technology Stack

### Containerization & Deployment
- **Docker:** Containerization
- **Docker Compose:** Multi-container orchestration
- **GitHub Actions:** CI/CD pipeline
- **Railway:** Hosting and storage (future)

### Backend Technologies
- **Python:** Core backend language
- **FastAPI:** API framework connecting frontend/backend
- **Uvicorn:** ASGI server
- **Scientific Libraries:**
  - tskit: Tree sequence toolkit
  - tszip: Tree sequence compression
  - tsdate: Temporal inference
  - fastGAIA: Fast spatial inference
  - GAIA: Detailed spatial inference (via rpy2)
  - msprime: Coalescent simulation
  - pyslim: SLiM integration
  - rpy2: R integration for GAIA

### Data Management
- **PostgreSQL:** Primary database
- **Redis:** In-memory data storage and caching
- **Apache Arrow:** In-memory columnar data storage
- **Celery:** Task queue for background processing

### Frontend Technologies
- **Vite:** Build tool and development server
- **React:** UI framework
- **TypeScript:** Type-safe JavaScript
- **Zustand:** State management
- **ShadCN UI:** Component library and styling system
- **Tailwind CSS:** Utility-first CSS framework
- **Lucide React:** Icon library

### Visualization Technologies
- **D3.js:** 2D data visualization and force simulations
- **deck.gl:** Complex 2D and 3D visualization capabilities
- **Three.js Integration:** Via React Three Fiber (implied for 3D)