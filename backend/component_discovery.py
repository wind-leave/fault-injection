"""Discover trusted, developer-installed components with literal COMPONENT metadata.

Only the dedicated backend.auto_components package is scanned. Reading metadata
does not import/execute a component; its entry is imported by the simulation runtime.
"""

import ast
import json
import keyword
import math
from pathlib import Path


COMPONENT_DIRECTORY = Path(__file__).parent / "auto_components"
COMPONENT_PACKAGE = "backend.auto_components"
CONTEXT_ARGUMENTS = {"time", "dt", "state"}
# These public electrical templates have stable IDs shared with saved models.
REPLACEABLE_ELECTRICAL_MODULE_IDS = frozenset({
    "electrical_ac_power_source", "electrical_dc_power_source",
    "electrical_dc_boost", "electrical_ac_dc_matching",
})


def _identifier(value, field):
    if not isinstance(value, str) or not value.isidentifier() or keyword.iskeyword(value):
        raise ValueError(f"{field} must be a Python identifier")
    return value


def _number(value, field):
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f"{field} must be a finite number")
    return value


def _ports(items, direction):
    if not isinstance(items, list):
        raise ValueError(f"{direction}s must be a list")
    ports = []
    for index, item in enumerate(items):
        item = {"varName": item} if isinstance(item, str) else item
        if not isinstance(item, dict):
            raise ValueError(f"{direction} {index + 1} must be a name or object")
        name = _identifier(item.get("varName"), f"{direction}.varName")
        kind = item.get("type", "number")
        if kind not in {"number", "vector"}:
            raise ValueError(f"{name}.type must be number or vector")
        data_type = item.get("dataType", "vector" if kind == "vector" else "number")
        if data_type not in {"number", "float", "vector", "rf_complex_envelope"}:
            raise ValueError(f"unsupported {name}.dataType: {data_type}")
        port = {
            "portId": f"{direction}-{index}", "varName": name,
            "name": str(item.get("name", name)), "type": "vector" if kind == "vector" else "float",
        }
        if kind == "vector":
            length = item.get("vectorLength")
            if type(length) is not int or length < 1:
                raise ValueError(f"{name}.vectorLength must be a positive integer")
            port.update(dataType="vector", vectorLength=length)
        if data_type == "rf_complex_envelope":
            port["dataType"] = data_type
            if kind == "vector":
                port["collectionKind"] = "vector"
        if item.get("allowsVector") is True:
            port["allowsVector"] = True
        if item.get("unit"):
            port["unit"] = str(item["unit"])
        if item.get("side") in {"left", "right"}:
            port["side"] = item["side"]
        if type(item.get("sidePosition")) is int and item["sidePosition"] > 0:
            port["sidePosition"] = item["sidePosition"]
        for field in ("vectorElementNames", "elementNames"):
            if field in item:
                if not isinstance(item[field], list) or any(not isinstance(value, str) for value in item[field]):
                    raise ValueError(f"{name}.{field} must be a list of strings")
                port[field] = item[field]
        ports.append(port)
    names = [port["varName"] for port in ports]
    if len(set(names)) != len(names):
        raise ValueError(f"duplicate {direction} variable")
    return ports


def _parameters(items):
    if not isinstance(items, dict):
        raise ValueError("parameters must be an object keyed by Python argument name")
    contracts, frontend = {}, []
    for name, item in items.items():
        _identifier(name, "parameter key")
        if not isinstance(item, dict):
            raise ValueError(f"parameter {name} must be an object")
        kind = item.get("type", "number")
        if kind not in {"number", "integer"}:
            raise ValueError(f"parameter {name}.type must be number or integer; vector parameters are not supported by the parameter editor")
        spec = {"type": kind, "default": item.get("default", 0)}
        values = [spec["default"]]
        for value in values:
            _number(value, f"{name}.default")
            if kind == "integer" and value != int(value):
                raise ValueError(f"{name}.default must be an integer")
        for bound in ("min", "max"):
            if bound in item:
                spec[bound] = _number(item[bound], f"{name}.{bound}")
        if spec.get("min", -math.inf) > spec.get("max", math.inf):
            raise ValueError(f"{name}.min exceeds max")
        if any(value < spec.get("min", -math.inf) or value > spec.get("max", math.inf) for value in values):
            raise ValueError(f"{name}.default is outside min/max")
        if "enum" in item:
            allowed = item["enum"]
            if not isinstance(allowed, list) or not allowed:
                raise ValueError(f"{name}.enum must be a non-empty list")
            for value in allowed:
                _number(value, f"{name}.enum")
            if spec["default"] not in allowed:
                raise ValueError(f"{name}.default must be in enum")
            spec["enum"] = allowed
        contracts[name] = spec
        display = {**spec, "key": name, "name": str(item.get("name", name)), "unit": str(item.get("unit", ""))}
        if kind == "integer":
            display["step"] = 1
        if "enum" in spec:
            display["options"] = [{"value": value, "label": str(value)} for value in spec["enum"]]
        frontend.append(display)
    return contracts, frontend


def _read_component(path, package):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=path.name)
    declarations = []
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(target, ast.Name) and target.id == "COMPONENT" for target in targets):
            declarations.append(node.value)
    if len(declarations) != 1:
        raise ValueError("declare exactly one literal COMPONENT dictionary")
    metadata = ast.literal_eval(declarations[0])
    if not isinstance(metadata, dict):
        raise ValueError("COMPONENT must be a literal dictionary")
    module_id = _identifier(metadata.get("moduleId", path.stem), "moduleId")
    label = metadata.get("name")
    if not isinstance(label, str) or not label.strip():
        raise ValueError("COMPONENT.name is required")
    entry_name = _identifier(metadata.get("entryFunction", "process"), "entryFunction")
    inputs = _ports(metadata.get("inputs", []), "input")
    outputs = _ports(metadata.get("outputs", []), "output")
    if not inputs and not outputs:
        raise ValueError("declare at least one input or output")
    parameters, frontend_parameters = _parameters(metadata.get("parameters", {}))
    names = [port["varName"] for port in inputs] + list(parameters)
    if len(names) != len(set(names)) or set(names) & CONTEXT_ARGUMENTS:
        raise ValueError("inputs and parameters must be distinct and cannot use time/dt/state")
    entry = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == entry_name), None)
    if entry is None:
        raise ValueError(f"entry function {entry_name} is missing")
    arguments = entry.args
    if arguments.posonlyargs:
        raise ValueError("entry function cannot use positional-only arguments")
    accepted = {argument.arg for argument in [*arguments.args, *arguments.kwonlyargs]}
    if not arguments.kwarg and set(names) - accepted:
        raise ValueError("entry function does not accept all declared inputs/parameters")
    required = {argument.arg for argument in arguments.args[:len(arguments.args) - len(arguments.defaults)]}
    required.update(argument.arg for argument, default in zip(arguments.kwonlyargs, arguments.kw_defaults) if default is None)
    if required - set(names):
        raise ValueError("undeclared required arguments; time/dt/state must have defaults")
    record = {
        "moduleId": module_id, "importPath": f"{package}.{path.stem}", "entryFunction": entry_name,
        "inputs": [port["varName"] for port in inputs],
        "outputs": [port["varName"] for port in outputs], "parameters": parameters,
    }
    group = metadata.get("group", "simulation")
    if group not in ("simulation", "electrical"):
        raise ValueError("group must be simulation or electrical")
    replaces_builtin = metadata.get("replacesBuiltin", False)
    if type(replaces_builtin) is not bool:
        raise ValueError("replacesBuiltin must be true or false")
    palette_menu = metadata.get("paletteMenu", "")
    if not isinstance(palette_menu, str):
        raise ValueError("paletteMenu must be a string")
    category = str(metadata.get("category", "自动发现组件"))
    component = {
        "moduleId": module_id, "fileName": path.name, "entryFunction": entry_name,
        "name": label.strip(), "category": category, "group": group,
        "paletteMenu": palette_menu, "replacesBuiltin": replaces_builtin,
        "description": str(metadata.get("description", "")), "icon": str(metadata.get("icon", "仿")),
        "requiresPower": metadata.get("requiresPower", False),
        "inputs": inputs, "outputs": outputs, "parameters": frontend_parameters,
        "faultSlots": metadata.get("faultSlots", []),
    }
    if type(component["requiresPower"]) is not bool:
        raise ValueError("requiresPower must be true or false")
    if not isinstance(component["faultSlots"], list) or any(not isinstance(slot, dict) for slot in component["faultSlots"]):
        raise ValueError("faultSlots must be a list of objects")
    json.dumps(component, allow_nan=False)
    return record, component


def discover_components(existing_ids=(), directory=None, package=None, replaceable_modules=None):
    """Return records, palette definitions and per-file errors without editing manifests."""
    directory = Path(directory) if directory is not None else COMPONENT_DIRECTORY
    package = package or COMPONENT_PACKAGE
    records, components, errors = [], [], []
    known = set(existing_ids)
    discovered_ids = set()
    replaceable_modules = replaceable_modules or {}
    for path in sorted(directory.glob("*.py")):
        if path.name.startswith("_"):
            continue
        try:
            if path.is_symlink():
                raise ValueError("symbolic links are not supported")
            _identifier(path.stem, "file name")
            record, component = _read_component(path, package)
            module_id = record["moduleId"]
            if module_id in discovered_ids:
                raise ValueError(f"duplicate moduleId: {module_id}")
            if component["replacesBuiltin"]:
                original = replaceable_modules.get(module_id)
                if original is None or component["group"] != "electrical":
                    raise ValueError("replacesBuiltin requires an existing builtin electrical module")
                if (tuple(record["inputs"]) != original.inputs
                        or tuple(record["outputs"]) != original.outputs
                        or set(record["parameters"]) != set(original.parameters)):
                    raise ValueError("builtin replacement must preserve inputs, outputs and parameter names; use a new moduleId for interface changes")
            elif module_id in known:
                raise ValueError(f"duplicate moduleId: {record['moduleId']}")
            discovered_ids.add(module_id)
            records.append(record)
            components.append(component)
        except (OSError, ValueError, TypeError, SyntaxError, RecursionError) as exc:
            errors.append({"fileName": path.name, "message": str(exc)})
    return records, components, errors
