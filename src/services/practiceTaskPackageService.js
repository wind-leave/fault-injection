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
  const connections = Array.isArray(source?.connections)
    ? source.connections.filter((connection) => (
      deviceIds.has(connection?.sourceDeviceId) && deviceIds.has(connection?.targetDeviceId)
    ))
    : [];

  return { ...source, devices, connections };
}

function buildDisplayConsoleControls(renderData) {
  const devices = Array.isArray(renderData?.devices) ? renderData.devices : [];
  return devices
    .filter((device) => device?.type === 'display_console' && device?.controlState?.targetComponentId)
    .map((device) => ({
      displayConsoleId: String(device.id ?? ''),
      displayConsoleName: String(device.displayName ?? device.id ?? ''),
      targetComponentId: String(device.controlState.targetComponentId),
      componentType: String(device.controlState.componentType ?? ''),
      parameterKeys: (Array.isArray(device.controlState.parameters) ? device.controlState.parameters : [])
        .map((parameter) => String(parameter?.key ?? '').trim())
        .filter(Boolean)
    }))
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
  return finiteNumber(value);
}

function hasSimulationOutputValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null;
}

function sourceForPoint(point, edges, connections) {
  const edgeId = point?.edgeId ?? point?.edgeID ?? point?.targetEdgeId ?? point?.targetId;
  const edge = edges.find((item) => item?.id === edgeId) ?? null;
  const connection = connections.find((item) => item?.id === edgeId) ?? null;
  const sourcePort = String(
    point?.sourcePortId
    ?? point?.portId
    ?? connection?.sourcePort
    ?? edge?.sourcePortMeta?.portId
    ?? edge?.sourcePortMeta?.id
    ?? edge?.sourcePort?.portId
    ?? edge?.sourcePort?.id
    ?? point?.sourcePort
    ?? edge?.sourcePort?.name
    ?? edge?.sourcePort?.key
    ?? (Number(edge?.sourcePortIndex) ? `output-${Number(edge.sourcePortIndex) + 1}` : 'output')
  );
  return {
    edge,
    nodeId: String(point?.sourceNodeId ?? point?.nodeId ?? edge?.sourceNodeId ?? ''),
    channel: String(point?.channel ?? edgeId ?? ''),
    sourcePort
  };
}

function outputKeys(point, edge) {
  const index = Number.isInteger(Number(edge?.sourcePortIndex)) ? Number(edge.sourcePortIndex) : 0;
  const values = [
    point?.outputKey,
    point?.portName,
    edge?.sourcePortMeta?.varName,
    edge?.sourcePortMeta?.name,
    edge?.sourcePort?.varName,
    edge?.sourcePort?.name,
    edge?.sourcePort?.key,
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

function pointSamples(point, edge, nodeId, componentOutputs) {
  const traceTimes = Array.isArray(componentOutputs?.time) ? componentOutputs.time : [];
  return (Array.isArray(componentOutputs?.steps) ? componentOutputs.steps : [])
    .map((step, index) => ({
      time: finiteNumber(step?.time) ?? finiteNumber(traceTimes[index]) ?? index,
      actual: readOutputValue(step?.actual, nodeId, outputKeys(point, edge))
    }));
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

function buildMeasurementPoint(point, edges, connections, componentOutputs) {
  const { edge, nodeId, channel, sourcePort } = sourceForPoint(point, edges, connections);
  return {
    pointCode: String(point?.shortName ?? point?.pointCode ?? point?.pointId ?? ''),
    pointId: String(point?.pointId ?? ''),
    pointName: String(point?.name ?? ''),
    channel,
    sourceDeviceId: nodeId,
    sourcePort,
    samples: pointSamples(point, edge, nodeId, componentOutputs)
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

function buildInitialMeasurementData(dMatrix, executableModel, renderData, componentOutputs) {
  const points = Array.isArray(dMatrix?.points) ? dMatrix.points : [];
  const edges = Array.isArray(executableModel?.edges) ? executableModel.edges : [];
  const connections = Array.isArray(renderData?.connections) ? renderData.connections : [];
  const physicalMeasurements = points
    .filter((point) => pointType(point) === 'physical')
    .map((point) => buildMeasurementPoint(point, edges, connections, componentOutputs));
  const virtualMeasurements = points
    .filter((point) => pointType(point) === 'virtual')
    .map((point) => buildMeasurementPoint(point, edges, connections, componentOutputs));
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
  return action;
}

function normalizeInitialRecommendedPath(path) {
  if (!path || typeof path !== 'object') {
    return null;
  }
  const steps = Array.isArray(path.steps) ? path.steps.map((step) => {
    const actionType = normalizePracticeActionType(step);
    const targetId = String(step?.target?.id ?? step?.targetId ?? step?.pointId ?? step?.pointCode ?? '');
    const targetType = actionType === 'measurePoint'
      ? 'testPoint'
      : actionType === 'replaceWire'
        ? 'wire'
        : actionType === 'replaceComponent'
          ? 'component'
          : step?.target?.type;
    return {
      ...step,
      actionType,
      ...(!step?.actionType && targetType && targetId ? { target: { ...(step?.target ?? {}), type: targetType, id: targetId } } : {})
    };
  }) : [];
  return { ...path, steps };
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
  const initialMeasurementData = buildInitialMeasurementData(dMatrix, executableModel, input.renderData, input.componentOutputs);

  return {
    schemaVersion: 1,
    kind: '3d-practice-task-package',
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    taskId: String(input.taskId ?? meta.resultId ?? `practice-${Date.now()}`),
    meta: savedMeta,
    publicData: {
      modelRevision: Number.isInteger(input.modelRevision) ? input.modelRevision : 0,
      renderData: buildPublicRenderData(input.renderData),
      initialSimulationResult: {
        status: savedMeta.status ?? 'completed',
        simulationConfig: clone(savedSimulationConfig),
        ...initialMeasurementData,
        summary: clone(input.summary, {})
      }
    },
    privateData: {
      executableModel,
      targetFaultId: targetFaultIds[0] ?? null,
      targetFaultIds,
      dMatrix,
      displayConsoleControls: buildDisplayConsoleControls(input.renderData),
      initialPointStates: initialPointStates(dMatrix, executableModel),
      initialRecommendedPath,
      keyMeasurementPoints
    }
  };
}
