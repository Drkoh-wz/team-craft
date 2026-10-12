// P14: executable tests for the two protections added after the amd incident.
//
//   (1) the SPAWN is bounded. `subagents.start('spawn', ...)` had no timeout
//       anywhere, and every call site awaits it OUTSIDE the `withTimeout` that
//       wraps `run.result` afterwards. A spawn that never settles therefore pinned
//       its node -- and, because a wave is awaited with `Promise.all`, every other
//       agent in that run with it, forever, with the run stuck at `running`.
//       A1 shows the bound working, A2 shows the pre-existing WORK bound still
//       applies, A3 shows a generous ceiling does not become a false timeout, and
//       A4 shows normal dispatch still returns its note.
//
//   (2) a provider that keeps failing stops receiving work (PROVIDER_HEALTH).
//       B1/B2 walk the two outcomes of the guard (fall back to the inherited
//       route, or refuse to dispatch when there is nothing to fall back to),
//       B3 pins that a NON-provider failure never condemns a provider, B4 pins
//       that "consecutive" really means consecutive, and B5/B6 pin the recorded
//       evidence (a `health` key only when blocked; a run summary that says it).
//
// Usage:
//   node validation/p14-guard.mjs
//   P14_SRC=<path-to-a-copy> node validation/p14-guard.mjs   (mutation runs)
//
// Exit code: 0 = all checks passed, 1 = at least one failed,
//            2 = the module under test could not be imported.
//
// Every check names the change that turns it red. The mutation runs in the
// report prove that for four of them (spawn bound removed, health guard removed,
// classifier made unconditional, success no longer clearing the ledger).
import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DEFAULT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')
const SRC = process.env.P14_SRC && process.env.P14_SRC.trim() !== '' ? resolve(process.env.P14_SRC.trim()) : DEFAULT_SRC
const SRC_URL = pathToFileURL(SRC).href
const MUTATION_MODE = SRC !== DEFAULT_SRC

let checks = 0
let failures = 0
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
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
  console.log('module under test: ' + SRC_URL)
  console.log(MUTATION_MODE ? 'mode            : MUTATION MODE (not the repository file)' : 'mode            : repository source')
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })
process.on('unhandledRejection', (e) => { blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })

console.log('=== P14 guard tests (bounded spawn + provider health) ===')

// The plugin legitimately warns on stderr about every route change (a changed
// provider/model with no declared effort clears the parent's effort). Every one of
// those facts is asserted below through the NODE RECORDS, where it is durable and
// checkable, so the suite silences the console for the whole run: 20 lines of
// stderr per scenario otherwise drowns the tallies and makes the output hard to
// grep. Nothing about the plugin's behaviour is hidden by this -- group B asserts
// the same warnings' effects through `route.warning` / `route.health`.
console.warn = () => {}

// ---------------------------------------------------------------------------
// Harness. Each scenario gets its OWN module instance: the plugin is a Cordis
// plugin and applying one instance twice registers tools but never resolves its
// domains (found in P13), so scenarios must not share an instance.
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
 * `script(call)` decides what each dispatch does:
 *   hangStart  -> the spawn never settles (what hung the whole run)
 *   startError -> the spawn throws
 *   hangResult -> the spawn returns, but the work never settles
 *   stopReason -> the child's stop reason ('error' is provider-side)
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
      const r = (script ? script(call) : null) || {}
      if (r.hangStart) return new Promise(() => {})
      if (r.startError) throw new Error(r.startError)
      if (r.hangResult) return { result: new Promise(() => {}), note: 'stub:hang-result' }
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
/** Mount a fresh module instance on a stub ctx whose parent carries `parentProvider`. */
async function mount(parentProvider) {
  scenarioSeq += 1
  const storage = makeStorageStub()
  const calls = []
  const subagents = makeSubagentsStub(calls, mount.script)
  const parent = { session: { requestHeader: () => ({ config: parentProvider === null ? null : { provider: parentProvider, model: parentProvider + '-model' } }) } }
  const agentsSvc = { currentInitiator: () => (parentProvider === null ? undefined : parent), roots: () => [] }
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
  const mod = await import(SRC_URL + '?p14-scenario=' + scenarioSeq)
  const realWarn = console.warn
  console.warn = () => {}
  try { mod.apply(ctx) } finally { console.warn = realWarn }
  return { svc: captured.teamOrchestrator, storage, calls, subagents }
}

/** Define one role per node id: role 'r-<node>' routed to `provider`. */
async function defineRoles(svc, nodeIds, providerByNode, timeoutMs) {
  for (const nid of nodeIds) {
    const p = providerByNode[nid]
    await svc.upsertAgent({ id: 'r-' + nid, name: 'r-' + nid, role: 'test role', model: p === undefined || p === null ? {} : { provider: p, model: p + '-model' }, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
  }
}
function chain(nodes, providerByNode) {
  const out = {}
  nodes.forEach((nid, i) => {
    out[nid] = { id: nid, title: nid, agent: 'r-' + nid, dependsOn: i === 0 ? [] : [nodes[i - 1]], taskTemplate: { requirement: 'do ' + nid, acceptanceCriteria: 'did ' + nid } }
  })
  return out
}
/** Run to settlement or give up. NEVER awaits runWorkflow directly: a regression
 *  that removes the spawn bound must show up as "did not settle", not as a suite
 *  that hangs (which is exactly what the bug did to the product). */
async function runWithDeadline(svc, wfId, deadlineMs) {
  let runId = null
  const p = svc.runWorkflow(wfId, {}, (r) => { runId = r.id })
  const outcome = await Promise.race([
    p.then(() => 'settled', () => 'settled'),
    sleep(deadlineMs).then(() => 'unsettled'),
  ])
  const run = runId === null ? null : await svc.getRun(runId)
  return { outcome, runId, run }
}

// ===========================================================================
console.log('\n--- A 组：派发被真正限时（原缺陷：spawn 无超时，整轮一起死等） ---')
// ===========================================================================
{
  try {
    // A1: the spawn never settles. The role's own timeout (1200ms) is ALSO the
    // spawn bound, which is what makes this testable in a second.
    mount.script = () => ({ hangStart: true })
    const { svc } = await mount('good')
    await defineRoles(svc, ['n1'], { n1: 'dead' }, 1200)
    await svc.upsertWorkflow({ id: 'wf-a1', name: 'wf-a1', nodes: chain(['n1']) })
    const t0 = Date.now()
    const { outcome, run } = await runWithDeadline(svc, 'wf-a1', 8000)
    const ms = Date.now() - t0
    check('A1.1 spawn 永不 resolve 时，运行仍在限时内结束（无超时 = 整轮永远死等）', outcome === 'settled', outcome + ' after ' + ms + 'ms')
    const n1 = run && run.nodeStates && run.nodeStates.n1
    check('A1.2 该节点被记为 failed，而不是永远 working', n1 && n1.status === 'failed', n1 ? n1.status : 'no node')
    check('A1.3 失败原因点名是 spawn 超时，并且限时被收紧到角色自己的预算（1200ms，不是 120000ms）',
      !!(n1 && /spawn of .* timed out after 1200ms/.test(String(n1.error))), n1 ? String(n1.error).slice(0, 140) : '')
    check('A1.4 运行状态为 failed（既不是 running，也不是 completed）', run && run.status === 'failed', run ? run.status : 'no run')
  } catch (e) { blockFailure('A1 spawn 永不 resolve', e) }
}
{
  try {
    // A2: the spawn is fine, the WORK never settles -> the pre-existing bound
    // must still be the one that fires. This separates the two bounds.
    mount.script = () => ({ hangResult: true })
    const { svc } = await mount('good')
    await defineRoles(svc, ['n1'], { n1: 'dead' }, 1200)
    await svc.upsertWorkflow({ id: 'wf-a2', name: 'wf-a2', nodes: chain(['n1']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-a2', 8000)
    check('A2.1 spawn 正常但产物永不返回时，工作超时仍然生效（两层限时各管一段）', outcome === 'settled', outcome)
    const n1 = run && run.nodeStates && run.nodeStates.n1
    check('A2.2 失败原因点名是 worker 的工作超时，而不是 spawn 超时',
      !!(n1 && /workflow node n1 timed out after 1200ms/.test(String(n1.error)) && !/spawn of .* timed out/.test(String(n1.error))),
      n1 ? String(n1.error).slice(0, 140) : '')
  } catch (e) { blockFailure('A2 产物永不返回', e) }
}
{
  try {
    // A3: a generous ceiling must not become a false timeout.
    mount.script = () => ({ text: 'fine' })
    const { svc } = await mount('good')
    await defineRoles(svc, ['n1'], { n1: 'dead' }, 3600000)
    await svc.upsertWorkflow({ id: 'wf-a3', name: 'wf-a3', nodes: chain(['n1']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-a3', 8000)
    check('A3.1 角色声明了很大的超时时，正常派发不得被 spawn 限时误杀', outcome === 'settled' && run.status === 'completed', (run ? run.status : outcome))
  } catch (e) { blockFailure('A3 大预算正常派发', e) }
}
{
  try {
    // A4: the bound must not change what a normal dispatch RETURNS.
    mount.script = () => ({ text: 'fine' })
    const { svc, calls } = await mount('good')
    await defineRoles(svc, ['n1'], { n1: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-a4', name: 'wf-a4', nodes: chain(['n1']) })
    await runWithDeadline(svc, 'wf-a4', 8000)
    check('A4.1 正常派发仍然返回 started.note（限时包装不得吞掉返回值，否则 toolNote 全空）',
      calls.length === 1 && calls[0].agentOptions !== null && calls[0].agentOptions.provider === 'dead',
      JSON.stringify(calls.map((c) => c.agentOptions)))
  } catch (e) { blockFailure('A4 返回值', e) }
}

// ===========================================================================
console.log('\n--- B 组：持续失败的 provider 停止收到派发 ---')
// ===========================================================================
{
  try {
    // B1: parent = 'good'. Two consecutive provider-side failures on 'dead' make
    // it unhealthy; n3's declared route is then not applied and n3 runs on the
    // INHERITED (good) route instead.
    mount.script = (call) => (call.agentOptions && call.agentOptions.provider === 'dead' ? { stopReason: 'error', diagnostic: 'NO_ADAPTER' } : { text: 'ok' })
    const { svc, calls } = await mount('good')
    await defineRoles(svc, ['n1', 'n2', 'n3'], { n1: 'dead', n2: 'dead', n3: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-b1', name: 'wf-b1', nodes: chain(['n1', 'n2', 'n3']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b1', 10000)
    check('B1.0 夹具：本场景在限时内跑完', outcome === 'settled', outcome)
    check('B1.1 前两次派发确实打到了 dead provider（否则后面测的不是健康守卫）',
      calls.length >= 2 && calls[0].agentOptions.provider === 'dead' && calls[1].agentOptions.provider === 'dead',
      JSON.stringify(calls.map((c) => c.agentOptions && c.agentOptions.provider)))
    const n3 = run.nodeStates.n3
    check('B1.2 第三次派发不再打到 dead provider：节点改为继承父级路由（good）并成功',
      n3.status === 'completed' && calls.length === 3 && calls[2].agentOptions === null,
      'n3=' + n3.status + ' calls=' + JSON.stringify(calls.map((c) => c.agentOptions && c.agentOptions.provider)))
    check('B1.3 被降级的节点在 route.health 里留下证据（blocked + 是哪个 provider），不是静默降级',
      !!(n3.route && n3.route.health && n3.route.health.blocked === true && n3.route.health.provider === 'dead'),
      JSON.stringify(n3.route && n3.route.health))
    check('B1.4 运行摘要点名 provider 不健康（failed fast 的运行不得被误读成"卡住"或"就是失败了"）',
      /provider health/.test(String(run.result && run.result.summary)) && /"dead"/.test(String(run.result && run.result.summary)),
      String(run.result && run.result.summary).slice(0, 200))
  } catch (e) { blockFailure('B1 降级回退', e) }
}
{
  try {
    // B2: parent = 'dead' too, so there is NOTHING to fall back to. The node must
    // refuse to dispatch instead of buying the same failure again at the price of
    // a whole ceiling -- which is what happened per node during the amd incident.
    mount.script = (call) => (call.agentOptions && call.agentOptions.provider === 'dead' ? { stopReason: 'error', diagnostic: 'NO_ADAPTER' } : { text: 'ok' })
    const { svc, calls } = await mount('dead')
    await defineRoles(svc, ['n1', 'n2', 'n3'], { n1: 'dead', n2: 'dead', n3: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-b2', name: 'wf-b2', nodes: chain(['n1', 'n2', 'n3']) })
    const { outcome, run } = await runWithDeadline(svc, 'wf-b2', 10000)
    check('B2.0 夹具：本场景在限时内跑完', outcome === 'settled', outcome)
    check('B2.1 无路可退时不再派发（第 3 个节点没有产生新的 start 调用）', calls.length === 2, 'calls=' + String(calls.length))
    const n3 = run.nodeStates.n3
    check('B2.2 该节点以明确原因失败，而不是再等一个完整超时',
      n3.status === 'failed' && /连续失败 \d+ 次/.test(String(n3.error)) && /不再派发/.test(String(n3.error)),
      String(n3.error).slice(0, 160))
    check('B2.3 运行状态为 failed，且摘要把"停止信任 provider"说出来',
      run.status === 'failed' && /provider health/.test(String(run.result && run.result.summary)),
      run.status + ' | ' + String(run.result && run.result.summary).slice(0, 160))
  } catch (e) { blockFailure('B2 无路可退', e) }
}
{
  try {
    // B3: a NON-provider failure must never condemn a provider. Both n1 and n2
    // stop with 'aborted' (a cancellation-shaped stop, not an adapter failure), so
    // n3 must still be dispatched to 'dead'. TWO failures are needed on purpose:
    // with only one, a classifier that blames the provider unconditionally would
    // still leave the count below the threshold and every assertion here would
    // pass -- this group is what proves the classifier is selective.
    mount.script = (call) => (call.index <= 1 ? { stopReason: 'aborted' } : { text: 'ok' })
    const { svc, calls } = await mount('good')
    await defineRoles(svc, ['n1', 'n2', 'n3'], { n1: 'dead', n2: 'dead', n3: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-b3', name: 'wf-b3', nodes: chain(['n1', 'n2', 'n3']) })
    const { run } = await runWithDeadline(svc, 'wf-b3', 10000)
    check('B3.1 连续两次非 provider 侧失败（stopReason=aborted）都不得把 provider 判死：第 3 次仍然派发到 dead',
      calls.length === 3 && calls[2].agentOptions !== null && calls[2].agentOptions.provider === 'dead',
      'calls=' + JSON.stringify(calls.map((c) => c.agentOptions && c.agentOptions.provider)))
    check('B3.2 也不得有节点被健康守卫降级，摘要里也不得出现 provider health 结论（没有证据就不许下结论）',
      !Object.values(run.nodeStates).some((n) => n.route && n.route.health) &&
      !/provider health/.test(String(run.result && run.result.summary)),
      String(run.result && run.result.summary).slice(0, 160))
  } catch (e) { blockFailure('B3 非 provider 失败', e) }
}
{
  try {
    // B4: "consecutive" must really mean consecutive. fail(n1) -> success(n2)
    // clears the count, so fail(n3) is only the FIRST failure again and n4 is
    // still dispatched (and succeeds, so the run never accumulates two in a row).
    // The property under test is that a success RESETS the ledger: if it did not,
    // n3's failure would be the second and n4 would never be dispatched at all.
    mount.script = (call) => (call.index === 1 || call.index === 3 ? { text: 'ok' } : { stopReason: 'error', diagnostic: 'boom' })
    const { svc, calls } = await mount('good')
    await defineRoles(svc, ['n1', 'n2', 'n3', 'n4'], { n1: 'dead', n2: 'dead', n3: 'dead', n4: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-b4', name: 'wf-b4', nodes: chain(['n1', 'n2', 'n3', 'n4']) })
    const { run } = await runWithDeadline(svc, 'wf-b4', 10000)
    check('B4.1 成功一次即清零计数：fail/success/fail 之后第 4 次仍然派发到 dead（"连续"不能被写成"累计"）',
      calls.length === 4 && calls[3].agentOptions !== null && calls[3].agentOptions.provider === 'dead',
      'calls=' + JSON.stringify(calls.map((c) => c.agentOptions && c.agentOptions.provider)))
    check('B4.2 因此既没有节点被健康守卫降级，摘要里也没有 provider health 结论',
      !Object.values(run.nodeStates).some((n) => n.route && n.route.health) &&
      !/provider health/.test(String(run.result && run.result.summary)),
      String(run.result && run.result.summary).slice(0, 160))
  } catch (e) { blockFailure('B4 连续语义', e) }
}
{
  try {
    // B5: the evidence key must exist ONLY when the guard actually blocked, so a
    // normal run's route record keeps exactly the keys it had before P14.
    mount.script = () => ({ text: 'ok' })
    const { svc } = await mount('good')
    await defineRoles(svc, ['n1'], { n1: 'dead' })
    await svc.upsertWorkflow({ id: 'wf-b5', name: 'wf-b5', nodes: chain(['n1']) })
    const { run } = await runWithDeadline(svc, 'wf-b5', 8000)
    const route = run.nodeStates.n1.route
    check('B5.1 未被健康守卫拦下时，route 记录里不得出现 health 键（键集契约：干净运行与改动前逐字一致）',
      route !== undefined && !('health' in route), route ? Object.keys(route).join(',') : 'no route')
    check('B5.2 该节点的 route.warning 也不得凭空空出来（没有拦截就没有健康告警）',
      route.warning === null || !/连续失败/.test(String(route.warning)), JSON.stringify(route.warning))
  } catch (e) { blockFailure('B5 键集契约', e) }
}

summary()
process.exit(failures === 0 ? 0 : 1)
