import json
import unittest
from pathlib import Path

from backend.module_registry import ModuleRegistry


PACKAGE_PATH = Path(__file__).resolve().parents[2] / "public" / "model-packages" / "evtol_closed_loop_fault_demo.json"


def _walk(value):
    if isinstance(value, list):
        for item in value:
            yield from _walk(item)
    elif isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _walk(item)


class ClosedLoopPackageBindingTests(unittest.TestCase):
    def test_all_simulation_blocks_have_registered_backend_bindings(self):
        package = json.loads(PACKAGE_PATH.read_text(encoding="utf-8"))
        registry = ModuleRegistry.from_builtin_manifest()
        simulation_blocks = []
        seen_ids = set()
        for item in _walk(package):
            if item.get("type") == "simulation_block" and item.get("id") not in seen_ids:
                seen_ids.add(item.get("id"))
                simulation_blocks.append(item)

        missing = [
            f"{node.get('id')}:{node.get('props', {}).get('moduleType')}"
            for node in simulation_blocks
            if not (node.get("pythonBinding") or {}).get("moduleId")
        ]
        unregistered = [
            f"{node.get('id')}:{(node.get('pythonBinding') or {}).get('moduleId')}"
            for node in simulation_blocks
            if (node.get("pythonBinding") or {}).get("moduleId") not in registry.modules
        ]

        self.assertEqual(missing, [])
        self.assertEqual(unregistered, [])


if __name__ == "__main__":
    unittest.main()
