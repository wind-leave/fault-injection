import { describe, expect, it, vi } from 'vitest';
import { runBackendSimulation } from '../src/services/backendSimulationClient.js';

describe('backendSimulationClient', () => {
  it('posts executable package to backend endpoint', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', curves: { time: [], channels: {} }, events: [], metrics: {}, warnings: [] })
    }));
    const pkg = { schemaVersion: 1 };

    const result = await runBackendSimulation(pkg, { fetchImpl, endpoint: '/api/simulations/run' });

    expect(result.status).toBe('success');
    expect(fetchImpl).toHaveBeenCalledWith('/api/simulations/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg)
    });
  });

  it('throws structured backend errors', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ status: 'error', errorCode: 'MODULE_NOT_WHITELISTED', field: 'nodes[1]', message: 'bad module' })
    }));

    await expect(runBackendSimulation({}, { fetchImpl })).rejects.toMatchObject({
      errorCode: 'MODULE_NOT_WHITELISTED',
      field: 'nodes[1]',
      message: 'bad module'
    });
  });
});
