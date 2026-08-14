import { describe, expect, it } from 'vitest';
import { createSimulationRuntimeFacade } from '../src/services/simulationRuntime.js';

describe('simulationRuntime backend facade', () => {
  it('exposes backend package export and backend run client', () => {
    const facade = createSimulationRuntimeFacade();

    expect(typeof facade.backend.buildExecutablePackage).toBe('function');
    expect(typeof facade.backend.runSimulation).toBe('function');
  });
});
