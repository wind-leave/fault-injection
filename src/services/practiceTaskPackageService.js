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

function pointType(point) {
  const value = String(point?.pointType ?? point?.type ?? '').toLowerCase();
  return value === 'virtual' ? 'virtual' : 'physical';
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceForPoint(point, edges, connections) {
  const edgeId = point?.edgeId ?? point?.edgeID ?? point?.targetEdgeId ?? point?.targetId;
  const edge = edges.find((item) => item?.id === edgeId) ?? null;
  const connection = connections.find((item) => item?.id === edgeId) ?? null;
  const sourcePort = String(
    point?.sourcePort
    ?? connection?.sourcePort
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
    const value = finiteNumber(nodeOutputs[key]);
    if (value !== null) {
      return value;
    }
  }
  return Object.values(nodeOutputs).map(finiteNumber).find((value) => value !== null) ?? null;
}

function pointSamples(point, edge, nodeId, componentOutputs) {
  const traceTimes = Array.isArray(componentOutputs?.time) ? componentOutputs.time : [];
  return (Array.isArray(componentOutputs?.steps) ? componentOutputs.steps : [])
    .map((step, index) => ({
      time: finiteNumber(step?.time) ?? finiteNumber(traceTimes[index]) ?? index,
      actual: readOutputValue(step?.actual, nodeId, outputKeys(point, edge))
    }));
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
  const practiceFaults = clone(input.practiceFaults, []);
  const targetFault = practiceFaults[0] ?? null;
  const initialRecommendedPath = normalizeInitialRecommendedPath(targetFault?.troubleshootingPath);
  const initialMeasurementData = buildInitialMeasurementData(dMatrix, executableModel, input.renderData, input.componentOutputs);

  return {
    schemaVersion: 1,
    kind: '3d-practice-task-package',
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    taskId: String(input.taskId ?? meta.resultId ?? `practice-${Date.now()}`),
    meta,
    publicData: {
      modelRevision: Number.isInteger(input.modelRevision) ? input.modelRevision : 0,
      renderData: buildPublicRenderData(input.renderData),
      initialSimulationResult: {
        status: meta.status ?? 'completed',
        simulationConfig: {
          duration: simulationConfig.duration ?? meta.duration ?? null,
          stepSize: simulationConfig.stepSize ?? meta.stepSize ?? null
        },
        ...initialMeasurementData,
        summary: clone(input.summary, {})
      }
    },
    privateData: {
      executableModel,
      rerunConfig: {
        startTime: 0,
        duration: simulationConfig.duration ?? meta.duration ?? null,
        stepSize: simulationConfig.stepSize ?? meta.stepSize ?? null,
        randomSeed: input.rerunConfig?.randomSeed ?? null,
        initialConditions: clone(input.rerunConfig?.initialConditions, {}),
        inputScenario: clone(input.rerunConfig?.inputScenario, {}),
        resetPolicy: 'full-reset'
      },
      targetFaultId: targetFault?.faultId ?? null,
      dMatrix,
      initialRecommendedPath
    }
  };
}
