"""Pulse-feature extraction from the first active route of a four-route RF envelope."""

from backend.simulation_functions import coerce_envelope_vector
from backend.simulation_functions import extract_complex_envelope_pulse_features


def process(
    input_envelope_vector,
    fft_size=1024.0,
    adc_full_scale=1.0,
    envelope_threshold_adc=12.0,
    envelope_smoothing=1.0,
    time=0.0,
    dt=0.0,
    state=None,
):
    """Extract features from the first non-zero route, in route order 1 through 4.

    A route is zero only when both its I and Q components are zero. If all
    routes are zero, route 4 is used so the extractor still receives a
    well-formed zero sample and its RF context.
    """
    envelopes = coerce_envelope_vector(input_envelope_vector, length=4)
    return extract_complex_envelope_pulse_features(
        envelopes,
        fft_size,
        adc_full_scale,
        envelope_threshold_adc,
        envelope_smoothing,
        time,
        dt,
        state,
    )
