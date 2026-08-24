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

    def test_accepts_one_microsecond_step_size(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 0.1
        package["simulationConfig"]["stepSize"] = 0.000001

        result = validate_executable_package(package)

        self.assertIs(result, package)

    def test_accepts_a_one_picosecond_step_size(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 1e-11
        package["simulationConfig"]["stepSize"] = 1e-12

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

    def test_accepts_total_sample_count_above_the_former_limit(self):
        package = valid_package()
        package["simulationConfig"]["duration"] = 1000.0
        package["simulationConfig"]["stepSize"] = 0.0005

        result = validate_executable_package(package)

        self.assertIs(result, package)

    def test_rejects_non_numeric_parameter(self):
        package = valid_package()
        package["nodes"][0]["parameters"]["value"] = "fast"

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
        self.assertEqual(context.exception.field, "nodes[0].parameters.value")

    def test_rejects_duplicate_internal_model_ids(self):
        cases = []

        duplicate_nodes = valid_package()
        duplicate_nodes["nodes"][1]["id"] = duplicate_nodes["nodes"][0]["id"]
        cases.append((duplicate_nodes, "nodes[1].id"))

        duplicate_edges = valid_package()
        duplicate_edges["edges"][1]["id"] = duplicate_edges["edges"][0]["id"]
        cases.append((duplicate_edges, "edges[1].id"))

        duplicate_measurements = valid_package()
        duplicate_measurements["measurementPoints"].append(
            dict(duplicate_measurements["measurementPoints"][0])
        )
        cases.append((duplicate_measurements, "measurementPoints[1].id"))

        duplicate_faults = valid_package()
        duplicate_faults["faultInstances"] = [
            {"faultId": "fault-1"},
            {"faultId": "fault-1"},
        ]
        cases.append((duplicate_faults, "faultInstances[1].faultId"))

        for package, expected_field in cases:
            with self.subTest(field=expected_field):
                with self.assertRaises(SimulationBackendError) as context:
                    validate_executable_package(package)
                self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
                self.assertEqual(context.exception.field, expected_field)

    def test_rejects_missing_fault_id(self):
        package = valid_package()
        package["faultInstances"] = [{"faultType": "sensor_bias", "targetId": "sim-1"}]

        with self.assertRaises(SimulationBackendError) as context:
            validate_executable_package(package)

        self.assertEqual(context.exception.error_code, "INVALID_SCHEMA")
        self.assertEqual(context.exception.field, "faultInstances[0].faultId")


if __name__ == "__main__":
    unittest.main()
