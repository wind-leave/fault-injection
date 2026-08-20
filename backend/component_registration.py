"""Controlled registration for user-authored simulation components.

The service intentionally supports a small mathematical Python subset.  It is
not a general-purpose Python upload or execution API: imports, attribute
access, loops and comprehensions are rejected before a module reaches the
backend module directory.
"""

import ast
import argparse
import importlib
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError, ensure_mapping, ensure_number


MAX_COMPONENT_SOURCE_BYTES = 32 * 1024
MAX_COMPONENT_PORTS = 32
MODULE_ID_PATTERN = re.compile(r"^custom_[a-z][a-z0-9_]{2,63}$")
IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ALLOWED_CALLS = {"abs", "float", "int", "max", "min"}
ALLOWED_AST_NODES = {
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return,
    ast.Assign, ast.AnnAssign, ast.Expr, ast.Name, ast.Load, ast.Store,
    ast.Constant, ast.Dict, ast.List, ast.Tuple, ast.BinOp, ast.UnaryOp,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.USub, ast.UAdd,
    ast.Call, ast.keyword,
}


def _validate_identifier(value, field):
    if not isinstance(value, str) or not IDENTIFIER_PATTERN.fullmatch(value):
        raise SimulationBackendError("INVALID_SCHEMA", field, "must be a Python identifier")
    return value


def _validate_port_names(value, field):
    if not isinstance(value, list) or len(value) > MAX_COMPONENT_PORTS:
        raise SimulationBackendError("INVALID_SCHEMA", field, f"must contain at most {MAX_COMPONENT_PORTS} ports")
    names = []
    for index, item in enumerate(value):
        ensure_mapping(item, f"{field}[{index}]")
        name = _validate_identifier(item.get("varName"), f"{field}[{index}].varName")
        if name in names:
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].varName", "port variable names must be unique")
        data_type = str(item.get("dataType", item.get("type", "number"))).lower()
        if data_type not in {"number", "float", "scalar", "number[]", "vector"}:
            raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].type", "only numeric scalar or vector ports are supported")
        if data_type in {"number[]", "vector"}:
            length = item.get("vectorLength")
            if isinstance(length, bool) or not isinstance(length, int) or not 1 <= length <= 1024:
                raise SimulationBackendError("INVALID_SCHEMA", f"{field}[{index}].vectorLength", "must be an integer from 1 to 1024")
        names.append(name)
    return names


def _validate_parameters(value):
    if not isinstance(value, list) or len(value) > MAX_COMPONENT_PORTS:
        raise SimulationBackendError("INVALID_SCHEMA", "parameters", f"must contain at most {MAX_COMPONENT_PORTS} parameters")
    result = {}
    for index, item in enumerate(value):
        ensure_mapping(item, f"parameters[{index}]")
        name = _validate_identifier(item.get("key"), f"parameters[{index}].key")
        if name in result:
            raise SimulationBackendError("INVALID_SCHEMA", f"parameters[{index}].key", "parameter names must be unique")
        default = item.get("default", 0.0)
        data_type = str(item.get("dataType", item.get("type", "number"))).lower()
        if data_type in {"number[]", "vector"}:
            if not isinstance(default, list) or not default:
                raise SimulationBackendError("INVALID_SCHEMA", f"parameters[{index}].default", "vector parameter default must be a non-empty array")
            default = [ensure_number(item_value, f"parameters[{index}].default[{item_index}]") for item_index, item_value in enumerate(default)]
            length = item.get("vectorLength", len(default))
            if isinstance(length, bool) or not isinstance(length, int) or length != len(default) or length > 1024:
                raise SimulationBackendError("INVALID_SCHEMA", f"parameters[{index}].vectorLength", "must equal the default vector length")
            spec = {"type": "vector", "dataType": "vector", "vectorLength": length, "default": default}
        else:
            spec = {"type": "number", "default": ensure_number(default, f"parameters[{index}].default")}
        for bound_name in ("min", "max"):
            if bound_name in item and item[bound_name] not in (None, ""):
                spec[bound_name] = ensure_number(item[bound_name], f"parameters[{index}].{bound_name}")
        if spec.get("min") is not None and spec.get("max") is not None and spec["min"] > spec["max"]:
            raise SimulationBackendError("INVALID_SCHEMA", f"parameters[{index}]", "min must not exceed max")
        result[name] = spec
    return result


def _validate_safe_source(source, entry_function, allowed_arguments):
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise SimulationBackendError("COMPONENT_SOURCE_INVALID", "source", f"syntax error on line {exc.lineno}: {exc.msg}") from exc

    functions = [item for item in tree.body if isinstance(item, ast.FunctionDef)]
    if len(functions) != 1 or functions[0].name != entry_function or len(tree.body) != 1:
        raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", "source must contain exactly one entry function and no top-level statements")
    function = functions[0]
    if function.decorator_list or function.args.vararg or function.args.kwarg or function.args.kwonlyargs:
        raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", "decorators, variadic and keyword-only arguments are not supported")
    argument_names = [argument.arg for argument in function.args.args]
    if set(argument_names) != set(allowed_arguments) or len(argument_names) != len(allowed_arguments):
        raise SimulationBackendError("COMPONENT_SIGNATURE_MISMATCH", "source", "entry function arguments must exactly match inputs and parameters")

    for node in ast.walk(tree):
        if type(node) not in ALLOWED_AST_NODES:
            raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", f"{type(node).__name__} is not allowed")
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_CALLS):
            raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", "only abs, float, int, max and min calls are allowed")
        if isinstance(node, ast.AnnAssign) and not isinstance(node.target, ast.Name):
            raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", "only simple variable assignments are allowed")
        if isinstance(node, ast.Assign) and (len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name)):
            raise SimulationBackendError("COMPONENT_SOURCE_NOT_ALLOWED", "source", "only simple variable assignments are allowed")
    if not any(isinstance(item, ast.Return) for item in function.body):
        raise SimulationBackendError("COMPONENT_SOURCE_INVALID", "source", "entry function must return an output mapping")


class ComponentRegistrar:
    _lock = threading.Lock()

    @classmethod
    def for_persistent_storage(cls, data_dir=None):
        """Create the registrar backed by data outside the deployed backend package.

        ``GZ_COMPONENT_DATA_DIR`` should point to a server-owned persistent
        directory in production.  The default is a sibling of ``backend`` so
        replacing ``backend/`` during an application update leaves user
        components untouched.
        """
        default_data_dir = Path(__file__).resolve().parent.parent / "component-data"
        storage_dir = Path(data_dir or os.environ.get("GZ_COMPONENT_DATA_DIR", default_data_dir)).resolve()
        package_name = "gz_custom_components"
        modules_dir = storage_dir / package_name
        modules_dir.mkdir(parents=True, exist_ok=True)
        init_path = modules_dir / "__init__.py"
        if not init_path.exists():
            init_path.write_text("", encoding="utf-8")
        manifest_path = storage_dir / "manifest.json"
        if not manifest_path.exists():
            cls._atomic_write(manifest_path, json.dumps({"modules": []}, ensure_ascii=False, indent=2) + "\n")
        storage_parent = str(storage_dir)
        if storage_parent not in sys.path:
            sys.path.insert(0, storage_parent)
        existing_package = sys.modules.get(package_name)
        existing_paths = [Path(path).resolve() for path in getattr(existing_package, "__path__", [])] if existing_package else []
        if existing_package and modules_dir not in existing_paths:
            # This only occurs when a process switches storage directories
            # (primarily tests or an explicit reconfiguration).  Do not retain
            # imports from the old persistent store.
            for module_name in list(sys.modules):
                if module_name == package_name or module_name.startswith(f"{package_name}."):
                    sys.modules.pop(module_name, None)
        return cls(modules_dir=modules_dir, manifest_path=manifest_path, import_package=package_name)

    def __init__(self, modules_dir=None, manifest_path=None, import_package="backend.builtin_modules"):
        default_dir = Path(__file__).parent / "builtin_modules"
        self.modules_dir = Path(modules_dir or default_dir)
        self.manifest_path = Path(manifest_path or self.modules_dir / "manifest.json")
        self.import_package = import_package

    @staticmethod
    def _atomic_write(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_path = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
            os.replace(temporary_path, path)
        except Exception:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            raise

    def register(self, payload):
        ensure_mapping(payload, "request")
        module_id = payload.get("moduleId")
        if not isinstance(module_id, str) or not MODULE_ID_PATTERN.fullmatch(module_id):
            raise SimulationBackendError("INVALID_SCHEMA", "moduleId", "must match custom_[a-z][a-z0-9_]{2,63}")
        entry_function = _validate_identifier(payload.get("entryFunction", "process"), "entryFunction")
        source = payload.get("source")
        if not isinstance(source, str) or not source.strip():
            raise SimulationBackendError("INVALID_SCHEMA", "source", "source is required")
        if len(source.encode("utf-8")) > MAX_COMPONENT_SOURCE_BYTES:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "source", "source exceeds 32 KB")
        inputs = _validate_port_names(payload.get("inputs", []), "inputs")
        outputs = _validate_port_names(payload.get("outputs", []), "outputs")
        parameters = _validate_parameters(payload.get("parameters", []))
        if set(inputs) & set(parameters):
            raise SimulationBackendError("INVALID_SCHEMA", "parameters", "parameter names must not duplicate input names")
        _validate_safe_source(source, entry_function, [*inputs, *parameters])

        module_path = self.modules_dir / f"{module_id}.py"
        with self._lock:
            original_manifest = self.manifest_path.read_text(encoding="utf-8")
            data = json.loads(original_manifest)
            modules = data.get("modules")
            if not isinstance(modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest", "backend manifest modules must be an array")
            if module_path.exists() or any(item.get("moduleId") == module_id for item in modules if isinstance(item, dict)):
                raise SimulationBackendError("COMPONENT_ALREADY_REGISTERED", "moduleId", f"component already registered: {module_id}")
            module_record = {
                "moduleId": module_id,
                "importPath": f"{self.import_package}.{module_id}",
                "entryFunction": entry_function,
                "inputs": inputs,
                "outputs": outputs,
                "parameters": parameters,
            }
            self._atomic_write(module_path, source.strip() + "\n")
            try:
                data["modules"] = [*modules, module_record]
                self._atomic_write(self.manifest_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            except Exception:
                module_path.unlink(missing_ok=True)
                raise
        importlib.invalidate_caches()
        try:
            registry = ModuleRegistry.from_manifest(self.manifest_path)
            # Prove that the registered entry can be imported and obeys the
            # runtime output contract before it is exposed to simulations.
            registry.require(module_id).call(
                {name: 0.0 for name in inputs},
                {name: spec["default"] for name, spec in parameters.items()},
            )
        except Exception:
            with self._lock:
                self._atomic_write(self.manifest_path, original_manifest)
                module_path.unlink(missing_ok=True)
            importlib.invalidate_caches()
            raise
        return module_record

    def update(self, module_id, payload):
        """Atomically replace an existing user component while preserving its id."""
        ensure_mapping(payload, "request")
        if not isinstance(module_id, str) or not MODULE_ID_PATTERN.fullmatch(module_id):
            raise SimulationBackendError("INVALID_SCHEMA", "moduleId", "must match custom_[a-z][a-z0-9_]{2,63}")
        if payload.get("moduleId") != module_id:
            raise SimulationBackendError("INVALID_SCHEMA", "moduleId", "must match the component id in the request path")
        entry_function = _validate_identifier(payload.get("entryFunction", "process"), "entryFunction")
        source = payload.get("source")
        if not isinstance(source, str) or not source.strip():
            raise SimulationBackendError("INVALID_SCHEMA", "source", "source is required")
        if len(source.encode("utf-8")) > MAX_COMPONENT_SOURCE_BYTES:
            raise SimulationBackendError("SIMULATION_LIMIT_EXCEEDED", "source", "source exceeds 32 KB")
        inputs = _validate_port_names(payload.get("inputs", []), "inputs")
        outputs = _validate_port_names(payload.get("outputs", []), "outputs")
        parameters = _validate_parameters(payload.get("parameters", []))
        if set(inputs) & set(parameters):
            raise SimulationBackendError("INVALID_SCHEMA", "parameters", "parameter names must not duplicate input names")
        _validate_safe_source(source, entry_function, [*inputs, *parameters])

        module_path = self.modules_dir / f"{module_id}.py"
        with self._lock:
            original_manifest = self.manifest_path.read_text(encoding="utf-8")
            data = json.loads(original_manifest)
            modules = data.get("modules")
            if not isinstance(modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest", "backend manifest modules must be an array")
            matches = [index for index, item in enumerate(modules) if isinstance(item, dict) and item.get("moduleId") == module_id]
            if len(matches) != 1 or not module_path.exists():
                raise SimulationBackendError("COMPONENT_NOT_FOUND", "moduleId", f"component is not registered: {module_id}")
            original_source = module_path.read_text(encoding="utf-8")
            module_record = {
                "moduleId": module_id,
                "importPath": f"{self.import_package}.{module_id}",
                "entryFunction": entry_function,
                "inputs": inputs,
                "outputs": outputs,
                "parameters": parameters,
            }
            self._atomic_write(module_path, source.strip() + "\n")
            try:
                modules[matches[0]] = module_record
                self._atomic_write(self.manifest_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            except Exception:
                self._atomic_write(module_path, original_source)
                self._atomic_write(self.manifest_path, original_manifest)
                raise

        imported_name = f"{self.import_package}.{module_id}"
        sys.modules.pop(imported_name, None)
        for cached_path in (self.modules_dir / "__pycache__").glob(f"{module_id}.*.pyc"):
            cached_path.unlink(missing_ok=True)
        importlib.invalidate_caches()
        try:
            registry = ModuleRegistry.from_manifest(self.manifest_path)
            registry.require(module_id).call(
                {name: 0.0 for name in inputs},
                {name: spec["default"] for name, spec in parameters.items()},
            )
        except Exception:
            with self._lock:
                self._atomic_write(module_path, original_source)
                self._atomic_write(self.manifest_path, original_manifest)
            sys.modules.pop(imported_name, None)
            for cached_path in (self.modules_dir / "__pycache__").glob(f"{module_id}.*.pyc"):
                cached_path.unlink(missing_ok=True)
            importlib.invalidate_caches()
            raise
        return module_record

    def migrate_legacy_components(self, legacy_modules_dir):
        """Copy previously registered ``custom_*`` modules into persistent storage.

        This is intentionally explicit rather than automatic so deploying a new
        application version never mutates component data unexpectedly.
        """
        legacy_modules_dir = Path(legacy_modules_dir)
        legacy_manifest_path = legacy_modules_dir / "manifest.json"
        legacy_data = json.loads(legacy_manifest_path.read_text(encoding="utf-8"))
        legacy_modules = legacy_data.get("modules")
        if not isinstance(legacy_modules, list):
            raise SimulationBackendError("INVALID_SCHEMA", "legacyManifest.modules", "manifest modules must be an array")

        selected = [item for item in legacy_modules if isinstance(item, dict) and MODULE_ID_PATTERN.fullmatch(str(item.get("moduleId", "")))]
        with self._lock:
            destination_data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            destination_modules = destination_data.get("modules")
            if not isinstance(destination_modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest.modules", "manifest modules must be an array")
            known_ids = {item.get("moduleId") for item in destination_modules if isinstance(item, dict)}
            migrated = []
            for item in selected:
                module_id = item["moduleId"]
                source_path = legacy_modules_dir / f"{module_id}.py"
                if not source_path.is_file():
                    raise SimulationBackendError("COMPONENT_NOT_FOUND", "legacyComponent", f"component source is missing: {module_id}")
                if module_id in known_ids:
                    continue
                record = dict(item)
                record["importPath"] = f"{self.import_package}.{module_id}"
                self._atomic_write(self.modules_dir / f"{module_id}.py", source_path.read_text(encoding="utf-8"))
                destination_modules.append(record)
                known_ids.add(module_id)
                migrated.append(module_id)
            if migrated:
                self._atomic_write(self.manifest_path, json.dumps(destination_data, ensure_ascii=False, indent=2) + "\n")
        importlib.invalidate_caches()
        return migrated

    def unregister(self, module_id):
        if not isinstance(module_id, str) or not MODULE_ID_PATTERN.fullmatch(module_id):
            raise SimulationBackendError("INVALID_SCHEMA", "moduleId", "must match custom_[a-z][a-z0-9_]{2,63}")
        module_path = self.modules_dir / f"{module_id}.py"
        with self._lock:
            original_manifest = self.manifest_path.read_text(encoding="utf-8")
            data = json.loads(original_manifest)
            modules = data.get("modules")
            if not isinstance(modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest", "backend manifest modules must be an array")
            matching = [item for item in modules if isinstance(item, dict) and item.get("moduleId") == module_id]
            if len(matching) != 1:
                raise SimulationBackendError("COMPONENT_NOT_FOUND", "moduleId", f"component is not registered: {module_id}")
            source = module_path.read_text(encoding="utf-8") if module_path.exists() else None
            if source is None:
                raise SimulationBackendError("COMPONENT_NOT_FOUND", "moduleId", f"component source is missing: {module_id}")
            data["modules"] = [item for item in modules if item is not matching[0]]
            self._atomic_write(self.manifest_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            try:
                module_path.unlink()
            except Exception:
                self._atomic_write(self.manifest_path, original_manifest)
                raise
        sys.modules.pop(f"{self.import_package}.{module_id}", None)
        importlib.invalidate_caches()
        return matching[0]

    def unregister_many(self, module_ids):
        if not isinstance(module_ids, list) or not module_ids or len(module_ids) > MAX_COMPONENT_PORTS:
            raise SimulationBackendError("INVALID_SCHEMA", "moduleIds", f"must contain from 1 to {MAX_COMPONENT_PORTS} module ids")
        if len(set(module_ids)) != len(module_ids):
            raise SimulationBackendError("INVALID_SCHEMA", "moduleIds", "module ids must be unique")
        for index, module_id in enumerate(module_ids):
            if not isinstance(module_id, str) or not MODULE_ID_PATTERN.fullmatch(module_id):
                raise SimulationBackendError("INVALID_SCHEMA", f"moduleIds[{index}]", "must match custom_[a-z][a-z0-9_]{2,63}")

        with self._lock:
            original_manifest = self.manifest_path.read_text(encoding="utf-8")
            data = json.loads(original_manifest)
            modules = data.get("modules")
            if not isinstance(modules, list):
                raise SimulationBackendError("INVALID_SCHEMA", "manifest", "backend manifest modules must be an array")
            records_by_id = {item.get("moduleId"): item for item in modules if isinstance(item, dict) and item.get("moduleId") in module_ids}
            if len(records_by_id) != len(module_ids):
                missing = next(module_id for module_id in module_ids if module_id not in records_by_id)
                raise SimulationBackendError("COMPONENT_NOT_FOUND", "moduleIds", f"component is not registered: {missing}")
            source_paths = {module_id: self.modules_dir / f"{module_id}.py" for module_id in module_ids}
            sources = {}
            for module_id, path in source_paths.items():
                if not path.exists():
                    raise SimulationBackendError("COMPONENT_NOT_FOUND", "moduleIds", f"component source is missing: {module_id}")
                sources[module_id] = path.read_text(encoding="utf-8")
            data["modules"] = [item for item in modules if not isinstance(item, dict) or item.get("moduleId") not in records_by_id]
            self._atomic_write(self.manifest_path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            try:
                for path in source_paths.values():
                    path.unlink()
            except Exception:
                self._atomic_write(self.manifest_path, original_manifest)
                for module_id, path in source_paths.items():
                    if not path.exists():
                        self._atomic_write(path, sources[module_id])
                raise
        for module_id in module_ids:
            sys.modules.pop(f"{self.import_package}.{module_id}", None)
        importlib.invalidate_caches()
        return [records_by_id[module_id] for module_id in module_ids]


def _main():
    parser = argparse.ArgumentParser(description="Migrate legacy custom simulation components into persistent storage.")
    parser.add_argument("--legacy-modules-dir", required=True, help="legacy backend/builtin_modules directory")
    parser.add_argument("--data-dir", help="persistent component storage directory; overrides GZ_COMPONENT_DATA_DIR")
    arguments = parser.parse_args()
    migrated = ComponentRegistrar.for_persistent_storage(arguments.data_dir).migrate_legacy_components(arguments.legacy_modules_dir)
    print(json.dumps({"migratedModuleIds": migrated}, ensure_ascii=False))


if __name__ == "__main__":
    _main()
