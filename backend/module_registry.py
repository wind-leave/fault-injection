import importlib
import json
from dataclasses import dataclass
from pathlib import Path

from backend.schemas import SimulationBackendError, ensure_number


@dataclass(frozen=True)
class RegisteredModule:
    module_id: str
    import_path: str
    entry_function: str
    inputs: tuple
    outputs: tuple
    parameters: dict

    def call(self, inputs, parameters):
        resolved_parameters = self._resolve_parameters(parameters or {})
        module = importlib.import_module(self.import_path)
        entry = getattr(module, self.entry_function, None)
        if not callable(entry):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "pythonBinding.entryFunction", f"entry function not found: {self.entry_function}")

        kwargs = {name: ensure_number(inputs.get(name, 0.0), f"inputs.{name}") for name in self.inputs}
        kwargs.update(resolved_parameters)
        result = entry(**kwargs)
        if not isinstance(result, dict):
            raise SimulationBackendError("MODULE_SIGNATURE_MISMATCH", "moduleResult", "module result must be an output mapping")
        return {"outputs": {name: ensure_number(result.get(name, 0.0), f"outputs.{name}") for name in self.outputs}}

    def _resolve_parameters(self, parameters):
        resolved = {}
        for name, spec in self.parameters.items():
            value = parameters.get(name, spec.get("default", 0.0))
            numeric = ensure_number(value, f"parameters.{name}")
            minimum = spec.get("min")
            maximum = spec.get("max")
            if minimum is not None and numeric < float(minimum):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is below minimum")
            if maximum is not None and numeric > float(maximum):
                raise SimulationBackendError("PARAM_OUT_OF_RANGE", f"parameters.{name}", f"{name} is above maximum")
            resolved[name] = numeric
        return resolved


class ModuleRegistry:
    def __init__(self, modules):
        self.modules = {module.module_id: module for module in modules}

    @classmethod
    def from_builtin_manifest(cls):
        manifest_path = Path(__file__).parent / "builtin_modules" / "manifest.json"
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        modules = [
            RegisteredModule(
                module_id=item["moduleId"],
                import_path=item["importPath"],
                entry_function=item.get("entryFunction", "process"),
                inputs=tuple(item.get("inputs", [])),
                outputs=tuple(item.get("outputs", [])),
                parameters=item.get("parameters", {}),
            )
            for item in data.get("modules", [])
        ]
        return cls(modules)

    def require(self, module_id, field="pythonBinding.moduleId"):
        module = self.modules.get(module_id)
        if not module:
            raise SimulationBackendError("MODULE_NOT_WHITELISTED", field, f"moduleId {module_id} is not registered on backend")
        return module
