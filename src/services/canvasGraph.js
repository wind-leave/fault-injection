export function getCanvasModeLabel(lineType = 'normal') {
  if (lineType === 'power') return '电源线';
  if (lineType === 'can') return 'CAN 总线';
  return '普通连接线';
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

function sidePosition(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function resolveSideSlot(portEntries, port, side) {
  const sidePorts = portEntries.filter(({ item, defaultSide }) => (item.side || defaultSide) === side);
  const slots = new Map();
  const occupied = new Set();

  sidePorts.forEach(({ item }) => {
    const configured = sidePosition(item.sidePosition);
    if (configured && !occupied.has(configured)) {
      slots.set(item, configured);
      occupied.add(configured);
    }
  });

  let nextAvailable = 1;
  sidePorts.forEach(({ item }) => {
    if (slots.has(item)) return;
    while (occupied.has(nextAvailable)) nextAvailable += 1;
    slots.set(item, nextAvailable);
    occupied.add(nextAvailable);
  });

  return {
    slot: slots.get(port) || 1,
    slotCount: Math.max(sidePorts.length, ...occupied, 1)
  };
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
  const portEntries = [
    ...(ports.inputs || []).map((item) => ({ item, defaultSide: 'left' })),
    ...(ports.outputs || []).map((item) => ({ item, defaultSide: 'right' }))
  ];
  const componentLibrary = options.componentLibrary || {};
  const meta = componentLibrary[node.type] || {};
  const nodeW = canvasNumber(node.w, canvasNumber(meta.width, 120));
  const nodeH = canvasNumber(node.h, canvasNumber(meta.height, 70));
  const nodeX = canvasNumber(node.x, 0);
  const nodeY = canvasNumber(node.y, 0);
  let localX = direction === 'input' ? 0 : nodeW;
  let localY = Math.round(nodeH / 2);

  if (side === 'top' || side === 'bottom') {
    const placement = resolveSideSlot(portEntries, port, side);
    const horizontalGap = nodeW / (placement.slotCount + 1);
    localX = Math.round(horizontalGap * placement.slot);
    localY = side === 'top' ? 0 : nodeH;
  } else {
    const placement = resolveSideSlot(portEntries, port, side);
    const gap = nodeH / (placement.slotCount + 1);
    localY = Math.round(gap * placement.slot);
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

export function resolvePortInfos(node, options = {}) {
  const result = { inputs: [], outputs: [] };
  if (!node) return result;
  const ports = options.ports || result;
  const entries = [
    ...(ports.inputs || []).map((item, index) => ({ item, index, direction: 'input', side: item.side || 'left' })),
    ...(ports.outputs || []).map((item, index) => ({ item, index, direction: 'output', side: item.side || 'right' }))
  ];
  const bySide = new Map();
  entries.forEach((entry) => {
    if (!bySide.has(entry.side)) bySide.set(entry.side, []);
    bySide.get(entry.side).push(entry);
  });
  const meta = (options.componentLibrary || {})[node.type] || {};
  const nodeW = canvasNumber(node.w, canvasNumber(meta.width, 120));
  const nodeH = canvasNumber(node.h, canvasNumber(meta.height, 70));
  const nodeX = canvasNumber(node.x, 0);
  const nodeY = canvasNumber(node.y, 0);

  bySide.forEach((sideEntries, side) => {
    const occupied = new Set();
    sideEntries.forEach((entry) => {
      const configured = sidePosition(entry.item.sidePosition);
      if (configured && !occupied.has(configured)) {
        entry.slot = configured;
        occupied.add(configured);
      }
    });
    let nextAvailable = 1;
    sideEntries.forEach((entry) => {
      if (entry.slot) return;
      while (occupied.has(nextAvailable)) nextAvailable += 1;
      entry.slot = nextAvailable;
      occupied.add(nextAvailable);
    });
    const slotCount = Math.max(sideEntries.length, ...occupied, 1);
    sideEntries.forEach((entry) => {
      const horizontal = side === 'top' || side === 'bottom';
      const localX = horizontal
        ? Math.round(nodeW * entry.slot / (slotCount + 1))
        : side === 'left' ? 0 : nodeW;
      const localY = horizontal
        ? side === 'top' ? 0 : nodeH
        : Math.round(nodeH * entry.slot / (slotCount + 1));
      result[entry.direction === 'input' ? 'inputs' : 'outputs'][entry.index] = {
        ...entry.item,
        direction: entry.direction,
        side,
        index: entry.index,
        localX,
        localY,
        x: nodeX + localX,
        y: nodeY + localY
      };
    });
  });
  return result;
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
