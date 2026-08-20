<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  KNOWLEDGE_GRAPH_NODE_KINDS,
  KNOWLEDGE_GRAPH_RELATION_LABELS,
  createKnowledgeGraphLayout,
  getKnowledgeGraphNodeKindLabel
} from '../services/knowledgeGraphLayout.js';

const isOpen = ref(false);
const graph = ref(null);
const selectedNodeKey = ref('');
const viewMode = ref('diagnostic');
const nodeKindFilter = ref('all');
const relationTypeFilter = ref('all');
const query = ref('');
const showNegativeDetectability = ref(false);
const showRelationLabels = ref(false);
const viewport = ref({ x: 0, y: 0, scale: 1 });
const svgRef = ref(null);
let panState = null;

const diagnosticRelationTypes = new Set(['OCCURS_ON', 'DETECTABILITY', 'RESOLVED_BY_REPLACING']);
const visibleLegendKinds = computed(() => KNOWLEDGE_GRAPH_NODE_KINDS.filter((kind) => layout.value.kinds.includes(kind.value)));
const focusedGraph = computed(() => {
  const source = graph.value && typeof graph.value === 'object' ? graph.value : { nodes: [], relations: [] };
  if (viewMode.value === 'complete') return source;
  const relations = (Array.isArray(source.relations) ? source.relations : []).filter((relation) => {
    if (!diagnosticRelationTypes.has(relation?.type)) return false;
    if (relation.type === 'DETECTABILITY' && relation.detectable === false && !showNegativeDetectability.value) return false;
    return true;
  });
  const connectedKeys = new Set(relations.flatMap((relation) => [
    relation?.source?.kind && relation?.source?.id ? `${relation.source.kind}:${relation.source.id}` : '',
    relation?.target?.kind && relation?.target?.id ? `${relation.target.kind}:${relation.target.id}` : ''
  ]).filter(Boolean));
  return {
    ...source,
    nodes: (Array.isArray(source.nodes) ? source.nodes : []).filter((node) => connectedKeys.has(`${node.kind}:${node.id}`)),
    relations
  };
});
const layout = computed(() => createKnowledgeGraphLayout(focusedGraph.value));
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

function relationLabel(type) {
  return KNOWLEDGE_GRAPH_RELATION_LABELS[type] || type;
}

function nodeKindLabel(kind) {
  return getKnowledgeGraphNodeKindLabel(kind);
}

function nodeGlyph(kind) {
  return ({ fault: 'F', component: 'D', signalEdge: 'L', measurementPoint: 'M' })[kind] || 'N';
}

function relationPath(relation) {
  const source = nodeByKey.value.get(relation.sourceKey);
  const target = nodeByKey.value.get(relation.targetKey);
  if (!source || !target) return '';
  const direction = target.x >= source.x ? 1 : -1;
  const startX = source.x + (direction * 76);
  const endX = target.x - (direction * 76);
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
  return Boolean(selectedNode.value) && relation.sourceKey !== selectedNode.value.key && relation.targetKey !== selectedNode.value.key;
}

function isNodeDimmed(node) {
  return Boolean(selectedNode.value) && !connectedNodeKeys.value.has(node.key);
}

function resetViewport() {
  viewport.value = { x: 0, y: 0, scale: 1 };
}

function resetFilters() {
  nodeKindFilter.value = 'all';
  relationTypeFilter.value = 'all';
  query.value = '';
  showNegativeDetectability.value = false;
  showRelationLabels.value = false;
  selectedNodeKey.value = '';
  resetViewport();
}

function setViewMode(mode) {
  viewMode.value = mode === 'complete' ? 'complete' : 'diagnostic';
  nodeKindFilter.value = 'all';
  relationTypeFilter.value = 'all';
  selectedNodeKey.value = '';
  resetViewport();
}

function openPage(event) {
  const nextGraph = event?.detail?.graph || window.getDiagnosticKnowledgeGraph?.();
  if (!nextGraph || !Array.isArray(nextGraph.nodes) || !Array.isArray(nextGraph.relations)) return;
  graph.value = nextGraph;
  isOpen.value = true;
  viewMode.value = 'diagnostic';
  resetFilters();
  nextTick(() => document.querySelector('[data-knowledge-graph-close]')?.focus());
}

function updateOpenPage(event) {
  if (!isOpen.value) return;
  const nextGraph = event?.detail?.graph;
  if (!nextGraph || !Array.isArray(nextGraph.nodes) || !Array.isArray(nextGraph.relations)) return;
  graph.value = nextGraph;
  if (selectedNodeKey.value && !nextGraph.nodes.some((node) => `${node.kind}:${node.id}` === selectedNodeKey.value)) {
    selectedNodeKey.value = '';
  }
}

function closePage() {
  isOpen.value = false;
  selectedNodeKey.value = '';
}

function handleKeydown(event) {
  if (isOpen.value && event.key === 'Escape') closePage();
}

function handleWheel(event) {
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const pointerX = ((event.clientX - rect.left) / rect.width) * layout.value.width;
  const pointerY = ((event.clientY - rect.top) / rect.height) * layout.value.height;
  const current = viewport.value;
  const nextScale = Math.min(2.5, Math.max(0.45, current.scale * (event.deltaY < 0 ? 1.12 : 0.89)));
  const localX = (pointerX - current.x) / current.scale;
  const localY = (pointerY - current.y) / current.scale;
  viewport.value = {
    scale: nextScale,
    x: pointerX - (localX * nextScale),
    y: pointerY - (localY * nextScale)
  };
}

function startPan(event) {
  if (event.button !== 0) return;
  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: viewport.value.x,
    originY: viewport.value.y
  };
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function movePan(event) {
  if (!panState || event.pointerId !== panState.pointerId) return;
  const svg = svgRef.value;
  const rect = svg?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  viewport.value = {
    ...viewport.value,
    x: panState.originX + ((event.clientX - panState.startX) * layout.value.width / rect.width),
    y: panState.originY + ((event.clientY - panState.startY) * layout.value.height / rect.height)
  };
}

function stopPan(event) {
  if (panState && event.pointerId === panState.pointerId) panState = null;
}

function selectNode(node) {
  selectedNodeKey.value = selectedNodeKey.value === node.key ? '' : node.key;
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
          <p><span class="knowledge-graph-page__live-dot"></span>实时同步 · 默认聚焦故障定位关系</p>
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
          <button type="button" :class="{ 'is-active': viewMode === 'diagnostic' }" data-knowledge-graph-mode="diagnostic" @click="setViewMode('diagnostic')">诊断聚焦</button>
          <button type="button" :class="{ 'is-active': viewMode === 'complete' }" data-knowledge-graph-mode="complete" @click="setViewMode('complete')">完整图谱</button>
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
                <option v-for="kind in KNOWLEDGE_GRAPH_NODE_KINDS" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
              </select>
            </label>
            <label>
              <span>关系类型</span>
              <select v-model="relationTypeFilter" data-knowledge-graph-relation-filter>
                <option value="all">全部关系</option>
                <option v-for="type in relationTypes" :key="type" :value="type">{{ relationLabel(type) }}</option>
              </select>
            </label>
            <label class="knowledge-graph-page__check">
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
      </div>

      <div class="knowledge-graph-page__body">
        <main class="knowledge-graph-canvas">
          <div class="knowledge-graph-legend" aria-label="节点图例">
            <span v-for="kind in visibleLegendKinds" :key="kind.value" :class="`is-${kind.value}`">
              <i></i>{{ kind.label }}
            </span>
            <span class="is-detectable"><i></i>人工可检测</span>
            <span v-if="showNegativeDetectability" class="is-undetectable"><i></i>人工不可检测</span>
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
            </defs>
            <g :transform="viewportTransform">
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
                  v-for="node in visibleNodes"
                  :key="node.key"
                  :class="[`is-${node.kind}`, { 'is-selected': selectedNodeKey === node.key, 'is-disabled': node.kind === 'fault' && node.enabled === false, 'is-dimmed': isNodeDimmed(node) }]"
                  :transform="`translate(${node.x} ${node.y})`"
                  :data-kg-node-key="node.key"
                  role="button"
                  :aria-label="`${nodeKindLabel(node.kind)}：${node.label}`"
                  @pointerdown.stop
                  @click.stop="selectNode(node)"
                >
                  <rect x="-72" y="-22" width="144" height="44" rx="9"></rect>
                  <circle cx="-49" cy="0" r="13"></circle>
                  <text class="knowledge-graph-node__glyph" x="-49" y="4" text-anchor="middle">{{ nodeGlyph(node.kind) }}</text>
                  <text class="knowledge-graph-node__label" x="-29" y="4">{{ node.label.length > 13 ? `${node.label.slice(0, 12)}…` : node.label }}</text>
                </g>
              </g>
            </g>
          </svg>
          <div v-if="!visibleNodes.length" class="knowledge-graph-canvas__empty">没有符合当前筛选条件的节点。</div>
          <div class="knowledge-graph-canvas__hint">滚轮缩放 · 拖动画布平移 · 点击节点查看关系</div>
        </main>

        <aside v-if="selectedNode" class="knowledge-graph-detail" aria-live="polite">
          <button type="button" class="knowledge-graph-detail__close" aria-label="关闭节点详情" @click="selectedNodeKey = ''">×</button>
          <template>
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
          </template>
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
.knowledge-graph-page__toolbar{position:relative;z-index:5;display:flex;align-items:center;gap:10px;padding:7px 16px;border-bottom:1px solid var(--border);background:var(--bg-card)}
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
.knowledge-graph-page__body{position:relative;display:block;flex:1;min-height:0}
.knowledge-graph-canvas{position:relative;min-width:0;min-height:0;overflow:hidden;background-color:var(--bg-panel);background-image:radial-gradient(circle,var(--border) 1px,transparent 1px);background-size:22px 22px}
.knowledge-graph-svg{display:block;width:100%;height:100%;min-height:420px;cursor:grab;touch-action:none}
.knowledge-graph-svg:active{cursor:grabbing}
.knowledge-graph-relations path{fill:none;stroke:var(--border-dark);stroke-width:1.5;vector-effect:non-scaling-stroke;transition:opacity .15s,stroke .15s}
.knowledge-graph-relations path.is-detectability{stroke:var(--green)}
.knowledge-graph-relations path.is-detectability.is-negative{stroke:var(--textd);stroke-dasharray:5 4}
.knowledge-graph-relations path.is-resolved_by_replacing{stroke:var(--red)}
.knowledge-graph-relations path.is-dimmed,.knowledge-graph-relations text.is-dimmed{opacity:.13}
.knowledge-graph-relations text{paint-order:stroke;stroke:var(--bg-panel);stroke-width:4px;fill:var(--text2);font-family:var(--font-ui);font-size:9px;pointer-events:none}
#knowledge-graph-arrow path{fill:var(--textm)}
.knowledge-graph-nodes>g{cursor:pointer;transition:opacity .15s}
.knowledge-graph-nodes>g.is-dimmed{opacity:.18}
.knowledge-graph-nodes rect{fill:var(--bg-panel);stroke:var(--border-mid);stroke-width:1.5;vector-effect:non-scaling-stroke;filter:drop-shadow(0 3px 4px rgba(30,58,95,.08))}
.knowledge-graph-nodes circle{fill:var(--blue-bg);stroke:var(--blue);stroke-width:1.3;vector-effect:non-scaling-stroke}
.knowledge-graph-nodes .is-fault rect{stroke:var(--red-border)}
.knowledge-graph-nodes .is-fault circle{fill:var(--red-bg);stroke:var(--red)}
.knowledge-graph-nodes .is-fault.is-disabled rect{stroke:var(--textm);stroke-dasharray:5 4;fill:var(--bg-card)}
.knowledge-graph-nodes .is-fault.is-disabled circle{fill:var(--bg-card);stroke:var(--textm)}
.knowledge-graph-nodes .is-signalEdge rect{stroke:#f2c795}
.knowledge-graph-nodes .is-signalEdge circle{fill:var(--orange-bg);stroke:var(--orange)}
.knowledge-graph-nodes .is-measurementPoint rect{stroke:#9ed4ae}
.knowledge-graph-nodes .is-measurementPoint circle{fill:var(--green-bg);stroke:var(--green)}
.knowledge-graph-nodes .is-selected rect{stroke:var(--blue);stroke-width:2.5;filter:drop-shadow(0 5px 8px rgba(29,111,191,.2))}
.knowledge-graph-node__glyph{fill:var(--text);font-family:var(--font-data);font-size:9px;font-weight:600;pointer-events:none}
.knowledge-graph-node__label{fill:var(--text);font-size:10px;font-weight:600;pointer-events:none}
.knowledge-graph-node__id{fill:var(--textm);font-family:var(--font-data);font-size:7.5px;pointer-events:none}
.knowledge-graph-legend{position:absolute;top:10px;left:12px;z-index:2;display:flex;flex-wrap:wrap;gap:5px 10px;max-width:calc(100% - 24px);padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:rgba(255,255,255,.9);color:var(--text2);font-size:8px;pointer-events:none}
.knowledge-graph-legend span{display:flex;align-items:center;gap:4px;white-space:nowrap}
.knowledge-graph-legend i{width:8px;height:8px;border-radius:3px;background:var(--blue)}
.knowledge-graph-legend .is-fault i{background:var(--red)}
.knowledge-graph-legend .is-signalEdge i{background:var(--orange)}
.knowledge-graph-legend .is-measurementPoint i,.knowledge-graph-legend .is-detectable i{background:var(--green)}
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
@media (max-width:980px){.knowledge-graph-page__header{gap:10px}.knowledge-graph-page__summary span{min-width:52px}.knowledge-graph-page__toolbar{flex-wrap:wrap}.knowledge-graph-page__search{flex:1 1 260px}.knowledge-graph-page__reset{margin-left:0}.knowledge-graph-detail{width:270px}}
</style>
