import unittest

from backend.graph_compiler import compile_graph
from backend.module_registry import ModuleRegistry
from backend.schemas import SimulationBackendError
from backend.tests.fixtures import valid_package


class GraphCompilerTests(unittest.TestCase):
    def test_compiles_nodes_edges_and_scope_bindings(self):
        package = valid_package()
        graph = compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(len(graph.nodes), 3)
        self.assertEqual(len(graph.edges), 2)
        self.assertEqual(graph.measurements[0].scope_node_id, "scope-1")
        self.assertEqual(graph.nodes["sim-1"].module.module_id, "passthrough")

    def test_rejects_missing_edge_endpoint(self):
        package = valid_package()
        package["edges"][0]["targetNodeId"] = "missing-node"

        with self.assertRaises(SimulationBackendError) as context:
            compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(context.exception.error_code, "EDGE_ENDPOINT_NOT_FOUND")
        self.assertEqual(context.exception.field, "edges[0].targetNodeId")

    def test_rejects_duplicate_input_port(self):
        package = valid_package()
        package["edges"].append({
            "id": "edge-source-sim-duplicate",
            "sourceNodeId": "source-1",
            "sourcePortIndex": 0,
            "targetNodeId": "sim-1",
            "targetPortIndex": 0,
        })

        with self.assertRaises(SimulationBackendError) as context:
            compile_graph(package, ModuleRegistry.from_builtin_manifest())

        self.assertEqual(context.exception.error_code, "INPUT_PORT_CONFLICT")
        self.assertEqual(context.exception.field, "edges[2].targetPortIndex")


if __name__ == "__main__":
    unittest.main()
