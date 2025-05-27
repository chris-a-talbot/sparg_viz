/**
 * Data formatting utilities
 * Centralized formatting functions for consistent data display
 */

import { DATA_FORMAT } from '../config/constants';

/**
 * Format large numbers with K/M suffixes
 */
export function formatNumber(value: number): string {
  if (value >= DATA_FORMAT.MILLION_THRESHOLD) {
    return `${(value / DATA_FORMAT.MILLION_THRESHOLD).toFixed(DATA_FORMAT.DECIMAL_PLACES)}M`;
  } else if (value >= DATA_FORMAT.THOUSAND_THRESHOLD) {
    return `${(value / DATA_FORMAT.THOUSAND_THRESHOLD).toFixed(DATA_FORMAT.DECIMAL_PLACES)}K`;
  }
  return value.toString();
}

/**
 * Format percentage values
 */
export function formatPercentage(value: number, total: number): string {
  const percentage = (value / total * 100).toFixed(DATA_FORMAT.PERCENTAGE_PRECISION);
  return `${percentage}%`;
}

/**
 * Format decimal values with consistent precision
 */
export function formatDecimal(value: number, precision: number = DATA_FORMAT.DECIMAL_PLACES): string {
  return value.toFixed(precision);
}

/**
 * Format file sizes in bytes
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(DATA_FORMAT.DECIMAL_PLACES)} ${units[unitIndex]}`;
}

/**
 * Format time values (in seconds) to human readable format
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Format node counts for display
 */
export function formatNodeCount(count: number, type: string): string {
  return `${formatNumber(count)} ${type}${count !== 1 ? 's' : ''}`;
}

/**
 * Format genomic coordinates
 */
export function formatGenomicCoordinate(position: number, isInteger: boolean = false): string {
  if (isInteger || (Math.abs(position - Math.round(position)) < 1e-10)) {
    return Math.round(position).toString();
  }
  return position.toFixed(DATA_FORMAT.DECIMAL_PLACES);
}

/**
 * Format genomic ranges
 */
export function formatGenomicRange(start: number, end: number): string {
  return `${formatGenomicCoordinate(start)}-${formatGenomicCoordinate(end)}`;
}

/**
 * Format tree sequence metadata for display
 */
export function formatTreeSequenceInfo(metadata: {
  num_samples: number;
  num_nodes: number;
  num_edges: number;
  num_trees: number;
  num_mutations?: number;
  num_sites?: number;
  num_recombination_nodes?: number;
}): string {
  const parts = [
    formatNodeCount(metadata.num_samples, 'sample'),
    formatNodeCount(metadata.num_nodes, 'node'),
    formatNodeCount(metadata.num_edges, 'edge'),
    formatNodeCount(metadata.num_trees, 'local tree')
  ];

  if (metadata.num_mutations !== undefined) {
    parts.push(formatNodeCount(metadata.num_mutations, 'mutation'));
    if (metadata.num_sites !== undefined) {
      parts.push(`at ${formatNodeCount(metadata.num_sites, 'site')}`);
    }
  }

  if (metadata.num_recombination_nodes !== undefined && metadata.num_recombination_nodes > 0) {
    parts.push(formatNodeCount(metadata.num_recombination_nodes, 'recombination node'));
  }

  return parts.join(', ');
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format download filename
 */
export function formatDownloadFilename(filename: string, extension: string): string {
  const baseName = filename.toLowerCase().endsWith(extension) 
    ? filename 
    : `${filename}${extension}`;
  return baseName;
} 