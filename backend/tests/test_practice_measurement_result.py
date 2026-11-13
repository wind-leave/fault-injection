import unittest
from types import SimpleNamespace

from backend.practice import PracticeSession


class PracticeMeasurementResultTests(unittest.TestCase):
    def test_complex_envelope_samples_use_initial_export_interval_format(self):
        session = object.__new__(PracticeSession)
        session.simulation_session = SimpleNamespace(graph=SimpleNamespace(
            nodes={"rf-node": SimpleNamespace(module=None, component_id="")},
            edges=[], measurements=[], duration=6, step_size=1,
        ))
        session.troubleshooting = SimpleNamespace(d_matrix={"points": [{
            "pointId": "tp-envelope",
            "shortName": "E1",
            "pointType": "physical",
            "channel": "rf-output",
            "measurementSourceNodeId": "rf-node",
            "sourcePort": "output_envelope",
        }]})
        session._current_condition_values = lambda: {}
        a = {"i": 1, "q": 0, "referenceFrequencyHz": 10e9}
        b = {"i": 1, "q": 0.5, "referenceFrequencyHz": 10e9}
        c = {"i": 1, "q": 0.5, "referenceFrequencyHz": 11e9}
        values = [a, a, a, b, c, c]
        result = session._build_measurement_result({
            "curves": {"time": [0, 1, 2, 3, 4, 5], "channels": {}},
            "componentOutputs": {"steps": [
                {"actual": {"rf-node": {"output_envelope": value}}} for value in values
            ]},
            "metrics": {"sampleCount": 6, "done": True},
        })

        self.assertEqual(result["physicalMeasurements"][0]["samples"], [
            {"time": 0, "actual": a, "constantRangeBoundary": "start"},
            {"time": 2, "actual": a, "constantRangeBoundary": "end"},
            {"time": 3, "actual": b, "constantRangeBoundary": "single"},
            {"time": 4, "actual": c, "constantRangeBoundary": "start"},
            {"time": 5, "actual": c, "constantRangeBoundary": "end"},
        ])
        self.assertEqual(result["summary"]["sampleCount"], 6)

    def test_vector_measurement_selects_its_complex_envelope_element(self):
        session = object.__new__(PracticeSession)
        session.simulation_session = SimpleNamespace(graph=SimpleNamespace(
            nodes={"rf-node": SimpleNamespace(module=None, component_id="")},
            edges=[], measurements=[], duration=3, step_size=1,
        ))
        session.troubleshooting = SimpleNamespace(d_matrix={"points": [{
            "pointId": "tp-vector",
            "shortName": "E2",
            "pointType": "virtual",
            "channel": "rf-vector",
            "measurementSourceNodeId": "rf-node",
            "sourcePort": "output_envelope_vector",
            "vectorIndex": 1,
        }]})
        session._current_condition_values = lambda: {}
        selected = {"i": 0, "q": 1, "referenceFrequencyHz": 10e9}
        other = {"i": 1, "q": 0, "referenceFrequencyHz": 10e9}
        result = session._build_measurement_result({
            "curves": {"time": [0, 1, 2], "channels": {}},
            "componentOutputs": {"steps": [
                {"actual": {"rf-node": {"output_envelope_vector": [other, selected]}}}
                for _ in range(3)
            ]},
            "metrics": {"sampleCount": 3, "done": True},
        })

        self.assertEqual(result["virtualMeasurements"][0]["samples"], [
            {"time": 0, "actual": selected, "constantRangeBoundary": "start"},
            {"time": 2, "actual": selected, "constantRangeBoundary": "end"},
        ])


if __name__ == "__main__":
    unittest.main()
