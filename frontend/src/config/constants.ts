/**
 * Frontend application constants
 * Centralizes magic numbers and configuration values for better maintainability
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  ENDPOINTS: {
    UPLOAD: '/upload-tree-sequence',
    UPLOADED_FILES: '/uploaded-files',
    TREE_SEQUENCE_METADATA: '/tree-sequence-metadata',
    DELETE_TREE_SEQUENCE: '/tree-sequence',
    DOWNLOAD_TREE_SEQUENCE: '/download-tree-sequence',
    GRAPH_DATA: '/graph-data',
    PRETTY_ARG_DATA: '/pretty-arg-data',
    SIMULATE_SPARGVIZ: '/simulate-spargviz',
    SIMULATE_MSPRIME: '/simulate-msprime',
    INFER_LOCATIONS_FAST: '/infer-locations-fast',
  }
} as const;

// Visualization Defaults
export const VISUALIZATION_DEFAULTS = {
  // Graph dimensions
  DEFAULT_GRAPH_WIDTH: 800,
  DEFAULT_GRAPH_HEIGHT: 600,
  MIN_GRAPH_WIDTH: 800,
  MIN_GRAPH_HEIGHT: 600,
  DECK_GL_WIDTH: 1200,
  DECK_GL_HEIGHT: 800,
  DECK_GL_MIN_WIDTH: 800,
  DECK_GL_MIN_HEIGHT: 600,
  
  // Node styling
  SAMPLE_NODE_SIZE: 200,
  INTERNAL_NODE_SIZE: 150,
  COMBINED_NODE_SIZE: 100,
  
  // Colors (RGBA)
  SAMPLE_NODE_COLOR: [52, 235, 177, 255] as [number, number, number, number], // sp-pale-green
  COMBINED_NODE_COLOR: [80, 160, 175, 255] as [number, number, number, number], // Light blue-green
  INTERNAL_NODE_COLOR: [96, 160, 183, 255] as [number, number, number, number], // Light blue
  SELECTED_NODE_COLOR: [255, 255, 255, 255] as [number, number, number, number], // White
  EDGE_COLOR: [255, 255, 255, 100] as [number, number, number, number], // Semi-transparent white
  OUTLINE_COLOR: [3, 48, 62, 255] as [number, number, number, number], // Very dark blue
  
  // Margins and spacing
  PRETTY_ARG_MARGIN: { top: 60, right: 200, bottom: 80, left: 80 },
  
  // Animation timing
  LOADING_DOTS_INTERVAL: 420,
} as const;

// Sample Management
export const SAMPLE_LIMITS = {
  DEFAULT_MAX_SAMPLES: 25,
  MIN_SAMPLES: 2,
  WARNING_THRESHOLD: 25,
} as const;

// Simulation Defaults
export const SIMULATION_DEFAULTS = {
  // spARGviz defaults
  SPARGVIZ: {
    SAMPLE_NUMBER: 6,
    LOCAL_TREES: 15,
    SPATIAL_DIMENSIONS: '0',
    SPATIAL_BOUNDARY_SIZE: [25.0, 25.0],
    DISPERSAL_RANGE: 5.0,
    NUM_GENERATIONS: 2,
    RECOMBINATION_PROBABILITY: 0.15,
    COALESCENCE_RATE: 1.0,
    EDGE_DENSITY: 0.8,
  },
  
  // msprime defaults
  MSPRIME: {
    POPULATION_SIZE: 6,
    LOCAL_TREES: 15,
    GENERATIONS: 2,
    SPATIAL_DIMENSIONS: '0',
    SPATIAL_BOUNDARY_SIZE: [25.0, 25.0],
    DISPERSAL_RANGE: 5.0,
  },
  
  // Validation limits
  LIMITS: {
    MIN_SAMPLES: 2,
    MAX_SAMPLES: 25,
    MIN_BOUNDARY_SIZE: 1,
    MAX_BOUNDARY_SIZE: 50,
    MIN_DISPERSAL_RANGE: 0.1,
    MAX_DISPERSAL_RANGE: 20,
    DISPERSAL_STEP: 0.1,
  }
} as const;

// UI Constants
export const UI_CONSTANTS = {
  // Container classes
  MAIN_CONTAINER_CLASS: "max-w-7xl mx-auto h-[calc(100vh-3rem)]",
  GRAPH_CONTAINER_CLASS: "flex-1 relative min-h-[800px]",
  
  // Responsive breakpoints (matching Tailwind)
  BREAKPOINTS: {
    SM: 640,
    MD: 768,
    LG: 1024,
    XL: 1280,
    '2XL': 1536,
  },
  
  // Z-index layers
  Z_INDEX: {
    CONTROLS: 20,
    TOOLTIP: 30,
    MODAL: 40,
  }
} as const;

// Data Formatting
export const DATA_FORMAT = {
  // Number formatting thresholds
  MILLION_THRESHOLD: 1_000_000,
  THOUSAND_THRESHOLD: 1_000,
  SEQUENCE_STEP_DIVISOR: 1_000,
  
  // Precision
  DECIMAL_PLACES: 1,
  PERCENTAGE_PRECISION: 1,
} as const;

// File Types
export const FILE_TYPES = {
  ACCEPTED_FORMATS: {
    'application/octet-stream': ['.trees', '.tsz'],
    'application/x-trees': ['.trees'],
    'application/x-tsz': ['.tsz'],
  },
  EXTENSIONS: {
    TREES: '.trees',
    TSZ: '.tsz',
  }
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  UPLOAD_FAILED: 'Upload failed',
  SIMULATION_FAILED: 'Simulation failed',
  DOWNLOAD_FAILED: 'Download failed',
  FETCH_FAILED: 'Failed to fetch data',
  NO_SPATIAL_DATA: 'No spatial data found in this ARG. This visualization requires nodes with 2D spatial coordinates.',
  NO_SPATIAL_RANGE: 'No spatial data found in this genomic range.',
  UNKNOWN_ERROR: 'Unknown error occurred',
} as const; 