import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulationBlockPythonBinding } from '../../src/composables/useWorkbenchState.js';
import { buildFlightModelPackage } from '../../src/services/flightModelPackageService.js';
import { parsePythonBindingSource } from '../../src/services/pythonParserService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const authoringDir = path.join(rootDir, 'model-authoring', 'evtol_small_nonlinear');
const modulesDir = path.join(authoringDir, 'modules');
const outputDir = path.join(rootDir, 'public', 'model-packages');
const outputFile = path.join(outputDir, 'evtol_small_nonlinear.json');
const faultInjectedOutputFile = path.join(outputDir, 'evtol_small_nonlinear_fault_injected.json');
const hierarchicalOutputFile = path.join(outputDir, 'evtol_small_nonlinear_hierarchical.json');
const hierarchicalFaultInjectedOutputFile = path.join(outputDir, 'evtol_small_nonlinear_hierarchical_fault_injected.json');
const SUBSYSTEM_NODE_WIDTH = 180;
const SUBSYSTEM_NODE_HEIGHT = 92;
const SUBSYSTEM_PORT_WIDTH = 132;
const SUBSYSTEM_PORT_HEIGHT = 72;
const SCALAR_PORT_TYPE = 'scalar';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadJson(fileName) {
  const content = await readFile(path.join(authoringDir, fileName), 'utf8');
  return JSON.parse(content);
}

function createHydratedBinding(nodeBinding, parsedModule, meta) {
  const binding = createSimulationBlockPythonBinding(parsedModule, {
    moduleId: nodeBinding.moduleId,
    moduleCategory: nodeBinding.moduleCategory,
    sourcePackageId: meta.modelId,
    sourcePackageName: meta.modelName,
    executionMode: 'backend'
  });

  return {
    ...binding,
    executionConfig: {
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 3000
    }
  };
}

function requireSnapshotNode(snapshot, nodeId) {
  const node = snapshot.modelNodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new Error(`Missing node ${nodeId} while building the hierarchical eVTOL package.`);
  }
  return node;
}

function requireSnapshotEdge(snapshot, edgeId) {
  const edge = snapshot.modelEdges.find((item) => item.id === edgeId);
  if (!edge) {
    throw new Error(`Missing edge ${edgeId} while building the hierarchical eVTOL package.`);
  }
  return edge;
}

function pickNodes(snapshot, nodeIds) {
  return nodeIds.map((nodeId) => clone(requireSnapshotNode(snapshot, nodeId)));
}

function retargetBindingPackageOrigin(binding, packageMeta) {
  if (!binding?.bound) {
    return binding ? clone(binding) : binding;
  }

  return {
    ...clone(binding),
    sourcePackageId: packageMeta.modelId,
    sourcePackageName: packageMeta.modelName
  };
}

function mapSnapshotNodePackageOrigin(node, packageMeta) {
  if (!node || typeof node !== 'object') {
    return node;
  }

  if (node.type !== 'simulation_block') {
    return clone(node);
  }

  return {
    ...clone(node),
    pythonBinding: retargetBindingPackageOrigin(node.pythonBinding, packageMeta)
  };
}

function retargetSnapshotPackageOrigin(snapshot, packageMeta) {
  const retargetedSnapshot = clone(snapshot);

  if (Array.isArray(retargetedSnapshot.modelNodes)) {
    retargetedSnapshot.modelNodes = retargetedSnapshot.modelNodes.map((node) => (
      mapSnapshotNodePackageOrigin(node, packageMeta)
    ));
  }

  if (retargetedSnapshot.canvases && typeof retargetedSnapshot.canvases === 'object') {
    Object.entries(retargetedSnapshot.canvases).forEach(([canvasId, canvas]) => {
      if (!canvas || typeof canvas !== 'object') {
        return;
      }

      retargetedSnapshot.canvases[canvasId] = {
        ...clone(canvas),
        nodes: Array.isArray(canvas.nodes)
          ? canvas.nodes.map((node) => mapSnapshotNodePackageOrigin(node, packageMeta))
          : []
      };
    });
  }

  return retargetedSnapshot;
}

function stripLayeredSnapshotFields(snapshot) {
  return {
    version: snapshot.version ?? 1,
    modelNodes: clone(snapshot.modelNodes ?? []),
    modelEdges: clone(snapshot.modelEdges ?? []),
    nodeSeq: snapshot.nodeSeq ?? 0,
    edgeSeq: snapshot.edgeSeq ?? 0,
    activeLineType: snapshot.activeLineType ?? 'normal',
    faultedBlks: clone(snapshot.faultedBlks ?? []),
    importedFaultModels: clone(snapshot.importedFaultModels ?? [])
  };
}

function buildVariantPackage({ packageMeta, snapshot, faultLibrary, layered = false }) {
  const retargetedSnapshot = retargetSnapshotPackageOrigin(snapshot, packageMeta);
  const pkg = buildFlightModelPackage({
    meta: packageMeta,
    snapshot: retargetedSnapshot,
    faultLibrary
  });

  if (!layered) {
    pkg.workbenchSnapshot = stripLayeredSnapshotFields(pkg.workbenchSnapshot);
  }

  return pkg;
}

function expectSnapshotNodeModule(snapshot, nodeId, moduleId) {
  const node = requireSnapshotNode(snapshot, nodeId);
  const actualModuleId = node.pythonBinding?.moduleId ?? null;

  if (actualModuleId !== moduleId) {
    throw new Error(`Expected node ${nodeId} to bind module ${moduleId}, received ${actualModuleId}.`);
  }
}

function expectSnapshotEdge(snapshot, edgeId, expected) {
  const edge = requireSnapshotEdge(snapshot, edgeId);

  for (const [field, value] of Object.entries(expected)) {
    if (edge[field] !== value) {
      throw new Error(`Expected edge ${edgeId}.${field} to be ${value}, received ${edge[field]}.`);
    }
  }
}

function validateHierarchicalSourceGraph(flatSnapshot) {
  [
    ['node-3', 'imu_gyro'],
    ['node-4', 'imu_accel'],
    ['node-5', 'barometer'],
    ['node-6', 'gps_velocity'],
    ['node-7', 'attitude_pid'],
    ['node-8', 'control_allocation'],
    ['node-9', 'motor_model'],
    ['node-10', 'vehicle_dynamics']
  ].forEach(([nodeId, moduleId]) => {
    expectSnapshotNodeModule(flatSnapshot, nodeId, moduleId);
  });

  [
    ['edge-1', { sourceNodeId: 'node-1', targetNodeId: 'node-7', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-2', { sourceNodeId: 'node-3', targetNodeId: 'node-7', sourcePortIndex: 0, targetPortIndex: 1 }],
    ['edge-3', { sourceNodeId: 'node-5', targetNodeId: 'node-8', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-4', { sourceNodeId: 'node-7', targetNodeId: 'node-8', sourcePortIndex: 0, targetPortIndex: 1 }],
    ['edge-5', { sourceNodeId: 'node-8', targetNodeId: 'node-9', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-6', { sourceNodeId: 'node-8', targetNodeId: 'node-9', sourcePortIndex: 1, targetPortIndex: 1 }],
    ['edge-7', { sourceNodeId: 'node-9', targetNodeId: 'node-10', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-8', { sourceNodeId: 'node-9', targetNodeId: 'node-10', sourcePortIndex: 1, targetPortIndex: 1 }],
    ['edge-9', { sourceNodeId: 'node-10', targetNodeId: 'node-4', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-10', { sourceNodeId: 'node-10', targetNodeId: 'node-3', sourcePortIndex: 1, targetPortIndex: 0 }],
    ['edge-11', { sourceNodeId: 'node-10', targetNodeId: 'node-5', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-12', { sourceNodeId: 'node-2', targetNodeId: 'node-6', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-13', { sourceNodeId: 'node-4', targetNodeId: 'node-12', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-14', { sourceNodeId: 'node-13', targetNodeId: 'node-6', sourcePortIndex: 0, targetPortIndex: 1 }],
    ['edge-15', { sourceNodeId: 'node-6', targetNodeId: 'node-12', sourcePortIndex: 0, targetPortIndex: 1 }],
    ['edge-16', { sourceNodeId: 'node-10', targetNodeId: 'node-11', sourcePortIndex: 0, targetPortIndex: 0 }],
    ['edge-17', { sourceNodeId: 'node-10', targetNodeId: 'node-11', sourcePortIndex: 1, targetPortIndex: 1 }]
  ].forEach(([edgeId, expected]) => {
    expectSnapshotEdge(flatSnapshot, edgeId, expected);
  });
}

function createCanvas(id, name, parentSubsystemNodeId = null) {
  return {
    id,
    name,
    parentSubsystemNodeId,
    viewport: {
      scale: 1,
      offsetX: 0,
      offsetY: 0
    },
    nodes: [],
    edges: []
  };
}

function createSubsystemShell(id, name, targetCanvasId, x, y, definition) {
  return {
    id,
    type: 'subsystem_block',
    x,
    y,
    w: SUBSYSTEM_NODE_WIDTH,
    h: SUBSYSTEM_NODE_HEIGHT,
    targetCanvasId,
    props: {
      name,
      description: '',
      interface: clone(definition)
    },
    pythonBinding: null
  };
}

function createBoundaryNode(subsystemNodeId, role, item, index) {
  const isInput = role === 'input';
  return {
    id: `node-${subsystemNodeId}-${role}-${item.id}`,
    type: isInput ? 'subsystem_in_port' : 'subsystem_out_port',
    x: isInput ? 64 : 540,
    y: 140 + (index * 92),
    w: SUBSYSTEM_PORT_WIDTH,
    h: SUBSYSTEM_PORT_HEIGHT,
    props: {
      name: item.name,
      interfacePortId: item.id,
      interfaceRole: role,
      portType: item.type,
      order: item.order
    },
    pythonBinding: null
  };
}

function createEdge(id, sourceNodeId, targetNodeId, sourcePortIndex = 0, targetPortIndex = 0) {
  return {
    id,
    lineType: 'normal',
    sourceNodeId,
    targetNodeId,
    sourcePortIndex,
    targetPortIndex
  };
}

function createSubsystemCanvas(id, name, subsystemNodeId, definition, nodes, edges) {
  const canvas = createCanvas(id, name, subsystemNodeId);
  const inputBoundaryNodes = definition.inputs.map((item, index) => createBoundaryNode(subsystemNodeId, 'input', item, index));
  const outputBoundaryNodes = definition.outputs.map((item, index) => createBoundaryNode(subsystemNodeId, 'output', item, index));

  canvas.nodes = [...inputBoundaryNodes, ...outputBoundaryNodes, ...nodes];
  canvas.edges = edges;

  return {
    canvas,
    inputBoundaryNodes,
    outputBoundaryNodes
  };
}

function createSubsystemCanvasId(subsystemNodeId) {
  return `canvas-${subsystemNodeId}`;
}

function createHierarchicalSnapshot(flatSnapshot) {
  validateHierarchicalSourceGraph(flatSnapshot);

  const rootCanvasId = 'canvas-root';
  const sensorSubsystemNodeId = 'node-subsystem-sensors';
  const controlSubsystemNodeId = 'node-subsystem-control';
  const actuationSubsystemNodeId = 'node-subsystem-actuation';
  const dynamicsSubsystemNodeId = 'node-subsystem-dynamics';
  const sensorCanvasId = createSubsystemCanvasId(sensorSubsystemNodeId);
  const controlCanvasId = createSubsystemCanvasId(controlSubsystemNodeId);
  const actuationCanvasId = createSubsystemCanvasId(actuationSubsystemNodeId);
  const dynamicsCanvasId = createSubsystemCanvasId(dynamicsSubsystemNodeId);

  const sensorDefinition = {
    inputs: [
      { id: 'in-1', name: 'True Velocity', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'in-2', name: 'Held Velocity', type: SCALAR_PORT_TYPE, order: 1 },
      { id: 'in-3', name: 'Vertical Accel', type: SCALAR_PORT_TYPE, order: 2 },
      { id: 'in-4', name: 'Roll Moment', type: SCALAR_PORT_TYPE, order: 3 }
    ],
    outputs: [
      { id: 'out-1', name: 'Measured Rate', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'out-2', name: 'Measured Accel', type: SCALAR_PORT_TYPE, order: 1 },
      { id: 'out-3', name: 'Estimated Altitude', type: SCALAR_PORT_TYPE, order: 2 },
      { id: 'out-4', name: 'Reported Velocity', type: SCALAR_PORT_TYPE, order: 3 }
    ]
  };
  const controlDefinition = {
    inputs: [
      { id: 'in-1', name: 'Attitude Error', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'in-2', name: 'Rate Feedback', type: SCALAR_PORT_TYPE, order: 1 }
    ],
    outputs: [
      { id: 'out-1', name: 'Command', type: SCALAR_PORT_TYPE, order: 0 }
    ]
  };
  const actuationDefinition = {
    inputs: [
      { id: 'in-1', name: 'Total Thrust', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'in-2', name: 'Roll Command', type: SCALAR_PORT_TYPE, order: 1 }
    ],
    outputs: [
      { id: 'out-1', name: 'Left Thrust', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'out-2', name: 'Right Thrust', type: SCALAR_PORT_TYPE, order: 1 }
    ]
  };
  const dynamicsDefinition = {
    inputs: [
      { id: 'in-1', name: 'Left Thrust', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'in-2', name: 'Right Thrust', type: SCALAR_PORT_TYPE, order: 1 }
    ],
    outputs: [
      { id: 'out-1', name: 'Vertical Accel', type: SCALAR_PORT_TYPE, order: 0 },
      { id: 'out-2', name: 'Roll Moment', type: SCALAR_PORT_TYPE, order: 1 }
    ]
  };

  const rootCanvas = createCanvas(rootCanvasId, 'Top');
  const sensorsShell = createSubsystemShell(sensorSubsystemNodeId, 'Sensors', sensorCanvasId, 300, 250, sensorDefinition);
  const controlShell = createSubsystemShell(controlSubsystemNodeId, 'Control', controlCanvasId, 620, 180, controlDefinition);
  const actuationShell = createSubsystemShell(actuationSubsystemNodeId, 'Actuation & Motors', actuationCanvasId, 930, 180, actuationDefinition);
  const dynamicsShell = createSubsystemShell(dynamicsSubsystemNodeId, 'Dynamics & Feedback', dynamicsCanvasId, 1250, 180, dynamicsDefinition);

  rootCanvas.nodes = [
    clone(requireSnapshotNode(flatSnapshot, 'node-1')),
    clone(requireSnapshotNode(flatSnapshot, 'node-2')),
    clone(requireSnapshotNode(flatSnapshot, 'node-13')),
    sensorsShell,
    controlShell,
    actuationShell,
    dynamicsShell,
    clone(requireSnapshotNode(flatSnapshot, 'node-11')),
    clone(requireSnapshotNode(flatSnapshot, 'node-12'))
  ];

  const sensorsCanvasData = createSubsystemCanvas(
    sensorCanvasId,
    'Sensors',
    sensorsShell.id,
    sensorDefinition,
    pickNodes(flatSnapshot, ['node-3', 'node-4', 'node-5', 'node-6']),
    []
  );
  const controlCanvasData = createSubsystemCanvas(
    controlCanvasId,
    'Control',
    controlShell.id,
    controlDefinition,
    pickNodes(flatSnapshot, ['node-7']),
    []
  );
  const actuationCanvasData = createSubsystemCanvas(
    actuationCanvasId,
    'Actuation & Motors',
    actuationShell.id,
    actuationDefinition,
    pickNodes(flatSnapshot, ['node-8', 'node-9']),
    []
  );
  const dynamicsCanvasData = createSubsystemCanvas(
    dynamicsCanvasId,
    'Dynamics & Feedback',
    dynamicsShell.id,
    dynamicsDefinition,
    pickNodes(flatSnapshot, ['node-10']),
    []
  );

  const [sensorTrueVelocityInput, sensorHeldVelocityInput, sensorVerticalAccelInput, sensorRollMomentInput] = sensorsCanvasData.inputBoundaryNodes;
  const [sensorMeasuredRateOutput, sensorMeasuredAccelOutput, sensorEstimatedAltitudeOutput, sensorReportedVelocityOutput] = sensorsCanvasData.outputBoundaryNodes;
  const [controlAttitudeErrorInput, controlRateFeedbackInput] = controlCanvasData.inputBoundaryNodes;
  const [controlCommandOutput] = controlCanvasData.outputBoundaryNodes;
  const [actuationTotalThrustInput, actuationRollCommandInput] = actuationCanvasData.inputBoundaryNodes;
  const [actuationLeftThrustOutput, actuationRightThrustOutput] = actuationCanvasData.outputBoundaryNodes;
  const [dynamicsLeftThrustInput, dynamicsRightThrustInput] = dynamicsCanvasData.inputBoundaryNodes;
  const [dynamicsVerticalAccelOutput, dynamicsRollMomentOutput] = dynamicsCanvasData.outputBoundaryNodes;

  rootCanvas.edges = [
    createEdge('edge-h-1', 'node-2', sensorsShell.id, 0, 0),
    createEdge('edge-h-2', 'node-13', sensorsShell.id, 0, 1),
    createEdge('edge-h-3', dynamicsShell.id, sensorsShell.id, 0, 2),
    createEdge('edge-h-4', dynamicsShell.id, sensorsShell.id, 1, 3),
    createEdge('edge-h-5', 'node-1', controlShell.id, 0, 0),
    createEdge('edge-h-6', sensorsShell.id, controlShell.id, 0, 1),
    createEdge('edge-h-7', sensorsShell.id, actuationShell.id, 2, 0),
    createEdge('edge-h-8', controlShell.id, actuationShell.id, 0, 1),
    createEdge('edge-h-9', actuationShell.id, dynamicsShell.id, 0, 0),
    createEdge('edge-h-10', actuationShell.id, dynamicsShell.id, 1, 1),
    createEdge('edge-h-11', dynamicsShell.id, 'node-11', 0, 0),
    createEdge('edge-h-12', dynamicsShell.id, 'node-11', 1, 1),
    createEdge('edge-h-13', sensorsShell.id, 'node-12', 1, 0),
    createEdge('edge-h-14', sensorsShell.id, 'node-12', 3, 1)
  ];

  sensorsCanvasData.canvas.edges = [
    createEdge('edge-h-s-1', sensorTrueVelocityInput.id, 'node-6', 0, 0),
    createEdge('edge-h-s-2', sensorHeldVelocityInput.id, 'node-6', 0, 1),
    createEdge('edge-h-s-3', sensorVerticalAccelInput.id, 'node-4', 0, 0),
    createEdge('edge-h-s-4', sensorVerticalAccelInput.id, 'node-5', 0, 0),
    createEdge('edge-h-s-5', sensorRollMomentInput.id, 'node-3', 0, 0),
    createEdge('edge-h-s-6', 'node-3', sensorMeasuredRateOutput.id, 0, 0),
    createEdge('edge-h-s-7', 'node-4', sensorMeasuredAccelOutput.id, 0, 0),
    createEdge('edge-h-s-8', 'node-5', sensorEstimatedAltitudeOutput.id, 0, 0),
    createEdge('edge-h-s-9', 'node-6', sensorReportedVelocityOutput.id, 0, 0)
  ];
  controlCanvasData.canvas.edges = [
    createEdge('edge-h-c-1', controlAttitudeErrorInput.id, 'node-7', 0, 0),
    createEdge('edge-h-c-2', controlRateFeedbackInput.id, 'node-7', 0, 1),
    createEdge('edge-h-c-3', 'node-7', controlCommandOutput.id, 0, 0)
  ];
  actuationCanvasData.canvas.edges = [
    createEdge('edge-h-a-1', actuationTotalThrustInput.id, 'node-8', 0, 0),
    createEdge('edge-h-a-2', actuationRollCommandInput.id, 'node-8', 0, 1),
    createEdge('edge-h-a-3', 'node-8', 'node-9', 0, 0),
    createEdge('edge-h-a-4', 'node-8', 'node-9', 1, 1),
    createEdge('edge-h-a-5', 'node-9', actuationLeftThrustOutput.id, 0, 0),
    createEdge('edge-h-a-6', 'node-9', actuationRightThrustOutput.id, 1, 0)
  ];
  dynamicsCanvasData.canvas.edges = [
    createEdge('edge-h-d-1', dynamicsLeftThrustInput.id, 'node-10', 0, 0),
    createEdge('edge-h-d-2', dynamicsRightThrustInput.id, 'node-10', 0, 1),
    createEdge('edge-h-d-3', 'node-10', dynamicsVerticalAccelOutput.id, 0, 0),
    createEdge('edge-h-d-4', 'node-10', dynamicsRollMomentOutput.id, 1, 0)
  ];

  return {
    version: 1,
    rootCanvasId,
    activeCanvasId: rootCanvasId,
    canvasTrail: [rootCanvasId],
    canvases: {
      [rootCanvasId]: rootCanvas,
      [sensorCanvasId]: sensorsCanvasData.canvas,
      [controlCanvasId]: controlCanvasData.canvas,
      [actuationCanvasId]: actuationCanvasData.canvas,
      [dynamicsCanvasId]: dynamicsCanvasData.canvas
    },
    nodeSeq: flatSnapshot.nodeSeq,
    edgeSeq: flatSnapshot.edgeSeq,
    activeLineType: flatSnapshot.activeLineType,
    faultedBlks: [],
    importedFaultModels: []
  };
}

const meta = await loadJson('package-meta.json');
const faultLibrary = await loadJson('fault-library.json');
const snapshot = await loadJson('workbench-snapshot.json');
const files = (await readdir(modulesDir))
  .filter((name) => name.endsWith('.py'))
  .sort();

const parsedModules = new Map();
for (const fileName of files) {
  const source = await readFile(path.join(modulesDir, fileName), 'utf8');
  const parsed = parsePythonBindingSource({ fileName, source });
  parsedModules.set(parsed.moduleName, parsed);
}

snapshot.modelNodes = snapshot.modelNodes.map((node) => {
  if (node.type !== 'simulation_block' || !node.pythonBinding?.moduleId) {
    return node;
  }

  const parsedModule = parsedModules.get(node.pythonBinding.moduleId);
  if (!parsedModule) {
    throw new Error(`Missing parsed module for ${node.pythonBinding.moduleId}`);
  }

  return {
    ...node,
    pythonBinding: createHydratedBinding(node.pythonBinding, parsedModule, meta)
  };
});

const pkg = buildVariantPackage({
  packageMeta: meta,
  snapshot,
  faultLibrary
});

const faultInjectedSnapshot = clone(snapshot);
const motorEfficiencyLossFault = faultLibrary.find((faultModel) => faultModel.id === 'motor_efficiency_loss');
if (!motorEfficiencyLossFault) {
  throw new Error('Missing motor_efficiency_loss fault definition for the fault-injected eVTOL package.');
}
const faultInjectedModel = {
  ...clone(motorEfficiencyLossFault),
  layer: 'electrical',
  desc: 'Preloaded electrical fault that reduces motor-side actuation efficiency.',
  tags: ['motor', 'electrical', 'preloaded'],
  createdAt: '2026-04-16',
  origin: 'package'
};
const faultInjectedTargetNode = faultInjectedSnapshot.modelNodes.find((node) => node.pythonBinding?.moduleId === 'motor_model');

if (!faultInjectedTargetNode) {
  throw new Error('Missing motor_model node for the fault-injected eVTOL package.');
}

faultInjectedTargetNode.injectedFault = {
  modelId: faultInjectedModel.id,
  name: faultInjectedModel.name,
  layer: faultInjectedModel.layer,
  tags: clone(faultInjectedModel.tags),
  desc: faultInjectedModel.desc
};
faultInjectedSnapshot.faultedBlks = [...new Set([...(faultInjectedSnapshot.faultedBlks || []), faultInjectedTargetNode.id])];
faultInjectedSnapshot.importedFaultModels = [
  faultInjectedModel,
  ...(faultInjectedSnapshot.importedFaultModels || []).filter((model) => model.id !== faultInjectedModel.id)
];

const faultInjectedMeta = {
  ...meta,
  modelId: `${meta.modelId}-fault-injected`,
  modelName: `${meta.modelName} (Fault Injected)`,
  description: `${meta.description} Includes a preloaded local actuator-side fault sample.`
};

const faultInjectedPkg = buildVariantPackage({
  packageMeta: faultInjectedMeta,
  snapshot: faultInjectedSnapshot,
  faultLibrary: [
    ...faultLibrary.filter((faultModel) => faultModel.id !== faultInjectedModel.id),
    faultInjectedModel
  ]
});

const hierarchicalSnapshot = createHierarchicalSnapshot(snapshot);
const hierarchicalMeta = {
  ...meta,
  modelId: `${meta.modelId}-hierarchical`,
  modelName: `${meta.modelName} (Hierarchical)`,
  description: `${meta.description} Layered hierarchical example package grouped into sensor, control, actuation, and dynamics canvases.`
};

const hierarchicalPkg = buildVariantPackage({
  packageMeta: hierarchicalMeta,
  snapshot: hierarchicalSnapshot,
  faultLibrary,
  layered: true
});

const hierarchicalFaultSnapshot = clone(hierarchicalSnapshot);
const actuationCanvas = hierarchicalFaultSnapshot.canvases[createSubsystemCanvasId('node-subsystem-actuation')];
const hierarchicalFaultTargetNode = actuationCanvas?.nodes.find((node) => node.pythonBinding?.moduleId === 'motor_model');

if (!actuationCanvas || !hierarchicalFaultTargetNode) {
  throw new Error('Missing motor_model node inside the hierarchical actuation canvas.');
}

const hierarchicalFaultModel = {
  ...clone(motorEfficiencyLossFault),
  layer: 'electrical',
  desc: 'Preloaded electrical fault that reduces motor-side actuation efficiency.',
  tags: ['motor', 'electrical', 'preloaded'],
  createdAt: '2026-04-16',
  origin: 'package'
};

hierarchicalFaultTargetNode.injectedFault = {
  modelId: hierarchicalFaultModel.id,
  name: hierarchicalFaultModel.name,
  layer: hierarchicalFaultModel.layer,
  tags: clone(hierarchicalFaultModel.tags),
  desc: hierarchicalFaultModel.desc
};
hierarchicalFaultSnapshot.faultedBlks = [hierarchicalFaultTargetNode.id];
hierarchicalFaultSnapshot.importedFaultModels = [hierarchicalFaultModel];

const hierarchicalFaultMeta = {
  ...meta,
  modelId: `${meta.modelId}-hierarchical-fault-injected`,
  modelName: `${meta.modelName} (Hierarchical Fault Injected)`,
  description: `${meta.description} Layered hierarchical example package with one preloaded motor_efficiency_loss fault in the actuation child canvas.`
};

const hierarchicalFaultPkg = buildVariantPackage({
  packageMeta: hierarchicalFaultMeta,
  snapshot: hierarchicalFaultSnapshot,
  faultLibrary,
  layered: true
});

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
await writeFile(faultInjectedOutputFile, `${JSON.stringify(faultInjectedPkg, null, 2)}\n`, 'utf8');
await writeFile(hierarchicalOutputFile, `${JSON.stringify(hierarchicalPkg, null, 2)}\n`, 'utf8');
await writeFile(hierarchicalFaultInjectedOutputFile, `${JSON.stringify(hierarchicalFaultPkg, null, 2)}\n`, 'utf8');
console.log(`wrote ${outputFile}`);
console.log(`wrote ${faultInjectedOutputFile}`);
console.log(`wrote ${hierarchicalOutputFile}`);
console.log(`wrote ${hierarchicalFaultInjectedOutputFile}`);
