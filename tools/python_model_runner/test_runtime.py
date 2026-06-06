import unittest
from types import MappingProxyType
from unittest import mock

import tools.python_model_runner.runtime as runtime
from tools.python_model_runner.runtime import execute_payload


class ExecutePayloadTests(unittest.TestCase):
    def test_executes_embedded_module_source(self):
        payload = {
            "entryFunction": "process",
            "inputs": {"error": 0.5, "dt": 0.1},
            "outputNames": ["output_0"],
            "middleVarNames": ["half_error"],
            "source": (
                "def process(error, dt=0.1):\n"
                "    half_error = error * 0.5\n"
                "    return (error + dt, {'half_error': half_error})\n"
            ),
        }

        result = execute_payload(payload)

        self.assertEqual(result["outputs"]["output_0"], 0.6)
        self.assertEqual(result["middleVars"]["half_error"], 0.25)

    def test_rejects_import_statements(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": [],
            "source": (
                "import os\n"
                "def process():\n"
                "    return 1\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "import statements are not allowed"):
            execute_payload(payload)

    def test_rejects_dunder_attribute_access(self):
        payload = {
            "entryFunction": "process",
            "inputs": {"error": 0.5},
            "outputNames": ["output_0"],
            "middleVarNames": [],
            "source": (
                "def process(error):\n"
                "    return error.__class__.__name__\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "dunder|attribute"):
            execute_payload(payload)

    def test_rejects_non_finite_outputs(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": [],
            "source": (
                "def process():\n"
                "    return float('nan')\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "non-finite"):
            execute_payload(payload)

    def test_rejects_non_numeric_output_scalars(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": ["half_error"],
            "source": (
                "def process():\n"
                "    return ('bad-output', {'half_error': 'bad-middle'})\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "numeric scalar"):
            execute_payload(payload)

    def test_rejects_non_serializable_output_values(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": ["half_error"],
            "source": (
                "def process():\n"
                "    return ({1, 2}, {'half_error': {3, 4}})\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "numeric scalar"):
            execute_payload(payload)

    def test_builds_isolated_builtins_mapping(self):
        builtins_mapping = runtime.build_builtins_mapping()
        builtins_mapping["abs"] = "mutated"

        self.assertIsNot(builtins_mapping, runtime.ALLOWED_BUILTINS)
        self.assertIs(runtime.ALLOWED_BUILTINS["abs"], abs)
        self.assertIsInstance(runtime.ALLOWED_BUILTINS, MappingProxyType)

    def test_exported_builtins_allowlist_is_immutable(self):
        with self.assertRaises(TypeError):
            runtime.ALLOWED_BUILTINS["eval"] = "mutated"

    def test_rejects_non_dict_payloads(self):
        with self.assertRaisesRegex(RuntimeError, "payload must be a JSON object"):
            execute_payload([])

    def test_times_out_isolated_execution(self):
        payload = {
            "entryFunction": "process",
            "inputs": {},
            "outputNames": ["output_0"],
            "middleVarNames": [],
            "source": (
                "def process():\n"
                "    while True:\n"
                "        pass\n"
            ),
        }

        with self.assertRaisesRegex(RuntimeError, "timed out"):
            runtime.execute_payload_isolated(payload, timeout_seconds=0.2)

    def test_timeout_path_closes_queue_resources(self):
        fake_queue = mock.Mock()
        fake_process = mock.Mock()
        fake_process.is_alive.return_value = True
        fake_context = mock.Mock()
        fake_context.Queue.return_value = fake_queue
        fake_context.Process.return_value = fake_process

        with mock.patch.object(runtime.multiprocessing, "get_context", return_value=fake_context):
            with self.assertRaisesRegex(RuntimeError, "timed out"):
                runtime.execute_payload_isolated({"source": "def process():\n    return 1\n"}, timeout_seconds=0.01)

        fake_queue.close.assert_called_once_with()
        fake_queue.join_thread.assert_called_once_with()
        fake_process.terminate.assert_called_once_with()
        self.assertEqual(fake_process.join.call_count, 2)


if __name__ == "__main__":
    unittest.main()
