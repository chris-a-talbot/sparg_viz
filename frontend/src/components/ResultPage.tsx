import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useTreeSequence } from '../context/TreeSequenceContext';
import StatusIcon from './StatusIcon';
import TreeSequenceSelector from './TreeSequenceSelector';

export default function ResultPage() {
  console.log('ResultPage rendered');
  const navigate = useNavigate();
  const { treeSequence: data, maxSamples, setMaxSamples, setTreeSequence } = useTreeSequence();
  const [totalSamples, setTotalSamples] = useState<number | null>(null);
  const [isInferringLocationsFast, setIsInferringLocationsFast] = useState(false);
  const [showTreeSequenceSelector, setShowTreeSequenceSelector] = useState(false);

  // Set total samples from the uploaded data
  useEffect(() => {
    if (data?.num_samples) {
      setTotalSamples(data.num_samples);
    }
  }, [data]);

  // Determine button states based on backend data
  const inferTimesEnabled = !data?.has_temporal;
  
  // Fast location inference is available for:
  // 1. ARGs with spatial info for samples but not all nodes (sample_only)
  // 2. ARGs with spatial info for all nodes (all) - for re-inference
  const fastLocationInferenceEnabled = data?.spatial_status === "sample_only" || data?.spatial_status === "all";
  
  const visualizeArgEnabled = true; // Always available if data loaded
  const visualizeSpatialArgEnabled = !!(data?.has_temporal && data?.has_all_spatial);  // Require temporal and all spatial

  // Determine button text for fast inference based on spatial status
  const getFastInferenceButtonText = () => {
    if (data?.spatial_status === "all") {
      return "Re-infer locations (fastGAIA)";
    } else {
      return "Infer locations (fastGAIA)";
    }
  };

  const handleFastLocationInference = async () => {
    if (!data?.filename || isInferringLocationsFast) return;

    setIsInferringLocationsFast(true);

    try {
      console.log('Starting fast location inference for file:', data.filename);

      const response = await fetch('http://localhost:8000/infer-locations-fast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: data.filename,
          weight_span: true,
          weight_branch_length: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          `HTTP error! status: ${response.status}\n` +
          `Details: ${errorData?.detail || 'No details available'}`
        );
      }

      const result = await response.json();
      console.log('Fast location inference completed:', result);

      // Update the tree sequence context with the new filename and spatial info
      const updatedData = {
        ...data,
        filename: result.new_filename,
        has_sample_spatial: result.has_sample_spatial,
        has_all_spatial: result.has_all_spatial,
        spatial_status: result.spatial_status,
      };

      setTreeSequence(updatedData);

      alert(`Fast location inference completed successfully!\nInferred locations for ${result.num_inferred_locations} nodes.\nNew file: ${result.new_filename}`);

    } catch (error) {
      console.error('Error during fast location inference:', error);
      alert(`Fast location inference failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsInferringLocationsFast(false);
    }
  };

  const handleTreeSequenceSelect = (treeSequence: any) => {
    console.log('Switching to tree sequence:', treeSequence);
    setTreeSequence(treeSequence);
    setShowTreeSequenceSelector(false);
  };

  if (!data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-sp-very-dark-blue text-sp-white">
        <h1 className="text-3xl font-bold mb-4">No data loaded</h1>
        <button className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 px-6 rounded-lg mt-4" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-sp-very-dark-blue text-sp-white px-4 py-8">
      <div className="w-full max-w-2xl bg-sp-very-dark-blue rounded-2xl shadow-xl border border-sp-dark-blue p-8 flex flex-col items-center">
        <div className="w-full flex justify-between items-center mb-4">
          <button className="text-sp-pale-green hover:text-sp-white text-lg font-medium px-2 py-1 rounded transition-colors" onClick={() => navigate('/')}>{'< Back'}</button>
          <div className="flex gap-2">
            <button 
              className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base transition-colors"
              onClick={() => setShowTreeSequenceSelector(!showTreeSequenceSelector)}
            >
              {showTreeSequenceSelector ? 'Cancel' : 'Switch Tree Sequence'}
            </button>
            <button className="bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base" onClick={async () => {
              const downloadUrl = `/download-tree-sequence/${data.filename}`;
              try {
                const response = await fetch(downloadUrl);
                if (!response.ok) {
                  throw new Error('Download failed');
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                const downloadFilename = data.filename.toLowerCase().endsWith('.trees') ? `${data.filename}.tsz` : data.filename;
                link.setAttribute('download', downloadFilename);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                console.log('Download button clicked for file:', data.filename);
              } catch (error) {
                console.error('Error downloading file:', error);
              }
            }}>Download .tsz</button>
          </div>
        </div>
        
        {/* Tree Sequence Selector */}
        {showTreeSequenceSelector && (
          <div className="w-full mb-8 p-4 bg-sp-dark-blue rounded-lg border border-sp-pale-green">
            <TreeSequenceSelector onSelect={handleTreeSequenceSelect} />
          </div>
        )}
        
        <h1 className="text-4xl font-bold mb-2">
          sp<span className="text-sp-pale-green">ARG</span>viz
        </h1>
        <div className="text-2xl font-semibold mt-2 mb-2 text-center">File: <span className="font-mono text-sp-pale-green">{data.filename}</span></div>
        <div className="text-lg mb-6 text-center">
          {data.num_samples} samples, {data.num_nodes} nodes, {data.num_edges} edges, {data.num_trees} local trees
          {data.num_mutations !== undefined && (
            <>
              <br />
              {data.num_mutations} mutations at {data.num_sites || 0} sites
            </>
          )}
          {data.num_recombination_nodes !== undefined && data.num_recombination_nodes > 0 && (
            <>
              <br />
              {data.num_recombination_nodes} recombination nodes
            </>
          )}
        </div>
        
        <div className="w-full flex flex-col gap-4 mb-8">
          <button
            className={`bg-sp-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base ${!inferTimesEnabled && 'opacity-50 cursor-not-allowed'}`}
            disabled={!inferTimesEnabled}
            onClick={() => console.log('Infer times button clicked')}
          >
            Infer times (tsdate)
          </button>
          <button
            className={`bg-sp-dark-blue text-sp-white font-medium px-4 py-2 rounded-lg text-base ${!fastLocationInferenceEnabled && 'opacity-50 cursor-not-allowed'} ${isInferringLocationsFast && 'opacity-75 cursor-not-allowed'}`}
            disabled={!fastLocationInferenceEnabled || isInferringLocationsFast}
            onClick={handleFastLocationInference}
          >
            <div className="flex items-center justify-center gap-2">
              {isInferringLocationsFast && (
                <div className="animate-spin rounded-full h-4 w-4 border border-sp-pale-green border-t-transparent"></div>
              )}
              <span>
                {isInferringLocationsFast ? 'Inferring...' : getFastInferenceButtonText()}
              </span>
            </div>
          </button>
        </div>

        <div className="w-full flex flex-col gap-4 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              className={`flex-1 min-w-[200px] bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-4 rounded-lg text-lg transition-colors shadow-md ${!visualizeArgEnabled && 'opacity-50 cursor-not-allowed'}`}
              disabled={!visualizeArgEnabled}
              onClick={() => navigate(`/visualize/${encodeURIComponent(data.filename)}`)}
            >
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold">Visualize ARG</span>
                <span className="text-xs mt-1 opacity-80">Interactive D3-based visualization</span>
              </div>
            </button>
            <button
              className={`flex-1 min-w-[200px] bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-4 rounded-lg text-lg transition-colors shadow-md ${!visualizeArgEnabled && 'opacity-50 cursor-not-allowed'}`}
              disabled={!visualizeArgEnabled}
              onClick={() => navigate(`/visualize-large/${encodeURIComponent(data.filename)}`)}
            >
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold">Large ARG</span>
                <span className="text-xs mt-1 opacity-80">High-performance WebGL visualization</span>
              </div>
            </button>
            <button
              className={`flex-1 min-w-[200px] bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-4 rounded-lg text-lg transition-colors shadow-md ${!visualizeArgEnabled && 'opacity-50 cursor-not-allowed'}`}
              disabled={!visualizeArgEnabled}
              onClick={() => navigate(`/visualize-pretty/${encodeURIComponent(data.filename)}`)}
            >
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold">Pretty ARG</span>
                <span className="text-xs mt-1 opacity-80">Publication-ready with merged nodes</span>
              </div>
            </button>
            <button
              className={`flex-1 min-w-[200px] bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-4 rounded-lg text-lg transition-colors shadow-md ${!visualizeSpatialArgEnabled && 'opacity-50 cursor-not-allowed'}`}
              disabled={!visualizeSpatialArgEnabled}
              onClick={() => navigate(`/visualize-spatial/${encodeURIComponent(data.filename)}`)}
            >
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold">Spatial ARG</span>
                <span className="text-xs mt-1 opacity-80">3D visualization with coordinates</span>
              </div>
            </button>
          </div>
        </div>

        {/* Sample count slider */}
        <div className="w-full p-4 bg-sp-dark-blue rounded-lg">
          <div className="flex flex-col gap-2">
            <label htmlFor="sample-slider" className="text-sm font-medium">
              Number of samples to display in visualization:
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                id="sample-slider"
                min="2"
                max={totalSamples || 25}
                value={Math.max(maxSamples, 2)}
                onChange={(e) => setMaxSamples(parseInt(e.target.value))}
                className="flex-1 h-2 bg-sp-very-dark-blue rounded-lg appearance-none cursor-pointer accent-sp-pale-green"
              />
              <div className="flex items-center gap-2 min-w-[8rem]">
                <input
                  type="number"
                  value={maxSamples}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    if (!isNaN(value)) {
                      setMaxSamples(value);
                    }
                  }}
                  min="2"
                  max={totalSamples || 25}
                  className="w-20 bg-sp-very-dark-blue border border-sp-dark-blue rounded px-2 py-1 text-sm text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green"
                />
                <span className="text-sm font-mono text-right">
                  / {totalSamples || '?'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-sp-white">
                Adjust this before visualizing to control the number of samples shown in the ARG (minimum: 2)
              </p>
              {totalSamples && totalSamples > 25 && (
                <p className="text-xs text-sp-white">
                  Note: Large sample numbers may affect visualization performance
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2 mb-8">
          <div className="flex items-center text-lg">
            <StatusIcon ok={true} />Tree Sequence loaded
          </div>
          <div className="flex items-center text-lg">
            <StatusIcon ok={!!data.has_temporal} />Temporal information loaded
          </div>
          <div className="flex items-center text-lg">
            <StatusIcon ok={!!data.has_sample_spatial} />Sample coordinates loaded
          </div>
          <div className="flex items-center text-lg">
            <StatusIcon ok={!!data.has_all_spatial} />All node coordinates loaded
          </div>
        </div>
      </div>
    </div>
  );
} 