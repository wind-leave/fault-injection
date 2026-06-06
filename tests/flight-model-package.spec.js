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

function collectLinkedSubsystemNodes(snapshot) {
  const rootCanvas = snapshot?.canvases?.[snapshot?.rootCanvasId];
  if (!rootCanvas) {
    return [];
  }

  return (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
}

describe('flightModelPackageService', () => {
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
    expect(result.errors).toContain('pythonModules[0].source is required.');
    expect(result.errors).toContain('pythonModules[0].entryFunction is required.');
    expect(result.errors).toContain('pythonModules[1].entryFunction is required.');
  });

  it('preserves the default execution endpoint when restoring a partial binding config', () => {
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

    expect(restored.modelNodes[0].pythonBinding.executionConfig).toMatchObject({
      endpoint: 'http://127.0.0.1:8765/api/python-flow/execute',
      timeoutMs: 5000
    });
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

  it('builds a flight model package with embedded python modules from bound simulation blocks', () => {
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
    expect(packageData.pythonModules).toHaveLength(1);
    expect(packageData.pythonModules[0]).toMatchObject({
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process'
    });
    expect(packageData.workbenchSnapshot.modelNodes).toHaveLength(1);
  });

  it('exports a single pythonModules entry when multiple simulation blocks bind to the same module', () => {
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

    expect(packageData.pythonModules).toHaveLength(1);
    expect(packageData.pythonModules[0]).toMatchObject({
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process',
      category: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control'
    });
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
    expect(packageData.pythonModules).toHaveLength(1);
    expect(packageData.pythonModules[0]).toMatchObject({
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process'
    });
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toMatchObject({
      bound: true,
      moduleId: 'attitude_pid',
      fileName: 'attitude_pid.py',
      entryFunction: 'process'
    });
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
    expect(packageData.workbenchSnapshot.modelNodes[0].pythonBinding).toMatchObject({
      bound: true,
      moduleId: 'attitude_pid',
      moduleCategory: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control'
    });
    expect(packageData.pythonModules[0]).toMatchObject({
      moduleId: 'attitude_pid',
      category: 'controllers',
      sourcePackageId: 'evtol-small-nonlinear',
      sourcePackageName: 'eVTOL Small Nonlinear Flight Control'
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

    expect(packageData.pythonModules).toHaveLength(1);
    expect(packageData.pythonModules[0].moduleId).toBe('attitude_pid');
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

  it('loads the hierarchical eVTOL fixture file with nested child canvases', () => {
    const hierarchicalPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical.json');
    const hierarchicalValidation = validateFlightModelPackage(hierarchicalPackage);
    const hierarchicalApplied = applyFlightModelPackage(hierarchicalPackage);
    const expectedLinkedSubsystemCount = collectLinkedSubsystemNodes(hierarchicalPackage.workbenchSnapshot).length;

    expect(hierarchicalValidation).toEqual({ ok: true, errors: [] });
    expect(expectedLinkedSubsystemCount).toBeGreaterThan(0);
    expect(hierarchicalApplied.ok).toBe(true);
    if (!hierarchicalApplied.ok) {
      throw new Error(`Failed to apply hierarchical package: ${(hierarchicalApplied.errors || []).join('; ')}`);
    }
    const rootCanvasId = hierarchicalApplied.snapshot.rootCanvasId;
    const rootCanvas = hierarchicalApplied.snapshot.canvases[rootCanvasId];
    expect(rootCanvasId).toBeTruthy();
    expect(rootCanvas).toBeTruthy();
    if (!rootCanvas) {
      throw new Error('Missing imported root canvas');
    }
    const linkedSubsystemNodes = (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
    expect(linkedSubsystemNodes).toHaveLength(expectedLinkedSubsystemCount);

    const linkedChildCanvases = linkedSubsystemNodes
      .map((node) => hierarchicalApplied.snapshot.canvases[node.targetCanvasId])
      .filter(Boolean);
    expect(linkedChildCanvases).toHaveLength(expectedLinkedSubsystemCount);
    linkedSubsystemNodes.forEach((node) => {
      const childCanvas = hierarchicalApplied.snapshot.canvases[node.targetCanvasId];
      expect(childCanvas).toBeTruthy();
      if (!childCanvas) {
        throw new Error(`Missing linked child canvas for subsystem ${node.id}`);
      }
      expect(childCanvas.parentSubsystemNodeId).toBe(node.id);
      expect(childCanvas.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'simulation_block', pythonBinding: expect.objectContaining({ bound: true }) })
      ]));
      expect(childCanvas.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'subsystem_in_port' }),
        expect.objectContaining({ type: 'subsystem_out_port' })
      ]));
    });
  });

  it('loads the hierarchical eVTOL fault fixture file with child-local motor fault state', () => {
    const hierarchicalFaultPackage = loadPublicPackage('evtol_small_nonlinear_hierarchical_fault_injected.json');
    const hierarchicalFaultValidation = validateFlightModelPackage(hierarchicalFaultPackage);
    const hierarchicalFaultApplied = applyFlightModelPackage(hierarchicalFaultPackage);
    const expectedLinkedSubsystemCount = collectLinkedSubsystemNodes(hierarchicalFaultPackage.workbenchSnapshot).length;

    expect(hierarchicalFaultValidation).toEqual({ ok: true, errors: [] });
    expect(expectedLinkedSubsystemCount).toBeGreaterThan(0);
    expect(hierarchicalFaultApplied.ok).toBe(true);
    if (!hierarchicalFaultApplied.ok) {
      throw new Error(`Failed to apply hierarchical fault package: ${(hierarchicalFaultApplied.errors || []).join('; ')}`);
    }
    const rootCanvasId = hierarchicalFaultApplied.snapshot.rootCanvasId;
    const rootCanvas = hierarchicalFaultApplied.snapshot.canvases[rootCanvasId];
    expect(rootCanvasId).toBeTruthy();
    expect(rootCanvas).toBeTruthy();
    if (!rootCanvas) {
      throw new Error('Missing imported fault root canvas');
    }
    const rootFaultNodes = (rootCanvas.nodes || []).filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss');
    expect(rootFaultNodes).toHaveLength(0);
    const linkedSubsystemNodes = (rootCanvas.nodes || []).filter((node) => node?.type === 'subsystem_block' && node.targetCanvasId);
    expect(linkedSubsystemNodes).toHaveLength(expectedLinkedSubsystemCount);

    const linkedChildCanvases = linkedSubsystemNodes
      .map((node) => hierarchicalFaultApplied.snapshot.canvases[node.targetCanvasId])
      .filter(Boolean);
    expect(linkedChildCanvases).toHaveLength(expectedLinkedSubsystemCount);
    linkedSubsystemNodes.forEach((node) => {
      const childCanvas = hierarchicalFaultApplied.snapshot.canvases[node.targetCanvasId];
      expect(childCanvas).toBeTruthy();
      if (!childCanvas) {
        throw new Error(`Missing linked child canvas for subsystem ${node.id}`);
      }
      expect(childCanvas.parentSubsystemNodeId).toBe(node.id);
    });

    const faultedChildCanvases = linkedChildCanvases.filter((childCanvas) => (
      childCanvas.nodes?.some((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss')
    ));
    expect(faultedChildCanvases).toHaveLength(1);
    const faultedChildCanvas = faultedChildCanvases[0];
    expect(faultedChildCanvas).toBeTruthy();
    if (!faultedChildCanvas) {
      throw new Error('Missing faulted child canvas');
    }
    const faultNodes = faultedChildCanvas.nodes.filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss');
    expect(faultNodes).toHaveLength(1);
    const totalFaultNodes = linkedChildCanvases.reduce((count, childCanvas) => (
      count + (childCanvas.nodes || []).filter((node) => node?.injectedFault?.modelId === 'motor_efficiency_loss').length
    ), 0);
    expect(totalFaultNodes).toBe(1);
    const faultNode = faultNodes[0];
    expect(faultNode).toBeTruthy();
    if (!faultNode) {
      throw new Error('Missing injected fault node in faulted child canvas');
    }
    expect(faultNode.type).toBe('simulation_block');
    expect(faultNode.injectedFault).toMatchObject({
      modelId: 'motor_efficiency_loss',
      layer: 'electrical',
      name: 'Motor Efficiency Loss'
    });
  });

  it('loads the flat fault-injected eVTOL fixture file with the canonical motor_efficiency_loss fault id', () => {
    const flatFaultPackage = loadPublicPackage('evtol_small_nonlinear_fault_injected.json');
    const flatFaultValidation = validateFlightModelPackage(flatFaultPackage);
    const flatFaultApplied = applyFlightModelPackage(flatFaultPackage);
    const faultNodes = flatFaultPackage.workbenchSnapshot.modelNodes.filter((node) => node?.injectedFault?.modelId);
    const matchingFaultModels = flatFaultPackage.faultLibrary.filter((faultModel) => faultModel?.id === 'motor_efficiency_loss');

    expect(flatFaultValidation).toEqual({ ok: true, errors: [] });
    expect(flatFaultApplied.ok).toBe(true);
    expect(faultNodes).toHaveLength(1);
    expect(matchingFaultModels).toHaveLength(1);
    expect(faultNodes[0].injectedFault).toMatchObject({
      modelId: 'motor_efficiency_loss',
      layer: 'electrical',
      name: 'Motor Efficiency Loss'
    });
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

  it('loads the closed-loop fault demo with CAN metadata and UAV fault-library scope', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const validation = validateFlightModelPackage(closedLoopPackage);
    const applied = applyFlightModelPackage(closedLoopPackage);
    const edges = closedLoopPackage.workbenchSnapshot.modelEdges;
    const canEdge = edges.find((edge) => edge.id === 'edge-imu-error');
    const scopeEdges = edges.filter((edge) => edge.targetNodeId === 'node-scope');

    expect(validation).toEqual({ ok: true, errors: [] });
    expect(applied.ok).toBe(true);
    expect(closedLoopPackage).toMatchObject({
      systemFamily: 'uav-flight-control',
      supportedFaultLibraries: ['uav-flight-control-faults'],
      modelId: 'evtol-closed-loop-fault-demo'
    });
    expect(closedLoopPackage.workbenchSnapshot.modelNodes.length).toBeGreaterThanOrEqual(8);
    expect(scopeEdges.length).toBeGreaterThanOrEqual(2);
    expect(canEdge).toMatchObject({
      signalId: 'imu.pitch_rate',
      channelId: 'CAN-FC-IMU',
      messageId: '0x184',
      payloadKind: 'float32',
      signalUnit: 'rad/s',
      faultPropagationPolicy: 'propagates'
    });
    expect(canEdge.signalChannels).toEqual([
      expect.objectContaining({
        signalId: 'imu.pitch_rate',
        channelId: 'CAN-FC-IMU',
        messageId: '0x184'
      })
    ]);
  });

  it('declares injectable slots directly on every closed-loop demo edge', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const edges = closedLoopPackage.workbenchSnapshot.modelEdges;
    const normalEdge = edges.find((edge) => edge.id === 'edge-command-shaper');
    const canEdge = edges.find((edge) => edge.id === 'edge-imu-error');

    expect(edges.length).toBeGreaterThan(0);
    edges.forEach((edge) => {
      expect(edge.faultSlots, edge.id).toEqual(expect.arrayContaining([
        expect.objectContaining({
          slotId: expect.any(String),
          layer: 'electrical',
          targetField: 'signal.value',
          allowedModels: expect.arrayContaining(['bias', 'noise', 'freeze', 'intermittent'])
        })
      ]));
    });

    expect(normalEdge.faultSlots.map((slot) => slot.layer)).toEqual(['electrical']);
    expect(canEdge.faultSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'protocol:can_message',
        layer: 'protocol',
        targetField: 'can.payload',
        allowedModels: expect.arrayContaining(['delay', 'dropout', 'tamper', 'stale'])
      })
    ]));
  });

  it('keeps core component parameter fault slots in the closed-loop demo package', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const nodes = closedLoopPackage.workbenchSnapshot.modelNodes;
    const imu = nodes.find((node) => node.id === 'node-imu');
    const motor = nodes.find((node) => node.id === 'node-motor-1');
    const allocator = nodes.find((node) => node.id === 'node-allocator');

    expect(imu.faultSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'physical:imu_zero_bias',
        layer: 'physical',
        targetField: 'params.gyro.bias',
        allowedModels: expect.arrayContaining(['bias', 'drift', 'random'])
      })
    ]));
    expect(motor.faultSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'physical:motor_thrust_coefficient',
        layer: 'physical',
        targetField: 'params.thrustCoefficient',
        allowedModels: expect.arrayContaining(['bias', 'drift', 'degradation'])
      })
    ]));
    expect(allocator.faultSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'physical:allocation_matrix',
        layer: 'physical',
        targetField: 'params.allocationMatrix',
        allowedModels: expect.arrayContaining(['step'])
      })
    ]));
  });

  it('declares component-owned injectable variables in the closed-loop demo package', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const nodes = closedLoopPackage.workbenchSnapshot.modelNodes
      .filter((node) => node.type === 'simulation_block');

    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((node) => {
      expect(node.props?.faultInjection, node.id).toEqual(expect.objectContaining({
        physical: expect.any(Array),
        electrical: expect.any(Array),
        protocol: expect.any(Array)
      }));

      const declared = new Set(
        Object.entries(node.props.faultInjection)
          .flatMap(([layer, keys]) => keys.map((key) => `${layer}:${String(key).replace(/\s+/g, '_')}`))
      );
      expect(node.faultSlots.map((slot) => slot.slotId), node.id).toEqual(
        expect.arrayContaining([...declared])
      );
      node.faultSlots.forEach((slot) => {
        expect(declared.has(slot.slotId), `${node.id}:${slot.slotId}`).toBe(true);
      });
    });

    const imu = nodes.find((node) => node.id === 'node-imu');
    const motorMixer = nodes.find((node) => node.id === 'node-motor');
    expect(imu.props.faultInjection).toEqual(expect.objectContaining({
      physical: expect.arrayContaining(['imu_zero_bias', 'imu_scale_factor', 'imu_noise_std']),
      electrical: expect.arrayContaining(['机体角速度', '测量角速度', '陀螺仪零偏状态']),
      protocol: expect.arrayContaining(['imu_feedback_payload'])
    }));
    expect(motorMixer.props.faultInjection.protocol).toEqual(expect.arrayContaining(['motor_command_payload']));
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
    expect(byId.random.defaultParameters).toMatchObject({ seed: 1, std: 0.08 });
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
    expect(normalEdge.faultSlots.map((slot) => slot.layer)).toEqual(['electrical']);
    expect(canEdge.faultSlots.map((slot) => slot.layer)).toEqual(['electrical', 'protocol']);
  });

  it('defines component-owned fault capabilities for the closed-loop demo', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const nodes = new Set(closedLoopPackage.workbenchSnapshot.modelNodes.map((node) => node.id));
    const edges = new Set(closedLoopPackage.workbenchSnapshot.modelEdges.map((edge) => edge.id));
    const faultIds = new Set(closedLoopPackage.faultTypeCatalog.map((fault) => fault.id));

    expect(closedLoopPackage.schemaVersion).toBe('2.0');
    expect(closedLoopPackage.faultInstances).toEqual([]);
    expect(closedLoopPackage.faultTypeCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gyro_zero_bias_offset', displayName: 'Gyro 陀螺仪零偏 - 固定偏差' }),
      expect.objectContaining({ id: 'gyro_zero_bias_drift', displayName: 'Gyro 陀螺仪零偏 - 缓慢漂移' }),
      expect.objectContaining({ id: 'gyro_zero_bias_intermittent', displayName: 'Gyro 陀螺仪零偏 - 间歇故障' }),
      expect.objectContaining({ id: 'motor_1_stuck_position', displayName: '单电机卡死 - 1号电机卡位' }),
      expect.objectContaining({ id: 'control_command_tamper', displayName: '控制指令篡改 - 1号电机 CAN 指令' })
    ]));

    closedLoopPackage.faultCapabilityMap.forEach((entry) => {
      expect(['node', 'edge']).toContain(entry.targetKind);
      expect(entry.targetKind === 'node' ? nodes.has(entry.targetId) : edges.has(entry.targetId)).toBe(true);
      expect(entry.targetName).toBeTruthy();
      expect(entry.faultSlots.length).toBeGreaterThan(0);
      entry.faultSlots.forEach((slot) => {
        expect(slot.slotId).toBeTruthy();
        expect(slot.slotName).toBeTruthy();
        expect(slot.allowedFaultIds.length).toBeGreaterThan(0);
        slot.allowedFaultIds.forEach((faultId) => expect(faultIds.has(faultId)).toBe(true));
      });
    });

    const imu = closedLoopPackage.faultCapabilityMap.find((entry) => entry.targetId === 'node-imu');
    expect(imu.faultSlots[0].allowedFaultIds).toEqual([
      'gyro_zero_bias_offset',
      'gyro_zero_bias_drift',
      'gyro_zero_bias_intermittent'
    ]);

    const motor = closedLoopPackage.faultCapabilityMap.find((entry) => entry.targetId === 'node-motor-1');
    expect(motor.faultSlots[0].allowedFaultIds).toEqual(['motor_1_stuck_position']);

    const can = closedLoopPackage.faultCapabilityMap.find((entry) => entry.targetId === 'edge-motor-motor1');
    expect(can.faultSlots[0].allowedFaultIds).toEqual(['control_command_tamper']);
  });

  it('publishes the full global fault catalog through the closed-loop demo package', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const globalFaultIds = globalFaultCatalog.faultTypes.map((fault) => fault.id);
    const packageFaultIds = closedLoopPackage.faultTypeCatalog.map((fault) => fault.id);
    const text = closedLoopPackage.faultTypeCatalog
      .map((fault) => `${fault.id} ${fault.name ?? ''} ${fault.displayName ?? ''} ${fault.modelClass ?? ''}`)
      .join('\n');

    expect(packageFaultIds).toEqual(expect.arrayContaining(globalFaultIds));
    expect(closedLoopPackage.faultLibrary.map((fault) => fault.id)).toEqual(expect.arrayContaining(globalFaultIds));
    expect(closedLoopPackage.faultTypeCatalog.length).toBeGreaterThanOrEqual(20);

    ['偏差', '卡位', '渐变', '突变'].forEach((label) => {
      expect(text, label).toContain(label);
    });
    ['状态突变', '信号阻塞', '间歇'].forEach((label) => {
      expect(text, label).toContain(label);
    });
    ['高斯', '白噪声', '有色噪声'].forEach((label) => {
      expect(text, label).toContain(label);
    });
  });

  it('embeds backend python modules in the closed-loop demo package', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const validation = validateFlightModelPackage(closedLoopPackage);
    const applied = applyFlightModelPackage(closedLoopPackage);

    expect(validation).toEqual({ ok: true, errors: [] });
    expect(closedLoopPackage.pythonModules.length).toBeGreaterThanOrEqual(1);
    closedLoopPackage.pythonModules.forEach((module) => {
      expect(module).toMatchObject({
        moduleId: expect.any(String),
        fileName: expect.stringMatching(/\.py$/),
        entryFunction: 'process',
        source: expect.stringContaining('def process')
      });
      expect(module.parsedInterface).toMatchObject({
        entryFunction: 'process',
        inputs: expect.any(Array),
        outputs: expect.any(Array)
      });
    });

    const backendBlocks = applied.snapshot.modelNodes.filter((node) => (
      node.type === 'simulation_block'
      && node.pythonBinding?.bound
      && node.pythonBinding.executionMode === 'backend'
      && node.pythonBinding.rawSource
    ));
    expect(backendBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it('defines the closed-loop demo diagnostic contract with Chinese labels and red-box faults', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const diagnosticModel = closedLoopPackage.diagnosticModel;
    const nodes = closedLoopPackage.workbenchSnapshot.modelNodes;
    const faults = closedLoopPackage.faultLibrary;
    const points = diagnosticModel?.testPoints ?? [];
    const cases = diagnosticModel?.faultCases ?? [];
    const caseIds = cases.map((faultCase) => faultCase.id);

    expect(closedLoopPackage.modelName).toContain('飞控');
    expect(nodes.map((node) => node.props?.name)).toEqual(expect.arrayContaining([
      '姿态指令',
      '姿态控制器',
      '控制分配',
      '1号电机与旋翼',
      'IMU 陀螺仪反馈',
      '故障前后对比示波器'
    ]));
    const compareScope = nodes.find((node) => node.id === 'node-scope');
    expect(compareScope).toMatchObject({
      type: 'instrument_scope',
      x: expect.any(Number),
      y: expect.any(Number),
      props: expect.objectContaining({
        name: '故障前后对比示波器',
        displayRole: 'fault-comparison'
      })
    });
    expect(compareScope.x).toBeGreaterThanOrEqual(650);
    expect(compareScope.x).toBeLessThanOrEqual(920);
    expect(compareScope.y).toBeGreaterThanOrEqual(300);
    expect(compareScope.y).toBeLessThanOrEqual(420);
    expect(closedLoopPackage.workbenchSnapshot.modelEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edge-command-scope', targetNodeId: 'node-scope', targetPortIndex: 0 }),
      expect.objectContaining({ id: 'edge-imu-scope', targetNodeId: 'node-scope', targetPortIndex: 1 })
    ]));
    expect(diagnosticModel).toMatchObject({
      modelId: 'evtol-closed-loop-fault-demo',
      locale: 'zh-CN'
    });
    expect(points).toHaveLength(12);
    expect(points.map((point) => point.shortName)).toEqual([
      'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'
    ]);
    expect(caseIds).toEqual(expect.arrayContaining([
      'gyro_zero_bias_offset',
      'gyro_zero_bias_drift',
      'gyro_zero_bias_intermittent',
      'motor_1_stuck_position',
      'control_command_tamper'
    ]));
    const visualImplementations = Object.fromEntries(faults.map((fault) => [
      fault.id,
      {
        recommendedModule: fault.platformImplementation?.recommendedModule,
        strategy: fault.visualInjection?.strategy,
        tagType: fault.visualInjection?.tagType
      }
    ]));
    expect(visualImplementations).toMatchObject({
      gyro_zero_bias_offset: { recommendedModule: 'fault_tag', strategy: 'fault_tag', tagType: 'fault_tag' },
      gyro_zero_bias_drift: { recommendedModule: 'fault_tag', strategy: 'fault_tag', tagType: 'fault_tag' },
      gyro_zero_bias_intermittent: { recommendedModule: 'fault_tag', strategy: 'fault_tag', tagType: 'fault_tag' },
      motor_1_stuck_position: { recommendedModule: 'fault_tag', strategy: 'fault_tag', tagType: 'fault_tag' },
      control_command_tamper: { recommendedModule: 'fault_tag', strategy: 'fault_tag', tagType: 'fault_tag' }
    });
    caseIds.forEach((faultId) => {
      const fault = faults.find((item) => item.id === faultId);
      expect(fault.platformImplementation.moduleLabel).toBe('故障组件');
      expect(fault.platformImplementation.moduleLabel).not.toContain('?');
    });
    const redBoxVisualImplementations = Object.fromEntries(
      Object.entries(visualImplementations).filter(([faultId]) => caseIds.includes(faultId))
    );
    expect(JSON.stringify(redBoxVisualImplementations)).not.toMatch(/fault_bias|fault_noise|middle_var_assign|gain_block|sum_block|fault_intermittent|fault_tamper|fault_stuck/);
    cases.forEach((faultCase) => {
      expect(faults.some((fault) => fault.id === faultCase.id)).toBe(true);
      expect(points.some((point) => point.detects.includes(faultCase.id))).toBe(true);
      expect(faultCase.name).toMatch(/[一-龥]/);
      expect(faultCase.catalogTypeId).toBeTruthy();
    });

    const motorCommandPoint = points.find((point) => point.shortName === 'M6');
    const motorResponsePoint = points.find((point) => point.shortName === 'M7');
    expect(motorCommandPoint?.detects).toContain('control_command_tamper');
    expect(motorCommandPoint?.detects).not.toContain('motor_1_stuck_position');
    expect(motorResponsePoint?.detects).toContain('motor_1_stuck_position');
  });

  it('maps every closed-loop demo fault-library entry to a compatible runtime target', () => {
    const closedLoopPackage = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const nodes = closedLoopPackage.workbenchSnapshot.modelNodes;
    const edges = closedLoopPackage.workbenchSnapshot.modelEdges;
    const targetsByFaultId = Object.fromEntries(
      closedLoopPackage.faultLibrary.map((faultModel) => [
        faultModel.id,
        findCompatibleFaultTarget(faultModel, { nodes, edges })
      ])
    );

    expect(targetsByFaultId).toMatchObject({
      gyro_zero_bias_offset: { kind: 'node', id: 'node-imu' },
      gyro_zero_bias_drift: { kind: 'node', id: 'node-imu' },
      gyro_zero_bias_intermittent: { kind: 'node', id: 'node-imu' },
      motor_1_stuck_position: { kind: 'node', id: 'node-motor-1' },
      control_command_tamper: { kind: 'edge', id: 'edge-shaper-error' },
      motor_efficiency_loss: { kind: 'node', id: 'node-motor' },
      airframe_inertia_shift: { kind: 'node', id: 'node-dynamics' },
      can_bus_delay: { kind: 'edge', id: 'edge-imu-error' }
    });
    Object.entries(targetsByFaultId).forEach(([faultId, target]) => {
      expect(target, faultId).toBeTruthy();
    });
  });
});
