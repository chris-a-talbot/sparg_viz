import React, { useEffect, useRef, forwardRef, useState } from 'react';
import * as d3 from 'd3';
import { PrettyArgVisualizationProps, PrettyArgNode, PrettyArgLink } from './PrettyArg.types';
import { useNavigate } from 'react-router-dom';

// Simple node interface for static positioning
interface StaticNode extends PrettyArgNode {
    x: number;
    y: number;
}

interface ContextMenu {
    x: number;
    y: number;
    nodeId: number | null;
    visible: boolean;
}

export const PrettyArgVisualization = forwardRef<SVGSVGElement, PrettyArgVisualizationProps>(
    ({ data, genomicStart = 0, genomicEnd = 1, edgeType = 'ortho' }, ref) => {
        const svgRef = useRef<SVGSVGElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const navigate = useNavigate();
        const [contextMenu, setContextMenu] = useState<ContextMenu>({ x: 0, y: 0, nodeId: null, visible: false });
        const [showControls, setShowControls] = useState(true); // State to toggle controls visibility

        useEffect(() => {
            if (!data || !svgRef.current || !containerRef.current) return;

            const svg = d3.select(svgRef.current);
            svg.selectAll("*").remove(); // Clear previous render

            // Set up dimensions
            const container = containerRef.current;
            const containerRect = container.getBoundingClientRect();
            const margin = { top: 60, right: 200, bottom: 80, left: 80 }; // Increased right margin for legend
            const width = Math.max(800, containerRect.width - margin.left - margin.right);
            const height = Math.max(600, data.height);

            svg.attr("viewBox", `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`);

            // Add zoom behavior
            const zoom = d3.zoom<SVGSVGElement, unknown>()
                .scaleExtent([0.1, 10])
                .on("zoom", (event) => {
                    g.attr("transform", `translate(${margin.left + event.transform.x},${margin.top + event.transform.y}) scale(${event.transform.k})`);
                });

            svg.call(zoom);

            // Create main group
            const g = svg.append("g")
                .attr("transform", `translate(${margin.left},${margin.top})`);

            // Set up y-axis scale based on time ranks (samples at bottom)
            const uniqueTimes = [...new Set(data.data.nodes.map(n => n.time))].sort((a, b) => a - b);
            const timeToRank = new Map(uniqueTimes.map((time, i) => [time, i]));
            const maxRank = uniqueTimes.length - 1;
            
            const yScale = d3.scaleLinear()
                .domain([0, maxRank])
                .range([height - 50, 50]); // Samples (rank 0) at bottom

            // Helper function declarations (moved to top to avoid hoisting issues)
            
            // Calculate optimal sample ordering based on shared ancestry
            const calculateSampleOrdering = (nodes: StaticNode[], links: PrettyArgLink[]): StaticNode[] => {
                const sampleNodes = nodes.filter(n => n.ts_flags & 1); // NODE_IS_SAMPLE = 1
                
                if (sampleNodes.length <= 2) return sampleNodes;
                
                // Build adjacency information for ancestry analysis
                const parentMap = new Map<number, number[]>();
                const childMap = new Map<number, number[]>();
                
                for (const link of links) {
                    if (!parentMap.has(link.source)) parentMap.set(link.source, []);
                    if (!childMap.has(link.target)) childMap.set(link.target, []);
                    parentMap.get(link.source)!.push(link.target);
                    childMap.get(link.target)!.push(link.source);
                }
                
                // Calculate pairwise MRCA depths between samples
                const calculateMRCADepth = (sample1: StaticNode, sample2: StaticNode): number => {
                    // Simple heuristic: find common ancestors and return the depth of the closest one
                    const ancestors1 = new Set<number>();
                    const ancestors2 = new Set<number>();
                    
                    // Collect ancestors for sample1
                    const queue1 = [sample1.id];
                    let depth1 = 0;
                    while (queue1.length > 0 && depth1 < 10) { // Limit depth to prevent infinite loops
                        const nextQueue: number[] = [];
                        for (const nodeId of queue1) {
                            ancestors1.add(nodeId);
                            const parents = childMap.get(nodeId) || [];
                            nextQueue.push(...parents);
                        }
                        queue1.length = 0;
                        queue1.push(...nextQueue);
                        depth1++;
                    }
                    
                    // Find first common ancestor for sample2
                    const queue2 = [sample2.id];
                    let depth2 = 0;
                    while (queue2.length > 0 && depth2 < 10) {
                        const nextQueue: number[] = [];
                        for (const nodeId of queue2) {
                            if (ancestors1.has(nodeId)) {
                                return depth1 + depth2; // Found MRCA
                            }
                            ancestors2.add(nodeId);
                            const parents = childMap.get(nodeId) || [];
                            nextQueue.push(...parents);
                        }
                        queue2.length = 0;
                        queue2.push(...nextQueue);
                        depth2++;
                    }
                    
                    return 20; // No MRCA found within depth limit, assume distant
                };
                
                // Create distance matrix
                const distanceMatrix: number[][] = [];
                for (let i = 0; i < sampleNodes.length; i++) {
                    distanceMatrix[i] = [];
                    for (let j = 0; j < sampleNodes.length; j++) {
                        if (i === j) {
                            distanceMatrix[i][j] = 0;
                        } else {
                            distanceMatrix[i][j] = calculateMRCADepth(sampleNodes[i], sampleNodes[j]);
                        }
                    }
                }
                
                // Use greedy clustering approach to order samples
                const orderedSamples: StaticNode[] = [];
                const used = new Set<number>();
                
                // Start with the sample that has the minimum average distance to others
                let bestStart = 0;
                let minAvgDistance = Infinity;
                for (let i = 0; i < sampleNodes.length; i++) {
                    const avgDistance = distanceMatrix[i].reduce((sum, d) => sum + d, 0) / sampleNodes.length;
                    if (avgDistance < minAvgDistance) {
                        minAvgDistance = avgDistance;
                        bestStart = i;
                    }
                }
                
                orderedSamples.push(sampleNodes[bestStart]);
                used.add(bestStart);
                
                // Greedily add the closest remaining sample
                while (orderedSamples.length < sampleNodes.length) {
                    const lastIdx = sampleNodes.indexOf(orderedSamples[orderedSamples.length - 1]);
                    let bestNext = -1;
                    let minDistance = Infinity;
                    
                    for (let i = 0; i < sampleNodes.length; i++) {
                        if (!used.has(i)) {
                            const distance = distanceMatrix[lastIdx][i];
                            if (distance < minDistance) {
                                minDistance = distance;
                                bestNext = i;
                            }
                        }
                    }
                    
                    if (bestNext !== -1) {
                        orderedSamples.push(sampleNodes[bestNext]);
                        used.add(bestNext);
                    } else {
                        // Fallback: add any remaining sample
                        for (let i = 0; i < sampleNodes.length; i++) {
                            if (!used.has(i)) {
                                orderedSamples.push(sampleNodes[i]);
                                used.add(i);
                                break;
                            }
                        }
                    }
                }
                
                return orderedSamples;
            };

            // Position nodes with fixed y coordinates based on time ranks
            const initialNodes: StaticNode[] = data.data.nodes.map(node => {
                const rank = timeToRank.get(node.time) || 0;
                return {
                    ...node,
                    x: node.x || width / 2,
                    y: yScale(rank)
                };
            });

            // Apply optimal sample ordering based on shared ancestry
            const orderedSamples = calculateSampleOrdering(initialNodes, data.data.links);
            if (orderedSamples.length > 0) {
                const sampleSpacing = width / (orderedSamples.length + 1);
                orderedSamples.forEach((node, i) => {
                    node.x = (i + 1) * sampleSpacing;
                });
            }

            // Position non-sample nodes based on their children's average x position
            const nodeMap = new Map(initialNodes.map(n => [n.id, n]));
            const positioned = new Set(orderedSamples.map(n => n.id));
            
            // Process nodes from bottom to top (samples to root)
            for (let rank = 1; rank <= maxRank; rank++) {
                const rankNodes = initialNodes.filter(n => timeToRank.get(n.time) === rank);
                
                for (const node of rankNodes) {
                    if (positioned.has(node.id)) continue;
                    
                    // Find children that are already positioned
                    const children = data.data.links
                        .filter(link => link.source === node.id)
                        .map(link => nodeMap.get(link.target))
                        .filter((child): child is StaticNode => child !== undefined && positioned.has(child.id));
                    
                    if (children.length > 0) {
                        // Position above the average of children
                        node.x = children.reduce((sum, child) => sum + child.x, 0) / children.length;
                    } else {
                        // Default positioning if no positioned children
                        node.x = width / 2;
                    }
                    
                    positioned.add(node.id);
                }
            }

            // Create background
            g.append("rect")
                .attr("width", width)
                .attr("height", height)
                .attr("fill", "white")
                .attr("stroke", "#e0e0e0")
                .attr("stroke-width", 1);

            // Add title
            if (data.title) {
                svg.append("text")
                    .attr("x", (width + margin.left + margin.right) / 2)
                    .attr("y", 30)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "18px")
                    .attr("font-weight", "bold")
                    .attr("fill", "#2c3e50")
                    .text(data.title);
            }

            // Add Y-axis if enabled
            if (data.y_axis.include_labels) {
                const yAxisScale = d3.scaleLinear()
                    .domain([0, maxRank])
                    .range([height - 50, 50]);

                const yAxis = d3.axisLeft(yAxisScale)
                    .tickValues(uniqueTimes.map((_, i) => i))
                    .tickFormat((d) => {
                        const timeIndex = d as number;
                        return uniqueTimes[timeIndex]?.toFixed(2) || '';
                    });

                g.append("g")
                    .attr("class", "y-axis")
                    .call(yAxis)
                    .selectAll("text")
                    .attr("font-size", "12px")
                    .attr("fill", "#2c3e50");

                // Y-axis label
                g.append("text")
                    .attr("transform", "rotate(-90)")
                    .attr("y", -50)
                    .attr("x", -height / 2)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "14px")
                    .attr("font-weight", "bold")
                    .attr("fill", "#2c3e50")
                    .text("Time");
            }

            // Add tree highlighting rectangles at bottom
            if (data.tree_highlighting && data.data.breakpoints.length > 0) {
                const treeRects = g.append("g")
                    .attr("class", "tree-highlighting")
                    .attr("transform", `translate(0, ${height - 40})`);

                treeRects.selectAll(".tree-rect")
                    .data(data.data.breakpoints)
                    .enter()
                    .append("rect")
                    .attr("class", "tree-rect")
                    .attr("x", d => d.x_pos_01 * width)
                    .attr("y", 0)
                    .attr("width", d => d.width_01 * width)
                    .attr("height", 20)
                    .attr("fill", "#f8f9fa")
                    .attr("stroke", "#dee2e6")
                    .attr("stroke-width", 1)
                    .on("mouseover", function(event, d) {
                        d3.select(this).attr("fill", "#e9ecef");
                        
                        // Highlight corresponding edges
                        g.selectAll(".link")
                            .attr("opacity", function() {
                                const linkData = d3.select(this).datum() as PrettyArgLink;
                                const bounds = linkData.bounds.split(" ");
                                const overlaps = bounds.some((bound: string) => {
                                    const [start, end] = bound.split("-").map(Number);
                                    return start < d.stop && end > d.start;
                                });
                                return overlaps ? 1 : 0.2;
                            });
                    })
                    .on("mouseout", function() {
                        d3.select(this).attr("fill", "#f8f9fa");
                        g.selectAll(".link").attr("opacity", 1);
                    });

                // Tree highlighting label
                g.append("text")
                    .attr("x", width / 2)
                    .attr("y", height - 15)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "12px")
                    .attr("fill", "#6c757d")
                    .text("Tree Intervals");
            }

            // Function to find all descendants of a node
            const findDescendants = (nodeId: number, links: PrettyArgLink[]): Set<number> => {
                const descendants = new Set<number>();
                const queue = [nodeId];
                
                while (queue.length > 0) {
                    const currentNode = queue.shift()!;
                    const children = links
                        .filter(link => link.source === currentNode)
                        .map(link => link.target);
                    
                    for (const child of children) {
                        if (!descendants.has(child)) {
                            descendants.add(child);
                            queue.push(child);
                        }
                    }
                }
                
                return descendants;
            };

            // Function to calculate optimal label position to avoid paths
            const calculateLabelPosition = (node: StaticNode, nodeMap: Map<number, StaticNode>, links: PrettyArgLink[]): { dx: number, dy: number } => {
                const nodeX = node.x;
                const nodeY = node.y;
                const radius = 20; // Distance from node center
                
                // Get all connected edges to this node
                const connectedEdges = links.filter(link => link.source === node.id || link.target === node.id);
                
                // Calculate occupied angles by connected edges
                const occupiedAngles: number[] = [];
                for (const edge of connectedEdges) {
                    const otherNodeId = edge.source === node.id ? edge.target : edge.source;
                    const otherNode = nodeMap.get(otherNodeId);
                    if (otherNode) {
                        const angle = Math.atan2(otherNode.y - nodeY, otherNode.x - nodeX);
                        occupiedAngles.push(angle);
                    }
                }
                
                // Find the best angle for label placement (avoiding connections)
                const candidateAngles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2, -Math.PI/4];
                let bestAngle = candidateAngles[0];
                let maxDistance = -1;
                
                for (const candidate of candidateAngles) {
                    let minDistanceToOccupied = Math.PI; // Max possible distance
                    for (const occupied of occupiedAngles) {
                        const distance = Math.abs(candidate - occupied);
                        minDistanceToOccupied = Math.min(minDistanceToOccupied, distance);
                    }
                    
                    if (minDistanceToOccupied > maxDistance) {
                        maxDistance = minDistanceToOccupied;
                        bestAngle = candidate;
                    }
                }
                
                return {
                    dx: Math.cos(bestAngle) * radius,
                    dy: Math.sin(bestAngle) * radius
                };
            };

            // Enhanced path routing with crossing minimization
            const calculateOptimalPathWithCrossingMin = (
                link: PrettyArgLink, 
                allLinks: PrettyArgLink[], 
                nodeMap: Map<number, StaticNode>
            ): string => {
                const sourceNode = nodeMap.get(link.source);
                const targetNode = nodeMap.get(link.target);
                
                if (!sourceNode || !targetNode) return '';

                const x1 = sourceNode.x;
                const y1 = sourceNode.y;
                const x2 = targetNode.x;
                const y2 = targetNode.y;

                if (edgeType === 'line') {
                    return `M${x1},${y1} L${x2},${y2}`;
                }

                // For orthogonal routing, consider multiple path options
                const dx = x2 - x1;
                const dy = y2 - y1;
                
                // If nodes are aligned, use direct path
                if (Math.abs(dx) < 5) {
                    return `M${x1},${y1} L${x1},${y2} L${x2},${y2}`;
                }
                if (Math.abs(dy) < 5) {
                    return `M${x1},${y1} L${x2},${y1} L${x2},${y2}`;
                }
                
                // Check connection types for special routing rules
                const targetIsSample = targetNode.ts_flags & 1;
                const targetParentCount = allLinks.filter(l => l.target === targetNode.id).length;
                const sourceChildCount = allLinks.filter(l => l.source === sourceNode.id).length;
                
                // Path options
                const pathOption1 = `M${x1},${y1} L${x2},${y1} L${x2},${y2}`; // Horizontal first
                const pathOption2 = `M${x1},${y1} L${x1},${y2} L${x2},${y2}`; // Vertical first
                
                // Apply special rules for samples and single connections
                if (targetIsSample || targetParentCount === 1) {
                    return pathOption1; // Horizontal first, then vertical to target
                }
                
                if (sourceChildCount === 1) {
                    return pathOption1;
                }
                
                // For other cases, use crossing minimization
                const option1Crossings = calculatePathCrossings(
                    [{x: x1, y: y1}, {x: x2, y: y1}, {x: x2, y: y2}], 
                    allLinks.filter(l => l.id !== link.id), 
                    nodeMap
                );
                
                const option2Crossings = calculatePathCrossings(
                    [{x: x1, y: y1}, {x: x1, y: y2}, {x: x2, y: y2}], 
                    allLinks.filter(l => l.id !== link.id), 
                    nodeMap
                );
                
                // Choose path with fewer crossings
                if (option1Crossings < option2Crossings) {
                    return pathOption1;
                } else if (option2Crossings < option1Crossings) {
                    return pathOption2;
                } else {
                    // If equal crossings, prefer based on direction
                    const isUpward = y2 < y1;
                    return isUpward ? pathOption1 : pathOption2;
                }
            };

            // Calculate actual path crossings (more accurate than previous conflict score)
            const calculatePathCrossings = (
                pathPoints: {x: number, y: number}[], 
                otherLinks: PrettyArgLink[], 
                nodeMap: Map<number, StaticNode>
            ): number => {
                let crossings = 0;
                
                for (let i = 0; i < pathPoints.length - 1; i++) {
                    const segment1 = {
                        start: pathPoints[i],
                        end: pathPoints[i + 1]
                    };
                    
                    for (const otherLink of otherLinks) {
                        const otherSource = nodeMap.get(otherLink.source);
                        const otherTarget = nodeMap.get(otherLink.target);
                        
                        if (!otherSource || !otherTarget) continue;
                        
                        // Calculate other path using same logic
                        const otherPath = calculateOptimalPathWithCrossingMin(otherLink, [], nodeMap);
                        const otherPoints = parsePathToPoints(otherPath);
                        
                        // Check crossings with each segment of other path
                        for (let j = 0; j < otherPoints.length - 1; j++) {
                            const segment2 = {
                                start: otherPoints[j],
                                end: otherPoints[j + 1]
                            };
                            
                            if (segmentsIntersect(segment1, segment2)) {
                                crossings += 1;
                            }
                        }
                    }
                }
                
                return crossings;
            };

            // Parse SVG path to points
            const parsePathToPoints = (pathString: string): {x: number, y: number}[] => {
                const points: {x: number, y: number}[] = [];
                const commands = pathString.match(/[ML]\s*[\d.-]+\s*,\s*[\d.-]+/g) || [];
                
                for (const command of commands) {
                    const coords = command.match(/[\d.-]+/g);
                    if (coords && coords.length >= 2) {
                        points.push({
                            x: parseFloat(coords[0]),
                            y: parseFloat(coords[1])
                        });
                    }
                }
                
                return points;
            };

            // Check if two line segments intersect
            const segmentsIntersect = (
                seg1: {start: {x: number, y: number}, end: {x: number, y: number}},
                seg2: {start: {x: number, y: number}, end: {x: number, y: number}}
            ): boolean => {
                const {start: p1, end: p2} = seg1;
                const {start: p3, end: p4} = seg2;
                
                const det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
                if (Math.abs(det) < 1e-10) return false; // Parallel lines
                
                const u = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / det;
                const v = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / det;
                
                return u >= 0 && u <= 1 && v >= 0 && v <= 1;
            };

            // Final nodes array for rendering
            const nodes = initialNodes;

            // Create links with optimized path routing
            const link = g.append("g")
                .attr("class", "links")
                .selectAll(".link")
                .data(data.data.links)
                .enter()
                .append("path")
                .attr("class", "link")
                .attr("d", d => calculateOptimalPathWithCrossingMin(d, data.data.links, nodeMap))
                .attr("stroke", d => d.color)
                .attr("stroke-width", d => data.edges.variable_width ? Math.max(1, d.region_fraction * 10) : 2)
                .attr("stroke-opacity", 0.8)
                .attr("fill", "none");

            // Helper function to get current filename
            const getCurrentFilename = () => {
                const currentPath = window.location.pathname;
                const matches = currentPath.match(/\/visualize-pretty\/(.+)/);
                return matches ? decodeURIComponent(matches[1]) : '';
            };

            // Function to update all paths when nodes move
            const updateAllPaths = () => {
                link.attr("d", d => calculateOptimalPathWithCrossingMin(d, data.data.links, nodeMap));
            };

            // Create node symbols with enhanced drag functionality and Pretty ARG navigation
            const node = g.append("g")
                .attr("class", "nodes")
                .selectAll(".node")
                .data(nodes)
                .enter()
                .append("g")
                .attr("class", "node")
                .attr("transform", d => `translate(${d.x},${d.y})`)
                .style("cursor", "pointer")
                .call(d3.drag<SVGGElement, StaticNode>()
                    .on("start", function(event, d) {
                        d3.select(this).style("cursor", "grabbing");
                        event.sourceEvent.stopPropagation(); // Prevent zoom on drag
                    })
                    .on("drag", function(event, d) {
                        // Lock to Y-axis - only allow horizontal movement
                        const newX = Math.max(0, Math.min(width, event.x));
                        const deltaX = newX - d.x;
                        d.x = newX;
                        // Keep Y position fixed (Y-axis locked)
                        
                        // Find all descendants of this node
                        const descendants = findDescendants(d.id, data.data.links);
                        
                        // Move all descendant nodes with the same deltaX
                        for (const descendantId of descendants) {
                            const descendantNode = nodeMap.get(descendantId);
                            if (descendantNode) {
                                descendantNode.x = Math.max(0, Math.min(width, descendantNode.x + deltaX));
                                
                                // Update descendant node visual position
                                node.filter((nodeData: StaticNode) => nodeData.id === descendantId)
                                    .attr("transform", `translate(${descendantNode.x},${descendantNode.y})`);
                            }
                        }
                        
                        // Update current node position
                        d3.select(this).attr("transform", `translate(${d.x},${d.y})`);
                        
                        // Update all connected paths with optimized routing
                        updateAllPaths();
                        
                        // Update label positions for moved nodes
                        if (data.nodes.include_labels) {
                            // Update label for current node
                            const labelPos = calculateLabelPosition(d, nodeMap, data.data.links);
                            d3.select(this).select("text")
                                .attr("dx", labelPos.dx)
                                .attr("dy", labelPos.dy + 5);
                            
                            // Update labels for descendant nodes
                            for (const descendantId of descendants) {
                                const descendantNode = nodeMap.get(descendantId);
                                if (descendantNode) {
                                    const descendantLabelPos = calculateLabelPosition(descendantNode, nodeMap, data.data.links);
                                    node.filter((nodeData: StaticNode) => nodeData.id === descendantId)
                                        .select("text")
                                        .attr("dx", descendantLabelPos.dx)
                                        .attr("dy", descendantLabelPos.dy + 5);
                                }
                            }
                        }
                    })
                    .on("end", function(event, d) {
                        d3.select(this).style("cursor", "pointer");
                    })
                )
                .on("click", function(event, d) {
                    event.stopPropagation();
                    const filename = getCurrentFilename();
                    
                    if (event.button === 0) { // Left click
                        // Navigate to Pretty ARG subgraph view - show descendants of this node
                        console.log(`Left click on node ${d.id} - showing Pretty ARG subgraph`);
                        navigate(`/visualize-pretty/${encodeURIComponent(filename)}?focus=${d.id}&mode=subgraph`);
                    }
                })
                .on("contextmenu", function(event, d) {
                    event.preventDefault();
                    event.stopPropagation();
                    const filename = getCurrentFilename();
                    
                    // Right click - navigate to Pretty ARG parent graph view
                    console.log(`Right click on node ${d.id} - showing Pretty ARG parent graph`);
                    navigate(`/visualize-pretty/${encodeURIComponent(filename)}?focus=${d.id}&mode=parent`);
                });

            // Add symbols to nodes
            node.append("path")
                .attr("d", d => {
                    const isSample = d.ts_flags & 1; // NODE_IS_SAMPLE = 1
                    const isRecombination = d.ts_flags & 131072; // NODE_IS_RE_EVENT
                    const size = d.size || (isSample ? 200 : 150);
                    
                    if (isSample) {
                        // Square for samples
                        const halfSize = Math.sqrt(size) / 2;
                        return `M${-halfSize},${-halfSize}L${halfSize},${-halfSize}L${halfSize},${halfSize}L${-halfSize},${halfSize}Z`;
                    } else if (isRecombination) {
                        // Diamond for recombination nodes
                        const halfSize = Math.sqrt(size) / 2;
                        return `M0,${-halfSize}L${halfSize},0L0,${halfSize}L${-halfSize},0Z`;
                    } else {
                        // Circle for other nodes
                        return d3.symbol(d3.symbolCircle, size)();
                    }
                })
                .attr("fill", d => d.fill)
                .attr("stroke", d => d.stroke)
                .attr("stroke-width", d => d.stroke_width);

            // Add labels if enabled
            if (data.nodes.include_labels) {
                node.each(function(d) {
                    const labelPos = calculateLabelPosition(d, nodeMap, data.data.links);
                    d3.select(this).append("text")
                        .attr("dx", labelPos.dx)
                        .attr("dy", labelPos.dy + 5) // Slight vertical adjustment for better readability
                        .attr("font-size", "10px")
                        .attr("font-family", "Arial, sans-serif")
                        .attr("font-weight", "bold")
                        .attr("fill", "#2c3e50")
                        .attr("text-anchor", "middle")
                        .attr("stroke", "white")
                        .attr("stroke-width", "2")
                        .attr("paint-order", "stroke")
                        .text(d.label);
                });
            }

            // Add tooltips
            node.append("title")
                .text(d => `Node ${d.label}\nTime: ${d.time.toFixed(3)}\nFlags: ${d.ts_flags}\nLeft-click: Subgraph | Right-click: Parent graph`);

            // Hide context menu on any svg click
            svg.on("click", () => {
                setContextMenu(prev => ({ ...prev, visible: false }));
            });

            link.append("title")
                .text(d => {
                    const sourceNode = nodeMap.get(d.source);
                    const targetNode = nodeMap.get(d.target);
                    return `Edge ${sourceNode?.label || d.source} → ${targetNode?.label || d.target}\nRegions: ${d.bounds}\nFraction: ${(d.region_fraction * 100).toFixed(1)}%`;
                });

            // Add legend outside main visualization area
            const legend = g.append("g")
                .attr("class", "legend")
                .attr("transform", `translate(${width + 20}, 20)`); // Moved outside main area

            const legendData = [
                { type: "sample", label: "Sample", color: "#4ecdc4", shape: "square" },
                { type: "coalescence", label: "Coalescence", color: "#95a5a6", shape: "circle" },
                { type: "recombination", label: "Recombination", color: "#ff6b6b", shape: "diamond" }
            ];

            const legendItems = legend.selectAll(".legend-item")
                .data(legendData)
                .enter()
                .append("g")
                .attr("class", "legend-item")
                .attr("transform", (d, i) => `translate(0, ${i * 20})`);

            legendItems.append("path")
                .attr("d", d => {
                    const size = 100;
                    if (d.shape === "square") {
                        const halfSize = Math.sqrt(size) / 2;
                        return `M${-halfSize},${-halfSize}L${halfSize},${-halfSize}L${halfSize},${halfSize}L${-halfSize},${halfSize}Z`;
                    } else if (d.shape === "diamond") {
                        const halfSize = Math.sqrt(size) / 2;
                        return `M0,${-halfSize}L${halfSize},0L0,${halfSize}L${-halfSize},0Z`;
                    } else {
                        return d3.symbol(d3.symbolCircle, size)();
                    }
                })
                .attr("fill", d => d.color)
                .attr("stroke", "#2c3e50")
                .attr("stroke-width", 1);

            legendItems.append("text")
                .attr("x", 15)
                .attr("y", 5)
                .attr("font-size", "12px")
                .attr("font-family", "Arial, sans-serif")
                .attr("fill", "#2c3e50")
                .text(d => d.label);

        }, [data, genomicStart, genomicEnd, edgeType]);

        // Get current filename for navigation
        const getCurrentFilename = () => {
            const currentPath = window.location.pathname;
            const matches = currentPath.match(/\/visualize-pretty\/(.+)/);
            return matches ? decodeURIComponent(matches[1]) : '';
        };

        const handleBackToFullArg = () => {
            const filename = getCurrentFilename();
            if (filename) {
                // Navigate back to the base Pretty ARG view (not the default visualizer)
                navigate(`/visualize-pretty/${encodeURIComponent(filename)}`);
            }
        };

        return (
            <div ref={containerRef} className="w-full h-full relative">
                {/* Back to Full Pretty ARG Button */}
                <button
                    onClick={handleBackToFullArg}
                    className="absolute top-4 left-4 z-10 bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-3 py-2 rounded-lg text-sm transition-colors shadow-md"
                >
                    ← Back to Full Pretty ARG
                </button>

                {/* Toggle Controls Button */}
                <button
                    onClick={() => setShowControls(!showControls)}
                    className="absolute top-4 right-4 z-20 bg-gray-600 hover:bg-gray-700 text-white font-medium px-2 py-1 rounded text-xs transition-colors shadow-md"
                    title={showControls ? "Hide controls for publication" : "Show controls"}
                >
                    {showControls ? "Hide" : "Show"}
                </button>

                {/* Publication-ready controls panel - conditionally visible */}
                {showControls && (
                    <div className="absolute top-12 right-4 z-10 bg-white bg-opacity-90 backdrop-blur-sm border border-gray-300 rounded-lg p-3 text-xs max-w-xs shadow-md">
                        <h4 className="font-semibold text-gray-800 mb-2">Controls</h4>
                        <div className="space-y-1 text-gray-600">
                            <div>• Zoom: Mouse wheel or pinch</div>
                            <div>• Pan: Click and drag background</div>
                            <div>• Move nodes: Drag horizontally (Y-locked)</div>
                            <div>• Descendants move with parent</div>
                            <div>• Left-click node: Subgraph</div>
                            <div>• Right-click node: Parent graph</div>
                        </div>
                    </div>
                )}

                <svg
                    ref={(node) => {
                        if (node) {
                            svgRef.current = node;
                            if (ref) {
                                if (typeof ref === 'function') {
                                    ref(node);
                                } else {
                                    ref.current = node;
                                }
                            }
                        }
                    }}
                    className="w-full h-full"
                    style={{ background: 'white' }}
                />
            </div>
        );
    }
); 