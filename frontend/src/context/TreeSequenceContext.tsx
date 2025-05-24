import { createContext, useContext, useState, ReactNode } from 'react';

interface TreeSequenceData {
  filename: string;
  size: number;
  content_type: string;
  status: string;
  num_nodes: number;
  num_edges: number;
  num_samples: number;
  num_trees: number;
  num_mutations?: number;  // Optional - only present for simulations with mutations
  num_sites?: number;      // Optional - only present for simulations with mutations
  num_recombination_nodes?: number;  // Optional - only present for ARG simulations
  sequence_length?: number;
  has_temporal: boolean;
  has_sample_spatial: boolean;
  has_all_spatial: boolean;
  spatial_status: string;
}

interface TreeSequenceContextType {
  treeSequence: TreeSequenceData | null;
  setTreeSequence: (data: TreeSequenceData | null) => void;
  maxSamples: number;
  setMaxSamples: (value: number) => void;
}

const TreeSequenceContext = createContext<TreeSequenceContextType | undefined>(undefined);

export function TreeSequenceProvider({ children }: { children: ReactNode }) {
  const [treeSequence, setTreeSequence] = useState<TreeSequenceData | null>(null);
  const [maxSamples, setMaxSamples] = useState(25);

  // Custom setTreeSequence that also updates maxSamples appropriately
  const setTreeSequenceWithSamples = (data: TreeSequenceData | null) => {
    setTreeSequence(data);
    if (data?.num_samples) {
      // Set maxSamples to min(25, actual_samples), ensuring we don't exceed available samples
      const newMaxSamples = Math.min(25, data.num_samples);
      setMaxSamples(newMaxSamples);
    }
  };

  // Custom setMaxSamples that respects the current tree sequence sample limit
  const setMaxSamplesWithLimit = (value: number) => {
    if (treeSequence?.num_samples) {
      // Ensure value is between 2 and the actual number of samples
      const clampedValue = Math.max(2, Math.min(value, treeSequence.num_samples));
      setMaxSamples(clampedValue);
    } else {
      // If no tree sequence loaded, just use min(value, 25)
      setMaxSamples(Math.min(value, 25));
    }
  };

  return (
    <TreeSequenceContext.Provider 
      value={{ 
        treeSequence, 
        setTreeSequence: setTreeSequenceWithSamples, 
        maxSamples, 
        setMaxSamples: setMaxSamplesWithLimit 
      }}
    >
      {children}
    </TreeSequenceContext.Provider>
  );
}

export function useTreeSequence() {
  const context = useContext(TreeSequenceContext);
  if (context === undefined) {
    throw new Error('useTreeSequence must be used within a TreeSequenceProvider');
  }
  return context;
} 