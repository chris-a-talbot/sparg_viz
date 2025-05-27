/**
 * Simulation form component
 * Handles both spARGviz and msprime simulation parameter configuration
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RangeSlider } from '../ui/range-slider';
import { useTreeSequence } from '../../context/TreeSequenceContext';
import { api } from '../../lib/api';
import { log } from '../../lib/logger';
import { SIMULATION_DEFAULTS, ERROR_MESSAGES } from '../../config/constants';

interface SimulationFormProps {
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

interface SimulationParams {
  // spARGviz parameters
  sampleNumber: number;
  localTrees: number;
  spatialDimensions: string;
  spatialBoundarySize: number[];
  dispersalRange: number;
  numGenerations: number;
  recombinationProbability: number;
  coalescenceRate: number;
  edgeDensity: number;
  // msprime parameters  
  mspatialDimensions: string;
  populationSize: number;
  mlocalTrees: number;
  mgenerations: number;
  mspatialBoundarySize: number[];
  mdispersalRange: number;
}

export default function SimulationForm({ loading, setLoading }: SimulationFormProps) {
  const navigate = useNavigate();
  const { setTreeSequence } = useTreeSequence();
  const [selectedSimulator, setSelectedSimulator] = useState('spargviz');
  const [simulationParams, setSimulationParams] = useState<SimulationParams>({
    // spARGviz parameters
    sampleNumber: SIMULATION_DEFAULTS.SPARGVIZ.SAMPLE_NUMBER,
    localTrees: SIMULATION_DEFAULTS.SPARGVIZ.LOCAL_TREES,
    spatialDimensions: SIMULATION_DEFAULTS.SPARGVIZ.SPATIAL_DIMENSIONS,
    spatialBoundarySize: [...SIMULATION_DEFAULTS.SPARGVIZ.SPATIAL_BOUNDARY_SIZE],
    dispersalRange: SIMULATION_DEFAULTS.SPARGVIZ.DISPERSAL_RANGE,
    numGenerations: SIMULATION_DEFAULTS.SPARGVIZ.NUM_GENERATIONS,
    recombinationProbability: SIMULATION_DEFAULTS.SPARGVIZ.RECOMBINATION_PROBABILITY,
    coalescenceRate: SIMULATION_DEFAULTS.SPARGVIZ.COALESCENCE_RATE,
    edgeDensity: SIMULATION_DEFAULTS.SPARGVIZ.EDGE_DENSITY,
    // msprime parameters  
    mspatialDimensions: SIMULATION_DEFAULTS.MSPRIME.SPATIAL_DIMENSIONS,
    populationSize: SIMULATION_DEFAULTS.MSPRIME.POPULATION_SIZE,
    mlocalTrees: SIMULATION_DEFAULTS.MSPRIME.LOCAL_TREES,
    mgenerations: SIMULATION_DEFAULTS.MSPRIME.GENERATIONS,
    mspatialBoundarySize: [...SIMULATION_DEFAULTS.MSPRIME.SPATIAL_BOUNDARY_SIZE],
    mdispersalRange: SIMULATION_DEFAULTS.MSPRIME.DISPERSAL_RANGE,
  });

  const handleSimulationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    log.user.action('simulation-submit', { simulator: selectedSimulator, params: simulationParams }, 'SimulationForm');

    try {
      const spatialDims = selectedSimulator === 'spargviz' 
        ? parseInt(simulationParams.spatialDimensions) 
        : parseInt(simulationParams.mspatialDimensions);
      
      const boundarySize = selectedSimulator === 'spargviz' 
        ? simulationParams.spatialBoundarySize 
        : simulationParams.mspatialBoundarySize;
      
      const dispersalRange = selectedSimulator === 'spargviz' 
        ? simulationParams.dispersalRange 
        : simulationParams.mdispersalRange;

      let result;
      
      if (selectedSimulator === 'spargviz') {
        const params = {
          num_samples: simulationParams.sampleNumber,
          num_trees: simulationParams.localTrees,
          spatial_dims: spatialDims,
          num_generations: simulationParams.numGenerations,
          x_range: spatialDims >= 1 ? boundarySize[0] : 10.0,
          y_range: spatialDims >= 2 ? boundarySize[1] : null,
          recombination_probability: simulationParams.recombinationProbability,
          coalescence_rate: simulationParams.coalescenceRate,
          edge_density: simulationParams.edgeDensity
        };
        
        result = await api.simulateSpargviz(params);
      } else {
        const params = {
          sample_number: simulationParams.populationSize,
          spatial_dimensions: spatialDims,
          spatial_boundary_size: spatialDims > 0 ? boundarySize.slice(0, spatialDims) : [],
          dispersal_range: dispersalRange,
          local_trees: simulationParams.mlocalTrees,
          generations: simulationParams.mgenerations
        };
        
        result = await api.simulateMsprime(params);
      }

      log.info('Simulation completed successfully', {
        component: 'SimulationForm',
        data: { simulator: selectedSimulator, result: result.data }
      });

      setTreeSequence(result.data as any);
      log.nav('simulation-form', 'result');
      navigate('/result');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : ERROR_MESSAGES.SIMULATION_FAILED;
      log.error('Simulation failed', {
        component: 'SimulationForm',
        error: error instanceof Error ? error : new Error(errorMessage),
        data: { simulator: selectedSimulator, params: simulationParams }
      });
      alert(`${ERROR_MESSAGES.SIMULATION_FAILED}: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleParamChange = (param: keyof SimulationParams, value: any) => {
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
            <span className="text-sm text-sp-white font-normal ml-2">
              ({SIMULATION_DEFAULTS.LIMITS.MIN_BOUNDARY_SIZE}-{SIMULATION_DEFAULTS.LIMITS.MAX_BOUNDARY_SIZE} range)
            </span>
          </label>
          {dimensionCount === 1 ? (
            <div>
              <label className="block text-sm text-sp-white mb-1">X dimension</label>
              <RangeSlider
                min={SIMULATION_DEFAULTS.LIMITS.MIN_BOUNDARY_SIZE}
                max={SIMULATION_DEFAULTS.LIMITS.MAX_BOUNDARY_SIZE}
                step={1}
                value={[1, boundarySize[0]]}
                onChange={([_, max]) => {
                  const newBoundary = [...boundarySize];
                  newBoundary[0] = max;
                  handleParamChange(`${prefix}spatialBoundarySize` as keyof SimulationParams, newBoundary);
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
                  min={SIMULATION_DEFAULTS.LIMITS.MIN_BOUNDARY_SIZE}
                  max={SIMULATION_DEFAULTS.LIMITS.MAX_BOUNDARY_SIZE}
                  step={1}
                  value={[1, boundarySize[0]]}
                  onChange={([_, max]) => {
                    const newBoundary = [...boundarySize];
                    newBoundary[0] = max;
                    handleParamChange(`${prefix}spatialBoundarySize` as keyof SimulationParams, newBoundary);
                  }}
                  formatValue={(value) => `${value}`}
                  className="mb-2"
                />
              </div>
              <div>
                <label className="block text-sm text-sp-white mb-1">Y dimension</label>
                <RangeSlider
                  min={SIMULATION_DEFAULTS.LIMITS.MIN_BOUNDARY_SIZE}
                  max={SIMULATION_DEFAULTS.LIMITS.MAX_BOUNDARY_SIZE}
                  step={1}
                  value={[1, boundarySize[1]]}
                  onChange={([_, max]) => {
                    const newBoundary = [...boundarySize];
                    newBoundary[1] = max;
                    handleParamChange(`${prefix}spatialBoundarySize` as keyof SimulationParams, newBoundary);
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
            min={SIMULATION_DEFAULTS.LIMITS.MIN_DISPERSAL_RANGE}
            max={SIMULATION_DEFAULTS.LIMITS.MAX_DISPERSAL_RANGE}
            step={SIMULATION_DEFAULTS.LIMITS.DISPERSAL_STEP}
            value={[SIMULATION_DEFAULTS.LIMITS.MIN_DISPERSAL_RANGE, dispersalRange]}
            onChange={([_, max]) => handleParamChange(`${prefix}dispersalRange` as keyof SimulationParams, max)}
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
        <div className="space-y-6">
          {/* Sample Number */}
          <div>
            <label className="block text-lg font-medium mb-2">Sample number</label>
            <input
              type="number"
              min={SIMULATION_DEFAULTS.LIMITS.MIN_SAMPLES}
              max={SIMULATION_DEFAULTS.LIMITS.MAX_SAMPLES}
              value={simulationParams.sampleNumber}
              onChange={(e) => handleParamChange('sampleNumber', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>
          
          {/* Local Trees */}
          <div>
            <label className="block text-lg font-medium mb-2">Local trees</label>
            <input
              type="number"
              min="1"
              max={SIMULATION_DEFAULTS.LIMITS.MAX_SAMPLES}
              value={simulationParams.localTrees}
              onChange={(e) => handleParamChange('localTrees', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>

          {/* Spatial Dimensions */}
          <div>
            <label className="block text-lg font-medium mb-2">Spatial dimensions</label>
            <select
              value={simulationParams.spatialDimensions}
              onChange={(e) => handleParamChange('spatialDimensions', e.target.value)}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            >
              <option value="0">None (0D)</option>
              <option value="1">1D</option>
              <option value="2">2D</option>
            </select>
          </div>

          {renderSpatialControls(true)}

          {/* Additional spARGviz parameters */}
          <div>
            <label className="block text-lg font-medium mb-2">Number of generations</label>
            <input
              type="number"
              min="1"
              value={simulationParams.numGenerations}
              onChange={(e) => handleParamChange('numGenerations', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>

          {/* Recombination Probability */}
          <div>
            <label className="block text-lg font-medium mb-2">Recombination probability</label>
            <RangeSlider
              min={0}
              max={1}
              step={0.01}
              value={[0, simulationParams.recombinationProbability]}
              onChange={([_, max]) => handleParamChange('recombinationProbability', max)}
              formatValue={(value) => `${value.toFixed(2)}`}
              className="mb-2"
            />
          </div>

          {/* Coalescence Rate */}
          <div>
            <label className="block text-lg font-medium mb-2">Coalescence rate</label>
            <RangeSlider
              min={0.1}
              max={5}
              step={0.1}
              value={[0.1, simulationParams.coalescenceRate]}
              onChange={([_, max]) => handleParamChange('coalescenceRate', max)}
              formatValue={(value) => `${value.toFixed(1)}`}
              className="mb-2"
            />
          </div>

          {/* Edge Density */}
          <div>
            <label className="block text-lg font-medium mb-2">Edge density</label>
            <RangeSlider
              min={0.1}
              max={2}
              step={0.1}
              value={[0.1, simulationParams.edgeDensity]}
              onChange={([_, max]) => handleParamChange('edgeDensity', max)}
              formatValue={(value) => `${value.toFixed(1)}`}
              className="mb-2"
            />
          </div>
        </div>
      );
    } else {
      // msprime options
      return (
        <div className="space-y-6">
          {/* Population Size */}
          <div>
            <label className="block text-lg font-medium mb-2">Population size</label>
            <input
              type="number"
              min={SIMULATION_DEFAULTS.LIMITS.MIN_SAMPLES}
              max={SIMULATION_DEFAULTS.LIMITS.MAX_SAMPLES}
              value={simulationParams.populationSize}
              onChange={(e) => handleParamChange('populationSize', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>

          {/* Local Trees */}
          <div>
            <label className="block text-lg font-medium mb-2">Local trees</label>
            <input
              type="number"
              min="1"
              max={SIMULATION_DEFAULTS.LIMITS.MAX_SAMPLES}
              value={simulationParams.mlocalTrees}
              onChange={(e) => handleParamChange('mlocalTrees', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>

          {/* Generations */}
          <div>
            <label className="block text-lg font-medium mb-2">Generations</label>
            <input
              type="number"
              min="1"
              value={simulationParams.mgenerations}
              onChange={(e) => handleParamChange('mgenerations', parseInt(e.target.value))}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            />
          </div>

          {/* Spatial Dimensions */}
          <div>
            <label className="block text-lg font-medium mb-2">Spatial dimensions</label>
            <select
              value={simulationParams.mspatialDimensions}
              onChange={(e) => handleParamChange('mspatialDimensions', e.target.value)}
              className="w-full p-2 bg-sp-dark-blue border border-sp-pale-green rounded text-sp-white"
            >
              <option value="0">None (0D)</option>
              <option value="1">1D</option>
              <option value="2">2D</option>
            </select>
          </div>

          {renderSpatialControls(false)}
        </div>
      );
    }
  };

  return (
    <form onSubmit={handleSimulationSubmit} className="space-y-6">
      {/* Simulator Selection */}
      <div>
        <label className="block text-xl font-semibold mb-4">Choose Simulator</label>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setSelectedSimulator('spargviz')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              selectedSimulator === 'spargviz'
                ? 'bg-sp-pale-green text-sp-very-dark-blue'
                : 'bg-sp-dark-blue text-sp-white hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue'
            }`}
          >
            spARGviz
          </button>
          <button
            type="button"
            onClick={() => setSelectedSimulator('msprime')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              selectedSimulator === 'msprime'
                ? 'bg-sp-pale-green text-sp-very-dark-blue'
                : 'bg-sp-dark-blue text-sp-white hover:bg-sp-very-pale-green hover:text-sp-very-dark-blue'
            }`}
          >
            msprime
          </button>
        </div>
      </div>

      {renderSimulationOptions()}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={loading}
        className={`w-full bg-sp-pale-green hover:bg-sp-very-pale-green text-sp-very-dark-blue font-bold py-3 px-6 rounded-lg transition-colors ${
          loading ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        {loading ? 'Generating...' : `Generate ${selectedSimulator} simulation`}
      </button>
    </form>
  );
} 