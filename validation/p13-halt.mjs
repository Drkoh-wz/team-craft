// P13-C: executable tests for the P13 core capability -- `haltOnFailure`
// (fail-fast + true halt) in the team-flowise scheduler, and the client half
// that renders it. Nothing here needs a restart and nothing here touches the
// real profile: the host half is mounted on an in-memory stub `ctx`, the client
// half is the REAL hand-authored bundle evaluated against a stub React/DOM.
//
// Usage:
//   node validation/p13-halt.mjs                        # the repository source
//   P13_SRC=<path-to-a-copy> [P13_SKIP_MUTATIONS=1] node validation/p13-halt.mjs
//   P13_CLIENT_SRC=<path-to-a-copy> node validation/p13-halt.mjs
//       -> test a COPY (used by the mutation runs: the copy is broken on purpose
//          in the system temp dir, never in the repository).
//
// Exit code: 0 = every check passed, 1 = at least one check failed,
//            2 = the module under test could not even be imported.
//
// Groups:
//   A  default unchanged   -- without `haltOnFailure` NOTHING about a run changes
//   B  fail-fast           -- a failed node skips everything not yet started
//   C  same wave not killed-- a sibling in the failing wave finishes, artifact kept
//   D  no-skip / no-downstream corner cases (failed must stay failed)
//   E  unresolved blocking -- the second halt trigger, incl. the last-node case
//   F  schema + write path -- 'halted' validates, haltOnFailure survives upsertWorkflow
//   G  /progress projection-- skipped nodes carry blockedBy, others do NOT
//   H  client half         -- real bundle: labels, no-dispatch wording, haltBlock
//   I  mutation proof      -- three deliberate breakages, run for real
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const HARNESS = join(HERE, '_harness-part.mjs')
const DEFAULT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')
const DEFAULT_CLIENT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'client', 'index.js')

const SRC = process.env.P13_SRC && process.env.P13_SRC.trim() !== '' ? resolve(process.env.P13_SRC.trim()) : DEFAULT_SRC
const SRC_URL = pathToFileURL(SRC).href
const CLIENT_SRC = process.env.P13_CLIENT_SRC && process.env.P13_CLIENT_SRC.trim() !== ''
  ? resolve(process.env.P13_CLIENT_SRC.trim())
  : DEFAULT_CLIENT_SRC

const MUTATION_MODE = SRC !== DEFAULT_SRC || CLIENT_SRC !== DEFAULT_CLIENT_SRC

let checks = 0
let failures = 0
const failureLabels = []
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  failureLabels.push(label)
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
/** One failing check for a whole scenario block that threw (timeout / crash). */
function blockFailure(label, e) {
  check(label + ' -- 整块检查（该场景抛出或超时则整块判负）', false, String(e && e.stack ? e.stack.split('\n')[0] : e))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * Print the tally and return the failure count. Also called from the crash guard
 * below: without that a throw inside an unguarded block killed the process with
 * no SUMMARY at all, so "the suite went red" was indistinguishable from "the
 * suite broke" -- a mutation could look like a pass.
 */
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  console.log('module under test: ' + SRC_URL)
  console.log('client under test: ' + CLIENT_SRC)
  if (failureLabels.length > 0) {
    console.log('failed checks:')
    for (const l of failureLabels) console.log('  - ' + l)
  }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => {
  blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e)
  summary()
  process.exit(1)
})
process.on('unhandledRejection', (e) => {
  blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e)
  summary()
  process.exit(1)
})
function withLimit(p, ms, label) {
  let timer
  const guard = new Promise((_res, rej) => { timer = setTimeout(() => rej(new Error('TEST TIMEOUT after ' + ms + 'ms: ' + label)), ms) })
  return Promise.race([p, guard]).finally(() => clearTimeout(timer))
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const deferred = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b }); return { p, res, rej } }

console.log('\n=== P13-C haltOnFailure tests (fail-fast + halt + client rendering) ===')
console.log('module under test: ' + SRC_URL)
console.log('client under test: ' + CLIENT_SRC)
console.log('mode            : ' + (MUTATION_MODE ? 'MUTATION MODE (not the repository file)' : 'repository'))

let mod = null
try { mod = await import(SRC_URL) } catch (e) {
  console.log('FATAL: cannot import the module under test: ' + String(e && e.message ? e.message : e))
  process.exit(2)
}

// ===========================================================================
// The stub ctx: in-memory storage domains with the real put/get/entries/update
// semantics (update must really run the callback: `transition` and the run
// record's own state writes depend on it), a recording `subagents` whose answers
// are decided per scenario, and a `webServer` that captures the real routes so
// /progress can be driven through the REAL handler.
// ===========================================================================
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
        delete: async (k) => { const had = map.delete(k); journal.push({ domain: dname, table: name, key: k, op: 'delete', value: undefined }); return had },
        update: async (k, fn) => {
          if (!map.has(k)) throw new Error('stub storage: no record ' + k + ' in ' + dname + '/' + name)
          const next = fn(map.get(k))
          map.set(k, next)
          journal.push({ domain: dname, table: name, key: k, op: 'update', value: next })
          return next
        },
      }
    }
    return { name: dname, table, close: async () => {} }
  }
  return { open, stores, journal }
}

function makeSubagentsStub(calls, plan) {
  return {
    calls,
    async start(_kind, spec) {
      const label = String((spec && spec.label) || '')
      const isReview = /:review(-repair)?$/.test(label)
      const prompt = spec && Array.isArray(spec.prompt) && spec.prompt[0] && typeof spec.prompt[0].text === 'string' ? spec.prompt[0].text : ''
      const roundMatch = /round=(\d+)/.exec(prompt)
      const call = {
        label, prompt,
        nodeId: isReview ? label.replace(/:review(-repair)?$/, '') : label,
        role: isReview ? 'reviewer' : 'worker',
        repair: /:review-repair$/.test(label),
        round: roundMatch ? Number(roundMatch[1]) : null,
        index: calls.length,
      }
      calls.push(call)
      const r = (plan ? plan(call) : null) || {}
      if (r.startError) throw new Error(r.startError)
      const result = (async () => {
        // `hold` is how the same-wave scenario keeps a sibling in flight for a
        // deterministic amount of time: the answer only exists once the test
        // releases it, so the sibling CANNOT have settled before the failure did.
        if (r.hold) await r.hold.p
        if (r.resultError) throw new Error(r.resultError)
        const output = []
        if (r.text !== undefined && r.text !== null && r.text !== '') output.push({ type: 'text', text: String(r.text) })
        if (r.reasoning) output.push({ type: 'reasoning', text: String(r.reasoning) })
        return { output, stopReason: r.stopReason || 'completed', diagnostic: r.diagnostic }
      })()
      return { result, note: 'stub:' + call.role }
    },
  }
}

const storage = makeStorageStub()
const captured = {}
const webRoutes = new Map()
const ctxDisposers = []
let subagentsStub = null
const agentsSvcStub = { currentInitiator: () => undefined, roots: () => [] }
const webServerStub = { register(def) { webRoutes.set(def.path, def.handler); return () => webRoutes.delete(def.path) } }
const ctx = {
  storageDomain: storage,
  agents: agentsSvcStub,
  webServer: webServerStub,
  get(n) {
    if (n === 'storageDomain') return storage
    if (n === 'subagents') return subagentsStub
    if (n === 'agents') return agentsSvcStub
    if (n === 'webServer') return webServerStub
    return undefined
  },
  provide(n, svc) { captured[n] = svc },
  effect(fn) { const d = fn(); if (typeof d === 'function') ctxDisposers.push(d); return () => {} },
  on() { return () => {} },
  logger: { warn() {}, error() {}, info() {} },
}
// The plugin warns about the optional capabilities this stub does not provide.
// Silenced only around apply() so the suite's own output stays greppable.
const realWarn = console.warn
console.warn = () => {}
try { mod.apply(ctx) } finally { console.warn = realWarn }

const svc = captured.teamOrchestrator
check('A0.1 apply(ctx) 真的 provide 了 teamOrchestrator 且 runWorkflow / upsertWorkflow 可调用（否则下面所有 группа都无意义）',
  svc !== undefined && typeof svc.runWorkflow === 'function' && typeof svc.upsertWorkflow === 'function', typeof svc)
check('A0.2 宿主注册了 /progress 与 /role 读接口（G 组要经真实 handler 取数）',
  webRoutes.has('/api/team-flowise/progress') && webRoutes.has('/api/team-flowise/role'),
  [...webRoutes.keys()].join(','))

const tableMap = (domain, table) => { const d = storage.stores.get(domain); return d === undefined ? undefined : d.get(table) }
const rec = (domain, table, key) => { const m = tableMap(domain, table); return m === undefined ? undefined : m.get(key) }
const allTasks = () => { const m = tableMap('team_ledger', 'tasks'); return m === undefined ? [] : [...m.values()] }
function rawPut(domain, table, key, value) {
  if (!storage.stores.has(domain)) storage.stores.set(domain, new Map())
  const d = storage.stores.get(domain)
  if (!d.has(table)) d.set(table, new Map())
  d.get(table).set(key, value)
  return value
}
const flowsSchema = mod.workflowsDomain.tables.flows.valueSchema
const runsDomainSchema = mod.runsDomain.tables.runs.valueSchema

async function callRoute(path, qs, opts) {
  const handler = webRoutes.get(path)
  if (handler === undefined) throw new Error('no route ' + path)
  let status = 0
  let body = null
  const res = { writableEnded: false, writeHead(s) { status = s }, end(t) { this.writableEnded = true; body = t } }
  const req = {
    url: path + (qs ? '?' + qs : ''),
    method: (opts && opts.method) || 'GET',
    socket: { remoteAddress: (opts && opts.remoteAddress) || '127.0.0.1' },
    on(event, fn) { if (event === 'data' && opts && opts.body !== undefined) fn(Buffer.from(JSON.stringify(opts.body))); if (event === 'end') fn() },
  }
  await handler(req, res)
  let json = null
  try { json = body === null ? null : JSON.parse(body) } catch { /* non-JSON */ }
  return { status, json, raw: body }
}

let seq = 0
/**
 * Drive one real run. `plan(call)` decides every answer; `wfExtra` is merged
 * into the workflow definition (this is where `haltOnFailure` is declared).
 */
async function scenario(name, nodes, wfExtra, plan, opts) {
  const o = opts || {}
  const calls = []
  subagentsStub = makeSubagentsStub(calls, plan)
  const wfId = 'wf-p13c-' + String(++seq) + '-' + name
  if (o.raw) rawPut('team_workflows', 'flows', wfId, Object.assign({ id: wfId, name: wfId, nodes, updatedAt: Date.now() }, wfExtra || {}))
  else await svc.upsertWorkflow(Object.assign({ id: wfId, name: wfId, nodes }, wfExtra || {}))
  const mark = storage.journal.length
  const out = await withLimit(svc.runWorkflow(wfId, o.input || {}, undefined, o.opts), 25000, 'scenario ' + name)
  const run = rec('team_runs', 'runs', out.id)
  const writes = storage.journal.slice(mark).filter((w) => w.domain === 'team_runs' && w.key === out.id)
  const workers = calls.filter((c) => c.role === 'worker')
  const reviewers = calls.filter((c) => c.role === 'reviewer')
  const tasks = allTasks().filter((t) => t && t.workflowId === wfId)
  return { name, wfId, runId: out.id, status: out.status, run, writes, calls, workers, reviewers, tasks }
}
/** The node's status sequence as the run record actually saw it. */
function statusSeq(writes, nid) {
  const raw = []
  for (const w of writes) {
    const ns = w.value && w.value.nodeStates
    if (ns && ns[nid] && typeof ns[nid].status === 'string') raw.push(ns[nid].status)
  }
  return raw.filter((s, i) => i === 0 || s !== raw[i - 1])
}
const node = (id, extra) => Object.assign({ id, title: 'T-' + id, agent: 'Coder', dependsOn: [], taskTemplate: { requirement: 'R-' + id, acceptanceCriteria: 'A-' + id } }, extra || {})
const BLOCK_CRIT = '验收标准 A-1 要求交付物给出可执行的验证命令'
const BLOCK_EVID = '产物第 12 行只写了"已验证"，没有任何命令或输出'
const blockingFinding = (criterion, evidence) => ({ severity: 'blocking', dimension: '正确性', criterion, evidence, impact: '不修则该交付物无法验收', suggestion: '补上命令与原始输出' })
const advisoryFinding = () => ({ severity: 'advisory', dimension: '优化空间', criterion: '可以更简洁', evidence: '第 3 段把同一说明重复了两遍，可删', impact: '无', suggestion: '删掉重复段' })
function verdictJson(o) {
  return '```json\n' + JSON.stringify(Object.assign({ verdict: 'pass', score: 80, summary: 'stub 结论', findings: [], resolved: [], uncertainties: [] }, o)) + '\n```'
}
/** The one agent definition every scenario's worker resolves to. */
await svc.upsertAgent({ id: 'Coder', name: 'Coder', role: '编码者', updatedAt: 1 })

const FAILING_PLAN = (c) => (c.role === 'worker' && c.nodeId === 'n1' ? { startError: 'BOOM-worker-n1' } : { text: 'WORKER-OUT-' + c.nodeId })

// ===========================================================================
console.log('\n--- GROUP A: 默认不变（不声明 haltOnFailure 时逐字等于改动前） ---')
// ---------------------------------------------------------------------------
// A1. The control experiment the whole feature is measured against: a linear
//     chain whose FIRST node fails. Before P13 (and still, without the flag) the
//     failure does not stop anything -- and the `result` key set must be exactly
//     the pre-P13 one. Deleting the `haltOnFailure === true` gate (i.e. halting
//     unconditionally) turns A1.3/A1.4/A1.5 red.
// ---------------------------------------------------------------------------
let A1 = null
try {
  A1 = await scenario('default-linear', { n1: node('n1'), n2: node('n2', { dependsOn: ['n1'] }), n3: node('n3', { dependsOn: ['n2'] }) }, null, FAILING_PLAN)
  const st = A1.run.nodeStates
  check('A1.1 不声明 haltOnFailure：失败节点仍记为 failed，且带真实 error 文本（基线事实）',
    st.n1.status === 'failed' && String(st.n1.error).indexOf('BOOM-worker-n1') !== -1, JSON.stringify({ status: st.n1.status, error: st.n1.error }))
  check('A1.2 不声明 haltOnFailure：下游照跑完 —— n2/n3 都派发了 worker 且都是 completed（这正是本能力要解决的问题）',
    A1.workers.filter((w) => w.nodeId === 'n2').length === 1 && A1.workers.filter((w) => w.nodeId === 'n3').length === 1 &&
    st.n2.status === 'completed' && st.n3.status === 'completed',
    JSON.stringify({ n2: st.n2.status, n3: st.n3.status, workers: A1.workers.map((w) => w.nodeId) }))
  check('A1.3 不声明 haltOnFailure：运行整体状态仍是 failed（不是 halted、不是 completed）',
    A1.status === 'failed' && A1.run.status === 'failed', 'status=' + String(A1.status))
  check('A1.4 [默认不变] result 的键集与改动前逐字一致：恰好 outputs/summary/reviews 三键，没有 haltedBy/haltReason/skipped',
    eq(Object.keys(A1.run.result).sort(), ['outputs', 'reviews', 'summary']), 'keys=' + Object.keys(A1.run.result).join(','))
  check('A1.5 [默认不变] result.haltedBy / result.haltReason / result.skipped 三个键根本不存在（不是 null、不是空数组）',
    !('haltedBy' in A1.run.result) && !('haltReason' in A1.run.result) && !('skipped' in A1.run.result),
    JSON.stringify({ haltedBy: A1.run.result.haltedBy, haltReason: A1.run.result.haltReason, skipped: A1.run.result.skipped }))
  check('A1.6 [默认不变] 失败节点对依赖仍算 completed：下游拿到了产物（outputs 里有 n2/n3，没有 n1）',
    A1.run.result.outputs.n2 !== undefined && A1.run.result.outputs.n3 !== undefined && A1.run.result.outputs.n1 === undefined,
    Object.keys(A1.run.result.outputs).join(','))
  check('A1.7 [默认不变] 没有任何节点被标成 skipped（新状态不许无端出现）',
    A1.writes.every((w) => Object.values(w.value.nodeStates || {}).every((s) => s.status !== 'skipped')),
    A1.writes.map((w) => Object.entries(w.value.nodeStates || {}).map(([k, v]) => k + ':' + v.status).join('|')).slice(-1)[0])
  check('A1.8 [默认不变] 无 reviewer 的节点不得凭空写 review 键（P13 没有碰这条既有契约）',
    !('review' in st.n1) && !('review' in st.n2), Object.keys(st.n1).join(','))
  check('A1.9 落库的 run 记录仍能通过 runs 域的 zod 校验（新状态枚举是加值，旧形状不炸）',
    runsDomainSchema.safeParse(A1.run).success)
  check('A1.10 [默认不变] 状态序列与改动前逐字一致：n1 是 working>failed，n2 是 working>completed',
    statusSeq(A1.writes, 'n1').join('>') === 'working>failed' && statusSeq(A1.writes, 'n2').join('>') === 'working>completed',
    'n1=' + statusSeq(A1.writes, 'n1').join('>') + ' n2=' + statusSeq(A1.writes, 'n2').join('>'))
} catch (e) { blockFailure('A1 场景（默认不变）', e) }

// ---------------------------------------------------------------------------
// A2. haltOnFailure:false is the same promise as absent. A run that declares the
//     flag explicitly OFF must be indistinguishable from A1 -- so "the flag is
//     read" is not confused with "absence behaves".
// ---------------------------------------------------------------------------
try {
  const s = await scenario('explicit-false', { n1: node('n1'), n2: node('n2', { dependsOn: ['n1'] }) }, { haltOnFailure: false }, FAILING_PLAN)
  check('A2.1 haltOnFailure:false 与不声明完全一致：下游仍跑完、状态 failed',
    s.run.nodeStates.n2.status === 'completed' && s.status === 'failed', JSON.stringify({ n2: s.run.nodeStates.n2.status, status: s.status }))
  check('A2.2 haltOnFailure:false 时 result 仍无 haltedBy/skipped 键（false 不得被当成"开了"）',
    !('haltedBy' in s.run.result) && !('skipped' in s.run.result), Object.keys(s.run.result).join(','))
} catch (e) { blockFailure('A2 场景（显式 false）', e) }

// ===========================================================================
console.log('\n--- GROUP B: 失败即停（haltOnFailure: true + 节点失败） ---')
// ---------------------------------------------------------------------------
// B1. A four-node chain whose first node fails. Asserted on RECORDS, not on the
//     returned status alone: "halted" must be materialised as skipped nodes with
//     blockedBy, and the never-started nodes must never have been dispatched.
//     Deleting `if (haltedBy !== null) break;` turns B1.2/B1.3/B1.6 red.
// ---------------------------------------------------------------------------
let B1 = null
try {
  B1 = await scenario('halt-linear',
    { n1: node('n1'), n2: node('n2', { dependsOn: ['n1'] }), n3: node('n3', { dependsOn: ['n2'] }), n4: node('n4', { dependsOn: ['n3'] }) },
    { haltOnFailure: true }, FAILING_PLAN)
  const st = B1.run.nodeStates
  check('B1.1 失败节点自身仍被如实记为 failed 并保留 error（停的是流程，不是掩盖失败）',
    st.n1.status === 'failed' && String(st.n1.error).indexOf('BOOM-worker-n1') !== -1, JSON.stringify({ s: st.n1.status, e: st.n1.error }))
  check('B1.2 未开始的三个节点全部记为 skipped，并带 blockedBy="n1"',
    ['n2', 'n3', 'n4'].every((id) => st[id].status === 'skipped' && st[id].blockedBy === 'n1'),
    ['n2', 'n3', 'n4'].map((id) => id + ':' + st[id].status + '/' + String(st[id].blockedBy)).join(' '))
  check('B1.3 skipped 节点的 endedAt 保持 null（没发生过的事不许编一个结束时刻）',
    ['n2', 'n3', 'n4'].every((id) => st[id].endedAt === null), ['n2', 'n3', 'n4'].map((id) => id + '=' + String(st[id].endedAt)).join(' '))
  check('B1.4 运行最终状态是 halted，且落库记录的 status 也是 halted',
    B1.status === 'halted' && B1.run.status === 'halted', 'status=' + String(B1.status))
  check('B1.5 result.skipped 精确等于未开始的节点，顺序与 DAG 定义一致',
    eq(B1.run.result.skipped, ['n2', 'n3', 'n4']), JSON.stringify(B1.run.result.skipped))
  check('B1.6 result.haltedBy === "n1" 且 result.haltReason === "node-failed"（两个触发原因必须可区分）',
    B1.run.result.haltedBy === 'n1' && B1.run.result.haltReason === 'node-failed',
    JSON.stringify({ haltedBy: B1.run.result.haltedBy, haltReason: B1.run.result.haltReason }))
  check('B1.7 skipped 节点根本没被派发：worker 调用里只有 n1（"未开始"是事实，不是文案）',
    B1.workers.length === 1 && B1.workers[0].nodeId === 'n1', 'workers=' + JSON.stringify(B1.workers.map((w) => w.nodeId)))
  check('B1.8 skipped 节点从未进入 working（状态序列里没有 working —— 记录不得说谎）',
    ['n2', 'n3', 'n4'].every((id) => statusSeq(B1.writes, id).indexOf('working') === -1),
    ['n2', 'n3', 'n4'].map((id) => id + '=' + statusSeq(B1.writes, id).join('>')).join(' '))
  check('B1.9 skipped 节点上没有 output（没有产物就不得写产物字段）',
    ['n2', 'n3', 'n4'].every((id) => st[id].output === undefined), ['n2', 'n3', 'n4'].map((id) => id + '=' + String(st[id].output)).join(' '))
  check('B1.10 result.outputs 里没有任何被跳过节点的"幽灵产物"（未执行的步骤不得留下产物位）',
    ['n2', 'n3', 'n4'].every((id) => B1.run.result.outputs[id] === undefined),
    'outputs keys=' + Object.keys(B1.run.result.outputs).join(','))
  check('B1.11 summary 明写 halted 与原因、以及被跳过的节点（读记录的人不必猜）',
    typeof B1.run.result.summary === 'string' && B1.run.result.summary.indexOf('halted') !== -1 && B1.run.result.summary.indexOf('failed') !== -1 && B1.run.result.summary.indexOf('n4') !== -1,
    String(B1.run.result.summary))
  check('B1.12 halted 运行的结果也能通过 runs 域校验（新状态是合法记录，不是脏数据）',
    runsDomainSchema.safeParse(B1.run).success)
  check('B1.13 halted 节点的任务台账：失败节点一个任务、skipped 节点零任务（没有派发就没有台账）',
    B1.tasks.length === 1 && B1.tasks[0].nodeId === 'n1', 'tasks=' + JSON.stringify(B1.tasks.map((t) => t.nodeId)))
} catch (e) { blockFailure('B1 场景（失败即停）', e) }

// ---------------------------------------------------------------------------
// B2. The whole-run (not just the causal chain) promise: a branch that does NOT
//     depend on the failed node, and whose nodes are in a LATER wave, must be
//     skipped too. A one-line change from `for (const nid of nodeIds)` to "walk
//     dependsOn from haltedBy" would leave p1/p2 running and turn B2.1 red.
//     (`head` deliberately shares wave 0 with n1 so that p1 is genuinely in a
//     later wave -- otherwise "skipped" would be explained by "same wave is
//     allowed to run", which is the OTHER rule, not this one.)
// ---------------------------------------------------------------------------
try {
  const s = await scenario('halt-whole-run',
    { n1: node('n1'), head: node('head'), p1: node('p1', { dependsOn: ['head'] }), p2: node('p2', { dependsOn: ['p1'] }) },
    { haltOnFailure: true }, FAILING_PLAN)
  const st = s.run.nodeStates
  check('B2.1 与失败节点无关的并行分支也被跳过：p1/p2 都是 skipped（"停"是整次运行的，不是那一条链的）',
    st.p1.status === 'skipped' && st.p2.status === 'skipped', JSON.stringify({ p1: st.p1.status, p2: st.p2.status }))
  check('B2.2 被跳过的并行节点同样带 blockedBy="n1"，运行同样 halted',
    st.p1.blockedBy === 'n1' && st.p2.blockedBy === 'n1' && s.status === 'halted',
    JSON.stringify({ p1: st.p1.blockedBy, p2: st.p2.blockedBy, status: s.status }))
  // The control that makes B2.1 meaningful: `head` was in the FAILING wave, so it
  // ran and completed -- i.e. the skip of p1 is the halt's doing, not "p1 never
  // had a chance to run".
  check('B2.3 [对照] 与失败节点同波的 head 跑完了（completed），所以 p1 被跳过确实是停机导致的',
    st.head.status === 'completed', String(st.head.status))
  check('B2.4 被跳过的 p1/p2 从未被派发（worker 调用里没有它们）',
    s.workers.every((w) => w.nodeId !== 'p1' && w.nodeId !== 'p2'), JSON.stringify(s.workers.map((w) => w.nodeId)))
} catch (e) { blockFailure('B2 场景（整次运行级停机）', e) }

// ===========================================================================
console.log('\n--- GROUP C: 同波不杀（失败节点同波的兄弟仍跑完） ---')
// ---------------------------------------------------------------------------
// C1. `s1` and `s2` are independent (same wave). `s1` fails immediately; `s2` is
//     held in flight until s1's failure has certainly been RECORDED, and only
//     then released. The hold is deliberately released from the test AFTER the
//     dispatch is observed, never "when the run finishes" -- the run cannot
//     finish while s2 is held, so waiting on the run would deadlock (that wrong
//     version is what the first draft of this file did).
// ---------------------------------------------------------------------------
try {
  const hold = deferred()
  const started = { s2: false }
  const runP = scenario('same-wave', { s1: node('s1'), s2: node('s2'), s3: node('s3', { dependsOn: ['s2'] }) },
    { haltOnFailure: true },
    (c) => {
      if (c.role !== 'worker') return { text: 'R' }
      if (c.nodeId === 's1') return { startError: 'BOOM-worker-s1' }
      if (c.nodeId === 's2') { started.s2 = true; return { hold: hold.p, text: 'SIBLING-ARTIFACT-KEPT' } }
      return { text: 'W' }
    })
  for (let i = 0; i < 50 && !started.s2; i += 1) await sleep(20)
  check('C1.0 [夹具] 同波兄弟 s2 的派发确实发生过（否则后面的"跑完/产物保留"测的不是同波行为）', started.s2)
  // s1 fails immediately in the same microtask window; give the failure write a
  // turn of the event loop before releasing the sibling.
  await sleep(120)
  hold.res()
  const s = await runP
  const st = s.run.nodeStates
  check('C1.1 同波兄弟 s2 仍 completed（正在跑的节点允许跑完）', st.s2.status === 'completed', String(st.s2.status))
  check('C1.2 同波兄弟 s2 的产物被保留：outputs.s2 含它的原文，nodeStates.s2.output 也在',
    typeof s.run.result.outputs.s2 === 'string' && s.run.result.outputs.s2.indexOf('SIBLING-ARTIFACT-KEPT') !== -1 &&
    String(st.s2.output).indexOf('SIBLING-ARTIFACT-KEPT') !== -1,
    JSON.stringify({ out: String(s.run.result.outputs.s2).slice(0, 40), node: String(st.s2.output).slice(0, 40) }))
  check('C1.3 同波兄弟 s2 不得出现在 result.skipped 里（杀了它就是把真实工作扔掉）',
    Array.isArray(s.run.result.skipped) && s.run.result.skipped.indexOf('s2') === -1, JSON.stringify(s.run.result.skipped))
  check('C1.4 s2 的下游 s3（下一波）仍被跳过并带 blockedBy="s1"',
    st.s3.status === 'skipped' && st.s3.blockedBy === 's1', JSON.stringify({ s: st.s3.status, by: st.s3.blockedBy }))
  check('C1.5 运行仍是 halted，且 haltedBy 指向真正失败的 s1（不是同波的 s2）',
    s.status === 'halted' && s.run.result.haltedBy === 's1', JSON.stringify({ status: s.status, haltedBy: s.run.result.haltedBy }))
  check('C1.6 同波两个 worker 都被真的派发过（s2 不是"没跑就被算完成"）',
    s.workers.filter((w) => w.nodeId === 's1').length === 1 && s.workers.filter((w) => w.nodeId === 's2').length === 1,
    JSON.stringify(s.workers.map((w) => w.nodeId)))
} catch (e) { blockFailure('C1 场景（同波不杀）', e) }

// ===========================================================================
console.log('\n--- GROUP D: 无下游可 skip 时不得吞掉「就是失败了」 ---')
// ---------------------------------------------------------------------------
// D1. haltOnFailure:true + the ONLY node fails + nothing left to skip. The run
//     must be `failed`, NOT `halted`: `halted` describes a run that was stopped
//     before it could finish, and inventing it here would erase the difference
//     between "we crashed" and "we chose to stop". Changing the status expression
//     to `skipped.length > 0 || haltedBy !== null ? 'halted' : ...` turns D1.1 red.
// ---------------------------------------------------------------------------
let D1 = null
try {
  D1 = await scenario('halt-no-downstream', { n1: node('n1') }, { haltOnFailure: true }, FAILING_PLAN)
  check('D1.1 无下游可 skip 时状态是 failed，不是 halted（新状态不许吞掉"就是失败了"）',
    D1.status === 'failed' && D1.run.status === 'failed', 'status=' + String(D1.status))
  check('D1.2 无可 skip 时 result 仍没有 haltedBy/skipped 三键（键集契约优先）',
    !('haltedBy' in D1.run.result) && !('skipped' in D1.run.result) && !('haltReason' in D1.run.result), Object.keys(D1.run.result).join(','))
  check('D1.3 该节点的失败事实完整保留：status=failed + error 原文 + endedAt 有值',
    D1.run.nodeStates.n1.status === 'failed' && String(D1.run.nodeStates.n1.error).indexOf('BOOM-worker-n1') !== -1 && typeof D1.run.nodeStates.n1.endedAt === 'number',
    JSON.stringify({ s: D1.run.nodeStates.n1.status, e: D1.run.nodeStates.n1.error, endedAt: D1.run.nodeStates.n1.endedAt }))
} catch (e) { blockFailure('D1 场景（无下游）', e) }

// D2. The same rule for a failed node whose downstream ALREADY ran in the same
//     wave and completed: nothing is left to skip, so it is still `failed`.
try {
  const hold = deferred()
  const started = { a: false }
  const runP = scenario('halt-nothing-left-to-skip', { a: node('a'), b: node('b') }, { haltOnFailure: true },
    (c) => {
      if (c.role !== 'worker') return { text: 'R' }
      if (c.nodeId === 'a') { started.a = true; return { hold: hold.p, text: 'A-OK' } }
      return { startError: 'BOOM-worker-b' }
    })
  for (let i = 0; i < 50 && !started.a; i += 1) await sleep(20)
  check('D2.0 [夹具] 同波兄弟 a 已被派发（它的产物是后面"无剩余可跳过"的前提）', started.a)
  // b fails first; a is still in flight, so at failure time nothing is left to
  // skip (a cannot be un-run). Release a afterwards.
  await sleep(120)
  hold.res()
  const s = await runP
  check('D2.1 同波兄弟已完成后才失败、已无节点可 skip -> 状态仍是 failed（halted 只描述"有东西被砍掉"的收场）',
    s.run.nodeStates.a.status === 'completed' && s.run.nodeStates.b.status === 'failed' && s.status === 'failed',
    JSON.stringify({ a: s.run.nodeStates.a.status, b: s.run.nodeStates.b.status, status: s.status }))
  check('D2.2 该运行的 result 也不得凭空多出 skipped（空数组也不行：键集就是契约）',
    !('skipped' in s.run.result), Object.keys(s.run.result).join(','))
  check('D2.3 a 的产物保留（失败后仍然不许把同波已完成的工作抹掉）',
    typeof s.run.result.outputs.a === 'string' && s.run.result.outputs.a.indexOf('A-OK') !== -1, String(s.run.result.outputs.a).slice(0, 30))
} catch (e) { blockFailure('D2 场景（无剩余可跳过）', e) }

// ===========================================================================
console.log('\n--- GROUP E: 未解决的 blocking 是第二个触发（含最后一个节点的交点） ---')
// ---------------------------------------------------------------------------
// E1. The unresolved-blocking trigger with a downstream node. A review that
//     raises a qualified blocking item makes the node `rework`; the node-level
//     rework cap 0 means there is no budget to fix it, so the node ends
//     `unresolved: true` -- the second halt trigger. Deleting the
//     `haltReason = 'unresolved-blocking'` line turns E1.2/E1.3 red.
//     (The fixture MUST declare verdict 'rework': normalizeReview's R6 settles a
//     self-contradictory "pass with blocking findings" as `pass`, and the
//     scheduler then honours that, so such a review never reaches the cap. The
//     first draft of this file wrote 'pass' here and every E1 assertion failed --
//     which is exactly the fixture check E1.0 exists to catch.)
// ---------------------------------------------------------------------------
let E1 = null
try {
  E1 = await scenario('halt-unresolved-blocking',
    { n1: node('n1', { reviewer: 'Reviewer' }), n2: node('n2', { dependsOn: ['n1'] }) },
    { haltOnFailure: true, review: { maxRework: 0 } },
    (c) => {
      if (c.role !== 'reviewer') return { text: 'WORKER-E1' }
      return { text: verdictJson({ verdict: 'rework', score: 70, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
    })
  const st = E1.run.nodeStates
  const rv = st.n1.review || {}
  if (process.env.P13_DEBUG === '1') console.log('DBG E1 review=' + JSON.stringify(rv).slice(0, 2500))
  check('E1.0 [夹具] 该评审结论真的触顶成 unresolved（blockingCount=1 + unresolved=true），否则本组测的不是它该测的东西',
    rv.blockingCount === 1 && rv.unresolved === true, JSON.stringify({ blocking: rv.blockingCount, unresolved: rv.unresolved }))
  check('E1.1 触顶节点本身仍 completed（产物存在、结论已记录 —— 它不是"失败"）',
    st.n1.status === 'completed', String(st.n1.status))
  check('E1.2 触发停机：运行状态 halted，且 result.haltReason === "unresolved-blocking"（与 node-failed 必须可区分）',
    E1.status === 'halted' && E1.run.result.haltReason === 'unresolved-blocking',
    JSON.stringify({ status: E1.status, haltReason: E1.run.result.haltReason }))
  check('E1.3 result.haltedBy === "n1"（触发者是那个没能修好的节点）', E1.run.result.haltedBy === 'n1', String(E1.run.result.haltedBy))
  check('E1.4 下游 n2 被记为 skipped 且 blockedBy="n1"——不能让下游建在一个"不可信产物"上',
    st.n2.status === 'skipped' && st.n2.blockedBy === 'n1', JSON.stringify({ s: st.n2.status, by: st.n2.blockedBy }))
  check('E1.5 下游确实没被派发：worker 只有 n1 一次（评审不算 worker 派发）',
    E1.workers.filter((w) => w.nodeId === 'n2').length === 0, JSON.stringify(E1.workers.map((w) => w.nodeId)))
  check('E1.6 该节点只被派发一次（maxRework=0 时不许返工 —— 不能把 unresolved 变成无限返工）',
    E1.workers.length === 1, 'workers=' + String(E1.workers.length))
  check('E1.7 summary 明写 UNRESOLVED blocking review（读记录的人能一眼看出是哪一种停机，而不是只有机器可读的 haltReason）',
    typeof E1.run.result.summary === 'string' && E1.run.result.summary.indexOf('UNRESOLVED') !== -1 && E1.run.result.summary.indexOf('UNRESOLVED blocking review finding') !== -1,
    String(E1.run.result.summary))
} catch (e) { blockFailure('E1 场景（未解决 blocking 触发）', e) }

// ---------------------------------------------------------------------------
// E2 (P13-PLAN 4.1-4b). The intersection of "unresolved blocking" and "no
//     downstream": the unrepaired node is the LAST node, so `skipped` is empty.
//     If `halted` were derived from "something was skipped" alone, this run would
//     report `completed` -- a silent pass, which is the exact failure mode this
//     capability exists to prevent. Replacing the status expression with
//     `skipped.length > 0 ? 'halted' : ...` turns E2.1/E2.2 red.
// ---------------------------------------------------------------------------
let E2 = null
try {
  E2 = await scenario('unresolved-last-node', { only: node('only', { reviewer: 'Reviewer' }) },
    { haltOnFailure: true, review: { maxRework: 0 } },
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 70, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'WORKER-E2' }))
  check('E2.1 最后一个节点的阻塞项未解决 -> 状态是 halted，不是 completed（这是本能力要防的"静默通过"）',
    E2.status === 'halted' && E2.run.status === 'halted', 'status=' + String(E2.status))
  check('E2.2 result.haltReason === "unresolved-blocking" 且 result.skipped 是空数组（确实没有东西可跳过）',
    E2.run.result.haltReason === 'unresolved-blocking' && eq(E2.run.result.skipped, []),
    JSON.stringify({ reason: E2.run.result.haltReason, skipped: E2.run.result.skipped }))
  check('E2.3 result.haltedBy === "only"，节点自身 completed（没有把无辜的节点改成 failed）',
    E2.run.result.haltedBy === 'only' && E2.run.nodeStates.only.status === 'completed',
    JSON.stringify({ by: E2.run.result.haltedBy, s: E2.run.nodeStates.only.status }))
  check('E2.4 结果与其产物仍可用：outputs.only 存在（停机是状态的一部分，不是把记录毁掉）',
    typeof E2.run.result.outputs.only === 'string' && E2.run.result.outputs.only.indexOf('WORKER-E2') !== -1,
    String(E2.run.result.outputs.only).slice(0, 40))
  check('E2.5 halted 记录通过 runs 域校验（"没有 skipped 的 halted"也是合法记录）',
    runsDomainSchema.safeParse(E2.run).success)
} catch (e) { blockFailure('E2 场景（最后一个节点未解决）', e) }

// ---------------------------------------------------------------------------
// E3. Only advisory findings must NEVER halt: a reviewer that writes notes is not
//     a reviewer that blocked. Removing the `unresolved` condition (i.e. halting
//     on any finding) turns E3.1 red.
// ---------------------------------------------------------------------------
try {
  const s = await scenario('advisory-only', { n1: node('n1', { reviewer: 'Reviewer' }), n2: node('n2', { dependsOn: ['n1'] }) },
    { haltOnFailure: true, review: { maxRework: 0 } },
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 55, summary: '只是建议', findings: [advisoryFinding()] }) }
      : { text: 'WORKER-E3' }))
  const rv = s.run.nodeStates.n1.review || {}
  check('E3.1 [仅 advisory 不触发] 评审只有 advisory 时不触发停机：n2 照跑完、状态 completed',
    s.run.nodeStates.n1.status === 'completed' && s.run.nodeStates.n2.status === 'completed' && s.status === 'completed',
    JSON.stringify({ n1: s.run.nodeStates.n1.status, n2: s.run.nodeStates.n2.status, status: s.status }))
  check('E3.2 [仅 advisory 不触发] 无 skipped、无 haltedBy 键（advisory 不得被当成阻塞）',
    !('skipped' in s.run.result) && !('haltedBy' in s.run.result),
    JSON.stringify({ keys: Object.keys(s.run.result), blocking: rv.blockingCount, unresolved: rv.unresolved }))
  check('E3.3 [仅 advisory 不触发] 该结论确实不是"未解决阻塞"：blockingCount=0 且 unresolved=false（否则 E3 是假绿）',
    rv.blockingCount === 0 && rv.unresolved === false, JSON.stringify({ blocking: rv.blockingCount, unresolved: rv.unresolved }))
} catch (e) { blockFailure('E3 场景（仅 advisory）', e) }

// ---------------------------------------------------------------------------
// E4. A rework that actually satisfied the reviewer must not halt either: the
//     trigger is "still blocking at the cap", not "there was a blocking round".
// ---------------------------------------------------------------------------
try {
  const s = await scenario('rework-then-pass', { n1: node('n1', { reviewer: 'Reviewer' }), n2: node('n2', { dependsOn: ['n1'] }) },
    { haltOnFailure: true },
    (c) => {
      if (c.role !== 'reviewer') return { text: 'WORKER-E4' }
      return c.round >= 2
        ? { text: verdictJson({ verdict: 'pass', score: 88, findings: [], resolved: [{ finding: BLOCK_CRIT, resolved: true, evidence: 'v2 第 3 行已补命令' }] }) }
        : { text: verdictJson({ verdict: 'rework', score: 40, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
    })
  const rv = s.run.nodeStates.n1.review || {}
  check('E4.1 [返工后通过不触发] 真的返工过（worker 2 次 / 评审 2 次），不是"一次就过"的假夹具',
    s.workers.filter((w) => w.nodeId === 'n1').length === 2 && s.reviewers.length === 2,
    'workers=' + String(s.workers.length) + ' reviewers=' + String(s.reviewers.length))
  check('E4.2 [返工后通过不触发] 返工后通过：运行 completed、下游照跑、无 skipped/haltedBy',
    s.status === 'completed' && s.run.nodeStates.n2.status === 'completed' && !('skipped' in s.run.result) && !('haltedBy' in s.run.result),
    JSON.stringify({ status: s.status, n2: s.run.nodeStates.n2.status, keys: Object.keys(s.run.result) }))
  check('E4.3 [返工后通过不触发] 复审结论确实是 pass 且 unresolved=false（可审计）',
    rv.verdict === 'pass' && rv.unresolved === false && rv.rounds === 2, JSON.stringify({ v: rv.verdict, u: rv.unresolved, r: rv.rounds }))
} catch (e) { blockFailure('E4 场景（返工后通过）', e) }

// ---------------------------------------------------------------------------
// E5. R7 also fires when the re-review REWRITES the carried item and marks it
//     `resolved:false` -- the same unresolved-blocking halt must be reached, so
//     the halt cannot be bypassed by rephrasing the finding.
// ---------------------------------------------------------------------------
try {
  const s = await scenario('r7-rephrased-unresolved', { n1: node('n1', { reviewer: 'Reviewer' }), n2: node('n2', { dependsOn: ['n1'] }) },
    { haltOnFailure: true, review: { maxRework: 1 } },
    (c) => {
      if (c.role !== 'reviewer') return { text: 'WORKER-E5' }
      if (c.round >= 2) {
        return { text: verdictJson({ verdict: 'pass', score: 60, findings: [blockingFinding('换个说法的同一个问题：交付物仍未给出可执行验证命令', BLOCK_EVID)], resolved: [{ finding: BLOCK_CRIT, resolved: false, evidence: '第二轮复查仍然没有命令' }] }) }
      }
      return { text: verdictJson({ verdict: 'rework', score: 40, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
    })
  const rv = s.run.nodeStates.n1.review || {}
  check('E5.1 [R7 交互] 复审用新措辞承认未解决时仍被当作阻塞：那个节点 resolved 不了 -> unresolved=true',
    rv.unresolved === true, JSON.stringify({ unresolved: rv.unresolved, reason: String(rv.unresolvedReason).slice(0, 60) }))
  check('E5.2 [R7 交互] 这个 unresolved 同样触发停机：状态 halted + haltReason=unresolved-blocking + 下游 skipped',
    s.status === 'halted' && s.run.result.haltReason === 'unresolved-blocking' && s.run.nodeStates.n2.status === 'skipped',
    JSON.stringify({ status: s.status, reason: s.run.result.haltReason, n2: s.run.nodeStates.n2.status }))
  check('E5.3 [R7 交互] 返工额度真的用过一次（maxRework=1），说明这是"返工后仍未解决"而不是首轮直接触顶',
    s.workers.filter((w) => w.nodeId === 'n1').length === 2, 'workers=' + String(s.workers.filter((w) => w.nodeId === 'n1').length))
} catch (e) { blockFailure('E5 场景（R7 改写措辞）', e) }

// ---------------------------------------------------------------------------
// E6. A boundary the P13 implementation deliberately leaves alone, pinned here
//     because it is invisible otherwise: a reviewer whose JSON says
//     `verdict: "pass"` while ALSO listing a fully qualified blocking finding.
//     normalizeReview's R6 only rewrites the contradictory direction
//     ("rework" with nothing blocking -> pass); it does not turn "pass with
//     blocking findings" into a rework. The scheduler therefore honours the
//     verdict string and the node completes -- so the unresolved-blocking halt
//     is NOT reached, and the run is `completed`, not `halted`.
//     This is recorded as an OBSERVATION (O1), not as a defect: no plan clause
//     says a pass verdict with blocking findings must halt, and every assertion in
//     group E (the ones the plan DOES require) uses the honest
//     `verdict: "rework"` shape. The check exists so that if someone later makes
//     this halt, the change is deliberate and this line is updated with it.
// ---------------------------------------------------------------------------
try {
  const s = await scenario('pass-verdict-with-blocking',
    { n1: node('n1', { reviewer: 'Reviewer' }), n2: node('n2', { dependsOn: ['n1'] }) },
    { haltOnFailure: true, review: { maxRework: 0 } },
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'pass', score: 70, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'WORKER-E6' }))
  const rv = s.run.nodeStates.n1.review || {}
  check('E6.1 [观察 O1/边界] 评审者写 verdict:"pass" 但列了一条合规 blocking 时：R6 不反向改判，节点 completed、运行 completed（不会停机）',
    rv.verdict === 'pass' && rv.blockingCount === 1 && s.run.nodeStates.n1.status === 'completed' && s.status === 'completed',
    JSON.stringify({ verdict: rv.verdict, blocking: rv.blockingCount, node: s.run.nodeStates.n1.status, run: s.status }))
  check('E6.2 [观察 O1/边界] 该运行因此没有 haltedBy/skipped 键，下游照跑（这条边界的后果被如实记录下来）',
    !('haltedBy' in s.run.result) && !('skipped' in s.run.result) && s.run.nodeStates.n2.status === 'completed',
    JSON.stringify({ keys: Object.keys(s.run.result), n2: s.run.nodeStates.n2.status }))
} catch (e) { blockFailure('E6 场景（pass 携带 blocking 的边界）', e) }

// ===========================================================================
console.log('\n--- GROUP F: schema 与写路径（declared-but-unstored 缺陷类） ---')
// ---------------------------------------------------------------------------
// F1. `halted` must be a legal run status (a loosening), and old workflow records
//     without `haltOnFailure` must still validate, or the domain would refuse to
//     open on any pre-P13 storage file.
// ---------------------------------------------------------------------------
check('F1.1 runSchema 接受 status:"halted"（加值是放宽：不含它则每一次停机都写不进存储）',
  runsDomainSchema.safeParse({ id: 'r', status: 'halted', nodeStates: {}, startedAt: 1 }).success)
check('F1.2 runSchema 仍接受旧的四种终态（completed/failed/interrupted/cancelled）——本轮不得收窄既有枚举',
  ['completed', 'failed', 'interrupted', 'cancelled'].every((s) => runsDomainSchema.safeParse({ id: 'r', status: s, nodeStates: {}, startedAt: 1 }).success))
check('F1.3 旧记录（无 haltOnFailure 键）仍能通过 workflowSchema（域在旧存储文件上必须还能打开）',
  flowsSchema.safeParse({ id: 'w', nodes: {}, updatedAt: 1 }).success)
check('F1.4 workflowSchema 接受 haltOnFailure:true / false 两种声明',
  flowsSchema.safeParse({ id: 'w', nodes: {}, haltOnFailure: true, updatedAt: 1 }).success && flowsSchema.safeParse({ id: 'w', nodes: {}, haltOnFailure: false, updatedAt: 1 }).success)
check('F1.5 workflowSchema 拒绝 haltOnFailure 的非布尔值（"true" 字符串不得被悄悄当成开）',
  !flowsSchema.safeParse({ id: 'w', nodes: {}, haltOnFailure: 'true', updatedAt: 1 }).success)

// ---------------------------------------------------------------------------
// F2. The write path is the historical defect class: a field the schema accepts
//     but upsertWorkflow never stores is a capability nobody can declare. This is
//     asserted by READING BACK the stored record, not by trusting the return.
// ---------------------------------------------------------------------------
try {
  await svc.upsertWorkflow({ id: 'wf-p13c-store', name: 'store', nodes: { n1: node('n1') }, haltOnFailure: true })
  const stored = rec('team_workflows', 'flows', 'wf-p13c-store') || {}
  check('F2.1 haltOnFailure:true 经 upsertWorkflow 真的存住了（读回校验，不是看返回值）',
    stored.haltOnFailure === true, JSON.stringify(stored.haltOnFailure))
  await svc.upsertWorkflow({ id: 'wf-p13c-store2', name: 'store2', nodes: { n1: node('n1') } })
  const stored2 = rec('team_workflows', 'flows', 'wf-p13c-store2') || {}
  check('F2.2 不声明时存储记录里没有 haltOnFailure 键（不得默认写入一个 false 改变旧形状）',
    !('haltOnFailure' in stored2), Object.keys(stored2).join(','))
  check('F2.3 存住的记录能通过 workflowSchema（写路径与 schema 一致）', flowsSchema.safeParse(stored).success)
  // The write path must also be the one the SCHEDULER reads: a workflow created
  // through the API halts for real.
  const s = await scenario('api-written-halt', { n1: node('n1'), n2: node('n2', { dependsOn: ['n1'] }) }, { haltOnFailure: true }, FAILING_PLAN)
  check('F2.4 经写路径声明的工作流真的硬停（写面与调度面已打通：skipped + halted）',
    s.status === 'halted' && s.run.nodeStates.n2.status === 'skipped', JSON.stringify({ status: s.status, n2: s.run.nodeStates.n2.status }))
} catch (e) { blockFailure('F2 写路径', e) }

// ---------------------------------------------------------------------------
// F3. A run whose schedule is untouched (no halt declared) must not have grown
//     any key anywhere: the workflow-level record's shape is a contract too.
// ---------------------------------------------------------------------------
try {
  const wfBefore = rec('team_workflows', 'flows', 'wf-p13c-store2') || {}
  check('F3.1 [默认不变] 未声明停机的 workflow 记录键集仍是 id/name/nodes/updatedAt（没有凭空多出字段）',
    eq(Object.keys(wfBefore).sort(), ['id', 'name', 'nodes', 'updatedAt'].sort()), Object.keys(wfBefore).join(','))
} catch (e) { blockFailure('F3 workflow 记录形状', e) }

// ===========================================================================
console.log('\n--- GROUP G: /progress 投影（经真实 handler） ---')
// ---------------------------------------------------------------------------
// G1. A fixture run written straight into the in-memory domain, containing one
//     skipped node, one completed node and one never-started node. The projected
//     key sets are asserted EXACTLY: `blockedBy` exists only on the skipped node
//     (clean() drops the undefined), and totals keeps its nine keys with the
//     skipped node deliberately counted in `pending`.
// ---------------------------------------------------------------------------
const GWF = 'wf-p13c-fixture'
const GRUN = 'run-p13c-fixture'
const T0 = Date.now() - 300000
try {
  await svc.upsertWorkflow({
    id: GWF, name: 'P13-C 夹具工作流', haltOnFailure: true,
    nodes: {
      a: { id: 'a', title: 'A 完成', agent: 'Coder', dependsOn: [], taskTemplate: { requirement: 'R-a', acceptanceCriteria: 'A-a' } },
      b: { id: 'b', title: 'B 失败', agent: 'Coder', dependsOn: ['a'], taskTemplate: { requirement: 'R-b', acceptanceCriteria: 'A-b' } },
      c: { id: 'c', title: 'C 被跳过', agent: 'Coder', dependsOn: ['b'], taskTemplate: { requirement: 'R-c', acceptanceCriteria: 'A-c' } },
      d: { id: 'd', title: 'D 未开始', agent: 'Coder', dependsOn: ['c'], taskTemplate: { requirement: 'R-d', acceptanceCriteria: 'A-d' } },
    },
  })
  rawPut('team_runs', 'runs', GRUN, {
    id: GRUN, workflowId: GWF, status: 'halted', startedAt: T0, endedAt: T0 + 90000,
    result: { outputs: { a: 'A-OUT' }, summary: 'workflow halted: node b failed, 2 node(s) skipped (c, d)', reviews: {}, haltedBy: 'b', haltReason: 'node-failed', skipped: ['c', 'd'] },
    nodeStates: {
      a: { status: 'completed', assignee: 'Coder', startedAt: T0, endedAt: T0 + 30000, output: 'A-OUT', summary: 'A 完成' },
      b: { status: 'failed', assignee: 'Coder', startedAt: T0 + 30000, endedAt: T0 + 60000, error: 'BOOM-worker-b', summary: '失败：BOOM-worker-b' },
      c: { status: 'skipped', assignee: 'Coder', endedAt: null, summary: '未执行：运行在节点 b 失败后已停止', blockedBy: 'b' },
    },
  })
  const prog = await callRoute('/api/team-flowise/progress', 'runId=' + GRUN)
  const p = prog.json || {}
  const byId = {}
  for (const n of p.nodes || []) byId[n.id] = n
  const totalsKeys = Object.keys(p.totals || {}).sort()
  check('G1.1 /progress 经真实 handler 返回 ok:true 与本次 halted 运行（包含新的状态值）',
    prog.status === 200 && p.ok === true && (p.run || {}).status === 'halted', 'status=' + String(prog.status) + ' run=' + JSON.stringify(p.run && p.run.status))
  check('G1.2 skipped 节点投影带 status:"skipped" 与 blockedBy:"b"（客户端据此渲染"已跳过"）',
    byId.c !== undefined && byId.c.status === 'skipped' && byId.c.blockedBy === 'b',
    JSON.stringify(byId.c && { status: byId.c.status, blockedBy: byId.c.blockedBy }))
  check('G1.3 非 skipped 节点（completed/failed）没有 blockedBy 键 —— clean 丢掉 undefined，键集与改动前逐字一致',
    byId.a !== undefined && !('blockedBy' in byId.a) && byId.b !== undefined && !('blockedBy' in byId.b),
    JSON.stringify({ a: Object.keys(byId.a || {}).join(','), b: Object.keys(byId.b || {}).join(',') }))
  check('G1.4 完全没开始过的节点（无 nodeStates 记录）也没有 blockedBy 键（未派发不等于被跳过）',
    byId.d !== undefined && byId.d.status === 'pending' && !('blockedBy' in byId.d),
    JSON.stringify(byId.d && { status: byId.d.status, keys: Object.keys(byId.d).join(',') }))
  check('G1.5 totals 仍是既有 9 键（skipped 不得新增一个 totals 桶：roll-up 键集是客户端锁定的稳定性契约）',
    eq(totalsKeys, ['completed', 'failed', 'pending', 'percent', 'reviewing', 'rework', 'total', 'unresolved', 'working'].sort()), totalsKeys.join(','))
  check('G1.6 bucketOf("skipped") 故意归 pending：4 个节点里 completed=1 / failed=1 / pending=2，且 total=4',
    p.totals.completed === 1 && p.totals.failed === 1 && p.totals.pending === 2 && p.totals.total === 4,
    JSON.stringify(p.totals))
  check('G1.7 percent 口径未变（仍按 completed/total：1/4 -> 25，不得把 skipped 算成完成）',
    p.totals.percent === 25, 'percent=' + String(p.totals.percent))
  check('G1.8 skipped 节点的 endedAt 投影为 null，startedAt 也为 null（记录不许编造时刻）',
    byId.c.endedAt === null && byId.c.startedAt === null, JSON.stringify({ startedAt: byId.c.startedAt, endedAt: byId.c.endedAt }))
  check('G1.9 skipped 节点没有任何产出字段的值（output 为 null）', byId.c.output === null, String(byId.c.output))
  check('G1.10 roles 汇总里 skipped 归 pending，且 roles 名字集合仍恰好是节点负责人集合（评审者不进泳道）',
    (() => {
      const c = (p.roles || []).find((r) => r.name === 'Coder')
      return c !== undefined && c.total === 4 && c.completed === 1 && c.failed === 1 && c.pending === 2
    })(), JSON.stringify(p.roles))
  check('G1.11 haltReason/skipped 这类运行级信息不得挤进 /progress 的 totals（键集契约优先）',
    !('skipped' in (p.totals || {})) && !('haltedBy' in (p.totals || {})), Object.keys(p.totals || {}).join(','))
} catch (e) { blockFailure('G1 /progress 投影', e) }

// ===========================================================================
console.log('\n--- GROUP H: 客户端半（真实 bundle + 桩 React/DOM + 桩 fetch） ---')
// ---------------------------------------------------------------------------
// The bundle is re-evaluated from SOURCE here, exactly as p8-acceptance.mjs does,
// because the harness's own materializeBundle stubs setTimeout/setInterval to
// no-ops, which would make the page's poll loop undrivable. P13_CLIENT_SRC lets
// the mutation runs break a COPY of it in the temp dir.
// ---------------------------------------------------------------------------
const helpers = readFileSync(HARNESS, 'utf8')
const { createReactStub, makeDocument, flatten, findNode, walk } = new Function(
  helpers + '\nreturn { createReactStub, makeDocument, flatten, findNode, walk }',
)()
const SCALE = Number(process.env.SCALE || 50) // 3000ms poll -> 60ms
const allDisposers = []
const collect = (list) => { for (const d of list) allDisposers.push(d) }
const realFetch = globalThis.fetch

const clientSource = readFileSync(CLIENT_SRC, 'utf8')
check('H0.1 客户端 bundle 仍是单个自注册工厂 window.__ModuleLoader__.load({ id, factory }) 结构（本轮不得换成别的加载形态）',
  /window\s*\.\s*__ModuleLoader__\s*\.\s*load\s*\(\s*\{/.test(clientSource), String((/window\s*\.\s*__ModuleLoader__\s*\.\s*load\s*\(\s*\{/.exec(clientSource) || ['no match'])[0]))

let bundle = null
let TABLES = { NODE_STATUS: {}, RUN_STATUS: {}, nodeInfo: null, runInfo: null, tableError: 'bundle not evaluated' }
try {
  const react = createReactStub()
  const regs = []
  const windowStub = { __ModuleLoader__: { load(r) { regs.push(r) } }, devicePixelRatio: 2 }
  const requireStub = (spec) => {
    if (spec === 'react') return react
    if (spec === 'react/jsx-runtime') return { jsx: react.createElement, jsxs: react.createElement }
    throw new Error('unexpected external require: ' + spec)
  }
  new Function('window', 'require', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis', clientSource)(
    windowStub, requireStub, makeDocument(),
    (fn, ms) => setTimeout(fn, ms === undefined ? 0 : ms / SCALE),
    (id) => clearTimeout(id),
    (fn, ms) => setInterval(fn, Math.max(10, (ms === undefined ? 0 : ms) / SCALE)),
    (id) => clearInterval(id),
    globalThis,
  )
  if (regs.length !== 1) throw new Error('bundle registered ' + regs.length + ' factories')
  bundle = { react, face: regs[0].factory(requireStub) }
} catch (e) { blockFailure('H0 bundle 求值', e) }

/**
 * Read the two status tables out of the bundle SOURCE.
 *
 * WHY source and not the runtime: `NODE_STATUS` / `RUN_STATUS` are closure-local
 * to the bundle's factory and nothing on the plugin face publishes them, so there
 * is no runtime handle to read. Appending a probe statement to the factory body
 * does NOT work either -- the bundle source carries a leading BOM that the real
 * `__ModuleLoader__` tolerates but `new Function` does not, so the probe runs
 * outside the factory and every name resolves to `undefined` (that first attempt
 * is why this function exists). The status tables are therefore extracted with a
 * brace-balanced slice of the two `var ... = {` literals plus the colour
 * variables they reference -- both are pure literal data, and the extraction is
 * self-checking: it returns null (and the H1.x checks go red) the moment the
 * shape stops being readable.
 */
function balancedSlice(text, from) {
  const start = text.indexOf(from)
  if (start === -1) return null
  const end = start + from.length - 1
  let depth = 0
  for (let i = end; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}
function extractStatusTables(src) {
  const ns = balancedSlice(src, 'var NODE_STATUS = {')
  const rs = balancedSlice(src, 'var RUN_STATUS = {')
  if (ns === null || rs === null) return null
  const vars = []
  const re = /var\s+([A-Z][A-Z0-9_]*)\s*=\s*'(#[0-9a-fA-F]{3,8})';/g
  let m
  while ((m = re.exec(src)) !== null) vars.push([m[1], m[2]])
  if (vars.length < 4) return null
  const decls = vars.map(([n, v]) => 'var ' + n + ' = ' + JSON.stringify(v) + ';').join('\n')
  try {
    // eslint-disable-next-line no-new-func
    const evalTables = new Function(decls + '\n' + ns + '\n' + rs + '\nreturn { NODE_STATUS: NODE_STATUS, RUN_STATUS: RUN_STATUS };')
    const out = evalTables()
    const nodeInfo = (status) => out.NODE_STATUS[status] || out.NODE_STATUS.pending
    const runInfo = (status) => out.RUN_STATUS[status] || { label: String(status || '未知'), color: '#9aa0a6' }
    return { NODE_STATUS: out.NODE_STATUS, RUN_STATUS: out.RUN_STATUS, nodeInfo, runInfo, tableError: null }
  } catch (e) { return { NODE_STATUS: {}, RUN_STATUS: {}, nodeInfo: null, runInfo: null, tableError: String(e && e.message ? e.message : e) } }
}
if (bundle !== null) {
  const t = extractStatusTables(clientSource)
  TABLES = t === null ? { NODE_STATUS: {}, RUN_STATUS: {}, nodeInfo: null, runInfo: null, tableError: 'status table literals not found in the bundle source' } : t
}

check('H1.0 能从 bundle 源码里完整读出 NODE_STATUS / RUN_STATUS 两个字面表（读不出 = H1 系列没有依据，必须红）',
  TABLES.tableError === null && Object.keys(TABLES.NODE_STATUS).length >= 6 && Object.keys(TABLES.RUN_STATUS).length >= 5,
  String(TABLES.tableError) + ' node=' + Object.keys(TABLES.NODE_STATUS).join(',') + ' run=' + Object.keys(TABLES.RUN_STATUS).join(','))
const NS = TABLES.NODE_STATUS
const RS = TABLES.RUN_STATUS
check('H1.1 NODE_STATUS 新增 skipped 项，标签是「已跳过」（不是「等待」也不是「失败」）',
  NS.skipped !== undefined && NS.skipped.label === '已跳过', JSON.stringify(NS.skipped))
check('H1.2 NODE_STATUS.skipped 有独立颜色与标记（与 pending/failed 都不同：一眼可辨）',
  NS.skipped !== undefined && NS.pending !== undefined && NS.failed !== undefined &&
  NS.skipped.color !== NS.pending.color && NS.skipped.color !== NS.failed.color &&
  NS.skipped.label !== NS.pending.label && NS.skipped.label !== NS.failed.label,
  JSON.stringify({ skipped: NS.skipped, pending: NS.pending && NS.pending.label, failed: NS.failed && NS.failed.label }))
check('H1.3 RUN_STATUS 新增 halted 项，标签是「已停止（未跑完）」',
  RS.halted !== undefined && RS.halted.label === '已停止（未跑完）', JSON.stringify(RS.halted))
check('H1.4 RUN_STATUS.halted 与 failed 文案/颜色都不同（"停了"不等于"失败了"）',
  RS.halted !== undefined && RS.failed !== undefined && RS.halted.label !== RS.failed.label && RS.halted.color !== RS.failed.color,
  JSON.stringify({ halted: RS.halted, failed: RS.failed && RS.failed.label }))
check('H1.5 nodeInfo("skipped") 真的解析到 skipped 项（表里加了但查表函数不认的话，界面仍会退化成「等待」）',
  typeof TABLES.nodeInfo === 'function' && TABLES.nodeInfo('skipped').label === '已跳过',
  JSON.stringify(typeof TABLES.nodeInfo === 'function' ? TABLES.nodeInfo('skipped') : 'no nodeInfo'))
check('H1.6 runInfo("halted") 真的解析到 halted 项（头部标签走的就是这个函数）',
  typeof TABLES.runInfo === 'function' && TABLES.runInfo('halted').label === '已停止（未跑完）',
  JSON.stringify(typeof TABLES.runInfo === 'function' ? TABLES.runInfo('halted') : 'no runInfo'))
check('H1.7 既有状态一个都没丢（本轮只加值：pending/working/reviewing/rework/completed/failed 六项仍在）',
  ['pending', 'working', 'reviewing', 'rework', 'completed', 'failed'].every((k) => NS[k] !== undefined) &&
  ['running', 'completed', 'failed', 'cancelled', 'interrupted'].every((k) => RS[k] !== undefined),
  Object.keys(NS).join(',') + ' | ' + Object.keys(RS).join(','))
check('H1.8 未知状态仍退化为 pending（不在表里的状态不得让 nodeInfo 抛异常）',
  typeof TABLES.nodeInfo === 'function' && TABLES.nodeInfo('没这个状态') !== undefined && TABLES.nodeInfo('没这个状态').label === NS.pending.label,
  JSON.stringify(typeof TABLES.nodeInfo === 'function' ? TABLES.nodeInfo('没这个状态') : 'no nodeInfo'))

// ---- the render fixtures ----
const NOW = Date.now()
const RUN_HALTED = {
  id: 'run-p13c-halted', workflowId: 'wf-p13c', workflowName: 'P13-C 夹具工作流', status: 'halted',
  startedAt: NOW - 120000, endedAt: NOW - 30000,
  nodeStates: { intake: { status: 'completed' }, verify: { status: 'failed' }, risk: { status: 'skipped' }, report: { status: 'skipped' } },
}
const RUN_PLAIN = {
  id: 'run-p13c-plain', workflowId: 'wf-p13c', workflowName: 'P13-C 夹具工作流', status: 'running',
  startedAt: NOW - 120000, endedAt: null,
  nodeStates: { intake: { status: 'completed' }, verify: { status: 'working' }, risk: { status: 'pending' }, report: { status: 'pending' } },
}
const NODES_HALTED = [
  { id: 'intake', order: 0, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 120000, endedAt: NOW - 90000, elapsedMs: 30000, title: '资料受理', brief: '受理资料', dependsOn: [], reviewer: null, review: null, output: 'INTAKE-OK', error: null, summary: '受理完成' },
  { id: 'verify', order: 1, agent: 'Coder', agentName: 'Coder', status: 'failed', startedAt: NOW - 90000, endedAt: NOW - 60000, elapsedMs: 30000, title: '中登网核验', brief: '核验权属', dependsOn: ['intake'], reviewer: null, review: null, output: null, error: 'BOOM-verify', summary: '失败：BOOM-verify' },
  { id: 'risk', order: 2, agent: 'Coder', agentName: 'Coder', status: 'skipped', startedAt: null, endedAt: null, elapsedMs: null, title: '风险计量', brief: '计量风险', dependsOn: ['verify'], reviewer: null, review: null, output: null, error: null, summary: '未执行：运行在节点 verify 失败后已停止', blockedBy: 'verify' },
  { id: 'report', order: 3, agent: 'Coder', agentName: 'Coder', status: 'skipped', startedAt: null, endedAt: null, elapsedMs: null, title: '报告出具', brief: '出具报告', dependsOn: ['risk'], reviewer: null, review: null, output: null, error: null, summary: '未执行：运行在节点 verify 失败后已停止', blockedBy: 'verify' },
]
const NODES_PLAIN = [
  { id: 'intake', order: 0, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: NOW - 120000, endedAt: NOW - 90000, elapsedMs: 30000, title: '资料受理', brief: '受理资料', dependsOn: [], reviewer: null, review: null, output: 'INTAKE-OK', error: null, summary: '受理完成' },
  { id: 'verify', order: 1, agent: 'Coder', agentName: 'Coder', status: 'working', startedAt: NOW - 60000, endedAt: null, elapsedMs: 60000, title: '中登网核验', brief: '核验权属', dependsOn: ['intake'], reviewer: null, review: null, output: null, error: null, summary: null },
  { id: 'risk', order: 2, agent: 'Coder', agentName: 'Coder', status: 'pending', startedAt: null, endedAt: null, elapsedMs: null, title: '风险计量', brief: '计量风险', dependsOn: ['verify'], reviewer: null, review: null, output: null, error: null, summary: null },
  { id: 'report', order: 3, agent: 'Coder', agentName: 'Coder', status: 'pending', startedAt: null, endedAt: null, elapsedMs: null, title: '报告出具', brief: '出具报告', dependsOn: ['risk'], reviewer: null, review: null, output: null, error: null, summary: null },
]
function envOf(run, nodes) {
  return {
    ok: true, run,
    nodes, roles: [{ name: 'Coder', total: 4, completed: 1, failed: run.status === 'halted' ? 1 : 0, working: run.status === 'halted' ? 0 : 1, reviewing: 0, rework: 0, pending: run.status === 'halted' ? 2 : 2, elapsedMs: 30000 }],
    reviewers: [],
    totals: {
      total: 4, completed: 1, failed: run.status === 'halted' ? 1 : 0, working: run.status === 'halted' ? 0 : 1,
      reviewing: 0, rework: 0, unresolved: 0, pending: 2, percent: 25,
    },
  }
}
function stubFetch(progressAnswer) {
  globalThis.fetch = (input) => {
    const raw = String(typeof input === 'string' ? input : input.url)
    const url = new URL(raw, 'http://x')
    if (url.pathname === '/api/team-flowise/progress') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(progressAnswer) })
    if (url.pathname === '/api/team-flowise/runs') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs: [progressAnswer.run] }) })
    if (url.pathname === '/api/team-flowise/workflows') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ workflows: [{ id: 'wf-p13c', name: 'P13-C 夹具工作流', nodes: {} }] }) })
    if (url.pathname === '/api/team-flowise/role') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, run: null, role: null, nodes: [], reviews: [] }) })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }
}
/** The main-surface slot captures the progress page component. */
function captureSlots(face) {
  const regs = []
  const slots = {
    inject(_name, cb) { return cb() },
    register(options, component) { regs.push({ options, component }); return () => {} },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return { register() { return () => {} } }
      return undefined
    },
    effect(cb) { const d = cb(); if (typeof d === 'function') allDisposers.push(d); return () => {} },
    logger: { warn() {}, error() {}, info() {} },
  }
  let error
  try { face.apply(ctx) } catch (e) { error = e }
  return { regs, error }
}
/** Mount the progress page against one fixture and return its rendered text. */
async function renderPage(progressAnswer) {
  stubFetch(progressAnswer)
  const applied = captureSlots(bundle.face)
  const mainReg = applied.regs.filter((r) => r.options.name === 'main')[0]
  if (mainReg === undefined) throw new Error('no main registration (progress page)')
  const react = bundle.react
  react.render(react.createElement(mainReg.component))
  react.settle()
  let tree = null
  for (let i = 0; i < 3; i += 1) { collect(react.flushEffects()); await sleep(25); react.settle() }
  await sleep(25)
  react.settle()
  tree = react.render(react.createElement(mainReg.component))
  return { tree, text: flatten(tree) }
}

let haltedPage = null
try {
  haltedPage = await renderPage(envOf(RUN_HALTED, NODES_HALTED))
  check('H2.1 halted 运行的进度页能渲染出来（没有抛异常、不是空串）', haltedPage.text.length > 0, 'len=' + String(haltedPage.text.length))
  check('H2.2 头部把 halted 渲染成「已停止（未跑完）」，而不是「失败」或「运行中」',
    haltedPage.text.indexOf('已停止（未跑完）') !== -1 && haltedPage.text.indexOf('运行中') === -1,
    haltedPage.text.slice(0, 240))
  check('H2.3 [haltBlock] halted 运行渲染出停机说明：写明因哪个节点停下 + 几个步骤未执行',
    haltedPage.text.indexOf('本次运行已停止') !== -1 && haltedPage.text.indexOf('节点 verify 失败后不再继续') !== -1 && haltedPage.text.indexOf('2 个步骤未执行') !== -1,
    haltedPage.text.slice(0, 420))
  check('H2.4 [haltBlock] 说明里逐个列出未执行节点 id（不是只给一个数量）',
    haltedPage.text.indexOf('2 个步骤未执行（risk、report）') !== -1,
    '需要「2 个步骤未执行（risk、report）」这一句，实际=' + String(haltedPage.text.indexOf('2 个步骤未执行') !== -1) + ' risk=' + String(haltedPage.text.indexOf('risk') !== -1) + ' report=' + String(haltedPage.text.indexOf('report') !== -1))
  check('H2.5 [haltBlock] 明确告诉读者"下游结论没有生成，不要把未执行步骤当作已完成"',
    haltedPage.text.indexOf('下游结论') !== -1 && haltedPage.text.indexOf('没有') !== -1 && haltedPage.text.indexOf('不要把未执行的步骤当作') !== -1,
    haltedPage.text.slice(0, 460))
  check('H2.6 skipped 节点渲染出「未执行（运行已停止）」而不是「尚未派发（等待依赖）」',
    haltedPage.text.indexOf('未执行（运行已停止）') !== -1 && haltedPage.text.indexOf('尚未派发') === -1,
    '已停止=' + String(haltedPage.text.indexOf('未执行（运行已停止）') !== -1) + ' 尚未派发=' + String(haltedPage.text.indexOf('尚未派发') !== -1))
  // The halt-free fixture is rendered BEFORE the colour comparison below: the
  // "已跳过 vs 等待" difference is only meaningful as a comparison between the
  // two pages, and each is measured with the same walker.
  const plainPage = await renderPage(envOf(RUN_PLAIN, NODES_PLAIN))
  /**
   * Every colour a node-row label was painted in.
   *
   * WHY "subtree text" and not "the text node's own props.fill": this stub React
   * turns string children into a separate child element (`type: '#text'`, empty
   * props), so the `<text fill=...>` element and the string child are two
   * different nodes -- reading `fill` off the node that carries the string always
   * yields undefined (the first draft of this helper did exactly that and every
   * lookup came back empty).
   */
  const labelColorsOf = (node, label) => {
    const hits = []
    walk(node, (n) => {
      if (typeof n.type !== 'string' || n.type === '#text') return
      if (n.props === undefined || n.props.fill === undefined) return
      let hit = false
      walk(n, (c) => { if (typeof c.text === 'string' && c.text.indexOf(label) !== -1) hit = true })
      if (hit) hits.push(String(n.props.fill))
    })
    return hits
  }
  if (process.env.P13_DEBUG === '1') {
    console.log('DBG H2.7 halted labels=' + JSON.stringify(labelColorsOf(haltedPage.tree, '未执行（运行已停止）')))
    console.log('DBG H2.7 plain labels=' + JSON.stringify(labelColorsOf(plainPage.tree, '尚未派发')))
  }
  check('H2.7 skipped 节点在时序图里用「已跳过」的颜色画，而普通 pending 节点用等待色（两回事，不是同一种灰）',
    labelColorsOf(haltedPage.tree, '未执行（运行已停止）').indexOf(NS.skipped.color) !== -1 &&
    labelColorsOf(plainPage.tree, '尚未派发').indexOf(NS.pending.color) !== -1,
    '期望 skipped=' + String(NS.skipped.color) + ' pending=' + String(NS.pending.color) +
    ' | halted 页实际=' + JSON.stringify(labelColorsOf(haltedPage.tree, '未执行（运行已停止）')) +
    ' plain 页实际=' + JSON.stringify(labelColorsOf(plainPage.tree, '尚未派发')))
  check('H2.8 skipped 节点不算已派发：它的行上不得出现 «task» 派发标签（画了就是把没发生的事画成发生了）',
    haltedPage.text.indexOf('«task» 风险计量') === -1 && haltedPage.text.indexOf('«task» 报告出具') === -1,
    haltedPage.text.slice(0, 300))
  check('H2.9 真的派发过的节点仍带 «task»（不是把整张图都改成"未派发"）',
    haltedPage.text.indexOf('«task» 资料受理') !== -1 || haltedPage.text.indexOf('«task» 中登网核验') !== -1)
  check('H2.10 skipped 节点也不得画回程交付标签（未执行的东西没有产物可交付）',
    haltedPage.text.indexOf('«result» 已跳过') === -1 && haltedPage.text.indexOf('«failed» 已跳过') === -1)
  const haltedDump = haltedPage.text
  check('H3.1 未 halt 的运行（running 且含 pending 节点）不得出现 haltBlock：没有「本次运行已停止」',
    plainPage.text.indexOf('本次运行已停止') === -1, plainPage.text.slice(0, 240))
  check('H3.2 未 halt 的运行里未派发节点仍是既有文案「尚未派发（等待依赖）」（默认渲染逐字不变）',
    plainPage.text.indexOf('尚未派发') !== -1 && plainPage.text.indexOf('未执行（运行已停止）') === -1, plainPage.text.slice(0, 300))
  check('H3.3 未 halt 的运行里未派发节点用等待色（不是 halted 的琥珀色）：新配色不得泄漏到普通运行',
    labelColorsOf(plainPage.tree, '尚未派发').indexOf(NS.pending.color) !== -1 &&
    labelColorsOf(plainPage.tree, '尚未派发').indexOf(NS.skipped.color) === -1,
    'pending 色=' + String(NS.pending.color) + ' skipped 色=' + String(NS.skipped.color) +
    ' 实际=' + JSON.stringify(labelColorsOf(plainPage.tree, '尚未派发')))
  check('H3.4 [反例] 删掉 haltBlock 就变红：两个页面在"停机说明"上的差异正是它带来的（去掉后 H2.3 无依据）',
    haltedDump.indexOf('本次运行已停止') !== -1 && plainPage.text.indexOf('本次运行已停止') === -1,
    'halted 有=' + String(haltedDump.indexOf('本次运行已停止') !== -1) + ' plain 有=' + String(plainPage.text.indexOf('本次运行已停止') !== -1))
} catch (e) { blockFailure('H2/H3 客户端渲染', e) } finally { globalThis.fetch = realFetch }
globalThis.fetch = realFetch
for (const d of allDisposers) { try { d() } catch { /* ignore */ } }

// ===========================================================================
console.log('\n--- GROUP I: 变异测试（真的让检查变红，然后再恢复） ---')
// ---------------------------------------------------------------------------
// Every mutation is built as a COPY in the system temp dir (never in the repo),
// run from there, and deleted at the end. A host copy is made importable by
// rewriting its three bare specifiers to the absolute paths the package's own
// node_modules resolves to -- a plain copy would die with ERR_MODULE_NOT_FOUND
// because the temp dir has no node_modules.
// ===========================================================================
const MUT_TMP = join(tmpdir(), 'tf-p13c-mut-' + String(process.pid) + '-' + String(Date.now()))
const IMPORT_SPECS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain', 'zod']
function importableCopy(srcFile, outFile) {
  let text = readFileSync(srcFile, 'utf8')
  const require = createRequire(srcFile)
  for (const spec of IMPORT_SPECS) {
    let resolved = null
    try { resolved = pathToFileURL(require.resolve(spec, { paths: [dirname(srcFile)] })).href } catch { resolved = null }
    if (resolved === null) throw new Error('cannot resolve ' + spec + ' from ' + srcFile)
    const re = new RegExp("from '" + spec.replace(/[/@.]/g, (c) => '\\' + c) + "'", 'g')
    if (!re.test(text)) throw new Error('specifier ' + spec + ' not found in ' + srcFile)
    text = text.replace(re, "from '" + resolved + "'")
  }
  writeFileSync(outFile, text, 'utf8')
  return outFile
}
function runThisSuite(extraEnv) {
  const env = { ...process.env, ...extraEnv }
  try {
    const stdout = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status === undefined || e.status === null ? -1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}
const failedLabelsOf = (stdout) => {
  const at = stdout.indexOf('failed checks:')
  if (at === -1) return []
  return stdout.slice(at).split('\n').slice(1)
    .filter((l) => /^\s{2}-\s/.test(l))
    .map((l) => l.replace(/^\s*-\s*/, ''))
}
const statsOf = (stdout) => {
  const m = /checks=(\d+)\s+failures=(\d+)/.exec(stdout)
  return m === null ? null : { checks: Number(m[1]), failures: Number(m[2]) }
}

if (process.env.P13_SKIP_MUTATIONS === '1') {
  console.log('  ...  P13_SKIP_MUTATIONS=1 -> 变异组跳过（不计入检查数）')
} else if (MUTATION_MODE) {
  console.log('  ...  子进程模式（P13_SRC / P13_CLIENT_SRC 已设置）-> 不再递归跑变异')
} else {
  mkdirSync(MUT_TMP, { recursive: true })
  const mutations = []
  // M1: the break at the top of the wave loop removed -- downstream keeps being
  //     dispatched even though the run was already halted.
  {
    const M1 = join(MUT_TMP, 'host-m1-nobreak.js')
    try {
      importableCopy(SRC, M1)
      let t = readFileSync(M1, 'utf8')
      const needle = 'if (haltedBy !== null) break;'
      if (t.indexOf(needle) === -1) check('I0.1 [夹具] 变异靶点 M1 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found: ' + needle)
      else {
        t = t.replace(needle, '/* mutated: wave-loop halt break removed */')
        writeFileSync(M1, t, 'utf8')
        mutations.push({
          id: 'M1',
          what: '删掉波次循环顶部的 `if (haltedBy !== null) break;`（停机不再阻止新节点派发）',
          expectLabels: ['B1.2', 'B1.4', 'B1.5', 'B1.7'],
          env: { P13_SRC: M1, P13_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('I0.1 [夹具] M1 变异体构造失败（夹具问题，不是被测代码问题）', false, String(e && e.message ? e.message : e)) }
  }
  // M2: the final status back to the pre-P13 expression -- a halt silently
  //     degrades into `failed` / `completed` and the new state stops existing.
  {
    const M2 = join(MUT_TMP, 'host-m2-status.js')
    try {
      importableCopy(SRC, M2)
      let t = readFileSync(M2, 'utf8')
      const needle = "const halted = skipped.length > 0 || haltReason === 'unresolved-blocking';"
      if (t.indexOf(needle) === -1) check('I0.2 [夹具] 变异靶点 M2 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found: ' + needle)
      else {
        t = t.replace(needle, 'const halted = false; /* mutated: halted status removed */')
        writeFileSync(M2, t, 'utf8')
        mutations.push({
          id: 'M2',
          what: '把停机状态判定改回恒定 false（halted 永远不产生，停机退化成 failed/completed）',
          expectLabels: ['B1.4', 'C1.5', 'E2.1'],
          env: { P13_SRC: M2, P13_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('I0.2 [夹具] M2 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  // M3: the unresolved-blocking halt trigger removed -- the second trigger, and
  //     the only one that protects the LAST node (nothing left to skip).
  {
    const M3 = join(MUT_TMP, 'host-m3-noblocking.js')
    try {
      importableCopy(SRC, M3)
      let t = readFileSync(M3, 'utf8')
      const needle = "if (haltOnFailure && haltedBy === null) { haltedBy = nid; haltReason = 'unresolved-blocking'; }"
      if (t.indexOf(needle) === -1) check('I0.3 [夹具] 变异靶点 M3 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found: ' + needle)
      else {
        t = t.replace(needle, '/* mutated: unresolved-blocking halt trigger removed */')
        writeFileSync(M3, t, 'utf8')
        mutations.push({
          id: 'M3',
          what: '删掉评审 unresolved 触发停机的分支（未解决的 blocking 不再让运行停下）',
          expectLabels: ['E1.2', 'E2.1', 'E5.2'],
          env: { P13_SRC: M3, P13_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('I0.3 [夹具] M3 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  // M4: the client-side haltBlock deleted -- a halted run then looks like an
  //     ordinary unfinished one (the client half of the same claim).
  {
    const M4 = join(MUT_TMP, 'client-m4-nohaltblock.js')
    try {
      let t = readFileSync(CLIENT_SRC, 'utf8')
      const needle = "var haltBlock = (run !== null && run.status === 'halted') ? React.createElement('div', {"
      if (t.indexOf(needle) === -1) check('I0.4 [夹具] 变异靶点 M4 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found')
      else {
        t = t.replace(needle, "var haltBlock = false ? React.createElement('div', {")
        writeFileSync(M4, t, 'utf8')
        mutations.push({
          id: 'M4',
          what: '把客户端的 haltBlock 短路掉（halted 运行不再说明因谁停机、哪些步骤未执行）',
          expectLabels: ['H2.3', 'H2.4', 'H2.5', 'H3.4'],
          env: { P13_CLIENT_SRC: M4, P13_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('I0.4 [夹具] M4 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  // M5: the OPPOSITE over-reach -- halting on any recorded failure, even when
  //     there was nothing left to skip. `halted` is supposed to describe "we
  //     stopped before finishing", so this must stay `failed`: the new status may
  //     not swallow "it just failed". This is the one mutation that D1.1 exists to
  //     catch (and the reason D1.1 is not in M2's expectation list: `halted =
  //     false` leaves D1.1 green, because M2 under-reports rather than over-reports).
  {
    const M5 = join(MUT_TMP, 'host-m5-halt-any-failure.js')
    try {
      importableCopy(SRC, M5)
      let t = readFileSync(M5, 'utf8')
      const needle = "const halted = skipped.length > 0 || haltReason === 'unresolved-blocking';"
      if (t.indexOf(needle) === -1) check('I0.5 [夹具] 变异靶点 M5 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found: ' + needle)
      else {
        t = t.replace(needle, 'const halted = haltedBy !== null; /* mutated: any failure halts */')
        writeFileSync(M5, t, 'utf8')
        mutations.push({
          id: 'M5',
          what: '把停机判定改成"只要有失败就算 halted"（吞掉「就是失败了」这个区分）',
          expectLabels: ['D1.1', 'D1.2'],
          env: { P13_SRC: M5, P13_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('I0.5 [夹具] M5 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  for (const m of mutations) {
    try {
      const run = runThisSuite(m.env)
      const stats = statsOf(run.stdout)
      const labels = failedLabelsOf(run.stdout)
      const hit = m.expectLabels.filter((want) => labels.some((l) => l.indexOf(want) === 0))
      check('I.' + m.id + '.1 [' + m.what + '] 该变异真的让本套件变红（exit 1），不是"看起来红"',
        run.code === 1 && stats !== null && stats.failures > 0,
        'exit=' + String(run.code) + ' checks=' + String(stats && stats.checks) + ' failures=' + String(stats && stats.failures))
      check('I.' + m.id + '.2 [' + m.what + '] 变红的正是被点名的那些检查（' + m.expectLabels.join(' / ') + ' 全部命中）',
        hit.length === m.expectLabels.length, 'hit=' + hit.join(',') + ' | allFailed=' + labels.slice(0, 12).join(' ; ').slice(0, 520))
      check('I.' + m.id + '.3 [' + m.what + '] 红在"检查"上而不是套件崩溃：SUMMARY 打印了，且没有 FATAL / 未捕获异常',
        run.stdout.indexOf('FATAL') === -1 && run.stdout.indexOf('未捕获异常') === -1 && run.stdout.indexOf('=== SUMMARY ===') !== -1 && run.stdout.indexOf('RESULT: FAIL') !== -1,
        'fatal=' + String(run.stdout.indexOf('FATAL') !== -1) + ' summary=' + String(run.stdout.indexOf('=== SUMMARY ===') !== -1))
      console.log('       [变异 ' + m.id + ' 原始输出] exit=' + String(run.code) + ' ' + String(stats && ('checks=' + stats.checks + ' failures=' + stats.failures)))
      for (const l of labels.slice(0, 10)) console.log('         FAILED>> ' + l)
    } catch (e) { blockFailure('I.' + m.id + ' 变异运行', e) }
  }
  const leftovers = []
  for (const f of ['host-m1-nobreak.js', 'host-m2-status.js', 'host-m3-noblocking.js', 'client-m4-nohaltblock.js', 'host-m5-halt-any-failure.js']) {
    const inPkg = join(REPO, 'packages', 'team-flowise', 'src', f)
    const inClient = join(REPO, 'packages', 'team-flowise', 'src', 'client', f)
    if (existsSync(inPkg)) leftovers.push(inPkg)
    if (existsSync(inClient)) leftovers.push(inClient)
  }
  check('I4.1 变异体只存在于系统临时目录：仓库源码里没有留下任何变异副本（仓库源码零改动）',
    leftovers.length === 0, leftovers.join(',') || MUT_TMP)
  try {
    for (const f of ['host-m1-nobreak.js', 'host-m2-status.js', 'host-m3-noblocking.js', 'client-m4-nohaltblock.js', 'host-m5-halt-any-failure.js']) {
      const p = join(MUT_TMP, f)
      if (existsSync(p)) unlinkSync(p)
    }
  } catch { /* ignore */ }
}

// ===========================================================================
// Cleanup: remove every temp artefact this file created.
try { rmSync(MUT_TMP, { recursive: true, force: true }) } catch { /* ignore */ }

summary()
process.exit(failures === 0 ? 0 : 1)
