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

export async function runBackendSimulation(
  executablePackage,
  { endpoint = '/api/simulations/run', fetchImpl = globalThis.fetch } = {}
) {
  if (typeof fetchImpl !== 'function') {
    throw new BackendSimulationError({ errorCode: 'FETCH_UNAVAILABLE', message: 'fetch is unavailable' });
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(executablePackage)
  });
  const payload = await response.json();

  if (!response.ok || payload?.status === 'error') {
    throw new BackendSimulationError(payload);
  }

  return payload;
}
