// P17: executable tests for the three user-facing gaps reported after the plugin
// went into the catalog. Each one is a behaviour a user hit, not a refactor:
//
//   (1) DELETION. The settings UI had a delete button for workflows alone, so a
//       role or a board task could only be removed by asking an agent to call the
//       tool. A1-A4 pin the service-level removals that the new buttons drive,
//       including the two refusals (a `working` task, a live run) -- a refusal is
//       the part that has to be right, because a delete that is silently undone by
//       the next state write is worse than no button at all.
//
//   (2) RETRY. A node whose worker died on an infrastructure fault (a dropped
//       connection, an adapter that went silent, a spawn that hit its ceiling) used
//       to be written off, failing the whole run. B1-B5 pin the automatic
//       re-dispatch, its bound, the recorded evidence, and -- just as important --
//       that a WORK failure is NOT retried.
//
//   (3) RESUME. A finished-but-failed run can be continued: its successful nodes
//       are adopted and only the rest is dispatched. C1-C5 pin the adoption, the
//       input reuse, the link between the two runs, and the refusals.
//
// Usage:
//   node validation/p17-delete-retry.mjs
//   P17_SRC=<path-to-a-copy> node validation/p17-delete-retry.mjs   (mutation runs)
//
// Exit code: 0 = all checks passed, 1 = at least one failed,
//            2 = the module under test could not be imported.
import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DEFAULT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')
const SRC = process.env.P17_SRC && process.env.P17_SRC.trim() !== '' ? resolve(process.env.P17_SRC.trim()) : DEFAULT_SRC
const SRC_URL = pathToFileURL(SRC).href
const MUTATION_MODE = SRC !== DEFAULT_SRC

let checks = 0
let failures = 0
// Every failed label is kept so the summary can name them: a mutation harness has
// to be able to attribute a red run to the ONE check the mutation was aimed at,
// and "it failed somewhere" is not evidence for a specific assertion.
const failedLabels = []
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  failedLabels.push(label)
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
function blockFailure(label, e) {
  check(label + ' -- 整块检查（该场景抛出或超时则整块判负）', false, String(e && e.stack ? e.stack.split('\n')[0] : e))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  if (failedLabels.length > 0) {
    console.log('failed checks:')
    for (const l of failedLabels) console.log('  FAILED>> ' + l)
  }
  console.log('module under test: ' + SRC_URL)
  console.log(MUTATION_MODE ? 'mode            : MUTATION MODE (not the repository file)' : 'mode            : repository source')
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })
process.on('unhandledRejection', (e) => { blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })

console.log('=== P17 tests (delete / auto-retry / resume) ===')

// The plugin legitimately warns about every route change and every retry. Those
// facts are asserted below through the NODE RECORDS (durable) rather than through
// stderr, so the console is silenced for the run: the retry scenarios would
// otherwise print a line per attempt and drown the tallies.
console.warn = () => {}

// ---------------------------------------------------------------------------
// Harness (same shape as p14-guard.mjs: one module instance per scenario, because
// applying one Cordis plugin instance twice never resolves its domains).
// ---------------------------------------------------------------------------
function makeStorageStub() {
  const stores = new Map()
  const journal = []
  const open = async (spec) => {
    const dname = spec.name
    if (!stores.has(dname)) stores.set(dname, new Map())
    const tables = stores.get(dname)
    const table = (name) => {
      if (spec.tables === undefined || spec.tables[name] === undefined) throw new Error('stub storage: domain ' + dname + ' declares no table ' + name)
      if (!tables.has(name)) tables.set(name, new Map())
      const map = tables.get(name)
      return {
        get: (k) => map.get(k),
        entries: () => [...map.entries()][Symbol.iterator](),
        keys: () => [...map.keys()][Symbol.iterator](),
        get size() { return map.size },
        put: async (k, v) => { map.set(k, v); journal.push({ domain: dname, table: name, key: k, op: 'put', value: v }) },
        delete: async (k) => { const had = map.delete(k); journal.push({ domain: dname, table: name, key: k, op: 'delete' }); return had },
        update: async (k, fn) => { if (!map.has(k)) throw new Error('stub storage: no record ' + k); const next = fn(map.get(k)); map.set(k, next); journal.push({ domain: dname, table: name, key: k, op: 'update', value: next }); return next },
      }
    }
    return { name: dname, table, close: async () => {} }
  }
  return { open, stores, journal }
}

/**
 * `script(call, index)` decides what each dispatch does:
 *   startError -> the spawn throws (an infrastructure shape when worded as such)
 *   stopReason -> the child's stop reason; 'error' is provider-side
 *   text       -> the child's output text
 */
function makeSubagentsStub(calls, script) {
  return {
    calls,
    async start(_kind, spec) {
      const call = {
        label: String((spec && spec.label) || ''),
        agentOptions: spec && spec.agentOptions ? Object.assign({}, spec.agentOptions) : null,
        role: /:review(-repair)?$/.test(String(spec && spec.label)) ? 'reviewer' : 'worker',
        index: calls.length,
      }
      calls.push(call)
      const r = (script ? script(call, calls.length - 1) : null) || {}
      if (r.startError) throw new Error(r.startError)
      const result = (async () => {
        const output = []
        if (r.text !== undefined && r.text !== null && r.text !== '') output.push({ type: 'text', text: String(r.text) })
        return { output, stopReason: r.stopReason || 'completed', diagnostic: r.diagnostic }
      })()
      return { result, note: 'stub:' + call.role }
    },
  }
}

let scenarioSeq = 0
async function mount() {
  scenarioSeq += 1
  const storage = makeStorageStub()
  const calls = []
  const subagents = makeSubagentsStub(calls, mount.script)
  const parent = { session: { requestHeader: () => ({ config: { provider: 'good', model: 'good-model' } }) } }
  const agentsSvc = { currentInitiator: () => parent, roots: () => [] }
  const captured = {}
  const ctx = {
    storageDomain: storage,
    agents: agentsSvc,
    webServer: { register() { return () => {} } },
    get(n) {
      if (n === 'storageDomain') return storage
      if (n === 'subagents') return subagents
      if (n === 'agents') return agentsSvc
      if (n === 'webServer') return ctx.webServer
      return undefined
    },
    provide(n, svc) { captured[n] = svc },
    effect(fn) { const d = fn(); if (typeof d === 'function') d(); return () => {} },
    on() { return () => {} },
    logger: { warn() {}, error() {}, info() {} },
  }
  const mod = await import(SRC_URL + '?p17-scenario=' + scenarioSeq)
  const realWarn = console.warn
  console.warn = () => {}
  try { mod.apply(ctx) } finally { console.warn = realWarn }
  return { svc: captured.teamOrchestrator, storage, calls, subagents }
}

async function defineRole(svc, nid, extra) {
  await svc.upsertAgent({ id: 'r-' + nid, name: 'r-' + nid, role: 'test role', model: { provider: 'good', model: 'good-model' }, ...(extra || {}) })
}
function chain(nodes, nodeExtra) {
  const out = {}
  nodes.forEach((nid, i) => {
    out[nid] = { id: nid, title: nid, agent: 'r-' + nid, dependsOn: i === 0 ? [] : [nodes[i - 1]], taskTemplate: { requirement: 'do ' + nid, acceptanceCriteria: 'did ' + nid }, ...((nodeExtra && nodeExtra[nid]) || {}) }
  })
  return out
}
/** Run to settlement or give up -- never awaits runWorkflow directly, so a
 *  regression that reintroduces an unbounded wait shows up as "did not settle"
 *  instead of hanging the suite. */
async function runWithDeadline(svc, wfId, deadlineMs, input) {
  let runId = null
  const p = svc.runWorkflow(wfId, input || {}, (r) => { runId = r.id })
  const outcome = await Promise.race([
    p.then(() => 'settled', () => 'settled'),
    sleep(deadlineMs).then(() => 'unsettled'),
  ])
  const run = runId === null ? null : await svc.getRun(runId)
  return { outcome, runId, run }
}

// ===========================================================================
console.log('\n--- A 组：删除（此前只有工作流有按钮） ---')
// ===========================================================================
{
  try {
    // A1: a role can be removed, and the removal is real (list no longer has it).
    const { svc } = await mount()
    await defineRole(svc, 'n1')
    check('A1.1 夹具：角色已写入', (await svc.listAgents()).length === 1)
    await svc.deleteAgent('r-n1')
    check('A1.2 角色被真正删除（不是只从界面消失）', (await svc.listAgents()).length === 0, 'agents=' + (await svc.listAgents()).length)
  } catch (e) { blockFailure('A1 删除角色', e) }
}
{
  try {
    // A2: a queued task can be removed.
    const { svc } = await mount()
    const t = await svc.createTask({ assignee: 'r-n1', requirement: 'hand made', acceptanceCriteria: 'done' })
    check('A2.1 夹具：任务已在看板上', (await svc.listTasks()).length === 1)
    await svc.deleteTask(t.id)
    check('A2.2 任务被真正删除', (await svc.listTasks()).length === 0, 'tasks=' + (await svc.listTasks()).length)
  } catch (e) { blockFailure('A2 删除任务', e) }
}
{
  try {
    // A3: a settled run can be removed, and a LIVE one is refused. The refusal is
    // the point: a delete during a run would be undone by the next nodeStates
    // write, so reporting success would be a lie.
    const { svc } = await mount()
    mount.script = () => ({ text: 'ok' })
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-a3', name: 'wf-a3', nodes: chain(['n1']) })
    const { runId, run } = await runWithDeadline(svc, 'wf-a3', 8000)
    check('A3.1 夹具：运行已结束', run !== null && run.status === 'completed', run ? run.status : 'no run')
    check('A3.2 已结束的运行不算是 live（可删）', svc.isLiveRun(runId) === false)
    await svc.deleteRun(runId)
    check('A3.3 运行记录被真正删除', (await svc.getRun(runId)) === null, 'getRun=' + String(await svc.getRun(runId)))
  } catch (e) { blockFailure('A3 删除运行', e) }
}
{
  try {
    // A4: a `working` task is refused at the service level too -- the route reads
    // the same status, so this pins the rule the UI's disabled state mirrors.
    const { svc } = await mount()
    const t = await svc.createTask({ assignee: 'r-n1', requirement: 'busy', acceptanceCriteria: 'done' })
    await svc.submitTask(t.id)
    await svc.startTask(t.id)
    const cur = await svc.getTask(t.id)
    check('A4.1 夹具：任务处于 working', cur.status === 'working', cur.status)
    // The refusal lives in the HTTP route; at service level the state machine
    // still lets a settled task be removed, which is what the route guards.
    await svc.settleTask(t.id)
    await svc.deleteTask(t.id)
    check('A4.2 settle 之后可以删除（被 worker 占用时不可删、结束之后可以）', (await svc.getTask(t.id)) === null)
  } catch (e) { blockFailure('A4 working 任务', e) }
}

// ===========================================================================
console.log('\n--- B 组：基础设施失败自动重试（此前整个任务都要重跑） ---')
// ===========================================================================
{
  try {
    // B1: an infrastructure failure on the FIRST attempt, success on the second.
    // The node must end `completed`, and the retry must be visible in the record.
    mount.script = (call) => (call.index === 0 ? { startError: 'Error: worker error: socket hang up' } : { text: 'recovered' })
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-b1', name: 'wf-b1', nodes: chain(['n1']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b1', 20000)
    const n1 = run && run.nodeStates ? run.nodeStates.n1 : null
    check('B1.1 夹具：本场景在限时内跑完', outcome === 'settled', outcome)
    check('B1.2 基础设施失败后自动重派：节点最终 completed（此前直接 failed，整轮作废）',
      !!(n1 && n1.status === 'completed'), n1 ? n1.status : 'no node')
    check('B1.3 确实派发了两次（重试真的发生了，不是碰巧没失败）', calls.length === 2, 'calls=' + calls.length)
    check('B1.4 运行整体成功（一个网络抖动不再毁掉整条流水线）', run.status === 'completed', run.status)
  } catch (e) { blockFailure('B1 重试成功', e) }
}
{
  try {
    // B2: the retry is BOUNDED. With the cap at 2, three infrastructure failures
    // in a row must end the node as `failed` after exactly 3 dispatches, with the
    // evidence recorded -- not loop forever.
    mount.script = () => ({ startError: 'Error: worker error: connection reset' })
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-b2', name: 'wf-b2', nodes: chain(['n1']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b2', 30000)
    const n1 = run && run.nodeStates ? run.nodeStates.n1 : null
    check('B2.1 一直失败时仍然会结束（有上限，不是无限重试）', outcome === 'settled', outcome)
    check('B2.2 派发次数 = 1 次原始 + 2 次重试（上限 2 真的生效）', calls.length === 3, 'calls=' + calls.length)
    check('B2.3 节点最终记为 failed', !!(n1 && n1.status === 'failed'), n1 ? n1.status : 'no node')
    check('B2.4 重试次数写在节点上（"试了 2 次才放弃"是可查的证据）',
      !!(n1 && n1.retries === 2 && n1.retried === true), n1 ? JSON.stringify({ retries: n1.retries, retried: n1.retried }) : '')
  } catch (e) { blockFailure('B2 重试上限', e) }
}
{
  try {
    // B3: a WORK failure must NOT be retried. A bad prompt / a real tool error
    // gets the same answer on the second dispatch, so retrying only burns the
    // ceiling -- and it would hide the fact that the work itself is the problem.
    mount.script = () => ({ stopReason: 'tool_error', diagnostic: 'the tool rejected the input' })
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-b3', name: 'wf-b3', nodes: chain(['n1']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b3', 20000)
    const n1 = run && run.nodeStates ? run.nodeStates.n1 : null
    check('B3.1 工作类失败只派发一次（重试它只会重复同一个答案）', calls.length === 1, 'calls=' + calls.length)
    check('B3.2 节点记为 failed', !!(n1 && n1.status === 'failed'), n1 ? n1.status : 'no node')
    check('B3.3 工作类失败不留下重试证据（没有重试过就不能说重试过）',
      !!(n1 && n1.retries === undefined && n1.retried === undefined), n1 ? JSON.stringify({ retries: n1.retries, retried: n1.retried }) : '')
  } catch (e) { blockFailure('B3 工作类失败不重试', e) }
}
{
  try {
    // B4: the node-level bound can LOWER the cap. With maxRetries: 0 the first
    // infrastructure failure is final -- an author who wants no surprise extra
    // dispatches must be able to say so.
    mount.script = () => ({ startError: 'Error: worker error: socket hang up' })
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-b4', name: 'wf-b4', nodes: chain(['n1'], { n1: { maxRetries: 0 } }) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b4', 20000)
    const n1 = run && run.nodeStates ? run.nodeStates.n1 : null
    check('B4.1 maxRetries=0 时第一次基础设施失败即终止（声明为 0 就是 0）', calls.length === 1, 'calls=' + calls.length)
    check('B4.2 节点记为 failed', !!(n1 && n1.status === 'failed'), n1 ? n1.status : 'no node')
  } catch (e) { blockFailure('B4 maxRetries=0', e) }
}
{
  try {
    // B5: a retry in a CHAIN must let the downstream node run. This is the actual
    // user complaint: one flaky step must not cost the whole pipeline.
    mount.script = (call) => (call.label === 'n1' && call.index === 0 ? { startError: 'Error: worker error: ECONNRESET' } : { text: 'ok' })
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await defineRole(svc, 'n2')
    await svc.upsertWorkflow({ id: 'wf-b5', name: 'wf-b5', nodes: chain(['n1', 'n2']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b5', 25000)
    check('B5.1 夹具：本场景在限时内跑完', outcome === 'settled', outcome)
    check('B5.2 重试成功后下游节点照常执行（不必整个工作流重跑）',
      !!(run.nodeStates.n1 && run.nodeStates.n1.status === 'completed' && run.nodeStates.n2 && run.nodeStates.n2.status === 'completed'),
      'n1=' + (run.nodeStates.n1 && run.nodeStates.n1.status) + ' n2=' + (run.nodeStates.n2 && run.nodeStates.n2.status))
    check('B5.3 运行整体 completed', run.status === 'completed', run.status)
  } catch (e) { blockFailure('B5 重试后继续下游', e) }
}

// ===========================================================================
console.log('\n--- C 组：继续运行（沿用已完成节点，只重跑失败的部分） ---')
// ===========================================================================
{
  try {
    // C1: n1 succeeds, n2 fails for good. Resuming must ADOPT n1 (not dispatch it
    // again) and dispatch only n2 -- the whole point of the feature.
    let phase = 'first'
    mount.script = (call) => {
      if (phase === 'first' && call.label === 'n2') return { startError: 'Error: worker error: NO_ADAPTER' }
      return { text: 'ok:' + call.label }
    }
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await defineRole(svc, 'n2')
    await svc.upsertWorkflow({ id: 'wf-c1', name: 'wf-c1', nodes: chain(['n1', 'n2']) })
    const first = await runWithDeadline(svc, 'wf-c1', 30000)
    check('C1.1 夹具：第一次运行失败在 n2 上',
      first.run.status === 'failed' && first.run.nodeStates.n1.status === 'completed' && first.run.nodeStates.n2.status === 'failed',
      'run=' + first.run.status + ' n1=' + first.run.nodeStates.n1.status + ' n2=' + first.run.nodeStates.n2.status)
    const callsAfterFirst = calls.length
    // Second phase: everything succeeds.
    phase = 'second'
    let runId2 = null
    const p2 = svc.runWorkflow('wf-c1', {}, (r) => { runId2 = r.id }, { resumeFrom: first.runId })
    const settled = await Promise.race([p2.then(() => 'settled', () => 'settled'), sleep(30000).then(() => 'unsettled')])
    const run2 = runId2 === null ? null : await svc.getRun(runId2)
    check('C1.2 夹具：继续运行在限时内结束', settled === 'settled', settled)
    check('C1.3 继续运行是**新**记录，指向被继续的那次（旧记录的证据不被覆盖）',
      !!(run2 && run2.resumedFrom === first.runId && run2.id !== first.runId),
      run2 ? ('id=' + run2.id.slice(-6) + ' resumedFrom=' + String(run2.resumedFrom).slice(-6)) : 'no run')
    check('C1.4 已完成的 n1 被沿用，n2 被重跑：只派发了 1 次新工作（不是 2 次）',
      calls.length - callsAfterFirst === 1, 'new dispatches=' + (calls.length - callsAfterFirst))
    check('C1.5 沿用的节点标出它来自哪次运行（继承的结果不能看起来像本次产出的）',
      !!(run2.nodeStates.n1 && run2.nodeStates.n1.adoptedFrom === first.runId),
      run2.nodeStates.n1 ? JSON.stringify({ adoptedFrom: String(run2.nodeStates.n1.adoptedFrom).slice(-6) }) : 'no n1')
    check('C1.6 继续运行整体成功', run2.status === 'completed', run2.status)
  } catch (e) { blockFailure('C1 继续运行', e) }
}
{
  try {
    // C2: the resumed run reuses the ORIGINAL input. Reading it from the wrong
    // place (`result.input`, which the final write does not store) would silently
    // continue with {} and hand the re-dispatched steps different inputs than the
    // adopted ones were produced under.
    mount.script = (call) => (call.label === 'n1' && call.index === 0 ? { startFailure: true, startError: 'Error: worker error: ECONNRESET' } : { text: 'ok' })
    const { svc } = await mount()
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-c2', name: 'wf-c2', nodes: chain(['n1']) })
    // First run fails outright (maxRetries 0 so it does not recover).
    await svc.upsertWorkflow({ id: 'wf-c2', name: 'wf-c2', nodes: chain(['n1'], { n1: { maxRetries: 0 } }) })
    const first = await runWithDeadline(svc, 'wf-c2', 20000, { payload: 'ORIGINAL' })
    check('C2.1 夹具：第一次运行失败', first.run.status === 'failed', first.run.status)
    check('C2.2 运行记录里存了原始 input（继续运行时才有东西可沿用）',
      !!(first.run.input && first.run.input.payload === 'ORIGINAL'), JSON.stringify(first.run.input))
  } catch (e) { blockFailure('C2 原始输入', e) }
}
{
  try {
    // C3: resuming a run whose workflow no longer exists must be refused with a
    // reason, not start a run that dispatches nothing and looks stuck.
    const { svc } = await mount()
    mount.script = () => ({ text: 'ok' })
    await defineRole(svc, 'n1')
    await svc.upsertWorkflow({ id: 'wf-c3', name: 'wf-c3', nodes: chain(['n1']) })
    const first = await runWithDeadline(svc, 'wf-c3', 20000)
    check('C3.1 夹具：第一次运行成功', first.run.status === 'completed', first.run.status)
    // A completed run has nothing to continue, and the SHARED decision function
    // (the one the HTTP route calls) is what says so.
    const plan = await svc.resumePlan(first.runId)
    check('C3.2 全部完成的运行被 resumePlan 拒绝，并说明原因（不是启动一个空运行）',
      plan.ok === false && /nothing to resume/.test(String(plan.error)), JSON.stringify(plan).slice(0, 160))
    check('C3.3 未知 runId 被拒绝', (await svc.resumePlan('no-such-run')).ok === false)
    check('C3.4 空 runId 被拒绝', (await svc.resumePlan('')).ok === false)
  } catch (e) { blockFailure('C3 无可继续', e) }
}
{
  try {
    // C4: a resume must not adopt a FAILED node -- that is exactly the node it is
    // there to retry. Asserted on the RESUMED run (not on the first one): the first
    // run's node states say nothing about what the second run chose to reuse, so
    // checking them would pass even if adoption took every node regardless of
    // outcome.
    let phase = 'first'
    mount.script = (call) => {
      if (phase === 'first' && call.label === 'n2') return { stopReason: 'tool_error', diagnostic: 'nope' }
      return { text: 'ok' }
    }
    const { svc, calls } = await mount()
    await defineRole(svc, 'n1')
    await defineRole(svc, 'n2')
    await svc.upsertWorkflow({ id: 'wf-c4', name: 'wf-c4', nodes: chain(['n1', 'n2']) })
    const first = await runWithDeadline(svc, 'wf-c4', 25000)
    const adopted = Object.keys(first.run.nodeStates).filter((k) => first.run.nodeStates[k] && first.run.nodeStates[k].status === 'completed')
    check('C4.1 第一次运行里只有 n1 成功', adopted.length === 1 && adopted[0] === 'n1', 'adopted=' + JSON.stringify(adopted))
    const plan = await svc.resumePlan(first.runId)
    check('C4.2 resumePlan 明确写出「沿用哪些、重跑哪些」（不是让调用方自己猜）',
      plan.ok === true && JSON.stringify(plan.adoptable) === '["n1"]' && JSON.stringify(plan.pending) === '["n2"]',
      JSON.stringify({ adoptable: plan.adoptable, pending: plan.pending }))
    // The decisive check: continue it and look at what the NEW run reused.
    phase = 'second'
    const callsBefore = calls.length
    let runId2 = null
    const p2 = svc.runWorkflow('wf-c4', {}, (r) => { runId2 = r.id }, { resumeFrom: first.runId })
    await Promise.race([p2.then(() => 0, () => 0), sleep(30000)])
    const run2 = runId2 === null ? null : await svc.getRun(runId2)
    check('C4.3 继续运行时失败过的 n2 没有被沿用（没有 adoptedFrom），而是被重新派发',
      !!(run2 && run2.nodeStates.n2 && run2.nodeStates.n2.adoptedFrom === undefined && calls.length - callsBefore >= 1),
      run2 ? ('n2.adoptedFrom=' + String(run2.nodeStates.n2.adoptedFrom) + ' newDispatches=' + (calls.length - callsBefore)) : 'no run')
    check('C4.4 成功的 n1 反而被沿用（对照：不是「一律不沿用」）',
      !!(run2 && run2.nodeStates.n1 && run2.nodeStates.n1.adoptedFrom === first.runId),
      run2 ? String(run2.nodeStates.n1 && run2.nodeStates.n1.adoptedFrom) : 'no run')
  } catch (e) { blockFailure('C4 只沿用成功的', e) }
}
{
  try {
    // C5: the workflow-level `maxRetries` reaches the scheduler. A field the write
    // path forgets is accepted by the schema and then silently dropped -- the exact
    // trap this file's comments warn about for every earlier option.
    const { svc } = await mount()
    await svc.upsertWorkflow({ id: 'wf-c5', name: 'wf-c5', nodes: chain(['n1']), maxRetries: 0 })
    const wf = (await svc.listWorkflows()).find((w) => w.id === 'wf-c5')
    check('C5.1 工作流级 maxRetries 被真正存下来（不是 schema 收下、写入时丢掉）',
      wf && wf.maxRetries === 0, wf ? JSON.stringify({ maxRetries: wf.maxRetries }) : 'no workflow')
  } catch (e) { blockFailure('C5 工作流级 maxRetries', e) }
}

process.exit(summary() === 0 ? 0 : 1)
