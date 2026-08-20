export const KNOWLEDGE_GRAPH_NODE_KINDS = Object.freeze([
  { value: 'fault', label: '故障' },
  { value: 'component', label: '设备' },
  { value: 'signalEdge', label: '连线' },
  { value: 'measurementPoint', label: '测点' }
]);

export const KNOWLEDGE_GRAPH_RELATION_LABELS = Object.freeze({
  OUTPUTS_TO: '输出到',
  INPUTS_TO: '输入到',
  OBSERVES: '观测',
  OCCURS_ON: '发生于',
  DETECTABILITY: '可检测性',
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

export function getKnowledgeGraphNodeKindLabel(kind) {
  return KNOWLEDGE_GRAPH_NODE_KINDS.find((item) => item.value === kind)?.label || kind || '未知';
}
