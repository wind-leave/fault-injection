"""Two-input RF down-converter with selectable scalar I/Q outputs."""

import math

from backend.simulation_functions import downconvert_rf_signal, low_pass_rf_filter


def process(
    rf_input=0.0,
    rf_input_2=0.0,
    input_mode=1,
    lo_frequency_hz=990_000_000.0,
    lo_phase_deg=0.0,
    conversion_gain=1.0,
    low_pass_cutoff_hz=20_000_000.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Down-convert the input selected by ``input_mode`` to scalar I/Q.

    Mode 1 selects ``rf_input``; mode 2 selects ``rf_input_2``.  Each input
    retains its own low-pass history so switching modes does not carry a
    filtered sample from the other signal into the newly selected output.
    """
    previous = dict(state or {})
    selected_mode = 2 if int(float(input_mode)) == 2 else 1
    state_prefix = "input_2" if selected_mode == 2 else "input_1"
    selected_input = rf_input_2 if selected_mode == 2 else rf_input
    previous_output_iq = (
        previous.get(f"{state_prefix}_i", previous.get("i", 0.0) if selected_mode == 1 else 0.0),
        previous.get(f"{state_prefix}_q", previous.get("q", 0.0) if selected_mode == 1 else 0.0),
    )
    rf_descriptor = previous.get("rf_input_descriptor")
    if isinstance(rf_descriptor, dict):
        # The simulation engine provides this descriptor when the input is an
        # RF signal source.  Mixing its phasor avoids aliasing a GHz carrier
        # to zero at a millisecond-scale interactive simulation step.
        frequency_hz = float(rf_descriptor.get("frequency_hz", 0.0))
        amplitude = float(rf_descriptor.get("amplitude", 0.0))
        source_phase_rad = float(rf_descriptor.get("phase_rad", 0.0))
        phase = (
            2.0 * math.pi * (frequency_hz - float(lo_frequency_hz)) * float(time)
            + source_phase_rad
            - math.radians(float(lo_phase_deg))
        )
        output_i = float(conversion_gain) * amplitude * math.cos(phase)
        output_q = float(conversion_gain) * amplitude * math.sin(phase)
        if float(low_pass_cutoff_hz) > 0.0:
            output_i = low_pass_rf_filter(output_i, previous_output_iq[0], low_pass_cutoff_hz, dt)
            output_q = low_pass_rf_filter(output_q, previous_output_iq[1], low_pass_cutoff_hz, dt)
    else:
        output_i, output_q = downconvert_rf_signal(
            selected_input,
            lo_frequency_hz=lo_frequency_hz,
            lo_phase_deg=lo_phase_deg,
            conversion_gain=conversion_gain,
            time=time,
            previous_output_iq=previous_output_iq,
            low_pass_cutoff_hz=low_pass_cutoff_hz if float(low_pass_cutoff_hz) > 0.0 else None,
            dt=dt,
        )
    return {
        "outputs": {
            "if_i": output_i,
            "if_q": output_q,
        },
        "state": {
            **previous,
            f"{state_prefix}_i": output_i,
            f"{state_prefix}_q": output_q,
            "i": output_i,
            "q": output_q,
            "selected_mode": selected_mode,
        },
    }
