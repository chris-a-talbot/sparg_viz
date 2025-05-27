import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Dropzone from './components/Dropzone';
import ResultPage from './components/ResultPage';
import ArgVisualizationPage from './components/ArgVisualizationPage';
import DeckGLArgVisualizationPage from './components/DeckGLArgVisualizationPage';
import PrettyArgVisualizationPage from './components/PrettyArgVisualizationPage';
import Footer from './components/Footer';
import TreeSequenceSelector from './components/TreeSequenceSelector';
import SimulationForm from './components/simulation/SimulationForm';
import { useState, useEffect } from 'react';
import { TreeSequenceProvider, useTreeSequence } from './context/TreeSequenceContext';
import SpatialArg3DVisualizationPage from './components/SpatialArg3DVisualizationPage';
import { log } from './lib/logger';
import { VISUALIZATION_DEFAULTS } from './config/constants';

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
  const { setTreeSequence } = useTreeSequence();

  useEffect(() => {
    if (loading) {
      const interval = setInterval(() => {
        setDots((prevDots) => (prevDots + 1) % 4);
      }, VISUALIZATION_DEFAULTS.LOADING_DOTS_INTERVAL);
      return () => clearInterval(interval);
    } else {
      setDots(0);
    }
  }, [loading]);

  const handleUploadComplete = (result: any) => {
    log.user.action('upload-complete', { result }, 'Home');
    setTreeSequence(result);
    log.nav('home', 'result');
    navigate('/result');
  };

  const handleTreeSequenceSelect = (treeSequence: any) => {
    log.user.action('tree-sequence-select', { treeSequence }, 'Home');
    setTreeSequence(treeSequence);
    log.nav('home', 'result');
    navigate('/result');
  };

  // Simulation form logic is now handled by SimulationForm component

  // All simulation options are now handled by SimulationForm component

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
            Generating simulation{Array(dots + 1).join('.')}
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
            <div className="flex-1">
              <SimulationForm loading={loading} setLoading={setLoading} />
            </div>
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
