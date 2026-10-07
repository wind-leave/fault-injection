export const KNOWLEDGE_GRAPH_NODE_KINDS = Object.freeze([
  { value: 'fault', label: '故障' },
  { value: 'component', label: '设备' },
  { value: 'signalEdge', label: '连线' },
  { value: 'measurementPoint', label: '测点' },
  { value: 'phenomenon', label: '现象' },
  { value: 'operationRequirement', label: '操作要求' },
  { value: 'measurementInstrument', label: '测量仪器' }
]);

export const KNOWLEDGE_GRAPH_RELATION_LABELS = Object.freeze({
  OUTPUTS_TO: '输出到',
  INPUTS_TO: '输入到',
  OBSERVES: '观测',
  OCCURS_ON: '发生于',
  DETECTABILITY: '可检测性',
  MANIFESTS_AS: '表现为',
  REQUIRES_OPERATION: '操作要求',
  ALLOWS_INSTRUMENT: '允许使用',
  RESOLVED_BY_REPLACING: '更换修复'
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function endpointKey(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return '';
  const kind = text(endpoint.kind);
  const id = text(endpoint.id);
  return kind && id ? `${kind}:${id}` : '';
}

export function normalizeKnowledgeGraph(graph) {
  const source = graph && typeof graph === 'object' ? graph : {};
  const nodesByKey = new Map();

  (Array.isArray(source.nodes) ? source.nodes : []).forEach((node) => {
    if (!node || typeof node !== 'object') return;
    const kind = text(node.kind, 'unknown');
    const id = text(node.id);
    if (!id) return;
    const key = `${kind}:${id}`;
    nodesByKey.set(key, {
      ...node,
      id,
      kind,
      key,
      label: text(node.label, id)
    });
  });

  const relations = (Array.isArray(source.relations) ? source.relations : [])
    .map((relation, index) => {
      if (!relation || typeof relation !== 'object') return null;
      const sourceKey = endpointKey(relation.source);
      const targetKey = endpointKey(relation.target);
      if (!sourceKey || !targetKey || !nodesByKey.has(sourceKey) || !nodesByKey.has(targetKey)) return null;
      const type = text(relation.type, 'RELATED_TO');
      const detectable = type === 'DETECTABILITY' ? Boolean(relation.detectable) : null;
      return {
        ...relation,
        id: `${type}:${sourceKey}:${targetKey}:${index}`,
        type,
        sourceKey,
        targetKey,
        detectable,
        label: type === 'DETECTABILITY'
          ? (detectable ? '可检测（1）' : '不可检测（0）')
          : text(KNOWLEDGE_GRAPH_RELATION_LABELS[type], type)
      };
    })
    .filter(Boolean);

  const degree = new Map([...nodesByKey.keys()].map((key) => [key, 0]));
  relations.forEach((relation) => {
    degree.set(relation.sourceKey, (degree.get(relation.sourceKey) || 0) + 1);
    degree.set(relation.targetKey, (degree.get(relation.targetKey) || 0) + 1);
  });

  return {
    nodes: [...nodesByKey.values()].map((node) => ({ ...node, degree: degree.get(node.key) || 0 })),
    relations,
    summary: source.summary && typeof source.summary === 'object' ? { ...source.summary } : {},
    source: text(source.source)
  };
}

export function createKnowledgeGraphLayout(graph, options = {}) {
  const normalized = normalizeKnowledgeGraph(graph);
  const width = Number.isFinite(options.width) ? Math.max(640, options.width) : 1200;
  const order = KNOWLEDGE_GRAPH_NODE_KINDS.map((item) => item.value);
  const presentKinds = [
    ...order.filter((kind) => normalized.nodes.some((node) => node.kind === kind)),
    ...[...new Set(normalized.nodes.map((node) => node.kind))].filter((kind) => !order.includes(kind)).sort()
  ];
  const groups = new Map(presentKinds.map((kind) => [kind, []]));
  normalized.nodes.forEach((node) => groups.get(node.kind)?.push(node));
  groups.forEach((nodes) => nodes.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')));
  const maximumRows = Math.max(1, ...[...groups.values()].map((nodes) => nodes.length));
  const height = Number.isFinite(options.height)
    ? Math.max(480, options.height)
    : Math.max(620, (maximumRows * 68) + 100);
  const columnWidth = width / Math.max(1, presentKinds.length);
  const positionedNodes = [];

  presentKinds.forEach((kind, columnIndex) => {
    const nodes = groups.get(kind) || [];
    nodes.forEach((node, rowIndex) => {
      positionedNodes.push({
        ...node,
        x: (columnIndex * columnWidth) + (columnWidth / 2),
        y: ((rowIndex + 1) * height) / (nodes.length + 1)
      });
    });
  });

  return {
    ...normalized,
    nodes: positionedNodes,
    width,
    height,
    kinds: presentKinds
  };
}

function alignRelatedColumn(nodes, parentIdForNode, parentY, height, compareSiblings) {
  const gap = 62;
  const margin = 46;
  const grouped = new Map();
  nodes.forEach((node) => {
    const parentId = parentIdForNode(node);
    const siblings = grouped.get(parentId) || [];
    siblings.push(node);
    grouped.set(parentId, siblings);
  });
  const ordered = [...grouped.entries()]
    .sort(([left], [right]) => (parentY.get(left) ?? height / 2) - (parentY.get(right) ?? height / 2))
    .flatMap(([parentId, siblings]) => siblings
      .sort(compareSiblings)
      .map((node, index) => ({
        key: node.key,
        desiredY: (parentY.get(parentId) ?? height / 2) + ((index - ((siblings.length - 1) / 2)) * gap)
      })));
  if (!ordered.length) return new Map();
  const positions = [];
  ordered.forEach(({ desiredY }, index) => {
    positions.push(Math.max(desiredY, index ? positions[index - 1] + gap : margin));
  });
  const overflow = positions.at(-1) - (height - margin);
  if (overflow > 0) positions.forEach((position, index) => { positions[index] = position - overflow; });
  if (positions[0] < margin) {
    const correction = margin - positions[0];
    positions.forEach((position, index) => { positions[index] = position + correction; });
  }
  if (positions.at(-1) > height - margin) {
    positions.forEach((position, index) => { positions[index] = margin + (index * gap); });
  }
  return new Map(ordered.map((item, index) => [item.key, positions[index]]));
}

export function createMaintenanceKnowledgeGraphLayout(graph, options = {}) {
  const layout = createKnowledgeGraphLayout(graph, options);
  const width = Math.max(800, layout.width);
  const faults = layout.nodes.filter((node) => node.kind === 'fault')
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  const entities = layout.nodes.filter((node) => node.kind === 'component' || node.kind === 'signalEdge');
  const points = layout.nodes.filter((node) => node.kind === 'measurementPoint')
    .sort((left, right) => String(left.pointCode || left.label).localeCompare(String(right.pointCode || right.label), 'zh-CN', { numeric: true }));
  const phenomena = layout.nodes.filter((node) => node.kind === 'phenomenon');
  const height = Math.max(layout.height, Math.max(faults.length, entities.length, points.length, phenomena.length, 1) * 68 + 100);
  const yByKey = new Map();
  const faultY = new Map();
  faults.forEach((node, index) => {
    const y = ((index + 1) * height) / (faults.length + 1);
    yByKey.set(node.key, y);
    faultY.set(node.id, y);
  });
  const pointY = new Map();
  points.forEach((node, index) => {
    const y = ((index + 1) * height) / (points.length + 1);
    yByKey.set(node.key, y);
    pointY.set(node.id, y);
  });
  const entityFault = new Map();
  layout.relations.forEach((relation) => {
    if ((relation.type === 'OCCURS_ON' || relation.type === 'RESOLVED_BY_REPLACING')
      && relation.source?.kind === 'fault'
      && (relation.target?.kind === 'component' || relation.target?.kind === 'signalEdge')) {
      const previous = entityFault.get(relation.targetKey);
      if (!previous || (faultY.get(relation.source.id) ?? Infinity) < (faultY.get(previous) ?? Infinity)) {
        entityFault.set(relation.targetKey, relation.source.id);
      }
    }
  });
  alignRelatedColumn(entities, (node) => entityFault.get(node.key), faultY, height,
    (left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    .forEach((y, key) => yByKey.set(key, y));
  alignRelatedColumn(phenomena, (node) => node.pointId, pointY, height,
    (left, right) => (left.phenomenonOrder ?? 0) - (right.phenomenonOrder ?? 0))
    .forEach((y, key) => yByKey.set(key, y));
  const columnX = { fault: width * 0.12, component: width * 0.36, signalEdge: width * 0.36, measurementPoint: width * 0.62, phenomenon: width * 0.86 };
  return {
    ...layout,
    width,
    height,
    nodes: layout.nodes.map((node) => ({ ...node, x: columnX[node.kind] ?? node.x, y: yByKey.get(node.key) ?? node.y }))
  };
}

export function createSpecificationKnowledgeGraphLayout(graph, options = {}) {
  const layout = createKnowledgeGraphLayout(graph, options);
  const width = Math.max(800, layout.width);
  const devices = layout.nodes.filter((node) => node.kind === 'component')
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  const requirements = layout.nodes.filter((node) => node.kind === 'operationRequirement');
  const instruments = layout.nodes.filter((node) => node.kind === 'measurementInstrument');
  const height = Math.max(layout.height, Math.max(devices.length, requirements.length, instruments.length, 1) * 68 + 100);
  const deviceY = new Map();
  devices.forEach((node, index) => deviceY.set(node.id, ((index + 1) * height) / (devices.length + 1)));
  const byOrder = (left, right) => (left.itemOrder ?? 0) - (right.itemOrder ?? 0);
  const requirementY = alignRelatedColumn(requirements, (node) => node.deviceId, deviceY, height, byOrder);
  const instrumentY = alignRelatedColumn(instruments, (node) => node.deviceId, deviceY, height, byOrder);
  return {
    ...layout,
    width,
    height,
    nodes: layout.nodes.map((node) => {
      if (node.kind === 'component') return { ...node, x: width * 0.5, y: deviceY.get(node.id) };
      if (node.kind === 'operationRequirement') return { ...node, x: width * 0.18, y: requirementY.get(node.key) ?? node.y };
      if (node.kind === 'measurementInstrument') return { ...node, x: width * 0.82, y: instrumentY.get(node.key) ?? node.y };
      return node;
    })
  };
}

export function getKnowledgeGraphNodeKindLabel(kind) {
  return KNOWLEDGE_GRAPH_NODE_KINDS.find((item) => item.value === kind)?.label || kind || '未知';
}
