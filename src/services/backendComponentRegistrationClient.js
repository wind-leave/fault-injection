import { BackendSimulationError } from './backendSimulationClient.js';

export async function registerBackendSimulationComponent(
  component,
  { endpoint = '/api/components/register', fetchImpl = globalThis.fetch, registrationToken = '' } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(registrationToken ? { 'X-GZ-Component-Registration-Token': registrationToken } : {})
    },
    body: JSON.stringify(component)
  });
  const payload = await response.json();
  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }
  return payload.component;
}

export async function unregisterBackendSimulationComponent(
  moduleId,
  { endpointBase = '/api/components', fetchImpl = globalThis.fetch, registrationToken = '' } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }
  const response = await fetchImpl(`${endpointBase}/${encodeURIComponent(moduleId)}`, {
    method: 'DELETE',
    headers: registrationToken ? { 'X-GZ-Component-Registration-Token': registrationToken } : {}
  });
  const payload = await response.json();
  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }
  return payload.component;
}

export async function updateBackendSimulationComponent(
  moduleId,
  component,
  { endpointBase = '/api/components', fetchImpl = globalThis.fetch, registrationToken = '' } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }
  const response = await fetchImpl(`${endpointBase}/${encodeURIComponent(moduleId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(registrationToken ? { 'X-GZ-Component-Registration-Token': registrationToken } : {})
    },
    body: JSON.stringify({ ...component, moduleId })
  });
  const payload = await response.json();
  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }
  return payload.component;
}

export async function unregisterBackendSimulationComponents(
  moduleIds,
  { endpoint = '/api/components/batch-delete', fetchImpl = globalThis.fetch, registrationToken = '' } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(registrationToken ? { 'X-GZ-Component-Registration-Token': registrationToken } : {})
    },
    body: JSON.stringify({ moduleIds })
  });
  const payload = await response.json();
  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }
  return payload.components;
}
