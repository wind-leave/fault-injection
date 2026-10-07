function clone(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return JSON.parse(JSON.stringify(value));
}

function isMeasurementInstrument(device) {
  return typeof device?.type === 'string' && device.type.startsWith('instrument_');
}

function buildPublicRenderData(renderData) {
  const source = clone(renderData, { devices: [], connections: [] });
  const devices = Array.isArray(source?.devices)
    ? source.devices.filter((device) => !isMeasurementInstrument(device))
    : [];
  const deviceIds = new Set(devices.map((device) => device?.id).filter(Boolean));
  const connectionKeys = new Set();
  const connections = Array.isArray(source?.connections)
    ? source.connections.filter((connection) => {
      if (!deviceIds.has(connection?.sourceDeviceId) || !deviceIds.has(connection?.targetDeviceId)) {
        return false;
      }
      const key = JSON.stringify([
        String(connection?.sourceDeviceId ?? ''),
        String(connection?.sourcePort ?? ''),
        String(connection?.targetDeviceId ?? ''),
        String(connection?.targetPort ?? '')
      ]);
      if (connectionKeys.has(key)) return false;
      connectionKeys.add(key);
      return true;
    })
    : [];

  return { ...source, devices, connections };
}

function buildMeasurementPortDeclarations(renderData, initialMeasurementData) {
  const publicRenderData = buildPublicRenderData(renderData);
  const deviceIds = new Set(publicRenderData.devices.map((device) => String(device?.id ?? '')).filter(Boolean));
  const portsByDeviceId = new Map();
  const ensureDevicePorts = (deviceId) => {
    if (!portsByDeviceId.has(deviceId)) {
      portsByDeviceId.set(deviceId, { inputs: new Map(), outputs: new Map() });
    }
    return portsByDeviceId.get(deviceId);
  };
  const addPort = (deviceIdValue, direction, portIdValue, elementNameValue) => {
    const deviceId = String(deviceIdValue ?? '').trim();
    const portId = String(portIdValue ?? '').trim();
    const elementName = String(elementNameValue ?? '').trim() || '元素 1';
    if (!deviceId || !portId || !deviceIds.has(deviceId)) return;
    const ports = ensureDevicePorts(deviceId)[direction];
    if (!ports.has(portId)) {
      ports.set(portId, new Set());
    }
    ports.get(portId).add(elementName);
  };
  const measurements = [
    ...(Array.isArray(initialMeasurementData?.physicalMeasurements)
      ? initialMeasurementData.physicalMeasurements
      : []),
    ...(Array.isArray(initialMeasurementData?.virtualMeasurements)
      ? initialMeasurementData.virtualMeasurements
      : [])
  ];
  measurements.forEach((measurement) => {
    addPort(
      measurement?.sourceDeviceId,
      'outputs',
      measurement?.sourcePort,
      measurement?.sourceElementName ?? measurement?.sourceVectorElementName
    );
    addPort(
      measurement?.targetDeviceId,
      'inputs',
      measurement?.targetPort,
      measurement?.targetElementName ?? measurement?.targetVectorElementName
    );
  });
  const serializePorts = (ports) => [...ports.entries()].map(([portId, elementNames]) => ({
    portId,
    elementNames: [...elementNames]
  }));

  return {
    ...publicRenderData,
    devices: publicRenderData.devices.map((device) => {
      const { measurementPorts: _measurementPorts, ...baseDevice } = device;
      const ports = portsByDeviceId.get(String(device?.id ?? ''));
      if (!ports) return baseDevice;
      return {
        ...baseDevice,
        measurementPorts: {
          inputs: serializePorts(ports.inputs),
          outputs: serializePorts(ports.outputs)
        }
      };
    })
  };
}

function buildDisplayConsoleControls(renderData) {
  const devices = Array.isArray(renderData?.devices) ? renderData.devices : [];
  return devices
    .filter((device) => device?.type === 'display_console')
    .flatMap((device) => {
      const states = Array.isArray(device?.controlState?.targets)
        ? device.controlState.targets
        : [device?.controlState];
      return states.map((state) => ({
        displayConsoleId: String(device.id ?? ''),
        displayConsoleName: String(device.displayName ?? device.id ?? ''),
        targetComponentId: String(state?.targetComponentId ?? ''),
        componentType: String(state?.componentType ?? ''),
        parameterKeys: (Array.isArray(state?.parameters) ? state.parameters : [])
          .map((parameter) => String(parameter?.key ?? '').trim())
          .filter(Boolean)
      }));
    })
    .filter((control) => control.displayConsoleId && control.parameterKeys.length);
}

function pointType(point) {
  const value = String(point?.pointType ?? point?.type ?? '').toLowerCase();
  return value === 'virtual' ? 'virtual' : 'physical';
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function simulationOutputValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => simulationOutputValue(item));
  }
  if (value && typeof value === 'object') {
    const i = finiteNumber(value.i ?? value.re);
    const q = finiteNumber(value.q ?? value.im);
    const referenceFrequencyHz = finiteNumber(value.referenceFrequencyHz);
    if (i !== null && q !== null && referenceFrequencyHz !== null) {
      return { i, q, referenceFrequencyHz };
    }
  }
  return finiteNumber(value);
}

function hasSimulationOutputValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null;
}

function outputPortForNode(nodes, nodeId, portIndex) {
  const node = nodes.find((item) => String(item?.id ?? '') === String(nodeId ?? ''));
  const outputs = Array.isArray(node?.outputs) ? node.outputs : [];
  return outputs[portIndex] ?? null;
}

function inputPortForNode(nodes, nodeId, portIndex) {
  const node = nodes.find((item) => String(item?.id ?? '') === String(nodeId ?? ''));
  const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
  return inputs[portIndex] ?? null;
}

function buildDiagnosticConditions(dMatrix, suppliedConditions) {
  const supplied = Array.isArray(suppliedConditions) ? suppliedConditions : [];
  const contextValues = dMatrix?.diagnosticContext?.values && typeof dMatrix.diagnosticContext.values === 'object'
    ? dMatrix.diagnosticContext.values
    : {};
  const contextEntries = Array.isArray(dMatrix?.diagnosticContext?.entries) ? dMatrix.diagnosticContext.entries : [];
  const entryByKey = new Map(contextEntries.map((entry) => [String(entry?.key ?? ''), entry]));
  return supplied.map((condition) => {
    const key = String(condition?.key ?? '').trim();
    if (!key) return null;
    const keyParts = key.match(/^component:([^:]+):(.+)$/);
    const contextEntry = entryByKey.get(key) ?? {};
    return {
      key,
      componentId: String(condition?.componentId ?? keyParts?.[1] ?? ''),
      parameterKey: String(condition?.parameterKey ?? keyParts?.[2] ?? ''),
      label: String(condition?.label ?? contextEntry?.label ?? key),
      options: clone(condition?.options, []),
      currentValue: contextValues[key] ?? condition?.currentValue ?? contextEntry?.value ?? null
    };
  }).filter(Boolean);
}

function sourceNodeIdForPoint(point, edge, nodes) {
  const candidates = [
    point?.measurementSourceNodeId,
    point?.sourceNodeId,
    point?.nodeId,
    edge?.sourceNodeId,
    point?.sourceDeviceId
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  const nodeIds = new Set(nodes.map((node) => String(node?.id ?? '')).filter(Boolean));

  // Older measurement records can keep the canvas ID in a source field.
  // Only persist an ID that identifies an executable component when one is
  // available; the flattened edge is the authoritative fallback.
  return candidates.find((id) => nodeIds.has(id))
    || String(edge?.sourceNodeId ?? '').trim()
    || candidates[0]
    || '';
}

function simulationResultDeviceId(node, nodeId, nodes) {
  const moduleId = String(node?.pythonBinding?.moduleId ?? node?.templateId ?? '').trim();
  if (!moduleId) return nodeId;
  const moduleCount = nodes.filter((candidate) => (
    String(candidate?.pythonBinding?.moduleId ?? candidate?.templateId ?? '').trim() === moduleId
  )).length;
  return moduleCount === 1 ? moduleId : nodeId;
}

function publicConnectionForPoint(point, connections, connectionBindings) {
  const edgeId = String(point?.edgeId ?? point?.edgeID ?? point?.targetEdgeId ?? point?.targetId ?? '');
  const direct = connections.find((item) => String(item?.id ?? '') === edgeId);
  if (direct) return direct;
  const binding = connectionBindings.find((item) => (
    Array.isArray(item?.backingEdgeIds)
    && item.backingEdgeIds.some((candidate) => String(candidate ?? '') === edgeId)
  ));
  if (!binding) return null;
  return connections.find((item) => (
    String(item?.sourceDeviceId ?? '') === String(binding.sourceDeviceId ?? '')
    && String(item?.sourcePort ?? '') === String(binding.sourcePort ?? '')
    && String(item?.targetDeviceId ?? '') === String(binding.targetDeviceId ?? '')
    && String(item?.targetPort ?? '') === String(binding.targetPort ?? '')
  )) ?? binding;
}

function sourceForPoint(point, edges, connections, nodes, connectionBindings) {
  const edgeId = point?.edgeId ?? point?.edgeID ?? point?.targetEdgeId ?? point?.targetId;
  const edge = edges.find((item) => item?.id === edgeId) ?? null;
  const connection = publicConnectionForPoint(point, connections, connectionBindings);
  const nodeId = sourceNodeIdForPoint(point, edge, nodes);
  const sourcePortIndex = Number.isInteger(Number(point?.measurementSourcePortIndex))
    ? Number(point.measurementSourcePortIndex)
    : Number(edge?.sourcePortIndex) || 0;
  const nodePort = outputPortForNode(nodes, nodeId, sourcePortIndex);
  const sourcePort = String(
    connection?.sourcePort
    ?? point?.sourcePortId
    ?? point?.portId
    ?? edge?.sourcePortMeta?.portId
    ?? edge?.sourcePortMeta?.id
    ?? edge?.sourcePort?.portId
    ?? edge?.sourcePort?.id
    ?? point?.sourcePort
    ?? edge?.sourcePort?.name
    ?? edge?.sourcePort?.key
    ?? nodePort?.id
    ?? nodePort?.name
    ?? (sourcePortIndex ? `output-${sourcePortIndex + 1}` : 'output')
  );
  const node = nodes.find((item) => String(item?.id ?? '') === nodeId);
  const componentDeviceId = simulationResultDeviceId(node, nodeId, nodes);
  return {
    edge,
    nodeId,
    nodePort,
    channel: String(point?.channel ?? edgeId ?? ''),
    // The private node remains the sampling source, but the saved endpoint
    // belongs to the public connection (not the internal subsystem node).
    sourceDeviceId: String(connection?.sourceDeviceId ?? '') || componentDeviceId || nodeId,
    sourcePort
  };
}

function targetForPoint(point, edges, connections, nodes, connectionBindings) {
  const edgeId = point?.edgeId ?? point?.edgeID ?? point?.targetEdgeId ?? point?.targetId;
  const edge = edges.find((item) => item?.id === edgeId) ?? null;
  const connection = publicConnectionForPoint(point, connections, connectionBindings);
  const nodeIds = new Set(nodes.map((node) => String(node?.id ?? '')).filter(Boolean));
  const candidates = [
    point?.measurementTargetNodeId,
    point?.targetNodeId,
    edge?.targetNodeId,
    point?.targetDeviceId,
    connection?.targetDeviceId
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  const nodeId = candidates.find((id) => nodeIds.has(id)) || '';
  const targetPortIndex = Number.isInteger(Number(point?.measurementTargetPortIndex))
    ? Number(point.measurementTargetPortIndex)
    : Number(edge?.targetPortIndex) || 0;
  const nodePort = inputPortForNode(nodes, nodeId, targetPortIndex);
  const targetPort = String(
    connection?.targetPort
    ?? point?.targetPortId
    ?? edge?.targetPortMeta?.portId
    ?? edge?.targetPortMeta?.id
    ?? edge?.targetPort?.portId
    ?? edge?.targetPort?.id
    ?? point?.targetPort
    ?? edge?.targetPort?.varName
    ?? edge?.targetPort?.name
    ?? edge?.targetPort?.key
    ?? nodePort?.id
    ?? nodePort?.varName
    ?? nodePort?.name
    ?? nodePort?.key
    ?? ''
  );
  const node = nodes.find((item) => String(item?.id ?? '') === nodeId);
  const componentDeviceId = simulationResultDeviceId(node, nodeId, nodes);
  const targetDeviceId = String(connection?.targetDeviceId ?? '') || componentDeviceId || nodeId;

  return { targetDeviceId, targetPort };
}

function outputKeys(point, edge, nodePort) {
  const index = Number.isInteger(Number(point?.measurementSourcePortIndex))
    ? Number(point.measurementSourcePortIndex)
    : Number.isInteger(Number(edge?.sourcePortIndex)) ? Number(edge.sourcePortIndex) : 0;
  const values = [
    point?.outputKey,
    point?.portName,
    edge?.sourcePortMeta?.varName,
    edge?.sourcePortMeta?.name,
    edge?.sourcePort?.varName,
    edge?.sourcePort?.name,
    edge?.sourcePort?.key,
    nodePort?.varName,
    nodePort?.name,
    nodePort?.key,
    nodePort?.id,
    index === 0 ? 'output' : `output-${index + 1}`,
    `output-${index}`
  ];
  return [...new Set(values.filter((value) => typeof value === 'string' && value))];
}

function readOutputValue(outputs, nodeId, keys) {
  const nodeOutputs = outputs?.[nodeId];
  if (!nodeOutputs || typeof nodeOutputs !== 'object') {
    return null;
  }
  for (const key of keys) {
    const value = simulationOutputValue(nodeOutputs[key]);
    if (hasSimulationOutputValue(value)) {
      return value;
    }
  }
  return Object.values(nodeOutputs)
    .map(simulationOutputValue)
    .find(hasSimulationOutputValue) ?? null;
}

function pointSamples(point, edge, nodeId, nodePort, componentOutputs) {
  const traceTimes = Array.isArray(componentOutputs?.time) ? componentOutputs.time : [];
  return (Array.isArray(componentOutputs?.steps) ? componentOutputs.steps : [])
    .map((step, index) => ({
      time: finiteNumber(step?.time) ?? finiteNumber(traceTimes[index]) ?? index,
      actual: readOutputValue(step?.actual, nodeId, outputKeys(point, edge, nodePort))
    }));
}

function areMeasurementValuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areMeasurementValuesEqual(value, right[index]));
  }
  if (left && typeof left === 'object' || right && typeof right === 'object') {
    return Boolean(left && right && typeof left === 'object' && typeof right === 'object')
      && Object.is(left.i, right.i)
      && Object.is(left.q, right.q)
      && Object.is(left.referenceFrequencyHz, right.referenceFrequencyHz);
  }
  return Object.is(left, right);
}

// Keep the first and last sample of every unchanged interval.  The exported
// data remains sufficient to reconstruct the interval while avoiding one
// record per simulation step for constant measurement values.
function compactMeasurementSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    return samples;
  }
  const compact = [];
  let runStart = 0;
  const appendRun = (start, end) => {
    if (end === start) {
      compact.push({ ...samples[start], constantRangeBoundary: 'single' });
      return;
    }
    compact.push({ ...samples[start], constantRangeBoundary: 'start' });
    compact.push({ ...samples[end], constantRangeBoundary: 'end' });
  };
  for (let index = 1; index < samples.length; index += 1) {
    if (areMeasurementValuesEqual(samples[index]?.actual, samples[index - 1]?.actual)) {
      continue;
    }
    appendRun(runStart, index - 1);
    runStart = index;
  }
  appendRun(runStart, samples.length - 1);
  return compact;
}

function vectorElementMetadata(point, edge, nodePort, nodes, samples) {
  const targetPortIndex = Number(edge?.targetPortIndex) || 0;
  const targetNodePort = inputPortForNode(nodes, edge?.targetNodeId, targetPortIndex);
  const sourceCandidates = [
    edge?.sourcePortMeta,
    edge?.sourcePort,
    nodePort?.meta,
    nodePort
  ].filter(Boolean);
  const targetCandidates = [
    edge?.targetPortMeta,
    edge?.targetPort,
    targetNodePort?.meta,
    targetNodePort
  ].filter(Boolean);
  const portCandidates = [...sourceCandidates, ...targetCandidates];
  const declaredLength = Math.max(0, ...portCandidates.map((port) => {
    const length = Number(port?.vectorLength ?? port?.length ?? port?.shape?.[0]);
    return Number.isInteger(length) && length > 0 ? length : 0;
  }));
  const observedLength = samples.reduce((length, sample) => (
    Array.isArray(sample?.actual) ? Math.max(length, sample.actual.length) : length
  ), 0);
  const length = Math.max(
    Number.isInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0,
    observedLength
  );
  if (!length) return { names: [], sourceNames: [], targetNames: [] };
  const namesFrom = (candidates) => Array.from({ length }, (_, index) => (
    candidates
      .map((port) => String(port?.vectorElementNames?.[index] ?? '').trim())
      .find(Boolean) || ''
  ));
  const sourceNames = namesFrom(sourceCandidates);
  const targetNames = namesFrom(targetCandidates);
  const savedNames = Array.isArray(point?.vectorElementNames) ? point.vectorElementNames : [];
  const names = Array.from({ length }, (_, index) => (
    String(savedNames[index] ?? '').trim()
    || sourceNames[index]
    || targetNames[index]
    || `第 ${index + 1} 路`
  ));
  return { names, sourceNames, targetNames };
}

function vectorElementIndex(point, names) {
  if (!names.length) return null;
  const requested = Number.parseInt(point?.vectorIndex, 10);
  return Number.isInteger(requested)
    ? Math.max(0, Math.min(requested, names.length - 1))
    : 0;
}

function scalarElementMetadata(edge, nodePort, nodes) {
  const targetPortIndex = Number(edge?.targetPortIndex) || 0;
  const targetNodePort = inputPortForNode(nodes, edge?.targetNodeId, targetPortIndex);
  const sourceCandidates = [edge?.sourcePortMeta, edge?.sourcePort, nodePort?.meta, nodePort].filter(Boolean);
  const targetCandidates = [edge?.targetPortMeta, edge?.targetPort, targetNodePort?.meta, targetNodePort].filter(Boolean);
  const nameFrom = (candidates) => candidates
    .map((port) => String(port?.elementNames?.[0] ?? port?.elementName ?? '').trim())
    .find(Boolean) || '';
  return {
    sourceElementName: nameFrom(sourceCandidates),
    targetElementName: nameFrom(targetCandidates)
  };
}

function matrixCell(row, pointCode) {
  return Array.isArray(row?.cells)
    ? row.cells.find((cell) => String(cell?.pointCode ?? cell?.pointId ?? '') === pointCode)
    : null;
}

function pointObservedState(point, dMatrix, enabledFaultIds) {
  const pointCode = String(point?.shortName ?? point?.pointCode ?? point?.pointId ?? '');
  const activeRows = (Array.isArray(dMatrix?.rows) ? dMatrix.rows : [])
    .filter((row) => enabledFaultIds.has(String(row?.faultId ?? row?.faultTypeId ?? row?.caseId ?? row?.id ?? '')));
  if (!activeRows.length) {
    return 'unknown';
  }
  const activeCells = activeRows.map((row) => matrixCell(row, pointCode)).filter(Boolean);
  if (!activeCells.length) {
    return 'unknown';
  }
  return activeCells.some((cell) => cell.detectable)
    ? 'abnormal'
    : 'normal';
}

function buildMeasurementPoint(point, edges, connections, nodes, componentOutputs, connectionBindings) {
  const { edge, nodeId, nodePort, channel, sourceDeviceId, sourcePort } = sourceForPoint(point, edges, connections, nodes, connectionBindings);
  const { targetDeviceId, targetPort } = targetForPoint(point, edges, connections, nodes, connectionBindings);
  const rawSamples = pointSamples(point, edge, nodeId, nodePort, componentOutputs);
  const { names, sourceNames, targetNames } = vectorElementMetadata(point, edge, nodePort, nodes, rawSamples);
  const index = vectorElementIndex(point, names);
  const scalarElements = scalarElementMetadata(edge, nodePort, nodes);
  const sourceVectorElementName = index === null
    ? ''
    : (String(point?.sourceVectorElementName ?? '').trim() || sourceNames[index] || names[index]);
  const declaredTargetVectorElementName = index === null
    ? ''
    : (String(point?.targetVectorElementName ?? '').trim() || targetNames[index] || sourceVectorElementName);
  const targetVectorElementName = declaredTargetVectorElementName;
  const isScalarMeasurement = index === null
    && !rawSamples.some((sample) => Array.isArray(sample?.actual));
  const sourceElementName = index === null
    ? (String(point?.sourceElementName ?? '').trim() || scalarElements.sourceElementName || (isScalarMeasurement ? '元素 1' : ''))
    : '';
  const targetElementName = index === null
    ? (String(point?.targetElementName ?? '').trim() || scalarElements.targetElementName || sourceElementName || (isScalarMeasurement ? '元素 1' : ''))
    : '';
  const displayElementName = sourceVectorElementName
    || targetVectorElementName
    || scalarElements.sourceElementName
    || scalarElements.targetElementName;
  const pointName = String(point?.name ?? '');
  const selectedSamples = index === null
    ? rawSamples
    : rawSamples.map((sample) => ({
      time: sample.time,
      actual: Array.isArray(sample.actual) ? sample.actual[index] ?? null : null
    }));
  return {
    pointCode: String(point?.shortName ?? point?.pointCode ?? point?.pointId ?? ''),
    pointId: String(point?.pointId ?? ''),
    pointName: index === null || !displayElementName
      ? pointName
      : (pointName ? `${pointName} · ${displayElementName}` : displayElementName),
    channel,
    sourceDeviceId,
    sourcePort,
    // Persist the receiving endpoint only when it can be represented as a
    // complete component/port pair.  This avoids exporting a misleading
    // component ID for legacy records that have no target-port metadata.
    ...(targetDeviceId && targetPort ? { targetDeviceId, targetPort } : {}),
    samples: compactMeasurementSamples(selectedSamples),
    ...(index === null
      ? (sourceElementName || targetElementName ? { sourceElementName, targetElementName } : {})
      : { sourceVectorElementName, targetVectorElementName })
  };
}

function initialPointStates(dMatrix, executableModel) {
  const points = Array.isArray(dMatrix?.points) ? dMatrix.points : [];
  const enabledFaultIds = new Set((Array.isArray(executableModel?.faultInstances) ? executableModel.faultInstances : [])
    .filter((fault) => fault?.enabled !== false)
    .map((fault) => String(fault?.faultId ?? ''))
    .filter(Boolean));
  return points.map((point) => ({
    pointCode: String(point?.shortName ?? point?.pointCode ?? point?.pointId ?? ''),
    observed: pointObservedState(point, dMatrix, enabledFaultIds)
  }));
}

function buildInitialMeasurementData(dMatrix, executableModel, renderData, componentOutputs, exportMeasurementPoints, connectionBindings) {
  // Diagnostic activation controls the D matrix, but a created measurement
  // point is still a simulation result channel.  Preserve all configured
  // points during export (including points on a subsystem boundary) while
  // keeping the D matrix restricted to activated diagnostic points.
  const pointsById = new Map();
  [
    ...(Array.isArray(dMatrix?.points) ? dMatrix.points : []),
    ...(Array.isArray(exportMeasurementPoints) ? exportMeasurementPoints : [])
  ].forEach((point) => {
    const id = String(point?.pointId ?? point?.id ?? '');
    if (!id) return;
    pointsById.set(id, { ...(pointsById.get(id) ?? {}), ...point, pointId: id });
  });
  const points = [...pointsById.values()];
  const nodes = Array.isArray(executableModel?.nodes) ? executableModel.nodes : [];
  const edges = Array.isArray(executableModel?.edges) ? executableModel.edges : [];
  const connections = Array.isArray(renderData?.connections) ? renderData.connections : [];
  const physicalMeasurements = points
    .filter((point) => pointType(point) === 'physical')
    .map((point) => buildMeasurementPoint(point, edges, connections, nodes, componentOutputs, connectionBindings));
  const virtualMeasurements = points
    .filter((point) => pointType(point) === 'virtual')
    .map((point) => buildMeasurementPoint(point, edges, connections, nodes, componentOutputs, connectionBindings));
  return {
    physicalMeasurements,
    virtualMeasurements
  };
}

function normalizePracticeActionType(step) {
  const action = String(step?.actionType ?? step?.action ?? '');
  if (action === 'measure' || (!action && (step?.pointId || step?.pointCode))) {
    return 'measurePoint';
  }
  if (action === 'setCondition' || action === 'displayConsoleParameter') {
    return 'adjustDisplayConsoleParameter';
  }
  return action;
}

function normalizeInitialRecommendedPath(path) {
  if (!path || typeof path !== 'object') {
    return null;
  }
  const steps = Array.isArray(path.steps) ? path.steps.flatMap((step) => {
    const actionType = normalizePracticeActionType(step);
    const targetId = String(
      step?.target?.id
      ?? (actionType === 'adjustDisplayConsoleParameter' ? (step?.consoleNodeId ?? step?.displayConsoleId) : undefined)
      ?? step?.targetId
      ?? step?.pointId
      ?? step?.pointCode
      ?? ''
    );
    const targetType = actionType === 'measurePoint'
      ? 'testPoint'
      : actionType === 'replaceWire'
        ? 'wire'
        : actionType === 'replaceComponent'
          ? 'component'
          : actionType === 'adjustDisplayConsoleParameter'
            ? 'displayConsole'
            : step?.target?.type;
    const conditionChanges = Array.isArray(step?.conditionChanges) ? step.conditionChanges : [];
    const componentId = String(
      step?.componentId
      ?? step?.targetComponentId
      ?? conditionChanges[0]?.componentId
      ?? ''
    );
    if (actionType === 'adjustDisplayConsoleParameter') {
      const explicitParameter = String(step?.parameter ?? step?.parameterName ?? '').trim();
      const parameterEntries = explicitParameter && Object.hasOwn(step ?? {}, 'value')
        ? [{ parameter: explicitParameter, value: step.value, componentId }]
        : step?.parameters && typeof step.parameters === 'object'
          ? Object.entries(step.parameters).map(([parameter, value]) => ({
            parameter,
            value,
            componentId: conditionChanges.find((change) => change?.parameterKey === parameter)?.componentId ?? componentId
          }))
          : conditionChanges
            .filter((change) => String(change?.parameterKey ?? '').trim())
            .map((change) => ({
              parameter: String(change.parameterKey),
              value: change.value,
              componentId: String(change.componentId ?? componentId)
            }));
      const {
        parameters: _parameters,
        conditionChanges: _conditionChanges,
        parameter: _parameter,
        parameterName: _parameterName,
        value: _value,
        ...baseStep
      } = step ?? {};
      return parameterEntries.map(({ parameter, value, componentId: entryComponentId }) => ({
        ...baseStep,
        actionType,
        ...(targetType && targetId ? { target: { ...(step?.target ?? {}), type: targetType, id: targetId } } : {}),
        ...(entryComponentId ? { componentId: entryComponentId } : {}),
        parameter,
        value
      }));
    }
    return {
      ...step,
      actionType,
      ...((!step?.actionType || actionType === 'adjustDisplayConsoleParameter') && targetType && targetId
        ? { target: { ...(step?.target ?? {}), type: targetType, id: targetId } }
        : {}),
      ...(actionType === 'adjustDisplayConsoleParameter' && componentId ? { componentId } : {})
    };
  }) : [];
  return { ...path, steps };
}

function normalizeConnectionBindings(bindings) {
  const grouped = new Map();
  (Array.isArray(bindings) ? bindings : []).forEach((binding) => {
    const normalized = {
      sourceDeviceId: String(binding?.sourceDeviceId ?? '').trim(),
      targetDeviceId: String(binding?.targetDeviceId ?? '').trim(),
      sourcePort: String(binding?.sourcePort ?? '').trim(),
      targetPort: String(binding?.targetPort ?? '').trim()
    };
    if (Object.values(normalized).some((value) => !value)) return;
    const key = `${normalized.sourceDeviceId}\u0000${normalized.sourcePort}\u0000${normalized.targetDeviceId}\u0000${normalized.targetPort}`;
    const current = grouped.get(key) ?? { ...normalized, backingEdgeIds: [] };
    (Array.isArray(binding?.backingEdgeIds) ? binding.backingEdgeIds : [])
      .map((edgeId) => String(edgeId ?? '').trim())
      .filter(Boolean)
      .forEach((edgeId) => {
        if (!current.backingEdgeIds.includes(edgeId)) current.backingEdgeIds.push(edgeId);
      });
    if (current.backingEdgeIds.length) grouped.set(key, current);
  });
  return [...grouped.values()];
}

export function buildPracticeTaskPackage(input = {}) {
  const meta = clone(input.meta, {});
  const executableModel = clone(input.executableModel, {
    schemaVersion: 1,
    packageId: 'frontend-package',
    simulationConfig: {},
    nodes: [],
    edges: [],
    faultInstances: [],
    measurementPoints: []
  });
  const measurementExecutableModel = clone(input.measurementExecutableModel, executableModel);
  const dMatrix = clone(input.dMatrix, null);
  const simulationConfig = executableModel.simulationConfig ?? {};
  const savedSimulationConfig = {
    duration: simulationConfig.duration ?? meta.duration ?? null,
    stepSize: simulationConfig.stepSize ?? meta.stepSize ?? null
  };
  const savedMeta = {
    ...meta,
    duration: savedSimulationConfig.duration,
    stepSize: savedSimulationConfig.stepSize
  };
  const practiceFaults = clone(input.practiceFaults, []);
  const targetFault = practiceFaults[0] ?? null;
  const initialRecommendedPath = normalizeInitialRecommendedPath(input.combinedTroubleshootingPath ?? targetFault?.troubleshootingPath);
  const targetFaultIds = Array.from(new Set((Array.isArray(input.targetFaultIds)
    ? input.targetFaultIds
    : Array.isArray(initialRecommendedPath?.faultIds)
      ? initialRecommendedPath.faultIds
      : targetFault?.faultIds ?? [targetFault?.faultId])
    .map((faultId) => String(faultId ?? '').trim())
    .filter(Boolean)));
  const keyMeasurementPoints = clone(input.keyMeasurementPoints, []);
  const connectionBindings = normalizeConnectionBindings(input.connectionBindings);
  if (connectionBindings.length > 0) {
    executableModel.connectionBindings = clone(connectionBindings);
  }
  const diagnosticConditions = buildDiagnosticConditions(dMatrix, input.diagnosticConditions);
  const diagnosticContext = {
    values: Object.fromEntries(diagnosticConditions.map((condition) => [condition.key, condition.currentValue]))
  };
  const initialMeasurementData = buildInitialMeasurementData(
    dMatrix,
    measurementExecutableModel,
    input.renderData,
    input.componentOutputs,
    input.exportMeasurementPoints,
    connectionBindings
  );

  return {
    schemaVersion: 1,
    kind: '3d-practice-task-package',
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    taskId: String(input.taskId ?? meta.resultId ?? `practice-${Date.now()}`),
    meta: savedMeta,
    publicData: {
      modelRevision: Number.isInteger(input.modelRevision) ? input.modelRevision : 0,
      renderData: buildMeasurementPortDeclarations(input.renderData, initialMeasurementData),
      initialSimulationResult: {
        status: savedMeta.status ?? 'completed',
        simulationConfig: clone(savedSimulationConfig),
        ...initialMeasurementData,
        diagnosticContext,
        summary: clone(input.summary, {})
      }
    },
    privateData: {
      executableModel,
      connectionBindings,
      targetFaultId: targetFaultIds[0] ?? null,
      targetFaultIds,
      dMatrix,
      displayConsoleControls: buildDisplayConsoleControls(input.renderData),
      diagnosticConditions,
      initialPointStates: initialPointStates(dMatrix, executableModel),
      initialRecommendedPath,
      keyMeasurementPoints
    }
  };
}
