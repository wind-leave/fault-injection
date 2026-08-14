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

function parseSpectrumSampleRateHz(value, fallback = 10) {
  const text = String(value ?? '').trim();
  const amount = Number.parseFloat(text);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallback;
  }
  if (/ghz$/i.test(text)) return amount * 1e9;
  if (/mhz$/i.test(text)) return amount * 1e6;
  if (/khz$/i.test(text)) return amount * 1e3;
  return amount;
}

function shouldCaptureSpectrumSample(sim, instrumentId, configuredRate, time) {
  sim.spectrumSampling ??= {};
  const sampleState = sim.spectrumSampling[instrumentId] ?? { lastTime: null };
  const sampleInterval = 1 / parseSpectrumSampleRateHz(configuredRate);
  if (
    sampleState.lastTime !== null
    && time >= sampleState.lastTime
    && time - sampleState.lastTime < sampleInterval * (1 - 1e-9)
  ) {
    return false;
  }
  sampleState.lastTime = time;
  sim.spectrumSampling[instrumentId] = sampleState;
  return true;
}

function spectrumAnalysisSampleLimit(node) {
  const requested = Math.round(Number(node?.props?.fftSize));
  const capped = Math.min(Math.max(Number.isFinite(requested) ? requested : 1024, 16), 4096);
  let size = 16;
  while (size < capped && size < 4096) {
    size *= 2;
  }
  return size;
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

function outputPortsForNode(node) {
  const candidates = [
    node?.outputs,
    node?.props?.outputs,
    node?.pythonBinding?.portMapping?.outputs
  ];
  return candidates.find((ports) => Array.isArray(ports) && ports.length) ?? [];
}

function cloneRuntimeSignal(value) {
  return Array.isArray(value)
    ? value.map(cloneRuntimeSignal)
    : value;
}

function outputSignalForPort(outputs, node, portIndex = 0) {
  const index = Math.max(0, Math.trunc(Number(portIndex) || 0));
  if (Array.isArray(outputs) || Number.isFinite(Number(outputs))) {
    return index === 0 ? cloneRuntimeSignal(outputs) : undefined;
  }
  if (!outputs || typeof outputs !== 'object') {
    return undefined;
  }

  const port = outputPortsForNode(node)[index];
  const candidates = [
    port?.varName,
    port?.name,
    port?.key,
    port?.portId,
    port?.id,
    port?.displayName,
    port?.label,
    port?.pythonVariable,
    index === 0 ? 'output' : `output-${index + 1}`,
    `output-${index}`,
    index === 0 ? 'out' : '',
    index === 0 ? 'value' : ''
  ].filter(Boolean);

  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(outputs, key)) {
      return cloneRuntimeSignal(outputs[key]);
    }
  }
  return cloneRuntimeSignal(Object.values(outputs)[index]);
}

function orderedBackendNodeOutputs(outputs, node) {
  if (Array.isArray(outputs) || Number.isFinite(Number(outputs))) {
    return [cloneRuntimeSignal(outputs)];
  }
  if (!outputs || typeof outputs !== 'object') {
    return [];
  }
  const ports = outputPortsForNode(node);
  const count = ports.length || Object.keys(outputs).length;
  return Array.from({ length: count }, (_, index) => outputSignalForPort(outputs, node, index));
}

function syncBackendRuntimeState(target, componentSteps) {
  const sim = getSimulationState(target);
  const latestStep = componentSteps.at(-1);
  if (!sim || !latestStep) {
    return;
  }

  const state = getWorkbenchState(target);
  const nodes = workbenchItems(state, 'modelNodes');
  const edges = workbenchItems(state, 'modelEdges');
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  ['actual', 'reference'].forEach((mode) => {
    const runtimeBucket = sim[mode] ??= {};
    runtimeBucket.nodeStates ??= {};
    runtimeBucket.edgeStates ??= {};
    const stepOutputs = latestStep?.[mode];
    if (!stepOutputs || typeof stepOutputs !== 'object') {
      return;
    }

    Object.entries(stepOutputs).forEach(([nodeId, outputs]) => {
      const orderedOutputs = orderedBackendNodeOutputs(outputs, nodesById.get(nodeId));
      if (!orderedOutputs.length) {
        return;
      }
      const nodeState = runtimeBucket.nodeStates[nodeId] ??= {};
      nodeState.lastOutputs = orderedOutputs.map(cloneRuntimeSignal);
      nodeState.lastOutput = cloneRuntimeSignal(orderedOutputs[0]);
    });

    edges.forEach((edge) => {
      const sourceState = runtimeBucket.nodeStates[edge.sourceNodeId];
      const portIndex = Math.max(0, Math.trunc(Number(edge.sourcePortIndex) || 0));
      const value = sourceState?.lastOutputs?.[portIndex];
      if (value === undefined) {
        return;
      }
      const edgeState = runtimeBucket.edgeStates[edge.id] ??= {};
      edgeState.lastOutput = cloneRuntimeSignal(value);
    });
  });
}

function outputValueForPort(outputs, node, portIndex = 0, vectorIndex = null) {
  const signal = outputSignalForPort(outputs, node, portIndex);
  const selected = Array.isArray(signal)
    ? signal[Math.max(0, Math.trunc(Number(vectorIndex) || 0))]
    : signal;
  const value = Number(selected);
  return Number.isFinite(value) ? value : NaN;
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
        if (!shouldCaptureSpectrumSample(sim, node.id, node.props?.sampleRate, time)) {
          return;
        }
        // 频谱分析只需保留最近一个 FFT 窗口；分析时样本数即 min(已采集样本数, FFT 点数)。
        pushLimitedSample(actualSamples, { t: time, actual }, spectrumAnalysisSampleLimit(node));
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
  target.refreshDisplayConsolePanel?.();
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
  sim.spectrumSampling = {};
  sim.hasSamples = false;
}

function beginBackendRunGeneration(sim) {
  if (!sim) {
    return 0;
  }
  sim.backendRunGeneration = Number(sim.backendRunGeneration || 0) + 1;
  sim.backendStepPending = false;
  return sim.backendRunGeneration;
}

async function waitForBackendSessionCleanup(sim) {
  const cleanup = sim?.backendSessionCleanup;
  if (!cleanup || typeof cleanup.then !== 'function') {
    return;
  }
  try {
    await cleanup;
  } catch {
    // Cleanup failures are already reported when the cleanup is queued.
  }
}

function queueBackendSessionCleanup(sim, api, sessionId, options = {}) {
  if (!sim || !sessionId || !api?.deleteSession) {
    return Promise.resolve();
  }
  const previousCleanup = Promise.resolve(sim.backendSessionCleanup).catch(() => undefined);
  const cleanup = previousCleanup
    .then(() => api.deleteSession(sessionId))
    .catch((error) => {
      options.onError?.(error);
    });
  sim.backendSessionCleanup = cleanup;
  cleanup.finally(() => {
    if (sim.backendSessionCleanup === cleanup) {
      sim.backendSessionCleanup = null;
    }
  });
  return cleanup;
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

  syncBackendRuntimeState(target, componentSteps);
  appendBackendInstrumentSamples(target, componentSteps, componentTimes, times, sampleLimit);

  const metrics = chunk?.metrics ?? {};
  if (Number.isFinite(Number(metrics.time))) {
    sim.time = Number(metrics.time);
  } else if (times.length) {
    sim.time = Number(times.at(-1)) + Number(sim.stepSize || 0);
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

async function discardBackendSession(sim, api, options = {}) {
  const sessionId = sim?.backendSessionId || sim?.staleBackendSessionId;
  if (sim) {
    sim.backendSessionId = '';
    sim.backendRunId = '';
    sim.staleBackendSessionId = '';
  }
  await waitForBackendSessionCleanup(sim);
  await queueBackendSessionCleanup(sim, api, sessionId, options);
}

async function ensureBackendSession(target, legacy, options = {}) {
  const sim = getSimulationState(target);
  const state = getWorkbenchState(target);
  const api = getBackendApi(target);
  if (!sim || !isBackendRuntimeAvailable(target)) {
    return null;
  }

  await waitForBackendSessionCleanup(sim);

  if (!sim.inited) {
    // A topology or parameter edit marks the legacy simulation as uninitialized.
    // Its backend session is otherwise still alive and would keep the old
    // executable package (for example, the previous downconverter LO value).
    await discardBackendSession(sim, api, options);
    target.simInit?.(options.silentInit ?? true);
    await waitForBackendSessionCleanup(sim);
  }
  if (!sim.inited) {
    return null;
  }
  if (sim.backendSessionId) {
    return sim.backendSessionId;
  }

  const generation = Number(sim.backendRunGeneration || 0);
  const executablePackage = api.buildExecutablePackage(state);
  resetBackendRuntimeSamples(sim);
  const created = await api.createSession(executablePackage);
  if (generation !== Number(sim.backendRunGeneration || 0)) {
    queueBackendSessionCleanup(sim, api, created?.sessionId, options);
    return null;
  }
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

  const requestedGeneration = Number(sim.backendRunGeneration || 0);
  const sessionId = await ensureBackendSession(target, legacy, options);
  if (!sessionId) {
    if (requestedGeneration !== Number(sim.backendRunGeneration || 0)) {
      return { completed: false, stale: true };
    }
    return callLegacy(options, () => legacy.simStep?.());
  }

  const generation = Number(sim.backendRunGeneration || 0);
  const api = getBackendApi(target);
  const chunk = await api.stepSession(sessionId, { steps });
  if (
    generation !== Number(sim.backendRunGeneration || 0)
    || sim.backendSessionId !== sessionId
  ) {
    return { completed: false, stale: true, chunk };
  }
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
    const api = getBackendApi(target);
    const staleSessionId = sim?.backendSessionId || sim?.staleBackendSessionId;
    clearBackendTimer(target, sim);
    beginBackendRunGeneration(sim);
    if (sim) {
      sim.backendSessionId = '';
      sim.backendRunId = '';
      sim.staleBackendSessionId = '';
    }
    const result = legacy.simInit?.(silent);
    if (sim) {
      sim.componentOutputs = { time: [], steps: [] };
    }
    queueBackendSessionCleanup(sim, api, staleSessionId, options);
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
    if (!sim.running) {
      target.__GZ_STATUS_BAR__?.beginLiveStatus?.({
        key: 'simulation-starting',
        message: '仿真准备运行',
        source: '系统'
      });
    }
    if (!sim.inited) {
      await discardBackendSession(sim, getBackendApi(target), options);
      target.simInit?.();
      if (!sim.inited) {
        return undefined;
      }
    }
    if (sim.time >= sim.duration) {
      await discardBackendSession(sim, getBackendApi(target), options);
      target.simInit?.(true);
    }

    const runGeneration = Number(sim.backendRunGeneration || 0);
    sim.running = true;
    sim.paused = false;
    clearBackendTimer(target, sim);
    sim.timer = target.setInterval?.(async () => {
      if (
        runGeneration !== Number(sim.backendRunGeneration || 0)
        || !sim.running
        || sim.paused
        || sim.backendStepPending
      ) {
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
        if (runGeneration === Number(sim.backendRunGeneration || 0)) {
          sim.backendStepPending = false;
        }
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
      beginBackendRunGeneration(sim);
      sim.backendSessionId = '';
      sim.backendRunId = '';
      sim.running = false;
      sim.paused = false;
      getWorkbenchState(target).simDone = Boolean(sim.hasSamples);
    }
    callLegacy(options, () => legacy.simStop?.(mode));
    refreshRuntimeViews(target, mode === 'completed' ? 'completed' : 'stopped');
    await queueBackendSessionCleanup(sim, api, sessionId, options);
    return undefined;
  };

  return true;
}
