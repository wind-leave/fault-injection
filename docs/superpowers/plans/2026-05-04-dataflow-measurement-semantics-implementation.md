# Dataflow Measurement Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current multi-signal flow graph into a Chinese, measurement-point-first diagnostic view that distinguishes propagating faults, local faults, blocked links, and diagnostic residuals.

**Architecture:** Keep Python variables, signal ids, node ids, and CAN metadata as internal engineering keys. Add a semantic layer near the existing dataflow runtime that derives Chinese labels, measurement points, and propagation classes from nodes, edges, signal channels, fault bindings, and optional model package metadata. Render the dataflow panel from this semantic model, and expose the same semantic model to the property inspector.

**Tech Stack:** Vue 3 app shell, legacy browser runtime in `src/services/legacy-runtime.txt`, Vitest + jsdom app tests, existing model package JSON fixtures.

**Commit Policy:** Do not commit from worker agents unless the user explicitly asks. The worktree is already dirty and contains user visual changes.

---

## File Structure

- Modify `src/services/legacy-runtime.txt`
  - Add semantic helpers inside the existing multi-signal flow graph IIFE near `getDataflowEdgeMetrics`.
  - Keep changes localized to dataflow collection/rendering and edge property inspector glue.
  - Export `buildDataflowSemanticModel`, `collectMeasurementPoints`, and `classifyFaultPropagation` on `window` for tests and later reuse.
- Modify `src/styles/components.css`
  - Add only the CSS needed for measurement badges, propagation legend, Chinese chain cards, and selected measurement state.
  - Do not reformat or rewrite existing visual blocks.
- Modify `tests/canvas-layout-app.spec.js`
  - Add app-level tests for Chinese measurement-point dataflow rendering and propagation semantics.
  - Update current dataflow assertions away from mojibake text and toward stable `data-*` selectors and Chinese labels.
- Modify `tests/property-panel-app.spec.js`
  - Add tests for Chinese edge summary plus advanced internal mapping fields.
- Optional modify `public/model-packages/evtol_closed_loop_fault_demo.json`
  - Add optional display metadata only if the semantic fallback cannot generate enough high-quality Chinese labels.
  - If modified, preserve all existing ids, Python bindings, edges, and fault library entries.

---

## Task 1: Semantic Model And Measurement Point Collector

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Write the failing test for semantic exports and Chinese measurement points**

Add this test after the existing dataflow test in `tests/canvas-layout-app.spec.js`:

```js
  it('builds a Chinese measurement-point semantic model for the closed-loop flight-control demo', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildDataflowSemanticModel).toBe('function');
    expect(typeof window.collectMeasurementPoints).toBe('function');
    expect(typeof window.classifyFaultPropagation).toBe('function');

    const semantic = window.buildDataflowSemanticModel();

    expect(semantic.stages.map((stage) => stage.labelZh)).toEqual([
      '指令与参考',
      '控制与分配',
      '执行与机体',
      '测量与估计',
      '诊断与残差'
    ]);
    expect(semantic.measurementPoints.length).toBeGreaterThanOrEqual(6);
    expect(semantic.measurementPoints.some((point) => point.labelZh.includes('测点 M1'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.signalNameZh.includes('姿态指令'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.signalNameZh.includes('IMU'))).toBe(true);
    expect(semantic.measurementPoints.some((point) => point.role === 'residual')).toBe(true);
    expect(semantic.edges.some((edge) => edge.signalPathZh.includes('IMU') && edge.signalPathZh.includes('反馈'))).toBe(true);
    expect(semantic.edges.every((edge) => edge.engineeringKey)).toBe(true);

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "builds a Chinese measurement-point semantic model"
```

Expected: fail because `window.buildDataflowSemanticModel` and `window.collectMeasurementPoints` are not implemented.

- [ ] **Step 3: Add minimal semantic helper functions**

Inside the dataflow IIFE in `src/services/legacy-runtime.txt`, near `getDataflowEdgeMetrics`, add helpers with these exact public contracts:

```js
  const DATAFLOW_STAGE_DEFS=[
    {id:'command',labelZh:'指令与参考',roles:['command','source']},
    {id:'control',labelZh:'控制与分配',roles:['control','allocation']},
    {id:'plant',labelZh:'执行与机体',roles:['actuation','plant']},
    {id:'measurement',labelZh:'测量与估计',roles:['measurement','estimate','protocol']},
    {id:'diagnostic',labelZh:'诊断与残差',roles:['residual','diagnostic']}
  ];

  const SIGNAL_ZH_PATTERNS=[
    {test:/command|reference|target/i,name:'姿态指令',role:'command',path:'指令输入链路'},
    {test:/control|controller|error/i,name:'控制误差/控制输出',role:'control',path:'控制计算链路'},
    {test:/alloc|motor_command|throttle|pwm/i,name:'电机指令',role:'actuation',path:'控制分配链路'},
    {test:/thrust|vehicle|body|pitch_rate|attitude/i,name:'机体姿态响应',role:'plant',path:'机体动力学链路'},
    {test:/imu|gyro|accel|baro|gps|measured/i,name:'IMU 测量反馈',role:'measurement',path:'测量反馈链路'},
    {test:/estimate|estimator|state/i,name:'状态估计',role:'estimate',path:'状态估计链路'},
    {test:/residual|diagnostic|fault_indicator/i,name:'残差诊断',role:'residual',path:'残差诊断链路'}
  ];

  function getSemanticTextSeed(edge,metrics,sourceNode,targetNode){
    const channels=Array.isArray(edge?.signalChannels)?edge.signalChannels:[];
    return [
      edge?.signalId,
      edge?.channelId,
      edge?.messageId,
      metrics?.signalId,
      metrics?.signalName,
      metrics?.sourceName,
      metrics?.targetName,
      sourceNode?.props?.name,
      targetNode?.props?.name,
      ...channels.flatMap(channel=>[channel.signalId,channel.channelId,channel.messageId,channel.pythonVariable])
    ].filter(Boolean).join(' ');
  }

  function inferSignalChineseMeta(edge,metrics){
    const sourceNode=getNode(edge?.sourceNodeId);
    const targetNode=getNode(edge?.targetNodeId);
    const seed=getSemanticTextSeed(edge,metrics,sourceNode,targetNode);
    const match=SIGNAL_ZH_PATTERNS.find(item=>item.test.test(seed))||SIGNAL_ZH_PATTERNS[1];
    const explicit=edge?.displayNameZh||edge?.signalNameZh||edge?.signalPathZh||edge?.labelZh;
    return {
      signalNameZh:explicit||match.name,
      signalPathZh:edge?.signalPathZh||match.path,
      role:edge?.role||match.role,
      engineeringKey:edge?.signalId||metrics?.signalId||edge?.id,
      pythonVariable:edge?.pythonVariable||edge?.sourcePortMeta?.varName||''
    };
  }

  function classifyFaultPropagation(faultModel={},target={},edge=null){
    const layer=String(faultModel?.layer||target?.layer||'').toLowerCase();
    const behavior=String(faultModel?.runtimeBehavior||faultModel?.faultCode||faultModel?.modelClass||faultModel?.id||'').toLowerCase();
    const policy=String(edge?.faultPropagationPolicy||target?.faultPropagationPolicy||'inherit');
    if(policy==='blocks'){return 'blocked';}
    if(policy==='localOnly'){return 'localEffect';}
    if(policy==='diagnosticOnly'){return 'diagnosticOnly';}
    if(layer.includes('protocol')||layer.includes('communication')){return behavior.includes('loss')||behavior.includes('interrupt')||behavior.includes('block')?'blocked':'propagated';}
    if(/sensor|noise|freeze|jump|flip|bias|scale|actuator|lock/.test(behavior)||layer.includes('electrical')||layer.includes('sensor')){return 'propagated';}
    if(layer.includes('physical')||/parameter|mass|inertia|gain|saturation|drift|step/.test(behavior)){return 'localEffect';}
    return faultModel?.name?'propagated':'none';
  }

  function collectMeasurementPoints(rows=collectDataflowEdges()){
    return rows.map((item,index)=>{
      const edge=item.edge;
      const metrics=item.metrics;
      const meta=inferSignalChineseMeta(edge,metrics);
      const faultModel=getFaultModelForEdge(edge)||getFaultModelForNode(getNode(edge.sourceNodeId))||{};
      const faultInfluence=classifyFaultPropagation(faultModel,edge,edge);
      const role=meta.role;
      return {
        id:`mp-${edge.id}`,
        edgeId:edge.id,
        labelZh:`测点 M${index+1}：${meta.signalNameZh}`,
        signalNameZh:meta.signalNameZh,
        signalPathZh:meta.signalPathZh,
        bindTarget:role==='residual'?'residual':'edge',
        role,
        engineeringKey:meta.engineeringKey,
        pythonVariable:meta.pythonVariable,
        unit:metrics.signalUnit||edge.signalUnit||'',
        sampleRate:metrics.sampleRate||edge.sampleRate||'',
        currentValue:metrics.currentValue,
        residualValue:metrics.residualValue,
        faultInfluence
      };
    });
  }

  function buildDataflowSemanticModel(){
    const rows=collectDataflowEdges();
    const measurementPoints=collectMeasurementPoints(rows);
    const pointByEdge=new Map(measurementPoints.map(point=>[point.edgeId,point]));
    const edges=rows.map(item=>{
      const meta=inferSignalChineseMeta(item.edge,item.metrics);
      const point=pointByEdge.get(item.edge.id);
      return {
        edge:item.edge,
        metrics:item.metrics,
        id:item.edge.id,
        signalNameZh:meta.signalNameZh,
        signalPathZh:meta.signalPathZh,
        engineeringKey:meta.engineeringKey,
        role:meta.role,
        propagationKind:point?.faultInfluence||'none',
        measurementPointId:point?.id||''
      };
    });
    return {
      stages:DATAFLOW_STAGE_DEFS,
      edges,
      measurementPoints,
      summary:{
        totalEdges:edges.length,
        totalMeasurementPoints:measurementPoints.length,
        propagated:measurementPoints.filter(point=>point.faultInfluence==='propagated').length,
        blocked:measurementPoints.filter(point=>point.faultInfluence==='blocked').length,
        localEffect:measurementPoints.filter(point=>point.faultInfluence==='localEffect').length,
        diagnosticOnly:measurementPoints.filter(point=>point.faultInfluence==='diagnosticOnly'||point.role==='residual').length
      }
    };
  }
```

Add the new functions to the final `Object.assign(window,{...})` in the dataflow IIFE:

```js
    buildDataflowSemanticModel,
    collectMeasurementPoints,
    classifyFaultPropagation,
```

- [ ] **Step 4: Run Task 1 test and verify GREEN**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "builds a Chinese measurement-point semantic model"
```

Expected: pass.

- [ ] **Step 5: Run current dataflow tests**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js
```

Expected: all tests in `tests/canvas-layout-app.spec.js` pass.

---

## Task 2: Measurement-First Dataflow Rendering

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Write the failing rendering test**

Add this test after Task 1's semantic model test:

```js
  it('renders the dataflow panel as Chinese measurement-point chains', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    expect(panel?.querySelector('[data-dataflow-view="measurement-first"]')).not.toBeNull();
    expect(panel?.textContent).toContain('中文测点链路');
    expect(panel?.textContent).toContain('指令与参考');
    expect(panel?.textContent).toContain('控制与分配');
    expect(panel?.textContent).toContain('执行与机体');
    expect(panel?.textContent).toContain('测量与估计');
    expect(panel?.textContent).toContain('诊断与残差');
    expect(panel?.querySelectorAll('[data-measurement-point]').length).toBeGreaterThanOrEqual(6);
    expect(panel?.textContent).toContain('测点 M1');
    expect(panel?.textContent).toContain('IMU 测量反馈');
    expect(panel?.textContent).toContain('残差诊断');
    expect(panel?.textContent).toContain('内部映射');
    expect(panel?.textContent).toContain('传播');
    expect(panel?.textContent).toContain('本地');
    expect(panel?.textContent).toContain('阻断');

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the rendering test and verify RED**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "renders the dataflow panel as Chinese measurement-point chains"
```

Expected: fail because `[data-dataflow-view="measurement-first"]` and measurement point badges are missing.

- [ ] **Step 3: Replace the dataflow panel body with measurement-first sections**

In `renderDataflowPanel()`, keep the empty state and existing panel host. Replace the non-empty `panel.innerHTML` with a measurement-first layout that uses `const semantic=buildDataflowSemanticModel();`.

Add helper renderers near `renderDataflowPanel()`:

```js
  function getPropagationLabel(kind){
    return {
      none:'正常',
      propagated:'传播',
      localEffect:'本地',
      blocked:'阻断',
      diagnosticOnly:'诊断'
    }[kind]||'正常';
  }

  function renderMeasurementPoint(point){
    return `
      <button type="button" class="measurement-point is-${escapeHtml(point.faultInfluence)}" data-measurement-point="${escapeHtml(point.id)}" data-dataflow-edge="${escapeHtml(point.edgeId)}">
        <span class="measurement-point__tag">${escapeHtml(point.labelZh.split('：')[0])}</span>
        <strong>${escapeHtml(point.signalNameZh)}</strong>
        <span>${escapeHtml(point.signalPathZh)}</span>
        <em>${escapeHtml(getPropagationLabel(point.faultInfluence))}</em>
      </button>`;
  }

  function renderSemanticStage(stage,semantic){
    const points=semantic.measurementPoints.filter(point=>stage.roles.includes(point.role));
    return `
      <section class="signal-chain-stage" data-signal-stage="${escapeHtml(stage.id)}">
        <div class="signal-chain-stage__head">
          <strong>${escapeHtml(stage.labelZh)}</strong>
          <span>${points.length} 个测点</span>
        </div>
        <div class="signal-chain-stage__points">
          ${points.length?points.map(renderMeasurementPoint).join(''):'<div class="signal-chain-stage__empty">当前链路未生成测点</div>'}
        </div>
      </section>`;
  }
```

Use this structure for the non-empty panel:

```js
    const semantic=buildDataflowSemanticModel();
    panel.innerHTML=`
      <div class="dataflow-workspace" data-dataflow-view="measurement-first">
        <div class="dataflow-head">
          <div>
            <div class="dataflow-title">中文测点链路</div>
            <div class="dataflow-sub">内部 Python 变量和 CAN 报文保留为映射，主视图按中文链路、测点和故障传播关系呈现。</div>
          </div>
          <div class="dataflow-legend dataflow-legend--semantic">
            <span class="dataflow-legend__item is-normal">正常</span>
            <span class="dataflow-legend__item is-fault">传播</span>
            <span class="dataflow-legend__item is-local">本地</span>
            <span class="dataflow-legend__item is-blocked">阻断</span>
            <span class="dataflow-legend__item is-residual">诊断</span>
          </div>
        </div>
        <div class="dataflow-body dataflow-body--semantic">
          <div class="signal-chain-map">
            ${semantic.stages.map(stage=>renderSemanticStage(stage,semantic)).join('')}
          </div>
          <aside class="dataflow-side" aria-label="中文测点与内部映射">
            <div class="dataflow-stats">
              <div class="dataflow-stat"><span>测点</span><strong>${semantic.summary.totalMeasurementPoints}</strong></div>
              <div class="dataflow-stat"><span>传播</span><strong>${semantic.summary.propagated}</strong></div>
              <div class="dataflow-stat"><span>阻断</span><strong>${semantic.summary.blocked}</strong></div>
              <div class="dataflow-stat"><span>本地</span><strong>${semantic.summary.localEffect}</strong></div>
            </div>
            <section class="dataflow-section" data-dataflow-section="mapping">
              <div class="dataflow-section__head"><span>内部映射</span><strong>${semantic.edges.length}</strong></div>
              <div class="dataflow-section__body">
                ${semantic.edges.map(renderDataflowEdgeCard).join('')}
              </div>
            </section>
          </aside>
        </div>
      </div>`;
```

Keep `bindDataflowPanelSelection(panel);` after the new HTML so selecting a measurement point still selects its edge.

- [ ] **Step 4: Add minimal CSS for the new semantic view**

Append focused CSS to `src/styles/components.css`:

```css
.dataflow-body--semantic{
  grid-template-columns:minmax(0,1fr) clamp(340px,30vw,500px);
}
.signal-chain-map{
  min-width:0;
  min-height:0;
  display:grid;
  grid-template-columns:repeat(5,minmax(170px,1fr));
  gap:10px;
  overflow:auto;
  border:1px solid #d3dfec;
  border-radius:8px;
  background:#f8fbff;
  padding:12px;
}
.signal-chain-stage{
  min-width:0;
  display:grid;
  grid-template-rows:auto minmax(0,1fr);
  gap:8px;
}
.signal-chain-stage__head{
  min-height:48px;
  border:1px solid #dbe6f4;
  border-radius:8px;
  background:#fff;
  padding:8px 10px;
}
.signal-chain-stage__head strong{
  display:block;
  color:#10243d;
  font-size:13px;
  font-weight:900;
}
.signal-chain-stage__head span{
  display:block;
  margin-top:3px;
  color:#6b7d95;
  font-size:11px;
  font-weight:800;
}
.signal-chain-stage__points{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.measurement-point{
  width:100%;
  min-height:92px;
  border:1px solid #cbd8e7;
  border-left:4px solid #2f73ff;
  border-radius:8px;
  background:#fff;
  padding:9px;
  text-align:left;
  cursor:pointer;
}
.measurement-point strong,
.measurement-point span,
.measurement-point em{
  display:block;
}
.measurement-point__tag{
  color:#2f73ff;
  font-family:var(--font-data);
  font-size:11px;
  font-weight:900;
}
.measurement-point strong{
  margin-top:4px;
  color:#10243d;
  font-size:13px;
  font-weight:900;
}
.measurement-point span:not(.measurement-point__tag){
  margin-top:4px;
  color:#5c718c;
  font-size:11px;
  line-height:1.45;
}
.measurement-point em{
  width:max-content;
  margin-top:7px;
  padding:2px 7px;
  border-radius:999px;
  background:#eef5ff;
  color:#2f73ff;
  font-style:normal;
  font-size:10px;
  font-weight:900;
}
.measurement-point.is-propagated{border-left-color:#dc2626;background:#fffafa;}
.measurement-point.is-propagated em{background:#fee2e2;color:#dc2626;}
.measurement-point.is-localEffect{border-left-color:#f97316;background:#fff7ed;}
.measurement-point.is-localEffect em{background:#ffedd5;color:#c2410c;}
.measurement-point.is-blocked{border-left-color:#64748b;background:#f8fafc;}
.measurement-point.is-blocked em{background:#e2e8f0;color:#475569;}
.measurement-point.is-diagnosticOnly{border-left-color:#d97706;background:#fffbeb;}
.measurement-point.is-diagnosticOnly em{background:#fef3c7;color:#b45309;}
.dataflow-legend__item.is-local::before{background:#f97316;}
.dataflow-legend__item.is-blocked::before{background:#64748b;}
@media (max-width:1180px){
  .signal-chain-map{grid-template-columns:repeat(3,minmax(170px,1fr));}
}
@media (max-width:980px){
  .dataflow-body--semantic{grid-template-columns:1fr;}
  .signal-chain-map{grid-template-columns:1fr;}
}
```

- [ ] **Step 5: Run rendering test and verify GREEN**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "renders the dataflow panel as Chinese measurement-point chains"
```

Expected: pass.

- [ ] **Step 6: Run canvas layout app tests**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js
```

Expected: all tests pass.

---

## Task 3: Fault Propagation Semantics

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Write the failing test for propagating versus local faults**

Add this test after the measurement rendering test:

```js
  it('separates propagating faults from local parameter faults in dataflow semantics', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    window.doCreateBlankWorkspace();
    window.createNode('signal_source', 120, 160);
    window.createNode('simulation_block', 360, 160);
    window.createNode('simulation_block', 600, 160);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const [source, localBlock, sensorBlock] = state.modelNodes;
    localBlock.props.name = '机体动力学';
    sensorBlock.props.name = 'IMU 测量';
    localBlock.faultBindings = [{
      bindingId: 'local-mass-bias',
      name: '质量参数偏置',
      layer: 'physical',
      runtimeBehavior: 'parameter_bias',
      active: true
    }];
    state.modelEdges.push(
      {
        id: 'edge-local-plant',
        lineType: 'normal',
        sourceNodeId: source.id,
        targetNodeId: localBlock.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalId: 'body.pitch_rate',
        faultPropagationPolicy: 'localOnly'
      },
      {
        id: 'edge-imu-feedback',
        lineType: 'can',
        sourceNodeId: localBlock.id,
        targetNodeId: sensorBlock.id,
        sourcePortIndex: 0,
        targetPortIndex: 0,
        signalChannels: [{
          signalId: 'imu.pitch_rate',
          channelId: 'CAN-FC-IMU',
          messageId: '0x184',
          faultPropagationPolicy: 'propagates'
        }],
        faultBindings: [{
          bindingId: 'sensor-bias',
          name: '传感器加性偏置',
          layer: 'electrical',
          runtimeBehavior: 'sensor_bias',
          active: true,
          parameters: { affectedChannels: ['CAN-FC-IMU'] }
        }]
      }
    );

    const semantic = window.buildDataflowSemanticModel();
    const localPoint = semantic.measurementPoints.find((point) => point.edgeId === 'edge-local-plant');
    const propagatedPoint = semantic.measurementPoints.find((point) => point.edgeId === 'edge-imu-feedback');

    expect(localPoint?.faultInfluence).toBe('localEffect');
    expect(propagatedPoint?.faultInfluence).toBe('propagated');

    window.setCanvasView('dataflow');
    await flushRuntime();

    const localCard = document.querySelector('[data-measurement-point="mp-edge-local-plant"]');
    const propagatedCard = document.querySelector('[data-measurement-point="mp-edge-imu-feedback"]');
    expect(localCard?.textContent).toContain('本地');
    expect(localCard?.classList.contains('is-localEffect')).toBe(true);
    expect(propagatedCard?.textContent).toContain('传播');
    expect(propagatedCard?.classList.contains('is-propagated')).toBe(true);

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the propagation test and verify RED**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "separates propagating faults"
```

Expected: fail until `classifyFaultPropagation` uses edge fault bindings, source-node local faults, and `faultPropagationPolicy` correctly.

- [ ] **Step 3: Update fault selection logic in semantic helpers**

Add a helper near `classifyFaultPropagation`:

```js
  function getSemanticFaultForEdge(edge){
    const edgeFault=getFaultModelForEdge(edge);
    if(edgeFault){return edgeFault;}
    const sourceNode=getNode(edge?.sourceNodeId);
    const sourceFault=getFaultModelForNode(sourceNode);
    if(sourceFault){return sourceFault;}
    return {};
  }
```

Update both `collectMeasurementPoints` and `buildDataflowSemanticModel` to use `getSemanticFaultForEdge(edge)` rather than directly reimplementing fault lookup.

Update `classifyFaultPropagation` so explicit policy wins:

```js
    if(policy==='propagates'){return 'propagated';}
    if(policy==='blocks'){return 'blocked';}
    if(policy==='localOnly'){return 'localEffect';}
    if(policy==='diagnosticOnly'){return 'diagnosticOnly';}
```

- [ ] **Step 4: Run propagation test and verify GREEN**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "separates propagating faults"
```

Expected: pass.

- [ ] **Step 5: Run full canvas layout app tests**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js
```

Expected: all tests pass.

---

## Task 4: Chinese Edge Property Summary With Advanced Internal Mapping

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/property-panel-app.spec.js`

- [ ] **Step 1: Write the failing property panel test**

Add this test after the existing CAN inspector test:

```js
  it('shows a Chinese edge summary before internal variable mapping', async () => {
    const wrapper = await mountWorkbench();

    window.doCreateBlankWorkspace();
    window.createNode('simulation_block', 160, 220);
    window.createNode('simulation_block', 460, 220);
    await flushRuntime();

    const state = window.__GZ_STATE__;
    const source = state.modelNodes[0];
    const target = state.modelNodes[1];
    source.props.name = '机体动力学';
    target.props.name = '状态估计器';
    state.modelEdges.push({
      id: 'edge-imu-zh-summary',
      lineType: 'can',
      sourceNodeId: source.id,
      targetNodeId: target.id,
      sourcePortIndex: 0,
      targetPortIndex: 0,
      signalPathZh: 'IMU 测量反馈链路',
      signalNameZh: '俯仰角速度测量',
      signalId: 'imu.pitch_rate',
      channelId: 'CAN-FC-IMU',
      messageId: '0x184',
      pythonVariable: 'measured_rate',
      faultPropagationPolicy: 'propagates'
    });

    window.renderModelNodes();
    window.selectEdge('edge-imu-zh-summary');
    await flushRuntime();

    const panelText = document.getElementById('pd')?.textContent ?? '';
    expect(document.querySelector('[data-edge-chinese-summary]')).not.toBeNull();
    expect(panelText).toContain('中文链路摘要');
    expect(panelText).toContain('IMU 测量反馈链路');
    expect(panelText).toContain('俯仰角速度测量');
    expect(panelText).toContain('可沿信号传播');
    expect(document.querySelector('[data-edge-internal-mapping]')).not.toBeNull();
    expect(panelText).toContain('内部映射');
    expect(panelText).toContain('imu.pitch_rate');
    expect(panelText).toContain('measured_rate');
    expect(panelText).toContain('CAN-FC-IMU');
    expect(panelText).toContain('0x184');

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the property test and verify RED**

Run:

```powershell
npm test -- --run tests\property-panel-app.spec.js -t "shows a Chinese edge summary"
```

Expected: fail because the overview lacks `[data-edge-chinese-summary]` and Chinese propagation text.

- [ ] **Step 3: Add Chinese summary rendering to edge overview**

In `renderEdgeOverview(edge)`, before the existing technical route rows, insert:

```js
    const metrics=(typeof getDataflowEdgeMetrics==='function')?getDataflowEdgeMetrics(edge):{};
    const semantic=(typeof inferSignalChineseMeta==='function')?inferSignalChineseMeta(edge,metrics):{
      signalNameZh:edge.signalNameZh||edge.signalId||edge.id,
      signalPathZh:edge.signalPathZh||edge.id
    };
    const propagationKind=(typeof classifyFaultPropagation==='function')
      ?classifyFaultPropagation(getSemanticFaultForEdge?.(edge)||edge.injectedFault||{},edge,edge)
      :'none';
    const propagationText={
      none:'正常信号',
      propagated:'可沿信号传播',
      localEffect:'本地参数影响',
      blocked:'链路阻断/保持',
      diagnosticOnly:'诊断指标'
    }[propagationKind]||'正常信号';
```

Add this HTML near the top of the returned overview template:

```html
      <div class="pgroup" data-edge-chinese-summary>
        <div class="pglbl">中文链路摘要</div>
        ${renderRows([
          ['链路名称',semantic.signalPathZh],
          ['主信号',semantic.signalNameZh],
          ['传播语义',propagationText],
          ['源模块',source?.props?.name||edge.sourceNodeId],
          ['目标模块',dest?.props?.name||edge.targetNodeId]
        ])}
      </div>
      <div class="pgroup" data-edge-internal-mapping>
        <div class="pglbl">内部映射</div>
        ${renderRows([
          ['signalId',edge.signalId||metrics.signalId||'--'],
          ['pythonVariable',edge.pythonVariable||edge.sourcePortMeta?.varName||'--'],
          ['CAN channel',edge.channelId||metrics.channelId||'--'],
          ['CAN message',edge.messageId||metrics.messageId||'--']
        ])}
      </div>
```

If `inferSignalChineseMeta` and `getSemanticFaultForEdge` are scoped inside the dataflow IIFE and not visible in the typed property panel IIFE, either export them to `window` or duplicate a small fallback wrapper in the property panel IIFE. Prefer exporting them if it is safe.

- [ ] **Step 4: Run the property test and verify GREEN**

Run:

```powershell
npm test -- --run tests\property-panel-app.spec.js -t "shows a Chinese edge summary"
```

Expected: pass.

- [ ] **Step 5: Run property panel tests**

Run:

```powershell
npm test -- --run tests\property-panel-app.spec.js
```

Expected: all tests pass.

---

## Task 5: Regression Sweep And UI Audit

**Files:**
- Modify only if a previous task caused a verified regression.
- Test: existing test suite and UI audit.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js tests\property-panel-app.spec.js tests\flight-model-package.spec.js tests\fault-injection-service.spec.js
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test -- --run
```

Expected: all test files pass. If jsdom prints `Not implemented: navigation to another Document` while exit code is 0, record it as a known jsdom warning rather than a failure.

- [ ] **Step 3: Run UI audit**

Run:

```powershell
npm run audit:ui
```

Expected: all audit checks pass. If the audit needs a new check for measurement-point dataflow, add it only if the current audit structure already supports a stable string/selector check without brittle visual assertions.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm run build
```

Expected: build succeeds. Existing Vite chunk-size warning is acceptable if no new build error appears.

- [ ] **Step 5: Check local service**

Run:

```powershell
Invoke-WebRequest http://127.0.0.1:5175/ -UseBasicParsing -TimeoutSec 5 | Select-Object -ExpandProperty StatusCode
```

Expected: `200` if the existing dev server is still running. If it is not running, start `npm run dev -- --host 127.0.0.1 --port 5175` in a hidden process and repeat the check.

---

## Self-Review

Spec coverage:

- Chinese semantic wrapper: Task 1 and Task 4.
- Measurement points: Task 1 and Task 2.
- Propagating versus local/blocking/diagnostic faults: Task 3 and Task 2 legend.
- Chinese-first UI with internal English mapping retained: Task 2 and Task 4.
- Model-building principle of English/Python internally and Chinese externally: Task 1 fallback labels and Task 4 mapping display.
- Tests and verification: Task 1 through Task 5.

Placeholder scan:

- No `TBD`, `TODO`, `implement later`, or open-ended "add appropriate" steps are intentionally present.

Type consistency:

- Public helper names are consistent across tasks: `buildDataflowSemanticModel`, `collectMeasurementPoints`, `classifyFaultPropagation`.
- Measurement fields are consistent across tasks: `labelZh`, `signalNameZh`, `signalPathZh`, `faultInfluence`, `engineeringKey`.
- Propagation values are consistent: `none`, `propagated`, `localEffect`, `blocked`, `diagnosticOnly`.
