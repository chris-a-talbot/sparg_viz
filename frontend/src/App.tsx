import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Dropzone from './components/Dropzone';
import ResultPage from './components/ResultPage';
import ArgVisualizationPage from './components/ArgVisualizationPage';
import DeckGLArgVisualizationPage from './components/DeckGLArgVisualizationPage';
import PrettyArgVisualizationPage from './components/PrettyArgVisualizationPage';
import Footer from './components/Footer';
import TreeSequenceSelector from './components/TreeSequenceSelector';
import { RangeSlider } from './components/ui/range-slider';
import { useState, useEffect } from 'react';
import { TreeSequenceProvider, useTreeSequence } from './context/TreeSequenceContext';
import SpatialArg3DVisualizationPage from './components/SpatialArg3DVisualizationPage';

// Layout component that includes the footer
function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main>
        {children}
      </main>
      <Footer />
    </>
  );
}

function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [dots, setDots] = useState(0);
  const [selectedSimulator, setSelectedSimulator] = useState('spargviz');
  const [simulationParams, setSimulationParams] = useState({
    // spARGviz parameters
    sampleNumber: 10,
    localTrees: 5,
    spatialDimensions: '0',
    spatialBoundarySize: [25.0, 25.0], // default boundary sizes for 2D
    dispersalRange: 5.0,
    // msprime parameters  
    mspatialDimensions: '0',
    populationSize: 5,  // Keep this but use as sample number for msprime
    mlocalTrees: 5,  // Add local trees for msprime
    mgenerations: 6,  // Add generations limit for msprime
    mspatialBoundarySize: [25.0, 25.0], // separate boundary sizes for msprime
    mdispersalRange: 5.0
  });
  const { setTreeSequence } = useTreeSequence();

  useEffect(() => {
    if (loading) {
      const interval = setInterval(() => {
        setDots((prevDots) => (prevDots + 1) % 4);
      }, 420);
      return () => clearInterval(interval);
    } else {
      setDots(0);
    }
  }, [loading]);

  const handleUploadComplete = (result: any) => {
    console.log('handleUploadComplete called', result);
    setTreeSequence(result);
    navigate('/result');
    console.log('Navigation to /result attempted');
  };

  const handleTreeSequenceSelect = (treeSequence: any) => {
    console.log('handleTreeSequenceSelect called', treeSequence);
    setTreeSequence(treeSequence);
    navigate('/result');
    console.log('Navigation to /result attempted');
  };

  const handleSimulationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = selectedSimulator === 'spargviz' 
        ? '/simulate-spargviz' 
        : '/simulate-msprime';
      
      const spatialDims = selectedSimulator === 'spargviz' 
        ? parseInt(simulationParams.spatialDimensions) 
        : parseInt(simulationParams.mspatialDimensions);
      
      const boundarySize = selectedSimulator === 'spargviz' 
        ? simulationParams.spatialBoundarySize 
        : simulationParams.mspatialBoundarySize;
      
      const dispersalRange = selectedSimulator === 'spargviz' 
        ? simulationParams.dispersalRange 
        : simulationParams.mdispersalRange;

      const params = selectedSimulator === 'spargviz' 
        ? {
            sample_number: simulationParams.sampleNumber,
            local_trees: simulationParams.localTrees,
            spatial_dimensions: spatialDims,
            spatial_boundary_size: spatialDims > 0 ? boundarySize.slice(0, spatialDims) : [],
            dispersal_range: dispersalRange
          }
        : {
            sample_number: simulationParams.populationSize,  // Use as sample number
            spatial_dimensions: spatialDims,
            spatial_boundary_size: spatialDims > 0 ? boundarySize.slice(0, spatialDims) : [],
            dispersal_range: dispersalRange,
            local_trees: simulationParams.mlocalTrees,  // Add local trees parameter
            generations: simulationParams.mgenerations  // Add generations parameter
          };

      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        throw new Error(`Simulation failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Simulation completed:', result);
      setTreeSequence(result);
      navigate('/result');
    } catch (error) {
      console.error('Simulation error:', error);
      alert(`Simulation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleParamChange = (param: string, value: any) => {
    setSimulationParams(prev => ({
      ...prev,
      [param]: value
    }));
  };

  const renderSpatialControls = (isSpargviz: boolean = true) => {
    const spatialDims = isSpargviz ? simulationParams.spatialDimensions : simulationParams.mspatialDimensions;
    const boundarySize = isSpargviz ? simulationParams.spatialBoundarySize : simulationParams.mspatialBoundarySize;
    const dispersalRange = isSpargviz ? simulationParams.dispersalRange : simulationParams.mdispersalRange;
    const prefix = isSpargviz ? '' : 'm';

    if (spatialDims === '0') return null;

    const dimensionCount = parseInt(spatialDims);
    
    return (
      <>
        {/* Boundary Size Controls */}
        <div>
          <label className="block text-lg font-medium mb-2">
            Spatial boundary size{dimensionCount > 1 ? 's' : ''}
            <span className="text-sm text-sp-white font-normal ml-2">(1-50 range)</span>
          </label>
          {dimensionCount === 1 ? (
            <div>
              <label className="block text-sm text-sp-white mb-1">X dimension</label>
              <RangeSlider
                min={1}
                max={50}
                step={1}
                value={[1, boundarySize[0]]}
                onChange={([_, max]) => {
                  const newBoundary = [...boundarySize];
                  newBoundary[0] = max;
                  handleParamChange(`${prefix}spatialBoundarySize`, newBoundary);
                }}
                formatValue={(value) => `${value}`}
                className="mb-2"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm text-sp-white mb-1">X dimension</label>
                <RangeSlider
                  min={1}
                  max={50}
                  step={1}
                  value={[1, boundarySize[0]]}
                  onChange={([_, max]) => {
                    const newBoundary = [...boundarySize];
                    newBoundary[0] = max;
                    handleParamChange(`${prefix}spatialBoundarySize`, newBoundary);
                  }}
                  formatValue={(value) => `${value}`}
                  className="mb-2"
                />
              </div>
              <div>
                <label className="block text-sm text-sp-white mb-1">Y dimension</label>
                <RangeSlider
                  min={1}
                  max={50}
                  step={1}
                  value={[1, boundarySize[1]]}
                  onChange={([_, max]) => {
                    const newBoundary = [...boundarySize];
                    newBoundary[1] = max;
                    handleParamChange(`${prefix}spatialBoundarySize`, newBoundary);
                  }}
                  formatValue={(value) => `${value}`}
                  className="mb-2"
                />
              </div>
            </>
          )}
        </div>

        {/* Dispersal Range Control */}
        <div>
          <label className="block text-lg font-medium mb-2">
            Dispersal range
            <span className="text-sm text-sp-white font-normal ml-2">(max distance for offspring)</span>
          </label>
          <RangeSlider
            min={0.1}
            max={20}
            step={0.1}
            value={[0.1, dispersalRange]}
            onChange={([_, max]) => handleParamChange(`${prefix}dispersalRange`, max)}
            formatValue={(value) => `${value.toFixed(1)}`}
            className="mb-2"
          />
          <p className="text-xs text-sp-white mt-1">
            Controls how far offspring can disperse from their parents during simulation
          </p>
        </div>
      </>
    );
  };

  const renderSimulationOptions = () => {
    if (selectedSimulator === 'spargviz') {
      return (
        <>
          <div>
            <label className="block text-lg font-medium mb-2">Sample number</label>
            <input 
              type="number" 
              min="2" 
              max="25" 
              value={simulationParams.sampleNumber}
              onChange={(e) => handleParamChange('sampleNumber', parseInt(e.target.value))}
              className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green" 
            />
          </div>
          <div>
            <label className="block text-lg font-medium mb-2">Local trees</label>
            <input 
              type="number" 
              min="1" 
              max="25" 
              value={simulationParams.localTrees}
              onChange={(e) => handleParamChange('localTrees', parseInt(e.target.value))}
              className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green" 
            />
          </div>
          <div>
            <label className="block text-lg font-medium mb-2">Spatial dimensions</label>
            <div className="flex gap-6 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="spatial" 
                  value="0" 
                  checked={simulationParams.spatialDimensions === '0'}
                  onChange={(e) => handleParamChange('spatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 0
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="spatial" 
                  value="1" 
                  checked={simulationParams.spatialDimensions === '1'}
                  onChange={(e) => handleParamChange('spatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 1
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="spatial" 
                  value="2" 
                  checked={simulationParams.spatialDimensions === '2'}
                  onChange={(e) => handleParamChange('spatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 2
              </label>
            </div>
          </div>
          {renderSpatialControls(true)}
        </>
      );
    } else {
      return (
        <>
          <div>
            <label className="block text-lg font-medium mb-2">Spatial dimensions</label>
            <div className="flex gap-6 mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="mspatial" 
                  value="0" 
                  checked={simulationParams.mspatialDimensions === '0'}
                  onChange={(e) => handleParamChange('mspatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 0
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="mspatial" 
                  value="1" 
                  checked={simulationParams.mspatialDimensions === '1'}
                  onChange={(e) => handleParamChange('mspatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 1
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="radio" 
                  name="mspatial" 
                  value="2" 
                  checked={simulationParams.mspatialDimensions === '2'}
                  onChange={(e) => handleParamChange('mspatialDimensions', e.target.value)}
                  className="accent-sp-pale-green" 
                /> 2
              </label>
            </div>
          </div>
          <div>
            <label className="block text-lg font-medium mb-2">Sample number</label>
            <input 
              type="number" 
              min="2"
              max="25"
              value={simulationParams.populationSize}
              onChange={(e) => handleParamChange('populationSize', parseInt(e.target.value))}
              className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green" 
            />
          </div>
          <div>
            <label className="block text-lg font-medium mb-2">Local trees</label>
            <input 
              type="number" 
              min="1" 
              max="25" 
              value={simulationParams.mlocalTrees}
              onChange={(e) => handleParamChange('mlocalTrees', parseInt(e.target.value))}
              className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green" 
            />
          </div>
          <div>
            <label className="block text-lg font-medium mb-2">
              Generations
              <span className="text-sm text-sp-white font-normal ml-2">(simulation time limit)</span>
            </label>
            <input 
              type="number" 
              min="2" 
              max="50" 
              value={simulationParams.mgenerations}
              onChange={(e) => handleParamChange('mgenerations', parseInt(e.target.value))}
              className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green" 
            />
          </div>
          {renderSpatialControls(false)}
        </>
      );
    }
  };

  return (
    <div className="bg-sp-very-dark-blue text-sp-white flex flex-col items-center justify-center px-4 py-8 font-sans min-h-screen">
      {/* Title */}
      <h1 className="text-[4rem] md:text-[5rem] font-extrabold mb-16 tracking-tight text-center select-none" style={{letterSpacing: '-0.04em'}}>
        sp<span className="text-sp-pale-green">ARG</span>viz
      </h1>
      {/* Main content */}
      {loading ? (
        <div className="flex flex-col items-center text-xl text-sp-white space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-sp-pale-green"></div>
          <span>
            {selectedSimulator === 'spargviz' ? 'Generating ARG simulation' : 'Running msprime simulation'}
            {Array(dots + 1).join('.')}
          </span>
        </div>
      ) : (
        <div className="w-full max-w-6xl flex flex-col lg:flex-row items-stretch bg-transparent rounded-2xl shadow-xl overflow-hidden border border-sp-dark-blue">
          {/* Left: File Upload */}
          <div className="flex-1 flex flex-col p-6 lg:p-8 bg-sp-very-dark-blue">
            <h2 className="text-xl lg:text-2xl font-bold mb-6 text-sp-white">Upload a file</h2>
            <div className="flex-1 flex items-center justify-center">
              <Dropzone onUploadComplete={handleUploadComplete} setLoading={setLoading} />
            </div>
          </div>
          {/* Divider */}
          <div className="hidden lg:block w-px bg-sp-dark-blue" />
          {/* Middle: Existing Tree Sequences */}
          <div className="flex-1 flex flex-col p-6 lg:p-8 bg-sp-very-dark-blue">
            <h2 className="text-xl lg:text-2xl font-bold mb-6 text-sp-white">Load existing</h2>
            <div className="flex-1">
              <TreeSequenceSelector onSelect={handleTreeSequenceSelect} />
            </div>
          </div>
          {/* Divider */}
          <div className="hidden lg:block w-px bg-sp-dark-blue" />
          {/* Right: Simulation */}
          <div className="flex-1 flex flex-col p-6 lg:p-8 bg-sp-very-dark-blue">
            <h2 className="text-xl lg:text-2xl font-bold mb-6 text-sp-white">Run simulation</h2>
            <form onSubmit={handleSimulationSubmit} className="flex flex-col gap-4 max-w-xs">
              <div>
                <label className="block text-lg font-medium mb-2">Simulator</label>
                <select 
                  value={selectedSimulator}
                  onChange={(e) => setSelectedSimulator(e.target.value)}
                  className="w-full bg-sp-dark-blue border border-sp-dark-blue rounded px-3 py-2 text-lg text-sp-white focus:outline-none focus:ring-2 focus:ring-sp-pale-green"
                >
                  <option value="spargviz">spARGviz</option>
                  <option value="msprime">msprime</option>
                </select>
              </div>
              {renderSimulationOptions()}
              <button 
                type="submit" 
                className="mt-2 bg-sp-dark-blue hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue text-sp-white font-bold py-2 rounded-lg transition-colors shadow-md"
              >
                Run
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <TreeSequenceProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Layout><Home /></Layout>} />
          <Route path="/result" element={<Layout><ResultPage /></Layout>} />
          <Route path="/visualize/:filename" element={<Layout><ArgVisualizationPage /></Layout>} />
          <Route path="/visualize-large/:filename" element={<Layout><DeckGLArgVisualizationPage /></Layout>} />
          <Route path="/visualize-pretty/:filename" element={<Layout><PrettyArgVisualizationPage /></Layout>} />
          <Route path="/visualize-spatial/:filename" element={<Layout><SpatialArg3DVisualizationPage /></Layout>} />
        </Routes>
      </Router>
    </TreeSequenceProvider>
  );
}

export default App;
