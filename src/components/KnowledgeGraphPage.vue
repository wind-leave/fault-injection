<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  KNOWLEDGE_GRAPH_NODE_KINDS,
  KNOWLEDGE_GRAPH_RELATION_LABELS,
  createKnowledgeGraphLayout,
  createMaintenanceKnowledgeGraphLayout,
  createSpecificationKnowledgeGraphLayout,
  getKnowledgeGraphNodeKindLabel
} from '../services/knowledgeGraphLayout.js';
import { exportKnowledgeGraphSvg } from '../services/knowledgeGraphExportService.js';
import { createWorkbenchSnapshot } from '../services/workbenchSnapshotService.js';

const isOpen = ref(false);
const graph = ref(null);
const selectedNodeKey = ref('');
const expandedSpecificationDeviceId = ref('');
const expandedMaintenanceFaultId = ref('');
const viewMode = ref('entity');
const nodeKindFilter = ref('all');
const relationTypeFilter = ref('all');
const query = ref('');
const showNegativeDetectability = ref(false);
const showRelationLabels = ref(false);
const viewport = ref({ x: 0, y: 0, scale: 1 });
const svgRef = ref(null);
const viewportGroupRef = ref(null);
const exportStatus = ref('');
const phenomenonDrafts = ref({});
const phenomenonNotices = ref({});
const specificationDrafts = ref({ operationRequirements: '', allowedInstruments: '' });
const specificationNotices = ref({});
let panState = null;

const entityNodeKinds = new Set(['component', 'signalEdge']);
const entityRelationTypes = new Set(['OUTPUTS_TO', 'INPUTS_TO']);
const maintenanceBaseNodeKinds = new Set(['fault', 'measurementPoint']);
const maintenanceNodeKinds = new Set(['fault', 'component', 'signalEdge', 'measurementPoint', 'phenomenon']);
const specificationNodeKinds = new Set(['component', 'operationRequirement', 'measurementInstrument']);
const specificationFields = [
  { field: 'operationRequirements', kind: 'operationRequirement', relation: 'REQUIRES_OPERATION', label: '操作要求', placeholder: '例如：断电后检查输入端子' },
  { field: 'allowedInstruments', kind: 'measurementInstrument', relation: 'ALLOWS_INSTRUMENT', label: '允许使用的测量仪器', placeholder: '例如：数字万用表' }
];

function withDeviceSpecificationNodes(source, selectedDeviceId = '') {
  const nodes = [...(Array.isArray(source.nodes) ? source.nodes : [])];
  const relations = [...(Array.isArray(source.relations) ? source.relations : [])];
  nodes.filter((node) => node.kind === 'component' && (!selectedDeviceId || node.id === selectedDeviceId))
    .forEach((device) => {
      specificationFields.forEach(({ field, kind, relation }) => {
        (Array.isArray(device[field]) ? device[field] : []).forEach((value, index) => {
          const label = String(value ?? '').trim();
          if (!label) return;
          const id = JSON.stringify([device.id, kind, index]);
          nodes.push({ kind, id, label, deviceId: device.id, itemOrder: index });
          relations.push({ type: relation, source: { kind: 'component', id: device.id }, target: { kind, id } });
        });
      });
    });
  return { ...source, nodes, relations };
}

function applyDeviceSpecifications(source) {
  const saved = window.__GZ_STATE__?.diagnosticModel?.deviceSpecifications;
  if (!saved || !Array.isArray(source?.nodes)) return source;
  return {
    ...source,
    nodes: source.nodes.map((node) => {
      if (node?.kind !== 'component' || !saved[node.id]) return node;
      const specification = saved[node.id];
      return {
        ...node,
        operationRequirements: Array.isArray(specification.operationRequirements) ? specification.operationRequirements : [],
        allowedInstruments: Array.isArray(specification.allowedInstruments) ? specification.allowedInstruments : []
      };
    })
  };
}

function saveDeviceSpecificationDirectly(deviceId, field, entries) {
  const state = window.__GZ_STATE__;
  if (!state || !graph.value?.nodes?.some((node) => node.kind === 'component' && node.id === deviceId)) {
    return { ok: false, message: '设备模型尚未就绪，请重新打开图谱。' };
  }
  if (!specificationFields.some((item) => item.field === field)) {
    return { ok: false, message: '请选择操作要求或测量仪器。' };
  }
  const normalized = [...new Set(entries.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (normalized.some((entry) => entry.length > 160)) {
    return { ok: false, message: '每条内容不能超过 160 个字符。' };
  }
  const currentModel = state.diagnosticModel && typeof state.diagnosticModel === 'object' ? state.diagnosticModel : {};
  const currentSpecifications = currentModel.deviceSpecifications && typeof currentModel.deviceSpecifications === 'object'
    ? currentModel.deviceSpecifications : {};
  const currentDevice = currentSpecifications[deviceId] && typeof currentSpecifications[deviceId] === 'object'
    ? currentSpecifications[deviceId] : {};
  state.diagnosticModel = {
    ...currentModel,
    deviceSpecifications: {
      ...currentSpecifications,
      [deviceId]: { ...currentDevice, [field]: normalized }
    }
  };
  let persisted = false;
  try {
    window.localStorage.setItem('gz-workbench-system-model', JSON.stringify(createWorkbenchSnapshot(state)));
    persisted = true;
  } catch (error) {
    console.warn('Failed to persist device specifications', error);
  }
  graph.value = applyDeviceSpecifications(graph.value);
  state.diagnosticKnowledgeGraph = graph.value;
  window.dispatchEvent(new CustomEvent('gz:knowledge-graph-updated', { detail: { graph: graph.value } }));
  return { ok: true, entries: normalized, persisted };
}
const visibleLegendKinds = computed(() => KNOWLEDGE_GRAPH_NODE_KINDS.filter((kind) => layout.value.kinds.includes(kind.value)));
const filterableNodeKinds = computed(() => KNOWLEDGE_GRAPH_NODE_KINDS.filter((kind) =>
  viewMode.value === 'entity' ? entityNodeKinds.has(kind.value)
    : viewMode.value === 'maintenance' ? maintenanceNodeKinds.has(kind.value)
      : viewMode.value === 'specification' ? specificationNodeKinds.has(kind.value)
        : layout.value.kinds.includes(kind.value)
));
const focusedGraph = computed(() => {
  const source = graph.value && typeof graph.value === 'object' ? graph.value : { nodes: [], relations: [] };
  if (viewMode.value === 'propagation') {
    const selectedDeviceId = expandedSpecificationDeviceId.value;
    return selectedDeviceId ? withDeviceSpecificationNodes(source, selectedDeviceId) : source;
  }
  if (viewMode.value === 'entity') return {
    ...source,
    nodes: (Array.isArray(source.nodes) ? source.nodes : []).filter((node) => entityNodeKinds.has(node?.kind)),
    relations: (Array.isArray(source.relations) ? source.relations : []).filter((relation) =>
      entityRelationTypes.has(relation?.type)
      && (
        (relation.type === 'OUTPUTS_TO' && relation.source?.kind === 'component' && relation.target?.kind === 'signalEdge')
        || (relation.type === 'INPUTS_TO' && relation.source?.kind === 'signalEdge' && relation.target?.kind === 'component')
      )
    )
  };
  if (viewMode.value === 'specification') {
    return withDeviceSpecificationNodes({
      ...source,
      nodes: (Array.isArray(source.nodes) ? source.nodes : []).filter((node) => node?.kind === 'component'),
      relations: []
    });
  }
  if (viewMode.value === 'maintenance') {
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const sourceRelations = Array.isArray(source.relations) ? source.relations : [];
    const baseNodes = sourceNodes.filter((node) => maintenanceBaseNodeKinds.has(node?.kind));
    const faultIds = new Set(baseNodes.filter((node) => node.kind === 'fault').map((node) => node.id));
    const targetRelations = sourceRelations.filter((relation) =>
      (relation?.type === 'OCCURS_ON' || relation?.type === 'RESOLVED_BY_REPLACING')
      && relation.source?.kind === 'fault'
      && faultIds.has(relation.source.id)
      && entityNodeKinds.has(relation.target?.kind)
    );
    const entityKeys = new Set(targetRelations.map((relation) => `${relation.target.kind}:${relation.target.id}`));
    const nodes = [
      ...baseNodes,
      ...sourceNodes.filter((node) => entityKeys.has(`${node?.kind}:${node?.id}`))
    ];
    const relations = sourceRelations.filter((relation) =>
      relation?.type === 'DETECTABILITY'
      && relation.detectable === true
      && relation.source?.kind === 'fault'
      && relation.target?.kind === 'measurementPoint'
    );
    relations.push(...targetRelations);
    relations.push(...sourceRelations.filter((relation) =>
      entityRelationTypes.has(relation?.type)
      && entityKeys.has(`${relation.source?.kind}:${relation.source?.id}`)
      && entityKeys.has(`${relation.target?.kind}:${relation.target?.id}`)
    ));
    const selectedFaultId = expandedMaintenanceFaultId.value;
    if (selectedFaultId) {
      relations.filter((relation) => relation.source.id === selectedFaultId).forEach((relation) => {
        (Array.isArray(relation.phenomena) ? relation.phenomena : []).forEach((value, index) => {
          const label = String(value ?? '').trim();
          if (!label) return;
          const phenomenonId = JSON.stringify([selectedFaultId, relation.target.id, index]);
          nodes.push({ kind: 'phenomenon', id: phenomenonId, label, faultId: selectedFaultId, pointId: relation.target.id, phenomenonOrder: index });
          relations.push({
            type: 'MANIFESTS_AS',
            source: { kind: 'measurementPoint', id: relation.target.id },
            target: { kind: 'phenomenon', id: phenomenonId }
          });
        });
      });
    }
    return { ...source, nodes, relations };
  }
  return { nodes: [], relations: [] };
});
const layout = computed(() => viewMode.value === 'maintenance'
  ? createMaintenanceKnowledgeGraphLayout(focusedGraph.value)
  : viewMode.value === 'specification'
    ? createSpecificationKnowledgeGraphLayout(focusedGraph.value)
  : createKnowledgeGraphLayout(focusedGraph.value));
const nodeByKey = computed(() => new Map(layout.value.nodes.map((node) => [node.key, node])));
const relationTypes = computed(() => [...new Set(layout.value.relations.map((relation) => relation.type))].sort());
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('zh-CN'));
const visibleNodes = computed(() => layout.value.nodes.filter((node) => {
  if (nodeKindFilter.value !== 'all' && node.kind !== nodeKindFilter.value) return false;
  if (!normalizedQuery.value) return true;
  return `${node.label} ${node.id} ${getKnowledgeGraphNodeKindLabel(node.kind)}`
    .toLocaleLowerCase('zh-CN')
    .includes(normalizedQuery.value);
}));
const visibleNodeKeys = computed(() => new Set(visibleNodes.value.map((node) => node.key)));
const visibleRelations = computed(() => layout.value.relations.filter((relation) => {
  if (!visibleNodeKeys.value.has(relation.sourceKey) || !visibleNodeKeys.value.has(relation.targetKey)) return false;
  if (relationTypeFilter.value !== 'all' && relation.type !== relationTypeFilter.value) return false;
  if (relation.type === 'DETECTABILITY' && relation.detectable === false && !showNegativeDetectability.value) return false;
  return true;
}));
const visibleRelationIds = computed(() => new Set(visibleRelations.value.map((relation) => relation.id)));
const selectedNode = computed(() => nodeByKey.value.get(selectedNodeKey.value) || null);
const selectedRelations = computed(() => {
  if (!selectedNode.value) return [];
  return layout.value.relations.filter((relation) =>
    relation.sourceKey === selectedNode.value.key || relation.targetKey === selectedNode.value.key
  );
});
const selectedMaintenancePoints = computed(() => {
  if (viewMode.value !== 'maintenance' || selectedNode.value?.kind !== 'fault') return [];
  return layout.value.relations
    .filter((relation) => relation.type === 'DETECTABILITY'
      && relation.detectable === true
      && relation.sourceKey === selectedNode.value.key)
    .map((relation) => {
      const point = nodeByKey.value.get(relation.targetKey);
      return point ? { id: point.id, code: point.pointCode || '', label: point.label, phenomena: relation.phenomena || [] } : null;
    })
    .filter(Boolean);
});
const selectedProperties = computed(() => {
  if (!selectedNode.value) return [];
  const ignored = new Set(['id', 'kind', 'key', 'label', 'degree', 'x', 'y']);
  return Object.entries(selectedNode.value)
    .filter(([key, value]) => !ignored.has(key) && value !== '' && value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => ({ key, value: String(value) }));
});
const connectedNodeKeys = computed(() => {
  const keys = new Set();
  if (!selectedNode.value) return keys;
  keys.add(selectedNode.value.key);
  selectedRelations.value.forEach((relation) => {
    keys.add(relation.sourceKey);
    keys.add(relation.targetKey);
  });
  if (viewMode.value === 'maintenance') {
    layout.value.relations.forEach((relation) => {
      if (relation.type === 'MANIFESTS_AS' && keys.has(relation.sourceKey)) keys.add(relation.targetKey);
    });
  }
  return keys;
});
const viewportTransform = computed(() => `translate(${viewport.value.x} ${viewport.value.y}) scale(${viewport.value.scale})`);
const graphSummary = computed(() => ({
  totalNodeCount: Array.isArray(graph.value?.nodes) ? graph.value.nodes.length : 0,
  totalRelationCount: Array.isArray(graph.value?.relations) ? graph.value.relations.length : 0,
  nodeCount: layout.value.nodes.length,
  relationCount: layout.value.relations.length,
  visibleNodeCount: visibleNodes.value.length,
  visibleRelationCount: visibleRelations.value.length
}));
const diagnosticConditionSummary = computed(() => graph.value?.diagnosticContext?.summary || '未配置诊断工况参数');
const viewDescription = computed(() => viewMode.value === 'entity'
  ? '实体图谱 · 设备与连线的输入/输出关系'
  : viewMode.value === 'maintenance'
    ? '维修概念图谱 · 故障、设备与连线、测点及现象'
    : viewMode.value === 'specification'
      ? '规范细则图谱 · 设备的操作要求和允许使用的测量仪器'
      : '故障传播图谱 · 全部节点与关系');

function relationLabel(type) {
  return KNOWLEDGE_GRAPH_RELATION_LABELS[type] || type;
}

function nodeKindLabel(kind) {
  return getKnowledgeGraphNodeKindLabel(kind);
}

function nodeGlyph(kind) {
  return ({ fault: 'F', component: 'D', signalEdge: 'L', measurementPoint: 'M', phenomenon: '现', operationRequirement: '规', measurementInstrument: '仪' })[kind] || 'N';
}

function nodeHalfWidth(node) {
  return ['phenomenon', 'operationRequirement', 'measurementInstrument'].includes(node?.kind) ? 110 : 72;
}

function nodeLabelWidth(node) {
  return (nodeHalfWidth(node) * 2) - 55;
}

function estimatedGlyphWidth(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint > 0xffff) return 14;
  if (codePoint > 0x2ff) return 11;
  if (/[MW@#%&]/.test(character)) return 10;
  if (/[A-Z0-9]/.test(character)) return 8;
  return 7;
}

function nodeDisplayLabel(node) {
  const characters = Array.from(String(node.label ?? ''));
  const width = nodeLabelWidth(node);
  if (characters.reduce((total, character) => total + estimatedGlyphWidth(character), 0) <= width) {
    return characters.join('');
  }
  let usedWidth = 11;
  const displayed = [];
  for (const character of characters) {
    const nextWidth = estimatedGlyphWidth(character);
    if (usedWidth + nextWidth > width) break;
    displayed.push(character);
    usedWidth += nextWidth;
  }
  return `${displayed.join('')}…`;
}

function relationPath(relation) {
  const source = nodeByKey.value.get(relation.sourceKey);
  const target = nodeByKey.value.get(relation.targetKey);
  if (!source || !target) return '';
  const direction = target.x >= source.x ? 1 : -1;
  const startX = source.x + (direction * (nodeHalfWidth(source) + 4));
  const endX = target.x - (direction * (nodeHalfWidth(target) + 4));
  const controlOffset = Math.max(42, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${source.y} C ${startX + (direction * controlOffset)} ${source.y}, ${endX - (direction * controlOffset)} ${target.y}, ${endX} ${target.y}`;
}

function relationMidpoint(relation) {
  const source = nodeByKey.value.get(relation.sourceKey);
  const target = nodeByKey.value.get(relation.targetKey);
  return source && target
    ? { x: (source.x + target.x) / 2, y: ((source.y + target.y) / 2) - 6 }
    : { x: 0, y: 0 };
}

function isRelationDimmed(relation) {
  if (viewMode.value === 'maintenance' && selectedNode.value) {
    return !connectedNodeKeys.value.has(relation.sourceKey) || !connectedNodeKeys.value.has(relation.targetKey);
  }
  return Boolean(selectedNode.value) && relation.sourceKey !== selectedNode.value.key && relation.targetKey !== selectedNode.value.key;
}

function isNodeDimmed(node) {
  return Boolean(selectedNode.value) && !connectedNodeKeys.value.has(node.key);
}

function resetViewport() {
  cancelPan();
  viewport.value = { x: 0, y: 0, scale: 1 };
  viewportGroupRef.value?.setAttribute('transform', 'translate(0 0) scale(1)');
}

function resetFilters() {
  nodeKindFilter.value = 'all';
  relationTypeFilter.value = 'all';
  query.value = '';
  showNegativeDetectability.value = false;
  showRelationLabels.value = false;
  selectedNodeKey.value = '';
  expandedSpecificationDeviceId.value = '';
  expandedMaintenanceFaultId.value = '';
  resetViewport();
}

function setViewMode(mode) {
  viewMode.value = ['entity', 'maintenance', 'specification', 'propagation'].includes(mode) ? mode : 'entity';
  nodeKindFilter.value = 'all';
  relationTypeFilter.value = 'all';
  selectedNodeKey.value = '';
  expandedSpecificationDeviceId.value = '';
  expandedMaintenanceFaultId.value = '';
  resetViewport();
}

function openPage(event) {
  const nextGraph = event?.detail?.graph || window.getDiagnosticKnowledgeGraph?.();
  if (!nextGraph || !Array.isArray(nextGraph.nodes) || !Array.isArray(nextGraph.relations)) return;
  graph.value = applyDeviceSpecifications(nextGraph);
  isOpen.value = true;
  viewMode.value = 'entity';
  resetFilters();
  nextTick(() => document.querySelector('[data-knowledge-graph-close]')?.focus());
}

function updateOpenPage(event) {
  if (!isOpen.value) return;
  const nextGraph = event?.detail?.graph;
  if (!nextGraph || !Array.isArray(nextGraph.nodes) || !Array.isArray(nextGraph.relations)) return;
  graph.value = applyDeviceSpecifications(nextGraph);
  const selectedNodeExists = focusedGraph.value.nodes.some((node) => `${node.kind}:${node.id}` === selectedNodeKey.value);
  if (selectedNodeKey.value && !selectedNodeExists) clearSelectedNode();
}

function clearSelectedNode() {
  selectedNodeKey.value = '';
  expandedSpecificationDeviceId.value = '';
  expandedMaintenanceFaultId.value = '';
}

function closePage() {
  cancelPan();
  isOpen.value = false;
  clearSelectedNode();
}

function exportCurrentView() {
  const result = exportKnowledgeGraphSvg(svgRef.value);
  exportStatus.value = result.ok ? '当前视图已导出' : '导出失败，请稍后重试';
  window.setTimeout(() => {
    exportStatus.value = '';
  }, 2200);
}

function handleKeydown(event) {
  if (isOpen.value && event.key === 'Escape') closePage();
}

function getSvgViewportMetrics(svg) {
  const rect = svg?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return null;
  const scale = Math.min(rect.width / layout.value.width, rect.height / layout.value.height);
  return {
    scale,
    left: rect.left + ((rect.width - (layout.value.width * scale)) / 2),
    top: rect.top + ((rect.height - (layout.value.height * scale)) / 2)
  };
}

function handleWheel(event) {
  const metrics = getSvgViewportMetrics(svgRef.value);
  if (!metrics) return;
  const pointerX = (event.clientX - metrics.left) / metrics.scale;
  const pointerY = (event.clientY - metrics.top) / metrics.scale;
  const current = viewport.value;
  // Let a standard 144-unit component reach roughly 490 screen pixels,
  // regardless of how much the full graph had to shrink to fit the SVG.
  const maxScale = Math.max(2.5, 3.4 / metrics.scale);
  const nextScale = Math.min(maxScale, Math.max(0.45, current.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
  const localX = (pointerX - current.x) / current.scale;
  const localY = (pointerY - current.y) / current.scale;
  viewport.value = {
    scale: nextScale,
    x: pointerX - (localX * nextScale),
    y: pointerY - (localY * nextScale)
  };
}

function startPan(event) {
  if (event.button !== 0 || panState) return;
  const metrics = getSvgViewportMetrics(svgRef.value);
  if (!metrics) return;
  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: viewport.value.x,
    originY: viewport.value.y,
    scale: viewport.value.scale,
    ratioX: 1 / metrics.scale,
    ratioY: 1 / metrics.scale,
    clientX: event.clientX,
    clientY: event.clientY,
    frameId: 0
  };
  svgRef.value?.classList.add('is-panning');
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function renderPanFrame() {
  if (!panState) return;
  panState.frameId = 0;
  const x = panState.originX + ((panState.clientX - panState.startX) * panState.ratioX);
  const y = panState.originY + ((panState.clientY - panState.startY) * panState.ratioY);
  panState.x = x;
  panState.y = y;
  viewportGroupRef.value?.setAttribute('transform', `translate(${x} ${y}) scale(${panState.scale})`);
}

function movePan(event) {
  if (!panState || event.pointerId !== panState.pointerId) return;
  panState.clientX = event.clientX;
  panState.clientY = event.clientY;
  if (!panState.frameId) panState.frameId = window.requestAnimationFrame(renderPanFrame);
}

function stopPan(event) {
  if (!panState || event.pointerId !== panState.pointerId) return;
  if (panState.frameId) window.cancelAnimationFrame(panState.frameId);
  renderPanFrame();
  viewport.value = { x: panState.x, y: panState.y, scale: panState.scale };
  panState = null;
  svgRef.value?.classList.remove('is-panning');
}

function cancelPan() {
  if (panState?.frameId) window.cancelAnimationFrame(panState.frameId);
  panState = null;
  svgRef.value?.classList.remove('is-panning');
}

function selectNode(node) {
  if (viewMode.value === 'specification' && node.kind !== 'component') return;
  const nextKey = selectedNodeKey.value === node.key ? '' : node.key;
  selectedNodeKey.value = nextKey;
  expandedSpecificationDeviceId.value = viewMode.value === 'propagation' && nextKey
    ? node.kind === 'component' ? node.id : node.deviceId || ''
    : '';
  expandedMaintenanceFaultId.value = viewMode.value === 'maintenance' && nextKey
    ? node.kind === 'fault' ? node.id : node.faultId || ''
    : '';
  if (viewMode.value === 'maintenance' || viewMode.value === 'specification') resetViewport();
  phenomenonDrafts.value = {};
  phenomenonNotices.value = {};
  specificationDrafts.value = { operationRequirements: '', allowedInstruments: '' };
  specificationNotices.value = {};
  if (nextKey && viewMode.value === 'specification') {
    specificationFields.forEach(({ field }) => {
      specificationDrafts.value[field] = (Array.isArray(node[field]) ? node[field] : []).join('\n');
    });
  }
  if (nextKey && viewMode.value === 'maintenance') {
    layout.value.relations
      .filter((relation) => relation.type === 'DETECTABILITY' && relation.detectable === true && relation.sourceKey === nextKey)
      .forEach((relation) => {
        const pointId = nodeByKey.value.get(relation.targetKey)?.id;
        if (pointId) phenomenonDrafts.value[pointId] = (relation.phenomena || []).join('\n');
      });
  }
}

function saveDeviceSpecification(field) {
  if (viewMode.value !== 'specification' || selectedNode.value?.kind !== 'component') return;
  const entries = String(specificationDrafts.value[field] || '').split(/\r?\n/);
  const deviceId = selectedNode.value.id;
  let result;
  try {
    result = window.__GZ_DEVICE_SPECIFICATIONS__?.save?.(deviceId, field, entries)
      ?? saveDeviceSpecificationDirectly(deviceId, field, entries);
  } catch (error) {
    console.warn('Legacy device specification save failed; using direct save', error);
    result = saveDeviceSpecificationDirectly(deviceId, field, entries);
  }
  specificationNotices.value = {
    ...specificationNotices.value,
    [field]: result?.ok
      ? (result.persisted ? '已保存到模型。' : '已更新；请保存系统模型以长期保留。')
      : (result?.message || '保存失败，请稍后重试。')
  };
  if (result?.ok) specificationDrafts.value[field] = result.entries.join('\n');
}

function savePointPhenomena(pointId) {
  if (viewMode.value !== 'maintenance' || selectedNode.value?.kind !== 'fault') return;
  const entries = String(phenomenonDrafts.value[pointId] || '').split(/\r?\n/);
  const result = window.__GZ_DIAGNOSTIC_PHENOMENA__?.save?.(selectedNode.value.id, pointId, entries);
  phenomenonNotices.value = {
    ...phenomenonNotices.value,
    [pointId]: result?.ok
      ? (result.persisted ? '现象已保存到模型。' : '现象已更新；请保存系统模型以长期保留。')
      : (result?.message || '保存失败，请稍后重试。')
  };
  if (result?.ok) phenomenonDrafts.value[pointId] = result.phenomena.join('\n');
}

function relatedNodeLabel(relation, side) {
  const key = side === 'source' ? relation.sourceKey : relation.targetKey;
  return nodeByKey.value.get(key)?.label || key;
}

onMounted(() => {
  window.addEventListener('gz:open-knowledge-graph', openPage);
  window.addEventListener('gz:knowledge-graph-updated', updateOpenPage);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  cancelPan();
  window.removeEventListener('gz:open-knowledge-graph', openPage);
  window.removeEventListener('gz:knowledge-graph-updated', updateOpenPage);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <section v-if="isOpen" class="knowledge-graph-page" data-testid="knowledge-graph-page" aria-label="诊断知识图谱">
      <header class="knowledge-graph-page__header">
        <div>
          <h1>诊断知识图谱</h1>
          <p><span class="knowledge-graph-page__live-dot"></span>实时同步 · 当前工况：{{ diagnosticConditionSummary }} · {{ viewDescription }}</p>
        </div>
        <div class="knowledge-graph-page__summary" aria-label="图谱统计">
          <span><b data-knowledge-graph-visible-nodes>{{ graphSummary.visibleNodeCount }}</b>当前节点</span>
          <span><b data-knowledge-graph-visible-relations>{{ graphSummary.visibleRelationCount }}</b>当前关系</span>
          <span><b data-knowledge-graph-total-nodes>{{ graphSummary.totalNodeCount }}</b>全部节点</span>
        </div>
        <button type="button" class="knowledge-graph-page__close" data-knowledge-graph-close @click="closePage">关闭</button>
      </header>

      <div class="knowledge-graph-page__toolbar">
        <div class="knowledge-graph-page__modes" aria-label="图谱视图">
          <button type="button" :class="{ 'is-active': viewMode === 'entity' }" data-knowledge-graph-mode="entity" @click="setViewMode('entity')">实体图谱</button>
          <button type="button" :class="{ 'is-active': viewMode === 'maintenance' }" data-knowledge-graph-mode="maintenance" @click="setViewMode('maintenance')">维修概念图谱</button>
          <button type="button" :class="{ 'is-active': viewMode === 'specification' }" data-knowledge-graph-mode="specification" @click="setViewMode('specification')">规范细则图谱</button>
          <button type="button" :class="{ 'is-active': viewMode === 'propagation' }" data-knowledge-graph-mode="propagation" @click="setViewMode('propagation')">故障传播图谱</button>
        </div>
        <label class="knowledge-graph-page__search">
          <span>搜索</span>
          <input v-model="query" type="search" placeholder="节点名称或 ID" data-knowledge-graph-search>
        </label>
        <details class="knowledge-graph-page__filters">
          <summary>筛选与显示</summary>
          <div>
            <label>
              <span>节点类型</span>
              <select v-model="nodeKindFilter" data-knowledge-graph-node-filter>
                <option value="all">全部节点</option>
                <option v-for="kind in filterableNodeKinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
              </select>
            </label>
            <label>
              <span>关系类型</span>
              <select v-model="relationTypeFilter" data-knowledge-graph-relation-filter>
                <option value="all">全部关系</option>
                <option v-for="type in relationTypes" :key="type" :value="type">{{ relationLabel(type) }}</option>
              </select>
            </label>
            <label v-if="viewMode === 'propagation'" class="knowledge-graph-page__check">
              <input v-model="showNegativeDetectability" type="checkbox" data-knowledge-graph-negative-toggle>
              <span>显示不可检测关系（0）</span>
            </label>
            <label class="knowledge-graph-page__check">
              <input v-model="showRelationLabels" type="checkbox">
              <span>显示关系名称</span>
            </label>
          </div>
        </details>
        <button type="button" class="knowledge-graph-page__reset" @click="resetFilters">重置</button>
        <button type="button" class="knowledge-graph-page__export" data-knowledge-graph-export @click="exportCurrentView">导出当前视图</button>
        <span class="knowledge-graph-page__export-status" aria-live="polite">{{ exportStatus }}</span>
      </div>

      <div class="knowledge-graph-page__body">
        <main class="knowledge-graph-canvas">
          <div class="knowledge-graph-legend" aria-label="节点图例">
            <template v-for="kind in visibleLegendKinds" :key="kind.value">
              <span v-if="kind.value === 'fault'" class="is-fault is-enabled">
                <i></i>故障（已启用）
              </span>
              <span v-if="kind.value === 'fault'" class="is-fault is-disabled">
                <i></i>故障（未启用）
              </span>
              <span v-if="kind.value !== 'fault'" :class="`is-${kind.value}`">
                <i></i>{{ kind.label }}
              </span>
            </template>
            <span v-if="viewMode === 'maintenance' || viewMode === 'propagation'" class="is-detectable"><i></i>人工可检测</span>
            <span v-if="viewMode === 'propagation' && showNegativeDetectability" class="is-undetectable"><i></i>人工不可检测</span>
          </div>
          <svg
            ref="svgRef"
            class="knowledge-graph-svg"
            :viewBox="`0 0 ${layout.width} ${layout.height}`"
            role="img"
            :aria-label="`知识图谱，共 ${graphSummary.visibleNodeCount} 个可见节点和 ${graphSummary.visibleRelationCount} 条可见关系`"
            @wheel.prevent="handleWheel"
            @pointerdown="startPan"
            @pointermove="movePan"
            @pointerup="stopPan"
            @pointercancel="stopPan"
          >
            <defs>
              <marker id="knowledge-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z"></path>
              </marker>
              <clipPath v-for="(node, index) in visibleNodes" :id="`knowledge-graph-label-clip-${index}`" :key="node.key">
                <rect :x="-nodeHalfWidth(node) + 43" y="-18" :width="nodeLabelWidth(node)" height="36"></rect>
              </clipPath>
            </defs>
            <g ref="viewportGroupRef" :transform="viewportTransform">
              <g class="knowledge-graph-relations">
                <template v-for="relation in layout.relations" :key="relation.id">
                  <path
                    v-if="visibleRelationIds.has(relation.id)"
                    :d="relationPath(relation)"
                    :class="[
                      `is-${relation.type.toLowerCase()}`,
                      { 'is-negative': relation.detectable === false, 'is-dimmed': isRelationDimmed(relation) }
                    ]"
                    marker-end="url(#knowledge-graph-arrow)"
                  ></path>
                  <text
                    v-if="showRelationLabels && visibleRelationIds.has(relation.id)"
                    :x="relationMidpoint(relation).x"
                    :y="relationMidpoint(relation).y"
                    :class="{ 'is-dimmed': isRelationDimmed(relation) }"
                    text-anchor="middle"
                  >{{ relation.label }}</text>
                </template>
              </g>
              <g class="knowledge-graph-nodes">
                <g
                  v-for="(node, index) in visibleNodes"
                  :key="node.key"
                  :class="[`is-${node.kind}`, { 'is-selected': selectedNodeKey === node.key, 'is-disabled': node.kind === 'fault' && node.enabled === false, 'is-dimmed': isNodeDimmed(node) }]"
                  :transform="`translate(${node.x} ${node.y})`"
                  :data-kg-node-key="node.key"
                  role="button"
                  :aria-label="`${nodeKindLabel(node.kind)}：${node.label}`"
                  @pointerdown.stop
                  @click.stop="selectNode(node)"
                >
                  <title>{{ node.label }}</title>
                  <rect :x="-nodeHalfWidth(node)" y="-22" :width="nodeHalfWidth(node) * 2" height="44" rx="9"></rect>
                  <circle :cx="-nodeHalfWidth(node) + 23" cy="0" r="13"></circle>
                  <text class="knowledge-graph-node__glyph" :x="-nodeHalfWidth(node) + 23" y="4" text-anchor="middle">{{ nodeGlyph(node.kind) }}</text>
                  <text class="knowledge-graph-node__label" :x="-nodeHalfWidth(node) + 43" y="4" :clip-path="`url(#knowledge-graph-label-clip-${index})`">{{ nodeDisplayLabel(node) }}</text>
                </g>
              </g>
            </g>
          </svg>
          <div v-if="!visibleNodes.length" class="knowledge-graph-canvas__empty">没有符合当前筛选条件的节点。</div>
          <div class="knowledge-graph-canvas__hint">滚轮缩放 · 拖动画布平移 · {{ viewMode === 'maintenance' ? '点击故障显示现象；点击设备或连线查看关系' : viewMode === 'specification' ? '点击设备设置操作要求与测量仪器' : '点击节点查看关系' }}</div>
        </main>

        <aside v-if="viewMode === 'maintenance' && selectedNode?.kind === 'fault'" class="knowledge-graph-detail knowledge-graph-maintenance-detail" aria-live="polite">
          <button type="button" class="knowledge-graph-detail__close" aria-label="关闭故障现象" @click="clearSelectedNode">×</button>
          <span class="knowledge-graph-detail__kind">{{ nodeKindLabel(selectedNode.kind) }}</span>
          <h2>{{ selectedNode.label }}</h2>
          <code>{{ selectedNode.id }}</code>
          <dl class="knowledge-graph-detail__properties">
            <div><dt>关联度</dt><dd>{{ selectedNode.degree }}</dd></div>
            <div v-for="property in selectedProperties" :key="property.key"><dt>{{ property.key }}</dt><dd>{{ property.value }}</dd></div>
          </dl>
          <h3>关联关系（{{ selectedRelations.length }}）</h3>
          <ol class="knowledge-graph-detail__relations">
            <li v-for="relation in selectedRelations" :key="relation.id">
              <span>{{ relation.label }}</span>
              <p>{{ relatedNodeLabel(relation, 'source') }} → {{ relatedNodeLabel(relation, 'target') }}</p>
              <small v-if="relation.source">{{ relation.source.kind }} → {{ relation.target.kind }}</small>
            </li>
          </ol>
          <h3>故障测点现象</h3>
          <p class="knowledge-graph-maintenance-detail__intro">各测点的现象仅对应当前故障。每行填写一条，修改后单独保存。</p>
          <p v-if="!selectedMaintenancePoints.length" class="knowledge-graph-maintenance-detail__empty">该故障暂无可检测测点。</p>
          <section v-for="point in selectedMaintenancePoints" :key="point.id" class="knowledge-graph-maintenance-detail__point">
            <h3>{{ point.code }} {{ point.label }}</h3>
            <label :for="`phenomena-${point.id}`">现象（每行一条）</label>
            <textarea :id="`phenomena-${point.id}`" v-model="phenomenonDrafts[point.id]" :data-knowledge-graph-phenomena="point.id" maxlength="2000" placeholder="例如：输出幅值低于正常范围" @input="phenomenonNotices[point.id] = ''"></textarea>
            <div class="knowledge-graph-maintenance-detail__actions">
              <small>{{ phenomenonNotices[point.id] || '未填写时该测点不显示现象。' }}</small>
              <button type="button" :data-save-knowledge-graph-phenomena="point.id" @click="savePointPhenomena(point.id)">保存现象</button>
            </div>
          </section>
        </aside>

        <aside v-if="viewMode === 'specification' && selectedNode?.kind === 'component'" class="knowledge-graph-detail knowledge-graph-specification-detail" aria-live="polite">
          <button type="button" class="knowledge-graph-detail__close" aria-label="关闭规范细则" @click="clearSelectedNode">×</button>
          <span class="knowledge-graph-detail__kind">设备规范细则</span>
          <h2>{{ selectedNode.label }}</h2>
          <p class="knowledge-graph-specification-detail__intro">每行填写一条，保存后在图谱中生成一个独立节点。</p>
          <section v-for="item in specificationFields" :key="item.field" class="knowledge-graph-specification-detail__section">
            <h3>{{ item.label }}</h3>
            <label :for="`specification-${item.field}`">{{ item.label }}（每行一条）</label>
            <textarea :id="`specification-${item.field}`" v-model="specificationDrafts[item.field]" :data-specification-field="item.field" maxlength="8000" :placeholder="item.placeholder" @input="specificationNotices[item.field] = ''"></textarea>
            <div class="knowledge-graph-specification-detail__actions">
              <small>{{ specificationNotices[item.field] || '未填写时不生成节点。' }}</small>
              <button type="button" :data-save-specification="item.field" @click="saveDeviceSpecification(item.field)">保存{{ item.label }}</button>
            </div>
          </section>
        </aside>

        <aside v-if="selectedNode && (viewMode === 'entity' || viewMode === 'propagation' || (viewMode === 'maintenance' && selectedNode.kind !== 'fault'))" class="knowledge-graph-detail" aria-live="polite">
          <button type="button" class="knowledge-graph-detail__close" aria-label="关闭节点详情" @click="clearSelectedNode">×</button>
          <span class="knowledge-graph-detail__kind">{{ nodeKindLabel(selectedNode.kind) }}</span>
          <h2>{{ selectedNode.label }}</h2>
          <code>{{ selectedNode.id }}</code>
          <dl class="knowledge-graph-detail__properties">
            <div><dt>关联度</dt><dd>{{ selectedNode.degree }}</dd></div>
            <div v-for="property in selectedProperties" :key="property.key"><dt>{{ property.key }}</dt><dd>{{ property.value }}</dd></div>
          </dl>
          <h3>关联关系（{{ selectedRelations.length }}）</h3>
          <ol class="knowledge-graph-detail__relations">
            <li v-for="relation in selectedRelations" :key="relation.id">
              <span>{{ relation.label }}</span>
              <p>{{ relatedNodeLabel(relation, 'source') }} → {{ relatedNodeLabel(relation, 'target') }}</p>
              <small v-if="relation.source">{{ relation.source.kind }} → {{ relation.target.kind }}</small>
            </li>
          </ol>
        </aside>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.knowledge-graph-page{position:fixed;inset:0;z-index:2200;display:flex;min-width:720px;min-height:500px;flex-direction:column;background:var(--bg-base);color:var(--text);font-family:var(--font-ui)}
.knowledge-graph-page__header{display:grid;grid-template-columns:minmax(260px,1fr) auto auto;align-items:center;gap:18px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-panel);box-shadow:var(--shadow-sm)}
.knowledge-graph-page__eyebrow{display:block;margin-bottom:3px;color:var(--blue);font-family:var(--font-data);font-size:9px;font-weight:600;letter-spacing:.7px}
.knowledge-graph-page__header h1{font-size:17px;line-height:1.2}
.knowledge-graph-page__header p{margin-top:3px;color:var(--text2);font-size:10px}
.knowledge-graph-page__live-dot{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px var(--green-bg);vertical-align:1px}
.knowledge-graph-page__summary{display:flex;gap:8px}
.knowledge-graph-page__summary span{display:grid;min-width:64px;gap:1px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--textm);font-size:8px;text-align:center}
.knowledge-graph-page__summary b{color:var(--text);font-family:var(--font-data);font-size:14px}
.knowledge-graph-page button,.knowledge-graph-page input,.knowledge-graph-page select{font:inherit}
.knowledge-graph-page__close,.knowledge-graph-page__toolbar button{height:30px;padding:0 12px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-panel);color:var(--text2);cursor:pointer}
.knowledge-graph-page__close:hover,.knowledge-graph-page__toolbar button:hover{border-color:var(--blue);color:var(--blue)}
.knowledge-graph-page__toolbar{position:relative;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:7px 16px;border-bottom:1px solid var(--border);background:var(--bg-card)}
.knowledge-graph-page__toolbar>label:not(.knowledge-graph-page__check){display:flex;align-items:center;gap:7px;color:var(--textm);font-size:9px}
.knowledge-graph-page__toolbar input[type="search"],.knowledge-graph-page__toolbar select{height:30px;min-width:150px;padding:0 9px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-panel);color:var(--text);outline:none}
.knowledge-graph-page__toolbar input[type="search"]:focus,.knowledge-graph-page__toolbar select:focus{border-color:var(--blue);box-shadow:var(--ring-blue)}
.knowledge-graph-page__check{display:flex;align-items:center;gap:6px;height:30px;color:var(--text2);font-size:10px;white-space:nowrap}
.knowledge-graph-page__check input{accent-color:var(--blue)}
.knowledge-graph-page__modes{display:flex;padding:2px;border:1px solid var(--border);border-radius:6px;background:var(--bg-panel)}
.knowledge-graph-page__modes button{height:26px;border:0;background:transparent}
.knowledge-graph-page__modes button.is-active{background:var(--blue);color:#fff}
.knowledge-graph-page__search{flex:0 1 330px}
.knowledge-graph-page__search input{width:100%}
.knowledge-graph-page__filters{position:relative}
.knowledge-graph-page__filters summary{height:30px;padding:0 12px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-panel);color:var(--text2);font-size:10px;line-height:28px;list-style:none;cursor:pointer}
.knowledge-graph-page__filters summary::-webkit-details-marker{display:none}
.knowledge-graph-page__filters[open] summary{border-color:var(--blue);color:var(--blue)}
.knowledge-graph-page__filters>div{position:absolute;top:37px;right:0;z-index:8;display:grid;width:250px;gap:8px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-panel);box-shadow:var(--shadow-lg)}
.knowledge-graph-page__filters>div>label:not(.knowledge-graph-page__check){display:grid;gap:4px;color:var(--textm);font-size:9px}
.knowledge-graph-page__filters select{width:100%}
.knowledge-graph-page__reset{margin-left:auto}
.knowledge-graph-page__export{border-color:var(--blue)!important;background:var(--blue)!important;color:#fff!important}
.knowledge-graph-page__export:hover{filter:brightness(.94)}
.knowledge-graph-page__export-status{position:absolute;right:16px;top:45px;z-index:9;padding:6px 10px;border:1px solid var(--green);border-radius:5px;background:var(--green-bg);color:var(--green);font-size:10px;box-shadow:var(--shadow-sm)}
.knowledge-graph-page__export-status:empty{display:none}
.knowledge-graph-page__body{position:relative;display:flex;flex:1;min-height:0}
.knowledge-graph-canvas{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden;background-color:var(--bg-panel);background-image:radial-gradient(circle,var(--border) 1px,transparent 1px);background-size:22px 22px}
.knowledge-graph-svg{display:block;width:100%;height:100%;cursor:grab;touch-action:none}
.knowledge-graph-svg:active{cursor:grabbing}
.knowledge-graph-relations path{fill:none;stroke:var(--border-dark);stroke-width:1.5;vector-effect:non-scaling-stroke;transition:opacity .15s,stroke .15s}
.knowledge-graph-relations path.is-detectability{stroke:var(--green)}
.knowledge-graph-relations path.is-detectability.is-negative{stroke:var(--textd);stroke-dasharray:5 4}
.knowledge-graph-relations path.is-manifests_as{stroke:var(--purple)}
.knowledge-graph-relations path.is-requires_operation{stroke:var(--orange)}
.knowledge-graph-relations path.is-allows_instrument{stroke:var(--purple)}
.knowledge-graph-relations path.is-resolved_by_replacing{stroke:var(--red)}
.knowledge-graph-relations path.is-dimmed,.knowledge-graph-relations text.is-dimmed{opacity:.13}
.knowledge-graph-relations text{paint-order:stroke;stroke:var(--bg-panel);stroke-width:4px;fill:var(--text2);font-family:var(--font-ui);font-size:9px;pointer-events:none}
#knowledge-graph-arrow path{fill:var(--textm)}
.knowledge-graph-nodes>g{cursor:pointer;transition:opacity .15s}
.knowledge-graph-nodes>g.is-dimmed{opacity:.18}
.knowledge-graph-nodes rect{fill:var(--bg-panel);stroke:var(--border-mid);stroke-width:1.5;vector-effect:non-scaling-stroke;filter:drop-shadow(0 3px 4px rgba(30,58,95,.08))}
.knowledge-graph-svg.is-panning{cursor:grabbing}
.knowledge-graph-svg.is-panning .knowledge-graph-nodes rect{filter:none}
.knowledge-graph-nodes circle{fill:var(--blue-bg);stroke:var(--blue);stroke-width:1.3;vector-effect:non-scaling-stroke}
.knowledge-graph-nodes .is-fault rect{stroke:var(--red-border)}
.knowledge-graph-nodes .is-fault circle{fill:var(--red-bg);stroke:var(--red)}
.knowledge-graph-nodes .is-fault.is-disabled rect{stroke:var(--textm);stroke-dasharray:5 4;fill:var(--bg-card)}
.knowledge-graph-nodes .is-fault.is-disabled circle{fill:var(--bg-card);stroke:var(--textm)}
.knowledge-graph-nodes .is-signalEdge rect{stroke:#f2c795}
.knowledge-graph-nodes .is-signalEdge circle{fill:var(--orange-bg);stroke:var(--orange)}
.knowledge-graph-nodes .is-measurementPoint rect{stroke:#9ed4ae}
.knowledge-graph-nodes .is-measurementPoint circle{fill:var(--green-bg);stroke:var(--green)}
.knowledge-graph-nodes .is-phenomenon rect{fill:var(--purple-bg);stroke:var(--purple)}
.knowledge-graph-nodes .is-phenomenon circle{fill:var(--purple-bg);stroke:var(--purple)}
.knowledge-graph-nodes .is-operationRequirement rect,.knowledge-graph-nodes .is-operationRequirement circle{fill:var(--orange-bg);stroke:var(--orange)}
.knowledge-graph-nodes .is-measurementInstrument rect,.knowledge-graph-nodes .is-measurementInstrument circle{fill:var(--purple-bg);stroke:var(--purple)}
.knowledge-graph-nodes .is-selected rect{stroke:var(--blue);stroke-width:2.5;filter:drop-shadow(0 5px 8px rgba(29,111,191,.2))}
.knowledge-graph-node__glyph{fill:var(--text);font-family:var(--font-data);font-size:9px;font-weight:600;pointer-events:none}
.knowledge-graph-node__label{fill:var(--text);font-size:10px;font-weight:600;pointer-events:none}
.knowledge-graph-node__id{fill:var(--textm);font-family:var(--font-data);font-size:7.5px;pointer-events:none}
.knowledge-graph-legend{position:absolute;top:12px;left:14px;z-index:2;display:flex;flex-wrap:wrap;gap:8px 16px;max-width:calc(100% - 28px);padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:rgba(255,255,255,.9);color:var(--text2);font-size:11px;line-height:1.4;pointer-events:none}
.knowledge-graph-legend span{display:flex;align-items:center;gap:6px;white-space:nowrap}
.knowledge-graph-legend i{width:12px;height:12px;flex:0 0 12px;border-radius:3px;background:var(--blue)}
.knowledge-graph-legend .is-fault i{background:var(--red)}
.knowledge-graph-legend .is-fault.is-disabled i{border:1px dashed var(--textm);background:var(--bg-card)}
.knowledge-graph-legend .is-signalEdge i{background:var(--orange)}
.knowledge-graph-legend .is-measurementPoint i,.knowledge-graph-legend .is-detectable i{background:var(--green)}
.knowledge-graph-legend .is-phenomenon i{background:var(--purple)}
.knowledge-graph-legend .is-operationRequirement i{background:var(--orange)}
.knowledge-graph-legend .is-measurementInstrument i{background:var(--purple)}
.knowledge-graph-legend .is-undetectable i{border:1px dashed var(--textm);background:transparent}
.knowledge-graph-canvas__hint{position:absolute;right:12px;bottom:10px;padding:5px 8px;border-radius:5px;background:rgba(255,255,255,.9);color:var(--textm);font-size:9px;pointer-events:none}
.knowledge-graph-canvas__empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--textm);font-size:12px;pointer-events:none}
.knowledge-graph-detail{position:absolute;top:12px;right:12px;bottom:12px;z-index:4;width:300px;overflow:auto;padding:18px;border:1px solid var(--border);border-radius:9px;background:rgba(255,255,255,.97);box-shadow:var(--shadow-lg)}
.knowledge-graph-detail__close{position:absolute;top:10px;right:10px;width:28px;height:28px;border:1px solid var(--border);border-radius:5px;background:var(--bg-panel);color:var(--text2);font-size:18px;cursor:pointer}
.knowledge-graph-detail__kind{display:inline-block;margin-bottom:6px;padding:3px 7px;border-radius:999px;background:var(--blue-bg);color:var(--blue);font-size:9px;font-weight:600}
.knowledge-graph-detail h2{padding-right:30px;font-size:16px;line-height:1.35;word-break:break-word}
.knowledge-graph-detail>code{display:block;margin-top:5px;color:var(--textm);font-family:var(--font-data);font-size:9px;word-break:break-all}
.knowledge-graph-detail__properties{display:grid;gap:0;margin:16px 0}
.knowledge-graph-detail__properties div{display:grid;grid-template-columns:90px 1fr;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:10px}
.knowledge-graph-detail__properties dt{color:var(--textm);word-break:break-word}
.knowledge-graph-detail__properties dd{color:var(--text);text-align:right;word-break:break-word}
.knowledge-graph-detail h3{margin:18px 0 8px;font-size:11px}
.knowledge-graph-detail__relations{display:grid;gap:7px;list-style:none}
.knowledge-graph-detail__relations li{padding:8px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-panel)}
.knowledge-graph-detail__relations span{color:var(--blue);font-size:9px;font-weight:600}
.knowledge-graph-detail__relations p{margin:4px 0;color:var(--text);font-size:10px;line-height:1.5;word-break:break-word}
.knowledge-graph-detail__relations small{color:var(--textm);font-family:var(--font-data);font-size:8px}
.knowledge-graph-maintenance-detail{width:370px}
.knowledge-graph-maintenance-detail__intro,.knowledge-graph-maintenance-detail__empty{margin:8px 0 14px;color:var(--textm);font-size:10px;line-height:1.6}
.knowledge-graph-maintenance-detail__point{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:7px;background:var(--bg-panel)}
.knowledge-graph-maintenance-detail__point h3{margin:0 0 9px;font-size:11px;line-height:1.5}
.knowledge-graph-maintenance-detail__point label{display:block;margin-bottom:5px;color:var(--textm);font-size:9px}
.knowledge-graph-maintenance-detail__point textarea{display:block;width:100%;min-height:76px;resize:vertical;padding:8px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-card);color:var(--text);font:inherit;font-size:10px;line-height:1.5}
.knowledge-graph-maintenance-detail__point textarea:focus{outline:0;border-color:var(--blue);box-shadow:var(--ring-blue)}
.knowledge-graph-maintenance-detail__actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
.knowledge-graph-maintenance-detail__actions small{color:var(--textm);font-size:9px;line-height:1.4}
.knowledge-graph-maintenance-detail__actions button{flex:none;height:27px;padding:0 9px;border:1px solid var(--blue);border-radius:5px;background:var(--blue);color:#fff;cursor:pointer;font-size:10px}
.knowledge-graph-specification-detail{width:390px}
.knowledge-graph-specification-detail__intro{margin:8px 0 14px;color:var(--textm);font-size:10px;line-height:1.6}
.knowledge-graph-specification-detail__section{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:7px;background:var(--bg-panel)}
.knowledge-graph-specification-detail__section h3{margin:0 0 9px;font-size:11px}
.knowledge-graph-specification-detail__section label{display:block;margin-bottom:5px;color:var(--textm);font-size:9px}
.knowledge-graph-specification-detail__section textarea{display:block;width:100%;min-height:90px;resize:vertical;padding:8px;border:1px solid var(--border-mid);border-radius:5px;background:var(--bg-card);color:var(--text);font:inherit;font-size:10px;line-height:1.5}
.knowledge-graph-specification-detail__section textarea:focus{outline:0;border-color:var(--blue);box-shadow:var(--ring-blue)}
.knowledge-graph-specification-detail__actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
.knowledge-graph-specification-detail__actions small{color:var(--textm);font-size:9px;line-height:1.4}
.knowledge-graph-specification-detail__actions button{flex:none;height:27px;padding:0 9px;border:1px solid var(--blue);border-radius:5px;background:var(--blue);color:#fff;cursor:pointer;font-size:10px}
@media (max-width:980px){.knowledge-graph-page__header{gap:10px}.knowledge-graph-page__summary span{min-width:52px}.knowledge-graph-page__toolbar{flex-wrap:wrap}.knowledge-graph-page__search{flex:1 1 260px}.knowledge-graph-page__reset{margin-left:0}.knowledge-graph-detail{width:270px}}
</style>
