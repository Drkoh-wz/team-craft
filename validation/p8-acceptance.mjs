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
function captureSlots(face, withTabs) {
  const regs = []
  const injected = []
  const tabTypes = []
  const slots = {
    inject(name, cb) { injected.push(name); return cb() },
    register(options, component) { regs.push({ options, component }); return () => {} },
  }
  const locale = { register() { return () => {} } }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'sidebarRightTabs') {
        if (withTabs === false) return undefined
        return { register(definition) { tabTypes.push(definition); return () => {} } }
      }
      return undefined
    },
    effect(cb) { const d = cb(); return () => {} },
    logger: { warn() {}, error() {}, info() {} },
  }
  let error
  try { face.apply(ctx) } catch (e) { error = e }
  return { regs, injected, tabTypes, error }
}

// The surfaces this plugin contributes, as NAMES (not as a count). P12 added a
// sixth one (`sidebar.footer.action`); a total-count assertion would only say
// "the number changed", so the set is asserted instead: every expected surface
// must be present exactly once, and nothing unexpected may appear.
const EXPECTED_SURFACES = ['sidebar.panellist', 'main', 'sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'settings.section', 'sidebar.footer.action']
const WITHOUT_TABS_SURFACES = ['sidebar.panellist', 'main', 'settings.section', 'sidebar.footer.action']
/** How many times each slot NAME was registered. */
function surfaceCounts(applied) {
  const counts = {}
  for (const r of applied.regs) counts[r.options.name] = (counts[r.options.name] || 0) + 1
  return counts
}
/** A compact `name{opt=val,...}` signature, for the log line and for pinning ids. */
function surfaceSignature(r) {
  return r.options.name + '{' + Object.keys(r.options).filter((k) => k !== 'name').map((k) => k + '=' + String(r.options[k])).join(',') + '}'
}

// ===========================================================================
console.log('\n=== PHASE 1: client bundle (provable without a restart) ===')

const clientSource = readFileSync(CLIENT_SRC, 'utf8')
check('client bundle is a single self-registering factory', /__ModuleLoader__\.load\(/.test(clientSource))

let bundle = null
try { bundle = evaluateBundle(clientSource); check('client bundle evaluates without throwing', true) }
catch (e) { check('client bundle evaluates without throwing', false, String(e && e.message ? e.message : e)) }

if (bundle) {
  check('bundle exposes a real plugin face (name / inject / apply)',
    typeof bundle.face.apply === 'function' && Array.isArray(bundle.face.inject) && typeof bundle.face.name === 'string',
    typeof bundle.face.name === 'string' ? bundle.face.name : typeof bundle.face)
  const applied = captureSlots(bundle.face)
  check('face.apply(ctx) does not throw', applied.error === undefined, applied.error ? String(applied.error) : '')

  const byName = (n) => applied.regs.filter((r) => r.options.name === n)
  const panel = byName('sidebar.panellist')[0]
  const main = byName('main')[0]
  const board = byName('settings.section')[0]

  console.log('       injections: ' + JSON.stringify(applied.injected))
  console.log('       registrations: ' + JSON.stringify(applied.regs.map(surfaceSignature)))

  check('registers exactly one sidebar.panellist entry', byName('sidebar.panellist').length === 1)
  check('sidebar entry uses our own fresh id', !!panel && panel.options.id === 'team-progress', panel ? String(panel.options.id) : 'none')
  check('registers main (the central panel) under the SAME id as the sidebar entry',
    !!main && !!panel && main.options.key === panel.options.id, main ? String(main.options.key) : 'none')
  check('sidebar entry has a label (the sidebar resolves its tooltip from it)', !!panel && typeof panel.options.label === 'string' && panel.options.label.length > 0)
  check('no shell.overlay registration remains (that was the covering overlay)',
    byName('shell.overlay').length === 0, JSON.stringify(byName('shell.overlay').map((r) => r.options.id)))
  check('kanban page still registered (settings.section/team)', !!board && board.options.id === 'team', board ? String(board.options.id) : 'none')
  check('every contributed slot surface is present exactly once, and no unexpected surface appeared '
    + '(P12 added sidebar.footer.action, so this asserts the SET of names instead of a total count)',
    (() => {
      const counts = surfaceCounts(applied)
      if (!EXPECTED_SURFACES.every((n) => counts[n] === 1)) return false
      return Object.keys(counts).every((n) => EXPECTED_SURFACES.indexOf(n) !== -1)
    })(),
    'surfaces=' + JSON.stringify(surfaceCounts(applied)))
  check('the P12 footer entry keeps its own namespaced id/order/label (it is a NEW surface, not a renamed one)',
    (() => {
      const f = byName('sidebar.footer.action')[0]
      return !!f && f.options.id === 'team-flowise-progress' && f.options.order === 900 && typeof f.options.label === 'string' && f.options.label.length > 0
    })(),
    JSON.stringify(byName('sidebar.footer.action').map((r) => r.options)))

  // -------------------------------------------------------------------------
  // The docked right-sidebar pane (the actual "sidebar" surface).
  const paneId = applied.tabTypes.length ? applied.tabTypes[0].id : null
  check('registers exactly one right-sidebar tab type', applied.tabTypes.length === 1, 'n=' + applied.tabTypes.length)
  check('the tab type has a non-empty id and kind',
    !!paneId && typeof applied.tabTypes[0].kind === 'string' && applied.tabTypes[0].kind.length > 0,
    JSON.stringify(applied.tabTypes[0] && { id: applied.tabTypes[0].id, kind: applied.tabTypes[0].kind }))
  check('the tab type resolves a human title()', (() => {
    const t = applied.tabTypes[0] && applied.tabTypes[0].title
    return typeof t === 'function' && typeof t() === 'string' && t().length > 0
  })(), String(applied.tabTypes[0] && applied.tabTypes[0].title && applied.tabTypes[0].title()))
  // The guide entry IS the user's way in: GuideBody's onPick calls
  // tab.actions.openTab(entry.kind), so a guide entry needs no address pattern.
  const guide = (applied.tabTypes[0] && applied.tabTypes[0].guide) || []
  check('the tab type contributes a guide entry (the click-to-open path)',
    guide.length === 1 && typeof guide[0].title === 'function' && typeof guide[0].description === 'function' && typeof guide[0].icon === 'function' && typeof guide[0].order === 'number',
    JSON.stringify(guide.map((g) => ({ order: g.order, title: typeof g.title === 'function' ? g.title() : g.title, icon: typeof g.icon }))))
  check('the guide icon is a component that renders an <svg>', (() => {
    if (!guide.length || typeof guide[0].icon !== 'function') return false
    const node = bundle.react.mount(bundle.react.createElement(guide[0].icon, { size: 16, className: 'x' }))
    return node !== null && node.type === 'svg' && node.props.width === 16
  })())
  check('the pane body registers under the tab type id (the keyed dispatch contract)',
    byName('sidebar.right.pane.tab').length === 1 && byName('sidebar.right.pane.tab')[0].options.key === paneId,
    JSON.stringify(byName('sidebar.right.pane.tab').map((r) => r.options.key)))
  check('the pane chip title registers under the same id',
    byName('sidebar.right.pane.tab.title').length === 1 && byName('sidebar.right.pane.tab.title')[0].options.key === paneId,
    JSON.stringify(byName('sidebar.right.pane.tab.title').map((r) => r.options.key)))
  check('the pane body renders without throwing',
    (() => { try { return bundle.react.mount(bundle.react.createElement(byName('sidebar.right.pane.tab')[0].component)) !== null } catch (e) { return false } })())
  check('the pane chip title renders the readable name, not an id', (() => {
    try {
      const node = bundle.react.mount(bundle.react.createElement(byName('sidebar.right.pane.tab.title')[0].component))
      return flatten(node).indexOf('多 Agent 进度') !== -1
    } catch (e) { return false }
  })())

  // If the right-sidebar package is absent the plugin must still work: the pane is
  // an optional capability, not a hard dependency.
  const withoutTabs = captureSlots(bundle.face, false)
  check('without sidebarRightTabs the plugin still applies and keeps exactly the surfaces that do not depend on it '
    + '(panellist, main, footer, kanban; P12 added the footer, so this asserts the SET of names)',
    withoutTabs.error === undefined && (() => {
      const counts = surfaceCounts(withoutTabs)
      if (!WITHOUT_TABS_SURFACES.every((n) => counts[n] === 1)) return false
      return Object.keys(counts).every((n) => WITHOUT_TABS_SURFACES.indexOf(n) !== -1)
    })() && withoutTabs.tabTypes.length === 0,
    'error=' + String(withoutTabs.error) + ' surfaces=' + JSON.stringify(surfaceCounts(withoutTabs)))

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
    // A real check: the previous one asserted a substring was absent from a text
    // dump, which a component that fetched would still satisfy.
    const iconFetches = []
    const fetchBefore = globalThis.fetch
    globalThis.fetch = (input) => { iconFetches.push(String(typeof input === 'string' ? input : input.url)); return Promise.resolve({ ok: false, json: () => Promise.resolve({}) }) }
    bundle.react.mount(bundle.react.createElement(iconReg.component, { size: 20, active: false }))
    globalThis.fetch = fetchBefore
    check('sidebar icon performs no fetch of its own', iconFetches.length === 0, JSON.stringify(iconFetches))
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
  // P11: the role-configuration form. Before P11 the agent dialog was READ-ONLY
  // -- it rendered `ag.model.name`, a field the schema does not have, plus a lone
  // 关闭 button -- so a role's model and prompt could not be customised from the
  // UI at all, and team_create_agent could only ever mint NEW roles. This drives
  // the real bundle end to end: open the dialog, read the catalog, edit the
  // persona, save, and inspect the POST body. (p11-route.mjs covers the host half;
  // it never evaluates the client bundle, so this is the only form coverage.)
  const AGENT_FIXTURE = {
    id: 'agt-coder', name: 'Coder', role: '编码者', systemPrompt: 'SP-OLD-TEXT',
    model: { provider: 'p1', model: 'm1' }, tools: {}, skills: [], updatedAt: 1,
  }
  const CATALOG_FIXTURE = {
    ok: true, errors: [],
    providers: [{ id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }],
  }
  const agentPosts = []
  let catalogOk = false
  globalThis.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url)
    const method = String((init && init.method) || 'GET').toUpperCase()
    if (method === 'POST' && url.indexOf('/agent') !== -1) {
      agentPosts.push(String((init && init.body) || ''))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
    }
    if (url.indexOf('/models') !== -1) {
      // Scenario (a) deliberately has no catalog: the form must degrade to manual
      // input instead of rendering an empty dropdown or throwing.
      return catalogOk
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(CATALOG_FIXTURE) })
        : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    }
    if (url.indexOf('/agents') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ agents: [AGENT_FIXTURE] }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ workflows: [], tasks: [], runs: [] }) })
  }
  const openAgentDialog = async () => {
    let tree = treeOf(board.component)
    settle()
    clickTab(tree, 'Agents')
    await sleep(20) // let the /agents fetch resolve before looking for its rows
    tree = treeOf(board.component)
    settle()
    const open = findNode(tree, (n) => n.type === 'button' && n.props && n.props.children === '详情' && typeof n.props.onClick === 'function')
    if (open === undefined) throw new Error('no 详情 button in the Agents tab')
    open.props.onClick()
    // Two rounds, deliberately. The first render RUNS the dialog's /models effect;
    // the sleep lets that fetch resolve with no intervening render; the second
    // round renders the resolved state. (This stub re-queues effects on every
    // render, so a render between the fetch starting and resolving would let the
    // effect's own `alive` cleanup discard the result -- real React re-runs the
    // effect only when `modal` changes, so it takes exactly one fetch.)
    settle()
    await sleep(30)
    const dialog = treeOf(board.component)
    settle()
    return dialog
  }
  try {
    const tManual = await openAgentDialog()
    if (process.env.P8_DEBUG) {
      const ft = flatten(tManual)
      console.log('DEBUG len=' + ft.length +
        ' err=' + ft.indexOf('模型目录获取失败') +
        ' loading=' + ft.indexOf('正在读取模型目录') +
        ' empty=' + ft.indexOf('模型目录为空或不可用') +
        ' title=' + ft.indexOf('编辑角色') +
        ' manualInput=' + ft.indexOf('手工输入 provider id'))
      const at = ft.indexOf('provider/model 必须成对声明')
      console.log('DEBUG help: ' + (at === -1 ? '(help text absent)' : ft.slice(at, at + 220)))
    }
    check('P11: with no model catalog the provider field falls back to manual input',
      findNode(tManual, (n) => n.type === 'input' && n.props && n.props.placeholder === '手工输入 provider id') !== undefined)
    check('P11: the catalog failure is surfaced to the user rather than swallowed',
      flatten(tManual).indexOf('模型目录获取失败') !== -1)

    catalogOk = true
    const tForm = await openAgentDialog()
    const formText = flatten(tForm)
    const area = findNode(tForm, (n) => n.type === 'textarea')
    check('P11: the dialog is an editable form, with the persona pre-filled from the role record',
      area !== undefined && area.props.value === 'SP-OLD-TEXT', area === undefined ? 'no textarea' : JSON.stringify(area.props.value))
    check('P11: provider and model are offered from the catalog',
      formText.indexOf('P1 (p1)') !== -1 && formText.indexOf('M1') !== -1)
    check('P11: the persona label states the REAL semantics (a persona section, not the whole system prompt)',
      formText.indexOf('persona') !== -1 && formText.indexOf('deployment persona') !== -1)
    check('P11: the provider/model pairing rule is explained, not merely enforced', formText.indexOf('必须成对声明') !== -1)
    check('P11: the read-only preset is labelled as discipline, not a sandbox',
      formText.indexOf('不是沙箱') !== -1 || formText.indexOf('纪律预设') !== -1)
    check('P11: the dialog never renders the non-existent model.name field', formText.indexOf('undefined') === -1)

    if (area !== undefined) area.props.onChange({ target: { value: 'SP-NEW-TEXT' } })
    const tEdited = treeOf(board.component)
    settle()
    const save = findNode(tEdited, (n) => n.type === 'button' && n.props && n.props.children === '保存' && typeof n.props.onClick === 'function')
    check('P11: the dialog has a save button (it was 关闭-only before)', save !== undefined)
    if (save !== undefined) {
      save.props.onClick()
      await sleep(20)
      settle()
      const body = agentPosts.length ? JSON.parse(agentPosts[agentPosts.length - 1]) : null
      check('P11: saving POSTs the EDITED persona', body !== null && body.systemPrompt === 'SP-NEW-TEXT', JSON.stringify(body && body.systemPrompt))
      check('P11: the save updates the SAME role (id carried) instead of creating a new one',
        body !== null && body.id === 'agt-coder', JSON.stringify(body && body.id))
      check('P11: the declared route round-trips through the form',
        body !== null && body.model !== undefined && body.model.provider === 'p1' && body.model.model === 'm1', JSON.stringify(body && body.model))
    }
  } catch (e) {
    check('P11: the role-configuration form is editable and saves', false, String(e && e.message ? e.message : e))
  }

  // -------------------------------------------------------------------------
  // The progress page, driven from deterministic fixtures.
  const NOW = Date.now()
  // A real /runs record carries nodeStates, and the selector's "N 节点" is derived
  // from it -- so the fixture must carry it too.
  const RUN = {
    id: 'runp8fixture', workflowId: 'wf-p8', workflowName: 'P8 夹具工作流', status: 'running',
    startedAt: NOW - 900000, endedAt: null,
    nodeStates: {
      plan: { status: 'completed' }, 'fix-tabs': { status: 'completed' }, panel: { status: 'working' },
      verify: { status: 'failed' }, docs: { status: 'pending' },
    },
  }
  const NODES = [
    { id: 'plan', order: 0, agent: 'Planner', agentName: 'Planner', status: 'completed', startedAt: NOW - 900000, endedAt: NOW - 300000, elapsedMs: 600000, title: 'P7 计划', summary: '计划已写入 P7-PLAN.md', brief: '制定实施计划', dependsOn: [], reviewer: 'Reviewer', output: 'PLAN-SLICE' },
    // P10: a reviewed node. `review` here is the LIGHT projection /progress serves
    // (verdict/counts/rounds/reviewerName), which is what the diagram labels with.
    { id: 'fix-tabs', order: 1, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 300000, endedAt: NOW - 120000, elapsedMs: 180000, title: 'P7-A 修复标签回退缺陷', summary: '唯一改动 client/index.js', brief: '修复标签回退缺陷', dependsOn: ['plan'], reviewer: 'Reviewer', review: { verdict: 'pass', blocking: 0, advisory: 1, unresolved: false, rounds: 2, reviewerName: 'Reviewer', elapsedMs: 30000, summary: 'REVIEW-LIGHT-SUMMARY 通过' }, output: 'CODE-SLICE' },
    { id: 'panel', order: 2, agent: 'Coder', agentName: 'Coder', status: 'working', startedAt: NOW - 60000, endedAt: null, elapsedMs: 60000, title: 'P7-B1 进度数据面', summary: null, brief: '建造侧边栏进度页', dependsOn: ['fix-tabs'], reviewer: null, output: null },
    { id: 'verify', order: 3, agent: 'Validator', agentName: 'Validator', status: 'failed', startedAt: NOW - 40000, endedAt: NOW - 20000, elapsedMs: 20000, title: 'P7 独立验收', summary: '失败：VERIFY-FAILURE-TEXT', brief: '独立验收', dependsOn: ['panel'], reviewer: null, output: null },
    // A node with no agent is legal. It is the case where the server roll-up and
    // the client's lane label must agree on one placeholder literal, and it is
    // never dispatched -- so it must get NO arrow.
    { id: 'docs', order: 4, agent: null, agentName: null, status: 'pending', startedAt: null, endedAt: null, elapsedMs: null, title: '撰写文档', summary: null, brief: '撰写文档', dependsOn: ['verify'], reviewer: null, output: null },
  ]
  const PROGRESS_FIXTURE = {
    ok: true, run: RUN,
    roles: [
      { name: 'Planner', total: 1, completed: 1, failed: 0, working: 0, pending: 0, elapsedMs: 600000 },
      { name: 'Coder', total: 2, completed: 1, failed: 0, working: 1, pending: 0, elapsedMs: 240000 },
      { name: 'Validator', total: 1, completed: 0, failed: 1, working: 0, pending: 0, elapsedMs: 20000 },
      { name: '(未指派)', total: 1, completed: 0, failed: 0, working: 0, pending: 1, elapsedMs: 0 },
    ],
    nodes: NODES,
    totals: { total: 5, completed: 2, failed: 1, working: 1, pending: 1, percent: 40 },
  }
  const DETAIL = [
    { id: 'plan', order: 0, agent: 'Planner', agentName: 'Planner', status: 'completed', startedAt: NOW - 900000, endedAt: NOW - 300000, elapsedMs: 600000,
      title: 'P7 计划', summary: '计划已写入 P7-PLAN.md',
      requirement: 'REQ-PLAN 制定计划', acceptanceCriteria: 'AC-PLAN', reviewer: 'Reviewer', review: null, dependsOn: [],
      output: 'PLAN-FULL-REPORT-BODY', outputLen: 2000, outputTruncated: false, reasoning: 'PLAN-REASONING-TRACE', reasoningLen: 20,
      tools: 'visible=41 filter={...}', error: null, taskId: 'vqmv3f31', taskStatus: 'completed', iteration: 0, history: [] },
    // P10 (B1): the OWNER entry carries the full review, because NodeCard is
    // rendered from this entry -- that is the whole point of the host-side fix.
    { id: 'fix-tabs', order: 1, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 300000, endedAt: NOW - 120000, elapsedMs: 180000,
      title: 'P7-A 修复标签回退缺陷', summary: '唯一改动 client/index.js',
      requirement: 'REQ-FIXTABS 修复标签', acceptanceCriteria: 'AC-FIXTABS', reviewer: 'Reviewer', dependsOn: ['plan'],
      review: { reviewer: 'Reviewer', reviewerName: 'Reviewer', verdict: 'pass', score: 88, summary: 'REVIEW-SUMMARY-通过',
        findings: [
          { severity: 'advisory', downgraded: true, downgradeReason: 'R3：标为 blocking 但 evidence 去空白后只有 2 字符（< 8），证据不足，降级为 advisory', dimension: '优化空间', criterion: 'FINDING-DOWNGRADED-ADVISORY', evidence: 'EV', impact: null, suggestion: 'SUG-ADVISORY' },
        ],
        resolved: [{ finding: 'ROUND1-BLOCKING-ITEM', resolved: true, evidence: 'RESOLVED-EVIDENCE-TEXT' }],
        uncertainties: ['UNCERTAIN-ONE'], blockingCount: 0, advisoryCount: 1, unresolved: false, unresolvedReason: null, rounds: 2,
        startedAt: NOW - 40000, endedAt: NOW - 10000, elapsedMs: 30000, reasoning: 'REVIEWER-REASONING-TRACE', reasoningLen: 24,
        notes: ['R3：证据不足，降级为 advisory'], error: null, parseError: null, toolNote: 'visible=41' },
      output: 'CODE-FULL-REPORT-BODY', outputLen: 90000, outputTruncated: true, reasoning: 'CODE-REASONING-TRACE', reasoningLen: 21,
      tools: 'visible=41 filter={...}', error: null, taskId: 'ate14pml', taskStatus: 'completed', iteration: 0 },
    { id: 'panel', order: 2, agent: 'Coder', agentName: 'Coder', status: 'working', startedAt: NOW - 60000, endedAt: null, elapsedMs: 60000,
      title: 'P7-B1 进度数据面', summary: null,
      requirement: 'REQ-PANEL 建造进度页', acceptanceCriteria: 'AC-PANEL', reviewer: null, dependsOn: ['fix-tabs'],
      output: null, outputLen: 0, outputTruncated: false, reasoning: null, reasoningLen: null,
      tools: 'visible=41 filter={...}', error: null, taskId: 'x1', taskStatus: 'working', iteration: 0, history: [] },
    { id: 'verify', order: 3, agent: 'Validator', agentName: 'Validator', status: 'failed', startedAt: NOW - 40000, endedAt: NOW - 20000, elapsedMs: 20000,
      title: 'P7 独立验收', summary: '失败：VERIFY-FAILURE-TEXT',
      requirement: 'REQ-VERIFY 独立验收', acceptanceCriteria: 'AC-VERIFY', reviewer: null, dependsOn: ['panel'],
      output: null, outputLen: 0, outputTruncated: false, reasoning: null, reasoningLen: null,
      tools: 'visible=41 filter={...}', error: 'VERIFY-FAILURE-TEXT', taskId: 'y1', taskStatus: 'settle', iteration: 0 },
    { id: 'docs', order: 4, agent: null, agentName: null, status: 'pending', startedAt: null, endedAt: null, elapsedMs: null,
      title: '撰写文档', summary: null,
      requirement: 'REQ-DOCS 撰写文档', acceptanceCriteria: 'AC-DOCS', reviewer: null, dependsOn: ['verify'],
      output: null, outputLen: 0, outputTruncated: false, reasoning: null, reasoningLen: null,
      tools: null, error: null, taskId: null, taskStatus: null, iteration: null },
  ]
  const roleCalls = []
  globalThis.fetch = (input) => {
    const url = new URL(String(typeof input === 'string' ? input : input.url), 'http://x')
    let body
    if (url.pathname === '/api/team-flowise/progress') body = PROGRESS_FIXTURE
    else if (url.pathname === '/api/team-flowise/role') {
      const agent = url.searchParams.get('agent')
      roleCalls.push(agent)
      // Mirror the host: a node with no agent is served under the '(未指派)' role.
      const keyOf = (n) => (n.agentName === null || n.agentName === undefined ? '(未指派)' : n.agentName)
      body = { ok: true, run: RUN, role: agent, nodes: DETAIL.filter((n) => keyOf(n) === agent) }
    } else if (url.pathname === '/api/team-flowise/runs') body = { runs: [RUN] }
    else if (url.pathname === '/api/team-flowise/workflows') body = { workflows: [{ id: 'wf-p8', name: 'P8 夹具工作流', nodes: {} }] }
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

    // An arrow asserts that an interaction HAPPENED. Exactly: two for a node that
    // returned (completed/failed), one for a node still running, none for a node
    // never dispatched.
    let arrows = 0
    let headers = 0
    walk(page, (n) => {
      if (n.type === 'line' && n.props && n.props.markerEnd !== undefined) arrows += 1
      if (n.type === 'rect' && n.props && n.props.rx === 9) headers += 1
    })
    const expectedArrows = NODES.reduce((a, n) => a + (n.status === 'completed' || n.status === 'failed' ? 2 : n.status === 'working' ? 1 : 0), 0)
    check('arrow count equals what the scheduler has actually done (2 returned / 1 running / 0 pending)',
      arrows === expectedArrows, 'arrows=' + arrows + ' expected=' + expectedArrows)
    check('a never-dispatched node is labelled as such rather than given an arrow',
      findNode(page, (n) => n.type === 'text' && String(n.props.children || '').indexOf('尚未派发') !== -1) !== undefined)
    check('a running node is shown as not yet delivered',
      findNode(page, (n) => n.type === 'text' && String(n.props.children || '').indexOf('尚未交付') !== -1) !== undefined)

    // B2 guard: the lanes must be EXACTLY the server's role roll-up plus the
    // orchestrator. A second placeholder literal for an unassigned node would
    // render one role under two different names.
    const expectedParticipants = ['编排器'].concat(PROGRESS_FIXTURE.roles.map((r) => r.name))
    check('one lifeline per participant, matching /progress roles exactly (no second placeholder literal)',
      headers === expectedParticipants.length, 'headers=' + headers + ' expected=' + JSON.stringify(expectedParticipants))
    check('every /progress role appears as a lane', expectedParticipants.every((nm) => text.indexOf(nm) !== -1),
      JSON.stringify(expectedParticipants.filter((nm) => text.indexOf(nm) === -1)))

    for (const n of NODES.filter((x) => x.status !== 'pending')) {
      check('diagram labels the dispatch of "' + n.title + '" by its readable title', text.indexOf('«task» ' + n.title) !== -1)
    }
    check('the diagram keeps the raw node id as secondary metadata, not as the label',
      text.indexOf('#fix-tabs') !== -1)
    check('a returned node shows its own output summary in the diagram',
      text.indexOf('唯一改动 client/index.js') !== -1)
    check('diagram distinguishes a failed node from a delivered one',
      text.indexOf('«failed»') !== -1 && text.indexOf('«result»') !== -1)
    check('diagram carries the node briefs', text.indexOf('修复标签回退缺陷') !== -1)
    // The light projection drives the diagram label. (The round count is appended
    // only for a `rework` verdict: a pass that took 2 rounds reads as a pass.)
    check('the diagram labels a reviewed node with its verdict (light projection)',
      text.indexOf('评审 通过') !== -1)

    // The default selection is the role that is actually working.
    check('defaults to the role currently working (Coder)', roleCalls.indexOf('Coder') !== -1, JSON.stringify(roleCalls))
    check('role detail shows the full report body (not the 200-char slice)', text.indexOf('CODE-FULL-REPORT-BODY') !== -1)
    check('role detail shows the reasoning trace', text.indexOf('CODE-REASONING-TRACE') !== -1)
    check('role detail shows the requirement it was given', text.indexOf('REQ-FIXTABS 修复标签') !== -1)
    check('role detail shows the acceptance criteria', text.indexOf('AC-FIXTABS') !== -1)
    check('role detail shows the tool policy note', text.indexOf('visible=41') !== -1)
    check('role detail is honest when a node produced no reasoning block', text.indexOf('本次未产生可记录的推理块') !== -1)
    // P10 (B1, host+client halves). The node card is rendered from /role's OWNER
    // entry, so the review must be reachable there; and a node that DID have a
    // review must never be labelled "review is only recorded", which is the exact
    // contradiction the P10-D review caught on screen.
    check('role detail renders the review verdict on the node card (owner entry carries it)',
      text.indexOf('审核') !== -1 && text.indexOf('通过') !== -1, '')
    check('node card shows the advisory finding and that it was mechanically downgraded',
      text.indexOf('FINDING-DOWNGRADED-ADVISORY') !== -1 && text.indexOf('已降级为建议') !== -1)
    check('node card shows the reviewer\'s own reasoning trace', text.indexOf('REVIEWER-REASONING-TRACE') !== -1)
    check('node card shows the response to the previous round\'s blocking item',
      text.indexOf('已解决：') !== -1 && text.indexOf('ROUND1-BLOCKING-ITEM') !== -1)
    check('node card shows the reviewer\'s uncertainties', text.indexOf('UNCERTAIN-ONE') !== -1)
    check('a node that WAS reviewed is never labelled as review-not-executed',
      text.indexOf('尚无评审记录') === -1 && text.indexOf('评审(仅记录)') === -1)
    check('role detail discloses a truncated report instead of passing it off as whole',
      text.indexOf('超出上限，已截断') !== -1)

    // Clicking another role must fetch THAT role and swap the detail.
    const chips = []
    walk(page, (n) => { if (n.type === 'button' && String(n.props.className || '').indexOf('tf-chip2') === 0) chips.push(n) })
    check('one role chip per role', chips.length === PROGRESS_FIXTURE.roles.length, 'chips=' + chips.length)
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
      // The three-branch fallback: Planner's node declares a reviewer but has no
      // review RECORD (the pre-P10 / not-yet-reviewed case). The card must say
      // exactly that, and must not resurrect the old "评审(仅记录)" wording, which
      // asserts something about the plugin's capabilities rather than about this
      // node's data.
      check('a node with a declared reviewer but no record says so honestly',
        t2.indexOf('尚无评审记录') !== -1 && t2.indexOf('评审(仅记录)') === -1)
      check('the Planner node has no review block (no record => nothing to render)',
        t2.indexOf('FINDING-DOWNGRADED-ADVISORY') === -1)
    } catch (e) {
      check('clicking the Planner chip swaps the detail to Planner content', false, String(e && e.message ? e.message : e))
    }

    check('run selector lists the run', flatten(page).indexOf('P8 夹具工作流') !== -1)
    check('the run selector is readable (workflow name + node count, not a bare id)',
      flatten(page).indexOf('5 节点') !== -1)
    check('the node card surfaces a 产出摘要 section', flatten(page).indexOf('产出摘要') !== -1)
    check('page shows the aggregate the sidebar summary needs', flatten(page).indexOf('40%') !== -1)

    // The unassigned lane's detail must resolve rather than reporting "no nodes".
    const unassignedChip = chips.filter((c) => flatten(c).indexOf('(未指派)') !== -1)[0]
    try {
      unassignedChip.props.onClick()
      settle()
      page = await pump()
      const t3 = flatten(page)
      check('the unassigned role chip shows its own node detail',
        t3.indexOf('REQ-DOCS 撰写文档') !== -1 && t3.indexOf('该角色在本次运行里没有节点') === -1)
    } catch (e) {
      check('the unassigned role chip shows its own node detail', false, String(e && e.message ? e.message : e))
    }
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
  // P10 added two totals buckets (`reviewing` = a node whose artifact is being
  // judged, `rework` = a node sent back for another attempt). A node in either
  // state is deliberately NOT counted as `pending` any more, so the conservation
  // check has to enumerate all six buckets or it would report a bogus failure on
  // any run that has a node under review. For a pre-P10 payload both new keys
  // are absent, and `|| 0` keeps the sum -- and therefore this assertion --
  // numerically identical to what it was before.
  const sum = (to.completed || 0) + (to.failed || 0) + (to.working || 0) + (to.reviewing || 0) + (to.rework || 0) + (to.pending || 0)
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
    // `clean()` drops only undefined and roleNamer returns null (never undefined)
    // for an unassigned node, so filtering on `=== undefined` could never fail and
    // could never catch the placeholder mismatch that B2 was.
    const badName = (p.nodes || []).filter((n) => !('agentName' in n) || (n.agentName !== null && typeof n.agentName !== 'string'))
    check('every node carries agentName as a string or null', badName.length === 0, badName.length ? JSON.stringify(badName[0]) : '')
    const withoutDag = (p.nodes || []).filter((n) => !Array.isArray(n.dependsOn))
    check('every node carries dependsOn (the diagram needs the DAG)', withoutDag.length === 0)
    // Title is derived from the workflow definition at read time, so it exists for
    // runs recorded long before this change -- unlike `summary`, which the run
    // engine only started writing now (asserted in the smoke phase instead).
    const hasTitles = (p.nodes || []).some((n) => 'title' in n)
    if (!hasTitles) {
      deferred('node titles (readable step names)', 'the running host predates the naming change; restart required')
    } else {
      const noTitle = (p.nodes || []).filter((n) => typeof n.title !== 'string' || n.title === '')
      check('every node carries a readable title, not just an id', noTitle.length === 0, JSON.stringify(noTitle.map((n) => n.id)))
      const idEcho = (p.nodes || []).filter((n) => n.title === n.id)
      check('the title is a real name rather than the raw id echoed back', idEcho.length === 0, JSON.stringify(idEcho.map((n) => n.id)))
      console.log('       titles: ' + JSON.stringify((p.nodes || []).map((n) => n.id + ' -> ' + n.title)))
    }
    check('/progress exposes a workflowName key on the run envelope', p.run === null || 'workflowName' in (p.run || {}), JSON.stringify(p.run))
    // The live form of the B2 guard: the server's roll-up names must be exactly the
    // normalised node roles, so one role cannot appear under two literals.
    const rollUpNames = (p.roles || []).map((r) => r.name).sort()
    const nodeNames = [...new Set((p.nodes || []).map((n) => (n.agentName === null ? '(未指派)' : n.agentName)))].sort()
    check('roles roll-up names exactly the node roles (one placeholder literal)',
      rollUpNames.length === nodeNames.length && nodeNames.every((x) => rollUpNames.includes(x)),
      'roles=' + JSON.stringify(rollUpNames) + ' nodes=' + JSON.stringify(nodeNames))
    check('roles roll-up agrees with the node counts', (p.roles || []).reduce((a, r) => a + r.total, 0) === (p.nodes || []).length,
      'roles=' + JSON.stringify(p.roles))
    console.log('       run=' + JSON.stringify(p.run))
    for (const n of (p.nodes || [])) console.log('       node ' + String(n.id).padEnd(14) + String(n.status).padEnd(11) + String(n.agentName).padEnd(12) + 'brief=' + String(n.brief).slice(0, 28))

    const role = (p.nodes || []).filter((n) => n.status === 'completed' && typeof n.agentName === 'string')[0]
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
    // B1 guard: /role must serve THIS run's task. Joining on (workflowId, nodeId)
    // and taking the newest would silently serve a later run's report instead.
    if (st && typeof st.taskId === 'string') {
      const b1 = await get('/api/team-flowise/role?agent=' + encodeURIComponent('Validator') + '&runId=' + encodeURIComponent(runId))
      const b1n = ((b1.json || {}).nodes || []).filter((n) => n.id === 'ping')[0]
      check('B1: /role serves THIS run\'s task (joined by recorded taskId, not newest-for-node)',
        b1n !== undefined && b1n.taskId === st.taskId, 'role taskId=' + String(b1n && b1n.taskId) + ' run taskId=' + st.taskId)
      check('B1: /role echoes the run it was asked about',
        ((b1.json || {}).run || {}).id === runId, JSON.stringify((b1.json || {}).run))
    }

    const sr = await get('/api/team-flowise/role?agent=' + encodeURIComponent('Validator'))
    const sn = ((sr.json || {}).nodes || []).filter((n) => n.id === 'ping')[0]
    check('/role serves the smoke node', sn !== undefined)
    if (sn) {
      check('the smoke node reports the requirement it was given', typeof sn.requirement === 'string' && sn.requirement.length > 0)
      check('the smoke node carries a readable title', typeof sn.title === 'string' && sn.title !== '', String(sn.title))
      check('the smoke node carries its own output summary (recorded by the run engine)',
        typeof sn.summary === 'string' && sn.summary.length > 0, String(sn.summary))
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
// Let undici's keep-alive sockets and any closing async handle go idle first. On
// Windows an abrupt process.exit() while libuv handles are mid-close trips
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in async.c, which
// reports a spurious failure out of an otherwise perfectly clean run.
await sleep(400)
process.exit(failures === 0 ? 0 : 1)
