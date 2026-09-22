// P16: context inheritance -- a worker that starts from the conversation instead
// of from nothing.
//
// The runtime ships a `fork` subagent backend that seeds a child with the parent
// log's balanced COMPLETED-TURN prefix. This suite tests how the plugin uses it,
// and it is built around three claims that are each falsifiable here:
//
//   1. The provider is chosen by CAPABILITY, not by name. A registered provider
//      qualifies only when it advertises `inheritsParentContext === true`; a
//      backend merely called "fork" is not trusted, and one that advertises the
//      flag under another name is. When nothing qualifies the dispatch falls back
//      to `spawn` and the node RECORDS why -- a capability that is not there is
//      reported, never silently pretended (group B3).
//
//   2. The request shape does not change. fork and spawn advertise the same
//      capabilities, so only the provider name differs: group B1 captures the spec
//      handed to `fork` and compares it byte for byte with the spec the same node
//      gets when it does not inherit. That is what stops this from becoming a
//      second, divergent dispatch path.
//
//   3. The token claim is MEASURED, not asserted. The child's own usage is read
//      back from its session and recorded as `context.usage`; an unreadable
//      session records null (unknown), never a fabricated zero (group B8/B9).
//
// Usage:
//   node validation/p16-context.mjs
//   P16_SRC=<path-to-a-mutated-copy> node validation/p16-context.mjs   (mutation runs)
//
// Exit code: 0 = all checks passed, 1 = at least one failed,
//            2 = the module under test could not be imported.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DEFAULT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')
const SRC = process.env.P16_SRC && process.env.P16_SRC.trim() !== '' ? resolve(process.env.P16_SRC.trim()) : DEFAULT_SRC
const SRC_URL = pathToFileURL(SRC).href
const MUTATION_MODE = SRC !== DEFAULT_SRC
const CHILD = process.env.P16_CHILD === '1'

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
function blockFailure(label, e) {
  check(label + ' -- 整块检查（该场景抛出则整块判负）', false, String(e && e.stack ? e.stack.split('\n')[0] : e))
}
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  console.log('module under test: ' + SRC_URL)
  console.log(MUTATION_MODE ? 'mode            : MUTATION MODE (not the repository file)' : 'mode            : repository source')
  if (failedLabels.length > 0) {
    console.log('failed checks:')
    for (const l of failedLabels) console.log('  - ' + l)
  }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })
process.on('unhandledRejection', (e) => { blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })

console.log('=== P16 context-inheritance tests ===')
console.warn = () => {}

let mod = null
try {
  mod = await import(SRC_URL + '?p16-main')
} catch (e) {
  blockFailure('导入被测模块', e)
  process.exit(summary() === 0 ? 0 : 2)
}

/* ------------------------------------------------------------------ group A */
// The pure decisions, unit level. These are the parts that must be right even
// when no runtime is available.
console.log('\n--- GROUP A: 纯函数（谁决定 / 谁有资格 / 用量怎么算） ---')
try {
  const pick = mod.pickInheritContext
  check('A1.1 无任何层声明 -> default/none（不继承，且理由是"默认"而不是"非法"）',
    pick({}).requested === 'none' && pick({}).source === 'default', JSON.stringify(pick({})))
  check('A1.2 node 层 session -> 生效，来源是 node',
    pick({ node: 'session' }).requested === 'session' && pick({ node: 'session' }).source === 'node')
  check('A1.3 run > node > workflow > role（整层胜出，与 pickRoute 同一套口径）',
    pick({ run: 'none', node: 'session', workflow: 'session', role: 'session' }).source === 'run'
    && pick({ run: 'none', node: 'session' }).requested === 'none'
    && pick({ node: 'session', workflow: 'none', role: 'none' }).source === 'node'
    && pick({ workflow: 'session', role: 'none' }).source === 'workflow'
    && pick({ role: 'session' }).source === 'role',
    JSON.stringify([pick({ run: 'none', node: 'session' }), pick({ node: 'session', workflow: 'none' }), pick({ workflow: 'session', role: 'none' })]))
  check('A1.4 run 层 none 是真正的杀开关：压过 node/workflow/role 的 session',
    pick({ run: 'none', node: 'session', workflow: 'session', role: 'session' }).requested === 'none')
  check('A1.5 布尔拼写可用（true/false），因为 REST 与手写记录会用布尔',
    pick({ node: true }).requested === 'session' && pick({ node: false }).requested === 'none')
  check('A1.6 无法识别的取值 = 不启用 + 记下 invalid（打字错误绝不能打开昂贵模式）',
    pick({ node: 'yes' }).requested === 'none' && pick({ node: 'yes' }).source === 'node:invalid',
    JSON.stringify(pick({ node: 'yes' })))
  check('A1.7 undefined/null 视为"这一层没声明"，继续往下找',
    pick({ run: null, node: undefined, role: 'session' }).source === 'role', JSON.stringify(pick({ run: null, node: undefined, role: 'session' })))
  check('A1.8 [杀开关可审计] 高层 none 压过低层 session 时，overridden 点名被压的是哪一层',
    JSON.stringify(pick({ run: 'none', role: 'session' }).overridden) === JSON.stringify([{ source: 'role', declared: 'session' }]),
    JSON.stringify(pick({ run: 'none', role: 'session' }).overridden))
  check('A1.9 生效时 overridden 为空（不许把"没被压"记成"被压了"）',
    pick({ node: 'session', role: 'none' }).overridden.length === 0, JSON.stringify(pick({ node: 'session', role: 'none' }).overridden))

  const choose = mod.chooseInheritProvider
  check('A2.1 没有任何 provider -> name=null 且理由是"没注册"（不猜）',
    choose([], () => null).name === null, choose([], () => null).reason)
  check('A2.2 有 provider 但没人声明 inheritsParentContext -> name=null 且理由点名这一点',
    choose(['spawn', 'fork'], () => ({ inheritsParentContext: false })).name === null,
    choose(['spawn', 'fork'], () => ({ inheritsParentContext: false })).reason)
  check('A2.3 [核心] 按"能力"而不是"名字"：名叫 fork 但不声明的后端不被采用',
    choose(['fork'], () => ({ inheritsParentContext: false })).name === null)
  check('A2.4 [核心] 名字不叫 fork 但声明了能力的后端会被采用',
    choose(['some-fork-backend'], (n) => (n === 'some-fork-backend' ? { inheritsParentContext: true } : null)).name === 'some-fork-backend')
  check('A2.5 多个合格时优先叫 fork 的那个（可预期）',
    choose(['a', 'fork', 'b'], () => ({ inheritsParentContext: true })).name === 'fork')
  check('A2.6 getProvider 抛异常时不影响其它候选（一个坏后端不能打死发现）',
    choose(['bad', 'good'], (n) => { if (n === 'bad') throw new Error('boom'); return { inheritsParentContext: true } }).name === 'good')

  const sum = mod.sumUsage
  check('A3.1 统计 assistant/message 的 usage：requests / 四类 token / 命中率',
    JSON.stringify(sum([{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 90 } } }]))
    === JSON.stringify({ requests: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0, cacheHitRate: 0.9 }),
    JSON.stringify(sum([{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 90 } } }])))
  check('A3.2 没有任何用量信息 -> null（未知，绝不当成 0）', sum([]) === null && sum([{ type: 'turn/end', data: {} }]) === null)
  check('A3.3 非数组输入不抛异常 -> null', sum(null) === null && sum(undefined) === null && sum('x') === null)
  const merged = mod.sumUsageMerge(
    { requests: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0, cacheHitRate: 0.9 },
    { requests: 1, inputTokens: 20, outputTokens: 7, cacheReadTokens: 80, cacheWriteTokens: 0, cacheHitRate: 0.8 })
  check('A3.4 两次派发（work + rework）合并成节点总数，命中率按合并后的分子分母重算',
    merged.requests === 2 && merged.cacheReadTokens === 170 && merged.inputTokens === 30 && merged.cacheHitRate === 0.85, JSON.stringify(merged))
  check('A3.5 合并时有一侧是 null（读不到）-> 取另一侧，而不是把未知当成 0',
    JSON.stringify(mod.sumUsageMerge(null, merged)) === JSON.stringify(merged) && mod.sumUsageMerge(null, null) === null)

  const seeded = mod.seededEventCount
  check('A4.1 从子代理自己的 session/end-seed 标记读出"继承了多少事件"（seq+1）',
    seeded([{ type: 'turn/start', seq: 0 }, { type: 'session/end-seed', seq: 7, data: { inherited: true } }]) === 8,
    String(seeded([{ type: 'turn/start', seq: 0 }, { type: 'session/end-seed', seq: 7, data: { inherited: true } }])))
  check('A4.2 没有该标记 -> null（未知，不能当 0：0 会被读成"什么都没继承"）',
    seeded([{ type: 'turn/start', seq: 0 }]) === null && seeded([]) === null && seeded(null) === null)
  check('A4.3 标记没有可用 seq -> null（宁可不知道，也不编一个数）',
    seeded([{ type: 'session/end-seed', data: {} }]) === null)
} catch (e) { blockFailure('A 纯函数', e) }

/* ------------------------------------------------------------------ harness */
function makeStorageStub() {
  const stores = new Map()
  const open = async (spec) => {
    const dname = spec.name
    if (!stores.has(dname)) stores.set(dname, new Map())
    const tables = stores.get(dname)
    const table = (name) => {
      if (spec.tables === undefined || spec.tables[name] === undefined) throw new Error('stub storage: no table ' + name)
      if (!tables.has(name)) tables.set(name, new Map())
      const map = tables.get(name)
      return {
        get: (k) => map.get(k),
        entries: () => [...map.entries()][Symbol.iterator](),
        keys: () => [...map.keys()][Symbol.iterator](),
        get size() { return map.size },
        put: async (k, v) => { map.set(k, v) },
        delete: async (k) => map.delete(k),
        update: async (k, fn) => { if (!map.has(k)) throw new Error('stub storage: no record ' + k); const next = fn(map.get(k)); map.set(k, next); return next },
      }
    }
    return { name: dname, table, close: async () => {} }
  }
  return { open, stores }
}

/**
 * A subagent registry stub that records the PROVIDER NAME of every dispatch --
 * the single most important fact this suite is about -- plus the full spec, so
 * "the fork spec equals the spawn spec" can be compared rather than asserted.
 *
 * `providers` is the registry contents: { name: { inheritsParentContext } }.
 * `usageEvents` is what the fake child's session reports back.
 */
function makeSubagentsStub(providers, usageEvents) {
  const calls = []
  const registry = new Map(Object.entries(providers || {}))
  return {
    calls,
    registry,
    list() { return [...registry.keys()] },
    getProvider(n) { return registry.get(n) },
    async start(kind, spec) {
      const call = {
        provider: kind,
        label: String((spec && spec.label) || ''),
        spec: JSON.parse(JSON.stringify({ prompt: spec && spec.prompt, agentOptions: spec && spec.agentOptions, persona: spec && spec.persona, toolFilter: spec && spec.toolFilter, maxDepth: spec && spec.maxDepth })),
        role: /:review(-repair)?$/.test(String(spec && spec.label)) ? 'reviewer' : 'worker',
        index: calls.length,
      }
      calls.push(call)
      const child = {
        session: {
          requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
          snapshotEvents: () => (usageEvents === undefined ? [] : usageEvents),
        },
      }
      const result = (async () => ({ output: [{ type: 'text', text: 'OK-' + call.label }], stopReason: 'completed' }))()
      return { id: 'child-' + call.index, localAgent: child, result, dispose: async () => {}, note: 'stub:' + call.role }
    },
  }
}

let scenarioSeq = 0
/** Mount a fresh module instance; `providers` seeds the subagent registry. */
async function mount(providers, usageEvents) {
  scenarioSeq += 1
  const storage = makeStorageStub()
  const subagents = makeSubagentsStub(providers, usageEvents)
  const parent = { session: { requestHeader: () => ({ config: { provider: 'p', model: 'm' } }) } }
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
  const m = await import(SRC_URL + '?p16-scenario=' + scenarioSeq)
  const realWarn = console.warn
  console.warn = () => {}
  try { m.apply(ctx) } finally { console.warn = realWarn }
  return { svc: captured.teamOrchestrator, storage, calls: subagents.calls, subagents }
}

const USAGE = [
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  // The fork's seed boundary marker: everything up to and including seq 2 was
  // inherited from the parent log.
  { type: 'session/end-seed', seq: 2, data: { inherited: true } },
  { type: 'assistant/message', seq: 3, data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 0 } } },
  { type: 'turn/end', seq: 4, data: { turn: 1, reason: { kind: 'completed' } } },
]
const FORK_OK = { spawn: { inheritsParentContext: false }, fork: { inheritsParentContext: true } }
const NO_FORK = { spawn: { inheritsParentContext: false } }

async function run(svc, wfId, opts) {
  let runId = null
  const p = svc.runWorkflow(wfId, {}, (r) => { runId = r.id }, opts)
  const outcome = await Promise.race([
    p.then((r) => ({ settled: true, r })).catch((e) => ({ settled: true, error: String(e) })),
    new Promise((res) => setTimeout(() => res({ settled: false }), 30000)),
  ])
  if (!outcome.settled) throw new Error('run did not settle within 30s (runId=' + runId + ')')
  if (outcome.error) throw new Error(outcome.error)
  const run = (await svc.listRuns()).filter((r) => r.id === runId)[0]
  return run
}
const oneNode = (extra) => ({ n1: Object.assign({ id: 'n1', title: 'n1', agent: 'r1', dependsOn: [], taskTemplate: { requirement: 'do n1', acceptanceCriteria: 'did n1' } }, extra || {}) })

/* ------------------------------------------------------------------ group B */
console.log('\n--- GROUP B: 派发（谁被调用、spec 是否一致、记录说了什么） ---')
try {
  // B1/B2: the request shape is IDENTICAL; only the provider name changes.
  const s1 = await mount(FORK_OK, USAGE)
  await s1.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' }, inheritContext: 'session' })
  await s1.svc.upsertWorkflow({ id: 'wf-inherit', name: 'wf-inherit', nodes: oneNode() })
  const run1 = await run(s1.svc, 'wf-inherit')
  const worker1 = s1.calls.filter((c) => c.role === 'worker')[0]
  check('B1.1 声明 inheritContext=session 的节点真的走 fork provider',
    worker1 !== undefined && worker1.provider === 'fork', worker1 ? 'provider=' + worker1.provider : 'no worker call')

  const s2 = await mount(FORK_OK, USAGE)
  await s2.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' } })
  await s2.svc.upsertWorkflow({ id: 'wf-plain', name: 'wf-plain', nodes: oneNode() })
  const run2 = await run(s2.svc, 'wf-plain')
  const worker2 = s2.calls.filter((c) => c.role === 'worker')[0]
  check('B1.2 没声明的节点仍然走 spawn（默认行为一个字节都没变）',
    worker2 !== undefined && worker2.provider === 'spawn', worker2 ? 'provider=' + worker2.provider : 'no worker call')
  check('B1.3 [核心] 两种派发的 spec 完全相同：只有 provider 名字不同（同一套请求形状，不是第二条派发路径）',
    worker1 !== undefined && worker2 !== undefined && JSON.stringify(worker1.spec) === JSON.stringify(worker2.spec),
    worker1 && worker2 ? ('equal=' + String(JSON.stringify(worker1.spec) === JSON.stringify(worker2.spec))) : 'missing call')

  // B3: no provider advertises the capability -> spawn + a recorded reason.
  const s3 = await mount(NO_FORK, USAGE)
  await s3.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' }, inheritContext: 'session' })
  await s3.svc.upsertWorkflow({ id: 'wf-nofork', name: 'wf-nofork', nodes: oneNode() })
  const run3 = await run(s3.svc, 'wf-nofork')
  const c3 = run3.nodeStates.n1.context || {}
  check('B3.1 [降级] 本部署没有能继承上下文的 provider 时，节点照常派发（走 spawn），不失败、不静默',
    s3.calls.filter((c) => c.role === 'worker')[0].provider === 'spawn' && run3.status === 'completed',
    'status=' + run3.status + ' provider=' + s3.calls.filter((c) => c.role === 'worker')[0].provider)
  check('B3.2 [降级] 记录里如实写明"要了但没生效"以及原因（requested/effective/reason 三件都在）',
    c3.requested === 'session' && c3.effective === 'none' && typeof c3.reason === 'string' && c3.reason.length > 0,
    JSON.stringify(c3))
  check('B3.3 [降级] 原因点名是"没有 provider 声明继承能力"，而不是一句笼统的失败',
    typeof c3.reason === 'string' && c3.reason.indexOf('inheritsParentContext') !== -1, String(c3.reason))

  // B4: the run-level kill switch.
  const s4 = await mount(FORK_OK, USAGE)
  await s4.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' }, inheritContext: 'session' })
  await s4.svc.upsertWorkflow({ id: 'wf-kill', name: 'wf-kill', nodes: oneNode() })
  const run4 = await run(s4.svc, 'wf-kill', { inheritContext: 'none' })
  check('B4.1 [run 层杀开关] 角色声明 session、run 传 none -> 实际走 spawn，且记录说明来源是 run 层',
    s4.calls.filter((c) => c.role === 'worker')[0].provider === 'spawn'
    && (run4.nodeStates.n1.context || {}).source === 'run'
    && (run4.nodeStates.n1.context || {}).effective === 'none',
    JSON.stringify({ provider: s4.calls.filter((c) => c.role === 'worker')[0].provider, context: run4.nodeStates.n1.context }))

  // B5: the workflow layer is a default for its nodes; the node wins over it.
  const s5 = await mount(FORK_OK, USAGE)
  await s5.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' } })
  await s5.svc.upsertWorkflow({ id: 'wf-layer', name: 'wf-layer', inheritContext: 'session', nodes: oneNode() })
  const run5 = await run(s5.svc, 'wf-layer')
  check('B5.1 workflow 层声明 session -> 它的节点默认继承（来源记为 workflow）',
    s5.calls.filter((c) => c.role === 'worker')[0].provider === 'fork'
    && (run5.nodeStates.n1.context || {}).source === 'workflow',
    JSON.stringify({ provider: s5.calls.filter((c) => c.role === 'worker')[0].provider, context: run5.nodeStates.n1.context }))

  const s6 = await mount(FORK_OK, USAGE)
  await s6.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' } })
  await s6.svc.upsertWorkflow({ id: 'wf-node-wins', name: 'wf-node-wins', inheritContext: 'session', nodes: oneNode({ inheritContext: 'none' }) })
  const run6 = await run(s6.svc, 'wf-node-wins')
  check('B5.2 node 层 none 压过 workflow 层 session（来源记为 node）',
    s6.calls.filter((c) => c.role === 'worker')[0].provider === 'spawn'
    && (run6.nodeStates.n1.context || {}).source === 'node',
    JSON.stringify({ provider: s6.calls.filter((c) => c.role === 'worker')[0].provider, context: run6.nodeStates.n1.context }))

  // B6: reviewers never inherit, even when the workflow says session.
  const s7 = await mount(FORK_OK, USAGE)
  await s7.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' } })
  await s7.svc.upsertAgent({ id: 'rev', name: 'rev', role: 'reviewer', model: { provider: 'p', model: 'm' }, inheritContext: 'session' })
  await s7.svc.upsertWorkflow({
    id: 'wf-review', name: 'wf-review', inheritContext: 'session',
    nodes: { n1: { id: 'n1', title: 'n1', agent: 'r1', reviewer: 'rev', dependsOn: [], taskTemplate: { requirement: 'do n1', acceptanceCriteria: 'did n1' } } },
  })
  await run(s7.svc, 'wf-review')
  const reviewCalls = s7.calls.filter((c) => c.role === 'reviewer')
  check('B6.1 [独立评审不可污染] 工作流声明了 session、评审者角色也声明了 session，评审派发仍然走 spawn',
    reviewCalls.length > 0 && reviewCalls.every((c) => c.provider === 'spawn'),
    'reviewer providers=' + JSON.stringify(reviewCalls.map((c) => c.provider)))
  check('B6.2 同一个 run 里 worker 走 fork、reviewer 走 spawn（两种派发确实分开了）',
    s7.calls.filter((c) => c.role === 'worker')[0].provider === 'fork' && reviewCalls.every((c) => c.provider === 'spawn'),
    JSON.stringify(s7.calls.map((c) => c.role + ':' + c.provider)))

  // B7: key-set contract -- no `context` key unless the node asked for it.
  check('B7.1 没声明继承的节点，记录里没有 context 键（键集契约：不请求就不多发字段）',
    !Object.prototype.hasOwnProperty.call(run2.nodeStates.n1, 'context'),
    'keys=' + Object.keys(run2.nodeStates.n1).join(','))
  check('B7.2 声明了继承的节点，记录里带着 context（有据可查）',
    Object.prototype.hasOwnProperty.call(run1.nodeStates.n1, 'context'))

  // B8/B9: the measured evidence.
  const u = (run1.nodeStates.n1.context || {}).usage
  check('B8.1 [核心] 实测用量被读回并记在节点上：cacheReadTokens / inputTokens / outputTokens',
    u !== null && u !== undefined && u.cacheReadTokens === 900 && u.inputTokens === 100 && u.outputTokens === 20,
    JSON.stringify(u))
  check('B8.2 命中率按 cacheRead/(input+cacheRead) 算出来，不是一个形容词',
    u !== null && u !== undefined && u.cacheHitRate === 0.9, u ? 'cacheHitRate=' + u.cacheHitRate : 'null')
  check('B8.3 dispatches 记录这条节点派发了几次（返工会累加，不是覆盖）',
    (run1.nodeStates.n1.context || {}).dispatches === 1, 'dispatches=' + (run1.nodeStates.n1.context || {}).dispatches)
  check('B8.4 routeChanged 标记节点的路由是否与父级不同（前缀还能不能复用，先记下来）',
    (run1.nodeStates.n1.context || {}).routeChanged === false, 'routeChanged=' + (run1.nodeStates.n1.context || {}).routeChanged)
  check('B8.5 [核心] 从子代理的 end-seed 标记读出"继承了多少事件"，这样"没有缓存收益"和"其实什么都没继承"能分开',
    (run1.nodeStates.n1.context || {}).seeded === 3, 'seeded=' + JSON.stringify((run1.nodeStates.n1.context || {}).seeded))

  const s9 = await mount(FORK_OK, [])
  await s9.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', model: { provider: 'p', model: 'm' }, inheritContext: 'session' })
  await s9.svc.upsertWorkflow({ id: 'wf-nousage', name: 'wf-nousage', nodes: oneNode() })
  const run9 = await run(s9.svc, 'wf-nousage')
  check('B9.1 [不许编] 读不到用量时 usage 是 null（未知），不是 0 —— 0 会被读成"缓存完全没命中"',
    (run9.nodeStates.n1.context || {}).usage === null, JSON.stringify((run9.nodeStates.n1.context || {}).usage))
  check('B9.2 读不到用量不影响节点完成、也不改变 context 的其它字段',
    run9.status === 'completed' && (run9.nodeStates.n1.context || {}).effective === 'session',
    'status=' + run9.status)
  check('B9.3 没有 end-seed 标记时 seeded 不是 0 而是"没有这个字段"（未知 ≠ 零）',
    !Object.prototype.hasOwnProperty.call(run9.nodeStates.n1.context || {}, 'seeded'),
    'keys=' + Object.keys(run9.nodeStates.n1.context || {}).join(','))
} catch (e) { blockFailure('B 派发行为', e) }

/* ------------------------------------------------------------------ group C */
// The record must be enough for a human to audit a surprising result, and the
// declarations must survive the write paths (the "declared but unstored" trap
// that has bitten this plugin three times).
console.log('\n--- GROUP C: 声明必须存得住（declared-but-unstored 陷阱） ---')
try {
  const s = await mount(FORK_OK, USAGE)
  const a = await s.svc.upsertAgent({ id: 'r1', name: 'r1', role: 'role', inheritContext: 'session' })
  check('C1.1 upsertAgent 把 inheritContext 存进角色记录',
    a.inheritContext === 'session', JSON.stringify(a.inheritContext))
  const reread = (await s.svc.listAgents()).filter((x) => x.id === 'r1')[0]
  check('C1.2 读回来还在（写入路径没漏字段）', reread.inheritContext === 'session', JSON.stringify(reread.inheritContext))
  const w = await s.svc.upsertWorkflow({ id: 'wf-c', name: 'wf-c', inheritContext: 'session', nodes: { n1: { id: 'n1', agent: 'r1', dependsOn: [], inheritContext: 'none' } } })
  check('C1.3 upsertWorkflow 把工作流级 inheritContext 存住', w.inheritContext === 'session', JSON.stringify(w.inheritContext))
  check('C1.4 节点级 inheritContext 穿过节点 schema 存住（不是被 zod 丢掉）',
    w.nodes.n1.inheritContext === 'none', JSON.stringify(w.nodes.n1.inheritContext))
  const b = await s.svc.upsertAgent({ id: 'r2', name: 'r2', role: 'r', inheritContext: true })
  check('C1.5 布尔写法也被接受并存住（union schema，不是被静默 strip）',
    b.inheritContext === true, JSON.stringify(b.inheritContext))
} catch (e) { blockFailure('C 写入路径', e) }

/* ------------------------------------------------------------------ group D */
// Falsification: take the repository source, break exactly one thing, and require
// this suite to go red on it. A behavioural suite that has never been seen to fail
// is a suite that proves nothing.
console.log('\n--- GROUP D: 本套件真的会红（把 fork 派发改回 spawn 的变异） ---')
if (MUTATION_MODE) {
  console.log('  ...  变异模式（P16_SRC 已设置）-> 不再递归跑反证')
} else if (CHILD) {
  console.log('  ...  子进程模式（P16_CHILD=1）-> 不再递归跑反证')
} else {
  const mutDir = mkdtempSync(join(tmpdir(), 'tf-p16-mut-'))
  try {
    const mutFile = join(mutDir, 'index.mjs')
    const text = readFileSync(SRC, 'utf8')
    // The mutation: keep every declaration and every record, but never actually
    // dispatch to the discovering provider -- i.e. the feature is silently a lie.
    const mutated = text.replace(
      'subagentsSvc.start(provider, merged)',
      "subagentsSvc.start('spawn', merged)")
    check('D1.0 变异确实施加在源码上（否则本组是空转）', mutated !== text, 'changed=' + String(mutated !== text))
    copyFileSync(SRC, join(mutDir, 'index.mjs.orig'))
    // The copy needs the same module resolution as the original, so it is placed
    // NEXT TO it rather than in the temp dir.
    const sideFile = join(dirname(SRC), '.p16-mutated-index.mjs')
    writeFileSync(sideFile, mutated, 'utf8')
    try {
      const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, P16_SRC: sideFile, P16_CHILD: '1' },
      })
      check('D1.1 把 fork 派发改回 spawn，本套件必须变红', false, 'exit=0 (it stayed green) :: ' + out.slice(0, 160))
    } catch (e) {
      const stdout = String(e.stdout || '')
      const status = e.status === undefined || e.status === null ? -1 : e.status
      const labels = (() => {
        const at = stdout.indexOf('failed checks:')
        if (at === -1) return []
        return stdout.slice(at).split('\n').slice(1).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l !== '')
      })()
      check('D1.1 把 fork 派发改回 spawn，本套件必须变红', status === 1, 'exit=' + status)
      check('D1.2 变红的正是"真的走了 fork"那几条（B1.1 / B1.3 / B6.2）',
        labels.filter((l) => /^B1\.1|^B1\.3|^B6\.2/.test(l)).length >= 2,
        'hit=' + labels.filter((l) => /^B/.test(l)).map((l) => l.slice(0, 4)).join(',') || 'none')
      check('D1.3 红在"检查"上而不是套件崩溃：SUMMARY 打印了，且没有未捕获异常',
        stdout.includes('=== SUMMARY ===') && !/未捕获异常/.test(stdout), 'summary=' + stdout.includes('=== SUMMARY ==='))
      const m = /checks=(\d+)\s+failures=(\d+)/.exec(stdout)
      if (m) console.log('       [变异原始输出] exit=' + status + ' checks=' + m[1] + ' failures=' + m[2])
    } finally {
      try { rmSync(sideFile, { force: true }) } catch { /* ignore */ }
    }
  } catch (e) { blockFailure('D 变异反证', e) } finally {
    try { rmSync(mutDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  check('D2.1 变异副本没有留在仓库里（仓库源码零改动）',
    !existsSync(join(dirname(SRC), '.p16-mutated-index.mjs')), dirname(SRC))
  check('D2.2 仓库源码仍等于被测源码（变异只存在于临时副本）',
    readFileSync(SRC, 'utf8').indexOf("subagentsSvc.start(provider, merged)") !== -1)
}

process.exit(summary() === 0 ? 0 : 1)
