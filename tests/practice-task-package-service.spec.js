import { describe, expect, it } from 'vitest';
import { buildPracticeTaskPackage } from '../src/services/practiceTaskPackageService.js';

describe('practiceTaskPackageService', () => {
  it('separates client-visible task data from backend-private task data', () => {
    const executableModel = {
      schemaVersion: 1,
      packageId: 'pkg-1',
      simulationConfig: { duration: 10, stepSize: 0.1 },
      nodes: [{ id: 'imu-1', type: 'simulation_block' }],
      edges: [],
      faultInstances: [{ faultId: 'fault-1', targetId: 'imu-1', enabled: true }],
      measurementPoints: [{ id: 'scope-1.ch1', scopeNodeId: 'scope-1', channel: 'ch1' }]
    };
    const initialRecommendedPath = {
      faultId: 'fault-1',
      steps: [
        { actionType: 'measurePoint', pointCode: 'M1', pointId: 'scope-1.ch1' },
        { actionType: 'replaceComponent', target: { type: 'component', id: 'imu-1' } }
      ]
    };

    const result = buildPracticeTaskPackage({
      exportedAt: '2026-07-16T08:00:00.000Z',
      taskId: 'practice-1',
      meta: {
        datasetName: 'test',
        duration: 10,
        stepSize: 0.1,
        status: 'completed',
        modelId: 'model-1',
        modelName: 'Model 1'
      },
      model: {
        nodes: [{ id: 'imu-1', type: 'simulation_block', x: 54, y: 636, w: 164, h: 84 }],
        edges: [{
          id: 'wire-1',
          sourceNodeId: 'imu-1',
          targetNodeId: 'scope-1',
          lineType: 'can',
          label: 'IMU 反馈',
          signalId: 'imu.pitch_rate',
          signalUnit: 'rad/s',
          channelId: 'CAN-FC-IMU',
          messageId: '0x184',
          payloadKind: 'float32',
          faultPropagationPolicy: 'propagates',
          signalChannels: [{ signalId: 'imu.pitch_rate' }],
          faultSlots: [{
            slotId: 'protocol:imu-feedback',
            lineType: 'can',
            channelId: 'CAN-FC-IMU',
            messageId: '0x184',
            allowedModels: ['delay', 'dropout'],
            allowedFaultIds: ['fixed_delay'],
            allowedFaultTypeIds: ['can_delay']
          }]
        }]
      },
      componentOutputs: { time: [0], steps: [] },
      dMatrix: {
        diagnosticContext: { values: { input_mode: 'mode_2' }, summary: '输入选择模式：模式 2' },
        points: [{ shortName: 'M1' }],
        rows: [{ faultId: 'fault-1', cells: [{ pointCode: 'M1', detectable: true, value: 1 }] }]
      },
      practiceFaults: [{ faultId: 'fault-1', troubleshootingPath: initialRecommendedPath }],
      renderData: {
        devices: [{ id: 'scope-1', displayName: '示波器', type: 'instrument_scope', channels: {} }],
        connections: [{ id: 'wire-1', sourceDeviceId: 'imu-1', targetDeviceId: 'scope-1' }]
      },
      summary: { nodeCount: 1, edgeCount: 1, faultCount: 1 },
      executableModel
    });

    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: '3d-practice-task-package',
      exportedAt: '2026-07-16T08:00:00.000Z',
      taskId: 'practice-1',
      meta: {
        duration: 10,
        stepSize: 0.1
      }
    });
    expect(result.publicData.initialSimulationResult.simulationConfig).toEqual({
      duration: 10,
      stepSize: 0.1
    });
    expect(result.publicData).not.toHaveProperty('modelTopology');
    expect(result.publicData.renderData).toEqual({
      devices: [],
      connections: []
    });
    expect(result.publicData).not.toHaveProperty('sceneMappings');
    expect(result.publicData).not.toHaveProperty('measurementPoints');
    expect(result.publicData.initialSimulationResult).not.toHaveProperty('samples');
    expect(result.publicData.initialSimulationResult).not.toHaveProperty('renderData');
    expect(result.publicData.initialSimulationResult).not.toHaveProperty('componentOutputs');
    expect(result.publicData).not.toHaveProperty('allowedActions');
    expect(JSON.stringify(result.publicData)).not.toContain('referenceScopeSamples');

    expect(result.privateData.executableModel).toEqual(executableModel);
    expect(result.privateData).not.toHaveProperty('rerunConfig');
    expect(result.privateData.targetFaultId).toBe('fault-1');
    expect(result.privateData.initialRecommendedPath).toEqual(initialRecommendedPath);
    expect(result.privateData.dMatrix).toMatchObject({
      diagnosticContext: { values: { input_mode: 'mode_2' } },
      rows: [{ cells: [{ detectable: true, value: 1 }] }]
    });
    expect(result.privateData).not.toHaveProperty('keyNodes');
    expect(result.privateData).not.toHaveProperty('actionRules');
    expect(result.privateData).not.toHaveProperty('scoringRules');
    expect(result.privateData).not.toHaveProperty('referenceCurves');
  });

  it('persists simulation duration and step size from the executable model when metadata omits them', () => {
    const result = buildPracticeTaskPackage({
      meta: { datasetName: 'run-with-model-config' },
      executableModel: {
        simulationConfig: { duration: 2.5, stepSize: 0.005 },
        nodes: [],
        edges: [],
        faultInstances: [],
        measurementPoints: []
      }
    });

    expect(result.meta).toMatchObject({
      duration: 2.5,
      stepSize: 0.005
    });
    expect(result.publicData.initialSimulationResult.simulationConfig).toEqual({
      duration: 2.5,
      stepSize: 0.005
    });
    expect(result.privateData).not.toHaveProperty('rerunConfig');
  });

  it('merges public connections with identical endpoints and keeps the earliest label', () => {
    const executableModel = {
      simulationConfig: {},
      nodes: [],
      edges: [
        { id: 'wire-first' },
        { id: 'wire-duplicate' },
        { id: 'wire-other-port' }
      ],
      faultInstances: [],
      measurementPoints: []
    };
    const result = buildPracticeTaskPackage({
      executableModel,
      renderData: {
        devices: [
          { id: 'source-1', type: 'simulation_block' },
          { id: 'target-1', type: 'simulation_block' }
        ],
        connections: [
          {
            id: 'wire-first',
            sourceDeviceId: 'source-1',
            sourcePort: 'output',
            targetDeviceId: 'target-1',
            targetPort: 'input',
            label: '最早出现的连线'
          },
          {
            id: 'wire-duplicate',
            sourceDeviceId: 'source-1',
            sourcePort: 'output',
            targetDeviceId: 'target-1',
            targetPort: 'input',
            label: '后出现的重复连线'
          },
          {
            id: 'wire-other-port',
            sourceDeviceId: 'source-1',
            sourcePort: 'output',
            targetDeviceId: 'target-1',
            targetPort: 'input-2',
            label: '不同目标端口'
          }
        ]
      }
    });

    expect(result.publicData.renderData.connections).toEqual([
      expect.objectContaining({ id: 'wire-first', label: '最早出现的连线' }),
      expect.objectContaining({ id: 'wire-other-port', label: '不同目标端口' })
    ]);
    expect(result.privateData.executableModel.edges).toHaveLength(3);
  });

  it('keeps only non-instrument devices and connections in public render data', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [
          {
            pointId: 'tp-physical',
            shortName: 'P1',
            name: 'Physical point',
            pointType: 'physical',
            edgeId: 'controller-wire',
            // Legacy records can carry the canvas ID here. The exported
            // result must still refer to the edge's source component.
            sourceNodeId: 'canvas-controller',
            sourcePort: '控制输出',
            observationRule: { normalThreshold: 0.1, abnormalThreshold: 0.2 }
          },
          {
            pointId: 'tp-virtual',
            shortName: 'V1',
            name: 'Virtual point',
            pointType: 'virtual',
            edgeId: 'controller-wire',
            sourcePort: '控制输出',
            observationRule: { normalThreshold: 0.1, abnormalThreshold: 0.2 }
          }
        ]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [],
        edges: [{ id: 'controller-wire', sourceNodeId: 'controller-1', sourcePortIndex: 0 }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0, 0.1],
        steps: [
          { time: 0, actual: { 'controller-1': { output: 1 } }, reference: { 'controller-1': { output: 0 } } },
          { time: 0.1, actual: { 'controller-1': { output: 2 } }, reference: { 'controller-1': { output: 1 } } }
        ]
      },
      renderData: {
        devices: [
          { id: 'controller-1', type: 'simulation_block' },
          { id: 'scope-1', type: 'instrument_scope' },
          { id: 'meter-1', type: 'instrument_multimeter' }
        ],
        connections: [
          { id: 'controller-wire', sourceDeviceId: 'controller-1', targetDeviceId: 'controller-1', sourcePort: 'socket04' },
          { id: 'scope-wire', sourceDeviceId: 'controller-1', targetDeviceId: 'scope-1' }
        ]
      }
    });

    expect(result.publicData.renderData).toEqual({
      devices: [{
        id: 'controller-1',
        type: 'simulation_block',
        measurementPorts: {
          inputs: [],
          outputs: [{ portId: 'socket04', elementNames: ['元素 1'] }]
        }
      }],
      connections: [{ id: 'controller-wire', sourceDeviceId: 'controller-1', targetDeviceId: 'controller-1', sourcePort: 'socket04' }]
    });
    expect(result.publicData.initialSimulationResult).not.toHaveProperty('componentOutputs');
    expect(result.publicData.initialSimulationResult).not.toHaveProperty('physicalMeasurementSnapshot');
    expect(result.publicData.initialSimulationResult.physicalMeasurements).toMatchObject([{
        pointCode: 'P1',
        pointId: 'tp-physical',
        pointName: 'Physical point',
        channel: 'controller-wire',
        sourceDeviceId: 'controller-1',
        sourcePort: 'socket04',
        sourceElementName: '元素 1',
        targetElementName: '元素 1',
        samples: [
          { time: 0, actual: 1 },
          { time: 0.1, actual: 2 }
        ]
    }]);
    expect(result.publicData.initialSimulationResult.virtualMeasurements).toMatchObject([{
      pointCode: 'V1',
      pointId: 'tp-virtual',
      pointName: 'Virtual point',
      channel: 'controller-wire',
      sourceDeviceId: 'controller-1',
      sourcePort: 'socket04',
      sourceElementName: '元素 1',
      targetElementName: '元素 1',
      samples: [
        { time: 0, actual: 1 },
        { time: 0.1, actual: 2 }
      ]
    }]);
    [
      result.publicData.initialSimulationResult.physicalMeasurements[0],
      result.publicData.initialSimulationResult.virtualMeasurements[0]
    ].forEach((point) => {
      expect(point).not.toHaveProperty('pointType');
      expect(point).not.toHaveProperty('method');
      expect(point).not.toHaveProperty('normalThreshold');
      expect(point).not.toHaveProperty('abnormalThreshold');
      expect(point).not.toHaveProperty('actualValue');
      expect(point).not.toHaveProperty('referenceValue');
      expect(point).not.toHaveProperty('metricValue');
      expect(point).not.toHaveProperty('observed');
      point.samples.forEach((sample) => expect(sample).not.toHaveProperty('reference'));
    });
  });

  it('compacts unchanged physical and virtual measurement sample intervals', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [
          { pointId: 'tp-physical-compact', shortName: 'P1', pointType: 'physical', edgeId: 'edge-compact' },
          { pointId: 'tp-virtual-compact', shortName: 'V1', pointType: 'virtual', edgeId: 'edge-compact' }
        ]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [{ id: 'source-compact', outputs: [{ id: 'output', name: 'output' }] }],
        edges: [{ id: 'edge-compact', sourceNodeId: 'source-compact', sourcePortIndex: 0 }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0, 1, 2, 3, 4, 5],
        steps: [10, 10, 10, 20, 20, 20].map((actual, time) => ({
          time,
          actual: { 'source-compact': { output: actual } }
        }))
      },
      renderData: {
        devices: [{ id: 'source-compact', type: 'simulation_block' }],
        connections: [{ id: 'edge-compact', sourceDeviceId: 'source-compact', targetDeviceId: 'source-compact', sourcePort: 'output' }]
      }
    });

    const expectedSamples = [
      { time: 0, actual: 10, constantRangeBoundary: 'start' },
      { time: 2, actual: 10, constantRangeBoundary: 'end' },
      { time: 3, actual: 20, constantRangeBoundary: 'start' },
      { time: 5, actual: 20, constantRangeBoundary: 'end' }
    ];
    expect(result.publicData.initialSimulationResult.physicalMeasurements[0].samples).toEqual(expectedSamples);
    expect(result.publicData.initialSimulationResult.virtualMeasurements[0].samples).toEqual(expectedSamples);
  });

  it('exports and compacts complex-envelope measurement samples by I, Q, and reference frequency', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{ pointId: 'tp-envelope', shortName: 'E1', pointType: 'physical', edgeId: 'edge-envelope' }]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [{
          id: 'envelope-source',
          outputs: [{ id: 'output_envelope', varName: 'output_envelope', dataType: 'rf_complex_envelope' }]
        }],
        edges: [{ id: 'edge-envelope', sourceNodeId: 'envelope-source', sourcePortIndex: 0 }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0, 1, 2, 3, 4, 5],
        steps: [
          { i: 1, q: 0, referenceFrequencyHz: 10e9 },
          { i: 1, q: 0, referenceFrequencyHz: 10e9 },
          { i: 1, q: 0, referenceFrequencyHz: 10e9 },
          { i: 1, q: 0.5, referenceFrequencyHz: 10e9 },
          { i: 1, q: 0.5, referenceFrequencyHz: 11e9 },
          { i: 1, q: 0.5, referenceFrequencyHz: 11e9 }
        ].map((value, time) => ({
          time,
          actual: {
            'envelope-source': {
              output_envelope: { ...value, impedanceOhm: 50, unit: 'V' }
            }
          }
        }))
      },
      renderData: {
        devices: [{ id: 'envelope-source', type: 'simulation_block' }],
        connections: [{ id: 'edge-envelope', sourceDeviceId: 'envelope-source', targetDeviceId: 'envelope-source', sourcePort: 'output_envelope' }]
      }
    });

    expect(result.publicData.initialSimulationResult.physicalMeasurements[0].samples).toEqual([
      { time: 0, actual: { i: 1, q: 0, referenceFrequencyHz: 10e9 }, constantRangeBoundary: 'start' },
      { time: 2, actual: { i: 1, q: 0, referenceFrequencyHz: 10e9 }, constantRangeBoundary: 'end' },
      { time: 3, actual: { i: 1, q: 0.5, referenceFrequencyHz: 10e9 }, constantRangeBoundary: 'single' },
      { time: 4, actual: { i: 1, q: 0.5, referenceFrequencyHz: 11e9 }, constantRangeBoundary: 'start' },
      { time: 5, actual: { i: 1, q: 0.5, referenceFrequencyHz: 11e9 }, constantRangeBoundary: 'end' }
    ]);
  });

  it('exports the receiving component and input port for each measurement point', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{
          pointId: 'tp-controller-input',
          shortName: 'M1',
          name: 'Controller input',
          pointType: 'physical',
          edgeId: 'edge-imu-controller'
        }]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [
          { id: 'imu-gyro', outputs: [{ id: 'gyro-rate', varName: 'gyro_rate' }] },
          { id: 'attitude-controller', inputs: [{ id: 'rate-error', varName: 'rate_error' }] }
        ],
        edges: [{
          id: 'edge-imu-controller',
          sourceNodeId: 'imu-gyro',
          sourcePortIndex: 0,
          targetNodeId: 'attitude-controller',
          targetPortIndex: 0
        }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'imu-gyro': { gyro_rate: 1 } } }]
      },
      renderData: {
        devices: [
          { id: 'imu-gyro', type: 'simulation_block' },
          { id: 'attitude-controller', type: 'simulation_block' }
        ],
        connections: [{
          id: 'edge-imu-controller',
          sourceDeviceId: 'imu-gyro',
          sourcePort: 'gyro-rate',
          targetDeviceId: 'attitude-controller',
          targetPort: 'rate-error'
        }]
      }
    });

    expect(result.publicData.initialSimulationResult.physicalMeasurements).toMatchObject([{
      sourceDeviceId: 'imu-gyro',
      sourcePort: 'gyro-rate',
      targetDeviceId: 'attitude-controller',
      targetPort: 'rate-error'
    }]);
  });

  it('exports display-console parameter control permissions for the practice backend', () => {
    const result = buildPracticeTaskPackage({
      renderData: {
        devices: [{
          id: 'console-1',
          displayName: '显控台 1',
          type: 'display_console',
          controlState: {
            targetComponentId: 'source-1',
            componentType: 'rf_four_output_source',
            parameters: [
              { key: 'center_frequency_hz', value: 100000000 },
              { key: 'pulse_width_seconds', value: 0.000001 }
            ]
          }
        }],
        connections: []
      }
    });

    expect(result.privateData.displayConsoleControls).toEqual([{
      displayConsoleId: 'console-1',
      displayConsoleName: '显控台 1',
      targetComponentId: 'source-1',
      componentType: 'rf_four_output_source',
      parameterKeys: ['center_frequency_hz', 'pulse_width_seconds']
    }]);
  });

  it('binds a vector measurement point to its selected named element', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{
          pointId: 'tp-vector',
          shortName: 'P-VECTOR',
          name: 'Three-phase output',
          pointType: 'physical',
          edgeId: 'vector-wire',
          vectorIndex: 1
        }]
      },
      executableModel: {
        simulationConfig: { duration: 0.1, stepSize: 0.1 },
        nodes: [{
          id: 'source-1',
          outputs: [{
            id: 'phase-output',
            varName: 'phase_output',
            dataType: 'vector',
            vectorLength: 3,
            vectorElementNames: ['横滚', '俯仰', '偏航']
          }]
        }],
        edges: [{
          id: 'vector-wire',
          sourceNodeId: 'source-1',
          sourcePortIndex: 0,
          sourcePortMeta: { varName: 'phase_output' }
        }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0, 0.1],
        steps: [
          {
            time: 0,
            actual: { 'source-1': { phase_output: [220, 221, 222] } },
            reference: { 'source-1': { phase_output: [220, 220, 220] } }
          },
          {
            time: 0.1,
            actual: { 'source-1': { phase_output: [223, null, 225] } },
            reference: { 'source-1': { phase_output: [220, 220, 220] } }
          }
        ]
      },
      renderData: {
        devices: [{ id: 'source-1', type: 'simulation_block' }],
        connections: [{
          id: 'vector-wire',
          sourceDeviceId: 'source-1',
          targetDeviceId: 'source-1',
          sourcePort: 'phase-output'
        }]
      }
    });

    expect(result.publicData.initialSimulationResult.physicalMeasurements).toEqual([{
      pointCode: 'P-VECTOR',
      pointId: 'tp-vector',
      pointName: 'Three-phase output',
      channel: 'vector-wire',
      sourceDeviceId: 'source-1',
      sourcePort: 'phase-output',
      sourceVectorElementName: '俯仰',
      targetVectorElementName: '俯仰',
      pointName: 'Three-phase output · 俯仰',
      samples: [
        { time: 0, actual: 221 },
        { time: 0.1, actual: null }
      ]
    }]);
  });

  it('prefers configured port element names over generated route labels', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{
          pointId: 'tp-vector-fallback',
          shortName: 'P-VECTOR-FALLBACK',
          name: 'Attitude output',
          pointType: 'virtual',
          edgeId: 'vector-wire-fallback',
          vectorIndex: 1,
          vectorElementName: '第 2 路'
        }]
      },
      executableModel: {
        simulationConfig: { duration: 0, stepSize: 0.1 },
        nodes: [
          {
            id: 'source-fallback',
            outputs: [{
              id: 'attitude-output',
              dataType: 'vector',
              vectorLength: 3,
              vectorElementNames: [],
              meta: { vectorElementNames: ['横滚', '俯仰', '偏航'] }
            }]
          },
          {
            id: 'target-fallback',
            inputs: [{
              id: 'attitude-input',
              dataType: 'vector',
              vectorLength: 3,
              vectorElementNames: ['横滚输入', '俯仰输入', '偏航输入']
            }]
          }
        ],
        edges: [{
          id: 'vector-wire-fallback',
          sourceNodeId: 'source-fallback',
          sourcePortIndex: 0,
          targetNodeId: 'target-fallback',
          targetPortIndex: 0,
          sourcePortMeta: { vectorLength: 3, vectorElementNames: [] }
        }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'source-fallback': { 'attitude-output': [1, 2, 3] } } }]
      },
      renderData: { devices: [], connections: [] }
    });

    expect(result.publicData.initialSimulationResult.virtualMeasurements[0]).toMatchObject({
      sourceVectorElementName: '俯仰',
      targetVectorElementName: '俯仰输入',
      pointName: 'Attitude output · 俯仰',
      samples: [{ time: 0, actual: 2 }]
    });
  });

  it('groups measured input and output port elements by public component and port id', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [
          {
            pointId: 'tp-attitude-roll',
            pointType: 'physical',
            edgeId: 'edge-attitude',
            vectorIndex: 0
          },
          {
            pointId: 'tp-attitude-yaw',
            pointType: 'virtual',
            edgeId: 'edge-attitude',
            vectorIndex: 2
          },
          {
            pointId: 'tp-attitude-roll-duplicate',
            pointType: 'virtual',
            edgeId: 'edge-attitude',
            vectorIndex: 0
          }
        ]
      },
      executableModel: {
        simulationConfig: { duration: 0, stepSize: 0.1 },
        nodes: [
          {
            id: 'attitude-source',
            outputs: [{
              id: 'attitude-output',
              varName: 'attitude',
              vectorLength: 3,
              vectorElementNames: ['横滚', '俯仰', '偏航']
            }]
          },
          {
            id: 'attitude-target',
            inputs: [{
              id: 'attitude-input',
              vectorLength: 3,
              vectorElementNames: ['横滚输入', '俯仰输入', '偏航输入']
            }]
          }
        ],
        edges: [{
          id: 'edge-attitude',
          sourceNodeId: 'attitude-source',
          sourcePortIndex: 0,
          targetNodeId: 'attitude-target',
          targetPortIndex: 0
        }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'attitude-source': { attitude: [1, 2, 3] } } }]
      },
      renderData: {
        devices: [
          { id: 'attitude-source', type: 'simulation_block' },
          { id: 'attitude-target', type: 'simulation_block' }
        ],
        connections: [{
          id: 'edge-attitude',
          sourceDeviceId: 'attitude-source',
          sourcePort: 'attitude-output',
          targetDeviceId: 'attitude-target',
          targetPort: 'attitude-input'
        }]
      }
    });

    expect(result.publicData.renderData.devices).toEqual([
      {
        id: 'attitude-source',
        type: 'simulation_block',
        measurementPorts: {
          inputs: [],
          outputs: [{ portId: 'attitude-output', elementNames: ['横滚', '偏航'] }]
        }
      },
      {
        id: 'attitude-target',
        type: 'simulation_block',
        measurementPorts: {
          inputs: [{ portId: 'attitude-input', elementNames: ['横滚输入', '偏航输入'] }],
          outputs: []
        }
      }
    ]);
  });

  it('saves configured scalar element names and merges duplicate scalar port declarations', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [
          {
            pointId: 'tp-voltage-value',
            pointType: 'physical',
            edgeId: 'edge-voltage'
          },
          {
            pointId: 'tp-voltage-rms',
            pointType: 'virtual',
            edgeId: 'edge-voltage-rms'
          }
        ]
      },
      executableModel: {
        simulationConfig: { duration: 0, stepSize: 0.1 },
        nodes: [
          {
            id: 'voltage-source',
            outputs: [
              { id: 'voltage-out', varName: 'voltage', elementNames: ['输出电压'] },
              { id: 'voltage-out', varName: 'voltage_rms', elementNames: ['电压有效值'] }
            ]
          },
          {
            id: 'voltage-target',
            inputs: [
              { id: 'voltage-in', varName: 'voltage', elementNames: ['输入电压'] },
              { id: 'voltage-in', varName: 'voltage_rms', elementNames: ['输入有效值'] }
            ]
          }
        ],
        edges: [
          {
            id: 'edge-voltage',
            sourceNodeId: 'voltage-source',
            sourcePortIndex: 0,
            targetNodeId: 'voltage-target',
            targetPortIndex: 0
          },
          {
            id: 'edge-voltage-rms',
            sourceNodeId: 'voltage-source',
            sourcePortIndex: 1,
            targetNodeId: 'voltage-target',
            targetPortIndex: 1
          }
        ],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'voltage-source': { voltage: 28, voltage_rms: 27.5 } } }]
      },
      renderData: {
        devices: [
          { id: 'voltage-source', type: 'simulation_block' },
          { id: 'voltage-target', type: 'simulation_block' }
        ],
        connections: [
          {
            id: 'edge-voltage',
            sourceDeviceId: 'voltage-source',
            sourcePort: 'voltage-out',
            targetDeviceId: 'voltage-target',
            targetPort: 'voltage-in'
          },
          {
            id: 'edge-voltage-rms',
            sourceDeviceId: 'voltage-source',
            sourcePort: 'voltage-out',
            targetDeviceId: 'voltage-target',
            targetPort: 'voltage-in'
          }
        ]
      }
    });

    expect(result.publicData.renderData.devices).toEqual([
      expect.objectContaining({
        id: 'voltage-source',
        measurementPorts: {
          inputs: [],
          outputs: [{ portId: 'voltage-out', elementNames: ['输出电压', '电压有效值'] }]
        }
      }),
      expect.objectContaining({
        id: 'voltage-target',
        measurementPorts: {
          inputs: [{ portId: 'voltage-in', elementNames: ['输入电压', '输入有效值'] }],
          outputs: []
        }
      })
    ]);
    expect(result.publicData.initialSimulationResult.physicalMeasurements[0]).toMatchObject({
      sourceElementName: '输出电压',
      targetElementName: '输入电压'
    });
  });

  it('exports a unique simulation component module ID as the measurement source device ID', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{
          pointId: 'tp-filter-output',
          shortName: 'M1',
          name: '滤波组件输出',
          pointType: 'physical',
          edgeId: 'edge-filter-limiter'
        }]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [{
          id: 'node-2',
          type: 'simulation_block',
          pythonBinding: { moduleId: 'DZDK_A' },
          outputs: [{ id: 'socket02', name: 'output' }]
        }],
        edges: [{ id: 'edge-filter-limiter', sourceNodeId: 'node-2', sourcePortIndex: 0 }],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'node-2': { output: 0 } } }]
      },
      renderData: { devices: [], connections: [] }
    });

    expect(result.publicData.initialSimulationResult.physicalMeasurements[0]).toMatchObject({
      sourceDeviceId: 'DZDK_A',
      sourcePort: 'socket02',
      samples: [{ time: 0, actual: 0 }]
    });
  });

  it('persists diagnostic condition metadata for the live practice path', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        diagnosticContext: {
          values: { 'component:source-1:input_mode': 'mode_1' },
          entries: [{ key: 'component:source-1:input_mode', label: '输入模式', value: 'mode_1' }]
        },
        points: [],
        rows: []
      },
      diagnosticConditions: [{
        key: 'component:source-1:input_mode',
        componentId: 'source-1',
        parameterKey: 'input_mode',
        label: '输入模式',
        options: [{ value: 'mode_1', label: '模式 1' }, { value: 'mode_2', label: '模式 2' }]
      }]
    });

    expect(result.privateData.diagnosticConditions).toEqual([{
      key: 'component:source-1:input_mode',
      componentId: 'source-1',
      parameterKey: 'input_mode',
      label: '输入模式',
      options: [{ value: 'mode_1', label: '模式 1' }, { value: 'mode_2', label: '模式 2' }],
      currentValue: 'mode_1'
    }]);
    expect(result.publicData.initialSimulationResult.diagnosticContext).toEqual({
      values: { 'component:source-1:input_mode': 'mode_1' }
    });
  });

  it('exports uninstalled subsystem-boundary points using the mapped internal output port', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: { points: [] },
      // This point is not activated for the D matrix yet.  It still belongs
      // to the simulation result and its source is the real internal
      // component, rather than the subsystem shell or boundary port.
      exportMeasurementPoints: [{
        pointId: 'M-subsystem-boundary-pitch',
        shortName: 'M8',
        name: '姿态组件到外部显示的俯仰角',
        pointType: 'virtual',
        edgeId: 'edge-subsystem-to-display',
        measurementSourceNodeId: 'inside-dynamics',
        measurementSourcePortIndex: 1
      }],
      executableModel: {
        simulationConfig: { duration: 0.1, stepSize: 0.1 },
        nodes: [{
          id: 'inside-dynamics',
          type: 'simulation_block',
          outputs: [
            { id: 'roll', name: 'roll' },
            { id: 'pitch', name: 'pitch' },
            { id: 'yaw', name: 'yaw' }
          ]
        }],
        // Flattening can assign the exported connection a different id from
        // the canvas boundary edge; source metadata above must remain enough
        // to read the correct component/port sample.
        edges: [],
        faultInstances: [],
        measurementPoints: []
      },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: { 'inside-dynamics': { roll: 0, pitch: 12.5, yaw: -3 } }
        }]
      },
      renderData: { devices: [], connections: [] }
    });

    expect(result.publicData.initialSimulationResult.virtualMeasurements).toEqual([{
      pointCode: 'M8',
      pointId: 'M-subsystem-boundary-pitch',
      pointName: '姿态组件到外部显示的俯仰角',
      channel: 'edge-subsystem-to-display',
      sourceDeviceId: 'inside-dynamics',
      sourcePort: 'pitch',
      sourceElementName: '元素 1',
      targetElementName: '元素 1',
      samples: [{ time: 0, actual: 12.5 }]
    }]);
  });

  it('saves a boundary measurement under the subsystem id while sampling the internal component', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: { points: [] },
      exportMeasurementPoints: [
        {
          pointId: 'M-subsystem-output',
          pointType: 'virtual',
          edgeId: 'edge-subsystem-output',
          measurementSourceNodeId: 'flight-control-01',
          measurementSourcePortIndex: 0,
          sourceVectorElementName: '俯仰角',
          targetVectorElementName: '俯仰显示'
        },
        {
          pointId: 'M-subsystem-input',
          pointType: 'physical',
          edgeId: 'edge-subsystem-input',
          measurementTargetNodeId: 'flight-control-01',
          measurementTargetPortIndex: 0,
          sourceVectorElementName: '俯仰指令',
          targetVectorElementName: '子系统俯仰指令'
        }
      ],
      executableModel: {
        simulationConfig: { duration: 0.1, stepSize: 0.1 },
        nodes: [
          { id: 'command-1', type: 'simulation_block', outputs: [{ id: 'command', name: '指令' }] },
          { id: 'flight-control-01', name: '飞控子系统', type: 'subsystem_block', parameters: {}, inputs: [], outputs: [] },
          { id: 'display-1', type: 'display_console', inputs: [{ id: 'input-0', name: '输入' }] }
        ],
        edges: [
          { id: 'edge-subsystem-input', sourceNodeId: 'command-1', targetNodeId: 'flight-control-01', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-subsystem-output', sourceNodeId: 'flight-control-01', targetNodeId: 'display-1', sourcePortIndex: 0, targetPortIndex: 0 }
        ],
        faultInstances: [],
        measurementPoints: []
      },
      measurementExecutableModel: {
        nodes: [
          {
            id: 'command-1',
            type: 'simulation_block',
            outputs: [{ id: 'command', name: 'command', dataType: 'vector', vectorLength: 1, vectorElementNames: ['俯仰指令'] }]
          },
          {
            id: 'inside-controller',
            type: 'simulation_block',
            pythonBinding: { moduleId: 'inside-controller-module' },
            inputs: [{ id: 'input', name: 'input', dataType: 'vector', vectorLength: 1, vectorElementNames: ['子系统俯仰指令'] }],
            outputs: [{ id: 'output', name: 'output', dataType: 'vector', vectorLength: 1, vectorElementNames: ['俯仰角'] }]
          }
        ],
        edges: [
          { id: 'edge-subsystem-input', sourceNodeId: 'command-1', targetNodeId: 'inside-controller', sourcePortIndex: 0, targetPortIndex: 0 },
          { id: 'edge-subsystem-output', sourceNodeId: 'inside-controller', targetNodeId: 'display-1', sourcePortIndex: 0, targetPortIndex: 0 }
        ],
        faultInstances: []
      },
      componentOutputs: {
        time: [0],
        steps: [{
          time: 0,
          actual: {
            'command-1': { command: [7] },
            'inside-controller': { output: [42] }
          }
        }]
      },
      renderData: {
        devices: [
          { id: 'command-1', type: 'simulation_block' },
          { id: 'flight-control-01', type: 'subsystem_block' },
          { id: 'inside-controller', type: 'simulation_block' },
          { id: 'display-1', type: 'display_console' }
        ],
        connections: [
          {
            id: 'public-edge-subsystem-input',
            sourceDeviceId: 'command-1',
            targetDeviceId: 'flight-control-01',
            sourcePort: 'command',
            targetPort: 'input'
          },
          {
            id: 'public-edge-subsystem-output',
            sourceDeviceId: 'flight-control-01',
            targetDeviceId: 'display-1',
            sourcePort: 'output',
            targetPort: 'input-0'
          }
        ]
      },
      connectionBindings: [
        {
          sourceDeviceId: 'command-1',
          sourcePort: 'command',
          targetDeviceId: 'flight-control-01',
          targetPort: 'input',
          backingEdgeIds: ['edge-subsystem-input']
        },
        {
          sourceDeviceId: 'flight-control-01',
          sourcePort: 'output',
          targetDeviceId: 'display-1',
          targetPort: 'input-0',
          backingEdgeIds: ['edge-subsystem-output']
        }
      ]
    });

    expect(result.publicData.initialSimulationResult.virtualMeasurements).toContainEqual(expect.objectContaining({
      pointId: 'M-subsystem-output',
      sourceDeviceId: 'flight-control-01',
      sourcePort: 'output',
      sourceVectorElementName: '俯仰角',
      targetVectorElementName: '俯仰显示',
      samples: [{ time: 0, actual: 42 }]
    }));
    expect(result.publicData.initialSimulationResult.physicalMeasurements).toContainEqual(expect.objectContaining({
      pointId: 'M-subsystem-input',
      sourceDeviceId: 'command-1',
      sourcePort: 'command',
      targetDeviceId: 'flight-control-01',
      targetPort: 'input',
      sourceVectorElementName: '俯仰指令',
      targetVectorElementName: '子系统俯仰指令'
    }));
    expect(result.publicData.renderData.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'flight-control-01',
        type: 'subsystem_block',
        measurementPorts: {
          inputs: [{ portId: 'input', elementNames: ['子系统俯仰指令'] }],
          outputs: [{ portId: 'output', elementNames: ['俯仰角'] }]
        }
      }),
      expect.objectContaining({
        id: 'display-1',
        measurementPorts: {
          inputs: [{ portId: 'input-0', elementNames: ['俯仰显示'] }],
          outputs: []
        }
      })
    ]));
    expect(result.publicData.renderData.devices.find((device) => device.id === 'inside-controller'))
      .not.toHaveProperty('measurementPorts');
  });

  it('keeps grouped subsystem elements from their internal ports', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: { points: [] },
      exportMeasurementPoints: [
        {
          pointId: 'M-grouped-A',
          pointType: 'virtual',
          edgeId: 'private-edge-a',
          vectorIndex: 0,
          sourceVectorElementName: 'A',
          targetVectorElementName: 'A'
        },
        {
          pointId: 'M-grouped-E',
          pointType: 'virtual',
          edgeId: 'private-edge-e',
          vectorIndex: 0,
          sourceVectorElementName: '外部 E',
          targetVectorElementName: 'E'
        }
      ],
      measurementExecutableModel: {
        simulationConfig: {},
        nodes: [
          {
            id: 'external-receiver',
            type: 'simulation_block',
            outputs: [
              { id: 'MM', varName: 'output_a', dataType: 'vector', vectorLength: 1, vectorElementNames: ['A'] },
              { id: 'MM', varName: 'output_e', dataType: 'vector', vectorLength: 1, vectorElementNames: ['外部 E'] }
            ]
          },
          {
            id: 'internal-selector',
            type: 'simulation_block',
            inputs: [
              { id: 'MM', dataType: 'vector', vectorLength: 1, vectorElementNames: ['A'] },
              { id: 'MM', dataType: 'vector', vectorLength: 1, vectorElementNames: ['E'] }
            ]
          }
        ],
        edges: [
          { id: 'private-edge-a', sourceNodeId: 'external-receiver', sourcePortIndex: 0, targetNodeId: 'internal-selector', targetPortIndex: 0 },
          { id: 'private-edge-e', sourceNodeId: 'external-receiver', sourcePortIndex: 1, targetNodeId: 'internal-selector', targetPortIndex: 1 }
        ],
        faultInstances: []
      },
      componentOutputs: {
        time: [0],
        steps: [{ time: 0, actual: { 'external-receiver': { output_a: [1], output_e: [2] } } }]
      },
      renderData: {
        devices: [
          { id: 'external-receiver', type: 'simulation_block' },
          { id: 'subsystem-1', type: 'subsystem_block' },
          { id: 'internal-selector', type: 'simulation_block' }
        ],
        connections: [{
          id: 'public-edge',
          sourceDeviceId: 'external-receiver',
          sourcePort: 'MM',
          targetDeviceId: 'subsystem-1',
          targetPort: 'MM'
        }]
      },
      connectionBindings: [{
        sourceDeviceId: 'external-receiver',
        sourcePort: 'MM',
        targetDeviceId: 'subsystem-1',
        targetPort: 'MM',
        backingEdgeIds: ['private-edge-a', 'private-edge-e']
      }]
    });

    expect(result.publicData.renderData.devices.find((device) => device.id === 'subsystem-1'))
      .toMatchObject({
        measurementPorts: {
          inputs: [{ portId: 'MM', elementNames: ['A', 'E'] }],
          outputs: []
        }
      });
    expect(result.publicData.renderData.devices.find((device) => device.id === 'internal-selector'))
      .not.toHaveProperty('measurementPorts');
  });

  it('normalizes a backend troubleshooting plan for the practice task', () => {
    const result = buildPracticeTaskPackage({
      practiceFaults: [{
        faultId: 'fault-1',
        troubleshootingPath: {
          ok: true,
          steps: [
            { action: 'measure', pointId: 'tp-1', pointCode: 'V1' },
            { action: 'replaceWire', targetId: 'wire-1' },
            { action: 'replaceComponent', targetId: 'component-1' }
          ]
        }
      }]
    });

    expect(result.privateData.initialRecommendedPath.steps).toMatchObject([
      { actionType: 'measurePoint', target: { type: 'testPoint', id: 'tp-1' } },
      { actionType: 'replaceWire', target: { type: 'wire', id: 'wire-1' } },
      { actionType: 'replaceComponent', target: { type: 'component', id: 'component-1' } }
    ]);
    expect(result.privateData).not.toHaveProperty('keyNodes');
  });

  it('exports a display-console condition switch as a student parameter-adjustment action', () => {
    const result = buildPracticeTaskPackage({
      practiceFaults: [{
        faultId: 'fault-a',
        troubleshootingPath: {
          ok: true,
          steps: [{
            action: 'setCondition',
            actionType: 'displayConsoleParameter',
            consoleNodeId: 'console-2',
            conditionChanges: [{
              componentId: 'downconverter-1',
              parameterKey: 'input_mode',
              value: 2,
              valueLabel: '模式 2：第二路输入'
            }],
            text: '显控台：切换至模式 2：第二路输入。'
          }]
        }
      }]
    });

    expect(result.privateData.initialRecommendedPath.steps).toMatchObject([{
      actionType: 'adjustDisplayConsoleParameter',
      target: { type: 'displayConsole', id: 'console-2' },
      componentId: 'downconverter-1',
      parameter: 'input_mode',
      value: 2
    }]);
  });

  it('splits multiple console parameters into separate student actions', () => {
    const result = buildPracticeTaskPackage({
      practiceFaults: [{
        faultId: 'fault-a',
        troubleshootingPath: {
          ok: true,
          steps: [{
            action: 'setCondition',
            consoleNodeId: 'console-2',
            conditionChanges: [
              { componentId: 'downconverter-1', parameterKey: 'input_mode', value: 2 },
              { componentId: 'downconverter-1', parameterKey: 'lo_frequency_hz', value: 900000000 }
            ]
          }]
        }
      }]
    });

    expect(result.privateData.initialRecommendedPath.steps).toMatchObject([
      { actionType: 'adjustDisplayConsoleParameter', parameter: 'input_mode', value: 2 },
      { actionType: 'adjustDisplayConsoleParameter', parameter: 'lo_frequency_hz', value: 900000000 }
    ]);
  });

  it('saves the enabled-fault combination path and its key measurement points', () => {
    const combinedTroubleshootingPath = {
      ok: true,
      mode: 'multiple',
      faultIds: ['fault-a', 'fault-b'],
      steps: [
        { action: 'measure', pointId: 'tp-1', pointCode: 'M1' },
        { action: 'replaceComponent', targetId: 'device-a' }
      ],
      keySteps: [{ action: 'measure', pointId: 'tp-1', pointCode: 'M1', text: '检测关键测点 M1。' }]
    };
    const keyMeasurementPoints = [{ pointId: 'tp-1', pointCode: 'M1', pointName: '关键测点一' }];
    const result = buildPracticeTaskPackage({
      targetFaultIds: ['fault-a', 'fault-b'],
      combinedTroubleshootingPath,
      keyMeasurementPoints
    });

    expect(result.privateData.targetFaultId).toBe('fault-a');
    expect(result.privateData.targetFaultIds).toEqual(['fault-a', 'fault-b']);
    expect(result.privateData.initialRecommendedPath).toMatchObject({
      mode: 'multiple',
      faultIds: ['fault-a', 'fault-b'],
      steps: [
        { actionType: 'measurePoint', target: { type: 'testPoint', id: 'tp-1' } },
        { actionType: 'replaceComponent', target: { type: 'component', id: 'device-a' } }
      ]
    });
    expect(result.privateData.keyMeasurementPoints).toEqual(keyMeasurementPoints);
  });

  it('derives each saved measurement state from enabled faults and the D matrix', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [
          { pointId: 'p1', shortName: 'M1', pointType: 'physical' },
          { pointId: 'v1', shortName: 'V1', pointType: 'virtual' },
          { pointId: 'v2', shortName: 'V2', pointType: 'virtual' }
        ],
        rows: [
          {
            faultId: 'enabled-fault',
            cells: [
              { pointCode: 'M1', detectable: true },
              { pointCode: 'V1', detectable: false },
              { pointCode: 'V2', detectable: true }
            ]
          },
          {
            faultId: 'disabled-fault',
            cells: [
              { pointCode: 'M1', detectable: false },
              { pointCode: 'V1', detectable: true },
              { pointCode: 'V2', detectable: false }
            ]
          }
        ]
      },
      executableModel: {
        simulationConfig: {},
        nodes: [],
        edges: [],
        faultInstances: [
          { faultId: 'enabled-fault', enabled: true },
          { faultId: 'disabled-fault', enabled: false }
        ]
      }
    });

    expect(result.privateData.initialPointStates).toEqual([
      { pointCode: 'M1', observed: 'abnormal' },
      { pointCode: 'V1', observed: 'normal' },
      { pointCode: 'V2', observed: 'abnormal' }
    ]);
  });

  it('groups private backing edges by the four public connection endpoint fields', () => {
    const endpoints = {
      sourceDeviceId: 'external-device',
      targetDeviceId: 'subsystem-1',
      sourcePort: 'output',
      targetPort: 'input'
    };
    const result = buildPracticeTaskPackage({
      connectionBindings: [
        { ...endpoints, publicConnectionId: 'ignored-a', backingEdgeIds: ['edge-a'] },
        { ...endpoints, publicConnectionId: 'ignored-b', backingEdgeIds: ['edge-b', 'edge-a'] }
      ]
    });

    expect(result.privateData.connectionBindings).toEqual([{
      ...endpoints,
      backingEdgeIds: ['edge-a', 'edge-b']
    }]);
    expect(result.privateData.executableModel.connectionBindings).toEqual(result.privateData.connectionBindings);
    expect(result.publicData.renderData).not.toHaveProperty('connectionBindings');
    expect(result.privateData.connectionBindings[0]).not.toHaveProperty('publicConnectionId');
  });
});
