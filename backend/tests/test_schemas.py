import unittest

from backend.schemas import SimulationBackendError, validate_executable_package
from backend.tests.fixtures import valid_package


class SchemaValidationTests(unittest.TestCase):
    def test_accepts_valid_executable_package(self):
        package = valid_package()

        result = validate_executable_package(package)

        self.assertIs(result, package)

    def test_accepts_frontend_default_duration_limit(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 1000

        result = validate_executable_package(package)

        self.assertIs(result, package)

    def test_rejects_unsupported_node_type(self):
        package = valid_package()
        package["nodes"].append({"id": "bad-1", "type": "ui_panel"})

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "UNSUPPORTED_NODE_TYPE")
        self.assertEqual(context.exception.field, "nodes[3].type")

    def test_rejects_invalid_duration_limit(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 1000.1

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "SIMULATION_LIMIT_EXCEEDED")
        self.assertEqual(context.exception.field, "simulationConfig.duration")

    def test_rejects_non_numeric_parameter(self):
        package = valid_package()
        package["nodes"][0]["parameters"]["value"] = "fast"

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
        self.assertEqual(context.exception.field, "nodes[0].parameters.value")


if __name__ == "__main__":
    unittest.main()
