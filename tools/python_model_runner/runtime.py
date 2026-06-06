import ast
import math
import multiprocessing
from types import MappingProxyType


_ALLOWED_BUILTINS = {
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "len": len,
    "range": range,
    "float": float,
    "int": int,
    "bool": bool,
    "round": round,
}
ALLOWED_BUILTINS = MappingProxyType(_ALLOWED_BUILTINS)

DEFAULT_TIMEOUT_SECONDS = 2.0


def build_builtins_mapping():
    return dict(_ALLOWED_BUILTINS)


def _require_payload_mapping(payload):
    if not isinstance(payload, dict):
        raise RuntimeError("payload must be a JSON object")
    return payload


def _reject_unsafe_nodes(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise RuntimeError("import statements are not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise RuntimeError(f"dunder and private names are not allowed: {node.id}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise RuntimeError(f"unsafe attribute access is not allowed: {node.attr}")


def _validate_numeric_scalar(value, path):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuntimeError(f"only finite numeric scalars are allowed in {path}")

    if not math.isfinite(float(value)):
        raise RuntimeError(f"non-finite values are not allowed in {path}")


def _validate_result_mapping(values, path):
    if not isinstance(values, dict):
        raise RuntimeError(f"{path} must be a mapping of numeric scalars")

    for key, value in values.items():
        _validate_numeric_scalar(value, f"{path}.{key}")


def _normalize_outputs(raw_outputs, output_names):
    if isinstance(raw_outputs, dict):
        return {name: raw_outputs.get(name, 0) for name in output_names}

    if isinstance(raw_outputs, tuple):
        values = list(raw_outputs)
    elif isinstance(raw_outputs, list):
        values = raw_outputs
    else:
        values = [raw_outputs]

    return {
        name: values[index] if index < len(values) else 0
        for index, name in enumerate(output_names)
    }


def execute_payload(payload):
    payload = _require_payload_mapping(payload)
    source = payload.get("source", "")
    tree = ast.parse(source, filename=payload.get("fileName", "<embedded>"), mode="exec")
    _reject_unsafe_nodes(tree)

    namespace = {"__builtins__": build_builtins_mapping()}
    exec(compile(tree, payload.get("fileName", "<embedded>"), "exec"), namespace, namespace)

    entry_function_name = payload.get("entryFunction", "process")
    entry_function = namespace.get(entry_function_name)
    if not callable(entry_function):
        raise RuntimeError(f"entry function not found: {entry_function_name}")

    result = entry_function(**(payload.get("inputs") or {}))
    raw_outputs = result
    raw_middle_vars = {}

    if (
        isinstance(result, tuple)
        and len(result) == 2
        and isinstance(result[1], dict)
    ):
        raw_outputs, raw_middle_vars = result

    output_names = payload.get("outputNames") or []
    middle_var_names = payload.get("middleVarNames") or []

    response = {
        "outputs": _normalize_outputs(raw_outputs, output_names),
        "middleVars": {
            name: raw_middle_vars.get(name, 0)
            for name in middle_var_names
        },
    }
    _validate_result_mapping(response["outputs"], "response.outputs")
    _validate_result_mapping(response["middleVars"], "response.middleVars")
    return response


def _execute_payload_worker(payload, result_queue):
    try:
        result_queue.put(("ok", execute_payload(payload)))
    except Exception as exc:  # pragma: no cover - exercised via isolated wrapper
        result_queue.put(("error", str(exc)))


def execute_payload_isolated(payload, timeout_seconds=DEFAULT_TIMEOUT_SECONDS):
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue()
    process = context.Process(
        target=_execute_payload_worker,
        args=(payload, result_queue),
    )
    try:
        process.start()
        process.join(timeout_seconds)

        if process.is_alive():
            process.terminate()
            process.join()
            raise RuntimeError("execution timed out")

        status, value = result_queue.get_nowait()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("execution failed without a result") from exc
    finally:
        result_queue.close()
        result_queue.join_thread()

    if status == "error":
        raise RuntimeError(value)

    return value
