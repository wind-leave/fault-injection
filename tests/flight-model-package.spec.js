import { describe, expect, it } from 'vitest';
import evtolReferencePackage from '../public/model-packages/evtol_small_nonlinear.json';
import globalFaultCatalog from '../fault-types/fault-type-catalog.json';
import {
  applyFlightModelPackage,
  buildFlightModelPackage,
  validateFlightModelPackage
} from '../src/services/flightModelPackageService.js';
import {
  createSimulationBlockPythonBinding
} from '../src/composables/useWorkbenchState.js';
import {
  findCompatibleFaultTarget
} from '../src/services/faultInjectionService.js';
import {
  createWorkbenchSnapshot,
  restoreWorkbenchSnapshot
} from '../src/services/workbenchSnapshotService.js';
import {
  FAULT_MATH_MODEL_DEFINITIONS,
  getComponentFaultVariables,
  normalizeModelNode
} from '../src/services/modelStore.js';
import { COMPONENT_REGISTRY } from '../src/services/componentRegistry.js';
import { buildBackendExecutablePackage } from '../src/services/backendExecutablePackageService.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PACKAGE = {
  schemaVersion: 1,
  packageType: 'flight-control-model',
  modelId: 'attitude-controller',
  modelName: 'Attitude Controller',
  description: 'Control package for the attitude loop',
  source: {
    origin: 'workbench',
    slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
    notesDoc: 'Controller handoff notes'
  },
  pythonModules: [
    {
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      category: 'control',
      source: 'def process(error, dt):\n  return error',
      parsedInterface: {
        fileName: 'attitude_pid.py',
        moduleName: 'attitude_pid',
        entryFunction: 'process'
      }
    }
  ],
  faultLibrary: [],
  workbenchSnapshot: {
    version: 1,
    modelNodes: [],
    modelEdges: [],
    nodeSeq: 0,
    edgeSeq: 0,
    activeLineType: 'normal',
    faultedBlks: [],
    importedFaultModels: []
  }
};

function loadPublicPackage(fileName) {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.resolve(testDir, '..', 'public', 'model-packages', fileName);

  return JSON.parse(readFileSync(targetPath, 'utf8'));
}

describe('flightModelPackageService', () => {
  it('preserves an existing simulation interface when importing the same node id', () => {
    const existingSnapshot = {
      ...VALID_PACKAGE.workbenchSnapshot,
      modelNodes: [{
        id: 'node-controller',
        type: 'simulation_block',
        props: {
          name: 'original-controller',
          inputs: [{ name: 'error', type: 'scalar' }],
          outputs: [{ name: 'command', type: 'scalar' }],
          middleVars: []
        }
      }]
    };
    const importedPackage = {
      ...VALID_PACKAGE,
      workbenchSnapshot: {
        ...VALID_PACKAGE.workbenchSnapshot,
        modelNodes: [{
          id: 'node-controller',
          type: 'simulation_block',
          props: {
            name: 'imported-controller',
            inputs: [{ name: 'changed-input', type: 'matrix' }],
            outputs: [],
            middleVars: []
          }
        }]
      }
    };

    const result = applyFlightModelPackage(importedPackage, { existingSnapshot });

    expect(result.ok).toBe(true);
    expect(result.snapshot.modelNodes[0].props).toMatchObject({
      name: 'original-controller',
      inputs: [{ name: 'error', type: 'scalar' }]
    });
  });

  it('validates a well-formed flight model package and rejects malformed packages', () => {
    const valid = validateFlightModelPackage(VALID_PACKAGE);
    const invalid = validateFlightModelPackage({
      ...VALID_PACKAGE,
      schemaVersion: 2,
      pythonModules: [{ fileName: 'missing-module-id.py', source: '' }]
    });
    const malformedSnapshot = validateFlightModelPackage({
      ...VALID_PACKAGE,
      workbenchSnapshot: { version: 1 }
    });

    expect(valid).toEqual({ ok: true, errors: [] });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
    expect(malformedSnapshot.ok).toBe(false);
  });

  it('rejects malformed snapshot arrays that contain non-objects', () => {
    const result = validateFlightModelPackage({
      ...VALID_PACKAGE,
      workbenchSnapshot: {
        ...VALID_PACKAGE.workbenchSnapshot,
        modelNodes: [null],
        modelEdges: [null]
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('workbenchSnapshot.modelNodes[0] must be an object.');
    expect(result.errors).toContain('workbenchSnapshot.modelEdges[0] must be an object.');
  });

  it('rejects injected faults that are not backed by the package fault library', () => {
    const result = validateFlightModelPackage({
      ...VALID_PACKAGE,
      faultLibrary: [
        {
          id: 'motor_efficiency_loss',
          name: 'Motor Efficiency Loss',
          layer: 'electrical'
        }
      ],
      workbenchSnapshot: {
        ...VALID_PACKAGE.workbenchSnapshot,
        modelNodes: [
          {
            id: 'node-faulty-1',
            type: 'simulation_block',
            injectedFault: {
              modelId: 'missing_fault_model'
            }
          }
        ]
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'workbenchSnapshot.modelNodes node "node-faulty-1" references unknown fault modelId "missing_fault_model".'
    );
  });

  it('exports generated fault models with their snapshot references and imports legacy generated faults', () => {
    const generatedFaultId = 'layered-node-25-node-control-allocation-physical-allocation_gain';
    const generatedFault = {
      instanceId: generatedFaultId,
      modelId: generatedFaultId,
      faultTypeId: generatedFaultId,
      name: 'Control allocation gain injection',
      layer: 'physical',
      runtimeBehavior: 'bias',
      parameters: { bias: 0.1, start: 0 }
    };
    const legacyPackage = {
      ...VALID_PACKAGE,
      faultLibrary: [],
      workbenchSnapshot: {
        ...VALID_PACKAGE.workbenchSnapshot,
        modelNodes: [
          {
            id: 'node-control-allocation',
            type: 'simulation_block',
            injectedFault: generatedFault,
            faultBindings: [{
              faultModelId: generatedFaultId,
              injectedFault: generatedFault,
              active: true
            }]
          }
        ],
        faultInstances: [{
          instanceId: generatedFaultId,
          faultTypeId: generatedFaultId,
          targetKind: 'node',
          targetId: 'node-control-allocation',
          layer: 'physical',
          parameters: { bias: 0.1, start: 0 }
        }]
      }
    };

    const importedLegacyPackage = applyFlightModelPackage(legacyPackage);
    expect(importedLegacyPackage.ok).toBe(true);
    expect(importedLegacyPackage.faultLibrary).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: generatedFaultId,
        layer: 'physical',
        runtimeBehavior: 'bias'
      })
    ]));

    const exportedPackage = buildFlightModelPackage({
      meta: {
        modelId: 'generated-fault-export',
        modelName: 'Generated Fault Export'
      },
      snapshot: legacyPackage.workbenchSnapshot,
      faultLibrary: []
    });

    expect(validateFlightModelPackage(exportedPackage)).toEqual({ ok: true, errors: [] });
    expect(exportedPackage.faultLibrary).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generatedFaultId })
    ]));
  });

  it('rejects whitespace-only module fields and missing entry functions', () => {
    const result = validateFlightModelPackage({
      ...VALID_PACKAGE,
      pythonModules: [
        {
          moduleId: '   ',
          fileName: '  ',
          source: ' ',
          category: 'control',
          parsedInterface: {
            fileName: 'attitude_pid.py',
            moduleName: 'attitude_pid'
          }
        },
        {
          moduleId: 'attitude_pid',
          fileName: 'attitude_pid.py',
          source: 'def process(error, dt):\n  return error',
          category: 'control',
          parsedInterface: {
            fileName: 'attitude_pid.py',
            moduleName: 'attitude_pid'
          }
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('pythonModules[0].moduleId is required.');
    expect(result.errors).toContain('pythonModules[0].fileName is required.');
    expect(result.errors).toContain('pythonModules[0].entryFunction is required.');
    expect(result.errors).toContain('pythonModules[1].entryFunction is required.');
  });

  it('removes deprecated execution endpoint settings when restoring a binding', () => {
    const restored = restoreWorkbenchSnapshot({
      modelNodes: [
        {
          id: 'node-1',
          type: 'simulation_block',
          pythonBinding: {
            bound: true,
            executionConfig: {
              timeoutMs: 5000
            }
          }
        }
      ],
      modelEdges: []
    });

    expect(restored.modelNodes[0].pythonBinding).not.toHaveProperty('executionConfig');
  });

  it('restores and creates snapshots defensively when node and edge collections are invalid', () => {
    const restored = restoreWorkbenchSnapshot({
      modelNodes: null,
      modelEdges: null,
      faultedBlks: null,
      importedFaultModels: null
    });

    const createdSnapshot = createWorkbenchSnapshot({
      modelNodes: null,
      modelEdges: null,
      faultedBlks: null,
      importedFaultModels: null
    });

    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: null,
        modelEdges: null,
        nodeSeq: 2,
        edgeSeq: 1,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(restored.modelNodes).toEqual([]);
    expect(restored.modelEdges).toEqual([]);
    expect(createdSnapshot).toEqual(expect.objectContaining({
      modelNodes: [],
      modelEdges: [],
      nodeSeq: 0,
      edgeSeq: 0
    }));

    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes).toEqual([]);
  });

  it('preserves configured fault instances through snapshots and package export/import', () => {
    const faultInstances = [
      {
        instanceId: 'fault-0526-gyro-bias',
        faultTypeId: 'gyro_zero_bias_offset',
        targetKind: 'node',
        targetId: 'node-imu',
        slotId: 'electrical:测量角速度',
        layer: 'electrical',
        bindingObject: 'imu.gyro_rate',
        targetVariable: 'imu.gyro_rate',
        parameters: { bias: 5, start: 1, duration: 2 },
        active: true
      }
    ];

    const snapshot = createWorkbenchSnapshot({
      modelNodes: [],
      modelEdges: [],
      faultInstances
    });
    const restored = restoreWorkbenchSnapshot(snapshot);
    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'fault-task-export',
        modelName: 'Fault Task Export'
      },
      snapshot,
      faultLibrary: []
    });
    const applied = applyFlightModelPackage(packageData);

    expect(snapshot.faultInstances).toEqual(faultInstances);
    expect(restored.faultInstances).toEqual(faultInstances);
    expect(packageData.faultInstances).toEqual(faultInstances);
    expect(applied.snapshot.faultInstances).toEqual(faultInstances);
  });

  it('does not save custom python modules in a flight model package', () => {
    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            pythonBinding: {
              bound: true,
              moduleId: 'attitude_pid',
              moduleName: 'attitude_pid',
              fileName: 'attitude_pid.py',
              entryFunction: 'process',
              description: 'PID loop',
              rawSource: 'def process(error, dt):\n  return error',
              parsedInterface: {
                fileName: 'attitude_pid.py',
                moduleName: 'attitude_pid',
                entryFunction: 'process'
              },
              portMapping: {
                inputs: [],
                outputs: [],
                middleVars: []
              }
            }
          }
        ],
        modelEdges: [],
        nodeSeq: 1,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(packageData.schemaVersion).toBe(1);
    expect(packageData.packageType).toBe('flight-control-model');
    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toBeNull();
    expect(packageData.workbenchSnapshot.modelNodes).toHaveLength(1);
  });

  it('does not export custom python module references when multiple blocks bind to them', () => {
    const binding = createSimulationBlockPythonBinding({
      fileName: 'attitude_pid.py',
      moduleName: 'attitude_pid',
      description: 'PID loop',
      entryFunction: 'process',
      rawSource: 'def process(error, dt):\n  return error',
      inputs: [],
      outputs: []
    }, {
      moduleCategory: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control'
    });

    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            pythonBinding: binding
          },
          {
            id: 'node-2',
            type: 'simulation_block',
            pythonBinding: {
              ...binding,
              description: 'Duplicate binding for the same module'
            }
          }
        ],
        modelEdges: [],
        nodeSeq: 2,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes.map((node) => node.pythonBinding)).toEqual([null, null]);
  });

  it('deep clones exported workbenchSnapshot.modelEdges so edits do not mutate the input snapshot', () => {
    const sourceSnapshot = {
      version: 1,
      modelNodes: [],
      modelEdges: [
        {
          id: 'edge-1',
          lineType: 'normal',
          sourceNodeId: 'node-source',
          targetNodeId: 'node-target',
          sourcePortIndex: 0,
          targetPortIndex: 0,
          sourcePort: {
            index: 0,
            varName: 'out',
            displayName: 'Output',
            type: 'float'
          },
          targetPort: {
            index: 0,
            varName: 'in',
            displayName: 'Input',
            type: 'float'
          }
        }
      ],
      nodeSeq: 0,
      edgeSeq: 1,
      activeLineType: 'normal',
      faultedBlks: [],
      importedFaultModels: []
    };

    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: sourceSnapshot,
      faultLibrary: []
    });

    packageData.workbenchSnapshot.modelEdges[0].targetPort.displayName = 'Edited Input';

    expect(packageData.workbenchSnapshot.modelEdges).not.toBe(sourceSnapshot.modelEdges);
    expect(packageData.workbenchSnapshot.modelEdges[0]).not.toBe(sourceSnapshot.modelEdges[0]);
    expect(sourceSnapshot.modelEdges[0].targetPort.displayName).toBe('Input');
    expect(packageData.workbenchSnapshot.modelEdges[0].targetPort.displayName).toBe('Edited Input');
  });

  it('preserves branched edges and signal utility block types through package export', () => {
    const snapshot = createWorkbenchSnapshot({
      rootCanvasId: 'canvas-root',
      activeCanvasId: 'canvas-root',
      canvasTrail: ['canvas-root'],
      canvases: {
        'canvas-root': {
          id: 'canvas-root',
          name: '顶层',
          parentSubsystemNodeId: null,
          viewport: { scale: 1, offsetX: 0, offsetY: 0 },
          nodes: [
            { id: 'node-source', type: 'signal_source', x: 120, y: 140, w: 164, h: 84, props: { name: 'Source', waveType: '常值', amplitude: '1', frequency: '0', outputFormat: '标量' } },
            { id: 'node-gain', type: 'gain_block', x: 360, y: 120, w: 156, h: 84, props: { name: 'Gain', gain: '0.5', inputFormat: '标量', outputFormat: '标量' } },
            { id: 'node-scope', type: 'instrument_scope', x: 640, y: 120, w: 150, h: 74, props: { name: 'Scope', instrumentType: '示波器', sampleRate: '64kHz', signal: '输出' } },
            { id: 'node-sum', type: 'sum_block', x: 360, y: 280, w: 164, h: 88, props: { name: 'Sum', inputCount: 2, signs: ['+', '+'], outputFormat: '标量' } },
            { id: 'node-mux', type: 'mux_block', x: 640, y: 280, w: 164, h: 88, props: { name: 'Mux', inputCount: 2, outputFormat: '向量' } },
            { id: 'node-adapter', type: 'flow_block', x: 900, y: 280, w: 168, h: 88, props: { name: 'Adapter', inputName: 'sum', inputFormat: '标量', outputName: 'packed', outputFormat: '向量' } }
          ],
          edges: [
            { id: 'edge-source-gain', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-gain', sourcePortIndex: 0, targetPortIndex: 0 },
            { id: 'edge-source-scope', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-scope', sourcePortIndex: 0, targetPortIndex: 0 },
            { id: 'edge-gain-sum', lineType: 'normal', sourceNodeId: 'node-gain', targetNodeId: 'node-sum', sourcePortIndex: 0, targetPortIndex: 0 },
            { id: 'edge-source-sum', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-sum', sourcePortIndex: 0, targetPortIndex: 1 },
            { id: 'edge-source-mux', lineType: 'normal', sourceNodeId: 'node-source', targetNodeId: 'node-mux', sourcePortIndex: 0, targetPortIndex: 0 },
            { id: 'edge-sum-mux', lineType: 'normal', sourceNodeId: 'node-sum', targetNodeId: 'node-mux', sourcePortIndex: 0, targetPortIndex: 1 },
            { id: 'edge-mux-adapter', lineType: 'normal', sourceNodeId: 'node-mux', targetNodeId: 'node-adapter', sourcePortIndex: 0, targetPortIndex: 0 }
          ]
        }
      },
      nodeSeq: 6,
      edgeSeq: 7,
      activeLineType: 'normal',
      faultedBlks: [],
      importedFaultModels: []
    });

    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'signal-routing-demo',
        modelName: 'Signal Routing Demo',
        description: 'Branching and utility block demo',
        source: { origin: 'workbench' }
      },
      snapshot,
      faultLibrary: []
    });

    const restored = restoreWorkbenchSnapshot(packageData.workbenchSnapshot);
    const rootCanvas = restored.canvases[restored.rootCanvasId];
    const sourceEdges = rootCanvas.edges.filter((edge) => edge.sourceNodeId === 'node-source');

    expect(packageData.pythonModules).toEqual([]);
    expect(sourceEdges).toHaveLength(4);
    expect(rootCanvas.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gain_block' }),
      expect.objectContaining({ type: 'sum_block' }),
      expect.objectContaining({ type: 'mux_block' }),
      expect.objectContaining({ type: 'flow_block' })
    ]));
  });

  it('infers moduleId for UI-created python bindings when exporting a flight model package', () => {
    const parsedInterface = {
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      description: 'PID loop',
      rawSource: 'def process(error, dt):\n  return error',
      inputs: [
        {
          name: 'error',
          type: 'float'
        }
      ],
      outputs: [
        {
          name: 'control',
          type: 'float'
        }
      ]
    };
    const binding = createSimulationBlockPythonBinding(parsedInterface);
    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            pythonBinding: binding
          }
        ],
        modelEdges: [],
        nodeSeq: 1,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(binding.moduleId).toBe('attitude_pid');
    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toBeNull();
  });

  it('preserves package-aware python binding metadata through the factory and package export', () => {
    const parsedInterface = {
      fileName: 'attitude_pid.py',
      moduleName: 'attitude_pid',
      description: 'PID loop',
      entryFunction: 'process',
      rawSource: 'def process(error, dt):\n  return error',
      inputs: [
        {
          name: 'error',
          type: 'float'
        }
      ],
      outputs: [
        {
          name: 'control',
          type: 'float'
        }
      ]
    };
    const binding = createSimulationBlockPythonBinding(parsedInterface, {
      moduleCategory: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control'
    });
    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            pythonBinding: binding
          }
        ],
        modelEdges: [],
        nodeSeq: 1,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(binding).toMatchObject({
      bound: true,
      moduleId: 'attitude_pid',
      moduleCategory: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control',
      executionMode: 'mock'
    });
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toBeNull();
    expect(packageData.pythonModules).toEqual([]);
  });

  it('keeps built-in vector simulation bindings executable after save and re-import', () => {
    const template = COMPONENT_REGISTRY.scalar_to_vector4;
    const simulationNode = {
      id: 'scalar-to-vector-node',
      type: 'simulation_block',
      templateId: template.templateId,
      props: JSON.parse(JSON.stringify(template.defaults)),
      inputs: JSON.parse(JSON.stringify(template.ports.inputs)),
      outputs: JSON.parse(JSON.stringify(template.ports.outputs)),
      pythonBinding: JSON.parse(JSON.stringify(template.pythonBinding))
    };
    const packageData = buildFlightModelPackage({
      meta: { modelId: 'vector-save-import', modelName: 'Vector Save Import' },
      snapshot: { modelNodes: [simulationNode], modelEdges: [] }
    });
    const applied = applyFlightModelPackage(packageData);
    const executable = buildBackendExecutablePackage(applied.snapshot);

    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toMatchObject({
      bound: true,
      sourceKind: 'builtin',
      moduleId: 'scalar_to_vector4'
    });
    expect(applied.ok).toBe(true);
    expect(executable.nodes[0]).toMatchObject({
      pythonBinding: { moduleId: 'scalar_to_vector4', entryFunction: 'process' },
      outputs: [{ dataType: 'vector', vectorLength: 4 }]
    });

    const legacyPackage = {
      ...packageData,
      workbenchSnapshot: {
        ...packageData.workbenchSnapshot,
        modelNodes: packageData.workbenchSnapshot.modelNodes.map((node) => ({
          ...node,
          pythonBinding: null
        }))
      }
    };
    const legacyApplied = applyFlightModelPackage(legacyPackage);
    const legacyExecutable = buildBackendExecutablePackage(legacyApplied.snapshot);

    expect(legacyApplied.ok).toBe(true);
    expect(legacyExecutable.nodes[0].pythonBinding).toEqual({
      moduleId: 'scalar_to_vector4',
      entryFunction: 'process'
    });
  });

  it('skips incomplete bound simulation blocks when exporting python modules', () => {
    const packageData = buildFlightModelPackage({
      meta: {
        modelId: 'attitude-controller',
        modelName: 'Attitude Controller',
        description: 'Control package for the attitude loop',
        source: {
          origin: 'workbench',
          slxFile: 'eVTOL_Small_nonandlin_algorithm_validation.slx',
          notesDoc: 'Controller handoff notes'
        }
      },
      snapshot: {
        version: 1,
        modelNodes: [
          {
            id: 'node-1',
            type: 'simulation_block',
            pythonBinding: {
              bound: true,
              moduleId: 'attitude_pid',
              fileName: 'attitude_pid.py',
              entryFunction: 'process',
              rawSource: 'def process(error, dt):\n  return error'
            }
          },
          {
            id: 'node-2',
            type: 'simulation_block',
            pythonBinding: {
              bound: true,
              moduleId: 'broken_module',
              fileName: 'broken_module.py',
              entryFunction: '',
              rawSource: 'def process(error):\n  return error'
            }
          }
        ],
        modelEdges: [],
        nodeSeq: 2,
        edgeSeq: 0,
        activeLineType: 'normal',
        faultedBlks: [],
        importedFaultModels: []
      },
      faultLibrary: []
    });

    expect(packageData.pythonModules).toEqual([]);
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toBeNull();
    expect(packageData.workbenchSnapshot.modelNodes[1].pythonBinding).toBeNull();
  });

  it('ships a reusable eVTOL reference package', () => {
    const validation = validateFlightModelPackage(evtolReferencePackage);

    expect(validation).toEqual({ ok: true, errors: [] });
    expect(evtolReferencePackage.pythonModules.map((item) => item.moduleId)).toEqual([
      'imu_gyro',
      'imu_accel',
      'barometer',
      'gps_velocity',
      'attitude_pid',
      'control_allocation',
      'motor_model',
      'vehicle_dynamics'
    ]);
    expect(evtolReferencePackage.faultLibrary.length).toBeGreaterThanOrEqual(5);
    expect(evtolReferencePackage.workbenchSnapshot.modelNodes.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps the reference package compatible with the current local runtime', () => {
    const scopeEdges = evtolReferencePackage.workbenchSnapshot.modelEdges
      .filter((edge) => edge.targetNodeId === 'node-12');
    const signalSources = evtolReferencePackage.workbenchSnapshot.modelNodes
      .filter((node) => node.type === 'signal_source');
    const gpsModule = evtolReferencePackage.pythonModules
      .find((item) => item.moduleId === 'gps_velocity');
    const motorModule = evtolReferencePackage.pythonModules
      .find((item) => item.moduleId === 'motor_model');
    const motorLockFault = evtolReferencePackage.faultLibrary
      .find((item) => item.id === 'motor_lock');
    const gpsFreezeFault = evtolReferencePackage.faultLibrary
      .find((item) => item.id === 'gps_freeze');

    expect(scopeEdges).toHaveLength(2);
    expect(signalSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        props: expect.objectContaining({
          name: 'Attitude Error',
          waveType: '常值',
          amplitude: '0.6',
          frequency: '1.0',
          outputFormat: '标量'
        })
      }),
      expect.objectContaining({
        props: expect.objectContaining({
          name: 'True Velocity',
          waveType: '正弦',
          amplitude: '1.2',
          frequency: '0.25',
          outputFormat: '标量'
        })
      }),
      expect.objectContaining({
        props: expect.objectContaining({
          name: 'Held Velocity Sample',
          waveType: '常值',
          amplitude: '1.2',
          frequency: '1.0',
          outputFormat: '标量'
        })
      })
    ]));
    expect(gpsModule?.parsedInterface?.inputs.map((item) => item.name)).toEqual([
      'true_velocity',
      'held_velocity',
      'freeze'
    ]);
    expect(gpsModule?.parsedInterface?.description).toBe('GPS velocity channel with held-sample freeze approximation');
    expect(evtolReferencePackage.workbenchSnapshot.modelEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetNodeId: 'node-6',
        targetPortIndex: 1
      })
    ]));
    expect(motorModule?.parsedInterface?.inputs.map((item) => item.name)).toEqual([
      'left_cmd',
      'right_cmd',
      'efficiency',
      'left_lock',
      'saturation'
    ]);
    expect(motorLockFault).toMatchObject({
      parameter: 'left_lock',
      defaultValue: 1.0
    });
    expect(gpsFreezeFault).toMatchObject({
      id: 'gps_freeze',
      name: 'GPS Freeze Approximation (Held Sample)',
      parameter: 'freeze',
      defaultValue: 1.0,
      description: 'Simplified reference-package fault that switches GPS velocity output to a predefined held sample instead of latching the live previous sample.'
    });
  });





  it('derives component-owned fault slots from module interface declarations', () => {
    const node = normalizeModelNode({
      id: 'node-controller',
      type: 'simulation_block',
      props: {
        name: 'Attitude controller',
        modelParameters: [
          { key: 'A', name: 'gain A', targetField: 'params.A', unit: 'N' }
        ],
        inputs: [
          { varName: 'B', name: 'pitch error', signalId: 'attitude.pitch_error', type: 'float' }
        ],
        middleVars: [
          { varName: 'C', name: 'integrator state', targetField: 'state.integrator', type: 'float' }
        ],
        faultInjection: {
          physical: ['A', 'B', 'C'],
          electrical: ['B'],
          protocol: ['C']
        }
      }
    });

    expect(node.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'physical:A',
        slotName: 'gain A',
        layer: 'physical',
        variableKey: 'A',
        variableRole: 'parameter',
        targetField: 'params.A',
        bindingObject: 'A',
        targetVariable: 'A'
      }),
      expect.objectContaining({
        slotId: 'physical:B',
        slotName: 'pitch error',
        layer: 'physical',
        variableKey: 'B',
        variableRole: 'input',
        targetField: 'inputs.B',
        bindingObject: 'B',
        targetVariable: 'B'
      }),
      expect.objectContaining({
        slotId: 'physical:C',
        slotName: 'integrator state',
        layer: 'physical',
        variableKey: 'C',
        variableRole: 'middle',
        targetField: 'state.integrator',
        bindingObject: 'C',
        targetVariable: 'C'
      }),
      expect.objectContaining({
        slotId: 'electrical:B',
        slotName: 'pitch error',
        layer: 'electrical',
        variableKey: 'B',
        variableRole: 'input',
        targetField: 'inputs.B',
        bindingObject: 'B',
        targetVariable: 'B'
      }),
      expect.objectContaining({
        slotId: 'protocol:C',
        slotName: 'integrator state',
        layer: 'protocol',
        variableKey: 'C',
        variableRole: 'middle',
        targetField: 'state.integrator',
        bindingObject: 'C',
        targetVariable: 'C'
      })
    ]);
  });

  it('derives component fault variables from module parameters and interface ports', () => {
    const variables = getComponentFaultVariables({
      id: 'node-mixer',
      type: 'simulation_block',
      props: {
        inputs: [
          { varName: 'motor_command', name: 'Motor command' }
        ],
        outputs: [
          { varName: 'm1_command', name: 'M1 command' }
        ],
        middleVars: [
          { varName: 'mix_state', name: 'Mixer state' }
        ]
      },
      pythonBinding: {
        parsedInterface: {
          moduleName: 'motor_mixer',
          inputs: [
            { name: 'motor_command', type: 'float', default: null },
            { name: 'mix_gain', displayName: 'Mix gain', type: 'float', default: '1.0' },
            { name: 'command_limit', displayName: 'Command limit', type: 'float', default: '0.8' }
          ]
        }
      }
    });

    expect(variables.map((variable) => variable.key)).toEqual([
      'mix_gain',
      'command_limit',
      'motor_command',
      'm1_command',
      'mix_state'
    ]);
    expect(variables.map((variable) => variable.role)).toEqual([
      'parameter',
      'parameter',
      'input',
      'output',
      'middle'
    ]);
    expect(variables.map((variable) => variable.targetField)).toEqual([
      'params.mix_gain',
      'params.command_limit',
      'inputs.motor_command',
      'outputs.m1_command',
      'middleVars.mix_state'
    ]);
    expect(variables.map((variable) => variable.bindingObject)).toEqual([
      'mix_gain',
      'command_limit',
      'motor_command',
      'm1_command',
      'mix_state'
    ]);
  });

  it('keeps vector parameter length on declared fault slots', () => {
    const node = normalizeModelNode({
      id: 'node-controller',
      type: 'simulation_block',
      props: {
        parameters: [
          { key: 'gains', name: 'Controller gains', default: '[1.0, 0.5, 0.2]' }
        ],
        faultInjection: { physical: ['gains'], electrical: [], protocol: [] }
      }
    });

    expect(node.faultSlots).toContainEqual(expect.objectContaining({
      slotId: 'physical:gains',
      targetField: 'params.gains',
      dataType: 'vector',
      vectorLength: 3
    }));
  });

  it('preserves executable physical parameter targets for default fault slots', () => {
    const node = normalizeModelNode({
      id: 'node-allocation',
      type: 'simulation_block',
      props: {
        modelParameters: [
          {
            key: 'allocation_gain',
            name: 'Allocation gain',
            targetField: 'params.allocationGain'
          }
        ]
      }
    });

    expect(node.faultSlots).toContainEqual(expect.objectContaining({
      slotId: 'physical:parameter:allocation_gain',
      layer: 'physical',
      targetField: 'params.allocationGain',
      parameterKey: 'allocation_gain'
    }));
  });

  it('does not infer undeclared component variables once a layer declaration exists', () => {
    const node = normalizeModelNode({
      id: 'node-controller',
      type: 'simulation_block',
      props: {
        modelParameters: [
          { key: 'A', name: 'gain A' },
          { key: 'unused_gain', name: 'Unused gain' }
        ],
        inputs: [
          { varName: 'B', name: 'pitch error' },
          { varName: 'unused_input', name: 'Unused input' }
        ],
        faultInjection: {
          physical: ['A'],
          electrical: ['B'],
          protocol: []
        }
      }
    });

    expect(node.faultSlots.map((slot) => slot.slotId)).toEqual(['physical:A', 'electrical:B']);
    expect(node.faultSlots.find((slot) => slot.slotId === 'electrical:B')).toMatchObject({
      slotName: 'pitch error',
      variableRole: 'input',
      bindingObject: 'B',
      targetVariable: 'B'
    });
  });

  it('maps explicit object-style protocol fields without defaulting them to parameter slots', () => {
    const node = normalizeModelNode({
      id: 'node-can-adapter',
      type: 'simulation_block',
      props: {
        faultInjection: {
          physical: [],
          electrical: [],
          protocol: [
            {
              key: 'can_payload',
              slotName: 'CAN payload',
              variableRole: 'protocol',
              targetField: 'protocol.payload'
            }
          ]
        }
      }
    });

    expect(node.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'protocol:can_payload',
        slotName: 'CAN payload',
        layer: 'protocol',
        variableKey: 'can_payload',
        variableRole: 'protocol',
        targetField: 'protocol.payload',
        bindingObject: 'can_payload',
        targetVariable: 'can_payload'
      })
    ]);
  });

  it('supports object-style declared variables and ignores unknown string declarations', () => {
    const node = normalizeModelNode({
      id: 'node-can-adapter',
      type: 'simulation_block',
      props: {
        faultInjection: {
          physical: ['missing_gain'],
          electrical: [],
          protocol: [
            {
              key: 'frame_counter',
              slotName: 'Frame counter',
              variableRole: 'protocol'
            }
          ]
        }
      }
    });

    expect(node.faultSlots).toEqual([
      expect.objectContaining({
        slotId: 'protocol:frame_counter',
        slotName: 'Frame counter',
        layer: 'protocol',
        variableKey: 'frame_counter',
        variableRole: 'protocol',
        targetField: 'protocol.frame_counter',
        bindingObject: 'frame_counter',
        targetVariable: 'frame_counter'
      })
    ]);
    expect(node.faultSlots.some((slot) => slot.slotId === 'physical:missing_gain')).toBe(false);
  });

  it('defines distinct physical-layer math models for slot selection', () => {
    const byId = Object.fromEntries(
      FAULT_MATH_MODEL_DEFINITIONS.physical.map((model) => [model.id, model])
    );

    expect(Object.keys(byId)).toEqual([
      'bias',
      'drift',
      'step',
      'degradation',
      'freeze',
      'random'
    ]);
    expect(byId.bias.formula).toBe('p_fault = p + bias');
    expect(byId.drift.formula).toBe('p_fault = p + rate * max(t - start, 0)');
    expect(byId.freeze.defaultParameters).toEqual({ start: 0 });
    expect(byId.random.defaultParameters).toMatchObject({ seed: 1, std: 0.08 });
  });

  it('limits protocol-layer math models to attenuation and cutoff', () => {
    expect(FAULT_MATH_MODEL_DEFINITIONS.protocol).toEqual([
      expect.objectContaining({
        id: 'attenuation',
        defaultParameters: { scale: 0.5, start: 0, duration: '' }
      }),
      expect.objectContaining({
        id: 'data_cutoff',
        defaultParameters: { start: 0, duration: '' }
      })
    ]);
  });

  it('normalizes edge fault slots when applying packages that do not declare them yet', () => {
    const packageData = {
      ...VALID_PACKAGE,
      workbenchSnapshot: {
        ...VALID_PACKAGE.workbenchSnapshot,
        modelEdges: [
          {
            id: 'edge-normal',
            lineType: 'normal',
            signalId: 'controller.output',
            sourceNodeId: 'node-source',
            targetNodeId: 'node-target'
          },
          {
            id: 'edge-can',
            lineType: 'can',
            signalId: 'imu.pitch_rate',
            channelId: 'CAN-FC-IMU',
            messageId: '0x184',
            sourceNodeId: 'node-imu',
            targetNodeId: 'node-controller'
          }
        ]
      }
    };
    const applied = applyFlightModelPackage(packageData);
    const normalEdge = applied.snapshot.modelEdges.find((edge) => edge.id === 'edge-normal');
    const canEdge = applied.snapshot.modelEdges.find((edge) => edge.id === 'edge-can');

    expect(applied.ok).toBe(true);
    expect(normalEdge.faultSlots.map((slot) => slot.layer)).toEqual(['protocol']);
    expect(canEdge.faultSlots.map((slot) => slot.layer)).toEqual(['protocol']);
  });





  it('normalizes legacy signal sources to analog domain during package import', () => {
    const pkg = {
      schemaVersion: 1,
      packageType: 'flight-control-model',
      modelId: 'legacy-signal-source',
      modelName: 'Legacy Signal Source',
      pythonModules: [],
      faultLibrary: [],
      workbenchSnapshot: {
        modelNodes: [
          {
            id: 'node-source',
            type: 'signal_source',
            props: { name: 'Legacy Source', waveType: '常值', amplitude: '1', frequency: '0', outputFormat: '标量' }
          }
        ],
        modelEdges: []
      }
    };

    const result = applyFlightModelPackage(pkg);

    expect(result.ok).toBe(true);
    expect(result.snapshot.modelNodes[0].props).toMatchObject({
      name: 'Legacy Source',
      signalDomain: 'analog',
      waveType: '常值',
      amplitude: '1',
      frequency: '0',
      outputFormat: '标量'
    });
  });

});
