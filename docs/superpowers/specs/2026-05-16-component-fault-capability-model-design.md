# Component Fault Capability Model Design

## Purpose

This design defines the next data model for the UAV fault-injection demo. The main change is conceptual: a fault is not a normal simulation block. A fault is an activatable property of a component, submodule, or signal link. The canvas should show the normal flight-control system first; fault labels are attached to compatible targets only after the user activates a supported fault.

The first implementation scope is the current UAV flight-control demo. It does not need to support arbitrary imported systems yet. Other systems can use the same schema later, but they must provide their own fault capability map and diagnostic matrix.

## Model Layers

The demo package should be treated as one coherent package instead of several loosely matched JSON files.

```json
{
  "schemaVersion": "2.0",
  "modelInfo": {},
  "systemModel": {
    "nodes": [],
    "edges": []
  },
  "faultTypeCatalog": [],
  "faultCapabilityMap": [],
  "faultInstances": [],
  "diagnosticModel": {
    "testPoints": [],
    "detectabilityMatrix": []
  },
  "simulationProfiles": []
}
```

The package separates reusable fault templates from active user injections. `faultTypeCatalog` defines what a fault type is. `faultCapabilityMap` defines which targets can accept which fault types. `faultInstances` is initially empty and records faults that the user has actually injected.

## System Model

System nodes and edges use stable internal identifiers while exposing Chinese display names in the UI. English IDs and signal names remain acceptable for Python bindings and runtime code.

```json
{
  "id": "node-imu-gyro",
  "displayName": "IMU 陀螺仪反馈",
  "type": "sensor",
  "category": "测量反馈",
  "pythonBinding": {
    "module": "imu_gyro.py",
    "function": "gyro_feedback",
    "variables": ["imu.pitch_rate"]
  },
  "ports": {
    "outputs": [
      {
        "id": "out-pitch-rate",
        "name": "俯仰角速度",
        "signalId": "imu.pitch_rate",
        "unit": "rad/s"
      }
    ]
  }
}
```

```json
{
  "id": "edge-imu-error",
  "sourceNodeId": "node-imu-gyro",
  "targetNodeId": "node-error-sum",
  "displayName": "IMU 反馈链路",
  "signalId": "imu.pitch_rate",
  "bus": "CAN",
  "signalRole": "feedback"
}
```

The visible canvas should prefer `displayName`, `ports.*.name`, and localized signal descriptions. Internal fields such as `signalId`, `pythonBinding.module`, and `pythonBinding.function` should remain available in property details but should not be the primary visual label.

## Fault Type Catalog

Fault types are templates. They do not imply that any fault has been injected.

```json
{
  "id": "gyro_zero_bias_fixed",
  "displayName": "Gyro 陀螺仪零偏 - 固定偏差",
  "layer": "electrical",
  "faultClass": "偏差故障",
  "runtimeBehavior": "bias",
  "formula": "y_fault = y + bias",
  "parameters": {
    "bias": {
      "type": "number",
      "default": 0.08,
      "unit": "rad/s",
      "label": "固定偏差"
    },
    "start": {
      "type": "number",
      "default": 0,
      "unit": "s",
      "label": "开始时间"
    }
  }
}
```

Required fields:

- `id`: stable internal fault type identifier.
- `displayName`: Chinese UI name.
- `layer`: one of `electrical`, `physical`, `protocol`, or `diagnostic`.
- `faultClass`: Chinese fault category, such as `偏差故障`, `漂移故障`, `间歇故障`, `卡位故障`, or `指令篡改`.
- `runtimeBehavior`: executable behavior key, such as `bias`, `drift`, `intermittent`, `lock`, `tamper`, `noise`, or `dropout`.
- `parameters`: parameter schema used by the fault parameter editor.

For the first demo, the catalog should focus on five presentation-grade fault types:

```json
[
  {
    "id": "gyro_zero_bias_fixed",
    "displayName": "Gyro 陀螺仪零偏 - 固定偏差",
    "layer": "electrical",
    "faultClass": "偏差故障",
    "runtimeBehavior": "bias"
  },
  {
    "id": "gyro_zero_bias_drift",
    "displayName": "Gyro 陀螺仪零偏 - 缓慢漂移",
    "layer": "electrical",
    "faultClass": "漂移故障",
    "runtimeBehavior": "drift"
  },
  {
    "id": "gyro_zero_bias_intermittent",
    "displayName": "Gyro 陀螺仪零偏 - 间歇故障",
    "layer": "electrical",
    "faultClass": "间歇故障",
    "runtimeBehavior": "intermittent"
  },
  {
    "id": "motor1_stuck",
    "displayName": "1号电机卡死",
    "layer": "physical",
    "faultClass": "卡位故障",
    "runtimeBehavior": "lock"
  },
  {
    "id": "motor1_can_command_tamper",
    "displayName": "1号电机 CAN 指令篡改",
    "layer": "protocol",
    "faultClass": "指令篡改",
    "runtimeBehavior": "tamper"
  }
]
```

These five types cover sensor electrical faults, actuator physical faults, protocol faults, multiple faults on the same component, and different detectability from the same measurement point.

## Fault Capability Map

The capability map defines which targets can accept which faults. This is the source of truth for drag-and-drop validation and the fault selection dialog.

```json
{
  "targetId": "node-imu-gyro",
  "targetKind": "node",
  "targetName": "IMU 陀螺仪反馈",
  "faultSlots": [
    {
      "slotId": "gyro-feedback-signal",
      "slotName": "陀螺仪反馈信号",
      "signalId": "imu.pitch_rate",
      "allowedFaultIds": [
        "gyro_zero_bias_fixed",
        "gyro_zero_bias_drift",
        "gyro_zero_bias_intermittent"
      ]
    }
  ]
}
```

```json
{
  "targetId": "node-motor-1",
  "targetKind": "node",
  "targetName": "1号电机与旋翼",
  "faultSlots": [
    {
      "slotId": "motor-output",
      "slotName": "1号电机执行输出",
      "signalId": "motor1.thrust",
      "allowedFaultIds": [
        "motor1_stuck"
      ]
    }
  ]
}
```

```json
{
  "targetId": "edge-allocator-motor1",
  "targetKind": "edge",
  "targetName": "1号电机 CAN 指令",
  "faultSlots": [
    {
      "slotId": "motor1-can-command",
      "slotName": "1号电机控制指令",
      "signalId": "motor1.command",
      "allowedFaultIds": [
        "motor1_can_command_tamper"
      ]
    }
  ]
}
```

Rules:

- A target without a capability entry cannot accept a dragged fault tag.
- The fault selection dialog must only show `allowedFaultIds` for the selected target and slot.
- A target can have multiple slots when different internal signals or parameters can fail independently.
- The first implementation can support node and edge targets. Submodule targets can be added later using the same `targetKind` pattern.

## Fault Instances

A fault instance records what the user has actually injected.

```json
{
  "instanceId": "fault-inst-001",
  "faultTypeId": "gyro_zero_bias_drift",
  "targetKind": "node",
  "targetId": "node-imu-gyro",
  "slotId": "gyro-feedback-signal",
  "displayName": "Gyro 缓慢漂移注入",
  "parameters": {
    "rate": 0.002,
    "start": 5
  },
  "active": true,
  "visual": {
    "expanded": false,
    "x": 540,
    "y": 260
  }
}
```

Fault instances are the only records that should make a component appear faulted. Catalog entries and capability entries are not injected faults.

For backward compatibility, the runtime may continue to mirror the latest active instance into existing fields such as `target.injectedFault` and `target.faultBindings[]`. Those compatibility fields should be derived from `faultInstances`, not treated as the authoritative authoring model.

## User Interaction Model

The fault component in the left panel is a fault activation tool, not a simulation block.

Expected flow:

1. User drags the fault component to a target on the canvas.
2. The platform resolves the target and checks `faultCapabilityMap`.
3. If the target is not compatible, show a small invalid-target hint and do not create a fault instance.
4. If the target has one compatible slot, open a fault selection dialog for that slot.
5. If the target has multiple compatible slots, ask the user to choose the slot first.
6. The dialog shows only compatible fault types.
7. User selects a fault type and edits parameters.
8. User clicks `应用注入`.
9. A new `faultInstance` is created.
10. The target module turns red and shows a fault count badge.
11. Fault labels are hidden by default.
12. The target shows an expand button only when it has active fault instances.
13. When expanded, attached fault labels appear around the target.
14. Double-clicking a label opens the fault parameter panel.
15. Parameter edits remain draft until the user clicks `应用修改`.

This flow prevents ambiguous states where a catalog item looks injected before it is actually applied.

## Visual Rules

The normal canvas should remain visually simple:

- Normal modules keep their module-specific geometry and neutral outline.
- Faulted modules use a red state treatment and a compact fault count badge.
- Fault labels are hidden until the user expands a faulted module.
- Fault labels are not graph nodes with input and output ports.
- Fault labels may be independently positioned when expanded. Their position is visual only and must not affect simulation topology.
- The fault view should show target-to-fault attachment, not raw signal ports or dense internal metadata.

## Diagnostic Model

Measurement points are predefined by the current UAV demo model. Users can install or remove available points, but they cannot create arbitrary measurement positions in the first implementation.

```json
{
  "testPointId": "M3",
  "displayName": "IMU 反馈测点",
  "edgeId": "edge-imu-error",
  "observedSignalId": "imu.pitch_rate",
  "installable": true
}
```

Detectability should be explicit rather than inferred only from graph distance.

```json
{
  "faultTypeId": "gyro_zero_bias_fixed",
  "targetId": "node-imu-gyro",
  "detectability": [
    {
      "testPointId": "M3",
      "detectable": true,
      "signature": "均值偏移",
      "confidence": 0.9
    },
    {
      "testPointId": "M10",
      "detectable": false,
      "signature": "频谱变化不明显",
      "confidence": 0.2
    }
  ]
}
```

The D matrix is a projection of this diagnostic model:

```csv
故障ID,故障名称,目标对象,M1,M2,M3,M4,M5,M10
gyro_zero_bias_fixed,Gyro固定零偏,IMU陀螺仪反馈,0,0,1,1,0,0
gyro_zero_bias_intermittent,Gyro间歇故障,IMU陀螺仪反馈,0,0,1,1,0,1
motor1_stuck,1号电机卡死,1号电机与旋翼,0,0,0,1,1,0
```

This model supports the required demonstration: the same component can have multiple fault forms, and the same measurement point can detect one form while failing to detect another.

## Simulation Semantics

The simulation runtime should resolve fault effects in this order:

1. Read active `faultInstances`.
2. Resolve each instance to its `faultTypeCatalog` template.
3. Resolve the target and slot through `faultCapabilityMap`.
4. Apply `runtimeBehavior` using the instance parameters.
5. Update observable signals and diagnostic results.

The first implementation should keep behavior simple:

- `bias`: add constant offset after `start`.
- `drift`: add `rate * max(t - start, 0)`.
- `intermittent`: apply the configured effect only within periodic active windows.
- `lock`: hold actuator output at `lockValue` after `start`.
- `tamper`: replace or scale the command payload after `start`.

These behaviors can be implemented by existing runtime helpers. The schema should not require visible fault blocks to be inserted into the signal graph.

## Reset and Persistence Rules

Resetting the canvas must clear all state derived from the current model:

- `systemModel.nodes`
- `systemModel.edges`
- `faultInstances`
- fault label visual state
- installed measurement points
- diagnostic results
- D matrix selection state
- compatibility mirrors such as `injectedFault`, `faultBindings`, and `injectedFaultMap`

Loading the demo should load nodes, edges, catalog, capability map, and diagnostic model, but `faultInstances` should remain empty unless the specific package is intentionally a fault-injected scenario.

## Migration From Current Data

The current demo already contains useful fields:

- `nodes` and `edges` can map into `systemModel`.
- `faultLibrary` can be split into `faultTypeCatalog` plus `faultCapabilityMap`.
- `testPoints` can map into `diagnosticModel.testPoints`.
- `testPoints[].detects` can be expanded into `diagnosticModel.detectabilityMatrix`.

The migration should avoid keeping `targetNodeId` and `targetEdgeId` directly on generic catalog entries. Those fields belong in the capability map or in active fault instances. This distinction is important because a fault type can be reusable, while a fault instance is target-specific.

## Acceptance Criteria

- The demo opens with the system model loaded, but no active fault instances.
- Dragging the fault activation tool onto an incompatible target does not create a fault.
- Dragging it onto `IMU 陀螺仪反馈` offers only the three Gyro zero-bias fault forms.
- Dragging it onto `1号电机与旋翼` offers only the motor stuck fault.
- Dragging it onto `1号电机 CAN 指令` offers only the command tamper fault.
- Applying a fault creates a `faultInstance`, marks the target red, and adds a hidden-by-default fault label.
- Expanding a faulted target shows its attached fault labels.
- Double-clicking a label opens parameter editing with explicit `应用修改` and `取消修改` controls.
- Removing a fault deletes the corresponding `faultInstance` and clears derived runtime mirrors.
- Resetting the canvas clears faults and installed measurement points.
- D matrix export uses the diagnostic model and displays Chinese fault names and target names.
