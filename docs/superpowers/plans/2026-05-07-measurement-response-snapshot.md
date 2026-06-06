# Measurement Response Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a measurement response snapshot workflow to the multi-signal flow graph so one temporary operation, such as cutting a link, returns baseline versus operated readings for all predefined measurement points.

**Architecture:** Keep the first implementation inside the existing legacy runtime because the dataflow semantic model, graph rendering, and tests already live there. Add a focused measurement-response calculation layer with explicit state fields, then render a compact response panel that consumes this transient response. The response state must not write `injectedFault`, `faultBindings`, or saved model package data.

**Tech Stack:** Vue 3 app shell, legacy browser runtime in `src/services/legacy-runtime.txt`, Vitest + Vue Test Utils, CSS in `src/styles/components.css`.

---

## File Structure

- Modify `src/services/legacy-runtime.txt`
  - Add transient state fields on `S`.
  - Add measurement scenario option, target option, calculation, summary, filtering, and selection functions.
  - Add response panel rendering inside `renderDataflowPanel()`.
  - Extend dataflow binding to handle scenario controls, filters, calculation, and row selection.
  - Extend mapping detail rows to show response reason when opened from a response row.

- Modify `src/styles/components.css`
  - Add styles for measurement response controls, summary cards, response table, row severity states, and temporary graph highlights.

- Modify `tests/canvas-layout-app.spec.js`
  - Add unit-style UI-runtime tests for response calculation.
  - Add UI rendering and interaction tests for the response panel.
  - Add mutation guard assertions for `injectedFault`.

No new source file is required in this first pass. The legacy runtime is already the boundary used by dataflow rendering; splitting into a separate service belongs in a separate refactor plan after behavior stabilizes.

---

### Task 1: Measurement Response Data Layer

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Add a failing calculation test**

Append this test near the existing dataflow semantic tests in `tests/canvas-layout-app.spec.js`.

```js
  it('calculates a measurement response snapshot without mutating injected faults', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    const importResult = window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    expect(importResult).toMatchObject({ ok: true });
    expect(typeof window.buildMeasurementScenarioOptions).toBe('function');
    expect(typeof window.buildMeasurementTargetOptions).toBe('function');
    expect(typeof window.createMeasurementScenario).toBe('function');
    expect(typeof window.calculateMeasurementResponse).toBe('function');

    const targetEdge = window.__GZ_STATE__.modelEdges.find((edge) => edge.id === 'edge-imu-error');
    expect(targetEdge).toBeTruthy();
    expect(targetEdge.injectedFault).toBeUndefined();

    const scenario = window.createMeasurementScenario({
      type: 'link_cut',
      targetKind: 'edge',
      targetId: 'edge-imu-error',
      parameters: { time: 0 }
    });
    const response = window.calculateMeasurementResponse(scenario);
    const semantic = window.buildDataflowSemanticModel();
    const targetPoint = response.points.find((point) => point.edgeId === 'edge-imu-error');

    expect(response.mode).toBe('snapshot');
    expect(response.points).toHaveLength(semantic.measurementPoints.length);
    expect(response.summary.total).toBe(semantic.measurementPoints.length);
    expect(response.summary.cut).toBeGreaterThanOrEqual(1);
    expect(response.summary.affected).toBeGreaterThanOrEqual(1);
    expect(targetPoint).toMatchObject({
      edgeId: 'edge-imu-error',
      status: 'cut',
      statusLabelZh: '链路截断',
      affectedByTarget: true
    });
    expect(targetPoint.operatedValue).toBeNull();
    expect(Array.isArray(targetPoint.samples)).toBe(true);
    expect(targetEdge.injectedFault).toBeUndefined();

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response snapshot"
```

Expected: FAIL because `buildMeasurementScenarioOptions` or `calculateMeasurementResponse` is not defined.

- [ ] **Step 3: Add transient state fields**

In the top-level `S` object in `src/services/legacy-runtime.txt`, add these fields near the existing dataflow and selection fields:

```js
  measurementScenario:null,
  measurementResponse:null,
  measurementResponseFilter:'all',
  selectedMeasurementPointId:'',
```

- [ ] **Step 4: Add operation constants and value helpers**

Insert this block after `buildDataflowSemanticModel()` and before `getDataflowEdgeMetrics(edge)`.

```js
  const MEASUREMENT_RESPONSE_OPERATIONS=[
    {
      id:'link_cut',
      labelZh:'截断链路',
      targetKind:'edge',
      parameterDefaults:{time:0},
      descriptionZh:'将目标链路视为无有效信号，观察所有测点变化。'
    },
    {
      id:'parameter_shift',
      labelZh:'参数偏移',
      targetKind:'node',
      parameterDefaults:{offset:0.05},
      descriptionZh:'对目标模块输出施加偏移，观察下游测点响应。'
    },
    {
      id:'can_delay',
      labelZh:'CAN 延迟',
      targetKind:'edge',
      parameterDefaults:{delayMs:120},
      descriptionZh:'对 CAN 链路施加协议延迟，观察诊断和残差测点。'
    },
    {
      id:'packet_loss',
      labelZh:'CAN 丢包',
      targetKind:'edge',
      parameterDefaults:{dropRate:0.2},
      descriptionZh:'对 CAN 链路施加丢包率，观察链路和下游测点。'
    },
    {
      id:'actuator_loss',
      labelZh:'执行器效率下降',
      targetKind:'node',
      parameterDefaults:{efficiency:0.78},
      descriptionZh:'降低执行器输出效率，观察控制补偿和对象响应。'
    }
  ];

  const MEASUREMENT_RESPONSE_STATUS={
    normal:{labelZh:'正常',severity:'normal'},
    affected:{labelZh:'受影响',severity:'warning'},
    warning:{labelZh:'预警',severity:'warning'},
    abnormal:{labelZh:'异常',severity:'major'},
    compensating:{labelZh:'补偿升高',severity:'warning'},
    cut:{labelZh:'链路截断',severity:'critical'}
  };

  function getMeasurementOperation(type){
    return MEASUREMENT_RESPONSE_OPERATIONS.find(item=>item.id===type)||MEASUREMENT_RESPONSE_OPERATIONS[0];
  }

  function normalizeMeasurementNumber(value,fallback=null){
    const numeric=Number(value);
    return Number.isFinite(numeric)?numeric:fallback;
  }

  function getMeasurementFallbackValue(point,index){
    const seed=Array.from(String(point?.signalId||point?.edgeId||index))
      .reduce((sum,char)=>sum+char.charCodeAt(0),0);
    const roleBase={
      command:0.12,
      control:0.18,
      actuator:0.42,
      measurement:0.055,
      residual:0.018
    }[point?.role]??0.08;
    return Number((roleBase+(seed%17)*0.003).toFixed(4));
  }

  function getMeasurementBaselineValue(point,index){
    const runtimeValue=normalizeMeasurementNumber(point?.currentValue,null);
    if(runtimeValue!==null){return runtimeValue;}
    const residualValue=point?.role==='residual'?normalizeMeasurementNumber(point?.residualValue,null):null;
    if(residualValue!==null){return residualValue;}
    return getMeasurementFallbackValue(point,index);
  }
```

- [ ] **Step 5: Add scenario and target APIs**

Continue in the same area with this block.

```js
  function buildMeasurementScenarioOptions(){
    return MEASUREMENT_RESPONSE_OPERATIONS.map(item=>({
      id:item.id,
      labelZh:item.labelZh,
      targetKind:item.targetKind,
      descriptionZh:item.descriptionZh,
      parameterDefaults:cloneDefaults(item.parameterDefaults||{})
    }));
  }

  function buildMeasurementTargetOptions(type='link_cut'){
    const operation=getMeasurementOperation(type);
    if(operation.targetKind==='node'){
      return S.modelNodes
        .filter(node=>node&&node.id&&!isFaultNodeType(node.type))
        .map(node=>({
          id:node.id,
          kind:'node',
          labelZh:node.props?.name||node.id,
          type:node.type||'node'
        }));
    }
    return S.modelEdges
      .filter(edge=>edge&&edge.id)
      .filter(edge=>{
        if(type==='can_delay'||type==='packet_loss'){
          return edge.lineType==='can'||edge.channelId||edge.messageId||edge.signalChannels?.some?.(channel=>channel.channelId||channel.messageId);
        }
        return true;
      })
      .map(edge=>{
        const metrics=getDataflowEdgeMetrics(edge);
        return {
          id:edge.id,
          kind:'edge',
          labelZh:metrics.signalName||edge.id,
          detailZh:[metrics.sourceName,metrics.targetName].filter(Boolean).join(' -> '),
          lineType:edge.lineType||'normal'
        };
      });
  }

  function createMeasurementScenario(input={}){
    const operation=getMeasurementOperation(input.type||'link_cut');
    const targets=buildMeasurementTargetOptions(operation.id);
    const targetKind=input.targetKind||operation.targetKind;
    const targetId=input.targetId||targets[0]?.id||'';
    return {
      id:`scenario-${operation.id}-${targetId||'none'}`,
      type:operation.id,
      targetKind,
      targetId,
      labelZh:`${operation.labelZh}${targetId?` · ${targetId}`:''}`,
      parameters:{
        ...cloneDefaults(operation.parameterDefaults||{}),
        ...(input.parameters||{})
      }
    };
  }
```

- [ ] **Step 6: Add influence and point calculation**

Continue with this block.

```js
  function getMeasurementInfluenceSet(scenario,semantic){
    const affectedEdges=new Set();
    const affectedPoints=new Set();
    const targetId=scenario?.targetId||'';
    if(!targetId){return {affectedEdges,affectedPoints};}
    const outgoingBySource=new Map();
    (semantic?.edges||[]).forEach(item=>{
      const edge=item.edge||item;
      if(!edge?.sourceNodeId){return;}
      if(!outgoingBySource.has(edge.sourceNodeId)){outgoingBySource.set(edge.sourceNodeId,[]);}
      outgoingBySource.get(edge.sourceNodeId).push(edge);
    });
    const addEdgeAndDownstream=(edge)=>{
      if(!edge?.id||affectedEdges.has(edge.id)){return;}
      affectedEdges.add(edge.id);
      const point=(semantic.measurementPoints||[]).find(item=>item.edgeId===edge.id);
      if(point?.id){affectedPoints.add(point.id);}
      const queue=[edge.targetNodeId].filter(Boolean);
      const visitedNodes=new Set();
      while(queue.length){
        const nodeId=queue.shift();
        if(!nodeId||visitedNodes.has(nodeId)){continue;}
        visitedNodes.add(nodeId);
        (outgoingBySource.get(nodeId)||[]).forEach(nextEdge=>{
          if(!nextEdge?.id||affectedEdges.has(nextEdge.id)){return;}
          affectedEdges.add(nextEdge.id);
          const nextPoint=(semantic.measurementPoints||[]).find(item=>item.edgeId===nextEdge.id);
          if(nextPoint?.id){affectedPoints.add(nextPoint.id);}
          if(nextEdge.targetNodeId){queue.push(nextEdge.targetNodeId);}
        });
      }
    };
    if(scenario.targetKind==='edge'){
      const edge=(semantic.edges||[]).find(item=>item.id===targetId)?.edge||getEdge(targetId);
      addEdgeAndDownstream(edge);
    }else{
      S.modelEdges.filter(edge=>edge.sourceNodeId===targetId).forEach(addEdgeAndDownstream);
    }
    return {affectedEdges,affectedPoints};
  }

  function classifyMeasurementPointResponse(point,scenario,baseline,operated,affected){
    if(scenario.type==='link_cut'&&point.edgeId===scenario.targetId){
      return {
        status:'cut',
        operatedValue:null,
        reasonZh:'目标链路被截断，测点无有效信号。'
      };
    }
    if(!affected){
      return {status:'normal',operatedValue:baseline,reasonZh:'该测点不在当前操作影响路径内。'};
    }
    if(scenario.type==='packet_loss'){
      return {status:'warning',operatedValue:baseline,reasonZh:'链路存在丢包风险，测点标记为协议预警。'};
    }
    if(scenario.type==='can_delay'){
      return {status:point.role==='residual'?'abnormal':'warning',operatedValue:baseline,reasonZh:'CAN 延迟可能改变诊断时序或残差判定。'};
    }
    if(scenario.type==='actuator_loss'){
      const efficiency=clamp(normalizeMeasurementNumber(scenario.parameters?.efficiency,0.78),0,1);
      if(point.role==='control'){
        return {status:'compensating',operatedValue:Number((baseline*(1+(1-efficiency))).toFixed(4)),reasonZh:'执行器效率下降后控制链路出现补偿升高。'};
      }
      return {status:'affected',operatedValue:Number((baseline*efficiency).toFixed(4)),reasonZh:'执行器效率下降沿执行和对象链路传播。'};
    }
    if(scenario.type==='parameter_shift'){
      const offset=normalizeMeasurementNumber(scenario.parameters?.offset,0.05);
      return {status:point.role==='residual'?'abnormal':'affected',operatedValue:Number((baseline+offset).toFixed(4)),reasonZh:'目标模块参数偏移影响该测点所在下游链路。'};
    }
    return {status:'affected',operatedValue:baseline,reasonZh:'该测点位于当前操作影响路径内。'};
  }

  function buildMeasurementResponsePoint(point,index,scenario,influence){
    const baseline=getMeasurementBaselineValue(point,index);
    const affected=influence.affectedPoints.has(point.id);
    const classified=classifyMeasurementPointResponse(point,scenario,baseline,baseline,affected);
    const operated=classified.operatedValue;
    const delta=Number.isFinite(operated)&&Number.isFinite(baseline)?Number((operated-baseline).toFixed(4)):null;
    const deltaRatio=delta!==null&&baseline!==0?Number((delta/baseline).toFixed(4)):null;
    const statusInfo=MEASUREMENT_RESPONSE_STATUS[classified.status]||MEASUREMENT_RESPONSE_STATUS.normal;
    return {
      pointId:point.id,
      edgeId:point.edgeId,
      labelZh:point.signalNameZh||point.labelZh||point.id,
      stage:point.stageId,
      signalId:point.signalId,
      unit:point.unit||'',
      baselineValue:baseline,
      operatedValue:operated,
      delta,
      deltaRatio,
      status:classified.status,
      statusLabelZh:statusInfo.labelZh,
      severity:statusInfo.severity,
      reasonZh:classified.reasonZh,
      propagationKind:affected?point.propagationPolicyKind||'inherit':'none',
      affectedByTarget:affected,
      mapping:point.mapping||{},
      samples:[]
    };
  }
```

- [ ] **Step 7: Add response calculation and selection APIs**

Continue with this block.

```js
  function getMeasurementResponseSummary(response){
    const points=Array.isArray(response?.points)?response.points:[];
    return points.reduce((acc,point)=>{
      acc.total+=1;
      if(point.affectedByTarget){acc.affected+=1;}
      if(point.status==='cut'){acc.cut+=1;}
      if(point.status==='normal'){acc.normal+=1;}
      if(point.severity==='warning'||point.severity==='major'||point.severity==='critical'){acc.abnormal+=1;}
      return acc;
    },{total:0,affected:0,cut:0,abnormal:0,normal:0});
  }

  function calculateMeasurementResponse(scenarioInput){
    const scenario=createMeasurementScenario(scenarioInput||S.measurementScenario||{});
    const semantic=buildDataflowSemanticModel();
    const influence=getMeasurementInfluenceSet(scenario,semantic);
    const points=(semantic.measurementPoints||[]).map((point,index)=>buildMeasurementResponsePoint(point,index,scenario,influence));
    const response={
      scenarioId:scenario.id,
      scenario,
      generatedAt:Date.now(),
      mode:'snapshot',
      points,
      summary:null
    };
    response.summary=getMeasurementResponseSummary(response);
    S.measurementScenario=scenario;
    S.measurementResponse=response;
    S.selectedMeasurementPointId=points.find(point=>point.edgeId===scenario.targetId)?.pointId||points[0]?.pointId||'';
    return response;
  }

  function getFilteredMeasurementResponsePoints(response=S.measurementResponse,filter=S.measurementResponseFilter){
    const points=Array.isArray(response?.points)?response.points:[];
    if(filter==='affected'){return points.filter(point=>point.affectedByTarget);}
    if(filter==='abnormal'){return points.filter(point=>point.severity==='warning'||point.severity==='major'||point.severity==='critical');}
    if(filter==='normal'){return points.filter(point=>point.status==='normal');}
    return points;
  }

  function selectMeasurementResponsePoint(pointId){
    const point=(S.measurementResponse?.points||[]).find(item=>item.pointId===pointId);
    if(!point){return false;}
    S.selectedMeasurementPointId=point.pointId;
    if(point.edgeId){selectDataflowEdge(point.edgeId);}
    return true;
  }

  function clearMeasurementResponse(){
    S.measurementScenario=null;
    S.measurementResponse=null;
    S.selectedMeasurementPointId='';
    S.measurementResponseFilter='all';
    renderDataflowPanel();
  }
```

- [ ] **Step 8: Export the APIs**

Add these names to the existing `Object.assign(window,{ ... })` export list near `buildDataflowSemanticModel` and `renderDataflowPanel`.

```js
    buildMeasurementScenarioOptions,
    buildMeasurementTargetOptions,
    createMeasurementScenario,
    calculateMeasurementResponse,
    getMeasurementResponseSummary,
    getFilteredMeasurementResponsePoints,
    selectMeasurementResponsePoint,
    clearMeasurementResponse,
```

- [ ] **Step 9: Run the calculation test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response snapshot"
```

Expected: PASS.

- [ ] **Step 10: Commit the data layer**

```powershell
git add -- src/services/legacy-runtime.txt tests/canvas-layout-app.spec.js
git commit -m "Add measurement response snapshot calculation"
```

---

### Task 2: Measurement Response Panel UI

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Add a failing UI test**

Append this test near the dataflow panel tests.

```js
  it('renders measurement response controls and a response matrix in the dataflow panel', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    window.setCanvasView('dataflow');
    await flushRuntime();

    const panel = document.getElementById('dataflow-panel');
    const operationSelect = panel?.querySelector('[data-measurement-scenario-field="type"]');
    const targetSelect = panel?.querySelector('[data-measurement-scenario-field="targetId"]');
    const calculateButton = panel?.querySelector('[data-measurement-response-calculate]');

    expect(panel?.querySelector('[data-measurement-response-panel]')).not.toBeNull();
    expect(panel?.textContent).toContain('测点响应');
    expect(operationSelect?.textContent).toContain('截断链路');
    expect(targetSelect?.textContent).toContain('edge-imu-error');
    expect(calculateButton).not.toBeNull();

    operationSelect.value = 'link_cut';
    operationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    const refreshedTargetSelect = document.querySelector('[data-measurement-scenario-field="targetId"]');
    refreshedTargetSelect.value = 'edge-imu-error';
    refreshedTargetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-measurement-response-calculate]')?.click();
    await flushRuntime();

    const rows = document.querySelectorAll('[data-measurement-response-row]');
    expect(rows.length).toBe(window.buildDataflowSemanticModel().measurementPoints.length);
    expect(document.querySelector('[data-measurement-response-row][data-edge-id="edge-imu-error"]')?.textContent).toContain('链路截断');
    expect(document.querySelector('[data-measurement-response-summary]')?.textContent).toContain('受影响');

    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the failing UI test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response controls"
```

Expected: FAIL because the panel is not rendered.

- [ ] **Step 3: Add option and value render helpers**

Insert this block after the calculation APIs and before `renderDataflowPanel()`.

```js
  function renderMeasurementSelectOptions(options,selectedId){
    return options.map(option=>`<option value="${escapeHtml(option.id)}"${option.id===selectedId?' selected':''}>${escapeHtml(option.labelZh||option.id)}</option>`).join('');
  }

  function formatMeasurementResponseValue(value,unit=''){
    if(value===null||value===undefined||value===''){return '--';}
    const text=Number.isFinite(Number(value))?formatDataflowNumber(Number(value)):String(value);
    return unit?`${text} ${unit}`:text;
  }

  function formatMeasurementDelta(value){
    if(value===null||value===undefined){return '--';}
    const numeric=Number(value);
    if(!Number.isFinite(numeric)){return '--';}
    return `${numeric>=0?'+':''}${formatDataflowNumber(numeric)}`;
  }
```

- [ ] **Step 4: Add response table rendering**

Continue with this block.

```js
  function renderMeasurementResponseRows(response=S.measurementResponse){
    const rows=getFilteredMeasurementResponsePoints(response);
    if(!rows.length){
      return `<div class="measurement-response-empty">当前筛选条件下没有测点结果。</div>`;
    }
    return `
      <div class="measurement-response-table" role="table" aria-label="测点响应结果">
        <div class="measurement-response-table__head" role="row">
          <span>测点</span>
          <span>基线值</span>
          <span>操作后</span>
          <span>变化</span>
          <span>判定</span>
          <span>原因</span>
        </div>
        ${rows.map(point=>`
          <button type="button" class="measurement-response-row is-${escapeHtml(point.status)}${S.selectedMeasurementPointId===point.pointId?' is-selected':''}" role="row" data-measurement-response-row="${escapeHtml(point.pointId)}" data-edge-id="${escapeHtml(point.edgeId)}">
            <span><strong>${escapeHtml(point.labelZh)}</strong><em>${escapeHtml(point.signalId||point.edgeId)}</em></span>
            <span>${escapeHtml(formatMeasurementResponseValue(point.baselineValue,point.unit))}</span>
            <span>${escapeHtml(formatMeasurementResponseValue(point.operatedValue,point.unit))}</span>
            <span>${escapeHtml(formatMeasurementDelta(point.delta))}</span>
            <span><b>${escapeHtml(point.statusLabelZh)}</b></span>
            <span>${escapeHtml(point.reasonZh)}</span>
          </button>`).join('')}
      </div>`;
  }
```

- [ ] **Step 5: Add response panel rendering**

Continue with this block.

```js
  function renderMeasurementResponsePanel(semantic){
    const currentScenario=S.measurementScenario||createMeasurementScenario({type:'link_cut'});
    const operationOptions=buildMeasurementScenarioOptions();
    const targetOptions=buildMeasurementTargetOptions(currentScenario.type);
    const validTarget=targetOptions.some(item=>item.id===currentScenario.targetId)
      ?currentScenario.targetId
      :targetOptions[0]?.id||'';
    if(validTarget!==currentScenario.targetId){
      currentScenario.targetId=validTarget;
      currentScenario.id=`scenario-${currentScenario.type}-${validTarget||'none'}`;
    }
    const summary=S.measurementResponse?.summary||{total:semantic.measurementPoints.length,affected:0,cut:0,abnormal:0,normal:semantic.measurementPoints.length};
    const filterOptions=[
      ['all','全部'],
      ['affected','受影响'],
      ['abnormal','异常'],
      ['normal','正常']
    ];
    return `
      <section class="measurement-response-panel" data-measurement-response-panel>
        <div class="measurement-response-head">
          <div>
            <div class="measurement-response-eyebrow">测点响应</div>
            <h3>操作快照 · 全测点对照</h3>
          </div>
          <button type="button" class="measurement-response-clear" data-measurement-response-clear>清除结果</button>
        </div>
        <div class="measurement-response-controls">
          <label><span>操作类型</span><select data-measurement-scenario-field="type">${renderMeasurementSelectOptions(operationOptions,currentScenario.type)}</select></label>
          <label><span>目标对象</span><select data-measurement-scenario-field="targetId">${renderMeasurementSelectOptions(targetOptions,validTarget)}</select></label>
          <label><span>参数</span><input data-measurement-scenario-field="primaryParam" value="${escapeHtml(getMeasurementPrimaryParameterValue(currentScenario))}"></label>
          <button type="button" data-measurement-response-calculate>计算测点响应</button>
        </div>
        <div class="measurement-response-summary" data-measurement-response-summary>
          <span><em>测点</em><strong>${summary.total}</strong></span>
          <span><em>受影响</em><strong>${summary.affected}</strong></span>
          <span><em>截断</em><strong>${summary.cut}</strong></span>
          <span><em>异常</em><strong>${summary.abnormal}</strong></span>
          <span><em>正常</em><strong>${summary.normal}</strong></span>
        </div>
        <div class="measurement-response-filters">
          ${filterOptions.map(([id,label])=>`<button type="button" class="${S.measurementResponseFilter===id?'is-active':''}" data-measurement-response-filter="${id}">${label}</button>`).join('')}
        </div>
        ${S.measurementResponse?renderMeasurementResponseRows(S.measurementResponse):'<div class="measurement-response-empty">选择操作和目标后，点击计算测点响应。</div>'}
      </section>`;
  }
```

- [ ] **Step 6: Add primary parameter helpers**

Insert this helper near the panel rendering functions.

```js
  function getMeasurementPrimaryParameterKey(type){
    if(type==='parameter_shift'){return 'offset';}
    if(type==='can_delay'){return 'delayMs';}
    if(type==='packet_loss'){return 'dropRate';}
    if(type==='actuator_loss'){return 'efficiency';}
    return 'time';
  }

  function getMeasurementPrimaryParameterValue(scenario){
    const key=getMeasurementPrimaryParameterKey(scenario?.type);
    return scenario?.parameters?.[key]??'';
  }

  function readMeasurementScenarioFromPanel(panel){
    const type=panel.querySelector('[data-measurement-scenario-field="type"]')?.value||'link_cut';
    const targetId=panel.querySelector('[data-measurement-scenario-field="targetId"]')?.value||'';
    const primaryValue=panel.querySelector('[data-measurement-scenario-field="primaryParam"]')?.value;
    const parameterKey=getMeasurementPrimaryParameterKey(type);
    return createMeasurementScenario({
      type,
      targetId,
      parameters:{[parameterKey]:normalizeMeasurementNumber(primaryValue,primaryValue)}
    });
  }
```

- [ ] **Step 7: Insert the panel in `renderDataflowPanel()`**

Inside the `<main class="dataflow-main">` template, before `${renderPropagationGroups(semantic)}`, add:

```js
            ${renderMeasurementResponsePanel(semantic)}
```

- [ ] **Step 8: Bind controls and rows**

At the end of `bindDataflowPanelSelection(panel)`, add:

```js
    panel.querySelectorAll('[data-measurement-scenario-field]').forEach(element=>{
      element.addEventListener('change',()=>{
        S.measurementScenario=readMeasurementScenarioFromPanel(panel);
        renderDataflowPanel();
      });
    });
    panel.querySelector('[data-measurement-response-calculate]')?.addEventListener('click',()=>{
      calculateMeasurementResponse(readMeasurementScenarioFromPanel(panel));
      renderDataflowPanel();
    });
    panel.querySelector('[data-measurement-response-clear]')?.addEventListener('click',()=>{
      clearMeasurementResponse();
    });
    panel.querySelectorAll('[data-measurement-response-filter]').forEach(button=>{
      button.addEventListener('click',()=>{
        S.measurementResponseFilter=button.dataset.measurementResponseFilter||'all';
        renderDataflowPanel();
      });
    });
    panel.querySelectorAll('[data-measurement-response-row]').forEach(row=>{
      row.addEventListener('click',()=>{
        selectMeasurementResponsePoint(row.dataset.measurementResponseRow);
      });
    });
```

- [ ] **Step 9: Add CSS for the response panel**

Insert after `.propagation-groups` styles in `src/styles/components.css`.

```css
.measurement-response-panel{
  min-width:0;
  padding:12px;
  border:1px solid #cbd8e7;
  border-radius:8px;
  background:#ffffff;
  box-shadow:0 10px 22px rgba(18,36,58,0.07);
}
.measurement-response-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:10px;
}
.measurement-response-eyebrow{
  color:#2f73ff;
  font-size:10px;
  font-weight:900;
}
.measurement-response-head h3{
  margin:2px 0 0;
  color:#10243d;
  font-size:14px;
  font-weight:900;
}
.measurement-response-clear{
  border:1px solid #dbe6f4;
  background:#fff;
  color:#47617f;
  padding:5px 8px;
  font-size:11px;
  font-weight:900;
  cursor:pointer;
}
.measurement-response-controls{
  display:grid;
  grid-template-columns:1fr 1.4fr 0.8fr auto;
  gap:8px;
  align-items:end;
}
.measurement-response-controls label{
  display:grid;
  gap:4px;
  color:#70839d;
  font-size:10px;
  font-weight:900;
}
.measurement-response-controls select,
.measurement-response-controls input{
  min-width:0;
  height:30px;
  border:1px solid #dbe6f4;
  background:#f8fbff;
  color:#10243d;
  padding:0 8px;
  font-size:12px;
  font-weight:800;
}
.measurement-response-controls button{
  height:30px;
  border:1px solid #2f73ff;
  background:#2f73ff;
  color:#fff;
  padding:0 10px;
  font-size:11px;
  font-weight:900;
  cursor:pointer;
}
.measurement-response-summary{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:6px;
  margin-top:10px;
}
.measurement-response-summary span{
  min-width:0;
  padding:8px;
  border:1px solid #dbe6f4;
  background:#f8fbff;
}
.measurement-response-summary em,
.measurement-response-summary strong{
  display:block;
}
.measurement-response-summary em{
  color:#70839d;
  font-size:10px;
  font-style:normal;
  font-weight:900;
}
.measurement-response-summary strong{
  color:#10243d;
  font-family:var(--font-data);
  font-size:14px;
  font-weight:900;
}
.measurement-response-filters{
  display:flex;
  gap:6px;
  margin-top:10px;
}
.measurement-response-filters button{
  border:1px solid #dbe6f4;
  background:#fff;
  color:#47617f;
  padding:4px 8px;
  font-size:10px;
  font-weight:900;
  cursor:pointer;
}
.measurement-response-filters button.is-active{
  border-color:#2f73ff;
  color:#0043ce;
  background:#edf5ff;
}
.measurement-response-empty{
  margin-top:10px;
  padding:10px;
  border:1px dashed #cbd8e7;
  color:#70839d;
  font-size:12px;
  font-weight:800;
}
.measurement-response-table{
  margin-top:10px;
  border:1px solid #dbe6f4;
}
.measurement-response-table__head,
.measurement-response-row{
  display:grid;
  grid-template-columns:1.25fr 0.65fr 0.65fr 0.5fr 0.58fr 1.6fr;
  gap:0;
}
.measurement-response-table__head span{
  padding:7px 8px;
  border-right:1px solid #e3ebf5;
  background:#f4f8fd;
  color:#526985;
  font-size:10px;
  font-weight:900;
}
.measurement-response-row{
  width:100%;
  border:0;
  border-top:1px solid #edf2f8;
  background:#fff;
  color:#10243d;
  text-align:left;
  cursor:pointer;
}
.measurement-response-row:hover,
.measurement-response-row.is-selected{
  background:#f2f7ff;
}
.measurement-response-row.is-cut,
.measurement-response-row.is-abnormal{
  background:#fff5f5;
}
.measurement-response-row.is-warning,
.measurement-response-row.is-compensating,
.measurement-response-row.is-affected{
  background:#fffaf0;
}
.measurement-response-row span{
  min-width:0;
  padding:7px 8px;
  border-right:1px solid #edf2f8;
  font-size:11px;
  font-weight:800;
  overflow-wrap:anywhere;
}
.measurement-response-row strong,
.measurement-response-row em,
.measurement-response-row b{
  display:block;
}
.measurement-response-row em{
  color:#70839d;
  font-family:var(--font-data);
  font-size:10px;
  font-style:normal;
}
@media (max-width:1180px){
  .measurement-response-controls{
    grid-template-columns:1fr 1fr;
  }
  .measurement-response-table__head,
  .measurement-response-row{
    grid-template-columns:1fr 0.7fr 0.7fr 0.6fr;
  }
  .measurement-response-table__head span:nth-child(6),
  .measurement-response-row span:nth-child(6){
    grid-column:1 / -1;
  }
}
```

- [ ] **Step 10: Run the UI test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response controls"
```

Expected: PASS.

- [ ] **Step 11: Commit the UI panel**

```powershell
git add -- src/services/legacy-runtime.txt src/styles/components.css tests/canvas-layout-app.spec.js
git commit -m "Add measurement response panel"
```

---

### Task 3: Details Integration and Temporary Highlighting

**Files:**
- Modify: `src/services/legacy-runtime.txt`
- Modify: `src/styles/components.css`
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Add a failing details and highlight test**

Append this test after the response panel UI test.

```js
  it('links measurement response rows to dataflow selection and mapping details', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await flushRuntime();

    const pkg = loadPublicPackage('evtol_closed_loop_fault_demo.json');
    window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(pkg);
    await flushRuntime();

    window.setCanvasView('dataflow');
    await flushRuntime();

    document.querySelector('[data-measurement-scenario-field="targetId"]').value = 'edge-imu-error';
    document.querySelector('[data-measurement-scenario-field="targetId"]').dispatchEvent(new Event('change', { bubbles: true }));
    await flushRuntime();

    document.querySelector('[data-measurement-response-calculate]')?.click();
    await flushRuntime();

    const row = document.querySelector('[data-measurement-response-row][data-edge-id="edge-imu-error"]');
    expect(row).not.toBeNull();
    row.click();
    await flushRuntime();

    expect(window.__GZ_STATE__.selEdge).toBe('edge-imu-error');
    expect(document.querySelector('[data-measurement-response-row][data-edge-id="edge-imu-error"]')?.classList.contains('is-selected')).toBe(true);
    expect(document.querySelector('.signal-flow-edge[data-dataflow-edge="edge-imu-error"]')?.classList.contains('is-response-target')).toBe(true);

    window.openDataflowMappingDetail('edge-imu-error');
    await flushRuntime();

    const dialog = document.getElementById('ov-dataflow-map');
    expect(dialog?.classList.contains('open')).toBe(true);
    expect(dialog?.textContent).toContain('测点响应');
    expect(dialog?.textContent).toContain('链路截断');
    expect(dialog?.textContent).toContain('目标链路被截断');

    window.closeDataflowMappingDetail();
    wrapper.unmount();
  });
```

- [ ] **Step 2: Run the failing details test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response rows"
```

Expected: FAIL because graph highlight and detail augmentation do not exist.

- [ ] **Step 3: Add response lookup helpers**

Insert near response APIs.

```js
  function getMeasurementResponsePointByEdge(edgeId){
    return (S.measurementResponse?.points||[]).find(point=>point.edgeId===edgeId)||null;
  }

  function isMeasurementResponseTargetEdge(edgeId){
    return Boolean(S.measurementScenario?.targetKind==='edge'&&S.measurementScenario?.targetId===edgeId);
  }

  function isMeasurementResponseAffectedEdge(edgeId){
    const point=getMeasurementResponsePointByEdge(edgeId);
    return Boolean(point?.affectedByTarget);
  }
```

- [ ] **Step 4: Apply graph highlight classes**

In `renderSignalFlowEdges(topology,rows)`, extend the returned path class string:

```js
      const responsePoint=getMeasurementResponsePointByEdge(metrics.id);
      const responseClasses=[
        isMeasurementResponseTargetEdge(metrics.id)?' is-response-target':'',
        responsePoint?.affectedByTarget?' is-response-affected':'',
        responsePoint?.status==='cut'?' is-response-cut':''
      ].join('');
      return `<path class="signal-flow-edge is-${escapeHtml(metrics.status)}${S.selEdge===metrics.id?' is-selected':''}${responseClasses}" data-dataflow-edge="${escapeHtml(metrics.id)}" d="${d}" marker-end="url(#signal-flow-arrow-${escapeHtml(metrics.status)})"><title>${escapeHtml(metrics.signalName)}: ${escapeHtml(metrics.sourceName)} -> ${escapeHtml(metrics.targetName)}</title></path>`;
```

- [ ] **Step 5: Add canvas edge highlight classes**

In `decorateDataflowEdges()`, add these toggles inside `if(path){ ... }`:

```js
        path.classList.toggle('is-response-target',isMeasurementResponseTargetEdge(metrics.id));
        path.classList.toggle('is-response-affected',isMeasurementResponseAffectedEdge(metrics.id));
        path.classList.toggle('is-response-cut',getMeasurementResponsePointByEdge(metrics.id)?.status==='cut');
```

- [ ] **Step 6: Extend mapping detail rows with response context**

In `renderDataflowMappingDetailRow(row)`, after `const mapping=row.mapping||{};`, add:

```js
    const responsePoint=getMeasurementResponsePointByEdge(point.edgeId);
```

Then append this block before the closing `</article>`:

```js
        ${responsePoint?`
          <div class="dataflow-map-note dataflow-map-note--response">
            <span>测点响应</span>
            <strong>${escapeHtml(responsePoint.statusLabelZh)} · ${escapeHtml(formatMeasurementResponseValue(responsePoint.baselineValue,responsePoint.unit))} -> ${escapeHtml(formatMeasurementResponseValue(responsePoint.operatedValue,responsePoint.unit))}</strong>
            <em>${escapeHtml(responsePoint.reasonZh)}</em>
          </div>`:''}
```

- [ ] **Step 7: Add highlight styles**

Add to `src/styles/components.css` near dataflow edge styles:

```css
.signal-flow-edge.is-response-target{
  stroke:#dc2626;
  stroke-width:4;
  filter:drop-shadow(0 2px 8px rgba(220,38,38,0.35));
}
.signal-flow-edge.is-response-affected{
  stroke:#f97316;
  stroke-width:3;
}
.signal-flow-edge.is-response-cut{
  stroke-dasharray:8 5;
}
.edge-path.is-response-target{
  stroke:#dc2626!important;
  stroke-width:4!important;
}
.edge-path.is-response-affected{
  stroke:#f97316!important;
}
.edge-path.is-response-cut{
  stroke-dasharray:8 5!important;
}
.dataflow-map-note--response{
  border-top:1px solid #fed7aa;
  background:#fff7ed;
}
```

- [ ] **Step 8: Run the details test**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "measurement response rows"
```

Expected: PASS.

- [ ] **Step 9: Commit detail integration**

```powershell
git add -- src/services/legacy-runtime.txt src/styles/components.css tests/canvas-layout-app.spec.js
git commit -m "Connect measurement responses to dataflow details"
```

---

### Task 4: Full Verification and Browser Review

**Files:**
- Modify only if verification finds a bug.
- Test: `tests/canvas-layout-app.spec.js`

- [ ] **Step 1: Run the focused dataflow tests**

Run:

```powershell
npm test -- --run tests\canvas-layout-app.spec.js -t "dataflow|measurement response"
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm test -- --run
```

Expected: all tests PASS.

- [ ] **Step 3: Run UI audit**

Run:

```powershell
npm run audit:ui
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm run build
```

Expected: build succeeds. The existing Vite chunk-size warning is acceptable unless a new build error appears.

- [ ] **Step 5: Capture a browser screenshot**

Use Playwright against the running local dev server. If no server is running, start one with:

```powershell
npm run dev -- --host 127.0.0.1 --port 5176
```

Then run:

```powershell
@'
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const baseUrl = 'http://127.0.0.1:5176/';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__GZ_FLIGHT_MODEL_PACKAGE__?.importObject && window.setCanvasView);
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/model-packages/evtol_closed_loop_fault_demo.json'), 'utf8'));
  await page.evaluate((modelPackage) => {
    window.__GZ_FLIGHT_MODEL_PACKAGE__.importObject(modelPackage);
    window.setCanvasView('dataflow');
  }, pkg);
  await page.waitForSelector('[data-measurement-response-panel]');
  await page.selectOption('[data-measurement-scenario-field="type"]', 'link_cut');
  await page.selectOption('[data-measurement-scenario-field="targetId"]', 'edge-imu-error');
  await page.click('[data-measurement-response-calculate]');
  await page.waitForSelector('[data-measurement-response-row][data-edge-id="edge-imu-error"]');
  const outDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const shot = path.join(outDir, 'measurement-response-snapshot.png');
  await page.screenshot({ path: shot, fullPage: false });
  const state = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-measurement-response-row]').length,
    targetText: document.querySelector('[data-measurement-response-row][data-edge-id="edge-imu-error"]')?.textContent,
    injectedFault: window.__GZ_STATE__.modelEdges.find(edge => edge.id === 'edge-imu-error')?.injectedFault || null
  }));
  await browser.close();
  if (!state.rows || !state.targetText?.includes('链路截断') || state.injectedFault) {
    throw new Error(JSON.stringify(state));
  }
  console.log(JSON.stringify({ shot, state }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | node -
```

Expected: screenshot saved at `artifacts/measurement-response-snapshot.png`; target row contains `链路截断`; `injectedFault` is null.

- [ ] **Step 6: Commit any verification fixes**

Only run this if Step 1-5 required code fixes:

```powershell
git add -- src/services/legacy-runtime.txt src/styles/components.css tests/canvas-layout-app.spec.js
git commit -m "Fix measurement response verification issues"
```

---

## Self-Review Checklist

- Spec coverage:
  - Predefined measurement points: Task 1 reuses `buildDataflowSemanticModel().measurementPoints`.
  - Operation snapshot: Task 1 creates scenario and response APIs.
  - Baseline versus operated matrix: Task 2 renders rows.
  - Link cut and other first-pass operations: Task 1 defines all five operations.
  - Temporary highlighting: Task 3 adds graph classes.
  - Details integration: Task 3 extends mapping detail rows.
  - No permanent injection: Task 1 tests and state boundary prevent `injectedFault` mutation.
  - `samples` for future time-series: Task 1 includes `samples: []`.

- Placeholder scan:
  - No unresolved placeholders are present.
  - Each code-changing step includes exact code to add or replace.
  - Each test step includes an exact command and expected result.

- Type consistency:
  - Scenario fields use `type`, `targetKind`, `targetId`, and `parameters`.
  - Response points use `pointId`, `edgeId`, `baselineValue`, `operatedValue`, `status`, `severity`, and `samples`.
  - Exported function names match test expectations.
