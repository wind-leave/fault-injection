import { describe, expect, it } from 'vitest';
import { DISPLAY_CONSOLE_PRESETS, createDisplayConsoleConfig } from '../src/constants/displayConsoleConfig.js';

describe('display console control configuration', () => {
  it('exposes only the declared RF source parameters on display console 1', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_1);

    expect(config.controls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentType: 'rf_four_channel_source',
        parameterKeys: ['center_frequency_hz', 'pulse_width_seconds', 'pulse_period_seconds']
      })
    ]));
    expect(config.controls.flatMap((control) => control.parameterKeys)).not.toContain('sample_1');
  });

  it('limits display console 2 to the selected downconverter parameters', () => {
    const config = createDisplayConsoleConfig(DISPLAY_CONSOLE_PRESETS.display_console_2);

    expect(config.controls).toEqual([
      expect.objectContaining({
        componentType: 'rf_downconverter',
        parameterKeys: ['input_mode', 'lo_frequency_hz', 'lo_phase_deg', 'conversion_gain', 'low_pass_cutoff_hz']
      })
    ]);
  });
});
