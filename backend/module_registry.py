import importlib
import inspect
import json
from dataclasses import dataclass
from pathlib import Path

from backend.schemas import SimulationBackendError, ensure_number, ensure_signal_value


@dataclass(frozen=True)
class RegisteredModule:
    module_id: str
    import_path: str
    entry_function: str
    inputs: tuple
    outputs: tuple
    parameters: dict

    def call(self, inputs, parameters, *, time=None, dt=None, state=None):
        resolved_parameters = self._resolve_parameters(parameters or {})
        module = importlib.import_module(self.import_path)
        entry = getattr(module, self.entry_function, None)
        if not callable(entry):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "pythonBinding.entryFunction", f"entry function not found: {self.entry_function}")

        kwargs = {name: ensure_signal_value(inputs.get(name, 0.0), f"inputs.{name}") for name in self.inputs}
        kwargs.update(resolved_parameters)
        kwargs = self._filter_call_kwargs(entry, kwargs, {
            "time": time,
            "dt": dt,
            "state": dict(state or {}),
        })
        result = entry(**kwargs)
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
        try:
            signature = inspect.signature(entry)
        except (TypeError, ValueError):
            return candidates
        parameters = signature.parameters.values()
        if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters):
            return candidates
        accepted = {
            name
            for name, parameter in signature.parameters.items()
            if parameter.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
        }
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
