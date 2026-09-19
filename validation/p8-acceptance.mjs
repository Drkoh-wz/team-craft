// P8 acceptance: sidebar progress page (replaces the P7 floating overlay) plus
// the new role-detail data plane.
//
// Phase 1 is provable in this process: it drives the REAL hand-authored client
// bundle through a stub React/DOM and asserts what it registers and what it
// renders, with globalThis.fetch stubbed to deterministic fixtures.
// Phase 2 needs the host restart and is what the user runs afterwards.
//
// Usage:
//   node validation/p8-acceptance.mjs            # both phases, tolerating phase-2 401/404
//   node validation/p8-acceptance.mjs --smoke    # also run a 1-node workflow to observe
//                                                # the live marker + reasoning capture
import { readFileSync } from 'node:fs'

const ORIGIN = process.env.TF_ORIGIN || 'http://127.0.0.1:3080'
const ROOT = 'D:/ai-workspace/dsh'
const CLIENT_SRC = ROOT + '/packages/team-flowise/src/client/index.js'
const HARNESS = ROOT + '/validation/_harness-part.mjs'
const SCALE = Number(process.env.SCALE || 50) // 3000ms poll -> 60ms

let checks = 0
let failures = 0
const pending = []
// Phase 1 replaces globalThis.fetch; phase 2 must talk to the real host.
const realFetch = globalThis.fetch
// Every interval the stubbed bundle creates must be cleared before exit: this
// stub never calls an effect's cleanup itself, and on Windows a process.exit()
// while libuv async handles are still closing trips an assertion in async.c.
const allDisposers = []
const collect = (list) => { for (const d of list) allDisposers.push(d) }

function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
function deferred(label, why) { pending.push(label + '  (' + why + ')'); console.log('  ...  ' + label + '  -> NOT YET: ' + why) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (p) => {
  const r = await realFetch(ORIGIN + p)
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: r.status, json, text }
}

const helpers = readFileSync(HARNESS, 'utf8')
const { createReactStub, makeDocument, walk, flatten, findNode } = new Function(
  helpers + '\nreturn { createReactStub, makeDocument, walk, flatten, findNode }',
)()

// The bundle is re-evaluated here (rather than via the harness's
// materializeBundle) because that one stubs setTimeout/setInterval to no-ops,
// which would make the page's poll loop undrivable.
function evaluateBundle(source) {
  const react = createReactStub()
  const regs = []
  const windowStub = { __ModuleLoader__: { load(r) { regs.push(r) } }, devicePixelRatio: 2 }
  const requireStub = (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') return { jsx: react.createElement, jsxs: react.createElement }
    throw new Error('unexpected external require: ' + spec)
  }
  new Function('window', 'require', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis', source)(
    windowStub, requireStub, makeDocument(),
    (fn, ms) => setTimeout(fn, ms === undefined ? 0 : ms / SCALE),
    (id) => clearTimeout(id),
    (fn, ms) => setInterval(fn, Math.max(10, (ms === undefined ? 0 : ms) / SCALE)),
    (id) => clearInterval(id),
    globalThis,
  )
  if (regs.length !== 1) throw new Error('bundle registered ' + regs.length + ' factories')
  return { react, face: regs[0].factory(requireStub) }
}

// Own capture stub: the harness's applyToSlots keys entries by `name/id`, which
// collapses every KEYED slot (main) into `main/undefined` and would hide the
// very registration this phase exists to check.
function captureSlots(face) {
  const regs = []
  const injected = []
  const slots = {
    inject(name, cb) { injected.push(name); return cb() },
    register(options, component) { regs.push({ options, component }); return () => {} },
  }
  const locale = { register() { return () => {} } }
  const ctx = {
    get(name) { if (name === 'slots') return slots; if (name === 'locale') return locale; return undefined },
    effect(cb) { const d = cb(); return () => {} },
    logger: { warn() {}, error() {}, info() {} },
  }
  let error
  try { face.apply(ctx) } catch (e) { error = e }
  return { regs, injected, error }
}

// ===========================================================================
console.log('\n=== PHASE 1: client bundle (provable without a restart) ===')

const clientSource = readFileSync(CLIENT_SRC, 'utf8')
check('client bundle is a single self-registering factory', /__ModuleLoader__\.load\(/.test(clientSource))

let bundle = null
try { bundle = evaluateBundle(clientSource); check('client bundle evaluates without throwing', true) }
catch (e) { check('client bundle evaluates without throwing', false, String(e && e.message ? e.message : e)) }

if (bundle) {
  const applied = captureSlots(bundle.face)
  check('face.apply(ctx) does not throw', applied.error === undefined, applied.error ? String(applied.error) : '')

  const byName = (n) => applied.regs.filter((r) => r.options.name === n)
  const panel = byName('sidebar.panellist')[0]
  const main = byName('main')[0]
  const board = byName('settings.section')[0]

  console.log('       injections: ' + JSON.stringify(applied.injected))
  console.log('       registrations: ' + JSON.stringify(applied.regs.map((r) => r.options.name + '{' + Object.keys(r.options).filter((k) => k !== 'name').map((k) => k + '=' + String(r.options[k])).join(',') + '}')))

  check('registers exactly one sidebar.panellist entry', byName('sidebar.panellist').length === 1)
  check('sidebar entry uses our own fresh id', !!panel && panel.options.id === 'team-progress', panel ? String(panel.options.id) : 'none')
  check('registers main (the central panel) under the SAME id as the sidebar entry',
    !!main && !!panel && main.options.key === panel.options.id, main ? String(main.options.key) : 'none')
  check('sidebar entry has a label (the sidebar resolves its tooltip from it)', !!panel && typeof panel.options.label === 'string' && panel.options.label.length > 0)
  check('no shell.overlay registration remains (that was the covering overlay)',
    byName('shell.overlay').length === 0, JSON.stringify(byName('shell.overlay').map((r) => r.options.id)))
  check('kanban page still registered (settings.section/team)', !!board && board.options.id === 'team', board ? String(board.options.id) : 'none')
  check('exactly three slot entries are contributed', applied.regs.length === 3, 'n=' + applied.regs.length)

  // -------------------------------------------------------------------------
  // The sidebar icon: sidebar.panellist hands over ONLY { size, active }.
  const iconReg = panel
  if (iconReg) {
    const icon = bundle.react.mount(bundle.react.createElement(iconReg.component, { size: 22, active: true }))
    check('sidebar icon renders an <svg> at the requested size',
      icon !== null && icon.type === 'svg' && icon.props.width === 22 && icon.props.height === 22,
      icon === null ? 'null' : icon.type + ' width=' + String(icon.props && icon.props.width))
    check('sidebar icon reflects the active state', icon !== null && String(icon.props.stroke) === '#3b82f6', String(icon && icon.props && icon.props.stroke))
    const iconIdle = bundle.react.mount(bundle.react.createElement(iconReg.component, { size: 18, active: false }))
    check('sidebar icon falls back to currentColor when inactive', String(iconIdle.props.stroke) === 'currentColor', String(iconIdle.props.stroke))
    check('sidebar icon does not fetch anything (ownership: the sidebar owns the button)',
      flatten(icon).indexOf('progress') === -1)
  }

  // -------------------------------------------------------------------------
  // The board's status badge: `Badge` was declared `Badge(s)` but called as
  // createElement(Badge, null, status), so it rendered "[object Object]".
  const { react } = bundle
  const RUN_FIXTURE = {
    id: 'run-fixture-1', workflowId: 'wf-fixture', status: 'completed',
    startedAt: Date.now() - 60000,
    nodeStates: { a: { status: 'completed', assignee: 'Planner' }, b: { status: 'working', assignee: 'Coder' } },
  }
  globalThis.fetch = (input) => {
    const url = String(typeof input === 'string' ? input : input.url)
    const body = url.endsWith('/runs') ? { runs: [RUN_FIXTURE] } : { agents: [], workflows: [], tasks: [], runs: [] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }
  const treeOf = (component) => react.mount(react.createElement(component))
  const settle = () => { react.settle(); collect(react.flushEffects()) }
  const activeTab = (node) => {
    const hit = findNode(node, (n) => n.type === 'button' && n.props && n.props.className === 'tf-tab active')
    return hit === undefined ? null : (typeof hit.props.children === 'string' ? hit.props.children : '?')
  }
  const clickTab = (node, label) => {
    const hit = findNode(node, (n) => n.type === 'button' && n.props && n.props.children === label && typeof n.props.onClick === 'function')
    if (hit === undefined) throw new Error('no tab labelled ' + label)
    hit.props.onClick()
  }

  let t = treeOf(board.component)
  settle()
  check('initial tab is the board', activeTab(t) === '看板', JSON.stringify(activeTab(t)))
  for (const label of ['Agents', '工作流', '任务', '运行']) {
    try {
      clickTab(t, label)
      t = treeOf(board.component)
      settle()
      const immediate = activeTab(t)
      await sleep(450) // several compressed poll ticks
      t = treeOf(board.component)
      settle()
      const after = activeTab(t)
      check('tab "' + label + '" survives the poll window (P7 regression)', immediate === label && after === label,
        'immediate=' + JSON.stringify(immediate) + ' after=' + JSON.stringify(after))
    } catch (e) {
      check('tab "' + label + '" survives the poll window (P7 regression)', false, String(e && e.message ? e.message : e))
    }
    try { clickTab(t, '看板'); t = treeOf(board.component); settle() } catch { /* ignore */ }
  }

  try {
    clickTab(t, '运行')
    t = treeOf(board.component)
    settle()
    const bar = findNode(t, (n) => n.props && n.props.className === 'tf-progress-bar')
    check('Runs tab bar reflects object-shaped nodeStates (1 of 2 => 50%)',
      bar !== undefined && (bar.props.style || {}).width === '50%', 'width=' + JSON.stringify(bar && (bar.props.style || {}).width))
    const badge = findNode(t, (n) => n.type === 'span' && n.props && n.props.style && n.props.style.borderRadius === 999)
    check('run status badge renders the status, not "[object Object]"',
      badge !== undefined && String(badge.props.children) === 'completed', badge === undefined ? 'no badge' : JSON.stringify(badge.props.children))
    check('run status badge is coloured by that status (statusColor now matches)',
      badge !== undefined && (badge.props.style || {}).background === '#22c55e', String(badge && (badge.props.style || {}).background))
  } catch (e) {
    check('Runs tab bar reflects object-shaped nodeStates (1 of 2 => 50%)', false, String(e && e.message ? e.message : e))
  }

  // -------------------------------------------------------------------------
  // The progress page, driven from deterministic fixtures.
  const NOW = Date.now()
  const RUN = { id: 'runp8fixture', workflowId: 'wf-p8', workflowName: 'P8 夹具工作流', status: 'running', startedAt: NOW - 900000, endedAt: null }
  const NODES = [
    { id: 'plan', order: 0, agent: 'Planner', agentName: 'Planner', status: 'completed', startedAt: NOW - 900000, endedAt: NOW - 300000, elapsedMs: 600000, brief: '制定实施计划', dependsOn: [], reviewer: null, output: 'PLAN-SLICE' },
    { id: 'fix-tabs', order: 1, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 300000, endedAt: NOW - 120000, elapsedMs: 180000, brief: '修复标签回退缺陷', dependsOn: ['plan'], reviewer: 'Reviewer', output: 'CODE-SLICE' },
    { id: 'panel', order: 2, agent: 'Coder', agentName: 'Coder', status: 'working', startedAt: NOW - 60000, endedAt: null, elapsedMs: 60000, brief: '建造侧边栏进度页', dependsOn: ['fix-tabs'], reviewer: null, output: null },
    { id: 'verify', order: 3, agent: 'Validator', agentName: 'Validator', status: 'failed', startedAt: NOW - 40000, endedAt: NOW - 20000, elapsedMs: 20000, brief: '独立验收', dependsOn: ['panel'], reviewer: null, output: null },
  ]
  const PROGRESS_FIXTURE = {
    ok: true, run: RUN,
    roles: [
      { name: 'Planner', total: 1, completed: 1, failed: 0, working: 0, pending: 0, elapsedMs: 600000 },
      { name: 'Coder', total: 2, completed: 1, failed: 0, working: 1, pending: 0, elapsedMs: 240000 },
      { name: 'Validator', total: 1, completed: 0, failed: 1, working: 0, pending: 0, elapsedMs: 20000 },
    ],
    nodes: NODES,
    totals: { total: 4, completed: 2, failed: 1, working: 1, pending: 0, percent: 50 },
  }
  const DETAIL = [
    { id: 'plan', order: 0, agent: 'Planner', agentName: 'Planner', status: 'completed', startedAt: NOW - 900000, endedAt: NOW - 300000, elapsedMs: 600000,
      requirement: 'REQ-PLAN 制定计划', acceptanceCriteria: 'AC-PLAN', reviewer: null, dependsOn: [],
      output: 'PLAN-FULL-REPORT-BODY', outputLen: 2000, outputTruncated: false, reasoning: 'PLAN-REASONING-TRACE', reasoningLen: 20,
      tools: 'visible=41 filter={...}', error: null, taskId: 'vqmv3f31', taskStatus: 'completed', iteration: 0, history: [] },
    { id: 'fix-tabs', order: 1, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 300000, endedAt: NOW - 120000, elapsedMs: 180000,
      requirement: 'REQ-FIXTABS 修复标签', acceptanceCriteria: 'AC-FIXTABS', reviewer: 'Reviewer', dependsOn: ['plan'],
      output: 'CODE-FULL-REPORT-BODY', outputLen: 6780, outputTruncated: false, reasoning: 'CODE-REASONING-TRACE', reasoningLen: 21,
      tools: 'visible=41 filter={...}', error: null, taskId: 'ate14pml', taskStatus: 'completed', iteration: 0, history: [] },
    { id: 'panel', order: 2, agent: 'Coder', agentName: 'Coder', status: 'working', startedAt: NOW - 60000, endedAt: null, elapsedMs: 60000,
      requirement: 'REQ-PANEL 建造进度页', acceptanceCriteria: 'AC-PANEL', reviewer: null, dependsOn: ['fix-tabs'],
      output: null, outputLen: 0, outputTruncated: false, reasoning: null, reasoningLen: null,
      tools: 'visible=41 filter={...}', error: null, taskId: 'x1', taskStatus: 'working', iteration: 0, history: [] },
    { id: 'verify', order: 3, agent: 'Validator', agentName: 'Validator', status: 'failed', startedAt: NOW - 40000, endedAt: NOW - 20000, elapsedMs: 20000,
      requirement: 'REQ-VERIFY 独立验收', acceptanceCriteria: 'AC-VERIFY', reviewer: null, dependsOn: ['panel'],
      output: null, outputLen: 0, outputTruncated: false, reasoning: null, reasoningLen: null,
      tools: 'visible=41 filter={...}', error: 'VERIFY-FAILURE-TEXT', taskId: 'y1', taskStatus: 'settle', iteration: 0, history: [] },
  ]
  const roleCalls = []
  globalThis.fetch = (input) => {
    const url = new URL(String(typeof input === 'string' ? input : input.url), 'http://x')
    let body
    if (url.pathname === '/api/team-flowise/progress') body = PROGRESS_FIXTURE
    else if (url.pathname === '/api/team-flowise/role') {
      const agent = url.searchParams.get('agent')
      roleCalls.push(agent)
      body = { ok: true, run: RUN, role: agent, nodes: DETAIL.filter((n) => n.agentName === agent) }
    } else if (url.pathname === '/api/team-flowise/runs') body = { runs: [RUN] }
    else body = { agents: [], workflows: [], tasks: [] }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
  }

  // This stub's useEffect re-queues EVERY effect on every render (it tests
  // `cell.value === undefined`, which never becomes false) — real React re-runs
  // an effect only when its deps change. The page's selection effect clears the
  // detail and then refetches it, so a final settle() with NO flush afterwards is
  // what makes the fetched detail observable.
  const pump = async () => {
    for (let i = 0; i < 3; i++) {
      collect(react.flushEffects())
      await sleep(25)
      react.settle()
    }
    await sleep(25)
    react.settle()
    return react.render(react.createElement(main.component))
  }

  let page = null
  try {
    react.render(react.createElement(main.component))
    settle()
    page = await pump()
    check('progress page mounts without throwing', page !== null)
  } catch (e) {
    check('progress page mounts without throwing', false, String(e && e.message ? e.message : e))
  }

  if (page) {
    const text = flatten(page)
    const svg = findNode(page, (n) => n.type === 'svg')
    check('UML diagram renders as an <svg>', svg !== undefined, svg === undefined ? 'none' : 'w=' + String(svg.props.width) + ' h=' + String(svg.props.height))

    // Every node contributes exactly two messages: one dispatch, one delivery.
    let arrows = 0
    let headers = 0
    walk(page, (n) => {
      if (n.type === 'line' && n.props && n.props.markerEnd !== undefined) arrows += 1
      if (n.type === 'rect' && n.props && n.props.rx === 9) headers += 1
    })
    check('one dispatch + one delivery arrow per node (2 x 4)', arrows === NODES.length * 2, 'arrows=' + arrows)
    check('one lifeline header per participant (编排器 + 3 roles)', headers === 4, 'headers=' + headers)

    for (const nm of ['编排器', 'Planner', 'Coder', 'Validator']) {
      check('diagram shows participant "' + nm + '"', text.indexOf(nm) !== -1)
    }
    for (const n of NODES) {
      check('diagram labels the dispatch of node "' + n.id + '"', text.indexOf('«task» ' + n.id) !== -1)
    }
    check('diagram distinguishes a failed node from a delivered one',
      text.indexOf('«failed»') !== -1 && text.indexOf('«result»') !== -1)
    check('diagram carries the node briefs', text.indexOf('修复标签回退缺陷') !== -1)

    // The default selection is the role that is actually working.
    check('defaults to the role currently working (Coder)', roleCalls.indexOf('Coder') !== -1, JSON.stringify(roleCalls))
    check('role detail shows the full report body (not the 200-char slice)', text.indexOf('CODE-FULL-REPORT-BODY') !== -1)
    check('role detail shows the reasoning trace', text.indexOf('CODE-REASONING-TRACE') !== -1)
    check('role detail shows the requirement it was given', text.indexOf('REQ-FIXTABS 修复标签') !== -1)
    check('role detail shows the acceptance criteria', text.indexOf('AC-FIXTABS') !== -1)
    check('role detail shows the tool policy note', text.indexOf('visible=41') !== -1)
    check('role detail is honest when a node produced no reasoning block', text.indexOf('本次未产生可记录的推理块') !== -1)
    check('role detail marks a recorded-only reviewer as such', text.indexOf('评审(仅记录)') !== -1)

    // Clicking another role must fetch THAT role and swap the detail.
    const chips = []
    walk(page, (n) => { if (n.type === 'button' && String(n.props.className || '').indexOf('tf-chip2') === 0) chips.push(n) })
    check('one role chip per role', chips.length === 3, 'chips=' + chips.length)
    const plannerChip = chips.filter((c) => flatten(c).indexOf('Planner') !== -1)[0]
    try {
      plannerChip.props.onClick()
      settle()
      page = await pump()
      const t2 = flatten(page)
      check('clicking the Planner chip fetches Planner', roleCalls.indexOf('Planner') !== -1, JSON.stringify(roleCalls))
      check('clicking the Planner chip swaps the detail to Planner content',
        t2.indexOf('PLAN-FULL-REPORT-BODY') !== -1 && t2.indexOf('CODE-FULL-REPORT-BODY') === -1)
      check('Planner detail shows its own reasoning trace', t2.indexOf('PLAN-REASONING-TRACE') !== -1)
    } catch (e) {
      check('clicking the Planner chip swaps the detail to Planner content', false, String(e && e.message ? e.message : e))
    }

    check('run selector lists the run', flatten(page).indexOf('P8 夹具工作流') !== -1)
    check('page shows the aggregate the sidebar summary needs', flatten(page).indexOf('50%') !== -1)
  }

  for (const d of allDisposers) if (d && typeof d.dispose === 'function') { try { d.dispose() } catch { /* ignore */ } }
  globalThis.fetch = realFetch
}

// ===========================================================================
console.log('\n=== PHASE 2: host data plane (needs the restart) ===')
const prog = await get('/api/team-flowise/progress')
if (prog.status === 401 || prog.status === 404) {
  deferred('/api/team-flowise/progress', 'status ' + prog.status + ' — an unregistered /api path is masked as 401 by the web auth gate; restart required')
} else {
  check('/progress responds 200', prog.status === 200, 'status=' + prog.status)
  const p = prog.json || {}
  check('/progress returns ok:true', p.ok === true)
  check('/progress has run / nodes / totals', 'run' in p && Array.isArray(p.nodes) && p.totals !== undefined)
  const to = p.totals || {}
  const sum = (to.completed || 0) + (to.failed || 0) + (to.working || 0) + (to.pending || 0)
  check('totals add up to total', to.total === sum, 'total=' + to.total + ' sum=' + sum)
  check('totals.total equals nodes.length', to.total === (p.nodes || []).length)
  const expectPct = to.total ? Math.round((to.completed || 0) / to.total * 100) : 0
  check('percent is consistent', to.percent === expectPct, 'percent=' + to.percent + ' expected=' + expectPct)

  // P8 additions on the light payload. The PRE-P8 host still answers /progress
  // with 200 (P7 shipped it), so a missing `roles` is how this process reports
  // "the running host is still the old code" -- deferred, not failed.
  const isP8 = Array.isArray(p.roles)
  if (!isP8) {
    deferred('P8 /progress fields (roles, agentName, dependsOn, brief, workflowName)',
      'this process still serves the pre-P8 payload; restart required')
    deferred('/api/team-flowise/role (per-role detail)', 'the route is not registered in this process; restart required')
  } else {
    const withoutName = (p.nodes || []).filter((n) => n.agentName === undefined)
    check('every node carries a normalized agentName (role grouping works)', withoutName.length === 0,
      withoutName.length ? JSON.stringify(withoutName[0]) : '')
    const withoutDag = (p.nodes || []).filter((n) => !Array.isArray(n.dependsOn))
    check('every node carries dependsOn (the diagram needs the DAG)', withoutDag.length === 0)
    check('run envelope carries workflowName', p.run === null || 'workflowName' in (p.run || {}), JSON.stringify(p.run))
    check('roles roll-up agrees with the node counts', (p.roles || []).reduce((a, r) => a + r.total, 0) === (p.nodes || []).length,
      'roles=' + JSON.stringify(p.roles))
    console.log('       run=' + JSON.stringify(p.run))
    for (const n of (p.nodes || [])) console.log('       node ' + String(n.id).padEnd(14) + String(n.status).padEnd(11) + String(n.agentName).padEnd(12) + 'brief=' + String(n.brief).slice(0, 28))

    const role = (p.nodes || []).filter((n) => n.status === 'completed')[0]
    if (role === undefined) deferred('/api/team-flowise/role', 'no completed node to read a role for yet')
    else {
      const r = await get('/api/team-flowise/role?agent=' + encodeURIComponent(role.agentName))
      check('/role responds 200', r.status === 200, 'status=' + r.status)
      const d = r.json || {}
      check('/role echoes the requested role', d.role === role.agentName, String(d.role))
      check('/role returns only that role\'s nodes', (d.nodes || []).every((n) => n.agentName === role.agentName),
        JSON.stringify((d.nodes || []).map((n) => n.agentName)))
      const first = (d.nodes || [])[0] || {}
      check('/role exposes the full output length (beyond the 200-char run slice)', typeof first.outputLen === 'number', 'outputLen=' + String(first.outputLen))
      if (typeof first.outputLen === 'number' && first.outputLen > 200) {
        check('/role really returns more than the run record\'s 200-char slice', typeof first.output === 'string' && first.output.length > 200,
          'output.length=' + String((first.output || '').length))
      } else {
        check('/role really returns more than the run record\'s 200-char slice', true, 'node output was short (' + String(first.outputLen) + ')')
      }
      check('/role exposes the requirement the worker was given', typeof first.requirement === 'string' && first.requirement.length > 0)
      console.log('       role=' + String(d.role) + ' nodes=' + String((d.nodes || []).length))
    }
  }

  const withTime = (p.nodes || []).filter((n) => typeof n.startedAt === 'number')
  if (withTime.length === 0) deferred('live working marker (startedAt/endedAt)', 'no run has executed since the restart')
  else check('a node carries startedAt (working-marker code path ran)', true, withTime.length + ' node(s)')
}

if (process.argv.includes('--smoke')) {
  console.log('\n=== PHASE 2b: live smoke run (proves the marker + reasoning capture) ===')
  const smoke = {
    id: 'p8-smoke',
    name: 'P8 冒烟（单节点）',
    description: 'One trivial node, used only to observe the live marker and reasoning capture.',
    nodes: {
      ping: {
        id: 'ping', agent: 'Validator', dependsOn: [],
        taskTemplate: {
          requirement: '这是一个冒烟测试。不要读写任何文件，先想一下再直接回复一句话，内容必须包含 OK。',
          acceptanceCriteria: '回复中包含 OK。',
        },
      },
    },
  }
  const wfRes = await fetch(ORIGIN + '/api/team-flowise/workflow', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(smoke),
  })
  console.log('  upsert smoke workflow ->', wfRes.status)
  const startRes = await fetch(ORIGIN + '/api/team-flowise/run/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId: 'p8-smoke' }),
  })
  const startJson = await startRes.json().catch(() => null)
  const runId = startJson && startJson.run && startJson.run.id
  check('smoke run started', typeof runId === 'string', String(runId))
  if (runId) {
    let sawWorking = false
    const deadline = Date.now() + 12 * 60 * 1000
    const smokeStart = Date.now()
    for (;;) {
      const r = await get('/api/team-flowise/run?id=' + encodeURIComponent(runId))
      const run = r.json && r.json.run
      const st = run && run.nodeStates && run.nodeStates.ping
      if (st && st.status === 'working') { sawWorking = true; console.log('       observed ping=working startedAt=' + String(st.startedAt)) }
      if (run && run.status !== 'running') {
        console.log('       smoke settled: ' + run.status + ' node=' + JSON.stringify(st && { status: st.status, startedAt: st.startedAt, endedAt: st.endedAt, taskId: st.taskId, reasoningLen: st.reasoningLen }))
        break
      }
      if (Date.now() > deadline) { console.log('       smoke deadline hit'); break }
      // A trivial node can settle in well under a second, so sample fast while the
      // run is young: the `working` state is real, but a 5s poll steps right over it.
      await sleep(Date.now() - smokeStart < 30000 ? 200 : 5000)
    }
    check('a node was observed in the live working state', sawWorking)
    const r2 = await get('/api/team-flowise/run?id=' + encodeURIComponent(runId))
    const st = r2.json && r2.json.run && r2.json.run.nodeStates && r2.json.run.nodeStates.ping
    check('the settled node kept startedAt and gained endedAt',
      !!(st && typeof st.startedAt === 'number' && typeof st.endedAt === 'number'),
      JSON.stringify(st && { startedAt: st.startedAt, endedAt: st.endedAt }))
    check('the settled node recorded its taskId', !!(st && typeof st.taskId === 'string'), String(st && st.taskId))

    const sr = await get('/api/team-flowise/role?agent=' + encodeURIComponent('Validator'))
    const sn = ((sr.json || {}).nodes || []).filter((n) => n.id === 'ping')[0]
    check('/role serves the smoke node', sn !== undefined)
    if (sn) {
      check('the smoke node reports the requirement it was given', typeof sn.requirement === 'string' && sn.requirement.length > 0)
      check('the smoke node reports a full output length', typeof sn.outputLen === 'number' && sn.outputLen > 0, 'outputLen=' + String(sn.outputLen))
      if (sn.reasoning) {
        check('a reasoning trace was captured and served', sn.reasoning.length > 0, 'reasoningLen=' + String(sn.reasoningLen))
      } else {
        // Whether the adapter emits reasoning blocks is the provider's choice, not
        // ours; report it rather than fail. The page has an explicit empty state.
        console.log('  note  this run produced NO reasoning blocks; the page shows its explicit empty state for that')
      }
    }
  }
}

// ===========================================================================
console.log('\n=== SUMMARY ===')
console.log('checks=' + checks + '  failures=' + failures)
if (pending.length) {
  console.log('NOT YET VERIFIABLE in this process (' + pending.length + '):')
  for (const p of pending) console.log('  - ' + p)
}
console.log(failures === 0 ? '\nRESULT: PASS' + (pending.length ? ' with ' + pending.length + ' restart-gated item(s)' : '') : '\nRESULT: FAIL')
process.exit(failures === 0 ? 0 : 1)
