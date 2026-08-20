import { describe, expect, it, vi } from 'vitest';
import {
  registerBackendSimulationComponent,
  updateBackendSimulationComponent,
  unregisterBackendSimulationComponent
} from '../src/services/backendComponentRegistrationClient.js';

describe('backend component registration client', () => {
  it('posts the controlled component contract and returns the registered module', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'success',
        component: { moduleId: 'custom_component_abc', entryFunction: 'process' }
      })
    }));

    const result = await registerBackendSimulationComponent({
      moduleId: 'custom_component_abc',
      source: 'def process():\n    return {"outputs": {}}',
      inputs: [], outputs: [], parameters: []
    }, { fetchImpl });

    expect(result).toEqual({ moduleId: 'custom_component_abc', entryFunction: 'process' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/components/register', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }));
  });

  it('deletes a registered backend component by its module id', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', component: { moduleId: 'custom_component_abc' } })
    }));

    await unregisterBackendSimulationComponent('custom_component_abc', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('/api/components/custom_component_abc', {
      method: 'DELETE',
      headers: {}
    });
  });

  it('updates a registered backend component without changing its module id', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'success', component: { moduleId: 'custom_component_abc' } })
    }));

    await updateBackendSimulationComponent('custom_component_abc', { source: 'def process(): pass' }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith('/api/components/custom_component_abc', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('custom_component_abc')
    }));
  });
});
