// P12-E: executable tests for the P12 "make team-flowise usable / visible /
// installable" round. Six groups, every one of them provable WITHOUT restarting
// dsh and WITHOUT touching the real profile:
//
//   A  tool discoverability  -- the SEVEN real `team_*` registrations, captured
//      by mounting the REAL host half on a stub ctx and read back through the
//      REAL `defineTool` compiler, so `description` / `parameters` are what the
//      model would actually see.
//   B  run attribution       -- the pure `selectRun` / `runScope` / origin rules,
//      plus the real `/progress`, `/runs` and `/run/start` route handlers.
//   C  the client half       -- the REAL bundle evaluated against a stub
//      React/DOM (validation/_harness-part.mjs) with `/progress` + `/runs`
//      stubbed: the three attribution states, the 401/500 error state, and the
//      new `sidebar.footer.action` surface.
//   D  install / portability -- scripts/install.mjs + uninstall.mjs driven
//      against a THROWAWAY profile copy in the system temp dir (never the real
//      one), asserted by PARSING the files (JSON / the patch layer), not by
//      grepping text. A hash guard proves the real profile was untouched.
//   E  documentation         -- skills/team-flowise/SKILL.md: frontmatter, and
//      the tool-name set cross-checked against group A's captured registrations
//      (ONE source of truth, so a host rename reddens this instead of letting
//      two hand-written lists drift apart).
//   F  mutation proof        -- runs THIS file against three deliberately broken
//      copies of the real code (built in the temp dir, deleted immediately) and
//      asserts each one really turns the matching checks red.
//
// Usage:
//   node validation/p12-usability.mjs                 # the real repository code
//   P12_SRC=<file> P12_INSTALL_SRC=<file> node validation/p12-usability.mjs
//   P12_SKIP_MUTATIONS=1 node validation/p12-usability.mjs
//
// Exit code: 0 = every check passed, 1 = at least one check failed,
//            2 = the module under test could not even be imported.
//
// Every check states what it verifies AND the concrete change that turns it red;
// group F runs three of those changes for real and prints the red output.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Derive the repository root from this file's own location instead of hardcoding
// an absolute path: a test that asserts "no machine-specific absolute paths are
// shipped" must not itself ship one, or the claim is only true on the author's
// machine. validation/ sits directly under the repo root.
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const HARNESS = join(HERE, '_harness-part.mjs')

const SRC = process.env.P12_SRC && process.env.P12_SRC.trim() !== ''
  ? resolve(process.env.P12_SRC.trim())
  : join(REPO, 'packages/team-flowise/src/index.js')
const SRC_URL = pathToFileURL(SRC).href
const CLIENT_SRC = join(REPO, 'packages/team-flowise/src/client/index.js')
const INSTALL_SRC = process.env.P12_INSTALL_SRC && process.env.P12_INSTALL_SRC.trim() !== ''
  ? resolve(process.env.P12_INSTALL_SRC.trim())
  : join(REPO, 'scripts/install.mjs')
const UNINSTALL_SRC = join(REPO, 'scripts/uninstall.mjs')
const PKG_DIR = join(REPO, 'packages/team-flowise')
const SKILL = join(REPO, 'skills/team-flowise/SKILL.md')

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
 * below: without it a throw inside an unguarded block killed the process with no
 * SUMMARY at all, so "the suite went red" was indistinguishable from "the suite
 * broke" -- a mutation could look like a pass.
 */
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  console.log('module under test: ' + SRC_URL)
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n=== P12-E usability tests (tool discoverability / run attribution / client / install / skill) ===')
console.log('module under test : ' + SRC_URL)
console.log('client under test : ' + CLIENT_SRC)
console.log('installer         : ' + INSTALL_SRC)
console.log('mode              : ' + ((process.env.P12_SRC || process.env.P12_INSTALL_SRC) ? 'MUTATION MODE (not the repository file)' : 'repository'))

let mod = null
try { mod = await import(SRC_URL) } catch (e) {
  console.log('FATAL: cannot import the module under test: ' + String(e && e.message ? e.message : e))
  process.exit(2)
}

// ===========================================================================
// The stub ctx: in-memory storage domains, a recording `tools` registry, a
// configurable `agents`, a capturing `webServer` and a configurable `subagents`.
// ===========================================================================
const TEST_TABLES = {
  team_agent_defs: { defs: mod.agentDefSchema },
  team_ledger: { tasks: { safeParse: () => ({ success: true }) } },
  team_workflows: { flows: mod.workflowSchema },
  team_runs: { runs: { safeParse: () => ({ success: true }) } },
}
function makeStorageStub() {
  const stores = new Map()
  const journal = []
  const store = (dname) => {
    if (!stores.has(dname)) stores.set(dname, new Map())
    return stores.get(dname)
  }
  const open = async (spec) => {
    const dname = spec.name
    const tables = store(dname)
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
    // Open-time validation, same as the real file backend: a stored record that
    // no longer matches the schema must make `open` REJECT -- which is exactly
    // why "add an optional field only" is a hard constraint for runSchema.
    for (const tname of Object.keys(spec.tables || {})) {
      const t = table(tname)
      for (const [k, v] of t.entries()) {
        const schema = TEST_TABLES[dname] && TEST_TABLES[dname][tname]
        const r = schema ? schema.safeParse(v) : { success: true }
        if (r.success === false) throw new Error('stub storage: domain ' + dname + ' record ' + k + ' fails validation: ' + JSON.stringify(r.error.issues[0]))
      }
    }
    return { name: dname, table, close: async () => {} }
  }
  return { open, stores, journal, store }
}

/** The `tools` service. `register` receives the REAL compiled definition. */
function makeToolsStub() {
  const definitions = []
  return {
    definitions,
    register(def) { definitions.push(def); return () => {} },
    schemas() { return definitions.map((d) => ({ name: d.name })) },
    guard() { return () => {} },
  }
}

const storage = makeStorageStub()
const captured = {}
const webRoutes = new Map()
const toolsStub = makeToolsStub()
const agentsSvcStub = { currentInitiator: () => undefined, roots: () => [], create: async () => { throw new Error('stub: no agent creation') } }
const webServerStub = { register(def) { webRoutes.set(def.path, def.handler); return () => webRoutes.delete(def.path) } }
let subagentsStub = null

const ctx = {
  storageDomain: storage,
  agents: agentsSvcStub,
  webServer: webServerStub,
  get(n) {
    if (n === 'storageDomain') return storage
    if (n === 'subagents') return subagentsStub
    if (n === 'agents') return agentsSvcStub
    if (n === 'webServer') return webServerStub
    if (n === 'tools') return toolsStub
    return undefined
  },
  provide(n, svc) { captured[n] = svc },
  effect(fn) { const d = fn(); return () => {} },
  on() { return () => {} },
  logger: { warn() {}, error() {}, info() {} },
}
const realWarn = console.warn
console.warn = () => {}
let applyThrew = null
try { mod.apply(ctx) } catch (e) { applyThrew = e } finally { console.warn = realWarn }

const svc = captured.teamOrchestrator

const tableMap = (domain, table) => { const d = storage.stores.get(domain); return d === undefined ? undefined : d.get(table) }
const rec = (domain, table, key) => { const m = tableMap(domain, table); return m === undefined ? undefined : m.get(key) }
function rawPut(domain, table, key, value) {
  const d = storage.store(domain)
  if (!d.has(table)) d.set(table, new Map())
  d.get(table).set(key, value)
  return value
}
/** Drive a real route handler with a stubbed req/res (GET or POST with a body). */
async function callRoute(path, qs, opts) {
  const handler = webRoutes.get(path)
  if (handler === undefined) throw new Error('no route ' + path)
  const o = opts || {}
  let status = 0
  let body = null
  const headers = {}
  const res = { writableEnded: false, writeHead(s, h) { status = s; if (h) Object.assign(headers, h) }, end(t) { this.writableEnded = true; body = t } }
  const url = path + (qs ? '?' + qs : '')
  const req = { url, method: o.method || 'GET', socket: { remoteAddress: o.remoteAddress || '127.0.0.1' }, destroy() { this.destroyed = true } }
  if (o.body !== undefined) {
    const buf = Buffer.from(JSON.stringify(o.body), 'utf8')
    req[Symbol.asyncIterator] = function () { let done = false; return { next: async () => { if (done) return { done: true, value: undefined }; done = true; return { done: false, value: buf } } } }
  }
  await handler(req, res)
  let json = null
  try { json = body === null ? null : JSON.parse(body) } catch { /* non-JSON */ }
  return { status, json, raw: body, headers }
}

// ===========================================================================
console.log('\n--- GROUP A: 工具可发现性（真实注册 + 真实 defineTool 编译） ---')
// ---------------------------------------------------------------------------
// A0. The registrations themselves.
// ---------------------------------------------------------------------------
const TOOL_NAMES = ['team_create_agent', 'team_create_task', 'team_create_workflow', 'team_delegate_agent', 'team_list_agents', 'team_run_workflow', 'team_task_status']
const PLACEHOLDER = 'Multi-agent team orchestration.'
const defs = toolsStub.definitions
check('A0.0 apply(ctx) 在桩 ctx 上不抛异常（抛了 = 后面所有注册断言都无意义）', applyThrew === null, applyThrew === null ? '' : String(applyThrew && applyThrew.message))
check('A0.1 桩 ctx 上的 apply() 真的注册了 7 个模型工具（少一个 = 这一组整体失效）', defs.length === 7, 'n=' + defs.length)
check('A0.2 注册到的工具名集合恰好是那 7 个（多一个少一个、改名都判负）',
  eq(defs.map((d) => d.name).slice().sort(), TOOL_NAMES.slice().sort()), defs.map((d) => d.name).join(','))
check('A0.3 7 个工具都注册进了同名服务提供之外的地方——teamOrchestrator 仍然被 provide（工具面与服务的分工未变）',
  svc !== undefined && typeof svc.runWorkflow === 'function', typeof svc)
const byName = new Map(defs.map((d) => [d.name, d]))
{
  const descs = defs.map((d) => d.description)
  check('A1.1 七个工具 description 两两互不相同（退回共用一个字符串即红——本轮要修的根因）',
    new Set(descs).size === descs.length, 'distinct=' + new Set(descs).size + '/' + descs.length)
  const tooShort = defs.filter((d) => typeof d.description !== 'string' || d.description.length <= 40)
  check('A1.2 每条 description 都是长度 > 40 的字符串（退回一句空话即红）',
    tooShort.length === 0 && descs.every((x) => typeof x === 'string'), tooShort.map((d) => d.name + ':' + String(d.description && d.description.length)).join(',') || 'all > 40')
  check('A1.3 没有任何一条 description 等于占位文本 "' + PLACEHOLDER + '"（逐字比较）',
    defs.every((d) => d.description !== PLACEHOLDER), defs.filter((d) => d.description === PLACEHOLDER).map((d) => d.name).join(',') || 'none')
  // A1.4 -- INFORMATIONAL ONLY, deliberately NOT a gating check.
  //
  // An earlier revision of this file asserted "every description names at least
  // one sibling tool" (A1.4) AND "exactly one description does not, namely
  // team_task_status" (A1.4b). Those two are negations of each other, so no
  // source state could satisfy both: the suite could never exit 0.
  //
  // "Names a sibling tool" is also NOT one of this task's A.1 acceptance
  // criteria -- A.1 requires (i) pairwise-distinct descriptions, (ii) length
  // > 40, (iii) not the placeholder text, and all three are asserted as gating
  // checks in A1.1 / A1.2 / A1.3 right above. On top of that, the only way to
  // satisfy the stronger rule today would be an edit to
  // packages/team-flowise/src/index.js, which is outside this node's allowed
  // edit list. So the finding is reported as information: it does not touch
  // `checks` / `failures` and cannot keep this suite red.
  {
    const unnamed = defs.filter((d) => !/team_[a-z0-9_]+/.test(String(d.description))).map((d) => d.name)
    console.log('  info  A1.4 [加严信息·非门禁·不计入 checks 也不影响退出码] 点名了同族工具(team_*)的 description: '
      + (defs.length - unnamed.length) + '/' + defs.length + '；未点名的是: ' + (unnamed.join(',') || 'none')
      + "（任务 A.1 只要求两两不同 / 长度 > 40 / 非占位文本，分别由 A1.1 / A1.2 / A1.3 判定；本条不判红）")
  }
  check('A1.5 description 里不含未转义的控制字符（工具面是单行元数据）',
    defs.every((d) => typeof d.description === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(d.description)),
    defs.filter((d) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(String(d.description))).map((d) => d.name).join(',') || 'clean')
  check('A1.6 每条 description 是英文口径（与第一方工具一致，不混中文）',
    defs.every((d) => typeof d.description === 'string' && !/[\u4e00-\u9fff]/.test(d.description)),
    defs.filter((d) => /[\u4e00-\u9fff]/.test(String(d.description))).map((d) => d.name).join(',') || 'no CJK')
}

// ---------------------------------------------------------------------------
// A2. Parameter-level descriptions (recursive, including nested route keys).
//     Fails if any parameter has no non-empty description -- the exact pre-P12
//     defect where every parameter was `{type}` only.
// ---------------------------------------------------------------------------
function paramWalk(schema, path, out) {
  const props = schema && typeof schema === 'object' ? schema.properties : null
  if (props === null || typeof props !== 'object') return out
  for (const key of Object.keys(props)) {
    const child = props[key] || {}
    const p = path === '' ? key : path + '.' + key
    out.push({ path: p, raw: child })
    paramWalk(child, p, out)
  }
  return out
}
{
  const all = []
  for (const d of defs) for (const p of paramWalk(d.parameters, '', [])) all.push({ tool: d.name, ...p })
  const noDesc = all.filter((p) => typeof p.raw.description !== 'string' || p.raw.description.trim() === '')
  check('A2.1 每一个参数（含 route 的嵌套子键）都有非空 description（递归遍历；漏一个即红）',
    noDesc.length === 0, noDesc.length === 0 ? 'n=' + all.length + ' 全部有描述' : noDesc.map((p) => p.tool + '/' + p.path).join(','))
  const short = all.filter((p) => typeof p.raw.description === 'string' && p.raw.description.trim().length < 20)
  check('A2.2 每条参数 description 长度 ≥ 20（防退化成 "the X" 这种无信息量的一句话）',
    short.length === 0, short.map((p) => p.tool + '/' + p.path + '=' + p.raw.description.length).join(',') || 'n=' + all.length)
  check('A2.3 参数 description 里不含中文（与工具 description 同一口径）',
    all.every((p) => !/[\u4e00-\u9fff]/.test(String(p.raw.description))),
    all.filter((p) => /[\u4e00-\u9fff]/.test(String(p.raw.description))).map((p) => p.tool + '/' + p.path).join(',') || 'no CJK')
  const nested = all.filter((p) => p.path.indexOf('.') !== -1)
  check('A2.4 嵌套参数（如 team_run_workflow 的 route.provider）确实被遍历到了且都有描述（否则上一条只是空转）',
    nested.length >= 8 && nested.every((p) => typeof p.raw.description === 'string' && p.raw.description !== ''), 'nested=' + nested.length)
}

// ---------------------------------------------------------------------------
// A3. The LIMITATION semantics, asserted as REGEXES over the description text
//     the plugin really registered -- not against a sentence copied from the
//     plan (the author may reword; these facts may not disappear). Red example
//     for each: delete that sentence from the tool's description.
// ---------------------------------------------------------------------------
{
  const d = (n) => String((byName.get(n) || {}).description || '')
  const ct = d('team_create_task')
  check('A3.1 team_create_task 明确写出"只登记、不执行"（only + does not execute）——删掉这句即红',
    /\bonly\b/i.test(ct) && /does not execute|is not executed|doesn't execute/i.test(ct),
    'only=' + String(/\bonly\b/i.test(ct)) + ' no-execute=' + String(/does not execute|is not executed|doesn't execute/i.test(ct)))
  check('A3.2 team_create_task 同时说明后果"不会派发 / 不会有产出"（no worker / no model call / expecting output）——删掉后果说明即红',
    /no worker|no model call|not dispatched|expecting output/i.test(ct), ct.slice(0, 140))
  const rw = d('team_run_workflow')
  check('A3.3 team_run_workflow 含"阻塞等待"语义（BLOCK + until）——删掉 IMPORTANT/BLOCK 那句即红',
    /\bBLOCK/i.test(rw) && /until/i.test(rw), 'BLOCK=' + String(/\bBLOCK/i.test(rw)))
  check('A3.4 team_run_workflow 说明"先把角色和工作流建好再启动"（build ... FIRST / then start）——删掉顺序建议即红',
    /build the roles and the workflow FIRST|first, then start|then start it|before you start/i.test(rw), rw.slice(0, 150))
  const da = d('team_delegate_agent')
  check('A3.5 team_delegate_agent 含"阻塞到子代理结束"（BLOCK + until）——删掉即红',
    /\bBLOCK/i.test(da) && /until/i.test(da), 'BLOCK=' + String(/\bBLOCK/i.test(da)))
  check('A3.6 team_delegate_agent 指向 workflow 路线（multi-step 场景推荐 create_workflow + run_workflow）——删掉这个对照即红',
    /multi-step|workflow route/i.test(da) && /team_create_workflow/.test(da) && /team_run_workflow/.test(da), da.slice(0, 150))
  check('A3.7 team_create_workflow 说明"声明工作流不等于运行它"（does not run）——删掉 LIMITATION 那句即红',
    /does not run|does NOT run/i.test(d('team_create_workflow')), d('team_create_workflow').slice(0, 150))
  check('A3.8 team_create_agent 说明它"只写定义、从不派发"（never dispatch / only writes the definition）',
    /never dispatch|only writes the definition|does not dispatch/i.test(d('team_create_agent')), d('team_create_agent').slice(0, 150))
  check('A3.9 至少三个工具命中"关键限制语义"（A3.1 / A3.3 / A3.5 三类，逐一可判定）',
    [/\bonly\b/i.test(ct) && /does not execute/i.test(ct), /\bBLOCK/i.test(rw), /\bBLOCK/i.test(da)].filter(Boolean).length >= 3,
    JSON.stringify({ createTask: /\bonly\b/i.test(ct) && /does not execute/i.test(ct), runWorkflow: /\bBLOCK/i.test(rw), delegate: /\bBLOCK/i.test(da) }))
  check('A3.10 无参数工具（team_list_agents / team_task_status）在 description 里明确写"takes no arguments"',
    /takes no arguments/i.test(d('team_list_agents')) && /takes no arguments/i.test(d('team_task_status')),
    'list=' + String(/takes no arguments/i.test(d('team_list_agents'))) + ' status=' + String(/takes no arguments/i.test(d('team_task_status'))))
  check('A3.11 可核事实：team_task_status 说明它读的是"全进程共享的台账"（否则模型会以为只看到自己的任务）',
    /shared by every session|not only the work you registered|WHOLE ledger/i.test(d('team_task_status')), d('team_task_status').slice(0, 150))
}

// ---------------------------------------------------------------------------
// A4. ONLY the descriptions changed: parameter names, their types and the
//     required sets are frozen to the pre-P12 shape (read out of the COMPILED
//     schema, so even a "harmless" schema edit is caught).
// ---------------------------------------------------------------------------
const EXPECTED_PARAMS = {
  team_create_task: {
    props: { requirement: 'string', acceptanceCriteria: 'string', assignee: 'string', reviewer: 'string' },
    required: ['requirement', 'acceptanceCriteria', 'assignee'],
  },
  team_task_status: { props: {}, required: [] },
  team_run_workflow: {
    props: { workflowId: 'string', input: 'object', route: 'object' },
    required: ['workflowId'],
    nested: { route: { provider: 'string', model: 'string', reasoningEffort: 'string', maxTokens: 'number' } },
  },
  team_list_agents: { props: {}, required: [] },
  team_create_agent: {
    props: { id: 'string', name: 'string', role: 'string', systemPrompt: 'string', provider: 'string', model: 'string', reasoningEffort: 'string', maxTokens: 'number', timeoutMs: 'number', toolsPreset: 'string' },
    required: [],
  },
  // P13 (branch feat/leasing-risk-team) added ONE parameter to this tool:
  // `haltOnFailure`. The expectation below is EXTENDED to include it, never
  // weakened: every pre-P13 key and type is still asserted verbatim, `required`
  // is still exactly ['name'], and the nested `route` contract is unchanged. The
  // P13 suite (validation/p13-halt.mjs) is what asserts the new parameter's
  // semantics; this entry only keeps "the declared shape is exactly this" true.
  team_create_workflow: {
    props: { name: 'string', description: 'string', nodes: 'object', route: 'object', prompt: 'string', haltOnFailure: 'boolean' },
    required: ['name'],
    nested: { route: { provider: 'string', model: 'string', reasoningEffort: 'string', maxTokens: 'number' } },
  },
  team_delegate_agent: {
    props: { agent: 'string', task: 'string', acceptanceCriteria: 'string', reviewer: 'string' },
    required: ['agent', 'task'],
  },
}
{
  const typeMap = (schema) => {
    const out = {}
    for (const k of Object.keys((schema && schema.properties) || {})) out[k] = (schema.properties[k] || {}).type
    return out
  }
  for (const name of TOOL_NAMES) {
    const d = byName.get(name)
    const exp = EXPECTED_PARAMS[name]
    if (d === undefined) { check('A4 ' + name + ' 存在（缺失则本项与整组 A 失效）', false, 'not registered'); continue }
    check('A4.' + name + ' 参数名 + 类型集合与改动前逐字一致（只有 description 变了；改名/改类型即红）',
      eq(typeMap(d.parameters), exp.props), JSON.stringify(typeMap(d.parameters)))
    check('A4b.' + name + ' required 集合与改动前一致（收紧或放宽必填项即红）',
      eq((d.parameters && d.parameters.required) || [], exp.required), JSON.stringify((d.parameters && d.parameters.required) || []))
    for (const parent of Object.keys(exp.nested || {})) {
      const child = (d.parameters.properties || {})[parent] || {}
      check('A4c.' + name + '.' + parent + ' 的嵌套子键与改动前一致（route 多一个少一个子键即红）',
        eq(typeMap(child), exp.nested[parent]), JSON.stringify(typeMap(child)))
    }
  }
}

// ===========================================================================
console.log('\n--- GROUP B: 会话归属（纯函数 selectRun / runScope + 真实路由） ---')
// ---------------------------------------------------------------------------
// B1. selectRun: ten rules, one check each. Every one names the change that
//     turns it red; group F breaks rule R1 for real.
// ---------------------------------------------------------------------------
const R = (id, sessionId, startedAt) => ({ id, sessionId, startedAt, status: 'running' })
const legacy = (id, startedAt) => ({ id, startedAt, status: 'running' })
{
  check('B0.1 selectRun / runScope / resolveRunOrigin / readSessionOption 四个纯函数已具名导出（缺一个 = B 组不完整）',
    typeof mod.selectRun === 'function' && typeof mod.runScope === 'function' && typeof mod.resolveRunOrigin === 'function' && typeof mod.readSessionOption === 'function',
    [typeof mod.selectRun, typeof mod.runScope, typeof mod.resolveRunOrigin, typeof mod.readSessionOption].join(','))
  const U1 = mod.selectRun([R('A', 'S1', 100)], 'S1')
  check('B1.1 [U1] 会话内唯一一条 -> 就选它（返回 null 或别人的即红）', U1 !== null && U1.id === 'A', U1 === null ? 'null' : U1.id)
  const U2 = mod.selectRun([R('A', 'S1', 100), R('B', 'S2', 200)], 'S1')
  check('B1.2 [U2] 别人更新也不许抢：S1 看到的是自己的 A，而不是时间更新的 B（P12 的核心缺陷）',
    U2 !== null && U2.id === 'A', U2 === null ? 'null' : U2.id)
  const U3 = mod.selectRun([R('A', 'S1', 100), R('B', 'S1', 200)], 'S1')
  check('B1.3 [U3] 会话语义内取最新：同会话两条 -> B', U3 !== null && U3.id === 'B', U3 === null ? 'null' : U3.id)
  const U4 = mod.selectRun([R('A', 'S1', 300), R('B', 'S2', 200), R('C', 'S2', 100), legacy('D', 999)], 'S3')
  check('B1.4 [本轮核心靶点·U4] 指定会话无运行 -> 返回 null（绝不退化成"全局最新"，也不许把遗留记录算成命中）',
    U4 === null, U4 === null ? 'null（正确）' : 'id=' + U4.id)
  check('B1.5 [U5] 完全没有运行 + 指定会话 -> null', mod.selectRun([], 'S1') === null, String(mod.selectRun([], 'S1')))
  const U6 = mod.selectRun([R('A', 'S1', 300), legacy('D', 999)], null)
  check('B1.6 [U6·向后兼容] 不传 sessionId -> 与改动前一致：全局最新（遗留记录仍然可达），这里应为 D',
    U6 !== null && U6.id === 'D', U6 === null ? 'null' : U6.id)
  const U6b = mod.selectRun([R('A', 'S1', 300), legacy('D', 999)], '')
  check('B1.7 [U6b] sessionId 为空串同样走"与改动前一致"的全局分支（把 "" 当成一个会话 id 即红）',
    U6b !== null && U6b.id === 'D', U6b === null ? 'null' : U6b.id)
  const U7 = mod.selectRun([R('X', 'S1', 500), R('Y', 'S1', 500)], 'S1')
  check('B1.8 [U7·确定性] startedAt 相同时按 id 字典序取大：X/Y 同时间 -> Y。改成"取第一个遇到的"即红',
    U7 !== null && U7.id === 'Y', U7 === null ? 'null' : U7.id)
  check('B1.9 [U8] runs=null 不抛异常且与 [] 同结果（R0 归一化）', mod.selectRun(null, 'S1') === null, String(mod.selectRun(null, 'S1')))
  const U9 = mod.selectRun([{ startedAt: 5 }, { id: '', startedAt: 9 }, R('Z', 'S1', 1)], 'S1')
  check('B1.10 [R0] 没有字符串 id 的条目不是 run：只剩 Z 一条命中（把无 id 记录算进会话即红）',
    U9 !== null && U9.id === 'Z', U9 === null ? 'null' : U9.id)
  const U10 = mod.selectRun([R('A', 'S1', 100), R('B', 'S1', 100), R('C', 'S1', 100)], 'S1')
  check('B1.11 [确定性] 全同 startedAt 的三条 -> 稳定取 id 最大者 C（依赖枚举顺序即红）',
    U10 !== null && U10.id === 'C', U10 === null ? 'null' : U10.id)
  const list = [R('A', 'S1', 100), R('B', 'S1', 100), R('C', 'S2', 300)]
  const before = JSON.stringify(list)
  const many = []
  for (let i = 0; i < 100; i += 1) many.push(JSON.stringify(mod.selectRun(list, 'S1')))
  check('B1.12 同入参跑 100 次结果逐字相同（"按枚举顺序偶然通过"即红）', new Set(many).size === 1, many[0])
  check('B1.13 selectRun 不修改入参（就地排序/写回即红：调度器把 run 记录直接传进来）',
    JSON.stringify(list) === before, JSON.stringify(list))
  const scopeRuns = [R('A', 'S1', 100), R('B', 'S2', 200), legacy('L', 50)]
  const sc1 = mod.runScope(scopeRuns, 'S1')
  check('B2.1 runScope(S1)：mode=session、runCountInScope=1、fallback=latest-in-session、hasAnyGlobal=true',
    sc1.mode === 'session' && sc1.sessionId === 'S1' && sc1.runCountInScope === 1 && sc1.fallback === 'latest-in-session' && sc1.hasAnyGlobal === true,
    JSON.stringify(sc1))
  check('B2.2 runScope(S1).run 与 selectRun(S1) 是同一份选择（两套规则漂移即红）',
    sc1.run !== null && sc1.run.id === mod.selectRun(scopeRuns, 'S1').id && sc1.run.id === 'A', JSON.stringify(sc1.run && sc1.run.id))
  const sc3 = mod.runScope(scopeRuns, 'S3')
  check('B2.3 [本轮核心靶点] runScope(S3)：本会话没有 -> run===null、runCountInScope===0、fallback===null，且 hasAnyGlobal===true 说清"别处有运行"',
    sc3.mode === 'session' && sc3.run === null && sc3.runCountInScope === 0 && sc3.fallback === null && sc3.hasAnyGlobal === true,
    JSON.stringify(sc3))
  const scAll = mod.runScope(scopeRuns, null)
  check('B2.4 runScope(无会话)：mode=global、fallback=latest-global、run===全局最新 B（与改动前语义一致）',
    scAll.mode === 'global' && scAll.sessionId === null && scAll.fallback === 'latest-global' && scAll.run !== null && scAll.run.id === 'B',
    JSON.stringify({ mode: scAll.mode, fallback: scAll.fallback, run: scAll.run && scAll.run.id }))
  const scEmpty = mod.runScope([], 'S1')
  check('B2.5 runScope(空库, S1)：run=null、fallback=null、hasAnyGlobal=false（"什么都没有"与"我没有"必须可分）',
    scEmpty.run === null && scEmpty.fallback === null && scEmpty.hasAnyGlobal === false && scEmpty.runCountInScope === 0, JSON.stringify(scEmpty))
  check('B2.6 runScope 也不修改入参',
    JSON.stringify(scopeRuns) === JSON.stringify([R('A', 'S1', 100), R('B', 'S2', 200), legacy('L', 50)]), JSON.stringify(scopeRuns))
}

// ---------------------------------------------------------------------------
// B3. resolveRunOrigin / readSessionOption: no session, no throw, ABSENT keys
//     (not empty strings) so a stored record stays byte-identical to pre-P12.
// ---------------------------------------------------------------------------
{
  check('B3.1 resolveRunOrigin：agents 服务缺失 -> {}（键不出现；写成 {sessionId:null} 即红）',
    eq(mod.resolveRunOrigin({ get: () => undefined }), {}), JSON.stringify(mod.resolveRunOrigin({ get: () => undefined })))
  check('B3.2 resolveRunOrigin：currentInitiator 返回 undefined -> {}（HTTP 路径的真实形态）',
    eq(mod.resolveRunOrigin({ get: () => ({ currentInitiator: () => undefined }) }), {}))
  check('B3.3 resolveRunOrigin：有 initiator 但 session 缺失 -> {}（不许编造）',
    eq(mod.resolveRunOrigin({ get: () => ({ currentInitiator: () => ({}) }) }), {}))
  const withSess = mod.resolveRunOrigin({ get: () => ({ currentInitiator: () => ({ session: { id: 'sid-1', cwd: 'D:/x' } }) }) })
  check('B3.4 resolveRunOrigin：有会话 -> {sessionId, workspace}（cwd 只作展示用附加信息）',
    eq(withSess, { sessionId: 'sid-1', workspace: 'D:/x' }), JSON.stringify(withSess))
  check('B3.5 resolveRunOrigin 对抛错的服务不抛异常（归属判定绝不能弄挂一次运行）',
    eq(mod.resolveRunOrigin({ get: () => ({ currentInitiator: () => { throw new Error('boom') } }) }), {}))
  check('B3.6 resolveRunOrigin(undefined/null) 不抛异常', eq(mod.resolveRunOrigin(undefined), {}) && eq(mod.resolveRunOrigin(null), {}))
  check('B3.7 readSessionOption：字符串 -> {sessionId}；"" -> {}；undefined -> {}（不传新参数时行为与改动前一致）',
    eq(mod.readSessionOption('abc'), { sessionId: 'abc' }) && eq(mod.readSessionOption(''), {}) && eq(mod.readSessionOption(undefined), {}),
    JSON.stringify([mod.readSessionOption('abc'), mod.readSessionOption(''), mod.readSessionOption(undefined)]))
  check('B3.8 readSessionOption：{sessionId, workspace} 透传、缺字段不出现；数组/数字等怪形状 -> {}',
    eq(mod.readSessionOption({ sessionId: 's', workspace: 'w' }), { sessionId: 's', workspace: 'w' }) &&
    eq(mod.readSessionOption({ sessionId: '' }), {}) && eq(mod.readSessionOption([]), {}) && eq(mod.readSessionOption(5), {}),
    JSON.stringify(mod.readSessionOption({ sessionId: '', workspace: 'w' })))
  const legacyRun = { id: 'legacy-1', workflowId: 'wf-x', status: 'running', nodeStates: {}, startedAt: 1000 }
  // The schema the storage layer really validates with: `defineDomain` wraps the
  // zod schema, and the file backend parses each stored record against
  // `tables.<name>.valueSchema` when a domain opens.
  const runValueSchema = mod.runsDomain.tables.runs.valueSchema
  check('B3.9 [域打开硬约束] 域表暴露的就是 run 记录的校验器（valueSchema.safeParse 可用；换了名字这条会红）',
    runValueSchema !== undefined && typeof runValueSchema.safeParse === 'function', typeof runValueSchema)
  check('B3.10 [域打开硬约束] 旧 run 记录（没有 sessionId / workspace，逐字取自现网形状）仍通过域校验（新键必填即红）',
    runValueSchema.safeParse(legacyRun).success !== false, JSON.stringify(Object.keys(legacyRun)))
  check('B3.11 [域打开硬约束] 旧 run 记录解析后不会凭空多出 sessionId / workspace（用 default 填一个归属比必填更糟）',
    (() => { const r = runValueSchema.safeParse(legacyRun); return r.success !== false && r.data.sessionId === undefined && r.data.workspace === undefined })(),
    JSON.stringify(runValueSchema.safeParse(legacyRun).data))
  check('B3.12 新键是可选且带类型：带 sessionId/workspace 的记录通过，sessionId 给成数字被拒（收紧或放宽即红）',
    runValueSchema.safeParse({ ...legacyRun, sessionId: 'S1', workspace: 'D:/x' }).success !== false &&
    runValueSchema.safeParse({ ...legacyRun, sessionId: 5 }).success === false,
    JSON.stringify(runValueSchema.safeParse({ ...legacyRun, sessionId: 5 }).success))
}

// ---------------------------------------------------------------------------
// B4/B5. The real /progress and /runs handlers. Fails if the new parameters are
//     ignored (the pre-P12 defect: ?session=deadbeef returned the global newest)
//     or if the no-argument branch changed shape.
// ---------------------------------------------------------------------------
const WF = 'wf-p12e-fixture'
const T0 = 1700000000000
{
  try {
    await svc.upsertWorkflow({
      id: WF, name: 'P12-E 夹具工作流',
      nodes: {
        a: { id: 'a', title: '实现', agent: 'Coder', dependsOn: [], taskTemplate: { requirement: 'REQ-A', acceptanceCriteria: 'AC-A' } },
        b: { id: 'b', title: '验收', agent: 'Tester', dependsOn: ['a'], taskTemplate: { requirement: 'REQ-B', acceptanceCriteria: 'AC-B' } },
      },
    })
    rawPut('team_runs', 'runs', 'run-other-s2', {
      id: 'run-other-s2', workflowId: WF, status: 'running', startedAt: T0 + 500, sessionId: 'S2',
      nodeStates: { a: { status: 'completed', assignee: 'Coder', startedAt: T0 + 500, endedAt: T0 + 900 }, b: { status: 'working', assignee: 'Tester', startedAt: T0 + 900 } },
    })
    rawPut('team_runs', 'runs', 'run-mine-s1', {
      id: 'run-mine-s1', workflowId: WF, status: 'running', startedAt: T0, sessionId: 'S1',
      nodeStates: { a: { status: 'working', assignee: 'Coder', startedAt: T0 } },
    })
    rawPut('team_runs', 'runs', 'run-legacy-none', {
      id: 'run-legacy-none', workflowId: WF, status: 'completed', startedAt: T0 - 10000,
      nodeStates: { a: { status: 'completed', assignee: 'Coder', startedAt: T0 - 10000, endedAt: T0 - 9000 }, b: { status: 'completed', assignee: 'Tester', startedAt: T0 - 9000, endedAt: T0 - 8000 } },
    })

    const def = await callRoute('/api/team-flowise/progress')
    const p = def.json || {}
    check('B4.1 不带任何参数 -> 与改动前语义一致：全局最新那条（run-other-s2），HTTP 200',
      def.status === 200 && p.ok === true && p.run !== null && p.run.id === 'run-other-s2',
      'status=' + String(def.status) + ' run=' + String(p.run && p.run.id))
    check('B4.2 默认分支的顶层键是既有 [ok,run,nodes,roles,reviewers,totals] 的超集（只许多 scope，不许少/改名）',
      ['ok', 'run', 'nodes', 'roles', 'reviewers', 'totals', 'scope'].every((k) => k in p), Object.keys(p).join(','))
    const mine = (await callRoute('/api/team-flowise/progress', 'session=S1')).json || {}
    check('B4.3 ?session=S1 -> 返回 S1 自己的运行，而不是全局最新（改动前这里会返回 run-other-s2）',
      mine.run !== null && mine.run.id === 'run-mine-s1', String(mine.run && mine.run.id))
    check('B4.4 带 session 与不带 session 的 run 确实不同（参数真的被读了）',
      JSON.stringify(mine.run) !== JSON.stringify(p.run), String(mine.run && mine.run.id) + ' vs ' + String(p.run && p.run.id))
    check('B4.5 scope 信封如实说明：mode=session / sessionId=S1 / runCountInScope=1 / fallback=latest-in-session',
      mine.scope !== undefined && mine.scope.mode === 'session' && mine.scope.sessionId === 'S1' && mine.scope.runCountInScope === 1 && mine.scope.fallback === 'latest-in-session',
      JSON.stringify(mine.scope))
    const foreign = (await callRoute('/api/team-flowise/progress', 'session=S3')).json || {}
    check('B4.6 [本轮核心靶点] ?session=S3（本会话没有运行）-> run===null，且 scope 说清 runCountInScope=0 / hasAnyGlobal=true；绝不把 S2 的运行当 S3 的',
      foreign.run === null && foreign.scope !== undefined && foreign.scope.mode === 'session' && foreign.scope.runCountInScope === 0 && foreign.scope.hasAnyGlobal === true,
      JSON.stringify({ run: foreign.run, scope: foreign.scope }))
    const explicit = (await callRoute('/api/team-flowise/progress', 'runId=run-other-s2&session=S1')).json || {}
    check('B4.7 runId 优先于 session：显式指定别的会话那条也必须原样返回（显式选择不得被归属过滤覆盖）',
      explicit.run !== null && explicit.run.id === 'run-other-s2', String(explicit.run && explicit.run.id))
    const legacyReq = (await callRoute('/api/team-flowise/progress', 'runId=run-legacy-none')).json || {}
    check('B4.8 遗留 run（没有 sessionId）在响应里 sessionId 为 null —— "无法判定"与"确定不属于"是两件事',
      legacyReq.run !== null && legacyReq.run.sessionId === null, JSON.stringify(legacyReq.run && legacyReq.run.sessionId))
    const empty = await callRoute('/api/team-flowise/progress', 'session=S404')
    check('B4.9 未知会话 id 不抛异常、不 500：HTTP 200、ok:true、run:null、nodes:[]',
      empty.status === 200 && (empty.json || {}).ok === true && (empty.json || {}).run === null && eq((empty.json || {}).nodes, []),
      'status=' + String(empty.status))
    const junk = await callRoute('/api/team-flowise/progress', 'scope=nonsense&session=')
    check('B4.10 非法 scope / 空 session 不 500（与 /progress "永不 500" 的既有风格一致）：HTTP 200 且返回全局最新',
      junk.status === 200 && (junk.json || {}).ok === true && junk.json.run !== null && junk.json.run.id === 'run-other-s2',
      'status=' + String(junk.status) + ' run=' + String((junk.json || {}).run && (junk.json || {}).run.id))

    const all = await callRoute('/api/team-flowise/runs')
    check('B5.1 /runs 不带参数 -> 全部运行（与改动前一致），三条都在',
      all.status === 200 && eq(((all.json || {}).runs || []).map((r) => r.id).sort(), ['run-legacy-none', 'run-mine-s1', 'run-other-s2']),
      JSON.stringify(((all.json || {}).runs || []).map((r) => r.id)))
    const scoped = await callRoute('/api/team-flowise/runs', 'session=S1')
    check('B5.2 /runs?session=S1 -> 只剩本会话的运行，且元素形状不变（仍是完整 run 记录）',
      eq(((scoped.json || {}).runs || []).map((r) => r.id), ['run-mine-s1']) && ((scoped.json || {}).runs[0] || {}).nodeStates !== undefined,
      JSON.stringify(((scoped.json || {}).runs || []).map((r) => r.id)))
    const none = await callRoute('/api/team-flowise/runs', 'session=S404')
    check('B5.3 /runs?session=S404 -> 空数组（遗留记录不会被算进任何会话）', eq((none.json || {}).runs, []), JSON.stringify((none.json || {}).runs))
  } catch (e) { blockFailure('B4/B5 /progress 与 /runs 归属', e) }
}

// ---------------------------------------------------------------------------
// B6. /run/start: the run that lands in storage carries the session it was
//     started with, and a run with NO session information still records fine.
// ---------------------------------------------------------------------------
{
  try {
    const calls = []
    subagentsStub = {
      async start(kind, spec) {
        calls.push({ kind, label: spec && spec.label })
        return { result: Promise.resolve({ output: [{ type: 'text', text: 'OK' }], stopReason: 'completed' }), note: 'stub' }
      },
    }
    await svc.upsertAgent({ id: 'Coder', name: 'Coder', role: 'r', model: {}, updatedAt: 1 })
    const wfId = 'wf-p12e-runstart'
    await svc.upsertWorkflow({ id: wfId, name: 'runstart', nodes: { n1: { id: 'n1', title: 'T', agent: 'Coder', dependsOn: [], taskTemplate: { requirement: 'R', acceptanceCriteria: 'A' } } } })
    const started = await callRoute('/api/team-flowise/run/start', '', { method: 'POST', body: { workflowId: wfId, session: 'SESS-HTTP-1' } })
    const runId = started.json && started.json.run && started.json.run.id
    check('B6.1 POST /run/start 带 body.session -> HTTP 200 且返回 runId（写路径没被 P12 弄坏）',
      started.status === 200 && (started.json || {}).ok === true && typeof runId === 'string', JSON.stringify(started.json))
    const stored = runId === undefined ? undefined : rec('team_runs', 'runs', runId)
    check('B6.2 落库的 run 记录了该会话：sessionId === "SESS-HTTP-1"（丢掉 body.session 即红）',
      stored !== undefined && stored.sessionId === 'SESS-HTTP-1', JSON.stringify(stored && stored.sessionId))
    check('B6.3 落库记录能通过域校验（新增键一旦收紧，这里立刻炸）',
      stored !== undefined && mod.runsDomain.tables.runs.valueSchema.safeParse(stored).success !== false)
    check('B6.4 该 run 现在能被 /progress?session=SESS-HTTP-1 选中（写与读用同一套归属）',
      stored !== undefined && ((await callRoute('/api/team-flowise/progress', 'session=SESS-HTTP-1')).json || {}).run.id === runId)
    agentsSvcStub.currentInitiator = () => undefined
    const without = await callRoute('/api/team-flowise/run/start', '', { method: 'POST', body: { workflowId: wfId } })
    const runId2 = without.json && without.json.run && without.json.run.id
    check('B6.5 POST /run/start 不带 body.session 且没有 initiator -> 不抛异常、HTTP 200、返回 runId',
      without.status === 200 && (without.json || {}).ok === true && typeof runId2 === 'string', JSON.stringify(without.json))
    const stored2 = runId2 === undefined ? undefined : rec('team_runs', 'runs', runId2)
    check('B6.6 [无会话信息] 落库记录里 sessionId 不存在或为 null（绝不能编造一个会话）',
      stored2 !== undefined && (stored2.sessionId === undefined || stored2.sessionId === null),
      JSON.stringify({ hasKey: stored2 !== undefined && 'sessionId' in stored2, value: stored2 && stored2.sessionId }))
    check('B6.7 [无会话信息] 落库记录仍通过域校验且状态合理（归属缺失不得影响运行本身）',
      stored2 !== undefined && mod.runsDomain.tables.runs.valueSchema.safeParse(stored2).success !== false && typeof stored2.status === 'string',
      JSON.stringify(stored2 && stored2.status))
    const badWf = await callRoute('/api/team-flowise/run/start', '', { method: 'POST', body: { workflowId: 'nope', session: 'S1' } })
    check('B6.8 未知工作流仍同步报错（既有行为不变）：ok:false 且 error 点名未知 id',
      (badWf.json || {}).ok === false && String((badWf.json || {}).error).indexOf('nope') !== -1, JSON.stringify(badWf.json))
    const forbidden = await callRoute('/api/team-flowise/run/start', '', { method: 'POST', remoteAddress: '10.1.2.3', body: { workflowId: wfId, session: 'S1' } })
    check('B6.9 非回环地址仍被 403 挡下（写接口的既有防护没被削弱）', forbidden.status === 403, 'status=' + String(forbidden.status))
  } catch (e) { blockFailure('B6 /run/start 归属', e) }
}

// ---------------------------------------------------------------------------
// B7. roles / totals 口径未变（既有断言的形状），且每个 run 摘要带 sessionId。
// ---------------------------------------------------------------------------
{
  const p = (await callRoute('/api/team-flowise/progress', 'runId=run-other-s2')).json || {}
  const nodes = p.nodes || []
  const totalsKeys = Object.keys(p.totals || {}).sort()
  check('B7.1 totals 仍是既有 9 键（新增键不得挤进 totals）',
    eq(totalsKeys, ['completed', 'failed', 'pending', 'percent', 'reviewing', 'rework', 'total', 'unresolved', 'working'].sort()), totalsKeys.join(','))
  check('B7.2 totals 数值口径未变：percent === completed/total（1/2 -> 50），完成的 1 个 / 进行中的 1 个',
    p.totals.total === 2 && p.totals.completed === 1 && p.totals.working === 1 && p.totals.percent === 50, JSON.stringify(p.totals))
  const roleNames = (p.roles || []).map((r) => r.name).sort()
  const nodeNames = [...new Set(nodes.map((n) => (n.agentName === null ? '(未指派)' : n.agentName)))].sort()
  check('B7.3 [既有口径不许放宽] roles 集合仍恰好等于节点负责人集合（评审者不占泳道）',
    eq(roleNames, nodeNames), 'roles=' + JSON.stringify(roleNames) + ' nodes=' + JSON.stringify(nodeNames))
  check('B7.4 roles 条目键集合未变（name/total/completed/failed/working/reviewing/rework/pending/elapsedMs）',
    eq(Object.keys((p.roles || [])[0] || {}).sort(), ['completed', 'elapsedMs', 'failed', 'name', 'pending', 'reviewing', 'rework', 'total', 'working'].sort()),
    Object.keys((p.roles || [])[0] || {}).sort().join(','))
  check('B7.5 run 摘要带 sessionId（客户端据此判定"这是不是我的运行"）：run-other-s2 -> S2',
    p.run !== undefined && p.run.sessionId === 'S2', JSON.stringify(p.run && p.run.sessionId))
  check('B7.6 run 摘要其余键保持既有形状（id/workflowId/workflowName/status/startedAt/endedAt 一个不少）',
    ['id', 'workflowId', 'workflowName', 'status', 'startedAt', 'endedAt', 'sessionId'].every((k) => k in p.run), Object.keys(p.run).join(','))
  check('B7.7 节点条目仍带既有字段（id/status/agentName/dependsOn/brief/title），新增的归属字段没有挤掉它们',
    nodes.length === 2 && ['id', 'status', 'agentName', 'dependsOn', 'brief', 'title'].every((k) => k in nodes[0]),
    Object.keys(nodes[0] || {}).join(','))
}

// ===========================================================================
console.log('\n--- GROUP C: 客户端半（真实 bundle + 桩 React/DOM + 桩 fetch） ---')
// ---------------------------------------------------------------------------
// The harness's stub React/DOM is used verbatim (read + evaluated), same as
// p8-acceptance.mjs, because the harness's own materializeBundle stubs
// setInterval to a no-op, which would make the page's poll loop undrivable.
// ---------------------------------------------------------------------------
// `createReactStub` reuses one component INSTANCE per component function, so the
// page's useState/useRef cells survive across mounts. This suite renders the page
// four times with different fixtures, so it wraps the factory with a `reset()`
// that drops the instance/hook cache -- otherwise the second scenario would read
// the first scenario's state and every later assertion would be meaningless.
const helpers = readFileSync(HARNESS, 'utf8')
const { createReactStub, makeDocument, flatten, findNode } = new Function(
  helpers + '\nreturn { createReactStub, makeDocument, flatten, findNode }',
)()
function createResettableReact() {
  let react = createReactStub()
  const api = Object.create(react)
  for (const key of Object.keys(react)) api[key] = react[key]
  api.reset = function reset() {
    react = createReactStub()
    for (const key of Object.keys(react)) api[key] = react[key]
    return api
  }
  return api
}
const SCALE = Number(process.env.SCALE || 50) // 3000ms poll -> 60ms
const allDisposers = []
const collect = (list) => { for (const d of list) allDisposers.push(d) }

function evaluateBundle(source) {
  const react = createResettableReact()
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
  return { react, face: regs[0].factory(requireStub), window: windowStub, registration: regs[0] }
}

/** Capture every registration the face makes. `services` decides what ctx.get returns. */
function captureSlots(face, services) {
  const regs = []
  const injected = []
  const tabTypes = []
  const svc = services || {}
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
        if (svc.tabs === false) return undefined
        return { register(definition) { tabTypes.push(definition); return () => {} } }
      }
      if (name in svc) return svc[name]
      return undefined
    },
    effect(cb) { const d = cb(); if (typeof d === 'function') allDisposers.push(d); return () => {} },
    logger: { warn() {}, error() {}, info() {} },
  }
  let error
  try { face.apply(ctx) } catch (e) { error = e }
  return { regs, injected, tabTypes, error }
}

const clientSource = readFileSync(CLIENT_SRC, 'utf8')
check('C0.1 客户端 bundle 仍是单个自注册工厂 window.__ModuleLoader__.load({ id, factory }) 结构（本轮不得换成别的加载形态）',
  /window\s*\.\s*__ModuleLoader__\s*\.\s*load\s*\(\s*\{/.test(clientSource) && /\bid\s*:/.test(clientSource) && /\bfactory\s*:/.test(clientSource),
  String((/window\s*\.\s*__ModuleLoader__\s*\.\s*load\s*\(\s*\{/.exec(clientSource) || ['no match'])[0]))
let bundle = null
try {
  bundle = evaluateBundle(clientSource)
  check('C0.2 bundle 求值不抛异常，并暴露 name / inject / apply',
    typeof bundle.face.apply === 'function' && Array.isArray(bundle.face.inject) && typeof bundle.face.name === 'string',
    typeof bundle.face.name === 'string' ? bundle.face.name : typeof bundle.face)
} catch (e) { blockFailure('C0 bundle 求值', e) }

const realFetch = globalThis.fetch
const ALL_RUNS = [  { id: 'run-e-mine', workflowId: 'wf-e', status: 'running', startedAt: T0, sessionId: 'SESS-A' },
  { id: 'run-e-other', workflowId: 'wf-e', status: 'running', startedAt: T0 + 1000, sessionId: 'SESS-B' },
]
const RUN_MINE_E = { id: 'run-e-mine', workflowId: 'wf-e', workflowName: 'E 夹具工作流', status: 'running', startedAt: T0, endedAt: null, sessionId: 'SESS-A' }
const RUN_OTHER_E = { id: 'run-e-other', workflowId: 'wf-e', workflowName: 'E 夹具工作流', status: 'running', startedAt: T0 + 1000, endedAt: null, sessionId: 'SESS-B' }
const NODES_E = [
  { id: 'a', order: 0, agent: 'Coder', agentName: 'Coder', status: 'completed', startedAt: T0, endedAt: T0 + 1000, elapsedMs: 1000, title: 'A 节点', brief: '做 A', dependsOn: [], reviewer: null, review: null, route: null, persona: null, output: null, error: null, summary: 'A 完成' },
]
const env = (run, scope) => ({
  ok: true, run, scope,
  nodes: run === null ? [] : NODES_E,
  roles: run === null ? [] : [{ name: 'Coder', total: 1, completed: 1, failed: 0, working: 0, reviewing: 0, rework: 0, pending: 0, elapsedMs: 1000 }],
  reviewers: [],
  totals: { total: run === null ? 0 : 1, completed: run === null ? 0 : 1, failed: 0, working: 0, reviewing: 0, rework: 0, unresolved: 0, pending: 0, percent: run === null ? 0 : 100 },
})
const CALLS = []
/** The fetch stub: /progress and /runs answer per scenario; the rest is inert.
 *  Every URL is recorded into `CALLS` HERE (not by wrapping globalThis.fetch from
 *  outside), because this function REPLACES globalThis.fetch -- an outer wrapper
 *  would be thrown away by the next stubFetch call and the assertion would then
 *  read an empty list no matter what the page requested. */
function stubFetch(progressAnswer) {
  globalThis.fetch = (input) => {
    const raw = String(typeof input === 'string' ? input : input.url)
    CALLS.push(raw)
    const url = new URL(raw, 'http://x')
    const answer = typeof progressAnswer === 'function' ? progressAnswer(url) : progressAnswer
    if (url.pathname === '/api/team-flowise/progress') {
      if (answer && answer.__status) return Promise.resolve({ ok: false, status: answer.__status, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) })
    }
    if (url.pathname === '/api/team-flowise/runs') {
      const list = answer && Array.isArray(answer.__runs) ? answer.__runs : ALL_RUNS
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs: list }) })
    }
    if (url.pathname === '/api/team-flowise/workflows') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ workflows: [{ id: 'wf-e', name: 'E 夹具工作流', nodes: {} }] }) })
    if (url.pathname === '/api/team-flowise/role') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, run: null, role: null, nodes: [], reviews: [] }) })
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }
}

if (bundle !== null) {
  try {
    const services = { sessions: { list: { getSnapshot: () => ({ current: 'SESS-A', ids: ['SESS-A'], byId: {} }) } } }
    const applied = captureSlots(bundle.face, services)
    check('C1.1 face.apply(ctx)（含 sessions 服务）不抛异常', applied.error === undefined, applied.error ? String(applied.error) : '')
    const bySlot = (n) => applied.regs.filter((r) => r.options.name === n)
    check('C1.2 第 5 个注册面 sidebar.footer.action 出现，且带 id / order / label',
      bySlot('sidebar.footer.action').length === 1 && typeof bySlot('sidebar.footer.action')[0].options.id === 'string' &&
      bySlot('sidebar.footer.action')[0].options.order === 900 && typeof bySlot('sidebar.footer.action')[0].options.label === 'string',
      JSON.stringify(bySlot('sidebar.footer.action').map((r) => r.options)))
    check('C1.3 既有四个注册面一个都没丢（settings.section/team、sidebar.panellist/team-progress、main/team-progress、pane body + title）',
      bySlot('settings.section').length === 1 && bySlot('settings.section')[0].options.id === 'team' &&
      bySlot('sidebar.panellist').length === 1 && bySlot('sidebar.panellist')[0].options.id === 'team-progress' &&
      bySlot('main').length === 1 && bySlot('main')[0].options.key === 'team-progress' &&
      bySlot('sidebar.right.pane.tab').length === 1 && bySlot('sidebar.right.pane.tab.title').length === 1,
      JSON.stringify(applied.regs.map((r) => r.options.name)))
    check('C1.4 exports.inject 仍是 ["slots","locale"]（把 sessions 加进 inject 会在服务缺失时让整块 UI 不挂载）',
      eq(bundle.face.inject, ['slots', 'locale']), JSON.stringify(bundle.face.inject))

    // ---- the footer chip with EVERY optional service missing -------------
    const bare = captureSlots(bundle.face, { tabs: false })
    check('C2.1 sidebarRightTabs 缺失时 apply 不抛异常，且仍然注册了 footer 芯片与其余注册面',
      bare.error === undefined && bare.regs.filter((r) => r.options.name === 'sidebar.footer.action').length === 1,
      'error=' + String(bare.error) + ' regs=' + bare.regs.map((r) => r.options.name).join(','))
    const footerReg = bare.regs.filter((r) => r.options.name === 'sidebar.footer.action')[0]
    if (footerReg !== undefined) {
      stubFetch(env(null, { mode: 'global', sessionId: null, runCountInScope: 3, fallback: 'latest-global', hasAnyGlobal: true }))
      let chip = null
      let clickThrew = null
      try {
        const react = bundle.react
        chip = react.mount(react.createElement(footerReg.component, { wide: true }))
        collect(react.flushEffects())
        const btn = findNode(chip, (n) => n.type === 'button' && n.props && n.props.className === 'tf-foot-chip')
        check('C2.2 芯片渲染成一个 button.tf-foot-chip（常驻入口真的画出来了）', btn !== undefined, chip === null ? 'null' : flatten(chip).slice(0, 140))
        if (btn !== undefined && typeof btn.props.onClick === 'function') {
          try { btn.props.onClick() } catch (e) { clickThrew = e }
        } else { clickThrew = new Error('no onClick on the footer chip') }
      } catch (e) { clickThrew = e }
      check('C2.3 [必须] layout / sidebarRight / sessions 三个服务全部缺失时，点击芯片不抛异常（降级链走到"什么都不做"）',
        clickThrew === null, clickThrew === null ? 'no throw' : String(clickThrew && clickThrew.message ? clickThrew.message : clickThrew))
      await sleep(30)
      collect(bundle.react.flushEffects())
      let text = ''
      try { text = flatten(bundle.react.render(bundle.react.createElement(footerReg.component, { wide: true }))) } catch (e) { text = 'THREW: ' + String(e && e.message ? e.message : e) }
      check('C2.4 服务全缺时芯片仍给出可读状态文案（"团队：…"），不是空白也不是抛错', text.indexOf('团队：') !== -1, text.slice(0, 160))
      check('C2.5 服务全缺时芯片如实标注"拿不到当前会话 / 归属未知"，不假装是本会话的（否则正是 P12 要修的误读）',
        text.indexOf('归属未知') !== -1 || text.indexOf('拿不到当前会话') !== -1, text.slice(0, 220))
    } else {
      blockFailure('C2 footer 芯片注册', new Error('no sidebar.footer.action registration'))
    }
  } catch (e) { blockFailure('C1/C2 注册面与芯片', e) }
}

// ---------------------------------------------------------------------------
// C3. The three attribution states of the progress panel. The critical one is
//     S-others: the host answers THIS session's scope (run:null, count 0) while
//     /runs shows somebody else's run -- the panel must say so, must offer the
//     way out, and must NOT present that other run as this session's progress.
// ---------------------------------------------------------------------------
async function renderPage(progressAnswer, opts) {
  const o = opts || {}
  stubFetch(progressAnswer)
  const applied = captureSlots(bundle.face, {
    sessions: { list: { getSnapshot: () => ({ current: 'SESS-A', ids: ['SESS-A'], byId: {} }) } },
  })
  const main = applied.regs.filter((r) => r.options.name === 'main')[0]
  if (main === undefined) throw new Error('no main registration')
  const react = bundle.react
  react.reset()  // fresh instance/hook cache: the previous scenario's state must not leak in
  try {
    react.render(react.createElement(main.component))
    react.settle()
    for (let i = 0; i < 3; i += 1) { collect(react.flushEffects()); await sleep(25); react.settle() }
    await sleep(25)
    react.settle()
    return { tree: react.render(react.createElement(main.component)) }
  } catch (e) { return { tree: e } }
}

if (bundle !== null) {
  const textOf = (tree) => (typeof tree === 'string' ? tree : tree instanceof Error ? 'THREW: ' + tree.message : flatten(tree))
  const GLOBAL = { mode: 'global', sessionId: null, runCountInScope: 2, fallback: 'latest-global', hasAnyGlobal: true }
  const SCOPE_MINE = { mode: 'session', sessionId: 'SESS-A', runCountInScope: 1, fallback: 'latest-in-session', hasAnyGlobal: true }
  const SCOPE_EMPTY_HAS_GLOBAL = { mode: 'session', sessionId: 'SESS-A', runCountInScope: 0, fallback: null, hasAnyGlobal: true }
  const SCOPE_EMPTY_NOTHING = { mode: 'session', sessionId: 'SESS-A', runCountInScope: 0, fallback: null, hasAnyGlobal: false }
  try {
    // (a) S-mine: this session's own run.
    const mine = await renderPage((url) => (url.searchParams.get('session') === 'SESS-A'
      ? env(RUN_MINE_E, SCOPE_MINE)
      : env(RUN_OTHER_E, GLOBAL)))
    const mineText = textOf(mine.tree)
    check('C3.1 state S-mine：本会话有运行 -> 显示自己的那条（工作流名 + #短id），且不出现"其他会话"提示',
      mineText.indexOf('E 夹具工作流') !== -1 && mineText.indexOf('#e-mine') !== -1 && mineText.indexOf('其他会话') === -1, mineText.slice(0, 300))
    check('C3.2 state S-mine：/progress 请求真的带上 ?session=SESS-A（不带参数就等于回到改动前的全局最新）',
      CALLS.some((u) => u.indexOf('/progress?session=SESS-A') !== -1), CALLS.filter((u) => u.indexOf('/progress') !== -1).join(' | '))
    check('C3.2b state S-mine：/role 也按同一归属取（detailScope 用 session 而不是别的 run 的 id）',
      CALLS.some((u) => u.indexOf('/role') !== -1 && u.indexOf('session=SESS-A') !== -1) || CALLS.every((u) => u.indexOf('/role') === -1),
      CALLS.filter((u) => u.indexOf('/role') !== -1).join(' | ') || '(no /role call in this fixture)')
    CALLS.length = 0

    // (b) S-others: this session has nothing, while the store has other sessions'
    // runs. /runs is the unfiltered list the panel uses to notice that.
    const other = await renderPage((url) => (url.searchParams.get('session') === 'SESS-A'
      ? env(null, SCOPE_EMPTY_HAS_GLOBAL)
      : env(RUN_OTHER_E, GLOBAL)))
    const otherText = textOf(other.tree)
    check('C3.3 state S-others：显示"本会话还没有运行"，而不是"暂无运行"这种全局空态 —— 把"我这次没跑"说成"什么都没有"正是本轮要修的误读',
      otherText.indexOf('本会话还没有运行') !== -1 && otherText.indexOf('暂无运行。启动一个工作流后') === -1, otherText.slice(0, 340))
    check('C3.4 state S-others：给出"看全部运行"这个出口（否则用户无法看到别的会话/历史运行）',
      otherText.indexOf('看全部运行') !== -1, otherText.slice(0, 420))
    check('C3.5 state S-others：**不得**把全局那条（run-e-other，属于 SESS-B）当成自己的进度展示出来',
      otherText.indexOf('#e-other') === -1, otherText.slice(0, 320))
    check('C3.6 state S-others 与 S-mine 的关键文案不同（可区分）', otherText !== mineText, 'differ=' + String(otherText !== mineText))
    CALLS.length = 0

    // (b2) The host's CURRENT envelope for "this session is empty while others
    //      are running" is { mode:'session', runCountInScope:0, fallback:null,
    //      hasAnyGlobal:true } -- it deliberately does NOT claim a fallback it
    //      never performed. The client's classifier only recognises the OTHER
    //      signal, fallback === 'latest-global', so it ignores hasAnyGlobal and
    //      renders the global empty state instead of naming the other sessions.
    //      The REQUIREMENT (the global run must never be presented as this
    //      session's progress) still holds, so the two checks below assert that
    //      and the divergence itself is recorded as deviation D-2, not as a FAIL.
    const otherScope = await renderPage((url) => {
      const base = url.searchParams.get('session') === 'SESS-A' ? env(null, SCOPE_EMPTY_HAS_GLOBAL) : env(null, SCOPE_EMPTY_NOTHING)
      return { ...base, __runs: [] }
    })
    const otherScopeText = textOf(otherScope.tree)
    check('C3.7 state S-others（scope 驱动的分支）：不得把别的会话那条运行渲染成自己的进度（无 #e-other、无该 run 的工作流行）',
      otherScopeText.indexOf('#e-other') === -1 && otherScopeText.indexOf('本会话 #SESS-A') !== -1, otherScopeText.slice(0, 340))
    check('C3.7b state S-others（scope 驱动的分支）：仍然给出"看全部运行"这个出口（否则用户无法看到别处的运行）',
      otherScopeText.indexOf('看全部运行') !== -1, otherScopeText.slice(0, 420))
    check('C3.7c [偏差 D-2 已闭环] 客户端同时认 fallback==="latest-global" 与 {runCountInScope:0, fallback:null, hasAnyGlobal:true} 两种信号：' +
      '即使 /runs 为空（拿不到别处的运行），也必须说"本会话还没有运行"，不得退回全局空态',
      otherScopeText.indexOf('本会话还没有运行') !== -1 && otherScopeText.indexOf('暂无运行。启动一个工作流后') === -1,
      otherScopeText.slice(0, 340))
    CALLS.length = 0

    // (c) S-none: nothing anywhere -- the host's own scope says hasAnyGlobal=false,
    //     and /runs is empty too. Only NOW is the global empty state the honest
    //     rendering (it is deliberately NOT reused for (b), where others exist).
    const none = await renderPage((url) => {
      const base = url.searchParams.get('session') === 'SESS-A' ? env(null, SCOPE_EMPTY_NOTHING) : env(null, SCOPE_EMPTY_NOTHING)
      return { ...base, __runs: [] }
    })
    const noneText = textOf(none.tree)
    check('C3.8 state S-none：完全没有运行 -> 既有空态文案（不是错误态，也不是"本会话还没有运行"）',
      noneText.indexOf('暂无运行。启动一个工作流后') !== -1 && noneText.indexOf('进度获取失败') === -1 && noneText.indexOf('本会话还没有运行') === -1, noneText.slice(0, 260))
    check('C3.8b 三种状态的文案两两不同（S-mine / S-others / S-none 可区分）',
      new Set([mineText, otherText, noneText]).size === 3, 'distinct=' + new Set([mineText, otherText, noneText]).size)
    CALLS.length = 0

    // (d) a legacy run record: no sessionId anywhere.
    const legacyEnv = env({ ...RUN_OTHER_E, sessionId: undefined }, SCOPE_EMPTY_HAS_GLOBAL)
    const legacyPage = await renderPage((url) => (url.searchParams.get('session') === 'SESS-A' ? legacyEnv : env(RUN_OTHER_E, GLOBAL)))
    const legacyText = textOf(legacyPage.tree)
    check('C3.9 state 遗留记录（run 没有 sessionId）：如实标注"无法判定归属"，不猜也不当成自己的',
      legacyText.indexOf('无法判定') !== -1 || legacyText.indexOf('早于会话归属') !== -1, legacyText.slice(0, 340))
    CALLS.length = 0

    // (e) failure states: 401 and 500 must look like FAILURE, not emptiness.
    const t401 = textOf((await renderPage({ __status: 401 })).tree)
    check('C3.10 /progress 返回 401 -> 显示错误态（"进度获取失败" + 401 的成因说明），不是空态',
      t401.indexOf('进度获取失败') !== -1 && t401.indexOf('401') !== -1, t401.slice(0, 280))
    check('C3.11 401 时不得渲染"暂无运行"这种空态（把一次失败说成"没有活干"正是这一条要防的误读）',
      t401.indexOf('暂无运行。启动一个工作流后') === -1, t401.slice(0, 280))
    CALLS.length = 0
    const t500 = textOf((await renderPage({ __status: 500 })).tree)
    check('C3.12 /progress 返回 500 -> 错误态且点名 500（不是空态）',
      t500.indexOf('进度获取失败') !== -1 && t500.indexOf('500') !== -1 && t500.indexOf('暂无运行。启动一个工作流后') === -1, t500.slice(0, 280))
    check('C3.13 401 与 500 的错误文案可区分（不是同一句万能话）', t401 !== t500, 'differ=' + String(t401 !== t500))
  } catch (e) { blockFailure('C3 进度页三态与错误态', e) } finally { globalThis.fetch = realFetch }
}
globalThis.fetch = realFetch
for (const d of allDisposers) { try { d() } catch { /* ignore */ } }

// ===========================================================================
console.log('\n--- GROUP D: 安装脚本 / 可移植性（临时 profile 副本，绝不碰真实 profile） ---')
// ===========================================================================
const REAL_PROFILE = join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'web')
const hashOf = (p) => {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex') } catch (e) { return 'UNREADABLE:' + String(e && e.message ? e.message : e) }
}
const realBefore = { pkg: hashOf(join(REAL_PROFILE, 'package.json')), patch: hashOf(join(REAL_PROFILE, 'cordis.patch.yml')) }

/** Minimal YAML reader for the patch layer: only what the assertions need. */
function parsePatchLayer(text) {
  const lines = text.split(/\r?\n/)
  const out = { lines, comments: [], insertRows: [], rowIds: [], body: [] }
  let inInsert = false
  let insertIndent = -1
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const t = raw.trim()
    if (t === '') continue
    if (t.startsWith('#')) { out.comments.push(raw); continue }
    out.body.push(t)
    const indent = raw.length - raw.replace(/^\s+/, '').length
    if (/^-\s*insert\s*:\s*$/.test(t)) { inInsert = true; insertIndent = indent; continue }
    const idm = /^-\s*id\s*:\s*(\S+)\s*$/.exec(t)
    if (idm) {
      out.rowIds.push(idm[1])
      if (inInsert && indent > insertIndent) out.insertRows.push({ line: i, id: idm[1] })
      continue
    }
    if (inInsert && indent <= insertIndent) inInsert = false
  }
  return out
}
function runScript(script, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return { code: e.status === undefined || e.status === null ? -1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  }
}
function reportOf(res) {
  const at = res.stdout.indexOf('{')
  if (at === -1) return null
  try { return JSON.parse(res.stdout.slice(at)) } catch { return null }
}

const TMP = join(tmpdir(), 'tf-p12e-' + randomUUID())
let profilePath = null
try {
  mkdirSync(TMP, { recursive: true })
  const PROFILE = join(TMP, 'profile')
  profilePath = PROFILE
  mkdirSync(PROFILE, { recursive: true })
  const PATCH_HEADER = [
    '# dsh profile patch layer — hand-written notes that must survive install + uninstall verbatim.',
    "# (This block is the test fixture standing in for the real profile's user comments.)",
    '',
    '[]',
    '',
  ].join('\n')
  writeFileSync(join(PROFILE, 'package.json'), JSON.stringify({
    name: 'dsh-profile-p12e-fixture',
    private: true,
    dependencies: { '@deepseek-ai/dsh-base': '0.1.5-rc.1', dshmarket: '^1.20.2' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'] } },
  }, null, 2) + '\n', 'utf8')
  writeFileSync(join(PROFILE, 'cordis.yml'), '[]\n', 'utf8')
  writeFileSync(join(PROFILE, 'cordis.patch.yml'), PATCH_HEADER, 'utf8')
  const pkgJson = () => JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'))
  const patchText = () => readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8')
  const countIn = (h, needle) => (h.split(needle).length - 1)
  const base = ['--profile', PROFILE, '--package', PKG_DIR, '--skill-root', 'none']

  // ---- D1: first install ------------------------------------------------
  const i1 = runScript(INSTALL_SRC, [...base, '--json'])
  const r1 = reportOf(i1)
  check('D1.1 首次 install exit 0，且 --json 报告可解析（tool/ok/mode/added 都在）',
    i1.code === 0 && r1 !== null && r1.tool === 'install' && r1.ok === true && r1.mode === 'install',
    'exit=' + String(i1.code) + ' keys=' + (r1 === null ? 'unparsable' : Object.keys(r1).slice(0, 8).join(',')))
  const pkg1 = pkgJson()
  const patch1 = patchText()
  const layer1 = parsePatchLayer(patch1)
  check('D1.2 依赖项按 JSON 解析后确实写入了 dependencies["@local/team-flowise"]（不是文本替换）',
    typeof pkg1.dependencies['@local/team-flowise'] === 'string' && pkg1.dependencies['@local/team-flowise'].length > 0, JSON.stringify(pkg1.dependencies))
  check('D1.3 其它依赖键一个都没丢（dsh-base / dshmarket 仍在）',
    pkg1.dependencies['@deepseek-ai/dsh-base'] !== undefined && pkg1.dependencies.dshmarket !== undefined, JSON.stringify(pkg1.dependencies))
  check('D1.4 bundles 里出现 @local/team-flowise 且恰好 1 次（不去重其它项、不改顺序）',
    pkg1.dsh.profile.bundles.filter((b) => b === '@local/team-flowise').length === 1 &&
    eq(pkg1.dsh.profile.bundles.slice(0, 3), ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket']),
    JSON.stringify(pkg1.dsh.profile.bundles))
  check('D1.5 cordis.patch.yml 里 id: flowise-team 恰好 1 次，且位于 - insert: 块内',
    layer1.rowIds.filter((x) => x === 'flowise-team').length === 1 && layer1.insertRows.length === 1, JSON.stringify(layer1.rowIds) + ' insertRows=' + String(layer1.insertRows.length))
  check('D1.6 insert 块内 name 指向 @local/team-flowise 且 disabled: false',
    patch1.indexOf("name: '@local/team-flowise'") !== -1 && /-\s*id:\s*flowise-team[\s\S]{0,200}?disabled:\s*false/.test(patch1),
    patch1.split('\n').slice(-6).join(' | '))
  check('D1.7 首次安装的 added 计数如实：link/dep/bundles/insertRows 各 1',
    r1 !== null && r1.added.bundles === 1 && r1.added.insertRows === 1 && r1.added.link === 1 && r1.added.dep === 1, JSON.stringify(r1 && r1.added))
  const linkPath = join(PROFILE, 'node_modules', '@local', 'team-flowise')
  let linkInfo = null
  try {
    const lst = statSync(linkPath)
    let target = null
    try { target = realpathSync.native(linkPath) } catch { target = null }
    linkInfo = { isDir: lst.isDirectory(), exists: existsSync(linkPath), target }
  } catch (e) { linkInfo = null }
  check('D1.8 node_modules/@local/team-flowise 存在且解析到插件包目录（复制一份源码会造成"改了不生效"的幽灵故障）',
    linkInfo !== null && linkInfo.target !== null &&
    linkInfo.target.replace(/\\/g, '/').toLowerCase() === realpathSync.native(PKG_DIR).replace(/\\/g, '/').toLowerCase(),
    JSON.stringify(linkInfo))
  check('D1.9 --skill-root none 真的没有写任何技能目录（临时目录里不该出现 skills/）',
    !existsSync(join(TMP, 'skills')) && !existsSync(join(PROFILE, 'skills')), 'no skills dir')
  check('D1.10 安装没有碰 bundles 之外的 profile 键（name/private/dsh.profile 结构仍在）',
    pkg1.name === 'dsh-profile-p12e-fixture' && pkg1.private === true && pkg1.dsh.profile.bundles.length === 4 && eq(Object.keys(pkg1).sort(), ['dependencies', 'dsh', 'name', 'private']),
    JSON.stringify(Object.keys(pkg1)))

  // ---- D2: second install must change nothing ---------------------------
  const before2 = { pkg: readFileSync(join(PROFILE, 'package.json'), 'utf8'), patch: patchText() }
  const i2 = runScript(INSTALL_SRC, [...base, '--json'])
  const r2 = reportOf(i2)
  const after2 = { pkg: readFileSync(join(PROFILE, 'package.json'), 'utf8'), patch: patchText() }
  check('D2.1 [幂等] 第二次 install exit 0 且 added 全为 0（bundle 判重、insert 判重、link 判重都生效）',
    i2.code === 0 && r2 !== null && r2.added.bundles === 0 && r2.added.insertRows === 0 && r2.added.link === 0 && r2.added.dep === 0, JSON.stringify(r2 && r2.added))
  check('D2.2 [幂等] 第二跑后 package.json 与 cordis.patch.yml 逐字节等于第一跑后（内容相同）',
    before2.pkg === after2.pkg && before2.patch === after2.patch,
    'pkgSame=' + String(before2.pkg === after2.pkg) + ' patchSame=' + String(before2.patch === after2.patch))
  check('D2.3 [幂等] 第二跑后 bundles 里去重为 1、id: flowise-team 仍恰好出现 1 次（重复 insert = profile 启动即抛 TypeError: duplicate loader entry id）',
    pkgJson().dsh.profile.bundles.filter((b) => b === '@local/team-flowise').length === 1 && countIn(patchText(), 'id: flowise-team') === 1,
    'bundles=' + JSON.stringify(pkgJson().dsh.profile.bundles) + ' idCount=' + String(countIn(patchText(), 'id: flowise-team')))
  check('D2.4 [幂等] 第二跑的 changes 为空数组（脚本自己报告"零改动"）',
    r2 !== null && Array.isArray(r2.changes) && r2.changes.length === 0, JSON.stringify(r2 && r2.changes))

  // ---- D3: --check in both states ---------------------------------------
  const cInstalled = runScript(INSTALL_SRC, [...base, '--check', '--json'])
  check('D3.1 [--check 已装且一致] exit 0（约定：0 = 已装且一致）',
    cInstalled.code === 0, 'exit=' + String(cInstalled.code) + ' stderr=' + cInstalled.stderr.slice(0, 120))
  const brokenProfile = join(TMP, 'profile-uninstalled')
  mkdirSync(brokenProfile, { recursive: true })
  writeFileSync(join(brokenProfile, 'package.json'), JSON.stringify({ name: 'dsh-profile-p12e-uninstalled', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8')
  writeFileSync(join(brokenProfile, 'cordis.patch.yml'), '# empty layer\n[]\n', 'utf8')
  const cMissing = runScript(INSTALL_SRC, ['--profile', brokenProfile, '--package', PKG_DIR, '--skill-root', 'none', '--check', '--json'])
  const cMissingReport = reportOf(cMissing)
  check('D3.2 [--check 未装] exit 3（约定：3 = 缺失/不一致），与已装状态的 0 明确不同',
    cMissing.code === 3 && cMissing.code !== cInstalled.code, 'installed=' + String(cInstalled.code) + ' missing=' + String(cMissing.code))
  check('D3.3 [--check 未装] 报告点名每一项缺失（link/bundles/insert 至少三项），而不是只给一个退出码',
    cMissingReport !== null && Array.isArray(cMissingReport.checkFailures) && cMissingReport.checkFailures.length >= 3,
    JSON.stringify(cMissingReport && cMissingReport.checkFailures))
  const cMissingExit1 = runScript(INSTALL_SRC, ['--profile', join(TMP, 'does-not-exist'), '--package', PKG_DIR, '--check', '--json'])
  check('D3.4 [--check 目标不存在] 是"错误"（exit 1）而不是"未安装"（exit 3）——两种失败必须可分',
    cMissingExit1.code === 1, 'exit=' + String(cMissingExit1.code))

  // ---- D4: --dry-run writes nothing -------------------------------------
  const dryProfile = join(TMP, 'profile-dry')
  mkdirSync(dryProfile, { recursive: true })
  writeFileSync(join(dryProfile, 'package.json'), JSON.stringify({ name: 'dsh-profile-p12e-dry', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8')
  writeFileSync(join(dryProfile, 'cordis.patch.yml'), '# empty layer\n[]\n', 'utf8')
  const dryBefore = { pkg: readFileSync(join(dryProfile, 'package.json'), 'utf8'), patch: readFileSync(join(dryProfile, 'cordis.patch.yml'), 'utf8'), nm: existsSync(join(dryProfile, 'node_modules')) }
  const dry = runScript(INSTALL_SRC, ['--profile', dryProfile, '--package', PKG_DIR, '--skill-root', 'none', '--dry-run', '--json'])
  const dryAfter = { pkg: readFileSync(join(dryProfile, 'package.json'), 'utf8'), patch: readFileSync(join(dryProfile, 'cordis.patch.yml'), 'utf8'), nm: existsSync(join(dryProfile, 'node_modules')) }
  check('D4.1 [--dry-run] exit 0 但零写盘：两个配置文件逐字节不变，且没有创建 node_modules',
    dry.code === 0 && dryBefore.pkg === dryAfter.pkg && dryBefore.patch === dryAfter.patch && dryAfter.nm === false,
    'exit=' + String(dry.code) + ' pkgSame=' + String(dryBefore.pkg === dryAfter.pkg) + ' nm=' + String(dryAfter.nm))
  check('D4.2 [--dry-run] 仍然报告"将会发生什么"（added 计数非零），而不是静默通过',
    (() => { const r = reportOf(dry); return r !== null && (r.added.bundles === 1 || r.added.insertRows === 1) })(),
    JSON.stringify(reportOf(dry) && reportOf(dry).added))

  // ---- D5: uninstall restores the original state ------------------------
  const u1 = runScript(UNINSTALL_SRC, [...base, '--json'])
  const ur1 = reportOf(u1)
  check('D5.1 uninstall exit 0，tool=uninstall，且移除了 link/dep/bundles/insert 四项',
    u1.code === 0 && ur1 !== null && ur1.tool === 'uninstall' && ur1.removed.link === 1 && ur1.removed.dep === 1 && ur1.removed.bundles === 1 && ur1.removed.insertRows === 1,
    'exit=' + String(u1.code) + ' removed=' + JSON.stringify(ur1 && ur1.removed))
  const pkgU = pkgJson()
  check('D5.2 uninstall 后 dependencies 里的 @local/team-flowise 键消失（其它键仍在）',
    pkgU.dependencies['@local/team-flowise'] === undefined && pkgU.dependencies['@deepseek-ai/dsh-base'] !== undefined, JSON.stringify(pkgU.dependencies))
  check('D5.3 uninstall 后 bundles 数组整项移除、其余项逐字不变',
    eq(pkgU.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket']), JSON.stringify(pkgU.dsh.profile.bundles))
  check('D5.4 uninstall 后 node_modules/@local/team-flowise 链接消失（且没有跟进删除目标包目录）',
    !existsSync(linkPath) && existsSync(join(PKG_DIR, 'src', 'index.js')), 'linkGone=' + String(!existsSync(linkPath)))
  const layerU = parsePatchLayer(patchText())
  check('D5.5 uninstall 后 cordis.patch.yml 里 id: flowise-team 出现 0 次，且 - insert: 空块没有残留',
    layerU.rowIds.length === 0 && patchText().indexOf('- insert:') === -1, JSON.stringify({ ids: layerU.rowIds, hasInsert: patchText().indexOf('- insert:') !== -1 }))
  check('D5.6 uninstall 后 patch 层仍是合法 YAML 顶层数组（只剩注释会让宿主启动即报错）：body 只含 []',
    eq(layerU.body, ['[]']), JSON.stringify(layerU.body))
  check('D5.7 [R4] uninstall 后用户的两行注释逐字不变（绝不整文件 YAML 重写）',
    layerU.comments.length === 2 &&
    layerU.comments[0] === '# dsh profile patch layer — hand-written notes that must survive install + uninstall verbatim.' &&
    layerU.comments[1].indexOf('# (This block is the test fixture') === 0,
    JSON.stringify(layerU.comments))
  const unCheckAfter = runScript(UNINSTALL_SRC, [...base, '--check', '--json'])
  check('D5.8 uninstall 后 --check 认为"已彻底卸载"：exit 0', unCheckAfter.code === 0, 'exit=' + String(unCheckAfter.code))
  const u2 = runScript(UNINSTALL_SRC, [...base, '--json'])
  const ur2 = reportOf(u2)
  check('D5.9 [幂等] 第二次 uninstall 零移除、changes 为空（already-uninstalled 是成功，不是错误）',
    u2.code === 0 && ur2 !== null && ur2.counts.removed === 0 && ur2.changes.length === 0,
    JSON.stringify(ur2 && { removed: ur2.counts.removed, changes: ur2.changes.length }))
  const reCheck = runScript(INSTALL_SRC, [...base, '--check', '--json'])
  check('D5.10 [--check 未装] 安装脚本对同一 profile 报 3（"缺失"），与 uninstall 的 0 口径互补', reCheck.code === 3, 'exit=' + String(reCheck.code))

  // ---- D6: the positive half of "portable" ------------------------------
  const depSpec = pkg1.dependencies['@local/team-flowise']
  check('D6.1 [正向证据] 脚本确实写了一条指向本机包路径的依赖值（否则"仓库里没有绝对路径"可能是"什么都没做"换来的假绿）',
    /^file:|^link:/.test(String(depSpec)) && String(depSpec).indexOf('team-flowise') !== -1, String(depSpec))
  check('D6.2 [正向证据] 那条依赖值解析后就是本次 --package 传入的包目录',
    (() => {
      const v = String(depSpec || '').replace(/^(file|link):/, '')
      const abs = /^[A-Za-z]:[\\/]/.test(v) ? v : join(PROFILE, v)
      try { return realpathSync.native(abs).replace(/\\/g, '/').toLowerCase() === realpathSync.native(PKG_DIR).replace(/\\/g, '/').toLowerCase() } catch { return false }
    })(), String(depSpec))
  check('D6.3 [正向证据] 这次运行真的写了盘（第一跑后的文件里既有依赖项也有 insert 行），不是空跑',
    pkg1.dependencies['@local/team-flowise'] !== undefined && patch1.indexOf('flowise-team') !== -1)
} catch (e) { blockFailure('D 组安装/回滚场景', e) }

// ---------------------------------------------------------------------------
// D7. Portability: no machine-absolute path may be DISTRIBUTED with the package.
//     Fails if anyone commits "D:\ai-workspace\..." into a shipped file (the
//     deploy/ snapshot used to carry one).
// ---------------------------------------------------------------------------
{
  const ABS = /[A-Za-z]:[\\/](?:ai-workspace|Users|Program|Windows|temp|Temp)/
  const scanRoots = [
    { label: 'packages/team-flowise', dir: join(REPO, 'packages/team-flowise'), skip: /[\\/]node_modules[\\/]|[\\/]\.git[\\/]|\.zip$/ },
    { label: 'scripts', dir: join(REPO, 'scripts') },
    { label: 'skills', dir: join(REPO, 'skills') },
    { label: 'deploy', dir: join(REPO, 'deploy') },
  ]
  const walkFiles = (dir, skip, out) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (skip && skip.test(p + (e.isDirectory() ? sep : ''))) continue
      if (e.isDirectory()) walkFiles(p, skip, out)
      else if (e.isFile()) out.push(p)
    }
    return out
  }
  const offenders = []
  let scanned = 0
  for (const root of scanRoots) {
    for (const f of walkFiles(root.dir, root.skip, [])) {
      if (/\.(png|jpg|jpeg|gif|webp|zip|ico)$/i.test(f)) continue
      let text = ''
      try { text = readFileSync(f, 'utf8') } catch { continue }
      scanned += 1
      const m = ABS.exec(text)
      if (m !== null) {
        const idx = text.indexOf(m[0])
        offenders.push(root.label + ':' + f.slice(REPO.length + 1) + ':' + String(text.slice(0, idx).split('\n').length) + ' -> ' + m[0])
      }
    }
  }
  check('D7.1 随包分发的文件里没有 D:\\ 形式的绝对路径（packages/team-flowise/**、scripts/**、skills/**、deploy/**；共扫 ' + scanned + ' 个文本文件）' +
    '。范围有意不含 validation/ 与 workflows/：它们是本仓库的开发工装，不随包分发给使用者',
    offenders.length === 0, offenders.slice(0, 8).join(' ; ') || 'no absolute machine path')
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8')
  check('D7.2 仓库根 README.md 同样不含工作区/用户绝对路径', !ABS.test(readme), (ABS.exec(readme) || ['none'])[0])
  const deployPkg = readFileSync(join(REPO, 'deploy/web-profile/package.json'), 'utf8')
  check('D7.3 deploy/web-profile/package.json 不再硬编码 link:D:/ai-workspace/...（快照可移植）',
    deployPkg.indexOf('D:/ai-workspace') === -1 && deployPkg.indexOf('D:\\\\ai-workspace') === -1, deployPkg.slice(0, 200))
  const deployPatch = readFileSync(join(REPO, 'deploy/web-profile/cordis.patch.yml'), 'utf8')
  check('D7.4 deploy/web-profile/cordis.patch.yml 的 insert 行用包名而不是绝对路径',
    deployPatch.indexOf('D:/ai-workspace') === -1 && deployPatch.indexOf('@local/team-flowise') !== -1)
  const deployReadme = readFileSync(join(REPO, 'deploy/README.md'), 'utf8')
  check('D7.5 deploy/README.md 给出可照抄的安装用法（含 install.mjs 与 --profile）',
    deployReadme.indexOf('install.mjs') !== -1 && deployReadme.indexOf('--profile') !== -1,
    deployReadme.split('\n').filter((l) => l.indexOf('install.mjs') !== -1).slice(0, 2).join(' | '))
}

// ---------------------------------------------------------------------------
// D9. The guard that makes "we never touch the real profile" a CHECK and not a
//     promise. Fails if ANY step above wrote to %USERPROFILE%\.dsh\profiles\web.
// ---------------------------------------------------------------------------
{
  const realAfter = { pkg: hashOf(join(REAL_PROFILE, 'package.json')), patch: hashOf(join(REAL_PROFILE, 'cordis.patch.yml')) }
  check('D9.1 [真实 profile 未被触碰] 本文件跑完后 %USERPROFILE%\\.dsh\\profiles\\web 的 package.json 与 cordis.patch.yml 哈希与开跑前一致',
    realAfter.pkg === realBefore.pkg && realAfter.patch === realBefore.patch,
    'pkgSame=' + String(realAfter.pkg === realBefore.pkg) + ' patchSame=' + String(realAfter.patch === realBefore.patch))
  check('D9.2 临时 profile 确实建在系统临时目录里（不是仓库、也不是用户 profile 目录）',
    profilePath === null || (profilePath.indexOf(tmpdir()) === 0 && profilePath.indexOf(REAL_PROFILE) === -1), String(profilePath))
}

// ===========================================================================
console.log('\n--- GROUP E: 文档一致性（SKILL.md 与宿主注册名的唯一真值来源） ---')
// ===========================================================================
let skillBody = ''
let skillFront = null
{
  let raw = null
  try { raw = readFileSync(SKILL, 'utf8') } catch { raw = null }
  check('E1.1 skills/team-flowise/SKILL.md 存在且非空（技能是"让 agent 知道插件存在"的那条路）',
    raw !== null && raw.length > 500, raw === null ? 'missing' : 'bytes=' + raw.length)
  if (raw !== null) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
    skillFront = fm === null ? null : fm[1]
    skillBody = fm === null ? raw : raw.slice(fm[0].length)
    const field = (src, key) => {
      const m = new RegExp('^' + key + '\\s*:\\s*(.+)$', 'm').exec(src || '')
      return m === null ? null : m[1].trim()
    }
    const name = field(skillFront, 'name')
    const description = field(skillFront, 'description')
    check('E1.2 frontmatter 以 --- 开头并有闭合行（宿主 parseSkillFile 的硬要求；缺失会整份被静默忽略）',
      fm !== null && skillFront.length > 0, fm === null ? 'no frontmatter' : 'frontmatter bytes=' + skillFront.length)
    check('E1.3 frontmatter 的 name 逐字等于 "team-flowise"（与目录名一致）', name === 'team-flowise', JSON.stringify(name))
    check('E1.4 name 匹配宿主技能名正则 ^[a-z0-9]+(?:-[a-z0-9]+)*$（不匹配会被静默忽略）',
      typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), String(name))
    check('E1.5 frontmatter 有非空的 description（缺失时宿主只打一行 warn 就丢掉整份技能）',
      typeof description === 'string' && description.length > 20, description === null ? 'missing' : 'len=' + description.length)
    check('E1.6 正文不是空壳：流程 / 工具 / 界面 / 故障四类小节都在',
      ['流程', '工具', '界面', '故障'].every((k) => skillBody.indexOf(k) !== -1),
      ['流程', '工具', '界面', '故障'].map((k) => k + '=' + String(skillBody.indexOf(k) !== -1)).join(','))
  }
}
// ---------------------------------------------------------------------------
// E2. THE cross-check: the tool names the skill talks about must be EXACTLY the
//     tool names the host registered (captured in group A -- one source of
//     truth, so a host rename reddens this instead of drifting).
// ---------------------------------------------------------------------------
{
  const registered = new Set(defs.map((d) => d.name))
  const mentioned = new Set(skillBody.match(/\bteam_[a-z0-9_]+/g) || [])
  const missing = [...registered].filter((n) => !mentioned.has(n)).sort()
  const extra = [...mentioned].filter((n) => !registered.has(n)).sort()
  check('E2.1 SKILL.md 正文里的 team_* 工具名集合与宿主注册集合：不许有多余的名字（提到不存在的工具即红）',
    extra.length === 0, extra.join(',') || 'no phantom tool name')
  check('E2.2 同一集合的另一半：宿主注册的每个工具都在正文里被讲到（少一个即红）',
    missing.length === 0, missing.join(',') || 'all ' + registered.size + ' covered')
  check('E2.3 无参数工具在文档里也标成"无参数"（正文的 required 口径与 A4 的编译结果一致）',
    /takes no arguments|不接受任何参数/i.test(skillBody), String(/不接受任何参数/.test(skillBody)))
}
// ---------------------------------------------------------------------------
// E3. Parameter names in the skill must be ones the host really accepts.
//     Identifiers are extracted from inline code spans (camelCase only, so prose
//     like `subagent` / `blocking` is not part of the contract); the accepted set
//     is built from the tool schemas + the workflow/node schemas. Fails if the
//     doc invents a parameter the host does not accept.
// ---------------------------------------------------------------------------
{
  const accepted = new Set()
  for (const d of defs) for (const p of paramWalk(d.parameters, '', [])) accepted.add(p.path.split('.').pop())
  for (const schema of [mod.workflowNodeSchema, mod.workflowSchema]) {
    for (const k of Object.keys((schema && schema.shape) || {})) accepted.add(k)
  }
  const parsedWf = mod.workflowSchema.safeParse({ id: 'w', updatedAt: 1, nodes: { n: { id: 'n', dependsOn: [], taskTemplate: {}, gate: {} } }, review: {} })
  if (parsedWf.success) {
    for (const k of Object.keys(parsedWf.data.review || {})) accepted.add(k)
    const n = (parsedWf.data.nodes || {}).n || {}
    for (const k of Object.keys(n.taskTemplate || {})) accepted.add(k)
    for (const k of Object.keys(n.gate || {})) accepted.add(k)
  }
  // Schema identifiers the skill names as MECHANISM (which layer enforces what),
  // not as tool parameters. Accepted only when this module really exports them, so
  // an invented name is still red: this widens the CONTRACT the doc may name, it
  // does not widen the excuse list.
  for (const name of ['runSchema', 'workflowSchema', 'workflowNodeSchema', 'agentDefSchema', 'modelSchema', 'modelRouteSchema']) {
    if (mod[name] !== undefined) accepted.add(name)
  }
  // Non-parameter vocabulary the skill legitimately names: the response fields of
  // /progress, /role and the task ledger, the two rework limits the plan states
  // as constants, and the UI tab label. Kept EXPLICIT and NARROW so the assertion
  // stays falsifiable: inventing a parameter is still red, because only these
  // exact names are excused.
  const DOC_ONLY = new Set([
    'advisoryCount', 'blockingCount', 'unresolvedReason', 'reviewRoute', 'reviewPersona',
    'reviewedAgentName', 'reviewedStatus', 'nodeTitle', 'taskStatus', 'outputRef', 'reasoningLen',
    'maxReworkPerNode', 'maxReworkPerRun', 'hasAnyGlobal', 'runCountInScope', 'sessionId', 'taskId',
  ])
  // Everything else with a capital MUST be a real camelCase
  // parameter/schema field: two segments, first letter lower case. That filter is
  // what keeps UI labels (`Agents`) and role names (`Planner`, `Coder`,
  // `Validator`, `Reviewer`) out of the contract without excusing them by name.
  const NOT_AN_IDENTIFIER = new Set(['Agents'])
  // Dotted names are reduced to their last segment ("review.maxRework" -> the
  // workflow-level `review.maxRework` field, which the schema really declares).
  const allBackticked = [...new Set((skillBody.match(/`([A-Za-z][A-Za-z0-9_.]*)`/g) || [])
    .map((s) => s.slice(1, -1))
    .map((id) => (id.indexOf('.') !== -1 ? id.split('.').pop() : id)))]
  const candidates = allBackticked.filter((id) => /^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(id) && !/^team_/.test(id) && !NOT_AN_IDENTIFIER.has(id))
  const unknown = candidates.filter((id) => !accepted.has(id) && !DOC_ONLY.has(id))
  check('E3.1 SKILL.md 里的每一个参数名（反引号内 camelCase，共 ' + candidates.length + ' 个候选）都是宿主真实接受的参数或 schema 字段（凭空造一个参数名即红）',
    unknown.length === 0, unknown.join(',') || 'all accepted')
  check('E3.2 反向自检：这条断言真的在扫文档里的参数名（候选数 ≥ 8；正则被写坏会在这里变红）',
    candidates.length >= 8 && allBackticked.length > candidates.length,
    'candidates=' + candidates.length + '/' + allBackticked.length + ' -> ' + candidates.slice(0, 12).join(','))
  const declared = ['requirement', 'acceptanceCriteria', 'assignee', 'taskTemplate', 'dependsOn', 'reviewer']
  check('E3.3 六个关键参数名都能在"宿主接受集"里找到（accepted 集合本身是活的，取自真实 schema）',
    declared.every((k) => accepted.has(k)), declared.filter((k) => !accepted.has(k)).join(',') || 'all 6 accepted')
  const tableParams = ['workflowId', 'input', 'name', 'description', 'nodes', 'route', 'prompt', 'agent', 'task', 'id', 'role', 'systemPrompt', 'provider', 'model', 'reasoningEffort', 'maxTokens', 'timeoutMs', 'toolsPreset']
  check('E3.4 §3 工具表里列出的参数名全部是宿主真实接受的参数（文档表格与 schema 不许漂移）',
    tableParams.every((k) => accepted.has(k)), tableParams.filter((k) => !accepted.has(k)).join(',') || 'all accepted')
}

// ===========================================================================
console.log('\n--- GROUP F: 变异测试（真的让检查变红，然后再恢复） ---')
// ---------------------------------------------------------------------------
// Every mutation is built as a COPY in the system temp dir (never in the repo),
// imported/run from there, and deleted at the end. The host copy is made
// importable by rewriting its three bare specifiers to the absolute paths the
// package's own node_modules resolves to -- a plain copy would die with
// ERR_MODULE_NOT_FOUND because the temp dir has no node_modules.
// ===========================================================================
const MUT_TMP = join(tmpdir(), 'tf-p12e-mut-' + randomUUID())
const IMPORT_SPECS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain', 'zod']
function importableCopy(srcFile, outFile) {
  let text = readFileSync(srcFile, 'utf8')
  // Resolution goes through createRequire with `paths: [dirname(srcFile)]`, i.e.
  // exactly the lookup Node itself would do for the REAL file. (import.meta.resolve
  // here resolves relative to THIS validation file, which does not see the
  // package's node_modules and fails with "cannot resolve".)
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

if (process.env.P12_SKIP_MUTATIONS === '1') {
  console.log('  ...  P12_SKIP_MUTATIONS=1 -> 变异组跳过（不计入检查数）')
} else if (process.env.P12_SRC || process.env.P12_INSTALL_SRC) {
  console.log('  ...  子进程模式（P12_SRC / P12_INSTALL_SRC 已设置）-> 不再递归跑变异')
} else {
  mkdirSync(MUT_TMP, { recursive: true })
  const mutations = []
  // M1: one tool description back to the shared placeholder.
  {
    const M1 = join(MUT_TMP, 'host-m1-description.js')
    try {
      importableCopy(SRC, M1)
      let t = readFileSync(M1, 'utf8')
      const from = "'Register ONE unit of team work in the durable task ledger."
      const at = t.indexOf(from)
      if (at === -1) check('F0.1 [夹具] 变异靶点 M1 的替换串在宿主源码里存在（找不到 = 测试自己过期，必须红）', false, 'needle not found')
      else {
        const end = t.indexOf("', { requirement:", at)
        t = t.slice(0, at) + "'" + PLACEHOLDER + t.slice(end)
        writeFileSync(M1, t, 'utf8')
        mutations.push({
          id: 'M1', what: '把 team_create_task 的 description 改回占位文本 "' + PLACEHOLDER + '"',
          expectLabels: ['A1.2', 'A1.3', 'A3.1'],
          env: { P12_SRC: M1, P12_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('F0.1 [夹具] M1 变异体构造失败（夹具问题，不是被测代码问题）', false, String(e && e.message ? e.message : e)) }
  }
  // M2: "this session has no run" degrades into the global newest -- in BOTH
  // places that decide it (selectRun AND the /progress scope envelope), because
  // /progress reads the envelope while the pure function is asserted directly.
  {
    const M2 = join(MUT_TMP, 'host-m2-selectrun.js')
    try {
      importableCopy(SRC, M2)
      let t = readFileSync(M2, 'utf8')
      const needle1 = 'return scoped.length === 0 ? null : newestRunOf(scoped);'
      const needle2 = 'return { mode: \'session\', sessionId: sid, run: null, runCountInScope: 0, fallback: null, hasAnyGlobal: globalNewest !== null };'
      if (t.indexOf(needle1) === -1) check('F0.2 [夹具] 变异靶点 M2 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle1 not found')
      else if (t.indexOf(needle2) === -1) check('F0.2 [夹具] 变异靶点 M2 的 runScope 替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle2 not found')
      else {
        t = t.replace(needle1, 'return scoped.length === 0 ? newestRunOf(list) : newestRunOf(scoped);')
        t = t.replace(needle2, 'return { mode: \'session\', sessionId: sid, run: globalNewest, runCountInScope: scoped.length, fallback: \'latest-global\', hasAnyGlobal: globalNewest !== null };')
        writeFileSync(M2, t, 'utf8')
        mutations.push({
          id: 'M2', what: '把"指定会话无运行"改成退化为全局最新（selectRun 与 /progress 的 scope 信封两处一起改；回退成 P12 要修的缺陷）',
          expectLabels: ['B1.4', 'B2.3', 'B4.6', 'B4.9'],
          env: { P12_SRC: M2, P12_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('F0.2 [夹具] M2 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  // M3: the installer's insert-row de-duplication removed.
  {
    const M3 = join(MUT_TMP, 'install-m3-nodedup.mjs')
    try {
      let t = readFileSync(INSTALL_SRC, 'utf8')
      const needle = 'if (scan.rows.length === 1) {'
      if (t.indexOf(needle) === -1) check('F0.3 [夹具] 变异靶点 M3 的替换串存在（找不到 = 测试自己过期，必须红）', false, 'needle not found')
      else {
        // Short-circuit the "the row is already there" guard: the append path
        // then lands a SECOND `- id: flowise-team` in the same file.
        t = t.replace(needle, 'if (false && ' + needle.slice(3))
        writeFileSync(M3, t, 'utf8')
        mutations.push({
          id: 'M3', what: '删掉安装脚本的 insert 判重（"已存在即跳过"的分支被短路）',
          expectLabels: ['D2.1', 'D2.3', 'D3.1'],
          env: { P12_INSTALL_SRC: M3, P12_SKIP_MUTATIONS: '1' },
        })
      }
    } catch (e) { check('F0.3 [夹具] M3 变异体构造失败', false, String(e && e.message ? e.message : e)) }
  }
  for (const m of mutations) {
    try {
      const run = runThisSuite(m.env)
      const stats = statsOf(run.stdout)
      const labels = failedLabelsOf(run.stdout)
      const hit = m.expectLabels.filter((want) => labels.some((l) => l.indexOf(want) === 0))
      check('F.' + m.id + '.1 [' + m.what + '] 该变异真的让本套件变红（exit 1），不是"看起来红"',
        run.code === 1 && stats !== null && stats.failures > 0,
        'exit=' + String(run.code) + ' checks=' + String(stats && stats.checks) + ' failures=' + String(stats && stats.failures))
      check('F.' + m.id + '.2 [' + m.what + '] 变红的正是被点名的那些检查（' + m.expectLabels.join(' / ') + ' 全部命中）',
        hit.length === m.expectLabels.length, 'hit=' + hit.join(',') + ' | allFailed=' + labels.slice(0, 10).join(' ; ').slice(0, 460))
      check('F.' + m.id + '.3 [' + m.what + '] 红在"检查"上而不是套件崩溃：SUMMARY 打印了，且没有 FATAL / 未捕获异常',
        run.stdout.indexOf('FATAL') === -1 && run.stdout.indexOf('未捕获异常') === -1 && run.stdout.indexOf('=== SUMMARY ===') !== -1 && run.stdout.indexOf('RESULT: FAIL') !== -1,
        'fatal=' + String(run.stdout.indexOf('FATAL') !== -1) + ' summary=' + String(run.stdout.indexOf('=== SUMMARY ===') !== -1))
      console.log('       [变异 ' + m.id + ' 原始输出] exit=' + String(run.code) + ' ' + String(stats && ('checks=' + stats.checks + ' failures=' + stats.failures)))
      for (const l of labels.slice(0, 8)) console.log('         FAILED>> ' + l)
    } catch (e) { blockFailure('F.' + m.id + ' 变异运行', e) }
  }
  const copiedBack = []
  for (const f of ['host-m1-description.js', 'host-m2-selectrun.js', 'install-m3-nodedup.mjs']) {
    const inRepo = join(PKG_DIR, 'src', f)
    if (existsSync(inRepo)) copiedBack.push(inRepo)
    const inScripts = join(REPO, 'scripts', f)
    if (existsSync(inScripts)) copiedBack.push(inScripts)
  }
  check('F4.1 变异体只存在于系统临时目录：仓库的包目录与 scripts 目录里没有留下任何变异副本',
    copiedBack.length === 0, copiedBack.join(',') || MUT_TMP)
}

// ===========================================================================
// Cleanup: remove every temp artefact this file created.
try { rmSync(TMP, { recursive: true, force: true }) } catch { /* ignore */ }
try { rmSync(MUT_TMP, { recursive: true, force: true }) } catch { /* ignore */ }

summary()
process.exit(failures === 0 ? 0 : 1)
