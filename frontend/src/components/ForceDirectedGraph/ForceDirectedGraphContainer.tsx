import { useEffect, useState, forwardRef, ForwardedRef, useCallback, useMemo } from 'react';
import { ForceDirectedGraph } from './ForceDirectedGraph';
import { GraphData, GraphNode, GraphEdge } from './ForceDirectedGraph.types';
import { RangeSlider } from '../ui/range-slider';

// Define view modes for the graph
type ViewMode = 'full' | 'subgraph' | 'ancestors';

interface ForceDirectedGraphContainerProps {
    filename: string;
    max_samples?: number;
}

// Helper function to get all descendants of a node
const getDescendants = (node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): Set<number> => {
    const descendants = new Set<number>();
    const visited = new Set<number>();
    const queue = [node.id]; // Work with IDs instead of node objects
    
    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        
        // Find all edges where current node is the source (parent)
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
    const queue = [node.id]; // Work with IDs instead of node objects
    
    while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        
        // Find all edges where current node is the target (child)
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

export const ForceDirectedGraphContainer = forwardRef<SVGSVGElement, ForceDirectedGraphContainerProps>(({ 
    filename,
    max_samples = 25
}, ref: ForwardedRef<SVGSVGElement>) => {
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

    // Debounce genomic range changes to prevent excessive API calls
    useEffect(() => {
        if (isGenomicFilterActive) {
            setIsUpdatingGenomicRange(true);
        }
        
        const timer = setTimeout(() => {
            setDebouncedGenomicRange(genomicRange);
            setIsUpdatingGenomicRange(false);
        }, 500); // Increased from 300ms to 500ms for better performance

        return () => clearTimeout(timer);
    }, [genomicRange, isGenomicFilterActive]);

    // Initial data loading (without genomic filtering)
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                console.log('Fetching initial graph data for file:', filename, 'with max_samples:', max_samples);
                
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
                console.log('Received initial graph data:', graphData);
                
                // Initialize genomic range settings
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
                console.error('Error fetching initial graph data:', e);
                setError(e instanceof Error ? e.message : 'An error occurred while fetching graph data');
                setData(null);
            } finally {
                setLoading(false);
            }
        };

        // Reset initialization state when filename or max_samples change
        setIsInitialized(false);
        setIsGenomicFilterActive(false); // Also reset filter state
        fetchInitialData();
    }, [filename, max_samples]);

    // Data loading with genomic filtering
    useEffect(() => {
        // Skip if not initialized or if this is the initial load
        if (!isInitialized) {
            return;
        }

        // Check if genomic range covers the full sequence
        const isFullSequence = debouncedGenomicRange[0] === 0 && debouncedGenomicRange[1] === sequenceLength;
        
        // If genomic filter is inactive, or if it covers the full sequence, 
        // and we already have data, don't make unnecessary API calls
        if ((!isGenomicFilterActive || isFullSequence) && data) {
            console.log('Skipping API call - using existing data (full sequence or filter disabled)');
            return;
        }

        const fetchData = async () => {
            try {
                setLoading(true);
                
                let url = `http://localhost:8000/graph-data/${filename}?max_samples=${max_samples}`;
                
                if (isGenomicFilterActive) {
                    console.log('Fetching filtered graph data for genomic range:', debouncedGenomicRange);
                    url += `&genomic_start=${debouncedGenomicRange[0]}&genomic_end=${debouncedGenomicRange[1]}`;
                } else {
                    console.log('Fetching unfiltered graph data');
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
                console.log('Received graph data:', graphData);
                
                setData(graphData);
                setError(null);
            } catch (e) {
                console.error('Error fetching graph data:', e);
                setError(e instanceof Error ? e.message : 'An error occurred while fetching graph data');
                setData(null);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [filename, max_samples, debouncedGenomicRange, isGenomicFilterActive, isInitialized, sequenceLength]);

    // Filter data based on current view mode
    const getFilteredData = (): GraphData | null => {
        if (!data || !selectedNode) return data;

        switch (viewMode) {
            case 'subgraph': {
                const descendants = getDescendants(selectedNode, data.nodes, data.edges);
                descendants.add(selectedNode.id);
                
                const filteredNodes = data.nodes.filter(node => descendants.has(node.id));
                const filteredEdges = data.edges.filter(edge => {
                    const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
                    const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
                    return descendants.has(sourceId) && descendants.has(targetId);
                });

                return {
                    ...data,
                    nodes: filteredNodes,
                    edges: filteredEdges,
                    metadata: {
                        ...data.metadata,
                        is_subset: true
                    }
                };
            }
            case 'ancestors': {
                const ancestors = getAncestors(selectedNode, data.nodes, data.edges);
                ancestors.add(selectedNode.id);
                
                const filteredNodes = data.nodes.filter(node => ancestors.has(node.id));
                const filteredEdges = data.edges.filter(edge => {
                    const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
                    const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
                    return ancestors.has(sourceId) && ancestors.has(targetId);
                });

                return {
                    ...data,
                    nodes: filteredNodes,
                    edges: filteredEdges,
                    metadata: {
                        ...data.metadata,
                        is_subset: true
                    }
                };
            }
            default:
                return data;
        }
    };

    // Handle left click - show subgraph
    const handleNodeClick = (node: GraphNode) => {
        if (viewMode === 'full') {
            setSelectedNode(node);
            setViewMode('subgraph');
        } else if (selectedNode?.id === node.id) {
            // Same node clicked again - return to full view
            setViewMode('full');
            setSelectedNode(null);
        } else {
            // Different node clicked - show its subgraph
            setSelectedNode(node);
            setViewMode('subgraph');
        }
    };

    // Handle right click - show ancestors
    const handleNodeRightClick = (node: GraphNode) => {
        setSelectedNode(node);
        setViewMode('ancestors');
    };

    const handleEdgeClick = (edge: GraphEdge) => {
        console.log('Edge clicked:', edge);
        // Add your edge click handling logic here
    };

    const handleReturnToFull = () => {
        setViewMode('full');
        setSelectedNode(null);
    };

    // Genomic range control handlers
    const handleGenomicRangeChange = useCallback((newRange: [number, number]) => {
        // Only update if the range actually changed to avoid unnecessary rerenders
        if (newRange[0] !== genomicRange[0] || newRange[1] !== genomicRange[1]) {
            setGenomicRange(newRange);
        }
    }, [genomicRange]);

    const handleToggleGenomicFilter = useCallback(() => {
        const newFilterState = !isGenomicFilterActive;
        setIsGenomicFilterActive(newFilterState);
        
        if (newFilterState) {
            // Activating filter - ensure range is set to full sequence initially
            setGenomicRange([0, sequenceLength]);
            setDebouncedGenomicRange([0, sequenceLength]);
        } else {
            // Deactivating filter - reload initial data without filtering
            // The data will be reloaded by the initial data useEffect due to state change
        }
    }, [isGenomicFilterActive, sequenceLength]);

    const formatGenomicPosition = useCallback((value: number) => {
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(1)}M`;
        } else if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}K`;
        }
        return value.toString();
    }, []);

    const getViewTitle = (): string => {
        let title = '';
        switch (viewMode) {
            case 'subgraph':
                title = `SubARG at Root ${selectedNode?.id}`;
                break;
            case 'ancestors':
                title = `Parent ARG of Node ${selectedNode?.id}`;
                break;
            default:
                title = 'Full ARG';
        }
        
        if (isGenomicFilterActive && data?.metadata.genomic_start !== undefined && data?.metadata.genomic_end !== undefined) {
            title += ` (${formatGenomicPosition(data.metadata.genomic_start)} - ${formatGenomicPosition(data.metadata.genomic_end)})`;
        }
        
        return title;
    };

    if (loading) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-sp-very-dark-blue">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sp-pale-green"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-sp-very-dark-blue text-red-400">
                Error: {error}
            </div>
        );
    }

    return (
        <div className="w-full h-full min-h-screen flex flex-col bg-sp-very-dark-blue">
            {/* Compact top bar with title, legend, and controls */}
            <div className="flex-shrink-0 bg-sp-dark-blue border-b border-sp-very-dark-blue px-4 py-2">
                <div className="flex items-center justify-between">
                    {/* Left: Title and return button */}
                    <div className="flex items-center gap-4">
                        <h2 className="text-lg font-semibold text-sp-white">{getViewTitle()}</h2>
                        {viewMode !== 'full' && (
                            <button
                                onClick={handleReturnToFull}
                                className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-3 py-1 rounded text-sm transition-colors"
                            >
                                Return to Full ARG
                            </button>
                        )}
                    </div>
                    
                    {/* Right: Compact legend and instructions */}
                    <div className="flex items-center gap-6">
                        {/* Legend */}
                        <div className="flex items-center gap-4 text-xs text-sp-white">
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-sp-pale-green border border-sp-very-dark-blue" style={{borderWidth: '0.5px'}}></div>
                                <span>Sample</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{backgroundColor: '#60A0B7'}}></div>
                                <span>Internal</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{backgroundColor: '#50A0AF'}}></div>
                                <span>Combined</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full border-2 border-sp-white" style={{backgroundColor: '#60A0B7'}}></div>
                                <span>Root</span>
                            </div>
                        </div>
                        
                        {/* Instructions */}
                        <div className="text-xs text-sp-white border-l border-sp-very-dark-blue pl-4">
                            Left click: Subgraph • Right click: Ancestors
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Genomic Range Controls */}
            {sequenceLength > 0 && (
                <div className="flex-shrink-0 bg-sp-very-dark-blue border-b border-sp-dark-blue px-4 py-3">
                    <div className="flex items-center gap-4">
                        {/* Toggle genomic filtering */}
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-sm text-sp-white cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isGenomicFilterActive}
                                    onChange={handleToggleGenomicFilter}
                                    className="w-4 h-4 text-sp-pale-green bg-sp-dark-blue border-sp-very-dark-blue rounded focus:ring-sp-pale-green focus:ring-2"
                                />
                                Filter by Genomic Range
                            </label>
                        </div>
                        
                        {/* Genomic range slider */}
                        {isGenomicFilterActive && (
                            <div className="flex-1 max-w-md">
                                <RangeSlider
                                    min={0}
                                    max={sequenceLength}
                                    step={Math.max(1, Math.floor(sequenceLength / 1000))}
                                    value={genomicRange}
                                    onChange={handleGenomicRangeChange}
                                    formatValue={formatGenomicPosition}
                                    className="w-full"
                                />
                            </div>
                        )}
                        
                        {/* Current range display */}
                        {isGenomicFilterActive && (
                            <div className="text-sm text-sp-white flex items-center gap-2">
                                <span>
                                    Range: {formatGenomicPosition(genomicRange[1] - genomicRange[0])} bp
                                    ({((genomicRange[1] - genomicRange[0]) / sequenceLength * 100).toFixed(1)}% of sequence)
                                    {data?.metadata.num_local_trees !== undefined && (
                                        <> • {data.metadata.num_local_trees} local trees</>
                                    )}
                                </span>
                                {isUpdatingGenomicRange && (
                                    <div className="animate-spin rounded-full h-3 w-3 border border-sp-pale-green border-t-transparent"></div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Graph area - takes remaining space */}
            <div className="flex-1 relative min-h-[800px]">
                <ForceDirectedGraph 
                    ref={ref}
                    data={getFilteredData()}
                    onNodeClick={handleNodeClick}
                    onNodeRightClick={handleNodeRightClick}
                    onEdgeClick={handleEdgeClick}
                    focalNode={selectedNode}
                />
            </div>
        </div>
    );
}); 