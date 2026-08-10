import { reactive } from 'vue';

const simulationState = reactive({
  initialized: false,
  running: false,
  paused: false,
  duration: 1000,
  stepSize: 0.1
});

export function useSimulationState() {
  return simulationState;
}
