import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

function readProjectFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const files = {
  app: readProjectFile('src/App.vue'),
  baseCss: readProjectFile('src/styles/base.css'),
  componentsCss: readProjectFile('src/styles/components.css'),
  consoleCss: readProjectFile('src/styles/console-redesign.css'),
  header: readProjectFile('src/fragments/header.html'),
  taskbar: readProjectFile('src/fragments/taskbar.html'),
  canvas: readProjectFile('src/fragments/canvas.html'),
  rightPanel: readProjectFile('src/fragments/right-panel.html'),
  statusbar: readProjectFile('src/fragments/statusbar.html'),
  statusRuntime: readProjectFile('src/services/statusBarRuntime.js'),
  legacyRuntime: readProjectFile('src/services/legacy-runtime.txt'),
  packageJson: readProjectFile('package.json'),
  componentSchemaDoc: readProjectFile('docs/component-python-schema.md'),
  platformFileMapDoc: readProjectFile('docs/platform-file-map.md')
};

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function makeAudit() {
  const audit = {
    title: 'GZ Fault Platform UI Quality Audit',
    generatedAt: new Date().toISOString(),
    designPositioning: [
      'Data-dense engineering workbench',
      'Stable resizable grid over decorative page layout',
      'Header-level project context with canvas-docked simulation controls',
      'Compact bottom status layer with continuous side panels',
      'Coordinated technical typography with tabular numeric data'
    ],
    mechanism: {
      selfProposal: [
        'Treat the screen as seven layers: global navigation, project context, canvas-docked task control, feature navigation, core canvas, property inspector, and status layer.',
        'Keep the canvas as the visual center while docking simulation controls directly above the canvas content.',
        'Use the alternate canvas view for a generated multi-signal flow graph instead of a passive tab.',
        'Make lower panels compact enough to preserve the model canvas and prevent clipping.',
        'Preserve engineering density: clear tables, short controls, stable dimensions, and low-noise cards.',
        'Separate metric numbers, units, and labels so status cards do not read as oversized sentence text.',
        'Treat canvas toolbar icons as command entry points with state, feedback, and reversible edits.'
      ],
      selfReview: [
        'Verify the root grid removes the old global taskbar row and keeps a bounded workbench row.',
        'Verify the current project context is in the header and the simulation controls are docked in canvas chrome.',
        'Verify the alternate canvas view renders lanes, signal nodes, fault edges, and diagnostics from the same model state.',
        'Verify both side panels span through the bottom layer instead of stopping above it.',
        'Verify the bottom status layer belongs under the canvas only and stays fully visible.',
        'Verify resizable handles persist user-adjusted left, right, and bottom sizes.',
        'Verify model diagnostics write back into the same status stream used by logs and alerts.',
        'Verify toolbar commands expose undo, redo, view switching, interaction modes, zoom, and fullscreen behavior.'
      ],
      selfStrengthening: [
        'Run this audit with npm run audit:ui after UI layout changes.',
        'Keep Vitest layout assertions aligned with the audit so regressions fail fast.',
        'Promote repeated visual problems into new blocking checks instead of one-off manual notes.',
        'Use advisory suggestions for next-pass refinements that need product decisions or richer data.'
      ]
    },
    passed: [],
    blocking: [],
    suggestions: []
  };

  function check(id, title, passed, detail, source) {
    const item = { id, title, detail, source };
    if (passed) {
      audit.passed.push(item);
    } else {
      audit.blocking.push(item);
    }
  }

  check(
    'root-grid-removes-global-taskbar-row',
    'Root layout removes the old global taskbar row',
    files.consoleCss.includes('grid-template-rows:56px minmax(0,1fr)') &&
      files.consoleCss.includes('.workbench-taskbar') &&
      files.consoleCss.includes('display:none!important') &&
      !files.app.includes('<WorkbenchTaskbar />') &&
      files.app.includes('<main class="workbench-main">'),
    'Prevents a duplicate page-wide taskbar from stealing canvas height after simulation controls move into the canvas chrome.',
    'src/styles/console-redesign.css, src/App.vue'
  );

  check(
    'workbench-grid-bounds-bottom-layer',
    'Workbench grid gives the status layer a constrained row',
    files.baseCss.includes('grid-template-rows:minmax(0,1fr) var(--layout-resizer-size) var(--workbench-status-h)') &&
      files.baseCss.includes('--workbench-status-h:100px'),
    'Keeps the lower deck visible while leaving the canvas as the dominant region.',
    'src/styles/base.css'
  );

  check(
    'task-controls-docked-in-canvas-chrome',
    'Simulation controls dock above the canvas content',
    files.header.includes('class="header-project"') &&
      files.header.includes('飞控系统仿真项目') &&
      files.canvas.includes('class="canvas-sim-dock"') &&
      files.canvas.includes('id="simbar"') &&
      files.consoleCss.includes('.canvas-sim-dock .simbar') &&
      !files.app.includes('<WorkbenchTaskbar />'),
    'Places current project context in the header while keeping simulation controls close to the canvas work area.',
    'src/fragments/header.html, src/fragments/canvas.html, src/styles/console-redesign.css'
  );

  check(
    'header-responsive-containment',
    'Header switches layout before project, workflow, and action controls overlap',
    hasAll(files.consoleCss, [
      'Header containment pass',
      '@media (max-width:1680px)',
      'grid-template-rows:104px minmax(0,1fr)',
      '@media (max-width:1120px)',
      'grid-template-rows:156px minmax(0,1fr)',
      'overflow-x:auto',
      'text-overflow:ellipsis'
    ]),
    'Keeps the current project card, stepbar, and global action buttons in separate grid rows/areas on common browser widths.',
    'src/styles/console-redesign.css'
  );

  check(
    'inspector-spans-status-depth',
    'Property inspector spans through the lower status depth',
    files.componentsCss.includes('.workbench-main .rpanel') &&
      files.componentsCss.includes('grid-column:5;') &&
      files.componentsCss.includes('grid-row:1 / 4;'),
    'Maintains the right-side property column as a continuous panel down the full workbench.',
    'src/styles/components.css'
  );

  check(
    'left-palette-spans-status-depth',
    'Left palette spans through the lower status depth',
    /\.workbench-main \.lpanel\{[\s\S]*?grid-column:1;[\s\S]*?grid-row:1 \/ 4;/.test(files.componentsCss) &&
      /\.workbench-main \.layout-resizer--left\{[\s\S]*?grid-column:2;[\s\S]*?grid-row:1 \/ 4;/.test(files.componentsCss),
    'Maintains the left component library as a continuous column down the full workbench.',
    'src/styles/components.css'
  );

  check(
    'status-layer-under-canvas-only',
    'Bottom status layer sits under the canvas only',
    /\.workbench-main \.sbar\{[\s\S]*?grid-column:3;[\s\S]*?grid-row:3;/.test(files.componentsCss) &&
      /\.workbench-main \.layout-resizer--bottom\{[\s\S]*?grid-column:3;[\s\S]*?grid-row:2;/.test(files.componentsCss),
    'Keeps logs and metrics aligned with the central working area while both side panels remain continuous.',
    'src/styles/components.css'
  );

  check(
    'layout-resizers-exist',
    'Left, right, and bottom resizing handles are available',
    hasAll(files.app, [
      'data-layout-resizer="left"',
      'data-layout-resizer="right"',
      'data-layout-resizer="bottom"',
      'startLayoutResize',
      'resetLayoutSize'
    ]),
    'Lets users adapt panel proportions instead of hard-coding a single screen size.',
    'src/App.vue'
  );

  check(
    'layout-resizers-persist',
    'Resizable layout persists user sizing preferences',
    files.app.includes("const LAYOUT_STORAGE_KEY = 'gz.layoutSizes.v3'") &&
      files.app.includes('window.localStorage.setItem(LAYOUT_STORAGE_KEY') &&
      hasAll(files.app, ['left: 192', 'right: 320', 'status: 100']),
    'Makes panel tuning survive reloads and gives the layout a clear reset baseline.',
    'src/App.vue'
  );

  check(
    'canvas-stage-edge-viewbox-match',
    'Canvas stage and edge SVG use the same coordinate space',
    /width\s*:\s*2400px/.test(files.componentsCss) &&
      /height\s*:\s*1500px/.test(files.componentsCss) &&
      files.canvas.includes('viewBox="0 0 2400 1500"') &&
      !files.canvas.includes('viewBox="0 0 1600 980"'),
    'Prevents enlarged internal canvas coordinates from stretching or offsetting rendered connections.',
    'src/fragments/canvas.html, src/styles/components.css'
  );

  check(
    'bottom-status-compact-structure',
    'Bottom status deck has a log header, actions, and four compact metric cards',
    files.statusbar.includes('sbar-log-head') &&
      count(files.statusbar, /class="sbar-action"/g) === 3 &&
      count(files.statusbar, /sbar-card__accent/g) === 4,
    'Enforces a coordinated lower panel instead of oversized disconnected cards.',
    'src/fragments/statusbar.html'
  );

  check(
    'status-actions-have-runtime',
    'Bottom status actions are wired to filtering, clearing, and export behavior',
    hasAll(files.statusbar, [
      'data-status-action="clear"',
      'data-status-action="level"',
      'data-status-action="export"',
      'data-status-tab="alerts"',
      'data-status-empty'
    ]) &&
      hasAll(files.statusRuntime, [
        'bindStatusBarInteractions',
        'applyLevelFilter',
        'clearStatusLog',
        'exportStatusLog'
      ]),
    'Turns the lower deck controls into real operational controls instead of decorative buttons.',
    'src/fragments/statusbar.html, src/services/statusBarRuntime.js'
  );

  check(
    'status-runtime-accepts-events',
    'Status runtime accepts live event entries and routes warning records to alerts',
    hasAll(files.statusRuntime, [
      'pushStatusEntry',
      "level === 'warn' || level === 'error' ? 'alerts' : 'log'",
      'dataset.logEntry',
      'sbar-badge--warn'
    ]) &&
      files.componentsCss.includes('.sbar-badge--warn') &&
      files.componentsCss.includes('.sbar-badge--error'),
    'Allows simulation, fault, and validation events to enter the same visible status deck.',
    'src/services/statusBarRuntime.js, src/styles/components.css'
  );

  check(
    'simulation-summary-feeds-result-performance-views',
    'Simulation runtime publishes real result and performance records',
    hasAll(files.statusbar, ['data-status-tab="results"', 'data-status-tab="performance"']) &&
      hasAll(files.statusRuntime, [
        'publishSimulationSummary',
        "view: 'results'",
        "view: 'performance'",
        'normalizeSimulationSummary'
      ]) &&
      hasAll(files.legacyRuntime, [
        'publishSimulationRuntimeSummary',
        'getSimulationSampleRateLabel',
        '__statusSummarySimStep',
        '__statusSummarySimStop'
      ]),
    'Keeps the lower result/performance tabs tied to actual simulation events instead of empty labels.',
    'src/fragments/statusbar.html, src/services/statusBarRuntime.js, src/services/legacy-runtime.txt'
  );

  check(
    'technical-typography-tokens',
    'UI defines separate interface and numeric font roles',
    files.baseCss.includes('font-family:var(--font-ui)') &&
      files.componentsCss.includes('font-family:var(--font-data)') &&
      files.componentsCss.includes('font-variant-numeric:tabular-nums') &&
      files.componentsCss.includes('.diagnostics-score__num'),
    'Keeps Chinese UI copy, code-like values, and counters in coordinated but distinct typographic roles.',
    'src/styles/base.css, src/styles/components.css'
  );

  check(
    'status-metrics-structured-typography',
    'Bottom metrics render structured numbers, units, and separators',
    files.statusbar.includes('sbar-metric-number') &&
      files.statusRuntime.includes('formatStatusMetrics') &&
      files.statusRuntime.includes('MutationObserver') &&
      files.componentsCss.includes('.sbar-metric-unit'),
    'Prevents compact metric cards from becoming heavy sentence text when legacy runtime updates counts.',
    'src/fragments/statusbar.html, src/services/statusBarRuntime.js, src/styles/components.css'
  );

  check(
    'model-check-feeds-status-stream',
    'Model diagnostics publish their result into the bottom status stream',
    files.legacyRuntime.includes('pushModelCheckStatusEntry') &&
      files.legacyRuntime.includes("source:'模型检查'") &&
      files.legacyRuntime.includes("view:issueCount>0?'alerts':'log'"),
    'Closes the loop between the inspector diagnostics result and the lower log/alert panel.',
    'src/services/legacy-runtime.txt, src/services/statusBarRuntime.js'
  );

  check(
    'canvas-toolbar-command-contract',
    'Canvas toolbar buttons expose explicit command and view contracts',
    hasAll(files.canvas, [
      'data-canvas-command="undo"',
      'data-canvas-command="redo"',
      'data-canvas-command="fullscreen"',
      'data-canvas-command="zoom-in"',
      'data-canvas-view="dataflow"'
    ]) &&
      hasAll(files.legacyRuntime, [
        '__GZ_CANVAS_COMMANDS__',
        'setCanvasInteractionMode',
        'setCanvasView',
        'syncCanvasFullscreenState',
        'toggleCanvasFullscreen'
      ]),
    'Prevents the canvas chrome from regressing into visual-only controls.',
    'src/fragments/canvas.html, src/services/legacy-runtime.txt'
  );

  check(
    'canvas-command-history-wraps-edits',
    'Canvas model edits are wrapped by a bounded undo/redo history',
    hasAll(files.legacyRuntime, [
      'HISTORY_LIMIT=40',
      'runWithHistory',
      'undoCanvasCommand',
      'redoCanvasCommand',
      "runWithHistory('新增组件'",
      "runWithHistory('删除连线'",
      "runWithHistory('自动整理画布'"
    ]),
    'Makes destructive or structural canvas operations reversible instead of one-way actions.',
    'src/services/legacy-runtime.txt'
  );

  check(
    'multi-signal-flow-view-renders-topology',
    'Alternate canvas view renders a multi-signal flow graph',
    files.canvas.includes('data-canvas-view="dataflow">多信号流图') &&
      hasAll(files.legacyRuntime, [
        'SIGNAL_FLOW_LANES',
        'buildSignalFlowTopology',
        'renderSignalFlowMap',
        'signal-flow-edge',
        'signal-flow-node'
      ]) &&
      hasAll(files.componentsCss, [
        '.signal-flow-lane',
        '.signal-flow-edge.is-fault',
        '.signal-flow-node.is-fault',
        '.dataflow-body'
      ]),
    'Makes the second analysis perspective a real multi-signal flow graph generated from the current topology and fault state.',
    'src/fragments/canvas.html, src/services/legacy-runtime.txt, src/styles/components.css'
  );

  check(
    'canvas-command-listeners-clean-up',
    'Canvas command listeners are registered and removed through the runtime listener store',
    hasAll(files.legacyRuntime, [
      'canvasCommandToolbarClick',
      'canvasCommandFullscreenChange',
      'canvasCommandKeydown',
      'canvasCommandPointerEnd'
    ]) &&
      hasAll(readProjectFile('src/services/legacyRuntimeBootstrap.js'), [
        'canvasCommandToolbarClick',
        'canvasCommandFullscreenChange',
        'canvasCommandKeydown',
        'canvasCommandPointerEnd'
      ]),
    'Keeps repeated Vue mounts in tests and development from accumulating duplicate toolbar listeners.',
    'src/services/legacy-runtime.txt, src/services/legacyRuntimeBootstrap.js'
  );

  check(
    'right-inspector-removes-improvement-guide',
    'Right inspector removes the lower improvement guide panel',
    !files.rightPanel.includes('data-testid="improvement-guide"') &&
      count(files.rightPanel, /rpanel-guidance__item/g) === 0 &&
      !files.componentsCss.includes('.rpanel-guidance'),
    'Keeps the property column focused on editable configuration after the guidance panel was explicitly removed.',
    'src/fragments/right-panel.html, src/styles/components.css'
  );

  check(
    'bottom-status-compact-css',
    'Metric cards use compact stable dimensions and restrained text scale',
    hasAll(files.componentsCss, [
      'flex:0 0 clamp(250px, 24vw, 320px)',
      'grid-template-columns:repeat(2,minmax(0,1fr))',
      'grid-template-rows:repeat(2,minmax(0,1fr))',
      'height:38px;',
      'font-size:12px;'
    ]),
    'Prevents the lower right metrics from visually overpowering the log table.',
    'src/styles/components.css'
  );

  check(
    'bottom-status-no-clipping-caps',
    'Bottom status layer avoids legacy fixed clipping caps',
    !/@media\s*\(max-height:820px\)[\s\S]*?\.sbar\s*\{[\s\S]*?height:78px/.test(files.componentsCss) &&
      !/\.sbar\s*\{[\s\S]*?max-height:78px/.test(files.componentsCss) &&
      files.componentsCss.includes('max-height:none'),
    'Removes the old failure mode where the lower panel could not fully display.',
    'src/styles/components.css'
  );

  const criticalCopy = [files.taskbar, files.canvas, files.rightPanel, files.statusbar].join('\n');
  check(
    'critical-fragments-have-clean-chinese-copy',
    'Critical shell fragments use clean Chinese copy without mojibake markers',
    !/[�]|鏃|鍙|绯|浠|灞|鐐|缁|妯|闅|嶇|粺|竴|垪|煎|嚭/.test(criticalCopy),
    'Prevents the main workbench shell from regressing to unreadable encoded text.',
    'src/fragments/taskbar.html, src/fragments/canvas.html, src/fragments/right-panel.html, src/fragments/statusbar.html'
  );

  check(
    'keyboard-and-motion-quality',
    'Focus and reduced-motion rules exist for operational accessibility',
    files.componentsCss.includes(':focus-visible') &&
      files.componentsCss.includes('@media (prefers-reduced-motion:reduce)') &&
      files.componentsCss.includes('cursor:pointer'),
    'Keeps the interface usable by keyboard and less jarring in motion-sensitive settings.',
    'src/styles/components.css'
  );

  check(
    'audit-command-registered',
    'UI audit command is registered as a repeatable project script',
    files.packageJson.includes('"audit:ui": "node tools/ui_quality_audit.mjs"'),
    'Makes the improvement mechanism discoverable and easy to rerun.',
    'package.json'
  );

  check(
    'component-python-schema-documented',
    'Component JSON and Python module contracts are documented',
    hasAll(files.componentSchemaDoc, [
      'faultSlots',
      'pythonModules',
      'faultCapabilityMap',
      'def process',
      'model-authoring/evtol_small_nonlinear/modules/'
    ]),
    'Keeps future component and fault authoring aligned with the imported demo model and Python execution contract.',
    'docs/component-python-schema.md'
  );

  check(
    'platform-file-map-documented',
    'Platform files are classified without deleting cleanup candidates',
    hasAll(files.platformFileMapDoc, [
      'src/services/legacy-runtime.txt',
      'public/model-packages/evtol_closed_loop_fault_demo.json',
      'tools/python_model_runner/server.py',
      '可以人工评估删除的候选',
      '不要在本阶段自动删除'
    ]),
    'Gives the user a staged cleanup map while preserving all files for manual review.',
    'docs/platform-file-map.md'
  );

  audit.suggestions.push(
    {
      id: 'visual-screenshot-regression',
      title: 'Add screenshot regression for 1440px, 1536px, and short-height screens',
      detail: 'The current audit checks structural invariants. A next step is pixel-level screenshot review for the exact proportions shown in the reference.'
    }
  );

  return audit;
}

function printTextReport(audit) {
  console.log(audit.title);
  console.log(`Generated: ${audit.generatedAt}`);
  console.log('');
  console.log('Positioning');
  for (const item of audit.designPositioning) {
    console.log(`  - ${item}`);
  }
  console.log('');
  console.log('Self Proposal');
  for (const item of audit.mechanism.selfProposal) {
    console.log(`  - ${item}`);
  }
  console.log('');
  console.log('Self Review');
  for (const item of audit.mechanism.selfReview) {
    console.log(`  - ${item}`);
  }
  console.log('');
  console.log('Self Strengthening');
  for (const item of audit.mechanism.selfStrengthening) {
    console.log(`  - ${item}`);
  }
  console.log('');
  console.log('Checks');
  for (const item of audit.passed) {
    console.log(`  [PASS] ${item.title} (${item.source})`);
  }
  for (const item of audit.blocking) {
    console.log(`  [FAIL] ${item.title} (${item.source})`);
    console.log(`         ${item.detail}`);
  }
  console.log('');
  console.log('Suggestions');
  for (const item of audit.suggestions) {
    console.log(`  [NOTE] ${item.title}`);
    console.log(`         ${item.detail}`);
  }
}

const audit = makeAudit();

if (asJson) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  printTextReport(audit);
}

if (audit.blocking.length > 0) {
  process.exitCode = 1;
}
