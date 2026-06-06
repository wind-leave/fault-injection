export function getCanvasModeLabel(lineType = 'normal') {
  return lineType === 'can' ? 'CAN 总线' : '普通连接线';
}

export function getPythonBindingPortCounts(node) {
  const binding = node?.pythonBinding;
  if (!binding?.bound) {
    return {
      inputs: 1,
      outputs: 1,
      middleVars: 0
    };
  }

  return {
    inputs: binding.portMapping.inputs.length,
    outputs: binding.portMapping.outputs.length,
    middleVars: binding.portMapping.middleVars.length
  };
}
