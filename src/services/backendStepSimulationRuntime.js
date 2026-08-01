import {
  getMultimeterMeasurementKind,
  getMultimeterTargetKind,
  normalizeMultimeterBinding,
  evaluateMultimeterLeads
} from './multimeterMeasurementService.js';

const DEFAULT_SAMPLE_LIMIT = 720;

function getBackendApi(target) {
  return target.__GZ_BACKEND_SIMULATION__;
}

function getSimulationState(target) {
  return target.__GZ_SIM__;
}

function getWorkbenchState(target) {
  return target.__GZ_STATE__ ?? {};
}

function pushLimitedSample(list, sample, limit = DEFAULT_SAMPLE_LIMIT) {
  list.push(sample);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

function workbenchItems(state, key) {
  const fallbackKey = key === 'modelNodes' ? 'nodes' : key === 'modelEdges' ? 'edges' : key;
  const canvasKey = key === 'modelNodes' ? 'nodes' : key === 'modelEdges' ? 'edges' : key;
  const items = [
    ...(Array.isArray(state?.[key]) ? state[key] : []),
    ...(Array.isArray(state?.[fallbackKey]) ? state[fallbackKey] : []),
    ...Object.values(state?.canvases ?? {}).flatMap((canvas) => (
      Array.isArray(canvas?.[canvasKey]) ? canvas[canvasKey] : []
    ))
  ];
  return Array.from(new Map(items.filter((item) => item?.id).map((item) => [item.id, item])).values());
}

function outputValueForPort(outputs, node, portIndex = 0, vectorIndex = null) {
  if (Number.isFinite(Number(outputs))) {
    return Number(outputs);
  }
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    return NaN;
  }

  const ports = node?.outputs ?? node?.props?.outputs ?? [];
  const port = Array.isArray(ports) ? ports[Number(portIndex) || 0] : null;
  const candidates = [
    port?.name,
    port?.key,
    port?.varName,
    port?.id,
    'output',
    'out',
    'value'
  ].filter(Boolean);

  const selectValue = (value) => {
    if (Array.isArray(value)) {
      const index = Math.max(0, Math.trunc(Number(vectorIndex) || 0));
      return Number(value[index]);
    }
    return Number(value);
  };

  for (const key of candidates) {
    const value = selectValue(outputs[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  const values = Object.values(outputs).map(selectValue).filter(Number.isFinite);
  return values.length === 1 ? values[0] : NaN;
}

function selectedInstrumentVectorIndex(node) {
  const selectedChannel = Math.trunc(Number(node?.props?.vectorChannel));
  return Number.isFinite(selectedChannel) && selectedChannel > 0 ? selectedChannel - 1 : 0;
}

function multimeterTargetFor(node, nodesById, edgesById) {
  const binding = normalizeMultimeterBinding(node?.props);
  if (!binding.measurementTargetId) return null;
  return binding.measurementTargetKind === 'edge'
    ? edgesById.get(binding.measurementTargetId) ?? null
    : nodesById.get(binding.measurementTargetId) ?? null;
}

function multimeterNodeReading(stepOutputs, node, mode, incomingEdges = [], nodesById) {
  const kind = getMultimeterMeasurementKind(mode);
  if (kind === 'resistance' || kind === 'continuity') {
    return 1;
  }
  const incoming = incomingEdges
    .filter((edge) => edge.targetNodeId === node?.id)
    .sort((left, right) => (left.targetPortIndex ?? 0) - (right.targetPortIndex ?? 0))[0];
  if (!incoming) return NaN;
  return outputValueForPort(
    stepOutputs?.[incoming.sourceNodeId],
    nodesById.get(incoming.sourceNodeId),
    incoming.sourcePortIndex
  );
}

function multimeterLeadPairFor(node, nodes, edges) {
  return evaluateMultimeterLeads({
    positiveLead: node?.props?.positiveLead,
    negativeLead: node?.props?.negativeLead
  }, nodes, edges);
}

function multimeterLeadReading(stepOutputs, pair, mode, nodesById, edges) {
  if (!pair?.valid) return NaN;
  const kind = getMultimeterMeasurementKind(mode);
  if (kind === 'current') {
    if (pair.targetKind !== 'edge') return NaN;
    const edge = edges.find((item) => item.id === pair.edgeId);
    const value = outputValueForPort(stepOutputs?.[edge?.sourceNodeId], nodesById.get(edge?.sourceNodeId), edge?.sourcePortIndex);
    return Number.isFinite(value) ? value * pair.polarity : NaN;
  }
  if (pair.targetKind !== 'component') return NaN;
  if (kind === 'resistance' || kind === 'continuity') return pair.polarity;
  const incoming = edges
    .filter((edge) => edge.targetNodeId === pair.componentNodeId && Number(edge.targetPortIndex ?? 0) === pair.inputPortIndex)
    .sort((left, right) => (left.id || '').localeCompare(right.id || ''))[0];
  if (!incoming) return NaN;
  const value = outputValueForPort(stepOutputs?.[incoming.sourceNodeId], nodesById.get(incoming.sourceNodeId), incoming.sourcePortIndex);
  return Number.isFinite(value) ? value * pair.polarity : NaN;
}

function appendBackendInstrumentSamples(target, componentSteps, componentTimes, curveTimes, sampleLimit) {
  const sim = getSimulationState(target);
  const state = getWorkbenchState(target);
  if (!sim || !componentSteps.length) {
    return;
  }

  const nodes = workbenchItems(state, 'modelNodes');
  const edges = workbenchItems(state, 'modelEdges');
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const instruments = nodes
    .filter((node) => ['instrument_logger', 'instrument_spectrum', 'instrument_multimeter'].includes(node.type))
    .map((node) => ({
      node,
      incoming: edges
        .filter((edge) => edge.targetNodeId === node.id)
        .sort((left, right) => (left.targetPortIndex ?? 0) - (right.targetPortIndex ?? 0)),
      target: node.type === 'instrument_multimeter' ? multimeterLeadPairFor(node, nodes, edges) : null
    }))
    .filter(({ node, incoming, target }) => {
      const activeEdges = incoming.filter((edge) => nodesById.has(edge.sourceNodeId));
      return node.type === 'instrument_multimeter'
        ? activeEdges.length > 0 || Boolean(target?.valid)
        : activeEdges.length > 0;
    });

  if (!instruments.length) {
    return;
  }

  sim.actual.instrumentSamples ??= {};
  sim.reference.instrumentSamples ??= {};

  instruments.forEach(({ node, incoming: incomingEdges, target }) => {
    const incoming = incomingEdges[0];
    const sourceNode = incoming ? nodesById.get(incoming.sourceNodeId) : null;
    const actualSamples = sim.actual.instrumentSamples[node.id] ??= [];
    const spectrumOnly = node.type === 'instrument_spectrum';
    const referenceSamples = spectrumOnly
      ? null
      : (sim.reference.instrumentSamples[node.id] ??= []);

    if (spectrumOnly) {
      delete sim.reference.instrumentSamples[node.id];
    }

    componentSteps.forEach((step, index) => {
      const time = Number.isFinite(Number(step?.time))
        ? Number(step.time)
        : Number.isFinite(Number(componentTimes[index]))
          ? Number(componentTimes[index])
          : Number.isFinite(Number(curveTimes[index]))
            ? Number(curveTimes[index])
            : Number(sim.time || 0);
      if (actualSamples.at(-1)?.t === time) {
        return;
      }

      if (node.type === 'instrument_multimeter') {
        const hasStandardConnection = incomingEdges.some((edge) => nodesById.has(edge.sourceNodeId));
        const actual = hasStandardConnection
          ? multimeterNodeReading(step?.actual, node, node.props?.measurementMode, incomingEdges, nodesById)
          : multimeterLeadReading(step?.actual, target, node.props?.measurementMode, nodesById, edges);
        const reference = hasStandardConnection
          ? multimeterNodeReading(step?.reference, node, node.props?.measurementMode, incomingEdges, nodesById)
          : multimeterLeadReading(step?.reference, target, node.props?.measurementMode, nodesById, edges);
        if (!Number.isFinite(actual)) return;
        pushLimitedSample(actualSamples, Number.isFinite(reference)
          ? { t: time, actual, reference }
          : { t: time, actual }, sampleLimit);
        if (Number.isFinite(reference)) {
          pushLimitedSample(referenceSamples, { t: time, actual: reference, reference }, sampleLimit);
        }
        return;
      }

      const vectorIndex = spectrumOnly ? selectedInstrumentVectorIndex(node) : null;
      const actual = outputValueForPort(
        step?.actual?.[incoming.sourceNodeId],
        sourceNode,
        incoming.sourcePortIndex,
        vectorIndex
      );
      if (!Number.isFinite(actual)) {
        return;
      }

      if (spectrumOnly) {
        pushLimitedSample(actualSamples, { t: time, actual }, sampleLimit);
        return;
      }

      const reference = outputValueForPort(
        step?.reference?.[incoming.sourceNodeId],
        sourceNode,
        incoming.sourcePortIndex,
        vectorIndex
      );
      pushLimitedSample(actualSamples, Number.isFinite(reference)
        ? { t: time, actual, reference }
        : { t: time, actual }, sampleLimit);
      if (Number.isFinite(reference)) {
        pushLimitedSample(referenceSamples, { t: time, actual: reference, reference }, sampleLimit);
      }
    });
  });
}

function cloneComponentOutputStep(step) {
  return {
    time: Number(step?.time ?? 0),
    actual: JSON.parse(JSON.stringify(step?.actual ?? {})),
    reference: JSON.parse(JSON.stringify(step?.reference ?? {}))
  };
}

function ensureComponentOutputTrace(sim) {
  if (!sim.componentOutputs || typeof sim.componentOutputs !== 'object') {
    sim.componentOutputs = { time: [], steps: [] };
  }
  if (!Array.isArray(sim.componentOutputs.time)) {
    sim.componentOutputs.time = [];
  }
  if (!Array.isArray(sim.componentOutputs.steps)) {
    sim.componentOutputs.steps = [];
  }
  return sim.componentOutputs;
}

function ensureScopeChannelBucket(runtimeBucket, scopeId) {
  if (!runtimeBucket.scopeSamples) {
    runtimeBucket.scopeSamples = {};
  }
  const current = runtimeBucket.scopeSamples[scopeId];
  if (!current || Array.isArray(current)) {
    runtimeBucket.scopeSamples[scopeId] = { ch1: [], ch2: [] };
  } else {
    current.ch1 = current.ch1 || [];
    current.ch2 = current.ch2 || [];
  }
  return runtimeBucket.scopeSamples[scopeId];
}

function parseChannelKey(key) {
  const mode = key.endsWith('.actual') ? 'actual' : key.endsWith('.reference') ? 'reference' : '';
  if (!mode) {
    return null;
  }
  const measurementId = key.slice(0, -(mode.length + 1));
  const separatorIndex = measurementId.lastIndexOf('.');
  if (separatorIndex < 0) {
    return null;
  }
  const scopeId = measurementId.slice(0, separatorIndex);
  const channel = measurementId.slice(separatorIndex + 1);
  if (!scopeId || !['ch1', 'ch2'].includes(channel)) {
    return null;
  }
  return { scopeId, channel, mode };
}

function refreshRuntimeViews(target, status = 'stepped') {
  syncSimulationControls(target);
  target.renderScopeWindows?.();
  target.renderMultimeterWindow?.();
  target.renderSpectrumInstrument?.();
  target.renderSimulationViewPanel?.();
  target.updateUI?.();
  target.publishSimulationRuntimeSummary?.(status);
}

function setButtonEnabled(target, id, enabled) {
  const element = target.document?.getElementById?.(id);
  if (!element) {
    return;
  }
  element.classList.toggle('sim-btn-disabled', !enabled);
}

function syncSimulationControls(target) {
  const sim = getSimulationState(target);
  const state = getWorkbenchState(target);
  if (!sim || !state.sysLoaded) {
    return;
  }
  if (sim.running && !sim.paused) {
    setButtonEnabled(target, 'sbtn-init', false);
    setButtonEnabled(target, 'sbtn-run', false);
    setButtonEnabled(target, 'sbtn-step', false);
    setButtonEnabled(target, 'sbtn-pause', true);
    setButtonEnabled(target, 'sbtn-stop', true);
    target.document?.getElementById?.('sbtn-run')?.classList.add('active');
    return;
  }
  if (sim.paused) {
    setButtonEnabled(target, 'sbtn-init', false);
    setButtonEnabled(target, 'sbtn-run', true);
    setButtonEnabled(target, 'sbtn-step', true);
    setButtonEnabled(target, 'sbtn-pause', true);
    setButtonEnabled(target, 'sbtn-stop', true);
    target.document?.getElementById?.('sbtn-run')?.classList.remove('active');
    return;
  }
  if (sim.inited) {
    setButtonEnabled(target, 'sbtn-init', true);
    setButtonEnabled(target, 'sbtn-run', true);
    setButtonEnabled(target, 'sbtn-step', true);
    setButtonEnabled(target, 'sbtn-pause', false);
    setButtonEnabled(target, 'sbtn-stop', false);
    target.document?.getElementById?.('sbtn-run')?.classList.remove('active');
  }
}

function resetBackendRuntimeSamples(sim) {
  if (!sim) {
    return;
  }
  if (sim.actual) {
    sim.actual.scopeSamples = {};
    sim.actual.instrumentSamples = {};
  }
  if (sim.reference) {
    sim.reference.scopeSamples = {};
    sim.reference.instrumentSamples = {};
  }
  sim.componentOutputs = { time: [], steps: [] };
  sim.hasSamples = false;
}

export function appendBackendSimulationChunk(target, chunk, { sampleLimit = DEFAULT_SAMPLE_LIMIT } = {}) {
  const sim = getSimulationState(target);
  if (!sim || chunk?.status === 'error') {
    return false;
  }
  const times = Array.isArray(chunk?.curves?.time) ? chunk.curves.time : [];
  const channels = chunk?.curves?.channels ?? {};
  const componentOutputTrace = ensureComponentOutputTrace(sim);
  const componentOutputs = chunk?.componentOutputs ?? {};
  const componentTimes = Array.isArray(componentOutputs.time) ? componentOutputs.time : [];
  const componentSteps = Array.isArray(componentOutputs.steps) ? componentOutputs.steps : [];

  Object.entries(channels).forEach(([key, values]) => {
    const parsed = parseChannelKey(key);
    if (!parsed || !Array.isArray(values)) {
      return;
    }
    const runtimeBucket = parsed.mode === 'reference' ? sim.reference : sim.actual;
    const scopeBucket = ensureScopeChannelBucket(runtimeBucket, parsed.scopeId);
    values.forEach((value, index) => {
      const time = Number.isFinite(Number(times[index])) ? Number(times[index]) : Number(sim.time || 0);
      pushLimitedSample(scopeBucket[parsed.channel], { t: time, actual: Number(value) }, sampleLimit);
    });
  });

  componentSteps.forEach((step, index) => {
    const time = Number.isFinite(Number(step?.time))
      ? Number(step.time)
      : Number.isFinite(Number(componentTimes[index]))
        ? Number(componentTimes[index])
        : Number.isFinite(Number(times[index]))
          ? Number(times[index])
          : Number(sim.time || 0);
    componentOutputTrace.time.push(time);
    componentOutputTrace.steps.push({
      ...cloneComponentOutputStep(step),
      time
    });
  });

  appendBackendInstrumentSamples(target, componentSteps, componentTimes, times, sampleLimit);

  const metrics = chunk?.metrics ?? {};
  if (Number.isFinite(Number(metrics.time))) {
    sim.time = Number(metrics.time);
  } else if (times.length) {
    sim.time = Number((Number(times.at(-1)) + Number(sim.stepSize || 0)).toFixed(6));
  }
  if (Number.isFinite(Number(metrics.stepIndex))) {
    sim.stepIndex = Number(metrics.stepIndex);
  } else {
    sim.stepIndex = Number(sim.stepIndex || 0) + times.length;
  }
  if (Number(metrics.sampleCount ?? times.length) > 0) {
    sim.hasSamples = true;
    getWorkbenchState(target).step = 3;
  }
  if (metrics.done) {
    getWorkbenchState(target).simDone = Boolean(sim.hasSamples);
  }

  return times.length > 0;
}

function isBackendRuntimeAvailable(target) {
  const api = getBackendApi(target);
  return Boolean(
    api?.buildExecutablePackage
    && api?.createSession
    && api?.stepSession
    && api?.deleteSession
  );
}

function callLegacy(options, callback) {
  try {
    return callback?.();
  } catch (error) {
    options.onError?.(error);
    return undefined;
  }
}

async function ensureBackendSession(target, legacy, options = {}) {
  const sim = getSimulationState(target);
  const state = getWorkbenchState(target);
  const api = getBackendApi(target);
  if (!sim || !isBackendRuntimeAvailable(target)) {
    return null;
  }

  if (!sim.inited) {
    legacy.simInit?.(options.silentInit ?? true);
  }
  if (!sim.inited) {
    return null;
  }
  if (sim.backendSessionId) {
    return sim.backendSessionId;
  }

  const executablePackage = api.buildExecutablePackage(state);
  resetBackendRuntimeSamples(sim);
  const created = await api.createSession(executablePackage);
  sim.backendSessionId = created.sessionId;
  sim.backendRunId = created.runId || '';
  return sim.backendSessionId;
}

function clearBackendTimer(target, sim) {
  if (sim?.timer) {
    target.clearInterval?.(sim.timer);
    sim.timer = null;
  }
}

async function runBackendStep(target, legacy, steps = 1, options = {}) {
  const sim = getSimulationState(target);
  if (!sim) {
    return callLegacy(options, () => legacy.simStep?.());
  }
  if (sim.time >= sim.duration) {
    return { completed: true };
  }

  const sessionId = await ensureBackendSession(target, legacy);
  if (!sessionId) {
    return callLegacy(options, () => legacy.simStep?.());
  }

  const api = getBackendApi(target);
  const chunk = await api.stepSession(sessionId, { steps });
  appendBackendSimulationChunk(target, chunk);
  refreshRuntimeViews(target, chunk?.metrics?.done ? 'completed' : 'stepped');
  return { completed: Boolean(chunk?.metrics?.done), chunk };
}

export function installBackendStepSimulationRuntime(target = globalThis, options = {}) {
  if (!target || options.enabled === false || target.__GZ_BACKEND_STEP_RUNTIME_INSTALLED__) {
    return false;
  }
  target.__GZ_BACKEND_STEP_RUNTIME_INSTALLED__ = true;

  const legacy = {
    simInit: target.simInit,
    simRun: target.simRun,
    simStep: target.simStep,
    simPause: target.simPause,
    simStop: target.simStop
  };

  target.simInit = function backendSimInit(silent = false) {
    const sim = getSimulationState(target);
    const result = legacy.simInit?.(silent);
    if (sim) {
      sim.backendSessionId = '';
      sim.backendRunId = '';
      sim.componentOutputs = { time: [], steps: [] };
    }
    return result;
  };

  target.simStep = async function backendSimStep() {
    const sim = getSimulationState(target);
    if (!isBackendRuntimeAvailable(target) || !sim) {
      return callLegacy(options, () => legacy.simStep?.());
    }
    try {
      const result = await runBackendStep(target, legacy, 1, options);
      if (result?.completed) {
        await target.simStop?.('completed');
      }
      return result;
    } catch (error) {
      options.onError?.(error);
      return callLegacy(options, () => legacy.simStep?.());
    }
  };

  target.simRun = async function backendSimRun() {
    const sim = getSimulationState(target);
    if (!isBackendRuntimeAvailable(target) || !sim) {
      return callLegacy(options, () => legacy.simRun?.());
    }
    if (!sim.inited) {
      legacy.simInit?.();
      if (!sim.inited) {
        return undefined;
      }
    }
    if (sim.time >= sim.duration) {
      legacy.simInit?.(true);
    }

    sim.running = true;
    sim.paused = false;
    clearBackendTimer(target, sim);
    sim.timer = target.setInterval?.(async () => {
      if (!sim.running || sim.paused || sim.backendStepPending) {
        return;
      }
      sim.backendStepPending = true;
      try {
        const result = await runBackendStep(target, legacy, 1, options);
        if (result?.completed) {
          await target.simStop?.('completed');
        }
      } catch (error) {
        options.onError?.(error);
        clearBackendTimer(target, sim);
        callLegacy(options, () => legacy.simRun?.());
      } finally {
        sim.backendStepPending = false;
      }
    }, Math.max(Math.round(Number(sim.stepSize || 0.1) * 1000), 80));
    refreshRuntimeViews(target, 'running');
    return undefined;
  };

  target.simPause = function backendSimPause() {
    const sim = getSimulationState(target);
    if (!isBackendRuntimeAvailable(target) || !sim) {
      return callLegacy(options, () => legacy.simPause?.());
    }
    if (!sim.running) {
      return undefined;
    }
    sim.paused = !sim.paused;
    if (sim.paused) {
      clearBackendTimer(target, sim);
    } else {
      target.simRun?.();
    }
    refreshRuntimeViews(target, sim.paused ? 'paused' : 'running');
    return undefined;
  };

  target.simStop = async function backendSimStop(mode = 'manual') {
    const sim = getSimulationState(target);
    const api = getBackendApi(target);
    if (!isBackendRuntimeAvailable(target) || !sim) {
      return callLegacy(options, () => legacy.simStop?.(mode));
    }
    const sessionId = sim?.backendSessionId;
    if (sim) {
      clearBackendTimer(target, sim);
      sim.running = false;
      sim.paused = false;
      getWorkbenchState(target).simDone = Boolean(sim.hasSamples);
    }
    if (sessionId && api?.deleteSession) {
      try {
        await api.deleteSession(sessionId);
      } catch (error) {
        options.onError?.(error);
      }
    }
    if (sim) {
      sim.backendSessionId = '';
      sim.backendRunId = '';
    }
    callLegacy(options, () => legacy.simStop?.(mode));
    refreshRuntimeViews(target, mode === 'completed' ? 'completed' : 'stopped');
    return undefined;
  };

  return true;
}
