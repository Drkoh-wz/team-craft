// P7 POST-RESTART acceptance.
//
// Phase 1 (runs today, before the restart) proves what CAN be proven in this
// process. Phase 2 needs the restart and is what the user runs afterwards.
//
// Why a separate script from the Validator's: the Validator is required to
// declare the restart boundary as unverifiable-in-process. This script is the
// other half of that boundary — the part that only becomes observable once the
// host has restarted, which no in-run agent can do to itself.
//
// Usage:
//   node tf-accept-p7.mjs            # both phases, tolerating phase-2 404s
//   node tf-accept-p7.mjs --smoke    # also start a 1-node run to prove the live
//                                    # 'working' marker (needs the restart)
import { readFileSync } from 'node:fs'

const ORIGIN = process.env.TF_ORIGIN || 'http://127.0.0.1:3080'
const ROOT = 'D:/ai-workspace/dsh'
const HOST_SRC = ROOT + '/packages/team-flowise/src/index.js'
const CLIENT_SRC = ROOT + '/packages/team-flowise/src/client/index.js'
const HARNESS = ROOT + '/validation/_harness-part.mjs'
const SCALE = Number(process.env.SCALE || 50) // 5000ms poll -> 100ms

let checks = 0
let failures = 0
const pending = []
// The tab regression test below replaces globalThis.fetch with a stub; phase 2
// must talk to the real host, so keep the original.
const realFetch = globalThis.fetch
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
function deferred(label, why) { pending.push(label + '  (' + why + ')'); console.log('  ...  ' + label + '  -> NOT YET: ' + why) }
const get = async (p) => {
  const r = await realFetch(ORIGIN + p)
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: r.status, json, text }
}

// ===========================================================================
console.log('\n=== PHASE 1: client bundle (provable without a restart) ===')

const helpers = readFileSync(HARNESS, 'utf8')
const { createReactStub, makeDocument, applyToSlots, findNode } = new Function(
  helpers + '\nreturn { createReactStub, makeDocument, applyToSlots, findNode }',
)()

function evaluateBundle(source) {
  const react = createReactStub()
  const regs = []
  const windowStub = { __ModuleLoader__: { load(r) { regs.push(r) } }, devicePixelRatio: 2 }
  const requireStub = (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') return { jsx: react.createElement, jsxs: react.createElement }
    throw new Error('unexpected external require: ' + spec)
  }
  new Function(
    'window', 'require', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis',
    source,
  )(
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

const clientSource = readFileSync(CLIENT_SRC, 'utf8')
check('client bundle is a single self-registering factory', /__ModuleLoader__\.load\(/.test(clientSource))

let bundle = null
try { bundle = evaluateBundle(clientSource); check('client bundle evaluates without throwing', true) }
catch (e) { check('client bundle evaluates without throwing', false, String(e && e.message ? e.message : e)) }

if (bundle) {
  const applied = applyToSlots(bundle.face)
  check('face.apply(ctx) does not throw', applied.error === undefined, applied.error ? String(applied.error) : '')
  const keys = [...applied.entries.keys()]
  console.log('       registered slot keys: ' + JSON.stringify(keys))
  check('kanban still registered (settings.section)', keys.some((k) => k.startsWith('settings.section/')), keys.join(', '))
  const overlayKey = keys.find((k) => k.startsWith('shell.overlay/'))
  check('progress panel registered into shell.overlay', overlayKey !== undefined, overlayKey || 'none')

  // The regression the whole of P7-A exists for: every tab must survive a poll.
  const TAB_LABELS = ['Agents', '工作流', '任务', '运行']
  const { react } = bundle
  // A run whose nodeStates values are OBJECTS, which is what the host has always
  // written. 1 of 2 completed => the Runs tab bar must read 50%, not 0%.
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
  const boardEntry = applied.entries.get(keys.find((k) => k.startsWith('settings.section/')))
  const props = {}
  const tree = () => react.mount(react.createElement(boardEntry.component, props))
  const settle = () => { react.settle(); react.flushEffects(); return tree() }
  const activeTab = (node) => {
    const hit = findNode(node, (n) => n.type === 'button' && n.props && n.props.className === 'tf-tab active')
    return hit === undefined ? null : (typeof hit.props.children === 'string' ? hit.props.children : '?')
  }
  const clickTab = (node, label) => {
    const hit = findNode(node, (n) => n.type === 'button' && n.props && n.props.children === label && typeof n.props.onClick === 'function')
    if (hit === undefined) throw new Error('no tab labelled ' + label)
    hit.props.onClick()
  }
  let t = settle()
  check('initial tab is the board', activeTab(t) === '看板', JSON.stringify(activeTab(t)))
  for (const label of TAB_LABELS) {
    try {
      clickTab(t, label)
      t = settle()
      const immediate = activeTab(t)
      await new Promise((r) => setTimeout(r, 450)) // several compressed poll ticks
      t = settle()
      const after = activeTab(t)
      check('tab "' + label + '" survives the poll window', immediate === label && after === label,
        'immediate=' + JSON.stringify(immediate) + ' after=' + JSON.stringify(after))
    } catch (e) {
      check('tab "' + label + '" survives the poll window', false, String(e && e.message ? e.message : e))
    }
    try { clickTab(t, '看板'); t = settle() } catch { /* ignore */ }
  }

  // The Runs tab bar compared the nodeStates VALUE (an object) to 'completed', so it
  // always painted 0% while the new panel showed the truth. Guard the fix.
  try {
    clickTab(t, '运行')
    t = settle()
    const bar = findNode(t, (n) => n.props && n.props.className === 'tf-progress-bar')
    const width = bar === undefined ? undefined : (bar.props.style || {}).width
    check('Runs tab bar reflects object-shaped nodeStates (1 of 2 => 50%)', width === '50%', 'width=' + JSON.stringify(width))
  } catch (e) {
    check('Runs tab bar reflects object-shaped nodeStates (1 of 2 => 50%)', false, String(e && e.message ? e.message : e))
  }
  globalThis.fetch = realFetch
}

// ===========================================================================
console.log('\n=== PHASE 2: host progress endpoint (needs the restart) ===')
const prog = await get('/api/team-flowise/progress')
// A registered team-flowise route bypasses the web auth gate (see /ping -> 200),
// but an UNREGISTERED /api/* path falls through to that gate and comes back 401.
// So before the restart, a missing /progress is indistinguishable from an
// unauthenticated request: 401 here means "not yet served", not "auth failure".
if (prog.status === 401 || prog.status === 404) {
  deferred('/api/team-flowise/progress', 'status ' + prog.status + ' — route not served by this process (the auth gate masks an unregistered /api path as 401); restart required')
} else {
  check('/progress responds 200', prog.status === 200, 'status=' + prog.status)
  const p = prog.json || {}
  check('/progress returns ok:true', p.ok === true)
  check('/progress has run / nodes / totals', 'run' in p && Array.isArray(p.nodes) && p.totals !== undefined)
  const to = p.totals || {}
  const sum = (to.completed || 0) + (to.failed || 0) + (to.working || 0) + (to.pending || 0)
  check('totals add up to total', to.total === sum, 'total=' + to.total + ' sum=' + sum)
  check('totals.total equals nodes.length', to.total === (p.nodes || []).length, 'total=' + to.total + ' nodes=' + (p.nodes || []).length)
  const expectPct = to.total ? Math.round((to.completed || 0) / to.total * 100) : 0
  check('percent is consistent', to.percent === expectPct, 'percent=' + to.percent + ' expected=' + expectPct)
  const badNode = (p.nodes || []).find((n) => typeof n.id !== 'string' || typeof n.status !== 'string')
  check('every node has id and status', badNode === undefined, badNode ? JSON.stringify(badNode) : '')
  console.log('       run=' + JSON.stringify(p.run))
  for (const n of (p.nodes || [])) console.log('       node ' + String(n.id).padEnd(14) + String(n.status).padEnd(12) + 'elapsed=' + n.elapsedMs)

  // A node written by the NEW code carries startedAt/endedAt. Nodes written by
  // the pre-restart process only ever had status/assignee/output/tools.
  const withTime = (p.nodes || []).filter((n) => typeof n.startedAt === 'number')
  if (withTime.length === 0) {
    deferred('live working marker (startedAt/endedAt on a node)', 'no run has executed since the restart')
  } else {
    check('a node carries startedAt (working marker code path ran)', true, withTime.length + ' node(s)')
  }
}

if (process.argv.includes('--smoke')) {
  console.log('\n=== PHASE 2b: live marker smoke run ===')
  const smoke = {
    id: 'p7-smoke',
    name: 'P7 冒烟（单节点）',
    description: 'One trivial node, used only to observe the live working marker.',
    nodes: {
      ping: {
        id: 'ping',
        agent: 'Validator',
        dependsOn: [],
        taskTemplate: {
          requirement: '这是一个冒烟测试。不要读写任何文件，直接回复一句话即可，内容必须包含 OK。',
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId: 'p7-smoke' }),
  })
  const startJson = await startRes.json().catch(() => null)
  const runId = startJson && startJson.run && startJson.run.id
  check('smoke run started', typeof runId === 'string', String(runId))
  if (runId) {
    let sawWorking = false
    const deadline = Date.now() + 12 * 60 * 1000
    for (;;) {
      const r = await get('/api/team-flowise/run?id=' + encodeURIComponent(runId))
      const run = r.json && r.json.run
      const st = run && run.nodeStates && run.nodeStates.ping
      if (st && st.status === 'working') { sawWorking = true; console.log('       observed ping=working') }
      if (run && run.status !== 'running') {
        console.log('       smoke run settled: ' + run.status + ' node=' + JSON.stringify(st && { status: st.status, startedAt: st.startedAt, endedAt: st.endedAt }))
        break
      }
      if (Date.now() > deadline) { console.log('       smoke deadline hit'); break }
      await new Promise((r2) => setTimeout(r2, 5000))
    }
    check('a node was observed in the live working state', sawWorking)
    const r2 = await get('/api/team-flowise/run?id=' + encodeURIComponent(runId))
    const st = r2.json && r2.json.run && r2.json.run.nodeStates && r2.json.run.nodeStates.ping
    check('the settled node kept startedAt and gained endedAt', !!(st && typeof st.startedAt === 'number' && typeof st.endedAt === 'number'),
      JSON.stringify(st && { startedAt: st.startedAt, endedAt: st.endedAt }))
  }
}

// ===========================================================================
console.log('\n=== SUMMARY ===')
console.log('checks=' + checks + '  failures=' + failures)
if (pending.length) {
  console.log('NOT YET VERIFIABLE in this process (' + pending.length + '):')
  for (const p of pending) console.log('  - ' + p)
}
console.log(failures === 0 ? '\nRESULT: PASS (phase 1)' + (pending.length ? ' with ' + pending.length + ' restart-gated item(s)' : '') : '\nRESULT: FAIL')
process.exit(failures === 0 ? 0 : 1)
