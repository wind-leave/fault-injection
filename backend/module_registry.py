import importlib
import inspect
import json
import copy
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

from backend.schemas import SimulationBackendError, ensure_number, ensure_signal_value


_MODULE_CALL_CACHE_GENERATION = 0


@lru_cache(maxsize=256)
def _load_module_entry(import_path, entry_function):
    """Resolve a registered entry once instead of once per simulation sample."""
    module = importlib.import_module(import_path)
    entry = getattr(module, entry_function, None)
    if not callable(entry):
        raise SimulationBackendError(
            "MODULE_SIGNATURE_MISMATCH",
            "pythonBinding.entryFunction",
            f"entry function not found: {entry_function}",
        )
    return entry


@lru_cache(maxsize=256)
def _accepted_call_arguments(entry):
    """Cache inspected function arguments for modules without ``**kwargs``."""
    try:
        signature = inspect.signature(entry)
    except (TypeError, ValueError):
        return None
    parameters = signature.parameters.values()
    if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters):
        return None
    return frozenset(
        name
        for name, parameter in signature.parameters.items()
        if parameter.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, parameter.KEYWORD_ONLY)
    )


def clear_module_call_cache():
    """Forget cached entries after a custom component is changed or removed."""
    global _MODULE_CALL_CACHE_GENERATION
    _MODULE_CALL_CACHE_GENERATION += 1
    _load_module_entry.cache_clear()
    _accepted_call_arguments.cache_clear()


@dataclass(frozen=True)
class RegisteredModule:
    module_id: str
    import_path: str
    entry_function: str
    inputs: tuple
    outputs: tuple
    parameters: dict

    def prepare(self):
        """Create one reusable call plan for a simulation node."""
        return PreparedModuleCall(self)

    def call(self, inputs, parameters, *, time=None, dt=None, state=None):
        resolved_parameters = self._resolve_parameters(parameters or {})
        entry = _load_module_entry(self.import_path, self.entry_function)

        kwargs = {name: ensure_signal_value(inputs.get(name, 0.0), f"inputs.{name}") for name in self.inputs}
        kwargs.update(resolved_parameters)
        kwargs = self._filter_call_kwargs(entry, kwargs, {
            "time": time,
            "dt": dt,
            "state": dict(state or {}),
        })
        result = entry(**kwargs)
        return self._normalize_result(result, state)

    def _normalize_result(self, result, state):
        if not isinstance(result, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult", "module result must be an output mapping")
        output_source = result.get("outputs") if "outputs" in result else result
        if not isinstance(output_source, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult.outputs", "module outputs must be a mapping")
        next_state = result.get("state", state or {}) if "outputs" in result else (state or {})
        if next_state is None:
            next_state = {}
        if not isinstance(next_state, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult.state", "module state must be a mapping")
        middle_vars = result.get("middleVars", {}) if "outputs" in result else {}
        if middle_vars is None:
            middle_vars = {}
        if not isinstance(middle_vars, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult.middleVars", "module middleVars must be a mapping")
        return {
            "outputs": {name: ensure_signal_value(output_source.get(name, 0.0), f"outputs.{name}") for name in self.outputs},
            "state": dict(next_state),
            "middleVars": {name: ensure_signal_value(value, f"middleVars.{name}") for name, value in middle_vars.items()},
        }

    def _filter_call_kwargs(self, entry, kwargs, context):
        candidates = dict(kwargs)
        for key, value in context.items():
            if value is not None and key not in candidates:
                candidates[key] = value
        accepted = _accepted_call_arguments(entry)
        if accepted is None:
            return candidates
        return {key: value for key, value in candidates.items() if key in accepted}

    def _resolve_parameters(self, parameters):
        resolved = {}
        for name, spec in self.parameters.items():
            value = parameters.get(name, spec.get("default", 0.0))
            is_vector = str(spec.get("dataType", spec.get("type", "number"))).lower() == "vector"
            numeric = ensure_signal_value(value, f"parameters.{name}") if is_vector else ensure_number(value, f"parameters.{name}")
            if is_vector and spec.get("vectorLength") is not None and len(numeric) != int(spec["vectorLength"]):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} has an invalid vector length")
            minimum = spec.get("min")
            maximum = spec.get("max")
            values = numeric if is_vector else [numeric]
            if minimum is not None and any(item < float(minimum) for item in values):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is below minimum")
            if maximum is not None and any(item > float(maximum) for item in values):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is above maximum")
            allowed_values = spec.get("enum")
            if allowed_values is not None and any(item not in {float(allowed) for allowed in allowed_values} for item in values):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is not an allowed value")
            resolved[name] = numeric
        return resolved


class PreparedModuleCall:
    """Reuse entry, signature, and unchanged parameter validation per node."""

    def __init__(self, module):
        self.module = module
        # Set by the graph compiler only when every connected input comes
        # from a declared, validated output port.
        self.trusted_inputs = False
        self._supplied_names = frozenset(module.inputs) | frozenset(module.parameters)
        self._generation = -1
        self._entry = None
        self._accepted = None
        self._parameters_snapshot = None
        self._resolved_parameters = None

    def call(self, inputs, parameters, *, time=None, dt=None, state=None, validated_inputs=False):
        if self._generation != _MODULE_CALL_CACHE_GENERATION:
            self._entry = _load_module_entry(self.module.import_path, self.module.entry_function)
            self._accepted = _accepted_call_arguments(self._entry)
            self._generation = _MODULE_CALL_CACHE_GENERATION

        source_parameters = parameters or {}
        if self._parameters_snapshot is None or source_parameters != self._parameters_snapshot:
            self._resolved_parameters = self.module._resolve_parameters(source_parameters)
            self._parameters_snapshot = copy.deepcopy(source_parameters)

        accepted = self._accepted
        kwargs = {}
        for name in self.module.inputs:
            value = inputs.get(name, 0.0)
            if not validated_inputs:
                value = ensure_signal_value(value, f"inputs.{name}")
            if accepted is None or name in accepted:
                kwargs[name] = value
        for name, value in self._resolved_parameters.items():
            if accepted is None or name in accepted:
                # The old call path normalized vector parameters on every
                # invocation, so a component must not mutate the cached copy.
                kwargs[name] = copy.deepcopy(value) if isinstance(value, (list, dict)) else value

        for name, value in (("time", time), ("dt", dt), ("state", dict(state or {}))):
            if value is not None and name not in self._supplied_names and (accepted is None or name in accepted):
                kwargs[name] = value

        result = self._entry(**kwargs)
        return self.module._normalize_result(result, state)


class ModuleRegistry:
    def __init__(self, modules):
        self.modules = {module.module_id: module for module in modules}

    @classmethod
    def from_builtin_manifest(cls):
        return cls.from_manifest(cls.builtin_manifest_path())

    @staticmethod
    def builtin_manifest_path():
        return Path(__file__).parent / "builtin_modules" / "manifest.json"

    @classmethod
    def from_manifest(cls, manifest_path):
        return cls.from_manifests([manifest_path])

    @classmethod
    def from_manifests(cls, manifest_paths):
        """Build a registry from the immutable built-ins and persistent custom manifests."""
        modules = []
        module_ids = set()
        for manifest_path in manifest_paths:
            manifest_path = Path(manifest_path)
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest_modules = data.get("modules", [])
            if not isinstance(manifest_modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest.modules", "manifest modules must be an array")
            for item in manifest_modules:
                if not isinstance(item, dict) or not isinstance(item.get("moduleId"), str):
                    raise SimulationBackendError("INVALID_SCHEMA", "manifest.modules", "each manifest module must have a moduleId")
                module_id = item["moduleId"]
                if module_id in module_ids:
                    raise SimulationBackendError("INVALID_SCHEMA", "manifest.modules", f"duplicate moduleId: {module_id}")
                module_ids.add(module_id)
                modules.append(
                    RegisteredModule(
                        module_id=module_id,
                        import_path=item["importPath"],
                        entry_function=item.get("entryFunction", "process"),
                        inputs=tuple(item.get("inputs", [])),
                        outputs=tuple(item.get("outputs", [])),
                        parameters=item.get("parameters", {}),
                    )
                )
        return cls(modules)

    def require(self, module_id, field="pythonBinding.moduleId"):
        module = self.modules.get(module_id)
        if not module:
            raise SimulationBackendError("MODULE_NOT_WHITELISTED", field, f"moduleId {module_id} is not registered on backend")
        return module
