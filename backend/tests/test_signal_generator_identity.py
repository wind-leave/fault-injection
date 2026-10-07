import unittest
from types import SimpleNamespace

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.practice import PracticeSession
from backend.tests.fixtures import valid_package


class SignalGeneratorIdentityTests(unittest.TestCase):
    def test_public_generator_id_resolves_to_internal_node_id(self):
        package = valid_package()
        package["nodes"][0]["id"] = "node-1"
        package["nodes"][0]["componentId"] = "XHFSQ"
        package["nodes"][0]["outputs"][0]["id"] = "XHFSQ_X1"
        package["edges"][0]["sourceNodeId"] = "node-1"
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())
        practice = SimpleNamespace(simulation_session=SimpleNamespace(graph=graph))

        self.assertEqual(graph.nodes["node-1"].component_id, "XHFSQ")
        self.assertEqual(PracticeSession._simulation_result_device_id(practice, "node-1"), "XHFSQ")
        self.assertEqual(PracticeSession._simulation_result_device_id(practice, "sim-1"), "passthrough")
        resolved, node_id = PracticeSession._resolve_component_module_target(
            practice, {"target": {"type": "component", "id": "XHFSQ"}}
        )
        self.assertEqual(node_id, "node-1")
        self.assertEqual(resolved["target"], {"type": "component", "id": "node-1"})


if __name__ == "__main__":
    unittest.main()
