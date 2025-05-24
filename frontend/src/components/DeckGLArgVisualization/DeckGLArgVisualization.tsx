import React, { useMemo, useState, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { LineLayer } from '@deck.gl/layers';
import { OrthographicView } from '@deck.gl/core';
import type { DeckGLGraphProps, PositionedNode, PositionedEdge, GraphNode, GraphEdge } from './DeckGLArgVisualization.types';

// Color constants
const COLORS = {
    SAMPLE_NODE: [102, 255, 178, 255] as [number, number, number, number], // sp-pale-green
    INTERNAL_NODE: [3, 48, 62, 255] as [number, number, number, number], // sp-very-dark-blue
    COMBINED_NODE: [255, 193, 7, 255] as [number, number, number, number], // amber for combined nodes
    EDGE_NORMAL: [102, 255, 178, 100] as [number, number, number, number], // semi-transparent pale green
    EDGE_HIGHLIGHTED: [102, 255, 178, 200] as [number, number, number, number], // more opaque pale green
    FOCAL_NODE: [255, 107, 107, 255] as [number, number, number, number], // red for focal node
};

// Internal node interface with layout properties
interface LayoutNode extends GraphNode {
    x?: number;
    y?: number;
    layer?: number;
    degree?: number;
    is_combined?: boolean;
    combined_nodes?: number[];
}

// Helper function to get all edges connected to a node
function getConnectedEdges(node: LayoutNode, edges: GraphEdge[]): GraphEdge[] {
    return edges.filter(e => {
        const source = typeof e.source === 'number' ? e.source : (e.source as LayoutNode).id;
        const target = typeof e.target === 'number' ? e.target : (e.target as LayoutNode).id;
        return source === node.id || target === node.id;
    });
}

// Helper function to check if two nodes have identical relationships
function haveIdenticalRelationships(node1: LayoutNode, node2: LayoutNode, edges: GraphEdge[]): boolean {
    const edges1 = getConnectedEdges(node1, edges);
    const edges2 = getConnectedEdges(node2, edges);
    
    if (edges1.length !== edges2.length) return false;
    
    // Create sets of connected node IDs for both nodes
    const connectedNodes1 = new Set<number>();
    const connectedNodes2 = new Set<number>();
    
    edges1.forEach(e => {
        const source = typeof e.source === 'number' ? e.source : (e.source as LayoutNode).id;
        const target = typeof e.target === 'number' ? e.target : (e.target as LayoutNode).id;
        if (source !== node1.id) connectedNodes1.add(source);
        if (target !== node1.id) connectedNodes1.add(target);
    });
    
    edges2.forEach(e => {
        const source = typeof e.source === 'number' ? e.source : (e.source as LayoutNode).id;
        const target = typeof e.target === 'number' ? e.target : (e.target as LayoutNode).id;
        if (source !== node2.id) connectedNodes2.add(source);
        if (target !== node2.id) connectedNodes2.add(target);
    });
    
    // Check if the sets are identical
    if (connectedNodes1.size !== connectedNodes2.size) return false;
    for (const id of connectedNodes1) {
        if (!connectedNodes2.has(id)) return false;
    }
    return true;
}

// Helper function to combine nodes with identical time and relationships
function combineIdenticalNodes(nodes: GraphNode[], edges: GraphEdge[]): { nodes: LayoutNode[], edges: GraphEdge[] } {
    const processedNodes = new Set<number>();
    const newNodes: LayoutNode[] = [];
    const newEdges: GraphEdge[] = [];
    const nodeMap = new Map<number, number>(); // Maps old node IDs to new combined node IDs
    
    // First pass: identify nodes to combine
    for (let i = 0; i < nodes.length; i++) {
        if (processedNodes.has(nodes[i].id)) continue;
        
        const node1 = nodes[i] as LayoutNode;
        const identicalNodes: LayoutNode[] = [node1];
        
        // NEVER combine sample nodes - they represent actual samples and should always be distinct
        if (node1.is_sample) {
            newNodes.push(node1);
            nodeMap.set(node1.id, node1.id);
            processedNodes.add(node1.id);
            continue;
        }
        
        // Find all nodes with identical time and relationships (only for non-sample nodes)
        for (let j = i + 1; j < nodes.length; j++) {
            const node2 = nodes[j] as LayoutNode;
            if (processedNodes.has(node2.id)) continue;
            
            // Skip if either node is a sample node - samples should never be combined
            if (node2.is_sample) continue;
            
            if (node1.time === node2.time && 
                node1.is_sample === node2.is_sample && 
                haveIdenticalRelationships(node1, node2, edges)) {
                identicalNodes.push(node2);
                processedNodes.add(node2.id);
            }
        }
        
        if (identicalNodes.length > 1) {
            // Create a combined node
            const combinedNode: LayoutNode = {
                ...node1,
                id: node1.id, // Use the first node's ID
                is_combined: true,
                combined_nodes: identicalNodes.map(n => n.id)
            };
            newNodes.push(combinedNode);
            
            // Map all combined node IDs to the new combined node ID
            identicalNodes.forEach(n => nodeMap.set(n.id, combinedNode.id));
        } else {
            newNodes.push(node1);
            nodeMap.set(node1.id, node1.id);
        }
        
        processedNodes.add(node1.id);
    }
    
    // Second pass: update edges to use new node IDs and remove duplicates
    const edgeSet = new Set<string>();
    edges.forEach(edge => {
        const source = typeof edge.source === 'number' ? edge.source : (edge.source as LayoutNode).id;
        const target = typeof edge.target === 'number' ? edge.target : (edge.target as LayoutNode).id;
        
        const newSource = nodeMap.get(source);
        const newTarget = nodeMap.get(target);
        
        if (newSource !== undefined && newTarget !== undefined && newSource !== newTarget) {
            // Create a unique key for this edge
            const edgeKey = `${Math.min(newSource, newTarget)}-${Math.max(newSource, newTarget)}`;
            if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                newEdges.push({
                    ...edge,
                    source: newSource,
                    target: newTarget
                });
            }
        }
    });
    
    return { nodes: newNodes, edges: newEdges };
}

// Helper function to assign layers based on time
function assignLayers(nodes: LayoutNode[]): void {
    // Assign layers based on time
    const timeLayers = new Map<number, number>();
    nodes.forEach(node => {
        if (!timeLayers.has(node.time)) {
            timeLayers.set(node.time, timeLayers.size);
        }
        node.layer = timeLayers.get(node.time)!;
    });
}

// Helper function to get immediate parent of a node
function getParent(node: LayoutNode, nodes: LayoutNode[], edges: GraphEdge[]): LayoutNode | null {
    const incomingEdges = edges.filter(e => {
        const source = typeof e.source === 'number' ? nodes.find(n => n.id === e.source) : e.source as LayoutNode;
        const target = typeof e.target === 'number' ? nodes.find(n => n.id === e.target) : e.target as LayoutNode;
        return target?.id === node.id && source && (source.layer === undefined || source.layer < (node.layer || 0));
    });

    if (incomingEdges.length === 0) return null;
    const parent = typeof incomingEdges[0].source === 'number' 
        ? nodes.find(n => n.id === incomingEdges[0].source) 
        : incomingEdges[0].source as LayoutNode;
    return parent || null;
}

// Helper function to get all descendant samples of a node
function getDescendantSamples(node: LayoutNode, nodes: LayoutNode[], edges: GraphEdge[]): LayoutNode[] {
    const descendants = new Set<LayoutNode>();
    const visited = new Set<number>();
    const queue: LayoutNode[] = [node];
    
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        
        // Find all edges where current node is the source
        const outgoingEdges = edges.filter(e => {
            const source = typeof e.source === 'number' ? nodes.find(n => n.id === e.source) : e.source as LayoutNode;
            const target = typeof e.target === 'number' ? nodes.find(n => n.id === e.target) : e.target as LayoutNode;
            // Only consider edges where source is earlier in time than target
            return source?.id === current.id && target && (target.layer || 0) > (current.layer || 0);
        });
        
        // Add target nodes to queue if they're not samples
        outgoingEdges.forEach(e => {
            const target = typeof e.target === 'number' ? nodes.find(n => n.id === e.target) : e.target as LayoutNode;
            if (!target) return;
            
            if (target.is_sample) {
                descendants.add(target);
            } else if (!visited.has(target.id)) {
                queue.push(target);
            }
        });
    }
    
    return Array.from(descendants);
}

// Helper function to get x-axis range of descendant samples
function getDescendantSampleRange(node: LayoutNode, nodes: LayoutNode[], edges: GraphEdge[]): { min: number; max: number } | null {
    const descendantSamples = getDescendantSamples(node, nodes, edges);
    if (descendantSamples.length === 0) return null;
    
    const xValues = descendantSamples.map(n => n.x!).filter(x => x !== undefined);
    if (xValues.length === 0) return null;
    
    return {
        min: Math.min(...xValues),
        max: Math.max(...xValues)
    };
}

// Main layout calculation function implementing proper ARG layout
function calculateArgLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): { 
    positionedNodes: PositionedNode[], 
    positionedEdges: PositionedEdge[] 
} {
    // Step 1: Combine identical nodes to reduce complexity
    const { nodes: combinedNodes, edges: combinedEdges } = combineIdenticalNodes(nodes, edges);
    
    // Step 2: Assign layers based on time
    assignLayers(combinedNodes);
    
    // Step 3: Position nodes layer by layer
    const numLayers = Math.max(...combinedNodes.map(n => n.layer || 0)) + 1;
    const layerHeight = height / (numLayers + 1);
    
    // First pass: Position sample nodes (bottom layer)
    const sampleNodes = combinedNodes.filter(n => n.is_sample);
    sampleNodes.sort((a, b) => a.individual - b.individual); // Sort by individual
    sampleNodes.forEach((node, index) => {
        node.x = (width * 0.1) + (index / Math.max(sampleNodes.length - 1, 1)) * (width * 0.8);
        node.y = height - layerHeight; // Bottom layer
    });
    
    // Second pass: Position internal nodes layer by layer from bottom to top
    for (let layer = numLayers - 2; layer >= 0; layer--) {
        const layerNodes = combinedNodes.filter(n => n.layer === layer && !n.is_sample);
        
        // Group nodes by their immediate parent
        const parentGroups = new Map<number, LayoutNode[]>();
        layerNodes.forEach(node => {
            const parent = getParent(node, combinedNodes, combinedEdges);
            const parentId = parent?.id ?? -1; // -1 for nodes without parents
            if (!parentGroups.has(parentId)) {
                parentGroups.set(parentId, []);
            }
            parentGroups.get(parentId)!.push(node);
        });
        
        // Sort nodes within each parent group by their connectivity to samples
        parentGroups.forEach(group => {
            group.sort((a, b) => {
                const aSamples = getDescendantSamples(a, combinedNodes, combinedEdges).length;
                const bSamples = getDescendantSamples(b, combinedNodes, combinedEdges).length;
                return bSamples - aSamples;
            });
        });
        
        // Convert parent groups to array and sort by parent position
        const sortedGroups = Array.from(parentGroups.entries()).sort(([parentIdA], [parentIdB]) => {
            if (parentIdA === -1) return -1;
            if (parentIdB === -1) return 1;
            const parentA = combinedNodes.find(n => n.id === parentIdA);
            const parentB = combinedNodes.find(n => n.id === parentIdB);
            return (parentA?.x ?? 0) - (parentB?.x ?? 0);
        });
        
        // Position nodes within layer
        const xPadding = width * 0.1;
        const availableWidth = width - (2 * xPadding);
        let currentX = xPadding;
        
        if (sortedGroups.length > 0) {
            const groupWidth = availableWidth / sortedGroups.length;
            
            sortedGroups.forEach(([parentId, group], groupIndex) => {
                const nodeSpacing = groupWidth / (group.length + 1);
                
                group.forEach((node, nodeIndex) => {
                    // Try to position within descendant range if possible
                    const descendantRange = getDescendantSampleRange(node, combinedNodes, combinedEdges);
                    if (descendantRange) {
                        const idealX = currentX + (nodeIndex + 1) * nodeSpacing;
                        node.x = Math.max(descendantRange.min, Math.min(descendantRange.max, idealX));
                    } else {
                        node.x = currentX + (nodeIndex + 1) * nodeSpacing;
                    }
                    node.y = height - (layer + 1) * layerHeight;
                });
                
                currentX += groupWidth;
            });
        }
    }
    
    // Step 4: Create positioned nodes and edges
    const positionedNodes: PositionedNode[] = combinedNodes.map(node => {
        const radius = node.is_sample ? 8 : (node.is_combined ? 12 : 6);
        const color = node.is_sample 
            ? COLORS.SAMPLE_NODE 
            : node.is_combined 
                ? COLORS.COMBINED_NODE 
                : COLORS.INTERNAL_NODE;
        
        return {
            ...node,
            x: node.x || 0,
            y: node.y || 0,
            radius,
            color
        };
    });
    
    const positionedEdges: PositionedEdge[] = combinedEdges.map(edge => {
        const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
        const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
        
        const sourceNode = positionedNodes.find(n => n.id === sourceId);
        const targetNode = positionedNodes.find(n => n.id === targetId);
        
        if (!sourceNode || !targetNode) {
            return {
                ...edge,
                sourceX: 0,
                sourceY: 0,
                targetX: 0,
                targetY: 0,
                color: COLORS.EDGE_NORMAL,
                width: 1
            };
        }
        
        return {
            ...edge,
            sourceX: sourceNode.x,
            sourceY: sourceNode.y,
            targetX: targetNode.x,
            targetY: targetNode.y,
            color: COLORS.EDGE_NORMAL,
            width: 1.5
        };
    });
    
    return { positionedNodes, positionedEdges };
}

export const DeckGLArgVisualization: React.FC<DeckGLGraphProps> = ({
    data,
    width = 1200,
    height = 800,
    onNodeClick,
    onNodeHover,
    focalNode
}) => {
    const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
    
    const { positionedNodes, positionedEdges } = useMemo(() => {
        if (!data?.nodes || !data?.edges) {
            return { positionedNodes: [], positionedEdges: [] };
        }
        return calculateArgLayout(data.nodes, data.edges, width, height);
    }, [data, width, height]);
    
    // Update focal node color
    const enhancedNodes = useMemo(() => {
        return positionedNodes.map(node => ({
            ...node,
            color: focalNode && node.id === focalNode.id ? COLORS.FOCAL_NODE : node.color
        }));
    }, [positionedNodes, focalNode]);
    
    // Highlight edges connected to hovered/focal node
    const enhancedEdges = useMemo(() => {
        const highlightNodeId = hoveredNode?.id || focalNode?.id;
        if (!highlightNodeId) return positionedEdges;
        
        return positionedEdges.map(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            const isConnected = sourceId === highlightNodeId || targetId === highlightNodeId;
            
            return {
                ...edge,
                color: isConnected ? COLORS.EDGE_HIGHLIGHTED : COLORS.EDGE_NORMAL,
                width: isConnected ? 2.5 : 1.5
            };
        });
    }, [positionedEdges, hoveredNode, focalNode]);
    
    const initialViewState = {
        target: [width / 2, height / 2, 0] as [number, number, number],
        zoom: 0
    };
    
    // Handle hover events with proper typing
    const handleNodeHover = useCallback((info: any) => {
        const node = info.object as PositionedNode | null;
        setHoveredNode(node);
        onNodeHover?.(node);
        
        if (node && info.x !== undefined && info.y !== undefined) {
            setTooltip({ x: info.x, y: info.y, node });
        } else {
            setTooltip(null);
        }
    }, [onNodeHover]);
    
    const handleNodeClick = useCallback((info: any) => {
        const node = info.object as PositionedNode;
        if (node && onNodeClick) {
            onNodeClick(node);
        }
    }, [onNodeClick]);
    
    const layers = [
        // Edges layer (render first, so nodes appear on top)
        new LineLayer({
            id: 'edges',
            data: enhancedEdges,
            getSourcePosition: (d: PositionedEdge) => [d.sourceX, d.sourceY],
            getTargetPosition: (d: PositionedEdge) => [d.targetX, d.targetY],
            getColor: (d: PositionedEdge) => d.color,
            getWidth: (d: PositionedEdge) => d.width,
            pickable: false,
            updateTriggers: {
                getColor: [hoveredNode, focalNode],
                getWidth: [hoveredNode, focalNode]
            }
        }),
        
        // Nodes layer
        new ScatterplotLayer({
            id: 'nodes',
            data: enhancedNodes,
            getPosition: (d: PositionedNode) => [d.x, d.y],
            getRadius: (d: PositionedNode) => d.radius,
            getFillColor: (d: PositionedNode) => d.color,
            getLineColor: [255, 255, 255, 255], // white outline
            getLineWidth: 1,
            lineWidthMinPixels: 1,
            pickable: true,
            onHover: handleNodeHover,
            onClick: handleNodeClick,
            updateTriggers: {
                getFillColor: [focalNode]
            }
        })
    ];
    
    return (
        <div className="relative w-full h-full">
            <DeckGL
                width={width}
                height={height}
                initialViewState={initialViewState}
                controller={{ dragRotate: false }}
                layers={layers}
                views={new OrthographicView({ id: 'ortho' })}
                style={{ background: '#03303E' }} // sp-very-dark-blue
            />
            
            {/* Tooltip */}
            {tooltip && (
                <div 
                    className="absolute pointer-events-none bg-sp-dark-blue text-sp-white p-2 rounded shadow-lg border border-sp-pale-green z-10"
                    style={{ 
                        left: tooltip.x + 10, 
                        top: tooltip.y - 10,
                        transform: 'translate(0, -100%)'
                    }}
                >
                    <div className="text-sm">
                        <div><strong>Node {tooltip.node.id}</strong></div>
                        <div>Time: {tooltip.node.time.toFixed(4)}</div>
                        <div>Type: {tooltip.node.is_sample ? 'Sample' : tooltip.node.is_combined ? 'Combined' : 'Internal'}</div>
                        {tooltip.node.individual !== undefined && (
                            <div>Individual: {tooltip.node.individual}</div>
                        )}
                        {tooltip.node.is_combined && tooltip.node.combined_nodes && (
                            <div>Combines: {tooltip.node.combined_nodes.length} nodes</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}; 