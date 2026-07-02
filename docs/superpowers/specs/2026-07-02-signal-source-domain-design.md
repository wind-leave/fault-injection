# Signal Source Domain Design

## Goal

Extend the fault injection platform so one signal source can represent four required signal families:

- discrete digital signals
- discrete command/protocol signals
- continuous analog signals
- RF signals represented at engineering-parameter level

The first implementation stage focuses on model expression, UI configuration, saved model compatibility, and backend tolerance. It does not implement full RF waveform simulation, IQ data, modulation/demodulation, or fault binding changes.

## Current Context

The platform currently exposes a `signal_source` component in the system modeling palette. Its property schema supports a small waveform-oriented configuration with signal type, output format, amplitude, and frequency. The current backend executable graph also recognizes `signal_source`, but `_source_value()` only emits `value` or `amplitude` as a numeric scalar.

The main closed-loop demo already contains ordinary `normal` signal links and `can` protocol links. CAN edges can carry metadata such as `signalId`, `channelId`, `messageId`, `payloadKind`, and `signalChannels`. Those existing edge concepts are useful for command/protocol signals, but this design does not change fault binding in the first stage.

## Recommended Approach

Use a single underlying node type with four signal-domain templates.

The saved node type remains:

```js
type: 'signal_source'
```

Each signal source gets a domain field:

```js
props.signalDomain = 'digital' | 'command' | 'analog' | 'rf'
```

The palette may show four user-facing entries, but each entry creates a `signal_source` node with different default properties:

- Digital signal source
- Command signal source
- Analog signal source
- RF signal source

This preserves compatibility with existing model packages, frontend services, and backend node validation while making the user-facing modeling language match the new requirement.

## Signal Domains

### Digital Signals

Digital signals represent discrete states such as Boolean values, high/low levels, switch states, status bits, pulses, and enumerations.

Suggested fields:

```js
{
  signalDomain: 'digital',
  digitalMode: 'boolean' | 'level' | 'pulse' | 'enum',
  initialState: '0',
  highLevel: '1',
  lowLevel: '0',
  pulseWidth: '',
  period: '',
  dutyCycle: '',
  enumValues: ''
}
```

### Command Signals

Command signals represent semantically meaningful discrete commands, protocol messages, bus frames, control words, and task commands.

Suggested fields:

```js
{
  signalDomain: 'command',
  commandType: 'control' | 'bus-message' | 'task' | 'mode',
  commandName: '',
  protocol: 'CAN',
  messageId: '',
  payloadKind: 'float32',
  payloadSchema: '',
  sendPeriod: '',
  triggerCondition: ''
}
```

These fields align with current CAN edge metadata but do not require a command source to be connected through a CAN edge in the first stage.

### Analog Signals

Analog signals represent continuous numeric quantities such as voltage, current, sensor values, control values, and ordinary waveform signals.

Suggested fields:

```js
{
  signalDomain: 'analog',
  analogKind: 'voltage' | 'current' | 'sensor' | 'control' | 'generic',
  waveType: 'sine' | 'step' | 'constant' | 'ramp' | 'noise',
  amplitude: '1.0',
  frequency: '1.0',
  phase: '0',
  offset: '0',
  sampleRate: '',
  minValue: '',
  maxValue: '',
  unit: 'V'
}
```

Existing `waveType`, `amplitude`, `frequency`, and `outputFormat` fields remain valid for old models.

### RF Signals

RF signals are represented as engineering parameters rather than raw sampled waveforms.

Suggested fields:

```js
{
  signalDomain: 'rf',
  rfKind: 'communication' | 'radar' | 'navigation' | 'jamming' | 'generic',
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
  rfProfile: ''
}
```

The first stage stores and displays these parameters only. `rfProfile` is a reserved text or JSON field for richer RF configuration later.

## UI Design

The system signal palette should present four entries under the same signal group:

- Digital signal source
- Command signal source
- Analog signal source
- RF signal source

Dragging any of them creates a `signal_source` node. The palette entry controls only the default `props.signalDomain` and domain-specific defaults.

The right property panel should render signal source fields in two parts:

1. Common fields:
   - name
   - signal domain
   - signal name
   - signal ID
   - unit
   - description
2. Domain-specific fields:
   - digital mode, state, pulse, and enum fields for digital signals
   - command type, protocol, message ID, payload type, and send timing for command signals
   - waveform, amplitude, frequency, phase, offset, limits, and sample rate for analog signals
   - center frequency, bandwidth, power, modulation, phase, SNR, and pulse parameters for RF signals

When the user changes `signalDomain`, the UI should keep common fields, add defaults for the new domain, and avoid deleting fields from the previous domain. This prevents accidental data loss if the user switches domains and then switches back.

Canvas summaries should use the signal domain to make nodes easy to distinguish:

- `Digital · pulse · period 20 ms`
- `Command · CAN · 0x120 · float32`
- `Analog · sine · 1.0 V · 10 Hz`
- `RF · 2.4 GHz · 20 MHz · QPSK`

## Model Compatibility

Model packages continue storing signal sources in `workbenchSnapshot.modelNodes`.

New signal sources store domain data in `props`:

```js
{
  id: 'node-rf-source',
  type: 'signal_source',
  props: {
    name: 'RF Signal Source',
    signalDomain: 'rf',
    centerFrequency: '2.4GHz',
    bandwidth: '20MHz',
    power: '10',
    powerUnit: 'dBm',
    modulation: 'QPSK'
  }
}
```

Compatibility rules:

- If a `signal_source` lacks `props.signalDomain`, normalize it as `analog`.
- Preserve old `waveType`, `amplitude`, `frequency`, and `outputFormat` fields.
- Do not require migration of all historical model packages before this feature can work.

## Frontend Service Boundaries

Add or centralize helpers for signal source configuration:

```js
createSignalSourceProps(domain)
normalizeSignalSourceProps(props)
summarizeSignalSource(node)
```

These helpers should be used by the component registry, property panel, canvas summary rendering, and model package loading code. This keeps signal-domain branching out of unrelated UI code.

## Backend Compatibility

The first stage does not require full execution semantics for every signal family. The backend should continue accepting `signal_source` and avoid failing on the new domain fields.

Recommended tolerant behavior:

- `analog`: emit numeric `value` or `amplitude`, as today.
- `digital`: emit numeric `initialState` when possible, otherwise `0`.
- `command`: emit numeric `commandValue` or `payloadValue` when present, otherwise `0`.
- `rf`: emit numeric `power` when present, otherwise `0`.

The backend should not claim to simulate RF waveforms or command protocols in this stage. It only provides a stable scalar fallback so existing simulation flows do not break.

## Out Of Scope

The first stage does not include:

- RF IQ payloads or sampled waveform data
- modulation/demodulation simulation
- frequency-domain simulation output
- new fault binding logic
- protocol fault changes
- strict connection validation between signal domains and line types

## Test Plan

Add focused tests for:

- the palette exposing four signal-source entries
- all four entries creating `type: 'signal_source'`
- each entry setting the expected `props.signalDomain`
- the property panel showing common fields plus the selected domain fields
- switching signal domains preserving common fields
- old signal source nodes without `signalDomain` normalizing to `analog`
- backend simulation accepting signal sources from all four domains without unsupported-node errors

## Implementation Notes

The implementation should avoid broad refactors. It should update the existing signal source registry, property schema, summary generation, package normalization, and backend scalar fallback in small, testable units.

Dirty worktree files unrelated to this feature should be left untouched.
