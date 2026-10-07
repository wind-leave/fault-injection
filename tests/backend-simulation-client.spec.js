import { describe, expect, it, vi } from 'vitest';
import {
  createBackendSimulationSession,
  deleteBackendSimulationSession,
  runBackendSimulation,
  stepBackendSimulationSession
} from '../src/services/backendSimulationClient.js';

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

  it('creates a backend simulation session', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', sessionId: 'session-1', metrics: { done: false } })
    }));
    const pkg = { schemaVersion: 1 };

    const result = await createBackendSimulationSession(pkg, { fetchImpl });

    expect(result.sessionId).toBe('session-1');
    expect(fetchImpl).toHaveBeenCalledWith('/api/simulations/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pkg)
    });
  });

  it('steps a backend simulation session', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', sessionId: 'session-1', curves: { time: [0], channels: {} }, metrics: { done: false } })
    }));

    const result = await stepBackendSimulationSession('session-1', { steps: 2, fetchImpl });

    expect(result.curves.time).toEqual([0]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/simulations/session/session-1/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: 2, actualOnly: true })
    });
  });

  it('deletes a backend simulation session', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', sessionId: 'session-1' })
    }));

    const result = await deleteBackendSimulationSession('session-1', { fetchImpl });

    expect(result.status).toBe('success');
    expect(fetchImpl).toHaveBeenCalledWith('/api/simulations/session/session-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
  });
});
