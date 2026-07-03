# Fixed Signal Source Parameter Panel Design

## Goal

Make each signal source created from the left palette keep its original signal family. A user who drags an analog signal source should get an analog signal source, not a generic source that can later be changed to digital, command, or RF from the right inspector.

## Required Behavior

- The palette entries remain separate user-facing components: analog, digital, command, and RF signal source.
- All four entries still create the same saved node type, `signal_source`, for compatibility.
- The created node keeps its fixed `props.signalDomain` from the palette entry.
- The right inspector must not expose `signalDomain` as an editable select field.
- The "signal definition" and domain-specific "signal configuration" groups appear only in the parameter configuration view.
- These signal source groups do not appear in the general properties view.

## UI Structure

The general properties view should be reserved for non-parameter inspection and actions such as identity summary, connection context, fault binding status, and deletion actions already supported by the inspector.

The parameter configuration view should contain:

- Signal definition: module name, signal name, signal ID, unit, and description.
- Domain-specific configuration:
  - analog: waveform, output format, amplitude, frequency, phase, offset, sample rate, limits.
  - digital: digital mode, initial state, levels, pulse settings, enum values.
  - command: command type, command name, protocol, message ID, payload fields, send period, trigger condition.
  - RF: RF kind, center frequency, bandwidth, power, modulation, phase, SNR, sample rate, pulse fields, channel, polarization, RF profile.

The signal domain may be shown as read-only only if needed for diagnostics, but it must not be an editable control.

## Data Model

The data model remains compatible with the previous signal-domain implementation:

```js
{
  type: 'signal_source',
  props: {
    signalDomain: 'analog' | 'digital' | 'command' | 'rf'
  }
}
```

Old signal sources that do not have `props.signalDomain` continue to normalize to `analog`.

Saving parameter configuration must merge visible parameter fields into `node.props` without deleting hidden fields from other domains. This preserves existing model data and avoids accidental loss during future migrations.

## Implementation Scope

- Update the signal source property schema so `signalDomain` is not rendered as an editable field.
- Route signal source definition/configuration rendering to the parameter configuration tab only.
- Keep palette creation behavior based on registry defaults.
- Keep backend scalar fallback behavior unchanged.
- Add regression tests for fixed-domain creation and parameter-tab-only rendering.

## Out Of Scope

- Full RF waveform simulation.
- Protocol frame execution.
- New fault binding rules.
- Strict connection validation between signal domains and line types.
- Migrating existing saved packages beyond current normalization.

## Test Plan

- Unit test: signal source schema no longer renders an editable `prop-signalDomain` control.
- App test: analog, digital, command, and RF palette entries still create `type: 'signal_source'` with the expected fixed `props.signalDomain`.
- App test: signal definition and domain-specific configuration are present in parameter configuration and absent from the general properties tab.
- Regression test: old signal source nodes without `signalDomain` still normalize to analog.
