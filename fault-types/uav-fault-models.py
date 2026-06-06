"""Reusable UAV flight-control fault models for the GZ fault platform.

The functions in this file are intentionally small and dependency-free so they
can be copied into Python-bound simulation blocks or used by a backend fault
runtime. Each function returns a numeric signal after applying one fault model.
Stateful faults receive a FaultRuntimeState instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import sin
from random import Random
from typing import Callable, Dict, Iterable, List, MutableMapping, Sequence


Number = float | int


@dataclass
class FaultRuntimeState:
    """Mutable state shared by delay, freeze, burst-loss, and colored-noise faults."""

    previous_value: float = 0.0
    previous_noise: float = 0.0
    hold_value: float = 0.0
    delay_queue: List[float] = field(default_factory=list)
    burst_remaining: int = 0
    sample_index: int = 0


def is_active(t: float, start: float = 0.0, duration: float | None = None) -> bool:
    """Return whether a fault should be active at time t."""

    if t < start:
        return False
    if duration is None:
        return True
    return t <= start + duration


def ramp_factor(t: float, start: float, rise_time: float) -> float:
    """Linear 0..1 ramp used by gradual drift and degradation faults."""

    if rise_time <= 0:
        return 1.0 if t >= start else 0.0
    return min(max((t - start) / rise_time, 0.0), 1.0)


def parameter_bias(value: float, offset: float) -> float:
    """Add a constant parameter or signal bias: y = x + b."""

    return value + offset


def parameter_scale(value: float, scale: float) -> float:
    """Apply multiplicative distortion: y = k x."""

    return value * scale


def parameter_drift(value: float, t: float, rate: float = 0.0, start: float = 0.0) -> float:
    """Add a time-growing drift after start: y = x + rate * (t - start)."""

    return value + max(t - start, 0.0) * rate


def parameter_step(value: float, t: float, step_value: float, start: float = 0.0) -> float:
    """Apply an abrupt step after start."""

    return value + (step_value if t >= start else 0.0)


def actuator_lock(command: float, lock_value: float = 0.0) -> float:
    """Force an actuator command to a fixed value."""

    return lock_value


def saturation_limit(value: float, lower: float | None = None, upper: float | None = None) -> float:
    """Clamp a signal to a lower and/or upper bound."""

    if lower is not None:
        value = max(value, lower)
    if upper is not None:
        value = min(value, upper)
    return value


def gaussian_noise(value: float, std: float, rng: Random) -> float:
    """Add zero-mean Gaussian noise."""

    return value + rng.gauss(0.0, std)


def white_noise(value: float, amplitude: float, rng: Random) -> float:
    """Add bounded white noise."""

    return value + rng.uniform(-amplitude, amplitude)


def colored_noise(value: float, alpha: float, std: float, state: FaultRuntimeState, rng: Random) -> float:
    """Add AR(1)-style colored noise: n[k] = alpha n[k-1] + e[k]."""

    alpha = min(max(alpha, 0.0), 0.999)
    state.previous_noise = alpha * state.previous_noise + rng.gauss(0.0, std)
    return value + state.previous_noise


def pulse_noise(value: float, amplitude: float, probability: float, rng: Random) -> float:
    """Inject a sparse impulse noise event."""

    probability = min(max(probability, 0.0), 1.0)
    if rng.random() <= probability:
        return value + rng.choice([-1.0, 1.0]) * amplitude
    return value


def signal_freeze(value: float, state: FaultRuntimeState, enable: bool = True) -> float:
    """Hold the previous value while enable is true."""

    if enable:
        return state.hold_value
    state.hold_value = value
    return value


def state_jump(value: float, jump: float = 0.0) -> float:
    """Abrupt state jump."""

    return value + jump


def sign_flip(value: float) -> float:
    """Reverse signal direction."""

    return -value


def intermittent_gate(t: float, period: float, duty: float, start: float = 0.0) -> bool:
    """Periodic gate for intermittent faults."""

    if period <= 0 or t < start:
        return False
    duty = min(max(duty, 0.0), 1.0)
    phase = ((t - start) % period) / period
    return phase <= duty


def intermittent_fault(
    value: float,
    t: float,
    state: FaultRuntimeState,
    fault_fn: Callable[[float], float],
    period: float,
    duty: float,
    start: float = 0.0,
) -> float:
    """Apply fault_fn only inside an intermittent active window."""

    if intermittent_gate(t, period=period, duty=duty, start=start):
        return fault_fn(value)
    state.previous_value = value
    return value


def fixed_delay(value: float, state: FaultRuntimeState, delay_steps: int) -> float:
    """Delay a signal by a fixed number of simulation steps."""

    delay_steps = max(int(delay_steps), 0)
    state.delay_queue.append(value)
    if len(state.delay_queue) <= delay_steps:
        return state.previous_value
    delayed = state.delay_queue.pop(0)
    state.previous_value = delayed
    return delayed


def time_varying_delay(value: float, state: FaultRuntimeState, base_steps: int, jitter_steps: int, rng: Random) -> float:
    """Delay with random jitter around a base delay."""

    jitter = rng.randint(-abs(jitter_steps), abs(jitter_steps)) if jitter_steps else 0
    return fixed_delay(value, state, max(base_steps + jitter, 0))


def random_packet_loss(value: float, state: FaultRuntimeState, drop_rate: float, rng: Random, strategy: str = "hold") -> float:
    """Drop random packets using hold-last or zero-output strategy."""

    drop_rate = min(max(drop_rate, 0.0), 1.0)
    if rng.random() <= drop_rate:
        return 0.0 if strategy == "zero" else state.previous_value
    state.previous_value = value
    return value


def burst_packet_loss(value: float, state: FaultRuntimeState, start_probability: float, burst_length: int, rng: Random) -> float:
    """Drop consecutive samples once a burst-loss event starts."""

    if state.burst_remaining > 0:
        state.burst_remaining -= 1
        return state.previous_value
    if rng.random() <= min(max(start_probability, 0.0), 1.0):
        state.burst_remaining = max(int(burst_length) - 1, 0)
        return state.previous_value
    state.previous_value = value
    return value


def data_tamper(value: float, bias: float = 0.0, scale: float = 1.0, invert: bool = False) -> float:
    """Modify payload value through bias, scale, or sign tampering."""

    tampered = value * scale + bias
    return -tampered if invert else tampered


def blocking_interrupt(value: float, state: FaultRuntimeState, enable: bool, strategy: str = "hold") -> float:
    """Pause updates on a sensor or control link."""

    if enable:
        return 0.0 if strategy == "zero" else state.previous_value
    state.previous_value = value
    return value


def apply_fault_signal(
    value: float,
    t: float,
    kind: str,
    params: MutableMapping[str, float | int | str | bool],
    state: FaultRuntimeState,
    rng: Random | None = None,
) -> float:
    """Dispatch a scalar signal fault by kind.

    Common params:
      start, duration: active time window
      offset, scale, std, rate, upper, lower, delay_steps, drop_rate
    """

    rng = rng or Random(0)
    start = float(params.get("start", 0.0))
    duration = params.get("duration", None)
    if not is_active(t, start=start, duration=None if duration is None else float(duration)):
        state.previous_value = value
        state.hold_value = value
        return value

    if kind == "bias":
        return parameter_bias(value, float(params.get("offset", 0.0)))
    if kind == "scale":
        return parameter_scale(value, float(params.get("scale", 1.0)))
    if kind == "drift":
        return parameter_drift(value, t, float(params.get("rate", 0.0)), start)
    if kind == "step":
        return parameter_step(value, t, float(params.get("step_value", 0.0)), start)
    if kind == "lock":
        return actuator_lock(value, float(params.get("lock_value", 0.0)))
    if kind == "saturation":
        lower = params.get("lower", None)
        upper = params.get("upper", None)
        return saturation_limit(value, None if lower is None else float(lower), None if upper is None else float(upper))
    if kind == "gaussian_noise":
        return gaussian_noise(value, float(params.get("std", 0.1)), rng)
    if kind == "white_noise":
        return white_noise(value, float(params.get("amplitude", 0.1)), rng)
    if kind == "colored_noise":
        return colored_noise(value, float(params.get("alpha", 0.92)), float(params.get("std", 0.05)), state, rng)
    if kind == "pulse_noise":
        return pulse_noise(value, float(params.get("amplitude", 1.0)), float(params.get("probability", 0.03)), rng)
    if kind == "freeze":
        return signal_freeze(value, state, bool(params.get("enable", True)))
    if kind == "jump":
        return state_jump(value, float(params.get("jump", 0.0)))
    if kind == "sign_flip":
        return sign_flip(value)
    if kind == "delay":
        return fixed_delay(value, state, int(params.get("delay_steps", 1)))
    if kind == "jitter_delay":
        return time_varying_delay(value, state, int(params.get("base_steps", 1)), int(params.get("jitter_steps", 1)), rng)
    if kind == "packet_loss":
        return random_packet_loss(value, state, float(params.get("drop_rate", 0.05)), rng, str(params.get("strategy", "hold")))
    if kind == "burst_loss":
        return burst_packet_loss(value, state, float(params.get("start_probability", 0.02)), int(params.get("burst_length", 4)), rng)
    if kind == "tamper":
        return data_tamper(
            value,
            bias=float(params.get("bias", 0.0)),
            scale=float(params.get("scale", 1.0)),
            invert=bool(params.get("invert", False)),
        )
    if kind == "interrupt":
        return blocking_interrupt(value, state, bool(params.get("enable", True)), str(params.get("strategy", "hold")))
    return value


class SimpleUavFaultModel:
    """Small reference model for validating fault functions before platform wiring.

    This is not a full 6-DOF aircraft model. It is a deterministic harness that
    exposes the same signal groups as the platform blueprint: command,
    controller, actuator, vehicle, sensor, protocol, and residual.
    """

    def __init__(self, seed: int = 7) -> None:
        self.rng = Random(seed)
        self.states: Dict[str, FaultRuntimeState] = {}
        self.altitude = 0.0
        self.yaw = 0.0
        self.vertical_velocity = 0.0

    def state_for(self, key: str) -> FaultRuntimeState:
        self.states.setdefault(key, FaultRuntimeState())
        return self.states[key]

    def step(self, t: float, dt: float, command: float, faults: Sequence[dict]) -> dict:
        motor_command = 0.8 * command
        thrust = motor_command
        yaw_rate = 0.05 * motor_command
        sensor_altitude = self.altitude
        gyro_z = yaw_rate
        gps_velocity = self.vertical_velocity

        channels = {
            "motor_command": motor_command,
            "motor_thrust": thrust,
            "yaw_rate": yaw_rate,
            "baro_altitude": sensor_altitude,
            "gyro_z": gyro_z,
            "gps_velocity": gps_velocity,
        }

        for fault in faults:
            target = str(fault.get("target", ""))
            kind = str(fault.get("kind", ""))
            if target in channels:
                channels[target] = apply_fault_signal(
                    channels[target],
                    t,
                    kind,
                    fault.get("params", {}),
                    self.state_for(str(fault.get("id", target))),
                    self.rng,
                )

        self.vertical_velocity += (channels["motor_thrust"] - 0.55) * dt
        self.altitude += self.vertical_velocity * dt
        self.yaw += channels["yaw_rate"] * dt

        return {
            **channels,
            "altitude_state": self.altitude,
            "yaw_state": self.yaw,
            "residual_altitude": channels["baro_altitude"] - self.altitude,
        }


if __name__ == "__main__":
    model = SimpleUavFaultModel()
    demo_faults = [
        {"id": "motor_efficiency_loss", "target": "motor_thrust", "kind": "scale", "params": {"scale": 0.55, "start": 2.0}},
        {"id": "gyro_bias_z", "target": "gyro_z", "kind": "bias", "params": {"offset": 0.08, "start": 3.0}},
        {"id": "gps_packet_loss", "target": "gps_velocity", "kind": "packet_loss", "params": {"drop_rate": 0.2, "start": 4.0}},
    ]
    for k in range(10):
        t = k * 0.5
        print(t, model.step(t, 0.5, command=1.0 + 0.2 * sin(t), faults=demo_faults))
