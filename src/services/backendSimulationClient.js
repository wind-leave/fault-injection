export class BackendSimulationError extends Error {
  constructor(payload) {
    super(payload?.message ?? 'Backend simulation failed');
    this.name = 'BackendSimulationError';
    this.status = payload?.status ?? 'error';
    this.errorCode = payload?.errorCode ?? 'BACKEND_SIMULATION_FAILED';
    this.field = payload?.field ?? '';
    this.runId = payload?.runId ?? '';
  }
}

async function readBackendJson(response) {
  return response.json();
}

function assertFetchAvailable(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }
}

async function requestBackendJson(endpoint, request, fetchImpl) {
  assertFetchAvailable(fetchImpl);
  const response = await fetchImpl(endpoint, {
    headers: { 'Content-Type': 'application/json' },
    ...request
  });
  const payload = await readBackendJson(response);

  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }

  return payload;
}

export async function runBackendSimulation(
  executablePackage,
  { endpoint = '/api/simulations/run', fetchImpl = globalThis.fetch } = {}
) {
  return requestBackendJson(
    endpoint,
    {
      method: 'POST',
      body: JSON.stringify(executablePackage)
    },
    fetchImpl
  );
}

export async function createBackendSimulationSession(
  executablePackage,
  { endpoint = '/api/simulations/session', fetchImpl = globalThis.fetch } = {}
) {
  return requestBackendJson(
    endpoint,
    {
      method: 'POST',
      body: JSON.stringify(executablePackage)
    },
    fetchImpl
  );
}

export async function stepBackendSimulationSession(
  sessionId,
  {
    steps = 1,
    actualOnly = true,
    endpointBase = '/api/simulations/session',
    fetchImpl = globalThis.fetch
  } = {}
) {
  return requestBackendJson(
    `${endpointBase}/${encodeURIComponent(sessionId)}/step`,
    {
      method: 'POST',
      body: JSON.stringify({ steps, actualOnly })
    },
    fetchImpl
  );
}

export async function deleteBackendSimulationSession(
  sessionId,
  { endpointBase = '/api/simulations/session', fetchImpl = globalThis.fetch } = {}
) {
  return requestBackendJson(
    `${endpointBase}/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE'
    },
    fetchImpl
  );
}
