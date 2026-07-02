# Signal Source Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-stage signal source domains for digital, command, analog, and RF sources while keeping the saved node type as `signal_source`.

**Architecture:** Add one focused signal source domain service and use it from the component registry, property schema, model normalization, backend executable package creation, and legacy runtime bridge. The browser UI continues running through `legacy-runtime.txt`, so the final implementation must synchronize the modern module behavior into the legacy runtime entry points that create nodes, render summaries, and save property panels.

**Tech Stack:** Vue 3 + Vite, Vitest, JavaScript service modules, legacy browser runtime loaded from `src/services/legacy-runtime.txt`, Python `unittest` backend runtime.

---

## File Map

- Create: `src/services/signalSourceDomainService.js`
  - Owns signal domain constants, default props, normalization, summary generation, and scalar fallback selection.
- Create: `tests/signal-source-domain-service.spec.js`
  - Unit tests for the new focused service.
- Modify: `src/services/componentRegistry.js`
  - Adds four palette entries while preserving `type: 'signal_source'` for created nodes through `nodeType`.
- Modify: `tests/component-registry.spec.js`
  - Verifies four signal source entries and legacy component library defaults.
- Modify: `src/services/propertyPanelSchema.js`
  - Renders common signal source fields and filters domain-specific groups by `props.signalDomain`.
- Modify: `tests/property-panel-schema.spec.js`
  - Verifies domain-specific property rendering, reading, and old analog default behavior.
- Modify: `src/services/modelStore.js`
  - Normalizes imported/saved `signal_source` nodes so missing domains become `analog`.
- Modify: `tests/flight-model-package.spec.js`
  - Verifies old packages normalize signal sources to `analog`.
- Modify: `src/services/backendExecutablePackageService.js`
  - Ensures backend executable package includes numeric fallback fields such as `initialState`, `payloadValue`, and `power`.
- Modify: `tests/backend-executable-package-service.spec.js`
  - Verifies all four source domains produce backend-compatible executable nodes.
- Modify: `backend/simulation_engine.py`
  - Extends `_source_value()` to use domain-compatible numeric fallbacks.
- Modify: `backend/tests/test_simulation_engine.py`
  - Verifies backend can simulate digital, command, analog, and RF sources without unsupported-node or missing-value failures.
- Modify: `src/services/legacy-runtime.txt`
  - Synchronizes runtime fallback component library, node creation naming, schema saving hook, and final node subtitle override.
- Modify: `tests/property-panel-app.spec.js`
  - Verifies app-level creation and property panel behavior through the legacy runtime.
- Modify as needed: `tests/left-palette-taxonomy.spec.js`
  - Updates expected palette taxonomy when the system signal group contains four source entries.

---

### Task 1: Signal Source Domain Service

**Files:**
- Create: `src/services/signalSourceDomainService.js`
- Create: `tests/signal-source-domain-service.spec.js`

- [ ] **Step 1: Write the failing service tests**

Create `tests/signal-source-domain-service.spec.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  SIGNAL_DOMAINS,
  createSignalSourceProps,
  getSignalSourceScalarFallback,
  normalizeSignalSourceProps,
  summarizeSignalSource
} from '../src/services/signalSourceDomainService.js';

describe('signalSourceDomainService', () => {
  it('defines the supported signal domains in display order', () => {
    expect(SIGNAL_DOMAINS.map((item) => item.value)).toEqual(['digital', 'command', 'analog', 'rf']);
    expect(SIGNAL_DOMAINS.map((item) => item.label)).toEqual(['数字信号', '指令信号', '模拟信号', '射频信号']);
  });

  it('creates defaults for all signal source domains without changing node type', () => {
    expect(createSignalSourceProps('digital')).toMatchObject({
      name: '数字信号源',
      signalDomain: 'digital',
      digitalMode: 'boolean',
      initialState: '0'
    });
    expect(createSignalSourceProps('command')).toMatchObject({
      name: '指令信号源',
      signalDomain: 'command',
      commandType: 'control',
      protocol: 'CAN',
      payloadKind: 'float32'
    });
    expect(createSignalSourceProps('analog')).toMatchObject({
      name: '模拟信号源',
      signalDomain: 'analog',
      waveType: '正弦',
      amplitude: '1.0',
      frequency: '1.0',
      outputFormat: '标量'
    });
    expect(createSignalSourceProps('rf')).toMatchObject({
      name: '射频信号源',
      signalDomain: 'rf',
      rfKind: 'communication',
      centerFrequency: '',
      bandwidth: '',
      powerUnit: 'dBm'
    });
  });

  it('normalizes old signal source props as analog while preserving old fields', () => {
    expect(normalizeSignalSourceProps({
      name: '旧信号源',
      waveType: '常值',
      amplitude: '2.5',
      frequency: '0',
      outputFormat: '标量'
    })).toMatchObject({
      name: '旧信号源',
      signalDomain: 'analog',
      waveType: '常值',
      amplitude: '2.5',
      frequency: '0',
      outputFormat: '标量'
    });
  });

  it('keeps previous-domain fields when normalizing after a domain switch', () => {
    expect(normalizeSignalSourceProps({
      name: '可切换源',
      signalDomain: 'rf',
      waveType: '阶跃',
      amplitude: '3',
      centerFrequency: '2.4GHz'
    })).toMatchObject({
      name: '可切换源',
      signalDomain: 'rf',
      waveType: '阶跃',
      amplitude: '3',
      centerFrequency: '2.4GHz',
      powerUnit: 'dBm'
    });
  });

  it('summarizes each signal domain for canvas display', () => {
    expect(summarizeSignalSource({ props: createSignalSourceProps('digital', { digitalMode: 'pulse', period: '20ms' }) }))
      .toBe('数字 · pulse · 周期 20ms');
    expect(summarizeSignalSource({ props: createSignalSourceProps('command', { protocol: 'CAN', messageId: '0x120' }) }))
      .toBe('指令 · CAN · 0x120 · float32');
    expect(summarizeSignalSource({ props: createSignalSourceProps('analog', { waveType: 'sine', amplitude: '1.0', unit: 'V', frequency: '10Hz' }) }))
      .toBe('模拟 · sine · 1.0V · 10Hz');
    expect(summarizeSignalSource({ props: createSignalSourceProps('rf', { centerFrequency: '2.4GHz', bandwidth: '20MHz', modulation: 'QPSK' }) }))
      .toBe('射频 · 2.4GHz · 20MHz · QPSK');
  });

  it('selects numeric scalar fallbacks for backend execution', () => {
    expect(getSignalSourceScalarFallback({ signalDomain: 'analog', value: '1.5', amplitude: '2' })).toBe(1.5);
    expect(getSignalSourceScalarFallback({ signalDomain: 'digital', initialState: '1' })).toBe(1);
    expect(getSignalSourceScalarFallback({ signalDomain: 'command', payloadValue: '7' })).toBe(7);
    expect(getSignalSourceScalarFallback({ signalDomain: 'rf', power: '10' })).toBe(10);
    expect(getSignalSourceScalarFallback({ signalDomain: 'rf', power: '10dBm' })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/signal-source-domain-service.spec.js
```

Expected: FAIL because `src/services/signalSourceDomainService.js` does not exist.

- [ ] **Step 3: Implement the service**

Create `src/services/signalSourceDomainService.js`:

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function firstText(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function numberOrFallback(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export const SIGNAL_DOMAINS = [
  { value: 'digital', label: '数字信号' },
  { value: 'command', label: '指令信号' },
  { value: 'analog', label: '模拟信号' },
  { value: 'rf', label: '射频信号' }
];

export const SIGNAL_DOMAIN_VALUES = SIGNAL_DOMAINS.map((item) => item.value);

const COMMON_DEFAULTS = {
  signalName: '',
  signalId: '',
  unit: '',
  description: ''
};

const DOMAIN_DEFAULTS = {
  digital: {
    name: '数字信号源',
    signalDomain: 'digital',
    digitalMode: 'boolean',
    initialState: '0',
    highLevel: '1',
    lowLevel: '0',
    pulseWidth: '',
    period: '',
    dutyCycle: '',
    enumValues: '',
    outputFormat: '布尔'
  },
  command: {
    name: '指令信号源',
    signalDomain: 'command',
    commandType: 'control',
    commandName: '',
    protocol: 'CAN',
    messageId: '',
    payloadKind: 'float32',
    payloadSchema: '',
    payloadValue: '',
    sendPeriod: '',
    triggerCondition: '',
    outputFormat: '事件'
  },
  analog: {
    name: '模拟信号源',
    signalDomain: 'analog',
    analogKind: 'generic',
    waveType: '正弦',
    amplitude: '1.0',
    frequency: '1.0',
    phase: '0',
    offset: '0',
    sampleRate: '',
    minValue: '',
    maxValue: '',
    unit: '',
    outputFormat: '标量'
  },
  rf: {
    name: '射频信号源',
    signalDomain: 'rf',
    rfKind: 'communication',
    centerFrequency: '',
    bandwidth: '',
    power: '',
    powerUnit: 'dBm',
    modulation: '',
    phase: '',
    snr: '',
    sampleRate: '',
    pulseWidth: '',
    prf: '',
    channel: '',
    polarization: '',
    rfProfile: '',
    outputFormat: '矩阵'
  }
};

export function normalizeSignalDomain(value) {
  return SIGNAL_DOMAIN_VALUES.includes(value) ? value : 'analog';
}

export function createSignalSourceProps(domain = 'analog', overrides = {}) {
  const normalizedDomain = normalizeSignalDomain(domain);
  return {
    ...clone(COMMON_DEFAULTS),
    ...clone(DOMAIN_DEFAULTS[normalizedDomain]),
    ...clone(overrides),
    signalDomain: normalizedDomain
  };
}

export function normalizeSignalSourceProps(props = {}) {
  const original = clone(props ?? {});
  const signalDomain = normalizeSignalDomain(original.signalDomain);
  return {
    ...createSignalSourceProps(signalDomain),
    ...original,
    signalDomain
  };
}

export function summarizeSignalSource(node = {}) {
  const props = normalizeSignalSourceProps(node.props ?? node);
  if (props.signalDomain === 'digital') {
    return ['数字', props.digitalMode, props.period ? `周期 ${props.period}` : ''].filter(Boolean).join(' · ');
  }
  if (props.signalDomain === 'command') {
    return ['指令', props.protocol || '协议', props.messageId || props.commandName || '未设置', props.payloadKind].filter(Boolean).join(' · ');
  }
  if (props.signalDomain === 'rf') {
    return ['射频', props.centerFrequency || '未设置频点', props.bandwidth || '未设置带宽', props.modulation || props.power ? (props.modulation || `${props.power}${props.powerUnit || ''}`) : ''].filter(Boolean).join(' · ');
  }
  const amplitude = `${props.amplitude ?? '1.0'}${props.unit ?? ''}`;
  return ['模拟', props.waveType || '信号', amplitude, props.frequency].filter(Boolean).join(' · ');
}

export function getSignalSourceScalarFallback(props = {}) {
  const normalized = normalizeSignalSourceProps(props);
  if (normalized.signalDomain === 'digital') {
    return numberOrFallback(normalized.initialState, 0);
  }
  if (normalized.signalDomain === 'command') {
    return numberOrFallback(firstText(normalized.commandValue, normalized.payloadValue), 0);
  }
  if (normalized.signalDomain === 'rf') {
    return numberOrFallback(normalized.power, 0);
  }
  return numberOrFallback(firstText(normalized.value, normalized.amplitude), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/signal-source-domain-service.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/services/signalSourceDomainService.js tests/signal-source-domain-service.spec.js
git commit -m "feat: add signal source domain helpers"
```

Expected: commit only those two files.

---

### Task 2: Palette Registry and Property Schema

**Files:**
- Modify: `src/services/componentRegistry.js`
- Modify: `src/services/propertyPanelSchema.js`
- Modify: `tests/component-registry.spec.js`
- Modify: `tests/property-panel-schema.spec.js`

- [ ] **Step 1: Write failing registry tests**

In `tests/component-registry.spec.js`, update the registered type list to include the new template entries:

```js
expect(Object.keys(COMPONENT_REGISTRY).sort()).toEqual([
  'airspeed_sensor',
  'electrical_fault_injector',
  'flow_block',
  'gain_block',
  'instrument_logger',
  'instrument_scope',
  'instrument_spectrum',
  'link_can',
  'link_normal',
  'middle_var_assign',
  'mux_block',
  'physical_fault_injector',
  'protocol_fault_injector',
  'signal_source',
  'signal_source_command',
  'signal_source_digital',
  'signal_source_rf',
  'simulation_block',
  'subsystem_block',
  'subsystem_in_port',
  'subsystem_out_port',
  'sum_block'
]);
```

Replace the `library.signal_source` expectation with:

```js
expect(library.signal_source).toMatchObject({
  label: '模拟信号源',
  nodeType: 'signal_source',
  defaults: {
    name: '模拟信号源',
    signalDomain: 'analog',
    waveType: '正弦',
    amplitude: '1.0',
    frequency: '1.0',
    outputFormat: '标量'
  }
});

expect(library.signal_source_digital).toMatchObject({
  label: '数字信号源',
  nodeType: 'signal_source',
  defaults: {
    name: '数字信号源',
    signalDomain: 'digital',
    initialState: '0'
  }
});

expect(library.signal_source_command).toMatchObject({
  label: '指令信号源',
  nodeType: 'signal_source',
  defaults: {
    name: '指令信号源',
    signalDomain: 'command',
    protocol: 'CAN',
    payloadKind: 'float32'
  }
});

expect(library.signal_source_rf).toMatchObject({
  label: '射频信号源',
  nodeType: 'signal_source',
  defaults: {
    name: '射频信号源',
    signalDomain: 'rf',
    powerUnit: 'dBm'
  }
});
```

Update the signal group expectation:

```js
expect(paletteGroups.find((group) => group.id === 'signals').components.map((item) => item.type)).toEqual([
  'signal_source',
  'signal_source_digital',
  'signal_source_command',
  'signal_source_rf',
  'middle_var_assign'
]);
```

- [ ] **Step 2: Write failing property schema tests**

Append to `tests/property-panel-schema.spec.js`:

```js
it('renders analog signal source fields for old signal sources by default', () => {
  const schema = getComponentPropertySchema('signal_source');
  const html = renderPropertyFieldsFromSchema({
    type: 'signal_source',
    props: {
      name: 'Old Source',
      waveType: '常值',
      amplitude: '2',
      frequency: '0'
    }
  }, schema);

  expect(html).toContain('id="prop-signalDomain"');
  expect(html).toContain('<option value="analog" selected>模拟信号</option>');
  expect(html).toContain('id="prop-waveType"');
  expect(html).toContain('id="prop-amplitude"');
  expect(html).not.toContain('id="prop-centerFrequency"');
  expect(html).not.toContain('id="prop-messageId"');
});

it('renders RF-only fields for RF signal sources', () => {
  const schema = getComponentPropertySchema('signal_source');
  const html = renderPropertyFieldsFromSchema({
    type: 'signal_source',
    props: {
      signalDomain: 'rf',
      centerFrequency: '2.4GHz',
      bandwidth: '20MHz',
      modulation: 'QPSK'
    }
  }, schema);

  expect(html).toContain('id="prop-centerFrequency"');
  expect(html).toContain('id="prop-bandwidth"');
  expect(html).toContain('id="prop-modulation"');
  expect(html).not.toContain('id="prop-waveType"');
  expect(html).not.toContain('id="prop-digitalMode"');
});

it('reads rendered signal source values without deleting unrendered domain fields', () => {
  const schema = getComponentPropertySchema('signal_source');
  document.body.innerHTML = renderPropertyFieldsFromSchema({
    type: 'signal_source',
    props: {
      name: 'RF Source',
      signalDomain: 'rf',
      centerFrequency: '2.4GHz',
      bandwidth: '20MHz',
      power: '10',
      modulation: 'QPSK'
    }
  }, schema);

  document.getElementById('prop-name').value = 'RF Updated';
  document.getElementById('prop-signalDomain').value = 'rf';
  document.getElementById('prop-centerFrequency').value = '5.8GHz';

  expect(readPropertyValuesFromSchema(schema, document)).toEqual(expect.objectContaining({
    name: 'RF Updated',
    signalDomain: 'rf',
    centerFrequency: '5.8GHz',
    bandwidth: '20MHz',
    power: '10',
    modulation: 'QPSK'
  }));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npm test -- --run tests/component-registry.spec.js tests/property-panel-schema.spec.js
```

Expected: FAIL because the registry only has one source entry and the schema lacks signal-domain fields.

- [ ] **Step 4: Update component registry**

In `src/services/componentRegistry.js`, import the helper:

```js
import { createSignalSourceProps } from './signalSourceDomainService.js';
```

Replace the existing `signal_source` entry with analog defaults and add three template entries immediately after it:

```js
signal_source: {
  type: 'signal_source',
  nodeType: 'signal_source',
  group: 'signals',
  label: '模拟信号源',
  badge: '模拟',
  className: 'b-source',
  width: 164,
  height: 84,
  palette: { icon: 'A', iconClass: 'source' },
  defaults: createSignalSourceProps('analog')
},
signal_source_digital: {
  type: 'signal_source_digital',
  nodeType: 'signal_source',
  group: 'signals',
  label: '数字信号源',
  badge: '数字',
  className: 'b-source',
  width: 164,
  height: 84,
  palette: { icon: 'D', iconClass: 'source' },
  defaults: createSignalSourceProps('digital')
},
signal_source_command: {
  type: 'signal_source_command',
  nodeType: 'signal_source',
  group: 'signals',
  label: '指令信号源',
  badge: '指令',
  className: 'b-source',
  width: 164,
  height: 84,
  palette: { icon: 'C', iconClass: 'source' },
  defaults: createSignalSourceProps('command')
},
signal_source_rf: {
  type: 'signal_source_rf',
  nodeType: 'signal_source',
  group: 'signals',
  label: '射频信号源',
  badge: '射频',
  className: 'b-source',
  width: 164,
  height: 84,
  palette: { icon: 'RF', iconClass: 'source' },
  defaults: createSignalSourceProps('rf')
},
```

- [ ] **Step 5: Update property schema filtering**

In `src/services/propertyPanelSchema.js`, import:

```js
import {
  SIGNAL_DOMAINS,
  normalizeSignalSourceProps
} from './signalSourceDomainService.js';
```

Replace the current `signal_source` schema with common and domain-specific groups:

```js
signal_source: {
  type: 'signal_source',
  groups: [
    {
      label: '信号定义',
      fields: [
        { key: 'name', label: '模块名称', type: 'text', fallback: '信号源' },
        { key: 'signalDomain', label: '信号域', type: 'select', options: SIGNAL_DOMAINS, fallback: 'analog', row: 'signal-domain' },
        { key: 'signalName', label: '信号名称', type: 'text', fallback: '', row: 'signal-id' },
        { key: 'signalId', label: '信号 ID', type: 'text', fallback: '', row: 'signal-id' },
        { key: 'unit', label: '单位', type: 'text', fallback: '', row: 'signal-meta' },
        { key: 'description', label: '说明', type: 'text', fallback: '', row: 'signal-meta' }
      ]
    },
    {
      label: '数字信号配置',
      domains: ['digital'],
      fields: [
        { key: 'digitalMode', label: '数字模式', type: 'select', options: ['boolean', 'level', 'pulse', 'enum'], fallback: 'boolean', row: 'digital-mode' },
        { key: 'initialState', label: '初始状态', type: 'text', fallback: '0', row: 'digital-mode' },
        { key: 'highLevel', label: '高电平', type: 'text', fallback: '1', row: 'digital-level' },
        { key: 'lowLevel', label: '低电平', type: 'text', fallback: '0', row: 'digital-level' },
        { key: 'pulseWidth', label: '脉宽', type: 'text', fallback: '', row: 'digital-pulse' },
        { key: 'period', label: '周期', type: 'text', fallback: '', row: 'digital-pulse' },
        { key: 'dutyCycle', label: '占空比', type: 'text', fallback: '', row: 'digital-duty' },
        { key: 'enumValues', label: '枚举值', type: 'text', fallback: '', row: 'digital-duty' }
      ]
    },
    {
      label: '指令信号配置',
      domains: ['command'],
      fields: [
        { key: 'commandType', label: '指令类型', type: 'select', options: ['control', 'bus-message', 'task', 'mode'], fallback: 'control', row: 'command-type' },
        { key: 'commandName', label: '指令名称', type: 'text', fallback: '', row: 'command-type' },
        { key: 'protocol', label: '协议', type: 'text', fallback: 'CAN', row: 'command-protocol' },
        { key: 'messageId', label: '报文 ID', type: 'text', fallback: '', row: 'command-protocol' },
        { key: 'payloadKind', label: '载荷类型', type: 'text', fallback: 'float32', row: 'command-payload' },
        { key: 'payloadValue', label: '载荷数值', type: 'text', fallback: '', row: 'command-payload' },
        { key: 'payloadSchema', label: '载荷结构', type: 'text', fallback: '', row: 'command-schema' },
        { key: 'sendPeriod', label: '发送周期', type: 'text', fallback: '', row: 'command-timing' },
        { key: 'triggerCondition', label: '触发条件', type: 'text', fallback: '', row: 'command-timing' }
      ]
    },
    {
      label: '模拟信号配置',
      domains: ['analog'],
      fields: [
        { key: 'analogKind', label: '模拟类型', type: 'select', options: ['voltage', 'current', 'sensor', 'control', 'generic'], fallback: 'generic', row: 'analog-kind' },
        { key: 'waveType', label: '波形', type: 'select', options: ['正弦', '阶跃', '常值', 'sine', 'step', 'constant', 'ramp', 'noise'], fallback: '正弦', row: 'analog-kind' },
        { key: 'outputFormat', label: '输出格式', type: 'select', options: PORT_FORMATS, fallback: '标量', row: 'analog-format' },
        { key: 'amplitude', label: '幅值', type: 'text', fallback: '1.0', row: 'analog-basic' },
        { key: 'frequency', label: '频率 / 周期', type: 'text', fallback: '1.0', row: 'analog-basic' },
        { key: 'phase', label: '相位', type: 'text', fallback: '0', row: 'analog-phase' },
        { key: 'offset', label: '偏置', type: 'text', fallback: '0', row: 'analog-phase' },
        { key: 'sampleRate', label: '采样率', type: 'text', fallback: '', row: 'analog-rate' },
        { key: 'minValue', label: '下限', type: 'text', fallback: '', row: 'analog-limit' },
        { key: 'maxValue', label: '上限', type: 'text', fallback: '', row: 'analog-limit' }
      ]
    },
    {
      label: '射频信号配置',
      domains: ['rf'],
      fields: [
        { key: 'rfKind', label: '射频类型', type: 'select', options: ['communication', 'radar', 'navigation', 'jamming', 'generic'], fallback: 'communication', row: 'rf-kind' },
        { key: 'centerFrequency', label: '中心频率', type: 'text', fallback: '', row: 'rf-frequency' },
        { key: 'bandwidth', label: '带宽', type: 'text', fallback: '', row: 'rf-frequency' },
        { key: 'power', label: '功率', type: 'text', fallback: '', row: 'rf-power' },
        { key: 'powerUnit', label: '功率单位', type: 'select', options: ['dBm', 'W', 'mW'], fallback: 'dBm', row: 'rf-power' },
        { key: 'modulation', label: '调制方式', type: 'text', fallback: '', row: 'rf-modulation' },
        { key: 'phase', label: '相位', type: 'text', fallback: '', row: 'rf-modulation' },
        { key: 'snr', label: '信噪比', type: 'text', fallback: '', row: 'rf-quality' },
        { key: 'sampleRate', label: '采样率', type: 'text', fallback: '', row: 'rf-quality' },
        { key: 'pulseWidth', label: '脉宽', type: 'text', fallback: '', row: 'rf-pulse' },
        { key: 'prf', label: 'PRF', type: 'text', fallback: '', row: 'rf-pulse' },
        { key: 'channel', label: '信道', type: 'text', fallback: '', row: 'rf-extra' },
        { key: 'polarization', label: '极化', type: 'text', fallback: '', row: 'rf-extra' },
        { key: 'rfProfile', label: 'RF 配置', type: 'text', fallback: '', row: 'rf-profile' }
      ]
    }
  ]
}
```

Update `buildSelectOptions()` so option objects work:

```js
const optionValue = typeof option === 'object' ? String(option.value) : String(option);
const optionLabel = typeof option === 'object' ? String(option.label) : optionValue;
```

Update `renderPropertyFieldsFromSchema()` to normalize signal source props and filter groups:

```js
const nodeForRender = schema.type === 'signal_source'
  ? { ...node, props: normalizeSignalSourceProps(node?.props ?? {}) }
  : node;
const domain = nodeForRender?.props?.signalDomain;
return schema.groups
  .filter((group) => !group.domains || group.domains.includes(domain))
  .map((group) => ...)
```

Update `readPropertyValuesFromSchema()` to read only fields that exist in the DOM, then normalize when `schema.type === 'signal_source'`:

```js
return schema.type === 'signal_source' ? normalizeSignalSourceProps(values) : values;
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```powershell
npm test -- --run tests/component-registry.spec.js tests/property-panel-schema.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/services/componentRegistry.js src/services/propertyPanelSchema.js tests/component-registry.spec.js tests/property-panel-schema.spec.js
git commit -m "feat: expose signal source domains in schema"
```

Expected: commit only the registry/schema changes and tests.

---

### Task 3: Model Normalization and Backend Executable Packaging

**Files:**
- Modify: `src/services/modelStore.js`
- Modify: `src/services/backendExecutablePackageService.js`
- Modify: `tests/flight-model-package.spec.js`
- Modify: `tests/backend-executable-package-service.spec.js`

- [ ] **Step 1: Write failing model normalization test**

Add this test to `tests/flight-model-package.spec.js` near existing signal source package tests:

```js
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
```

- [ ] **Step 2: Write failing executable package test**

Add to `tests/backend-executable-package-service.spec.js`:

```js
it('exports numeric scalar fallbacks for all signal source domains', () => {
  const pkg = buildBackendExecutablePackage({
    modelNodes: [
      { id: 'analog', type: 'signal_source', props: { signalDomain: 'analog', amplitude: '1.5' } },
      { id: 'digital', type: 'signal_source', props: { signalDomain: 'digital', initialState: '1' } },
      { id: 'command', type: 'signal_source', props: { signalDomain: 'command', payloadValue: '7' } },
      { id: 'rf', type: 'signal_source', props: { signalDomain: 'rf', power: '10' } }
    ],
    modelEdges: []
  });

  expect(pkg.nodes).toEqual([
    expect.objectContaining({ id: 'analog', parameters: expect.objectContaining({ amplitude: 1.5, value: 1.5 }) }),
    expect.objectContaining({ id: 'digital', parameters: expect.objectContaining({ initialState: 1, value: 1 }) }),
    expect.objectContaining({ id: 'command', parameters: expect.objectContaining({ payloadValue: 7, value: 7 }) }),
    expect.objectContaining({ id: 'rf', parameters: expect.objectContaining({ power: 10, value: 10 }) })
  ]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```powershell
npm test -- --run tests/flight-model-package.spec.js tests/backend-executable-package-service.spec.js
```

Expected: FAIL because model normalization does not yet apply `signalDomain`, and executable package nodes do not add `value` fallbacks.

- [ ] **Step 4: Normalize model store signal sources**

In `src/services/modelStore.js`, import:

```js
import { normalizeSignalSourceProps } from './signalSourceDomainService.js';
```

At the start of `normalizeModelNode()`, after `safeNode` is created, add:

```js
if (safeNode.type === 'signal_source') {
  safeNode.props = normalizeSignalSourceProps(safeNode.props ?? {});
}
```

- [ ] **Step 5: Add executable package fallback value**

In `src/services/backendExecutablePackageService.js`, import:

```js
import {
  getSignalSourceScalarFallback,
  normalizeSignalSourceProps
} from './signalSourceDomainService.js';
```

Change `normalizeNode()` so signal source props are normalized before numeric extraction:

```js
function normalizeNode(node) {
  const props = node.type === 'signal_source'
    ? normalizeSignalSourceProps(node.props ?? node.parameters ?? {})
    : (node.props ?? node.parameters ?? {});
  const parameters = pickNumericParameters(props);
  if (node.type === 'signal_source') {
    parameters.value = getSignalSourceScalarFallback(props);
  }
  const normalized = {
    id: String(node.id),
    type: node.type,
    parameters,
    inputs: normalizePorts(node.inputs ?? node.props?.inputs),
    outputs: normalizePorts(node.outputs ?? node.props?.outputs)
  };
  ...
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```powershell
npm test -- --run tests/flight-model-package.spec.js tests/backend-executable-package-service.spec.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/services/modelStore.js src/services/backendExecutablePackageService.js tests/flight-model-package.spec.js tests/backend-executable-package-service.spec.js
git commit -m "feat: normalize signal source domains for packages"
```

Expected: commit only model/executable packaging changes and tests.

---

### Task 4: Backend Runtime Scalar Fallback

**Files:**
- Modify: `backend/simulation_engine.py`
- Modify: `backend/tests/test_simulation_engine.py`

- [ ] **Step 1: Write failing backend simulation test**

Add to `backend/tests/test_simulation_engine.py`:

```python
    def test_signal_source_domain_scalar_fallbacks(self):
        package = {
            "schemaVersion": 1,
            "packageId": "signal-domain-package",
            "simulationConfig": {"duration": 0.1, "stepSize": 0.1},
            "nodes": [
                {"id": "analog", "type": "signal_source", "parameters": {"amplitude": 1.5}, "outputs": [{"name": "out"}]},
                {"id": "digital", "type": "signal_source", "parameters": {"initialState": 1}, "outputs": [{"name": "out"}]},
                {"id": "command", "type": "signal_source", "parameters": {"payloadValue": 7}, "outputs": [{"name": "out"}]},
                {"id": "rf", "type": "signal_source", "parameters": {"power": 10}, "outputs": [{"name": "out"}]},
                {"id": "scope-1", "type": "instrument_scope", "inputs": [{"name": "CH1"}, {"name": "CH2"}, {"name": "CH3"}, {"name": "CH4"}]},
            ],
            "edges": [
                {"id": "edge-analog", "sourceNodeId": "analog", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 0},
                {"id": "edge-digital", "sourceNodeId": "digital", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 1},
                {"id": "edge-command", "sourceNodeId": "command", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 2},
                {"id": "edge-rf", "sourceNodeId": "rf", "sourcePortIndex": 0, "targetNodeId": "scope-1", "targetPortIndex": 3},
            ],
            "faultInstances": [],
            "measurementPoints": [
                {"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"},
                {"id": "scope-1.ch2", "scopeNodeId": "scope-1", "channel": "ch2"},
                {"id": "scope-1.ch3", "scopeNodeId": "scope-1", "channel": "ch3"},
                {"id": "scope-1.ch4", "scopeNodeId": "scope-1", "channel": "ch4"},
            ],
        }

        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        result = run_simulation(graph)

        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch1.actual"], [1.5])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch2.actual"], [1.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch3.actual"], [7.0])
        self.assertFloatSeriesEqual(result["curves"]["channels"]["scope-1.ch4.actual"], [10.0])
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest backend.tests.test_simulation_engine -v
```

Expected: FAIL because `_source_value()` does not read `initialState`, `payloadValue`, or `power`.

- [ ] **Step 3: Update backend source fallback**

Replace `_source_value()` in `backend/simulation_engine.py` with:

```python
def _first_numeric(params, keys, fallback=0.0):
    for key in keys:
        if key in params:
            return float(params[key])
    return float(fallback)


def _source_value(node, time):
    params = node.parameters
    return _first_numeric(
        params,
        ("value", "amplitude", "initialState", "payloadValue", "commandValue", "power"),
        0.0,
    )
```

- [ ] **Step 4: Run backend tests**

Run:

```powershell
python -m unittest backend.tests.test_simulation_engine -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/simulation_engine.py backend/tests/test_simulation_engine.py
git commit -m "feat: support signal source scalar fallbacks"
```

Expected: commit only backend runtime files.

---

### Task 5: Legacy Runtime Integration and App Tests

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `tests/property-panel-app.spec.js`
- Modify as needed: `tests/left-palette-taxonomy.spec.js`

- [ ] **Step 1: Write failing app-level tests**

Add to `tests/property-panel-app.spec.js`:

```js
it('creates domain-specific signal source templates through the legacy runtime', () => {
  window.createNode('signal_source_digital', 180, 220);
  window.createNode('signal_source_command', 360, 220);
  window.createNode('signal_source_rf', 540, 220);

  const sources = window.__GZ_STATE__.modelNodes.filter((node) => node.type === 'signal_source');

  expect(sources.map((node) => node.props.signalDomain)).toEqual(['digital', 'command', 'rf']);
  expect(sources.map((node) => node.props.name)).toEqual([
    '数字信号源 1',
    '指令信号源 2',
    '射频信号源 3'
  ]);
});

it('renders and saves RF signal source fields through the legacy property panel', async () => {
  const source = window.createNode('signal_source_rf', 220, 220);
  window.selectNode(source.id);
  window.renderPropertyPanel(source);

  expect(document.getElementById('prop-signalDomain').value).toBe('rf');
  expect(document.getElementById('prop-centerFrequency')).not.toBeNull();
  expect(document.getElementById('prop-waveType')).toBeNull();

  document.getElementById('prop-name').value = 'RF Test Source';
  document.getElementById('prop-centerFrequency').value = '5.8GHz';
  document.getElementById('prop-bandwidth').value = '40MHz';
  document.getElementById('prop-power').value = '12';
  document.querySelector('[data-property-save-node]').click();

  expect(source.props).toMatchObject({
    name: 'RF Test Source',
    signalDomain: 'rf',
    centerFrequency: '5.8GHz',
    bandwidth: '40MHz',
    power: '12',
    powerUnit: 'dBm'
  });
});
```

If `tests/left-palette-taxonomy.spec.js` asserts only one `[data-component="signal_source"]`, update it to expect the four signal source component keys:

```js
expect(signalGroup.components.map((item) => item.type)).toEqual([
  'signal_source',
  'signal_source_digital',
  'signal_source_command',
  'signal_source_rf',
  'middle_var_assign'
]);
```

- [ ] **Step 2: Run app tests to verify they fail**

Run:

```powershell
npm test -- --run tests/property-panel-app.spec.js tests/left-palette-taxonomy.spec.js
```

Expected: FAIL because the legacy runtime still names all sources generically and only renders old signal source fields.

- [ ] **Step 3: Synchronize legacy runtime helper usage**

In `src/services/legacy-runtime.txt`, near the existing schema helper functions, add:

```js
function signalSourceApi(){
  return window.__GZ_SIGNAL_SOURCE_DOMAIN__;
}

function normalizeSignalSourcePropsRuntime(props){
  const api=signalSourceApi();
  return api?.normalizeSignalSourceProps
    ?api.normalizeSignalSourceProps(props||{})
    :{signalDomain:'analog',name:'信号源',waveType:'正弦',amplitude:'1.0',frequency:'1.0',outputFormat:'标量',...(props||{})};
}

function summarizeSignalSourceRuntime(node){
  const api=signalSourceApi();
  if(api?.summarizeSignalSource){return api.summarizeSignalSource(node);}
  const props=normalizeSignalSourcePropsRuntime(node?.props||{});
  return `${props.waveType||'信号'} · 幅值 ${props.amplitude||'1'} · ${props.outputFormat||'标量'}`;
}
```

In `src/services/legacyRuntimeBootstrap.js`, expose the service before `window.eval(...)`:

```js
import * as signalSourceDomainService from './signalSourceDomainService.js';
...
window.__GZ_SIGNAL_SOURCE_DOMAIN__ = signalSourceDomainService;
```

And delete it in `__resetLegacyRuntimeForTests()`:

```js
delete window.__GZ_SIGNAL_SOURCE_DOMAIN__;
```

- [ ] **Step 4: Update legacy node naming and normalization**

In `createNode()` inside `src/services/legacy-runtime.txt`, replace:

```js
else if(nodeType==='signal_source'){props.name=`信号源 ${count}`;}
```

with:

```js
else if(nodeType==='signal_source'){
  const baseName=meta.defaults?.name||meta.label||'信号源';
  props.name=`${baseName} ${count}`;
  Object.assign(props,normalizeSignalSourcePropsRuntime(props));
}
```

- [ ] **Step 5: Update legacy subtitle overrides**

In the final `buildNodeSubtitle` override near the end of `src/services/legacy-runtime.txt`, replace the `signal_source` case with:

```js
case 'signal_source':
  return summarizeSignalSourceRuntime(node);
```

Also update earlier `buildNodeSubtitle` overrides only if app tests show the final override is not reached in the relevant test path.

- [ ] **Step 6: Ensure schema saving normalizes signal source props**

In `applySchemaPropertyValues(node)` inside `src/services/legacy-runtime.txt`, after merging schema values:

```js
node.props={...(node.props||{}),...values};
```

add:

```js
if(node.type==='signal_source'){
  node.props=normalizeSignalSourcePropsRuntime(node.props);
}
```

- [ ] **Step 7: Run app tests**

Run:

```powershell
npm test -- --run tests/property-panel-app.spec.js tests/left-palette-taxonomy.spec.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/services/legacy-runtime.txt src/services/legacyRuntimeBootstrap.js tests/property-panel-app.spec.js tests/left-palette-taxonomy.spec.js
git commit -m "feat: wire signal domains into legacy runtime"
```

Expected: commit the legacy runtime integration and app tests. If `tests/left-palette-taxonomy.spec.js` did not need changes, do not add it.

---

### Task 6: Final Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run focused frontend tests**

Run:

```powershell
npm test -- --run tests/signal-source-domain-service.spec.js tests/component-registry.spec.js tests/property-panel-schema.spec.js tests/backend-executable-package-service.spec.js tests/flight-model-package.spec.js tests/property-panel-app.spec.js tests/left-palette-taxonomy.spec.js
```

Expected: PASS.

- [ ] **Step 2: Run focused backend tests**

Run:

```powershell
python -m unittest backend.tests.test_simulation_engine -v
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: PASS and Vite build completes without syntax errors.

- [ ] **Step 4: Inspect final worktree**

Run:

```powershell
git status --short
```

Expected: only pre-existing unrelated dirty files remain, or no output if those were handled separately. Do not revert unrelated dirty files.

- [ ] **Step 5: Final commit if needed**

If Task 6 required any small fixes, commit them:

```powershell
git add <only-files-changed-for-signal-source-domain>
git commit -m "test: verify signal source domains"
```

Expected: no unrelated files are included.

---

## Self-Review Notes

- Spec coverage: the plan covers unified `signal_source`, four palette templates, domain-specific properties, old-model analog normalization, RF engineering parameters, backend scalar tolerance, app-level legacy runtime integration, and focused tests.
- Explicitly out of scope: no fault binding logic, no RF IQ payload, no modulation/demodulation, no strict connection validation.
- Type consistency: `signalDomain` values are `digital`, `command`, `analog`, and `rf`. User-facing labels are Chinese. Created nodes remain `type: 'signal_source'`; new palette entries use registry keys `signal_source_digital`, `signal_source_command`, and `signal_source_rf` with `nodeType: 'signal_source'`.
