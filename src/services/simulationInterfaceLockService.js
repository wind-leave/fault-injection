const PORT_KINDS = ['inputs', 'outputs', 'middleVars'];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isSimulationBlock(node) {
  return node?.type === 'simulation_block';
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function getDefinition(node) {
  return {
    name: String(node?.props?.name ?? ''),
    ports: Object.fromEntries(PORT_KINDS.map((kind) => [
      kind,
      clone(list(node?.props?.[kind]))
    ])),
    pythonPortMapping: Object.fromEntries(PORT_KINDS.map((kind) => [
      kind,
      clone(list(node?.pythonBinding?.portMapping?.[kind]))
    ]))
  };
}

function applyDefinition(node, definition) {
  const next = clone(node);
  next.props = {
    ...(next.props ?? {}),
    name: definition.name
  };
  PORT_KINDS.forEach((kind) => {
    next.props[kind] = clone(definition.ports?.[kind] ?? []);
  });

  if (next.pythonBinding?.bound) {
    next.pythonBinding.portMapping = {
      ...(next.pythonBinding.portMapping ?? {}),
      ...Object.fromEntries(PORT_KINDS.map((kind) => [
        kind,
        clone(definition.pythonPortMapping?.[kind] ?? [])
      ]))
    };
  }

  next.simulationInterfaceDefinition = clone(definition);
  return next;
}

function collectNodes(snapshot = {}) {
  const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const nodes = [];
  const seenIds = new Set();
  const append = (items) => {
    list(items).forEach((node) => {
      if (!node || (node.id && seenIds.has(node.id))) {
        return;
      }
      if (node.id) {
        seenIds.add(node.id);
      }
      nodes.push(node);
    });
  };

  append(safeSnapshot.modelNodes);
  Object.values(safeSnapshot.canvases ?? {}).forEach((canvas) => append(canvas?.nodes));
  return nodes;
}

function lockNode(node, definition) {
  if (!isSimulationBlock(node)) {
    return clone(node);
  }
  return applyDefinition(node, definition ?? node.simulationInterfaceDefinition ?? getDefinition(node));
}

function lockNodeCollection(nodes, definitionsById) {
  return list(nodes).map((node) => lockNode(node, definitionsById.get(node?.id)));
}

export function initializeSimulationInterfaceLock(node, { replace = false } = {}) {
  if (!isSimulationBlock(node)) {
    return clone(node);
  }
  const definition = !replace && node.simulationInterfaceDefinition
    ? node.simulationInterfaceDefinition
    : getDefinition(node);
  return applyDefinition(node, definition);
}

export function lockSimulationInterfaces(snapshot = {}, { existingSnapshot = null } = {}) {
  const definitionsById = new Map(
    collectNodes(existingSnapshot)
      .filter(isSimulationBlock)
      .map((node) => {
        const locked = initializeSimulationInterfaceLock(node);
        return [locked.id, locked.simulationInterfaceDefinition];
      })
  );
  const next = clone(snapshot);
  next.modelNodes = lockNodeCollection(next.modelNodes, definitionsById);

  if (next.canvases && typeof next.canvases === 'object' && !Array.isArray(next.canvases)) {
    next.canvases = Object.fromEntries(Object.entries(next.canvases).map(([canvasId, canvas]) => [
      canvasId,
      {
        ...canvas,
        nodes: lockNodeCollection(canvas?.nodes, definitionsById)
      }
    ]));
  }

  return next;
}
