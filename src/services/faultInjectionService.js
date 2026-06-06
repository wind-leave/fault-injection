export const FAULT_LAYER_LABELS = Object.freeze({
  physical: '物理层',
  electrical: '电气层',
  protocol: '协议层'
});

export const FAULT_RUNTIME_BEHAVIOR_BY_ID = Object.freeze({
  physical_parameter_bias: 'parameter_bias',
  physical_parameter_drift: 'parameter_drift',
  physical_parameter_step: 'parameter_step',
  actuator_lock_or_failure: 'lock',
  saturation_limit: 'saturation',
  sensor_additive_bias: 'additive_bias',
  fault_bias_overlay: 'additive_bias',
  sensor_scale_distortion: 'scale',
  noise_increase: 'noise',
  fault_noise_injection: 'noise',
  colored_noise: 'colored_noise',
  signal_freeze: 'freeze',
  state_jump_or_sign_flip: 'jump_or_invert',
  intermittent_anomaly: 'intermittent',
  fixed_delay: 'fixed_delay',
  time_varying_delay: 'jitter_delay',
  random_packet_loss: 'packet_loss',
  burst_packet_loss: 'burst_loss',
  data_tamper: 'tamper',
  blocking_interrupt: 'interrupt'
});

export const FAULT_PROPAGATION_MODES = Object.freeze({
  localOnly: 'localOnly',
  signalTransform: 'signalTransform',
  parameterInfluence: 'parameterInfluence',
  protocolEdge: 'protocolEdge',
  derivedResidual: 'derivedResidual'
});

const FAULT_PROPAGATION_MODE_VALUES = new Set(Object.values(FAULT_PROPAGATION_MODES));

export const FAULT_TARGET_MODULES_BY_ID = Object.freeze({
  physical_parameter_bias: ['vehicle_dynamics', 'attitude_pid', 'control_allocation'],
  physical_parameter_drift: ['motor_model', 'barometer'],
  physical_parameter_step: ['motor_model', 'control_allocation', 'vehicle_dynamics'],
  actuator_lock_or_failure: ['motor_model', 'control_allocation'],
  saturation_limit: ['motor_model'],
  sensor_additive_bias: ['imu_gyro', 'barometer', 'gps_velocity'],
  fault_bias_overlay: ['imu_gyro', 'barometer', 'gps_velocity'],
  sensor_scale_distortion: ['imu_accel', 'gps_velocity'],
  noise_increase: ['imu_gyro', 'imu_accel', 'barometer'],
  fault_noise_injection: ['imu_gyro', 'imu_accel', 'barometer'],
  colored_noise: ['imu_gyro', 'barometer'],
  signal_freeze: ['gps_velocity'],
  state_jump_or_sign_flip: ['imu_gyro', 'attitude_pid'],
  intermittent_anomaly: ['imu_gyro', 'barometer', 'gps_velocity'],
  fixed_delay: ['gps_velocity', 'imu_gyro', 'barometer'],
  time_varying_delay: ['gps_velocity', 'imu_gyro', 'barometer'],
  random_packet_loss: ['gps_velocity'],
  burst_packet_loss: ['gps_velocity'],
  data_tamper: ['gps_velocity', 'attitude_pid'],
  blocking_interrupt: ['gps_velocity', 'imu_gyro', 'barometer']
});

const PROTOCOL_FAULT_CODE_BEHAVIOR = Object.freeze({
  delay: 'fixed_delay',
  loss: 'packet_loss',
  bitflip: 'bitflip',
  replay: 'replay'
});

const RUNTIME_BEHAVIOR_ALIASES = Object.freeze({
  bias: 'additive_bias',
  drift: 'parameter_drift',
  step: 'parameter_step',
  degradation: 'scale',
  random: 'noise',
  delay: 'fixed_delay',
  dropout: 'packet_loss',
  stale: 'interrupt'
});

const PYTHON_KIND_BY_BEHAVIOR = Object.freeze({
  parameter_bias: 'bias',
  additive_bias: 'bias',
  parameter_drift: 'drift',
  parameter_step: 'step',
  lock: 'lock',
  saturation: 'saturation',
  scale: 'scale',
  noise: 'gaussian_noise',
  colored_noise: 'colored_noise',
  freeze: 'freeze',
  jump_or_invert: 'sign_flip',
  intermittent: 'intermittent',
  fixed_delay: 'delay',
  jitter_delay: 'jitter_delay',
  packet_loss: 'packet_loss',
  burst_loss: 'burst_loss',
  tamper: 'tamper',
  interrupt: 'interrupt',
  bitflip: 'bitflip',
  replay: 'replay'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeRuntimeBehavior(value) {
  const key = normalizeKey(value);
  return RUNTIME_BEHAVIOR_ALIASES[key] ?? key;
}

function asNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^\d+\-.eE]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on', '启用'].includes(String(value).trim().toLowerCase());
}

function clamp(value, lower, upper) {
  let result = value;
  if (Number.isFinite(lower)) {
    result = Math.max(lower, result);
  }
  if (Number.isFinite(upper)) {
    result = Math.min(upper, result);
  }
  return result;
}

function unitNoise(seed = 1, stepIndex = 0, time = 0) {
  const raw = Math.sin(seed * 12.9898 + stepIndex * 78.233 + time * 5.173) * 43758.5453;
  return raw - Math.floor(raw);
}

function signedNoise(seed = 1, stepIndex = 0, time = 0) {
  return unitNoise(seed, stepIndex, time) * 2 - 1;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readParam(params, keys, fallback = null) {
  const names = Array.isArray(keys) ? keys : [keys];
  for (const key of names) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const raw = params[key];
      if (raw !== null && raw !== undefined && raw !== '') {
        return raw;
      }
    }
  }
  return fallback;
}

export function getFaultRuntimeBehavior(faultModel = {}) {
  if (hasText(faultModel.runtimeBehavior) && faultModel.runtimeBehavior !== 'catalog_only') {
    return normalizeRuntimeBehavior(faultModel.runtimeBehavior);
  }

  if (hasText(faultModel.id) && FAULT_RUNTIME_BEHAVIOR_BY_ID[faultModel.id]) {
    return normalizeRuntimeBehavior(FAULT_RUNTIME_BEHAVIOR_BY_ID[faultModel.id]);
  }

  if (hasText(faultModel.faultTypeId) && FAULT_RUNTIME_BEHAVIOR_BY_ID[faultModel.faultTypeId]) {
    return normalizeRuntimeBehavior(FAULT_RUNTIME_BEHAVIOR_BY_ID[faultModel.faultTypeId]);
  }

  if (hasText(faultModel.faultCode) && PROTOCOL_FAULT_CODE_BEHAVIOR[faultModel.faultCode]) {
    return normalizeRuntimeBehavior(PROTOCOL_FAULT_CODE_BEHAVIOR[faultModel.faultCode]);
  }

  const text = [
    faultModel.name,
    faultModel.modelClass,
    faultModel.faultKind,
    ...ensureArray(faultModel.tags)
  ].join(' ');

  if (/延迟|delay/i.test(text)) {
    return 'fixed_delay';
  }
  if (/丢包|packet\s*loss|drop[_\s-]?rate|loss[_\s-]?rate/i.test(text) || (faultModel.layer === 'protocol' && /loss/i.test(text))) {
    return 'packet_loss';
  }
  if (/翻转|bitflip/i.test(text)) {
    return 'bitflip';
  }
  if (/重放|replay/i.test(text)) {
    return 'replay';
  }
  if (/噪声|noise/i.test(text)) {
    return 'noise';
  }
  if (/冻结|阻塞|freeze|interrupt/i.test(text)) {
    return faultModel.layer === 'protocol' ? 'interrupt' : 'freeze';
  }
  if (/比例|scale|效率/i.test(text)) {
    return 'scale';
  }
  if (/偏置|偏差|bias/i.test(text)) {
    return 'additive_bias';
  }

  return '';
}

function normalizePropagationMode(value) {
  return FAULT_PROPAGATION_MODE_VALUES.has(value) ? value : '';
}

export function inferFaultPropagationMode(faultModel = {}, injectedFault = {}) {
  const explicit = normalizePropagationMode(
    injectedFault.propagationMode
      ?? faultModel.propagationMode
      ?? faultModel.injectionDesign?.propagationMode
      ?? faultModel.injectionDesign?.propagation?.mode
  );
  if (explicit) {
    return explicit;
  }

  const layer = injectedFault.layer ?? faultModel.layer ?? '';
  const targetKind = faultModel.injectionDesign?.targetKind ?? '';
  const behavior = getFaultRuntimeBehavior(faultModel) || getFaultRuntimeBehavior(injectedFault);

  if (isProtocolFaultLayer(layer) || targetKind === 'protocol_edge_fault') {
    return FAULT_PROPAGATION_MODES.protocolEdge;
  }

  if (targetKind === 'parameter_patch' || /^parameter_/.test(behavior)) {
    return FAULT_PROPAGATION_MODES.parameterInfluence;
  }

  const descriptor = [
    faultModel.id,
    faultModel.faultTypeId,
    faultModel.name,
    faultModel.parameter,
    faultModel.faultKind,
    injectedFault.modelId,
    injectedFault.parameter
  ].join(' ');
  if (/motor|actuator|efficiency|lock|saturation|thrust/i.test(descriptor)) {
    return FAULT_PROPAGATION_MODES.signalTransform;
  }

  if (behavior) {
    return FAULT_PROPAGATION_MODES.signalTransform;
  }

  return FAULT_PROPAGATION_MODES.localOnly;
}

export function resolveFaultParameters(faultModel = {}, injectedFault = {}) {
  return {
    ...(faultModel.defaultParameters ?? {}),
    ...(faultModel.parameters ?? {}),
    ...(injectedFault.parameters ?? {})
  };
}

export function isFaultActive(params = {}, time = 0) {
  const start = asNumber(params.start, 0);
  const duration = params.duration;

  if (time < start) {
    return false;
  }

  if (duration === null || duration === undefined || duration === '') {
    return true;
  }

  return time <= start + asNumber(duration, Number.POSITIVE_INFINITY);
}

export function applyScalarFault(value, options = {}) {
  const faultModel = options.faultModel ?? {};
  const injectedFault = options.injectedFault ?? {};
  const params = options.params ?? resolveFaultParameters(faultModel, injectedFault);
  const behavior = normalizeRuntimeBehavior(
    options.behavior || getFaultRuntimeBehavior(faultModel) || getFaultRuntimeBehavior(injectedFault)
  );
  const state = options.state ?? {};
  const time = asNumber(options.time, 0);
  const dt = Math.max(asNumber(options.dt, 0.1), 0.0001);
  const seed = asNumber(options.seed, 1);
  const stepIndex = asNumber(options.stepIndex, 0);
  const input = asNumber(value, 0);

  state.lastDropout = false;
  state.lastFaultGap = false;

  if (!behavior || !isFaultActive(params, time)) {
    state.previousValue = input;
    state.holdValue = input;
    return input;
  }

  if (behavior === 'parameter_bias' || behavior === 'additive_bias') {
    const offset = asNumber(readParam(params, ['offset', 'delta_p', 'bias'], 0), 0);
    return input + offset;
  }

  if (behavior === 'scale') {
    return input * asNumber(params.scale, 1);
  }

  if (behavior === 'parameter_drift') {
    const rate = asNumber(params.rate, 0);
    const maxDelta = params.max_delta === undefined ? null : Math.abs(asNumber(params.max_delta, 0));
    let delta = Math.max(time - asNumber(params.start, 0), 0) * rate;
    if (maxDelta !== null) {
      delta = clamp(delta, -maxDelta, maxDelta);
    }
    return input + delta;
  }

  if (behavior === 'parameter_step') {
    return input + asNumber(readParam(params, ['step_value', 'step', 'jump'], 0), 0);
  }

  if (behavior === 'lock') {
    return asNumber(readParam(params, ['lock_value', 'value', 'fault_value'], 0), 0);
  }

  if (behavior === 'saturation') {
    const lower = params.lower === null || params.lower === undefined || params.lower === ''
      ? Number.NEGATIVE_INFINITY
      : asNumber(params.lower, Number.NEGATIVE_INFINITY);
    const upper = params.upper === null || params.upper === undefined || params.upper === ''
      ? Number.POSITIVE_INFINITY
      : asNumber(params.upper, Number.POSITIVE_INFINITY);
    return clamp(input, lower, upper);
  }

  if (behavior === 'noise') {
    const noiseType = normalizeKey(params.noise_type || params.kind || 'gaussian');
    if (noiseType.includes('pulse') && unitNoise(seed, stepIndex, time) > 1 - asNumber(params.probability, 0.03)) {
      return input + Math.sign(signedNoise(seed + 17, stepIndex, time) || 1) * asNumber(params.amplitude, 0.2);
    }
    const amplitude = noiseType.includes('white')
      ? asNumber(params.amplitude, 0.2)
      : asNumber(params.std, 0.08);
    return input + signedNoise(seed, stepIndex, time) * amplitude;
  }

  if (behavior === 'colored_noise') {
    const alpha = clamp(asNumber(params.alpha, 0.92), 0, 0.999);
    const std = asNumber(params.std, 0.03);
    state.previousNoise = alpha * asNumber(state.previousNoise, 0) + signedNoise(seed, stepIndex, time) * std;
    return input + state.previousNoise;
  }

  if (behavior === 'freeze') {
    const freezeMode = normalizeKey(readParam(params, 'mode', 'hold'));
    const configuredValue = readParam(params, ['value', 'hold_value', 'fault_value', 'lock_value'], null);
    if (freezeMode === 'zero') {
      return 0;
    }
    if (configuredValue !== null && freezeMode !== 'hold') {
      return asNumber(configuredValue, input);
    }
    if (!state.hasHoldValue) {
      state.holdValue = Number.isFinite(state.previousValue) ? state.previousValue : input;
      state.hasHoldValue = true;
    }
    return asNumber(state.holdValue, input);
  }

  if (behavior === 'jump_or_invert') {
    const inverted = asBoolean(params.invert, true);
    const base = inverted ? -input : input;
    return base + asNumber(params.jump, 0);
  }

  if (behavior === 'intermittent') {
    const period = Math.max(asNumber(params.period, 4), dt);
    const duty = clamp(asNumber(params.duty, 0.25), 0, 1);
    const phase = ((time - asNumber(params.start, 0)) % period) / period;
    if (phase > duty) {
      state.previousValue = input;
      return input;
    }
    const inner = params.inner_fault_type || params.inner_kind || 'noise';
    return applyScalarFault(input, {
      ...options,
      behavior: inner === 'bias' ? 'additive_bias' : inner,
      params: { ...params, start: 0 },
      state
    });
  }

  if (behavior === 'fixed_delay') {
    const delaySteps = Math.max(Math.round(asNumber(
      readParam(params, 'delay_steps', asNumber(params.delay_seconds, 0.3) / dt),
      1
    )), 0);
    state.delayQueue = Array.isArray(state.delayQueue) ? state.delayQueue : [];
    state.delayQueue.push(input);
    if (state.delayQueue.length <= delaySteps) {
      return asNumber(state.previousValue, 0);
    }
    const delayed = state.delayQueue.shift();
    state.previousValue = delayed;
    return asNumber(delayed, input);
  }

  if (behavior === 'jitter_delay') {
    const baseSteps = Math.max(Math.round(asNumber(params.base_steps, 1)), 0);
    const jitterSteps = Math.max(Math.round(Math.abs(asNumber(params.jitter_steps, 1))), 0);
    const jitter = Math.round(unitNoise(seed, stepIndex, time) * jitterSteps);
    return applyScalarFault(input, {
      ...options,
      behavior: 'fixed_delay',
      params: { ...params, delay_steps: baseSteps + jitter },
      state
    });
  }

  if (behavior === 'packet_loss') {
    const dropRate = clamp(asNumber(readParam(params, ['drop_rate', 'loss_rate'], 0.08), 0.08), 0, 1);
    if (unitNoise(seed, stepIndex, time) <= dropRate) {
      state.lastDropout = true;
      state.lastFaultGap = true;
      return params.strategy === 'zero' ? 0 : asNumber(state.previousValue, 0);
    }
    state.previousValue = input;
    return input;
  }

  if (behavior === 'burst_loss') {
    state.burstRemaining = Math.max(Math.round(asNumber(state.burstRemaining, 0)), 0);
    if (state.burstRemaining > 0) {
      state.burstRemaining -= 1;
      state.lastDropout = true;
      state.lastFaultGap = true;
      return params.strategy === 'zero' ? 0 : asNumber(state.previousValue, 0);
    }
    const probability = clamp(asNumber(params.start_probability, 0.02), 0, 1);
    if (unitNoise(seed, stepIndex, time) <= probability) {
      state.burstRemaining = Math.max(Math.round(asNumber(params.burst_length, 5)) - 1, 0);
      state.lastDropout = true;
      state.lastFaultGap = true;
      return params.strategy === 'zero' ? 0 : asNumber(state.previousValue, 0);
    }
    state.previousValue = input;
    return input;
  }

  if (behavior === 'tamper') {
    const tampered = input * asNumber(params.scale, 1) + asNumber(params.bias, 0);
    return asBoolean(params.invert, false) ? -tampered : tampered;
  }

  if (behavior === 'interrupt') {
    if (asBoolean(params.enable, true)) {
      state.lastDropout = true;
      state.lastFaultGap = true;
      return params.strategy === 'zero' ? 0 : asNumber(state.previousValue, 0);
    }
    state.previousValue = input;
    return input;
  }

  if (behavior === 'bitflip') {
    return (Math.round(input * 256) ^ 0b1000) / 256;
  }

  if (behavior === 'replay') {
    state.history = Array.isArray(state.history) ? state.history : [];
    const replayDepth = Math.max(Math.round(asNumber(params.replay_depth, 6)), 1);
    const replayPeriod = Math.max(Math.round(asNumber(params.replay_period, 10)), 1);
    const replaying = state.history.length > replayDepth && stepIndex > replayDepth && stepIndex % replayPeriod === 0;
    const replayed = replaying ? state.history[Math.max(0, state.history.length - replayDepth)] : input;
    state.history.push(input);
    if (state.history.length > 40) {
      state.history.shift();
    }
    state.previousValue = replayed;
    return asNumber(replayed, input);
  }

  return input;
}

export function createInjectedFaultPayload(faultModel = {}, parameterOverrides = {}) {
  const params = resolveFaultParameters(faultModel, { parameters: parameterOverrides });
  return {
    modelId: faultModel.id ?? faultModel.faultTypeId ?? '',
    name: faultModel.name ?? faultModel.id ?? 'Fault Model',
    layer: faultModel.layer ?? 'electrical',
    tags: clone(faultModel.tags ?? []),
    desc: faultModel.desc ?? '',
    faultKind: faultModel.faultKind ?? faultModel.modelClass ?? '',
    faultCode: faultModel.faultCode ?? '',
    runtimeBehavior: getFaultRuntimeBehavior(faultModel),
    parameters: params
  };
}

function looksLikeInjectedFault(value) {
  return isPlainObject(value) && (
    hasText(value.modelId)
    || hasText(value.faultModelId)
    || hasText(value.runtimeBehavior)
    || isPlainObject(value.parameters)
  );
}

function normalizeInjectedPayload(faultModel = {}, injectedFaultOrParameters = {}) {
  if (looksLikeInjectedFault(injectedFaultOrParameters)) {
    return {
      ...createInjectedFaultPayload(faultModel, injectedFaultOrParameters.parameters ?? {}),
      ...injectedFaultOrParameters,
      parameters: resolveFaultParameters(faultModel, injectedFaultOrParameters)
    };
  }
  return createInjectedFaultPayload(faultModel, injectedFaultOrParameters);
}

function createBindingId(faultModelId, context = {}, payload = {}) {
  return [
    faultModelId || payload.name || 'fault',
    context.targetId || payload.targetId || '',
    context.slotId || payload.slotId || payload.targetSlotId || '',
    context.targetKind || payload.targetKind || payload.layer || 'target'
  ].filter(Boolean).join('::');
}

export function createFaultBinding(faultModel = {}, injectedFaultOrParameters = {}, context = {}) {
  const payload = normalizeInjectedPayload(faultModel, injectedFaultOrParameters);
  const faultModelId = payload.modelId || payload.faultModelId || faultModel.id || faultModel.faultTypeId || '';
  const targetKind = context.targetKind
    ?? faultModel.injectionDesign?.targetKind
    ?? (isProtocolFaultLayer(payload.layer) ? 'edge' : 'node');
  const propagationMode = normalizePropagationMode(context.propagationMode)
    || inferFaultPropagationMode(faultModel, payload);

  return {
    bindingId: context.bindingId || createBindingId(faultModelId, context, payload),
    faultModelId,
    name: payload.name || faultModel.name || faultModelId || 'Fault Model',
    layer: payload.layer || faultModel.layer || 'electrical',
    runtimeBehavior: payload.runtimeBehavior || getFaultRuntimeBehavior(faultModel),
    parameters: clone(payload.parameters ?? {}),
    targetKind,
    targetId: context.targetId || payload.targetId || '',
    slotId: context.slotId || payload.slotId || payload.targetSlotId || '',
    slotName: context.slotName || payload.slotName || '',
    bindingObject: context.bindingObject || payload.bindingObject || '',
    targetVariable: context.targetVariable || payload.targetVariable || payload.bindingObject || '',
    targetField: context.targetField || payload.targetField || '',
    visualRole: context.visualRole || 'fault-source',
    propagationMode,
    canPropagate: propagationMode !== FAULT_PROPAGATION_MODES.localOnly,
    active: context.active ?? true,
    injectedFault: payload
  };
}

function getBindingKey(binding = {}) {
  return binding.bindingId || [
    binding.faultModelId || binding.modelId || binding.name || 'fault',
    binding.targetId || '',
    binding.targetKind || binding.layer || 'target'
  ].join('::');
}

function bindingMatches(left = {}, right = {}) {
  const leftKey = getBindingKey(left);
  const rightKey = getBindingKey(right);
  if (leftKey && rightKey && leftKey === rightKey) {
    return true;
  }
  const leftSlot = left.slotId || left.targetSlotId || left.injectedFault?.slotId || '';
  const rightSlot = right.slotId || right.targetSlotId || right.injectedFault?.slotId || '';
  if (leftSlot || rightSlot) {
    return Boolean(left.faultModelId && right.faultModelId && left.faultModelId === right.faultModelId)
      && (left.targetKind || '') === (right.targetKind || '')
      && (left.targetId || '') === (right.targetId || '')
      && leftSlot === rightSlot;
  }
  return Boolean(left.faultModelId && right.faultModelId && left.faultModelId === right.faultModelId)
    && (left.targetKind || '') === (right.targetKind || '')
    && (left.targetId || '') === (right.targetId || '');
}

function normalizeFaultBinding(binding = {}, target = {}) {
  const targetKind = binding.targetKind || (target.sourceNodeId && target.targetNodeId ? 'edge' : 'node');
  const payload = binding.injectedFault ?? {
    modelId: binding.faultModelId || binding.modelId || '',
    name: binding.name || binding.faultModelId || 'Fault Model',
    layer: binding.layer || 'electrical',
    runtimeBehavior: binding.runtimeBehavior || '',
    parameters: clone(binding.parameters ?? {})
  };
  const propagationMode = normalizePropagationMode(binding.propagationMode)
    || inferFaultPropagationMode(binding, payload);
  const normalized = {
    ...binding,
    bindingId: binding.bindingId || createBindingId(binding.faultModelId || payload.modelId, {
      targetId: binding.targetId || target.id,
      targetKind,
      slotId: binding.slotId || binding.targetSlotId || payload.slotId || ''
    }, payload),
    faultModelId: binding.faultModelId || payload.modelId || payload.faultModelId || '',
    name: binding.name || payload.name || 'Fault Model',
    layer: binding.layer || payload.layer || 'electrical',
    runtimeBehavior: binding.runtimeBehavior || payload.runtimeBehavior || '',
    parameters: clone(binding.parameters ?? payload.parameters ?? {}),
    targetKind,
    targetId: binding.targetId || target.id || '',
    slotId: binding.slotId || binding.targetSlotId || payload.slotId || '',
    slotName: binding.slotName || payload.slotName || '',
    bindingObject: binding.bindingObject || payload.bindingObject || '',
    targetVariable: binding.targetVariable || payload.targetVariable || payload.bindingObject || '',
    targetField: binding.targetField || payload.targetField || '',
    visualRole: binding.visualRole || 'fault-source',
    propagationMode,
    canPropagate: binding.canPropagate ?? propagationMode !== FAULT_PROPAGATION_MODES.localOnly,
    active: binding.active ?? true,
    injectedFault: payload
  };
  normalized.injectedFault = {
    ...payload,
    modelId: normalized.faultModelId || payload.modelId || '',
    name: normalized.name,
    layer: normalized.layer,
    runtimeBehavior: normalized.runtimeBehavior,
    slotId: normalized.slotId,
    slotName: normalized.slotName,
    bindingObject: normalized.bindingObject,
    targetVariable: normalized.targetVariable,
    targetField: normalized.targetField,
    parameters: clone(normalized.parameters)
  };
  return normalized;
}

export function appendFaultBinding(target = {}, binding = {}) {
  if (!target || !isPlainObject(target)) {
    return [];
  }

  const normalized = normalizeFaultBinding(binding, target);
  const bindings = ensureArray(target.faultBindings).map((item) => normalizeFaultBinding(item, target));
  const existingIndex = bindings.findIndex((item) => bindingMatches(item, normalized));
  if (existingIndex >= 0) {
    bindings[existingIndex] = { ...bindings[existingIndex], ...normalized };
  } else {
    bindings.push(normalized);
  }

  target.faultBindings = bindings;
  target.injectedFault = normalized.injectedFault;
  return target.faultBindings;
}

export function getFaultBindings(target = {}, options = {}) {
  const bindings = ensureArray(target.faultBindings).map((item) => normalizeFaultBinding(item, target));
  if (bindings.length === 0 && target.injectedFault) {
    bindings.push(normalizeFaultBinding({
      faultModelId: target.injectedFault.modelId || target.injectedFault.faultModelId || '',
      name: target.injectedFault.name,
      layer: target.injectedFault.layer,
      runtimeBehavior: target.injectedFault.runtimeBehavior,
      parameters: target.injectedFault.parameters,
      injectedFault: target.injectedFault
    }, target));
  }

  return options.activeOnly
    ? bindings.filter((binding) => binding.active !== false)
    : bindings;
}

export function hasActiveFaultBinding(target = {}) {
  return getFaultBindings(target, { activeOnly: true }).length > 0;
}

export function applyScalarFaultBindings(value, options = {}) {
  const target = options.target ?? {};
  const bindings = getFaultBindings(target, { activeOnly: true });
  if (bindings.length === 0) {
    return value;
  }

  const bucket = options.stateBucket ?? options.state ?? {};
  bucket.bindingStates = isPlainObject(bucket.bindingStates) ? bucket.bindingStates : {};
  bucket.lastDropout = false;
  bucket.lastFaultGap = false;
  const resolveFaultModel = typeof options.resolveFaultModel === 'function'
    ? options.resolveFaultModel
    : null;

  return bindings.reduce((currentValue, binding, index) => {
    const resolvedModel = resolveFaultModel?.(binding) ?? binding.injectedFault ?? binding;
    const behavior = binding.runtimeBehavior
      || getFaultRuntimeBehavior(resolvedModel)
      || getFaultRuntimeBehavior(binding.injectedFault);
    if (!behavior) {
      return currentValue;
    }

    const stateKey = binding.bindingId || binding.faultModelId || `fault-${index}`;
    bucket.bindingStates[stateKey] = isPlainObject(bucket.bindingStates[stateKey])
      ? bucket.bindingStates[stateKey]
      : {};

    const nextValue = applyScalarFault(currentValue, {
      faultModel: resolvedModel,
      injectedFault: binding.injectedFault ?? binding,
      params: binding.parameters,
      behavior,
      state: bucket.bindingStates[stateKey],
      time: options.time,
      dt: options.dt,
      stepIndex: options.stepIndex,
      seed: asNumber(options.seed, 1) + index
    });

    if (bucket.bindingStates[stateKey].lastDropout) {
      bucket.lastDropout = true;
      bucket.lastFaultGap = true;
    }

    return nextValue;
  }, value);
}

function getNodeModuleKeys(node = {}) {
  const binding = node.pythonBinding ?? {};
  return [
    node.id,
    node.type,
    node.props?.name,
    node.props?.moduleType,
    binding.moduleId,
    binding.moduleName,
    binding.fileName,
    binding.sourcePackageName
  ]
    .filter(hasText)
    .map(normalizeKey);
}

function isConfigurableSignalNode(node = {}) {
  return node.type === 'simulation_block' || node.type === 'flow_block';
}

function targetModulesForFault(faultModel = {}) {
  const id = faultModel.id ?? faultModel.faultTypeId;
  const explicit = ensureArray(faultModel.moduleTargets);
  const mapped = id ? FAULT_TARGET_MODULES_BY_ID[id] ?? [] : [];
  return [...new Set([...explicit, ...mapped].map(normalizeKey).filter(Boolean))];
}

function isProtocolFaultLayer(layer) {
  return layer === 'protocol' || layer === 'communication';
}

function nodeMatchesFaultTargets(node, faultModel) {
  if (!isConfigurableSignalNode(node)) {
    return false;
  }

  const targets = targetModulesForFault(faultModel);
  if (targets.length === 0) {
    return true;
  }

  const nodeKeys = getNodeModuleKeys(node);
  return targets.some((target) => nodeKeys.some((key) => (
    target.startsWith('node-')
      ? key === target
      : key.includes(target) || target.includes(key)
  )));
}

function getCanEdgeModuleKeys(edge = {}) {
  return [
    edge.id,
    edge.signalId,
    edge.channelId,
    edge.messageId,
    edge.sourceNodeId,
    edge.targetNodeId,
    edge.sourceNodeId && edge.targetNodeId ? `${edge.sourceNodeId}-${edge.targetNodeId}` : '',
    edge.sourceNodeId && edge.targetNodeId ? `${edge.targetNodeId}-${edge.sourceNodeId}` : '',
    ...ensureArray(edge.signalChannels).flatMap((channel) => [
      channel?.signalId,
      channel?.channelId,
      channel?.messageId
    ])
  ]
    .filter(hasText)
    .map(normalizeKey);
}

function canEdgeMatchesFaultTargets(edge, faultModel) {
  if (edge?.lineType !== 'can') {
    return false;
  }

  const targets = targetModulesForFault(faultModel);
  if (targets.length === 0) {
    return false;
  }

  const edgeKeys = getCanEdgeModuleKeys(edge);
  return targets.some((target) => edgeKeys.some((key) => key.includes(target) || target.includes(key)));
}

function faultIdentityCandidates(faultModel = {}) {
  return [
    faultModel.id,
    faultModel.faultTypeId,
    faultModel.modelId,
    faultModel.faultModelId,
    faultModel.catalogTypeId
  ].filter(hasText);
}

function getSlotAllowedFaultIds(slot = {}) {
  return [
    ...ensureArray(slot.allowedFaultIds),
    ...ensureArray(slot.allowedFaultTypeIds),
    ...ensureArray(slot.compatibleFaultIds),
    ...ensureArray(slot.compatibleFaultTypeIds)
  ].filter(hasText);
}

function slotLayerMatches(slot = {}, layer = 'electrical') {
  const slotLayer = slot.layer ?? slot.layerKey ?? '';
  return !slotLayer || slotLayer === layer || (isProtocolFaultLayer(layer) && isProtocolFaultLayer(slotLayer));
}

function slotAllowsFault(slot = {}, faultModel = {}) {
  const allowed = getSlotAllowedFaultIds(slot);
  if (allowed.length === 0) {
    return false;
  }
  const identities = new Set(faultIdentityCandidates(faultModel));
  return allowed.some((id) => identities.has(id));
}

function targetKindFor(target = {}) {
  return target.sourceNodeId && target.targetNodeId ? 'edge' : 'node';
}

function getTargetCapabilitySlots(target = {}, targetKind = 'node', capabilityMap = []) {
  const slots = ensureArray(target.faultSlots);
  const capability = ensureArray(capabilityMap).find((entry) => (
    entry?.targetId === target.id && (entry.targetKind || targetKind) === targetKind
  ));
  return [
    ...slots,
    ...ensureArray(capability?.faultSlots)
  ];
}

function targetAllowsFaultBySlot(target = {}, faultModel = {}, context = {}) {
  const targetKind = targetKindFor(target);
  const layer = faultModel.layer ?? 'electrical';
  const match = getTargetCapabilitySlots(target, targetKind, context.faultCapabilityMap)
    .find((slot) => slotLayerMatches(slot, layer) && slotAllowsFault(slot, faultModel));
  return match || null;
}

function findTargetByAllowedSlot(targets = [], faultModel = {}, context = {}) {
  for (const target of targets) {
    const slot = targetAllowsFaultBySlot(target, faultModel, context);
    if (slot) {
      return {
        kind: targetKindFor(target),
        id: target.id,
        reason: 'fault-slot',
        slotId: slot.slotId || slot.id || ''
      };
    }
  }
  return null;
}

function explicitTargetIdsForFault(faultModel = {}, kind = 'node') {
  const visual = faultModel.visualInjection ?? {};
  const design = faultModel.injectionDesign ?? {};
  const target = faultModel.injectionTarget ?? {};
  const typicalTargets = ensureArray(faultModel.typicalTargets);
  const moduleTargets = ensureArray(faultModel.moduleTargets);
  const ids = kind === 'edge'
    ? [
      faultModel.targetEdgeId,
      faultModel.targetEdgeID,
      design.targetEdgeId,
      design.edgeId,
      visual.targetKind === 'edge' ? visual.targetId : '',
      target.edgeId,
      ...typicalTargets.filter((item) => String(item).startsWith('edge-'))
    ]
    : [
      faultModel.targetNodeId,
      faultModel.targetNodeID,
      faultModel.recommendedModuleId,
      design.targetNodeId,
      design.targetKind === 'node' ? design.targetId : '',
      visual.targetKind === 'node' ? visual.targetId : '',
      target.nodeId,
      ...typicalTargets.filter((item) => String(item).startsWith('node-'))
    ];
  return [...new Set(ids.filter(hasText))];
}

function findExplicitTarget(targets = [], faultModel = {}, kind = 'node') {
  const ids = explicitTargetIdsForFault(faultModel, kind);
  if (ids.length === 0) {
    return null;
  }
  const target = targets.find((item) => ids.includes(item.id));
  return target ? { kind, id: target.id, reason: 'explicit-target' } : null;
}

export function findCompatibleFaultTarget(faultModel = {}, context = {}) {
  const nodes = ensureArray(context.nodes);
  const edges = ensureArray(context.edges);
  const layer = faultModel.layer ?? 'electrical';

  if (isProtocolFaultLayer(layer)) {
    const selectedEdge = edges.find((edge) => edge.id === context.selectedEdgeId && edge.lineType === 'can');
    if (selectedEdge && targetAllowsFaultBySlot(selectedEdge, faultModel, context)) {
      return { kind: 'edge', id: selectedEdge.id, reason: 'selected-can-edge' };
    }

    const matchingSlotEdge = findTargetByAllowedSlot(edges.filter((edge) => edge.lineType === 'can'), faultModel, context);
    if (matchingSlotEdge) {
      return matchingSlotEdge;
    }

    const explicitEdge = findExplicitTarget(edges, faultModel, 'edge');
    if (explicitEdge) {
      return explicitEdge;
    }

    if (selectedEdge && explicitTargetIdsForFault(faultModel, 'edge').length === 0) {
      return { kind: 'edge', id: selectedEdge.id, reason: 'selected-can-edge' };
    }

    const matchingCanEdge = edges.find((edge) => canEdgeMatchesFaultTargets(edge, faultModel));
    if (matchingCanEdge) {
      return { kind: 'edge', id: matchingCanEdge.id, reason: 'module-target-can-edge' };
    }

    const firstCanEdge = edges.find((edge) => edge.lineType === 'can');
    return firstCanEdge ? { kind: 'edge', id: firstCanEdge.id, reason: 'first-can-edge' } : null;
  }

  const selectedNode = nodes.find((node) => node.id === context.selectedNodeId);
  if (selectedNode && targetAllowsFaultBySlot(selectedNode, faultModel, context)) {
    const slot = targetAllowsFaultBySlot(selectedNode, faultModel, context);
    return { kind: 'node', id: selectedNode.id, reason: 'selected-node', slotId: slot.slotId || slot.id || '' };
  }

  const matchingSlotNode = findTargetByAllowedSlot(nodes, faultModel, context);
  if (matchingSlotNode) {
    return matchingSlotNode;
  }

  const explicitNode = findExplicitTarget(nodes, faultModel, 'node');
  if (explicitNode) {
    return explicitNode;
  }

  if (selectedNode && nodeMatchesFaultTargets(selectedNode, faultModel)) {
    return { kind: 'node', id: selectedNode.id, reason: 'selected-node' };
  }

  const matchingNode = nodes.find((node) => nodeMatchesFaultTargets(node, faultModel));
  return matchingNode ? { kind: 'node', id: matchingNode.id, reason: 'module-target' } : null;
}

export function buildFaultPythonModuleSpec(faultModel = {}) {
  const behavior = getFaultRuntimeBehavior(faultModel) || 'additive_bias';
  const kind = PYTHON_KIND_BY_BEHAVIOR[behavior] ?? behavior;
  const moduleId = `fault_${faultModel.id ?? behavior}`.replace(/[^\w]+/g, '_');
  const params = resolveFaultParameters(faultModel);
  const source = [
    'import json',
    '',
    `PARAMS = json.loads(${JSON.stringify(JSON.stringify(params))})`,
    `KIND = ${JSON.stringify(kind)}`,
    '',
    'def _num(value, fallback=0.0):',
    '    try:',
    '        return float(value)',
    '    except (TypeError, ValueError):',
    '        return fallback',
    '',
    'def process(input_signal, time=0.0, dt=0.1):',
    '    value = _num(input_signal)',
    '    start = _num(PARAMS.get("start", 0.0))',
    '    duration = PARAMS.get("duration", None)',
    '    if time < start:',
    '        return value',
    '    if duration not in (None, "") and time > start + _num(duration):',
    '        return value',
    '    if KIND in ("bias", "parameter_bias", "additive_bias"):',
    '        return value + _num(PARAMS.get("offset", PARAMS.get("delta_p", PARAMS.get("bias", 0.0))))',
    '    if KIND == "scale":',
    '        return value * _num(PARAMS.get("scale", 1.0), 1.0)',
    '    if KIND == "drift":',
    '        return value + max(time - start, 0.0) * _num(PARAMS.get("rate", 0.0))',
    '    if KIND == "step":',
    '        return value + _num(PARAMS.get("step_value", PARAMS.get("jump", 0.0)))',
    '    if KIND == "lock":',
    '        return _num(PARAMS.get("lock_value", 0.0))',
    '    if KIND == "saturation":',
    '        lower = PARAMS.get("lower", None)',
    '        upper = PARAMS.get("upper", None)',
    '        if lower not in (None, ""):',
    '            value = max(value, _num(lower))',
    '        if upper not in (None, ""):',
    '            value = min(value, _num(upper))',
    '        return value',
    '    if KIND == "tamper":',
    '        value = value * _num(PARAMS.get("scale", 1.0), 1.0) + _num(PARAMS.get("bias", 0.0))',
    '        return -value if bool(PARAMS.get("invert", False)) else value',
    '    if KIND in ("sign_flip", "jump_or_invert"):',
    '        base = -value if bool(PARAMS.get("invert", True)) else value',
    '        return base + _num(PARAMS.get("jump", 0.0))',
    '    if KIND in ("gaussian_noise", "white_noise", "colored_noise"):',
    '        return value + _num(PARAMS.get("std", PARAMS.get("amplitude", 0.0)))',
    '    return value',
    ''
  ].join('\n');

  return {
    moduleId,
    fileName: `${moduleId}.py`,
    moduleName: moduleId,
    entryFunction: 'process',
    source,
    parsedInterface: {
      fileName: `${moduleId}.py`,
      moduleName: moduleId,
      entryFunction: 'process',
      description: `${faultModel.name ?? faultModel.id ?? 'Fault'} wrapper`,
      rawSource: source,
      inputs: [
        { name: 'input_signal', type: 'float', default: 0, comment: 'upstream signal' },
        { name: 'time', type: 'float', default: 0, comment: 'simulation time' },
        { name: 'dt', type: 'float', default: 0.1, comment: 'simulation step' }
      ],
      outputs: [
        { name: 'output_signal', type: 'float', comment: 'faulted signal' }
      ],
      middleVars: []
    }
  };
}

export function openElectricalFaultImport() {
  window.openOv?.('ov-elec');
}

export function openProtocolFaultImport() {
  window.openOv?.('ov-proto');
}
