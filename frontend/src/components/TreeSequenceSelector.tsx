import { useState, useEffect } from 'react';
import { useTreeSequence } from '../context/TreeSequenceContext';
import { api } from '../lib/api';
import { log } from '../lib/logger';

interface TreeSequenceInfo {
  filename: string;
  num_samples: number;
  num_nodes: number;
  num_edges: number;
  num_trees: number;
  has_temporal: boolean;
  has_sample_spatial: boolean;
  has_all_spatial: boolean;
  spatial_status: string;
}

interface TreeSequenceSelectorProps {
  onSelect: (treeSequence: TreeSequenceInfo) => void;
  className?: string;
}

export default function TreeSequenceSelector({ onSelect, className = '' }: TreeSequenceSelectorProps) {
  const [availableTreeSequences, setAvailableTreeSequences] = useState<string[]>([]);
  const [treeSequenceInfos, setTreeSequenceInfos] = useState<Record<string, TreeSequenceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>('');
  const { treeSequence: currentTreeSequence } = useTreeSequence();

  const fetchAvailableTreeSequences = async () => {
    setLoading(true);
    try {
      log.data.processing('fetch-available-tree-sequences', 'TreeSequenceSelector');
      const response = await api.getUploadedFiles();
      const data = response.data as { uploaded_tree_sequences: string[] };
      setAvailableTreeSequences(data.uploaded_tree_sequences || []);
      log.info(`Loaded ${data.uploaded_tree_sequences?.length || 0} tree sequences`, {
        component: 'TreeSequenceSelector',
        action: 'fetch-available'
      });
    } catch (error) {
      log.error('Failed to fetch available tree sequences', {
        component: 'TreeSequenceSelector',
        error: error instanceof Error ? error : new Error(String(error))
      });
      setAvailableTreeSequences([]);
    } finally {
      setLoading(false);
    }
  };

  const getTreeSequenceInfo = async (filename: string): Promise<TreeSequenceInfo | null> => {
    try {
      log.data.processing('fetch-metadata', 'TreeSequenceSelector', undefined, undefined);
      const response = await api.getTreeSequenceMetadata(filename);
      const data = response.data as TreeSequenceInfo;
      
      log.debug(`Retrieved metadata for ${filename}`, {
        component: 'TreeSequenceSelector',
        data: { filename, num_samples: data.num_samples, num_nodes: data.num_nodes }
      });
      
      return {
        filename: data.filename,
        num_samples: data.num_samples,
        num_nodes: data.num_nodes,
        num_edges: data.num_edges,
        num_trees: data.num_trees,
        has_temporal: data.has_temporal,
        has_sample_spatial: data.has_sample_spatial,
        has_all_spatial: data.has_all_spatial,
        spatial_status: data.spatial_status
      };
    } catch (error) {
      log.error(`Failed to get metadata for ${filename}`, {
        component: 'TreeSequenceSelector',
        error: error instanceof Error ? error : new Error(String(error)),
        data: { filename }
      });
      return null;
    }
  };

  useEffect(() => {
    fetchAvailableTreeSequences();
  }, []);

  useEffect(() => {
    // Fetch info for all available tree sequences
    const fetchAllInfos = async () => {
      const infos: Record<string, TreeSequenceInfo> = {};
      for (const filename of availableTreeSequences) {
        const info = await getTreeSequenceInfo(filename);
        if (info) {
          infos[filename] = info;
        }
      }
      setTreeSequenceInfos(infos);
    };

    if (availableTreeSequences.length > 0) {
      fetchAllInfos();
    }
  }, [availableTreeSequences]);

  const handleSelect = () => {
    if (selectedFilename && treeSequenceInfos[selectedFilename]) {
      onSelect(treeSequenceInfos[selectedFilename]);
    }
  };

  const handleDelete = async (filename: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    if (!window.confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }

    try {
      log.user.action('delete-tree-sequence', { filename }, 'TreeSequenceSelector');
      const response = await api.deleteTreeSequence(filename);
      
      log.info(`Successfully deleted tree sequence: ${filename}`, {
        component: 'TreeSequenceSelector',
        data: { filename }
      });

      // Remove from local state
      setAvailableTreeSequences(prev => prev.filter(f => f !== filename));
      setTreeSequenceInfos(prev => {
        const newInfos = { ...prev };
        delete newInfos[filename];
        return newInfos;
      });

      // Clear selection if the deleted file was selected
      if (selectedFilename === filename) {
        setSelectedFilename('');
      }

      alert(`Successfully deleted "${filename}"`);
    } catch (error) {
      log.error('Failed to delete tree sequence', {
        component: 'TreeSequenceSelector',
        error: error instanceof Error ? error : new Error(String(error)),
        data: { filename }
      });
      alert(`Failed to delete tree sequence: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-sp-pale-green"></div>
      </div>
    );
  }

  if (availableTreeSequences.length === 0) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <p className="text-sp-white text-lg mb-4">No existing tree sequences found</p>
        <button 
          onClick={fetchAvailableTreeSequences}
          className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-4">
        <h3 className="text-xl font-semibold mb-4 text-sp-white">Select Existing Tree Sequence</h3>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {availableTreeSequences.map((filename) => {
            const info = treeSequenceInfos[filename];
            const isCurrentlySelected = currentTreeSequence?.filename === filename;
            const isSelected = selectedFilename === filename;
            
            return (
              <div
                key={filename}
                className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                  isSelected 
                    ? 'border-sp-pale-green bg-sp-dark-blue' 
                    : 'border-sp-dark-blue bg-sp-very-dark-blue hover:border-sp-pale-green'
                } ${isCurrentlySelected ? 'ring-2 ring-sp-pale-green' : ''}`}
                onClick={() => setSelectedFilename(filename)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sp-pale-green text-sm truncate">
                        {filename}
                      </span>
                      {isCurrentlySelected && (
                        <span className="text-xs bg-sp-pale-green text-sp-very-dark-blue px-2 py-1 rounded font-medium">
                          Current
                        </span>
                      )}
                    </div>
                    {info ? (
                      <div className="text-xs text-sp-white space-y-1">
                        <div>{info.num_samples} samples, {info.num_nodes} nodes</div>
                        <div>{info.num_edges} edges, {info.num_trees} trees</div>
                      </div>
                    ) : (
                      <div className="text-xs text-sp-white">Loading info...</div>
                    )}
                  </div>
                  <button
                    onClick={(e) => handleDelete(filename, e)}
                    className="ml-2 text-red-400 hover:text-red-300 text-sm font-medium px-2 py-1 rounded transition-colors"
                    title="Delete tree sequence"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSelect}
          disabled={!selectedFilename || !treeSequenceInfos[selectedFilename]}
          className="flex-1 bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 rounded-lg transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Load Selected
        </button>
        <button
          onClick={fetchAvailableTreeSequences}
          className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>
    </div>
  );
} 