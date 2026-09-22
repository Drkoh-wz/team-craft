// P16 live A/B: does inheriting the conversation actually show up in the tokens?
//
// The unit suite proves the plumbing. This one answers the only question that
// matters for the feature's cost: when a worker starts from the parent log's
// completed turns, what does it do to the child's measured token usage -- and does
// the provider's KV cache take the inherited prefix, or is it billed as fresh
// input?
//
// The design is one workflow, two runs, ONE difference:
//
//   ON  : POST /run/start { workflowId }                        -- nodes inherit
//   OFF : POST /run/start { workflowId, inheritContext:'none' } -- run-level kill
//         switch, which also makes the plugin record the usage of a NON-inheriting
//         child (it is the "asked and switched off" case), so both arms are
//         measurable on the same code path.
//
// Both arms use the same role, the same nodes and the same prompts, and the role
// declares NO model route on purpose: a child with no declared route inherits the
// parent's, which is the best case for prefix reuse. Whatever the difference is,
// it is the feature's difference.
//
// It asserts the direction that must hold no matter how the provider bills it: if
// the child really received inherited history, that prefix has to show up
// SOMEWHERE -- either as more input tokens or as cache reads. Nothing is asserted
// about which of the two, because that is exactly what we are here to find out.
//
// Usage:
//   node validation/p16-live-context.mjs
//   TF_ORIGIN=http://127.0.0.1:3080 node validation/p16-live-context.mjs
//
// Exit code: 0 = checks passed (or no host running -> SKIP), 1 = at least one failed.

const ORIGIN = (process.env.TF_ORIGIN && process.env.TF_ORIGIN.trim() !== '' ? process.env.TF_ORIGIN.trim() : 'http://127.0.0.1:3080').replace(/\/+$/, '')
const ROLE = 'p16-ab-role'
const WF = 'p16-ab-context'
const POLL_MS = 2000
const BUDGET_MS = 300000

let checks = 0
let failures = 0
const failedLabels = []
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  failedLabels.push(label)
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
function skip(label, detail) { console.log('  ...  ' + label + (detail ? '  -> ' + detail : '')) }
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  console.log('target: ' + ORIGIN)
  if (failedLabels.length > 0) { console.log('failed checks:'); for (const l of failedLabels) console.log('  - ' + l) }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { check('未捕获异常', false, String(e && e.stack ? e.stack.split('\n')[0] : e)); summary(); process.exit(1) })

const api = {
  async get(p) { const r = await fetch(ORIGIN + p); return { status: r.status, body: await r.json() } },
  async post(p, body) {
    const r = await fetch(ORIGIN + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const t = await r.text()
    let j = null
    try { j = JSON.parse(t) } catch { /* keep text */ }
    return { status: r.status, body: j === null ? t : j }
  },
  async del(p) { const r = await fetch(ORIGIN + p, { method: 'DELETE' }); return { status: r.status, text: await r.text() } },
}
const listOf = (x, k) => (Array.isArray(x) ? x : (x && x[k]) || [])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TERMINAL = ['completed', 'failed', 'halted', 'interrupted']

/** A deferral that must still run the teardown -- see the pre-P16 branch below. */
class Deferred extends Error {}

console.log('=== P16 live A/B: inherited context vs a fresh child ===')
console.log('target: ' + ORIGIN)
try {
  const ping = await api.get('/api/team-flowise/ping')
  if (ping.status !== 200) throw new Error('HTTP ' + ping.status)
} catch (e) {
  skip('no reachable dsh at ' + ORIGIN + ' (' + (e && e.message ? e.message : e) + ') -- live A/B is SKIPPED')
  console.log('\n=== SUMMARY ===\nchecks=0  failures=0\nRESULT: PASS (skipped: no running host)')
  process.exit(0)
}

const REQUIREMENT = 'Reply with exactly one word: ok'
const ROLE_DEF = {
  id: ROLE, name: ROLE,
  role: 'P16 token A/B probe role',
  // A stable persona is required (a worker always gets one) and it is identical in
  // both arms, so it cannot explain a difference between them.
  systemPrompt: 'You are a probe. Answer with the single word the task asks for and nothing else.',
  tools: { preset: 'read-only' },
  timeoutMs: 300000,
}
const node = (id) => ({ id, title: 'AB 探针 ' + id, agent: ROLE, dependsOn: [], taskTemplate: { requirement: REQUIREMENT, acceptanceCriteria: 'the reply is the requested word' } })
const WF_DEF = {
  id: WF, name: 'P16 A/B: inherited context',
  description: 'Two identical independent nodes. Run once with workflow-level inheritance and once with the run-level kill switch.',
  inheritContext: 'session',
  nodes: { a: node('a'), b: node('b') },
}

async function startAndWait(opts) {
  const started = await api.post('/api/team-flowise/run/start', Object.assign({ workflowId: WF }, opts || {}))
  const runId = started.body && started.body.run && started.body.run.id
  if (!runId) throw new Error('run did not start: ' + JSON.stringify(started.body).slice(0, 200))
  const t0 = Date.now()
  let rec = null
  while (Date.now() - t0 < BUDGET_MS) {
    await sleep(POLL_MS)
    const runs = listOf((await api.get('/api/team-flowise/runs')).body, 'runs')
    rec = runs.filter((r) => r.id === runId)[0] || null
    if (rec && TERMINAL.includes(rec.status)) break
  }
  if (rec === null) throw new Error('run ' + runId + ' did not settle within ' + BUDGET_MS + 'ms')
  return { runId, rec, seconds: (Date.now() - t0) / 1000 }
}

const arm = (rec) => Object.keys(rec.nodeStates || {}).sort().map((nid) => {
  const st = rec.nodeStates[nid]
  const c = st.context || null
  return {
    nid,
    status: st.status,
    effective: c ? c.effective : null,
    requested: c ? c.requested : null,
    overridden: c && c.overridden ? c.overridden.map((o) => o.source).join(',') : '',
    provider: c ? c.provider : null,
    seeded: c && typeof c.seeded === 'number' ? c.seeded : (c ? null : undefined),
    routeChanged: c ? c.routeChanged : null,
    usage: c ? c.usage : null,
  }
})
const totals = (rows) => rows.reduce((acc, r) => {
  if (r.usage === null || r.usage === undefined) return acc
  acc.inputTokens += r.usage.inputTokens || 0
  acc.outputTokens += r.usage.outputTokens || 0
  acc.cacheReadTokens += r.usage.cacheReadTokens || 0
  acc.cacheWriteTokens += r.usage.cacheWriteTokens || 0
  acc.requests += r.usage.requests || 0
  acc.measured += 1
  return acc
}, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, measured: 0 })

let created = false
try {
  console.log('\n--- setup: one probe role + one workflow (removed again at the end) ---')
  const a = await api.post('/api/team-flowise/agent', ROLE_DEF)
  const w = await api.post('/api/team-flowise/workflow', WF_DEF)
  created = true
  check('probe role + workflow created', a.status === 200 && w.status === 200, 'HTTP ' + a.status + '/' + w.status)
  const flows = listOf((await api.get('/api/team-flowise/workflows')).body, 'workflows')
  const mine = flows.filter((f) => f.id === WF)[0]
  // A running process that predates P16 strips the field on write, and no amount of
  // retrying will change that: the host half is assembled at startup. That is a
  // DEFERRAL (restart required), not a failure of the feature -- and it must not be
  // confused with "the field stored fine but inheritance did not happen", which IS
  // a failure and is checked further down.
  const supportsInherit = mine !== undefined && (mine.inheritContext === 'session' || mine.inheritContext === 'none' || mine.inheritContext === true || mine.inheritContext === false)
  if (!supportsInherit) {
    // Thrown, not exited: the teardown below still has to run, and calling
    // process.exit() from inside this try left libuv sockets half-closed on Windows
    // (an assertion in async.c, exit code 1) -- a deferral must not look like a crash.
    skip('the running dsh predates P16 (it did not store inheritContext on the workflow record) -- RESTART REQUIRED, live A/B deferred')
    throw new Deferred()
  }
  check('the workflow record kept inheritContext=session (declared => stored)',
    mine.inheritContext === 'session', JSON.stringify(mine.inheritContext))

  console.log('\n--- ARM ON: nodes inherit the conversation ---')
  const on = await startAndWait({})
  const onRows = arm(on.rec)
  console.log('  run ' + on.runId + '  status=' + on.rec.status + '  (' + on.seconds.toFixed(1) + 's)')
  const onLive = onRows.filter((r) => r.effective === 'session')
  if (onLive.length === 0) {
    skip('this deployment reported effective=none for every node -- there is no fork backend to A/B against')
    console.log('  context records: ' + JSON.stringify(onRows.map((r) => ({ nid: r.nid, effective: r.effective, reason: r.provider }))))
  }
  check('A1 both nodes completed in the ON arm', onRows.length === 2 && onRows.every((r) => r.status === 'completed'),
    JSON.stringify(onRows.map((r) => r.nid + ':' + r.status)))
  check('A2 every ON-arm node records the inheritance decision', onRows.every((r) => r.requested === 'session'), JSON.stringify(onRows.map((r) => r.requested)))
  if (onLive.length > 0) {
    check('A3 a provider advertising inheritsParentContext was found and used', onRows.every((r) => r.effective === 'session'),
      JSON.stringify(onRows.map((r) => r.provider)))
    const seeded = onRows.map((r) => r.seeded)
    check('A4 the child reports HOW MUCH it inherited (seeded events), so "no cache hit" is distinguishable from "nothing was inherited"',
      seeded.every((s) => typeof s === 'number' && s >= 0), JSON.stringify(seeded))
  }

  console.log('\n--- ARM OFF: same workflow, run-level kill switch ---')
  const off = await startAndWait({ inheritContext: 'none' })
  const offRows = arm(off.rec)
  console.log('  run ' + off.runId + '  status=' + off.rec.status + '  (' + off.seconds.toFixed(1) + 's)')
  check('B1 both nodes completed in the OFF arm', offRows.length === 2 && offRows.every((r) => r.status === 'completed'),
    JSON.stringify(offRows.map((r) => r.nid + ':' + r.status)))
  check('B2 [杀开关] every OFF-arm node records requested=none and effective=none', offRows.every((r) => r.requested === 'none' && r.effective === 'none'),
    JSON.stringify(offRows.map((r) => r.requested + '/' + r.effective)))
  check('B3 [可审计] the record names the layer that was overridden (workflow asked, the run refused)',
    offRows.every((r) => r.overridden === 'workflow'), JSON.stringify(offRows.map((r) => r.overridden)))

  const tOn = totals(onRows)
  const tOff = totals(offRows)
  console.log('\n--- measured usage (this is the answer, not an estimate) ---')
  const fmt = (t) => 'requests=' + t.requests + ' input=' + t.inputTokens + ' cacheRead=' + t.cacheReadTokens + ' cacheWrite=' + t.cacheWriteTokens + ' output=' + t.outputTokens + ' (measured nodes=' + t.measured + '/2)'
  console.log('  ON  ' + fmt(tOn))
  console.log('  OFF ' + fmt(tOff))
  console.log('  per node:')
  for (const r of onRows) console.log('    ON  ' + r.nid + ' seeded=' + JSON.stringify(r.seeded) + ' routeChanged=' + r.routeChanged + ' usage=' + JSON.stringify(r.usage))
  for (const r of offRows) console.log('    OFF ' + r.nid + ' seeded=' + JSON.stringify(r.seeded) + ' routeChanged=' + r.routeChanged + ' usage=' + JSON.stringify(r.usage))

  check('C1 both arms produced a measurable child (an unreadable session would leave usage null and make this A/B meaningless)',
    tOn.measured === 2 && tOff.measured === 2, 'measured ON=' + tOn.measured + ' OFF=' + tOff.measured)

  if (onLive.length > 0 && tOn.measured === 2 && tOff.measured === 2) {
    const inheritedAnything = onRows.some((r) => typeof r.seeded === 'number' && r.seeded > 0)
    const extraInput = tOn.inputTokens > tOff.inputTokens
    const cacheWorked = tOn.cacheReadTokens > 0
    check('C2 [方向性断言] 如果子代理真的继承了历史，它必须体现在某处：要么 input 变多，要么 cacheRead>0',
      !inheritedAnything || extraInput || cacheWorked,
      JSON.stringify({ inheritedAnything, extraInput, cacheWorked, onInput: tOn.inputTokens, offInput: tOff.inputTokens, onCacheRead: tOn.cacheReadTokens }))
    if (!inheritedAnything) {
      skip('the fork seeded 0 events in this deployment (no completed turn to inherit from, or the parent log was empty) -- the token comparison is therefore between two fresh children')
    } else if (cacheWorked) {
      skip('cache reads were reported, so part of the inherited prefix was reused: ON cacheRead=' + tOn.cacheReadTokens + ' hitRate=' + (tOn.cacheReadTokens + tOn.inputTokens > 0 ? (tOn.cacheReadTokens / (tOn.cacheReadTokens + tOn.inputTokens)).toFixed(3) : 'n/a'))
    } else {
      skip('no cache reads were reported: in this deployment the inherited prefix is billed as fresh input (ON input=' + tOn.inputTokens + ' vs OFF input=' + tOff.inputTokens + ')')
    }
  }
} catch (e) {
  if (e instanceof Deferred) {
    skip('live A/B deferred until the restart -- nothing was measured, so nothing is claimed')
  } else {
    check('live A/B 执行完成', false, String(e && e.message ? e.message : e))
  }
} finally {
  console.log('\n--- teardown ---')
  if (created) {
    const d1 = await api.del('/api/team-flowise/workflow?id=' + encodeURIComponent(WF)).catch(() => ({ status: -1 }))
    const d2 = await api.del('/api/team-flowise/agent?id=' + encodeURIComponent(ROLE)).catch(() => ({ status: -1 }))
    check('probe workflow + role removed again', d1.status === 200 && d2.status === 200, 'HTTP ' + d1.status + '/' + d2.status)
  }
}

// `process.exitCode` instead of `process.exit()`: calling exit() while undici's
// keep-alive socket to 127.0.0.1 is still closing aborts the process on Windows
// (libuv assertion in async.c), which would report a deferral as a crash. Nothing
// here keeps the loop alive, so the process ends by itself with this code.
process.exitCode = summary() === 0 ? 0 : 1
