import { useEffect, useState, forwardRef, ForwardedRef, useCallback, useMemo } from 'react';
import { DeckGLArgVisualization } from './DeckGLArgVisualization';
import type { GraphData, GraphNode, GraphEdge } from './DeckGLArgVisualization.types';
import { RangeSlider } from '../ui/range-slider';

// Define view modes for the graph
type ViewMode = 'full' | 'subgraph' | 'ancestors';

interface DeckGLArgVisualizationContainerProps {
    filename: string;
    max_samples?: number;
}

// Helper function to get all descendants of a node
const getDescendants = (node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): Set<number> => {
    const descendants = new Set<number>();
    const visited = new Set<number>();
    const queue = [node.id];
    
    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        
        edges.forEach(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            
            if (sourceId === currentId && !visited.has(targetId)) {
                descendants.add(targetId);
                queue.push(targetId);
            }
        });
    }
    
    return descendants;
};

// Helper function to get all ancestors of a node
const getAncestors = (node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): Set<number> => {
    const ancestors = new Set<number>();
    const visited = new Set<number>();
    const queue = [node.id];
    
    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        
        edges.forEach(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            
            if (targetId === currentId && !visited.has(sourceId)) {
                ancestors.add(sourceId);
                queue.push(sourceId);
            }
        });
    }
    
    return ancestors;
};

export const DeckGLArgVisualizationContainer = forwardRef<HTMLCanvasElement, DeckGLArgVisualizationContainerProps>(({ 
    filename,
    max_samples = 25
}, ref: ForwardedRef<HTMLCanvasElement>) => {
    const [data, setData] = useState<GraphData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('full');
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [genomicRange, setGenomicRange] = useState<[number, number]>([0, 0]);
    const [sequenceLength, setSequenceLength] = useState<number>(0);
    const [isGenomicFilterActive, setIsGenomicFilterActive] = useState(false);
    const [debouncedGenomicRange, setDebouncedGenomicRange] = useState<[number, number]>([0, 0]);
    const [isUpdatingGenomicRange, setIsUpdatingGenomicRange] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });

    // Update dimensions based on container size
    useEffect(() => {
        const updateDimensions = () => {
            const container = document.querySelector('.max-w-7xl');
            if (container) {
                const rect = container.getBoundingClientRect();
                setDimensions({
                    width: Math.max(800, rect.width - 32), // Account for padding
                    height: Math.max(600, rect.height - 100) // Account for controls
                });
            }
        };

        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // Debounce genomic range changes
    useEffect(() => {
        if (isGenomicFilterActive) {
            setIsUpdatingGenomicRange(true);
        }
        
        const timer = setTimeout(() => {
            setDebouncedGenomicRange(genomicRange);
            setIsUpdatingGenomicRange(false);
        }, 500);

        return () => clearTimeout(timer);
    }, [genomicRange, isGenomicFilterActive]);

    // Initial data loading
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                console.log('Fetching initial graph data for deck.gl visualization:', filename, 'with max_samples:', max_samples);
                
                const url = `http://localhost:8000/graph-data/${filename}?max_samples=${max_samples}`;
                const response = await fetch(url);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => null);
                    throw new Error(
                        `HTTP error! status: ${response.status}\n` +
                        `Details: ${errorData?.detail || 'No details available'}`
                    );
                }
                
                const graphData = await response.json();
                console.log('Received initial graph data for deck.gl:', graphData);
                
                if (graphData.metadata.sequence_length) {
                    setSequenceLength(graphData.metadata.sequence_length);
                    const fullRange: [number, number] = [0, graphData.metadata.sequence_length];
                    setGenomicRange(fullRange);
                    setDebouncedGenomicRange(fullRange);
                    setIsInitialized(true);
                }
                
                setData(graphData);
                setError(null);
            } catch (e) {
                console.error('Error fetching initial graph data for deck.gl:', e);
                setError(e instanceof Error ? e.message : 'An error occurred while fetching graph data');
                setData(null);
            } finally {
                setLoading(false);
            }
        };

        setIsInitialized(false);
        setIsGenomicFilterActive(false);
        fetchInitialData();
    }, [filename, max_samples]);

    // Data loading with genomic filtering
    useEffect(() => {
        if (!isInitialized) {
            return;
        }

        const isFullSequence = debouncedGenomicRange[0] === 0 && debouncedGenomicRange[1] === sequenceLength;
        
        if ((!isGenomicFilterActive || isFullSequence) && data) {
            console.log('Skipping API call - using existing data for deck.gl');
            return;
        }

        const fetchData = async () => {
            try {
                setLoading(true);
                
                let url = `http://localhost:8000/graph-data/${filename}?max_samples=${max_samples}`;
                
                if (isGenomicFilterActive) {
                    console.log('Fetching filtered graph data for deck.gl, genomic range:', debouncedGenomicRange);
                    url += `&genomic_start=${debouncedGenomicRange[0]}&genomic_end=${debouncedGenomicRange[1]}`;
                } else {
                    console.log('Fetching unfiltered graph data for deck.gl');
                }
                
                const response = await fetch(url);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => null);
                    throw new Error(
                        `HTTP error! status: ${response.status}\n` +
                        `Details: ${errorData?.detail || 'No details available'}`
                    );
                }
                
                const graphData = await response.json();
                console.log('Received graph data for deck.gl:', graphData);
                
                setData(graphData);
                setError(null);
            } catch (e) {
                console.error('Error fetching graph data for deck.gl:', e);
                setError(e instanceof Error ? e.message : 'An error occurred while fetching graph data');
                setData(null);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [filename, max_samples, debouncedGenomicRange, isGenomicFilterActive, isInitialized, sequenceLength]);

    // Filter data based on current view mode
    const filteredData = useMemo(() => {
        if (!data || viewMode === 'full') return data;

        if (!selectedNode) return data;

        let nodesToShow: Set<number>;
        
        if (viewMode === 'subgraph') {
            const descendants = getDescendants(selectedNode, data.nodes, data.edges);
            nodesToShow = new Set([selectedNode.id, ...descendants]);
        } else if (viewMode === 'ancestors') {
            const ancestors = getAncestors(selectedNode, data.nodes, data.edges);
            nodesToShow = new Set([selectedNode.id, ...ancestors]);
        } else {
            return data;
        }

        const filteredNodes = data.nodes.filter(node => nodesToShow.has(node.id));
        const filteredEdges = data.edges.filter(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            return nodesToShow.has(sourceId) && nodesToShow.has(targetId);
        });

        return {
            ...data,
            nodes: filteredNodes,
            edges: filteredEdges
        };
    }, [data, viewMode, selectedNode]);

    const handleNodeClick = useCallback((node: GraphNode) => {
        console.log('Node clicked in deck.gl:', node);
        setSelectedNode(node);
        
        if (viewMode === 'full') {
            setViewMode('subgraph');
        }
    }, [viewMode]);

    const handleNodeHover = useCallback((node: GraphNode | null) => {
        // Could add hover effects here if needed
    }, []);

    const handleReturnToFull = () => {
        setViewMode('full');
        setSelectedNode(null);
    };

    const getViewTitle = (): string => {
        if (viewMode === 'full') return 'Full ARG';
        if (viewMode === 'subgraph') return `Subgraph from Node ${selectedNode?.id}`;
        if (viewMode === 'ancestors') return `Ancestors of Node ${selectedNode?.id}`;
        return 'ARG View';
    };

    if (loading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-sp-very-dark-blue text-sp-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sp-pale-green"></div>
                    <div>Loading high-performance visualization...</div>
                    {isUpdatingGenomicRange && (
                        <div className="text-sm text-sp-pale-green">Updating genomic range...</div>
                    )}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-sp-very-dark-blue text-sp-white">
                <div className="text-center max-w-lg">
                    <h3 className="text-xl font-bold mb-4 text-red-400">Error Loading Graph</h3>
                    <p className="text-sm mb-4 whitespace-pre-wrap">{error}</p>
                    <button 
                        className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 px-4 rounded-lg"
                        onClick={() => window.location.reload()}
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-sp-very-dark-blue">
            {/* Controls Panel */}
            <div className="bg-sp-dark-blue p-4 border-b border-sp-pale-green">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-semibold text-sp-white">{getViewTitle()}</h3>
                        
                        {data && (
                            <div className="text-sm text-sp-pale-green">
                                {filteredData?.nodes.length || 0} nodes, {filteredData?.edges.length || 0} edges
                                {data.metadata.is_subset && (
                                    <span className="ml-2 text-xs bg-sp-very-dark-blue px-2 py-1 rounded">
                                        Subset of {data.metadata.original_num_nodes} nodes
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {viewMode !== 'full' && (
                            <>
                                <button
                                    className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-3 py-1 rounded text-sm transition-colors"
                                    onClick={() => setViewMode(viewMode === 'subgraph' ? 'ancestors' : 'subgraph')}
                                >
                                    {viewMode === 'subgraph' ? 'Show Ancestors' : 'Show Descendants'}
                                </button>
                                <button
                                    className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-3 py-1 rounded text-sm transition-colors"
                                    onClick={handleReturnToFull}
                                >
                                    Return to Full ARG
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Genomic Range Slider */}
                {sequenceLength > 0 && (
                    <div className="mt-4 pt-4 border-t border-sp-very-dark-blue">
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-sp-white">
                                <input
                                    type="checkbox"
                                    checked={isGenomicFilterActive}
                                    onChange={(e) => setIsGenomicFilterActive(e.target.checked)}
                                    className="accent-sp-pale-green"
                                />
                                Filter by genomic range
                            </label>
                            
                            {isGenomicFilterActive && (
                                <div className="flex-1 max-w-md">
                                    <RangeSlider
                                        min={0}
                                        max={sequenceLength}
                                        step={Math.max(1, Math.floor(sequenceLength / 1000))}
                                        value={genomicRange}
                                        onChange={setGenomicRange}
                                        formatValue={(value) => `${value.toLocaleString()}`}
                                        className="w-full"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Visualization */}
            <div className="flex-1 relative">
                <DeckGLArgVisualization
                    data={filteredData}
                    width={dimensions.width}
                    height={dimensions.height}
                    onNodeClick={handleNodeClick}
                    onNodeHover={handleNodeHover}
                    focalNode={selectedNode}
                />
            </div>

            {/* Instructions */}
            <div className="bg-sp-dark-blue p-2 border-t border-sp-pale-green">
                <div className="text-xs text-sp-white text-center">
                    <span className="font-medium">Instructions:</span> Click on a node to focus and explore its subgraph • 
                    Pan with mouse drag • Zoom with mouse wheel • 
                    Hover over nodes for details
                </div>
            </div>
        </div>
    );
}); 