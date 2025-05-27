/**
 * Centralized API service
 * Provides consistent API calls with error handling and logging
 */

import { API_CONFIG, ERROR_MESSAGES } from '../config/constants';
import { log } from './logger';

interface ApiResponse<T = unknown> {
  data: T;
  status: number;
}

interface ApiError {
  message: string;
  status?: number;
  details?: string;
}

class ApiService {
  private baseURL: string;

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    const method = options.method || 'GET';

    log.api.call(endpoint, method, options.body);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const error: ApiError = {
          message: `HTTP error! status: ${response.status}`,
          status: response.status,
          details: errorData?.detail || 'No details available',
        };
        
        log.api.error(endpoint, new Error(error.message), method);
        throw error;
      }

      const data = await response.json();
      log.api.success(endpoint, method, data);
      
      return { data, status: response.status };
    } catch (error) {
      if (error instanceof Error) {
        log.api.error(endpoint, error, method);
        throw error;
      }
      
      const apiError: ApiError = {
        message: ERROR_MESSAGES.UNKNOWN_ERROR,
        details: String(error),
      };
      
      log.api.error(endpoint, new Error(apiError.message), method);
      throw apiError;
    }
  }

  private async uploadFile(endpoint: string, file: File): Promise<ApiResponse> {
    const url = `${this.baseURL}${endpoint}`;
    const formData = new FormData();
    formData.append('file', file);

    log.api.call(endpoint, 'POST', { filename: file.name, size: file.size });

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(ERROR_MESSAGES.UPLOAD_FAILED);
      }

      const data = await response.json();
      log.api.success(endpoint, 'POST', data);
      
      return { data, status: response.status };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : ERROR_MESSAGES.UPLOAD_FAILED;
      log.api.error(endpoint, new Error(errorMsg), 'POST');
      throw error;
    }
  }

  // Tree sequence operations
  async uploadTreeSequence(file: File) {
    return this.uploadFile(API_CONFIG.ENDPOINTS.UPLOAD, file);
  }

  async getUploadedFiles() {
    return this.request(API_CONFIG.ENDPOINTS.UPLOADED_FILES);
  }

  async getTreeSequenceMetadata(filename: string) {
    return this.request(`${API_CONFIG.ENDPOINTS.TREE_SEQUENCE_METADATA}/${encodeURIComponent(filename)}`);
  }

  async deleteTreeSequence(filename: string) {
    return this.request(`${API_CONFIG.ENDPOINTS.DELETE_TREE_SEQUENCE}/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  }

  async downloadTreeSequence(filename: string): Promise<Blob> {
    const url = `${this.baseURL}${API_CONFIG.ENDPOINTS.DOWNLOAD_TREE_SEQUENCE}/${encodeURIComponent(filename)}`;
    
    log.api.call(API_CONFIG.ENDPOINTS.DOWNLOAD_TREE_SEQUENCE, 'GET', { filename });
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(ERROR_MESSAGES.DOWNLOAD_FAILED);
      }
      
      const blob = await response.blob();
      log.api.success(API_CONFIG.ENDPOINTS.DOWNLOAD_TREE_SEQUENCE, 'GET', { size: blob.size });
      
      return blob;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : ERROR_MESSAGES.DOWNLOAD_FAILED;
      log.api.error(API_CONFIG.ENDPOINTS.DOWNLOAD_TREE_SEQUENCE, new Error(errorMsg), 'GET');
      throw error;
    }
  }

  // Data retrieval
  async getGraphData(
    filename: string,
    options: {
      maxSamples?: number;
      genomicStart?: number;
      genomicEnd?: number;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (options.maxSamples) params.append('max_samples', options.maxSamples.toString());
    if (options.genomicStart !== undefined) params.append('genomic_start', options.genomicStart.toString());
    if (options.genomicEnd !== undefined) params.append('genomic_end', options.genomicEnd.toString());
    
    const endpoint = `${API_CONFIG.ENDPOINTS.GRAPH_DATA}/${encodeURIComponent(filename)}?${params}`;
    return this.request(endpoint);
  }

  async getPrettyArgData(
    filename: string,
    options: {
      maxSamples?: number;
      focus?: number;
      mode?: string;
    } = {}
  ) {
    const params = new URLSearchParams();
    if (options.maxSamples) params.append('max_samples', options.maxSamples.toString());
    if (options.focus !== undefined) params.append('focus', options.focus.toString());
    if (options.mode) params.append('mode', options.mode);
    
    const endpoint = `${API_CONFIG.ENDPOINTS.PRETTY_ARG_DATA}/${encodeURIComponent(filename)}?${params}`;
    return this.request(endpoint);
  }

  // Simulations
  async simulateSpargviz(params: {
    num_samples: number;
    num_trees: number;
    spatial_dims: number;
    num_generations: number;
    x_range: number;
    y_range?: number | null;
    recombination_probability: number;
    coalescence_rate: number;
    edge_density: number;
  }) {
    return this.request(API_CONFIG.ENDPOINTS.SIMULATE_SPARGVIZ, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async simulateMsprime(params: {
    sample_number: number;
    spatial_dimensions: number;
    spatial_boundary_size: number[];
    dispersal_range: number;
    local_trees: number;
    generations: number;
  }) {
    return this.request(API_CONFIG.ENDPOINTS.SIMULATE_MSPRIME, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // Location inference
  async inferLocationsFast(params: {
    filename: string;
    weight_span: boolean;
    weight_branch_length: boolean;
  }) {
    return this.request(API_CONFIG.ENDPOINTS.INFER_LOCATIONS_FAST, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

// Create singleton instance
export const apiService = new ApiService();

// Export convenience functions
export const api = {
  // Tree sequence operations
  uploadTreeSequence: (file: File) => apiService.uploadTreeSequence(file),
  getUploadedFiles: () => apiService.getUploadedFiles(),
  getTreeSequenceMetadata: (filename: string) => apiService.getTreeSequenceMetadata(filename),
  deleteTreeSequence: (filename: string) => apiService.deleteTreeSequence(filename),
  downloadTreeSequence: (filename: string) => apiService.downloadTreeSequence(filename),
  
  // Data retrieval
  getGraphData: (filename: string, options?: Parameters<typeof apiService.getGraphData>[1]) => 
    apiService.getGraphData(filename, options),
  getPrettyArgData: (filename: string, options?: Parameters<typeof apiService.getPrettyArgData>[1]) => 
    apiService.getPrettyArgData(filename, options),
  
  // Simulations
  simulateSpargviz: (params: Parameters<typeof apiService.simulateSpargviz>[0]) => 
    apiService.simulateSpargviz(params),
  simulateMsprime: (params: Parameters<typeof apiService.simulateMsprime>[0]) => 
    apiService.simulateMsprime(params),
  
  // Location inference
  inferLocationsFast: (params: Parameters<typeof apiService.inferLocationsFast>[0]) => 
    apiService.inferLocationsFast(params),
}; 