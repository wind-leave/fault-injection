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

export function canvasNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function isFiniteCanvasPoint(point) {
  return Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function resolvePortInfo(node, direction, index = 0, options = {}) {
  if (!node) {
    return null;
  }

  const ports = options.ports || { inputs: [], outputs: [] };
  const portList = ports[direction === 'input' ? 'inputs' : 'outputs'] || [];
  const port = portList[index];
  if (!port) {
    return null;
  }

  const side = port.side || (direction === 'input' ? 'left' : 'right');
  const componentLibrary = options.componentLibrary || {};
  const meta = componentLibrary[node.type] || {};
  const nodeW = canvasNumber(node.w, canvasNumber(meta.width, 120));
  const nodeH = canvasNumber(node.h, canvasNumber(meta.height, 70));
  const nodeX = canvasNumber(node.x, 0);
  const nodeY = canvasNumber(node.y, 0);
  let localX = direction === 'input' ? 0 : nodeW;
  let localY = Math.round(nodeH / 2);

  if (side === 'top' || side === 'bottom') {
    const horizontalPorts = portList.filter((item) => (item.side || 'right') === side);
    const horizontalIndex = horizontalPorts.findIndex((item) => item.key === port.key);
    const horizontalGap = nodeW / (Math.max(horizontalPorts.length, 1) + 1);
    localX = Math.round(horizontalGap * (horizontalIndex + 1));
    localY = side === 'top' ? 0 : nodeH;
  } else {
    const sidePorts = portList.filter((item) => (item.side || (direction === 'input' ? 'left' : 'right')) === side);
    const sideIndex = sidePorts.findIndex((item) => item.key === port.key);
    const gap = nodeH / (Math.max(sidePorts.length, 1) + 1);
    localY = Math.round(gap * (sideIndex + 1));
    localX = side === 'left' ? 0 : nodeW;
  }

  return {
    ...port,
    direction,
    side,
    index,
    localX,
    localY,
    x: nodeX + localX,
    y: nodeY + localY
  };
}

export function buildEdgePath(start, end) {
  if (!isFiniteCanvasPoint(start) || !isFiniteCanvasPoint(end)) {
    return 'M 0 0 C 0 0, 0 0, 0 0';
  }

  const deltaX = Math.max(64, Math.abs(end.x - start.x) * 0.42);
  const deltaY = Math.max(48, Math.abs(end.y - start.y) * 0.38);
  const cp1 = {
    x: start.side === 'right' ? start.x + deltaX : (start.side === 'left' ? start.x - deltaX : start.x),
    y: start.side === 'top' ? start.y - deltaY : (start.side === 'bottom' ? start.y + deltaY : start.y)
  };
  const cp2 = {
    x: end.side === 'right' ? end.x + deltaX : (end.side === 'left' ? end.x - deltaX : end.x),
    y: end.side === 'top' ? end.y - deltaY : (end.side === 'bottom' ? end.y + deltaY : end.y)
  };

  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
}
