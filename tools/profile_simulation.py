"""Profile one executable simulation package without changing runtime behavior.

Usage: python tools/profile_simulation.py package.json --steps 10000 --batch 1000
The input may be an executable model or an exported 3D practice task package.
"""

import argparse
from contextlib import ExitStack
from functools import wraps
import hashlib
import json
from pathlib import Path
import sys
import time
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import module_registry, simulation_engine, simulation_functions  # noqa: E402
from backend.graph_compiler import compile_graph  # noqa: E402
from backend.module_registry import ModuleRegistry  # noqa: E402


def _timed(function, totals, name, call_counts=None):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if call_counts is not None:
            call_counts[name] = call_counts.get(name, 0) + 1
        started = time.perf_counter_ns()
        try:
            return function(*args, **kwargs)
        finally:
            totals[name] += time.perf_counter_ns() - started
    return wrapper


def _profile_patches(totals, module_totals, call_counts):
    """Count nested phases; module function time is part of module call time."""
    stack = ExitStack()
    original_load = module_registry._load_module_entry
    wrapped_entries = {}

    def load_entry(import_path, entry_function):
        entry = original_load(import_path, entry_function)
        key = (import_path, entry_function)
        if key not in wrapped_entries:
            wrapped_entries[key] = _timed(entry, totals, "componentFunction")
        return wrapped_entries[key]

    original_call = module_registry.RegisteredModule.call

    @wraps(original_call)
    def call_module(module, *args, **kwargs):
        started = time.perf_counter_ns()
        try:
            return original_call(module, *args, **kwargs)
        finally:
            elapsed = time.perf_counter_ns() - started
            totals["moduleCall"] += elapsed
            module_totals[module.module_id] = module_totals.get(module.module_id, 0) + elapsed

    original_prepared_call = module_registry.PreparedModuleCall.call

    @wraps(original_prepared_call)
    def call_prepared(prepared, *args, **kwargs):
        started = time.perf_counter_ns()
        try:
            return original_prepared_call(prepared, *args, **kwargs)
        finally:
            elapsed = time.perf_counter_ns() - started
            totals["moduleCall"] += elapsed
            module_id = prepared.module.module_id
            module_totals[module_id] = module_totals.get(module_id, 0) + elapsed

    stack.enter_context(patch.object(
        module_registry.RegisteredModule, "call", call_module,
    ))
    stack.enter_context(patch.object(
        module_registry.PreparedModuleCall, "call", call_prepared,
    ))
    stack.enter_context(patch.object(module_registry, "_load_module_entry", load_entry))
    stack.enter_context(patch.object(
        simulation_engine, "_ensure_port_value",
        _timed(simulation_engine._ensure_port_value, totals, "portValidation"),
    ))
    stack.enter_context(patch.object(
        simulation_engine, "_reported_component_outputs",
        _timed(simulation_engine._reported_component_outputs, totals, "traceAssembly"),
    ))
    stack.enter_context(patch.object(
        simulation_functions, "fft_radix2",
        _timed(simulation_functions.fft_radix2, totals, "fftRadix2", call_counts),
    ))
    stack.enter_context(patch.object(
        simulation_functions, "_estimate_envelope_baseband_frequency",
        _timed(simulation_functions._estimate_envelope_baseband_frequency,
               totals, "basebandFrequencyEstimate", call_counts),
    ))
    return stack


def _run(package, steps, batch, *, profile):
    graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
    session = simulation_engine.SimulationSession(graph)
    totals = {name: 0 for name in (
        "moduleCall", "componentFunction", "portValidation", "traceAssembly",
        "basebandFrequencyEstimate", "fftRadix2",
    )}
    module_totals = {}
    call_counts = {}
    sampled = min(steps, session.total_steps)
    encoded_bytes = 0
    digest = hashlib.sha256()
    peak_response_bytes = 0
    step_ns = 0
    encode_ns = 0
    with _profile_patches(totals, module_totals, call_counts) if profile else ExitStack():
        while session.step_index < sampled:
            count = min(batch, sampled - session.step_index)
            started = time.perf_counter_ns()
            result = session.step(count, paths=("actual",))
            step_ns += time.perf_counter_ns() - started

            started = time.perf_counter_ns()
            body = json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8")
            encode_ns += time.perf_counter_ns() - started
            digest.update(body)
            encoded_bytes += len(body)
            peak_response_bytes = max(peak_response_bytes, len(body))

    return {
        "steps": sampled,
        "batch": batch,
        "stepSeconds": round(step_ns / 1e9, 4),
        "jsonEncodeSeconds": round(encode_ns / 1e9, 4),
        "responseMiB": round(encoded_bytes / (1024 * 1024), 3),
        "peakResponseMiB": round(peak_response_bytes / (1024 * 1024), 3),
        "outputSha256": digest.hexdigest(),
        "phases": {
            name: {
                "seconds": round(value / 1e9, 4),
                "percentOfStep": round(value / step_ns * 100, 2) if step_ns else 0,
                **({"calls": call_counts[name]} if name in call_counts else {}),
            }
            for name, value in totals.items()
        },
        "moduleCalls": [
            {
                "moduleId": name,
                "seconds": round(value / 1e9, 4),
                "percentOfStep": round(value / step_ns * 100, 2) if step_ns else 0,
            }
            for name, value in sorted(module_totals.items(), key=lambda item: -item[1])
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Executable model or exported 3D practice task package JSON")
    parser.add_argument("--steps", type=int, default=10000)
    parser.add_argument("--batch", type=int, default=1000)
    parser.add_argument("--baseline-only", action="store_true", help="skip instrumented rerun")
    args = parser.parse_args()
    if args.steps < 1 or args.batch < 1:
        parser.error("--steps and --batch must be positive")

    package = json.loads(args.package.read_text(encoding="utf-8"))
    if package.get("kind") == "3d-practice-task-package":
        package = (package.get("privateData") or {}).get("executableModel")
        if not isinstance(package, dict):
            parser.error("practice task package has no privateData.executableModel")
    # Warm imported component modules and cached call signatures before timing.
    _run(package, 1, 1, profile=False)
    baseline = _run(package, args.steps, args.batch, profile=False)
    profiled = None if args.baseline_only else _run(package, args.steps, args.batch, profile=True)
    if profiled is not None and baseline["outputSha256"] != profiled["outputSha256"]:
        raise RuntimeError("profiling changed the simulation result")
    report = {
        "model": {
            "packageId": package.get("packageId"),
            "nodes": len(package.get("nodes", [])),
            "edges": len(package.get("edges", [])),
            "measurements": len(package.get("measurementPoints", [])),
            "reportedNodes": len(package.get("reportedNodeIds", [])),
        },
        "baseline": baseline,
        "notes": [
            "componentFunction is included in moduleCall; phase percentages are not additive",
            "profiled timing includes per-call timer overhead; baseline reflects normal execution",
            "JSON encoding matches the backend serializer; HTTP transport and browser work are excluded",
        ],
    }
    if profiled is not None:
        report["profiled"] = profiled
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
