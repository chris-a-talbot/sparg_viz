import React, { useState, useEffect, forwardRef } from 'react';
import { PrettyArgVisualization } from './PrettyArgVisualization';
import { PrettyArgData } from './PrettyArg.types';

interface PrettyArgContainerProps {
    filename: string;
    max_samples: number;
    focusNodeId?: number;
    mode?: 'subgraph' | 'parent';
}

export const PrettyArgContainer = forwardRef<SVGSVGElement, PrettyArgContainerProps>(
    ({ filename, max_samples, focusNodeId, mode }, ref) => {
        const [data, setData] = useState<PrettyArgData | null>(null);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [genomicStart, setGenomicStart] = useState<number>(0);
        const [genomicEnd, setGenomicEnd] = useState<number>(1);
        const [edgeType, setEdgeType] = useState<'line' | 'ortho'>('ortho');

        const loadData = async () => {
            setLoading(true);
            setError(null);
            
            try {
                console.log(`Loading Pretty ARG data for ${filename} with max_samples=${max_samples}`, 
                           focusNodeId ? `focus=${focusNodeId}, mode=${mode}` : '');
                
                // Build URL with optional parameters
                let url = `http://localhost:8000/pretty-arg-data/${encodeURIComponent(filename)}?max_samples=${max_samples}`;
                if (focusNodeId !== undefined) {
                    url += `&focus=${focusNodeId}`;
                }
                if (mode) {
                    url += `&mode=${mode}`;
                }
                
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`Failed to load data: ${response.statusText}`);
                }
                
                const d3argData = await response.json();
                console.log('Pretty ARG data loaded:', d3argData);
                
                setData(d3argData);
                
                // Set initial genomic range
                if (d3argData.data.breakpoints && d3argData.data.breakpoints.length > 0) {
                    const firstBreakpoint = d3argData.data.breakpoints[0];
                    const lastBreakpoint = d3argData.data.breakpoints[d3argData.data.breakpoints.length - 1];
                    setGenomicStart(firstBreakpoint.start);
                    setGenomicEnd(lastBreakpoint.stop);
                }
                
            } catch (err) {
                console.error('Error loading Pretty ARG data:', err);
                setError(err instanceof Error ? err.message : 'Failed to load data');
            } finally {
                setLoading(false);
            }
        };

        useEffect(() => {
            loadData();
        }, [filename, max_samples, focusNodeId, mode]);

        if (loading) {
            return (
                <div className="h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sp-pale-green"></div>
                        <div className="text-sp-white">Loading Pretty ARG visualization...</div>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                        <div className="text-red-400 text-xl mb-4">Error loading visualization</div>
                        <div className="text-sp-white mb-4">{error}</div>
                        <button 
                            onClick={loadData}
                            className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            );
        }

        if (!data) {
            return (
                <div className="h-full flex items-center justify-center">
                    <div className="text-sp-white">No data available</div>
                </div>
            );
        }

        return (
            <div className="h-full flex flex-col">
                {/* Controls Panel */}
                <div className="bg-sp-dark-blue p-4 rounded-lg mb-4 border border-sp-pale-green">
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-sp-white font-medium">Genomic Range:</span>
                            <input
                                type="number"
                                value={genomicStart}
                                onChange={(e) => setGenomicStart(parseFloat(e.target.value))}
                                step="0.1"
                                className="w-20 bg-sp-very-dark-blue border border-sp-dark-blue rounded px-2 py-1 text-sm text-sp-white"
                            />
                            <span className="text-sp-white">to</span>
                            <input
                                type="number"
                                value={genomicEnd}
                                onChange={(e) => setGenomicEnd(parseFloat(e.target.value))}
                                step="0.1"
                                className="w-20 bg-sp-very-dark-blue border border-sp-dark-blue rounded px-2 py-1 text-sm text-sp-white"
                            />
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <span className="text-sp-white font-medium">Edge Type:</span>
                            <select
                                value={edgeType}
                                onChange={(e) => setEdgeType(e.target.value as 'line' | 'ortho')}
                                className="bg-sp-very-dark-blue border border-sp-dark-blue rounded px-2 py-1 text-sm text-sp-white"
                            >
                                <option value="line">Straight Lines</option>
                                <option value="ortho">Orthogonal</option>
                            </select>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <span className="text-sp-white text-sm">
                                {data.data.nodes.length} nodes, {data.data.links.length} links
                            </span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                            <span className="text-sp-white text-sm">
                                {data.data.breakpoints.length} trees
                            </span>
                        </div>
                        
                        <button
                            onClick={loadData}
                            className="bg-sp-very-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-3 py-1 rounded text-sm"
                        >
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Visualization */}
                <div className="flex-1 bg-white rounded-lg border border-sp-pale-green overflow-hidden">
                    <PrettyArgVisualization 
                        ref={ref}
                        data={data}
                        genomicStart={genomicStart}
                        genomicEnd={genomicEnd}
                        edgeType={edgeType}
                    />
                </div>
            </div>
        );
    }
); 