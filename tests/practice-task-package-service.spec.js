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
      dMatrix: { points: [{ shortName: 'M1' }], rows: [{ faultId: 'fault-1' }] },
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
      devices: [{ id: 'controller-1', type: 'simulation_block' }],
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

  it('preserves every channel of a multi-channel interface in each saved sample', () => {
    const result = buildPracticeTaskPackage({
      dMatrix: {
        points: [{
          pointId: 'tp-vector',
          shortName: 'P-VECTOR',
          name: 'Three-phase output',
          pointType: 'physical',
          edgeId: 'vector-wire'
        }]
      },
      executableModel: {
        simulationConfig: { duration: 0.1, stepSize: 0.1 },
        nodes: [],
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

    expect(result.publicData.initialSimulationResult.physicalMeasurements).toMatchObject([{
      pointId: 'tp-vector',
      sourceDeviceId: 'source-1',
      sourcePort: 'phase-output',
      samples: [
        { time: 0, actual: [220, 221, 222] },
        { time: 0.1, actual: [223, null, 225] }
      ]
    }]);
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
});
