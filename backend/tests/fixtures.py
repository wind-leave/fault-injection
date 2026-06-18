def valid_package():
    return {
        "schemaVersion": 1,
        "packageId": "test-package",
        "simulationConfig": {"duration": 0.3, "stepSize": 0.1},
        "nodes": [
            {
                "id": "source-1",
                "type": "signal_source",
                "parameters": {"value": 1.0},
                "outputs": [{"name": "out"}],
            },
            {
                "id": "sim-1",
                "type": "simulation_block",
                "pythonBinding": {"moduleId": "passthrough", "entryFunction": "process"},
                "parameters": {},
                "inputs": [{"name": "input"}],
                "outputs": [{"name": "output"}],
            },
            {
                "id": "scope-1",
                "type": "instrument_scope",
                "inputs": [{"name": "CH1"}],
            },
        ],
        "edges": [
            {
                "id": "edge-source-sim",
                "sourceNodeId": "source-1",
                "sourcePortIndex": 0,
                "targetNodeId": "sim-1",
                "targetPortIndex": 0,
            },
            {
                "id": "edge-sim-scope",
                "sourceNodeId": "sim-1",
                "sourcePortIndex": 0,
                "targetNodeId": "scope-1",
                "targetPortIndex": 0,
            },
        ],
        "faultInstances": [],
        "measurementPoints": [{"id": "scope-1.ch1", "scopeNodeId": "scope-1", "channel": "ch1"}],
    }
