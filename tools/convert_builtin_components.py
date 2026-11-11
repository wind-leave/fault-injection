"""Convert builtin Python modules into single-file auto-discovered components.

Run from any directory: python <project>/tools/convert_builtin_components.py
No packages are downloaded. Node.js reads the existing frontend port contracts;
Python's standard library copies source and emits/validates literal metadata.
Manifest records with autoConvert=false are excluded; new records default to enabled.
"""

import argparse
import ast
import copy
import importlib.util
import json
import keyword
import os
from pathlib import Path
import pprint
import re
import subprocess
import sys
import tempfile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.component_discovery import _read_component


EXPORT_FRONTEND = """
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { COMPONENT_REGISTRY, getPaletteGroups, getSimulationMenuSections, getElectricalMenuSections } = await import(pathToFileURL(path.join(process.argv[1], 'src/services/componentRegistry.js')).href);
const groups = getPaletteGroups();
const menus = {
  simulation: getSimulationMenuSections(groups.find(group => group.id === 'simulation')?.components || []),
  electrical: getElectricalMenuSections(groups.find(group => group.id === 'electrical')?.components || [])
};
const definitions = {};
for (const item of Object.values(COMPONENT_REGISTRY)) {
  const moduleId = item.pythonBinding?.moduleId;
  if (!moduleId) continue;
  if (definitions[moduleId] && item.palette?.visible === false) continue;
  const menuId = item.paletteMenu ?? item.simulationMenu ?? 'uncategorized';
  const menu = menus[item.group]?.find(section => section.id === menuId)
    || (item.group === 'electrical' ? getElectricalMenuSections([item]) : getSimulationMenuSections([item]))[0];
  definitions[moduleId] = {
    name: item.label, templateId: item.templateId || item.type,
    description: item.description || item.title || '',
    group: item.group, paletteMenu: menu?.id,
    category: menu?.label || item.defaults?.moduleType,
    icon: item.palette?.icon || '仿',
    requiresPower: item.defaults?.requiresPower === true && (item.defaults?.powerInputs?.length || 0) > 0,
    inputs: item.ports?.inputs || [], outputs: item.ports?.outputs || [],
    parameters: item.defaults?.parameters || [], faultSlots: item.faultSlots || []
  };
}
console.log(JSON.stringify(definitions));
"""


def read_frontend_metadata(root, node="node"):
    try:
        result = subprocess.run(
            [node, "--input-type=module", "-e", EXPORT_FRONTEND, str(root)],
            check=True, capture_output=True, encoding="utf-8", timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        detail = getattr(exc, "stderr", None) or str(exc)
        raise ValueError(f"Cannot read frontend interfaces with Node.js: {detail}. Use --frontend-json with an exported metadata file.") from exc
    return json.loads(result.stdout)


def _convert_port(port):
    result = {"varName": port["varName"], "name": port.get("displayName") or port.get("name") or port["varName"]}
    vector = port.get("collectionKind") == "vector" or port.get("type") == "vector" or port.get("dataType") == "vector"
    result["type"] = "vector" if vector else "number"
    if vector:
        result["vectorLength"] = port.get("vectorLength")
    if port.get("dataType") == "rf_complex_envelope":
        result["dataType"] = "rf_complex_envelope"
    elif port.get("dataType") not in (None, "float", "number", "vector"):
        raise ValueError(f"unsupported port type: {port['dataType']}")
    for key in ("portId", "unit", "side", "sidePosition", "allowsVector", "vectorElementNames", "elementNames"):
        if key in port:
            result[key] = copy.deepcopy(port[key])
    return result


def build_metadata(record, template, new_id):
    warnings = []
    metadata = {
        "moduleId": new_id,
        "templateId": template.get("templateId", new_id) if new_id == record["moduleId"] else new_id,
        "replacesBuiltin": new_id == record["moduleId"],
        "name": template.get("name", record["moduleId"]),
        "category": template.get("category") or template.get("paletteMenuLabel") or template.get("simulationMenuLabel") or "内置组件转换",
        "group": template.get("group", "simulation"),
        "description": template.get("description", ""),
        "icon": template.get("icon", "仿"),
        "entryFunction": record.get("entryFunction", "process"),
        "requiresPower": template.get("requiresPower", False),
    }
    palette_menu = template.get("paletteMenu") or template.get("simulationMenu")
    if palette_menu:
        metadata["paletteMenu"] = palette_menu
    for field in ("inputs", "outputs"):
        declared = record.get(field, [])
        ports = template.get(field)
        if ports is None:
            metadata[field] = [{"varName": name, "name": name} for name in declared]
        else:
            by_name = {port["varName"]: port for port in ports}
            if len(by_name) != len(ports) or set(declared) != set(by_name):
                raise ValueError(f"frontend and manifest disagree on {field}; supply corrected metadata with --overrides")
            metadata[field] = [_convert_port(by_name[name]) for name in declared]
    if any(field not in template for field in ("inputs", "outputs", "requiresPower")):
        warnings.append("Incomplete frontend template: missing port definitions default to scalar/variable labels, missing requiresPower defaults to false; review before use.")
    display_parameters = {item["key"]: item for item in template.get("parameters", [])}
    parameters = copy.deepcopy(record.get("parameters", {}))
    for name, parameter in parameters.items():
        display = display_parameters.get(name, {})
        parameter["name"] = display.get("name", name)
        if display.get("unit"):
            parameter["unit"] = display["unit"]
        if display.get("options"):
            parameter["options"] = copy.deepcopy(display["options"])
        if display.get("control") == "stepper":
            parameter["control"] = "stepper"
    metadata["parameters"] = parameters
    metadata["faultSlots"] = copy.deepcopy(template.get("faultSlots", []))
    return metadata, warnings


def add_declaration(source, metadata, source_package):
    """Keep docstrings/future imports legal and resolve relative helper imports."""
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    replacements = []
    entry_name = metadata.get("entryFunction", "process")
    if sum(isinstance(node, ast.FunctionDef) and node.name == entry_name for node in tree.body) != 1:
        raise ValueError(f"source must have exactly one top-level {entry_name} function")
    for node in tree.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(target, ast.Name) and target.id == "COMPONENT" for target in targets):
            raise ValueError("source already declares COMPONENT; convert it manually to avoid replacing existing metadata")
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level:
            module = importlib.util.resolve_name("." * node.level + (node.module or ""), source_package)
            names = ", ".join(f"{item.name} as {item.asname}" if item.asname else item.name for item in node.names)
            # AST column offsets are UTF-8 bytes. Preserve indentation and any
            # semicolon-separated statements/comments on the same source line.
            first, last = lines[node.lineno - 1], lines[node.end_lineno - 1]
            prefix = first.encode("utf-8")[:node.col_offset].decode("utf-8")
            suffix = last.encode("utf-8")[node.end_col_offset:].decode("utf-8")
            replacements.append((node.lineno - 1, node.end_lineno, f"{prefix}from {module} import {names}{suffix}"))
    for start, end, replacement in sorted(replacements, reverse=True):
        lines[start:end] = [replacement]
    source = "".join(lines)
    tree = ast.parse(source)
    insertion_line = 0
    for index, node in enumerate(tree.body):
        is_docstring = index == 0 and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)
        if is_docstring or isinstance(node, ast.ImportFrom) and node.module == "__future__":
            insertion_line = node.end_lineno
        else:
            break
    # Preserve leading encoding/shebang comments when there is no docstring.
    if not insertion_line and tree.body:
        insertion_line = tree.body[0].lineno - 1
    lines = source.splitlines(keepends=True)
    declaration = "\n# Generated by tools/convert_builtin_components.py\nCOMPONENT = " + pprint.pformat(metadata, width=100, sort_dicts=False) + "\n\n"
    if insertion_line and not lines[insertion_line - 1].endswith("\n"):
        lines[insertion_line - 1] += "\n"
    lines.insert(insertion_line, declaration)
    generated = "".join(lines)
    compile(generated, "<converted component>", "exec")
    return generated.rstrip() + "\n"


def convert_components(root=PROJECT_ROOT, output_dir=None, selected=None, prefix="", overwrite=False,
                       frontend=None, overrides=None, node="node"):
    root = Path(root).resolve()
    source_dir = root / "backend" / "builtin_modules"
    output_dir = Path(output_dir or root / "output" / "converted_components").resolve()
    if output_dir.is_relative_to(source_dir.resolve()):
        raise ValueError("output directory must be outside builtin_modules")
    if prefix and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", prefix):
        raise ValueError("non-empty prefix must start with an ASCII letter and contain only letters, digits, underscores")
    records = json.loads((source_dir / "manifest.json").read_text(encoding="utf-8"))["modules"]
    frontend = read_frontend_metadata(root, node) if frontend is None else frontend
    overrides = overrides or {}
    if not isinstance(frontend, dict) or any(not isinstance(value, dict) for value in frontend.values()):
        raise ValueError("frontend metadata must map module IDs to objects")
    if not isinstance(overrides, dict) or any(not isinstance(value, dict) for value in overrides.values()):
        raise ValueError("overrides must map module IDs to objects")
    selected = set(selected or ())
    known_ids = {record["moduleId"] for record in records}
    unknown = selected - known_ids
    if unknown:
        raise ValueError(f"unknown manifest module IDs: {', '.join(sorted(unknown))}")
    output_dir.mkdir(parents=True, exist_ok=True)
    init_path = output_dir / "__init__.py"
    if not init_path.exists():
        init_path.write_text('"""Generated auto-discovered components."""\n', encoding="utf-8")
    report = {"source": str(source_dir), "output": str(output_dir), "components": [], "unregisteredFiles": []}
    used_ids = set()
    used_files = set()
    registered_files = set()
    for record in records:
        module_id = record["moduleId"]
        import_path = record["importPath"]
        if import_path.startswith("backend.builtin_modules."):
            registered_files.add(import_path[len("backend.builtin_modules."):].replace(".", "/") + ".py")
        if selected and module_id not in selected:
            continue
        item = {"originalModuleId": module_id, "status": "failed"}
        report["components"].append(item)
        temporary_path = None
        try:
            auto_convert = record.get("autoConvert", True)
            if type(auto_convert) is not bool:
                raise ValueError("manifest autoConvert must be true or false")
            if not auto_convert:
                item.update(status="excluded", reason="autoConvert is false in manifest; automatic conversion is disabled")
                continue
            relative = import_path.removeprefix("backend.builtin_modules.")
            if not import_path.startswith("backend.builtin_modules.") or any(not part.isidentifier() for part in relative.split(".")):
                raise ValueError("importPath must point inside backend.builtin_modules")
            source_path = source_dir.joinpath(*relative.split(".")).with_suffix(".py")
            if not source_path.resolve().is_relative_to(source_dir.resolve()):
                raise ValueError("source resolves outside builtin_modules")
            new_id = prefix + re.sub(r"[^A-Za-z0-9_]", "_", module_id) if prefix else module_id
            if new_id in used_ids or (prefix and new_id in known_ids):
                raise ValueError(f"generated moduleId conflicts: {new_id}")
            used_ids.add(new_id)
            # Module IDs are public strings, not Python module names (e.g. "11").
            # Only the file name needs to be a valid, discoverable Python name.
            file_stem = new_id if new_id.isidentifier() and not keyword.iskeyword(new_id) and not new_id.startswith("_") else source_path.stem
            if not file_stem.isidentifier() or keyword.iskeyword(file_stem) or file_stem.startswith("_"):
                file_stem = "component_" + re.sub(r"[^A-Za-z0-9_]", "_", new_id)
            if file_stem in used_files:
                raise ValueError(f"generated file name conflicts: {file_stem}.py")
            used_files.add(file_stem)
            target = output_dir / f"{file_stem}.py"
            if target.is_symlink():
                raise ValueError("destination is a symbolic link; refusing to replace it")
            item.update(moduleId=new_id, fileName=target.name)
            template = copy.deepcopy(frontend.get(module_id, {}))
            template.update(overrides.get(module_id, {}))
            metadata, warnings = build_metadata(record, template, new_id)
            source = source_path.read_text(encoding="utf-8-sig")
            generated = add_declaration(source, metadata, import_path.rsplit(".", 1)[0])
            # Validate with the same reader used by server startup, before publishing.
            descriptor, name = tempfile.mkstemp(prefix=".converting-", suffix=".py", dir=output_dir)
            temporary_path = Path(name)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(generated)
            _read_component(temporary_path, "backend.auto_components")
            item["warnings"] = warnings
            if target.exists() and target.read_text(encoding="utf-8") == generated:
                item["status"] = "unchanged"
            elif target.exists() and not overwrite:
                item.update(status="skipped", reason="destination exists; use --overwrite to replace it")
            else:
                os.replace(temporary_path, target)
                temporary_path = None
                item["status"] = "generated"
        except (OSError, ValueError, TypeError, KeyError, SyntaxError) as exc:
            item["error"] = str(exc)
        finally:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
    report["unregisteredFiles"] = [
        {"fileName": path.name, "reason": "not in manifest; no reliable input/output/parameter contract, not converted"}
        for path in sorted(source_dir.glob("*.py")) if not path.name.startswith("_") and path.name not in registered_files
    ]
    report["summary"] = {status: sum(item["status"] == status for item in report["components"])
                         for status in ("generated", "unchanged", "skipped", "excluded", "failed")}
    (output_dir / "conversion-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--module", action="append", dest="selected", help="manifest module ID; repeat to select multiple; autoConvert=false entries remain excluded (default: all enabled entries)")
    parser.add_argument("--output-dir", type=Path, help="default: <project>/output/converted_components; use backend/auto_components to activate")
    parser.add_argument("--id-prefix", default="", help="optional prefix for new IDs; by default preserve original moduleId and templateId")
    parser.add_argument("--overwrite", action="store_true", help="replace existing generated files; default is to keep them")
    parser.add_argument("--frontend-json", type=Path, help="pre-exported frontend metadata; avoids invoking Node.js")
    parser.add_argument("--overrides", type=Path, help="JSON mapping module ID to corrected frontend metadata")
    parser.add_argument("--node", default="node", help="Node.js executable path")
    args = parser.parse_args(argv)
    try:
        frontend = json.loads(args.frontend_json.read_text(encoding="utf-8-sig")) if args.frontend_json else None
        overrides = json.loads(args.overrides.read_text(encoding="utf-8-sig")) if args.overrides else None
        report = convert_components(output_dir=args.output_dir, selected=args.selected, prefix=args.id_prefix,
                                    overwrite=args.overwrite, frontend=frontend, overrides=overrides, node=args.node)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(2, f"Conversion failed: {exc}\n")
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"Report: {Path(report['output']) / 'conversion-report.json'}")
    for item in report["components"]:
        if item["status"] in {"failed", "skipped"}:
            print(f"{item['status']}: {item['originalModuleId']}: {item.get('error') or item.get('reason')}")
    for item in report["unregisteredFiles"]:
        print(f"unregistered: {item['fileName']}: {item['reason']}")
    return 1 if report["summary"]["failed"] or report["summary"]["skipped"] else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
