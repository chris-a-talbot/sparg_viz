import React, { useMemo, useState, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import { OrbitView } from '@deck.gl/core';
import { GraphData, GraphNode, GraphEdge } from '../ForceDirectedGraph/ForceDirectedGraph.types';

interface SpatialArg3DProps {
  data: GraphData | null;
  width: number;
  height: number;
  onNodeClick?: (node: GraphNode) => void;
  onNodeRightClick?: (node: GraphNode) => void;
  selectedNode?: GraphNode | null;
}

interface Node3D extends GraphNode {
  position: [number, number, number];
  color: [number, number, number, number];
  size: number;
  // Properties for combined nodes
  is_combined?: boolean;
  combined_nodes?: number[];
}

interface Edge3D {
  source: [number, number, number];
  target: [number, number, number];
  color: [number, number, number, number];
}

// Helper function to check if a node is a root node (has children but no parents)
function isRootNode(node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): boolean {
  // Check for incoming edges (parents)
  const hasParents = edges.some(e => {
    const targetId = typeof e.target === 'number' ? e.target : e.target.id;
    return targetId === node.id;
  });

  // Check for outgoing edges (children)  
  const hasChildren = edges.some(e => {
    const sourceId = typeof e.source === 'number' ? e.source : e.source.id;
    return sourceId === node.id;
  });

  // A root node has children but no parents
  return !hasParents && hasChildren;
}

// Helper function to check if two nodes have identical relationships and location
function haveIdenticalRelationshipsAndLocation(node1: GraphNode, node2: GraphNode, edges: GraphEdge[]): boolean {
  // Must have identical spatial location
  if (!node1.location || !node2.location) return false;
  if (node1.location.x !== node2.location.x || node1.location.y !== node2.location.y) return false;
  
  // Get connected edges for both nodes
  const edges1 = edges.filter(e => {
    const sourceId = typeof e.source === 'number' ? e.source : e.source.id;
    const targetId = typeof e.target === 'number' ? e.target : e.target.id;
    return sourceId === node1.id || targetId === node1.id;
  });
  
  const edges2 = edges.filter(e => {
    const sourceId = typeof e.source === 'number' ? e.source : e.source.id;
    const targetId = typeof e.target === 'number' ? e.target : e.target.id;
    return sourceId === node2.id || targetId === node2.id;
  });
  
  if (edges1.length !== edges2.length) return false;
  
  // Create sets of connected node IDs for both nodes
  const connectedNodes1 = new Set<number>();
  const connectedNodes2 = new Set<number>();
  
  edges1.forEach(e => {
    const sourceId = typeof e.source === 'number' ? e.source : e.source.id;
    const targetId = typeof e.target === 'number' ? e.target : e.target.id;
    if (sourceId !== node1.id) connectedNodes1.add(sourceId);
    if (targetId !== node1.id) connectedNodes1.add(targetId);
  });
  
  edges2.forEach(e => {
    const sourceId = typeof e.source === 'number' ? e.source : e.source.id;
    const targetId = typeof e.target === 'number' ? e.target : e.target.id;
    if (sourceId !== node2.id) connectedNodes2.add(sourceId);
    if (targetId !== node2.id) connectedNodes2.add(targetId);
  });
  
  // Check if the sets are identical
  if (connectedNodes1.size !== connectedNodes2.size) return false;
  for (const id of connectedNodes1) {
    if (!connectedNodes2.has(id)) return false;
  }
  return true;
}

// Helper function to combine nodes with identical time, relationships, and location
function combineIdenticalNodes(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[], edges: GraphEdge[] } {
  const processedNodes = new Set<number>();
  const newNodes: GraphNode[] = [];
  const newEdges: GraphEdge[] = [];
  const nodeMap = new Map<number, number>(); // Maps old node IDs to new combined node IDs
  
  // First pass: identify nodes to combine
  for (let i = 0; i < nodes.length; i++) {
    if (processedNodes.has(nodes[i].id)) continue;
    
    const node1 = nodes[i];
    const identicalNodes: GraphNode[] = [node1];
    
    // NEVER combine sample nodes - they represent actual samples and should always be distinct
    if (node1.is_sample) {
      newNodes.push(node1);
      nodeMap.set(node1.id, node1.id);
      processedNodes.add(node1.id);
      continue;
    }
    
    // Find all nodes with identical time, relationships, and location (only for non-sample nodes)
    for (let j = i + 1; j < nodes.length; j++) {
      const node2 = nodes[j];
      if (processedNodes.has(node2.id)) continue;
      
      // Skip if either node is a sample node - samples should never be combined
      if (node2.is_sample) continue;
      
      if (node1.time === node2.time && 
          node1.is_sample === node2.is_sample && 
          haveIdenticalRelationshipsAndLocation(node1, node2, edges)) {
        identicalNodes.push(node2);
        processedNodes.add(node2.id);
      }
    }
    
    if (identicalNodes.length > 1) {
      // Create a combined node
      const combinedNode: GraphNode = {
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
    const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
    
    const newSourceId = nodeMap.get(sourceId);
    const newTargetId = nodeMap.get(targetId);
    
    if (newSourceId !== undefined && newTargetId !== undefined && newSourceId !== newTargetId) {
      // Create a unique key for this edge to avoid duplicates
      const edgeKey = `${Math.min(newSourceId, newTargetId)}-${Math.max(newSourceId, newTargetId)}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        newEdges.push({
          ...edge,
          source: newSourceId,
          target: newTargetId
        });
      }
    }
  });
  
  return { nodes: newNodes, edges: newEdges };
}

const SpatialArg3DVisualization: React.FC<SpatialArg3DProps> = ({
  data,
  width,
  height,
  onNodeClick,
  onNodeRightClick,
  selectedNode
}) => {
  const deckRef = useRef<any>(null);
  const [viewState, setViewState] = useState({
    target: [0, 0, 0] as [number, number, number],
    zoom: 1,
    minZoom: 0.1,
    maxZoom: 10,
    rotationX: 0,
    rotationOrbit: 0,
    orbitAxis: 'Y' as const
  });

  const { nodes3D, edges3D, bounds } = useMemo(() => {
    if (!data || !data.nodes.length) {
      return { nodes3D: [], edges3D: [], bounds: null };
    }

    // Apply node combining before 3D transformation
    const { nodes: combinedNodes, edges: combinedEdges } = combineIdenticalNodes(data.nodes, data.edges);
    
    // Log information about combined nodes
    const combinedNodeCount = combinedNodes.filter(n => n.is_combined).length;
    if (combinedNodeCount > 0) {
      console.log(`Combined ${data.nodes.length - combinedNodes.length} nodes into ${combinedNodeCount} combined nodes for 3D visualization`);
    }

    // Filter nodes that have spatial location data  
    const spatialNodes = combinedNodes.filter(node => 
      node.location?.x !== undefined && node.location?.y !== undefined
    );

    if (spatialNodes.length === 0) {
      return { nodes3D: [], edges3D: [], bounds: null };
    }

    // Get unique time values and sort them
    const uniqueTimes = Array.from(new Set(spatialNodes.map(node => node.time))).sort((a, b) => a - b);
    const timeToZIndex = new Map(uniqueTimes.map((time, index) => [time, index]));

    // Calculate bounds for spatial coordinates
    const xCoords = spatialNodes.map(node => node.location!.x);
    const yCoords = spatialNodes.map(node => node.location!.y);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const maxScale = Math.max(maxX - minX, maxY - minY) || 1;

    const normalizedNodes: Node3D[] = spatialNodes.map(node => {
      const normalizedX = ((node.location!.x - centerX) / maxScale) * 50; // Scale to reasonable range
      const normalizedY = ((node.location!.y - centerY) / maxScale) * 50;
      const zIndex = timeToZIndex.get(node.time) || 0;
      const normalizedZ = zIndex * 10; // Even spacing on z-axis

      // Enhanced color coding system
      let color: [number, number, number, number];
      let size: number;

      if (node.is_sample) {
        color = [52, 235, 177, 255] as [number, number, number, number];  // sp-pale-green for samples
        size = 150;
      } else if (node.is_combined) {
        color = [80, 160, 175, 255] as [number, number, number, number];   // Light blue-green for combined nodes
        size = 120;
      } else if (isRootNode(node, combinedNodes, combinedEdges)) {
        color = [96, 160, 183, 255] as [number, number, number, number];   // Light blue for root nodes  
        size = 130;
      } else {
        color = [96, 160, 183, 255] as [number, number, number, number];   // Light blue for regular internal nodes
        size = 100;
      }

      return {
        ...node,
        position: [normalizedX, normalizedY, normalizedZ] as [number, number, number],
        color,
        size
      };
    });

    // Create node lookup for edge processing
    const nodeMap = new Map<number, Node3D>();
    normalizedNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });

    // Transform edges to 3D
    const transformedEdges: Edge3D[] = combinedEdges
      .filter(edge => {
        const sourceNode = nodeMap.get(typeof edge.source === 'object' ? edge.source.id : edge.source);
        const targetNode = nodeMap.get(typeof edge.target === 'object' ? edge.target.id : edge.target);
        return sourceNode && targetNode;
      })
      .map(edge => {
        const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
        const sourceNode = nodeMap.get(sourceId)!;
        const targetNode = nodeMap.get(targetId)!;

        return {
          source: sourceNode.position,
          target: targetNode.position,
          color: [255, 255, 255, 100] as [number, number, number, number] // Semi-transparent white edges
        };
      });

    const bounds = {
      minX: Math.min(...normalizedNodes.map(n => n.position[0])),
      maxX: Math.max(...normalizedNodes.map(n => n.position[0])),
      minY: Math.min(...normalizedNodes.map(n => n.position[1])),
      maxY: Math.max(...normalizedNodes.map(n => n.position[1])),
      minZ: Math.min(...normalizedNodes.map(n => n.position[2])),
      maxZ: Math.max(...normalizedNodes.map(n => n.position[2]))
    };

    return { nodes3D: normalizedNodes, edges3D: transformedEdges, bounds };
  }, [data]);

  // Auto-fit view when data changes
  React.useEffect(() => {
    if (bounds) {
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;  
      const centerZ = (bounds.minZ + bounds.maxZ) / 2;
      
      setViewState(prev => ({
        ...prev,
        target: [centerX, centerY, centerZ],
        zoom: 0.8
      }));
    }
  }, [bounds]);

  const layers = [
    // Edges layer
    new LineLayer<Edge3D>({
      id: 'edges',
      data: edges3D,
      pickable: false,
      getSourcePosition: (d: Edge3D) => d.source,
      getTargetPosition: (d: Edge3D) => d.target,
      getColor: (d: Edge3D) => d.color,
      getWidth: 2
    }),
    
    // Nodes layer
    new ScatterplotLayer<Node3D>({
      id: 'nodes',
      data: nodes3D,
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 3,
      radiusMaxPixels: 20,
      lineWidthMinPixels: 1,
      getPosition: (d: Node3D) => d.position,
      getRadius: (d: Node3D) => {
        // Highlight selected node with larger size
        const isSelected = selectedNode && d.id === selectedNode.id;
        return isSelected ? d.size * 1.5 : d.size;
      },
      getFillColor: (d: Node3D) => {
        // Highlight selected node with different color
        const isSelected = selectedNode && d.id === selectedNode.id;
        if (isSelected) {
          return [255, 255, 255, 255] as [number, number, number, number]; // White for selected
        }
        return d.color;
      },
      getLineColor: (d: Node3D) => {
        const isSelected = selectedNode && d.id === selectedNode.id;
        if (isSelected) {
          return [255, 255, 255, 255] as [number, number, number, number]; // White outline for selected
        }
        // White outline for root nodes (similar to 2D visualization)
        if (isRootNode(d, data?.nodes || [], data?.edges || [])) {
          return [255, 255, 255, 255] as [number, number, number, number]; // White outline for root nodes
        }
        // Dark outline for sample nodes
        if (d.is_sample) {
          return [3, 48, 62, 255] as [number, number, number, number]; // Very dark blue outline for sample nodes
        }
        // No outline for other nodes
        return [255, 255, 255, 0] as [number, number, number, number];
      },
      getLineWidth: (d: Node3D) => {
        const isSelected = selectedNode && d.id === selectedNode.id;
        if (isSelected) return 3; // Thicker outline for selected
        if (isRootNode(d, data?.nodes || [], data?.edges || [])) return 2; // Thick outline for root nodes
        if (d.is_sample) return 1; // Thin outline for sample nodes
        return 0; // No outline for other nodes
      },
      onClick: (info: any, event: any) => {
        event.srcEvent.preventDefault();
        if (info.object && onNodeClick) {
          onNodeClick(info.object);
        }
      },
      onHover: (info: any) => {
        // Handle right-click through deck.gl's pick functionality
        if (info.rightButton && info.object && onNodeRightClick) {
          onNodeRightClick(info.object);
        }
      }
    })
  ];

  if (!data || nodes3D.length === 0) {
    return (
      <div 
        style={{ width, height }}
        className="flex items-center justify-center bg-sp-very-dark-blue text-sp-white border border-sp-dark-blue rounded"
      >
        <div className="text-center">
          <p className="text-lg mb-2">No spatial data available</p>
          <p className="text-sm text-sp-white opacity-75">
            This ARG does not contain 2D spatial information required for 3D visualization.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      style={{ width, height }} 
      className="relative"
      onContextMenu={(event) => {
        // Handle right-click at the container level
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        if (deckRef.current) {
          const info = deckRef.current.pickObject({
            x: x,
            y: y,
            radius: 10
          });
          if (info?.object && onNodeRightClick) {
            onNodeRightClick(info.object);
          }
        }
      }}
    >
      <DeckGL
        ref={deckRef}
        width={width}
        height={height}
        views={new OrbitView()}
        viewState={viewState}
        onViewStateChange={({ viewState: newViewState }: any) => setViewState(newViewState)}
        controller={true}
        layers={layers}
        getCursor={() => 'crosshair'}
        getTooltip={({ object }: any) => {
          if (!object) return null;
          const node = object as Node3D;
          
          let nodeTypeInfo = '';
          if (node.is_sample) {
            nodeTypeInfo = 'Sample Node';
          } else if (node.is_combined) {
            nodeTypeInfo = `Combined Node (contains: ${node.combined_nodes?.join(', ')})`;
          } else if (isRootNode(node, data?.nodes || [], data?.edges || [])) {
            nodeTypeInfo = 'Root Node';
          } else {
            nodeTypeInfo = 'Internal Node';
          }
          
          return {
            html: `
              <div style="background: rgba(5, 62, 78, 0.95); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">
                <strong>Node ${node.id}</strong><br/>
                Time: ${node.time.toFixed(3)}<br/>
                ${nodeTypeInfo}<br/>
                ${node.location ? `Location: (${node.location.x.toFixed(2)}, ${node.location.y.toFixed(2)})` : ''}
              </div>
            `,
            style: {
              backgroundColor: 'transparent',
              color: 'white'
            }
          };
        }}
      />
      
      {/* Controls overlay */}
      <div className="absolute top-4 right-4 bg-sp-dark-blue bg-opacity-90 text-sp-white p-3 rounded-lg text-xs">
        <div className="space-y-1">
          <div><strong>3D Controls:</strong></div>
          <div>• Drag: Rotate view</div>
          <div>• Scroll: Zoom in/out</div>
          <div>• Left click: Select node</div>
          <div>• Right click: Ancestors</div>
        </div>
      </div>
    </div>
  );
};

export default SpatialArg3DVisualization; 