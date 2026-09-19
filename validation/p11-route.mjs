// P11-C: executable tests for P11 "role-level configuration" of team-flowise:
// the route layering (run > node > workflow > role > inherited), the pair rule,
// the effort-clearing warning, the persona layering, the tool presets, the
// `/models` catalog, and the honest route/persona projections on the read plane.
//
// Groups:
//   A  module-level PURE functions (no ctx, no host, no restart)
//   B  schema compatibility (safeParse + the real upsert write paths)
//   C  the REAL host half mounted on a stub ctx, driving the REAL scheduler
//   D  the read plane through the REAL route handlers
//
// Usage:
//   node validation/p11-route.mjs                       # test the repo source
//   P11_SRC=<path-to-a-copy> node validation/p11-route.mjs
//       -> test a COPY (used by the mutation runs: the copy is broken on
//          purpose in the system temp dir, never in the repository).
//
// Exit code: 0 = every check passed, 1 = at least one check failed,
//            2 = the module under test could not even be imported.
//
// Every check states what it verifies AND what concrete change to the source
// turns it red; section E of the report runs three such mutations for real.
import { readFileSync } from 'node:fs'

const SRC = process.env.P11_SRC && process.env.P11_SRC.trim() !== ''
  ? process.env.P11_SRC.trim()
  : 'D:/ai-workspace/dsh/packages/team-flowise/src/index.js'
const SRC_URL = /^file:/.test(SRC) ? SRC : 'file:///' + SRC.replace(/\\/g, '/')

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
 * below: without that, a throw inside the bare (unguarded) group A checks killed
 * the process with no SUMMARY at all, so "the suite went red" was
 * indistinguishable from "the suite broke" -- a mutation could look like a pass.
 */
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  console.log('module under test: ' + SRC_URL)
  if (failures > 0) {
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

console.log('\n=== P11-C role-level configuration tests ===')
let srcSize = -1
try { srcSize = readFileSync(SRC).length } catch { /* keep -1 */ }
console.log('module under test: ' + SRC_URL)
console.log('source bytes: ' + String(srcSize) + (process.env.P11_SRC ? '  (MUTATION MODE: not the repository file)' : ''))

let mod = null
try { mod = await import(SRC_URL) } catch (e) {
  console.log('FATAL: cannot import the module under test: ' + String(e && e.message ? e.message : e))
  process.exit(2)
}

// ===========================================================================
console.log('\n--- GROUP A: module-level pure functions (no ctx, no restart) ---')
// ---------------------------------------------------------------------------
// A1. ROUTE_SOURCES: the ONE source of truth for layer names and precedence.
//     Fails if a layer is renamed, dropped, reordered, or a sixth layer is
//     invented -- every `source` value in the data plane is drawn from it.
// ---------------------------------------------------------------------------
console.log('\n[A1] ROUTE_SOURCES / routeSignature')
{
  const R = mod.ROUTE_SOURCES
  check('A1.1 ROUTE_SOURCES 已导出且恰为 [run,node,workflow,role,inherited]（顺序即优先级，改名/换序即红）',
    eq(R, ['run', 'node', 'workflow', 'role', 'inherited']), JSON.stringify(R))
  check('A1.2 ROUTE_SOURCES 是长度 5 的字符串数组（多一层少一层都要在这里爆炸）',
    Array.isArray(R) && R.length === 5 && R.every((x) => typeof x === 'string'), 'len=' + String(R && R.length))
  check('A1.3 五个纯函数/常量全部具名导出（缺一个就等于对应检查组整体失效）',
    typeof mod.pickRoute === 'function' && typeof mod.routeWarnings === 'function' && typeof mod.mergePersona === 'function' &&
    typeof mod.timeoutFor === 'function' && typeof mod.expandToolPreset === 'function' && mod.TOOL_PRESETS !== undefined &&
    typeof mod.routeSignature === 'function' && typeof mod.verifyRoute === 'function' && typeof mod.normalizeRouteLayer === 'function',
    [typeof mod.pickRoute, typeof mod.routeWarnings, typeof mod.mergePersona, typeof mod.timeoutFor, typeof mod.expandToolPreset, typeof mod.routeSignature, typeof mod.verifyRoute].join(','))
  const sig = mod.routeSignature({ provider: 'p', model: 'm', reasoningEffort: 'high', maxTokens: 4096 })
  check('A1.4 routeSignature 全字段时输出固定顺序 provider;model;effort;maxTokens（顺序变了去重就会失效）',
    sig === 'provider=p;model=m;effort=high;maxTokens=4096', String(sig))
  check('A1.5 routeSignature 忽略空字段：{} 得空串，只有 provider 时只得 provider=（空字段参与即红）',
    mod.routeSignature({}) === '' && mod.routeSignature({ model: '   ' }) === '' && mod.routeSignature({ provider: 'p' }) === 'provider=p',
    JSON.stringify([mod.routeSignature({}), mod.routeSignature({ model: '   ' }), mod.routeSignature({ provider: 'p' })]))
  check('A1.6 routeSignature 对不合法 maxTokens 不产出字段（非法值不得混进可比较串）',
    mod.routeSignature({ maxTokens: 0 }) === '' && mod.routeSignature({ maxTokens: -3 }) === '', JSON.stringify(mod.routeSignature({ maxTokens: 0 })))
}

// ---------------------------------------------------------------------------
// A2. pickRoute: layer selection. THE core semantic of P11. Fails if a layer is
//     skipped, if precedence is reordered, if an empty/blank layer counts as a
//     declaration, or -- the one that matters most -- if the winning layer is
//     merged field-by-field with a losing one instead of winning WHOLE.
// ---------------------------------------------------------------------------
console.log('\n[A2] pickRoute 的五层优先级与整层胜出')
{
  const pr = (layers) => mod.pickRoute(layers)
  const U = undefined
  // A-P1: run beats node (same-shaped fields).
  const p1 = pr({ run: { model: 'm1' }, node: { model: 'm2' } })
  check('A-P1 run 层击败 node 层：source=run 且 route 逐字等于 run 层（若变成 node 的 m2 即红）',
    eq(p1, { route: { model: 'm1' }, source: 'run' }), JSON.stringify(p1))
  // A-P2: WHOLE layer wins -- the mutation M1 target.
  const p2 = pr({ run: { provider: 'p1' }, node: { provider: 'p2', model: 'm2' } })
  check('A-P2 整层胜出（M1 靶点）：run 只给 provider、node 给了 provider+model 时，结果必须是 run 的整层，route.model 必须不存在',
    eq(p2, { route: { provider: 'p1' }, source: 'run' }), JSON.stringify(p2))
  check('A-P2b 反向拼装检查：结果里不得出现任何 node 层字段（p2/m2 一个都不许漏进来）',
    p2.route.provider === 'p1' && p2.route.model === undefined && JSON.stringify(p2.route).indexOf('m2') === -1, JSON.stringify(p2.route))
  // A-P3: blank fields are not declarations.
  const p3 = pr({ node: { provider: '', model: '   ' }, workflow: { model: 'm3' } })
  check('A-P3 只有空白字段的层不算有效层（node 全空白 -> 落到 workflow 的 m3；若 source 变 node 即红）',
    eq(p3, { route: { model: 'm3' }, source: 'workflow' }), JSON.stringify(p3))
  check('A-P3b 空对象同样不是有效层（{} 不得赢下任何比它低的层）',
    eq(pr({ run: {}, node: null, workflow: { provider: ' p3 ', model: 'm3' } }), { route: { provider: 'p3', model: 'm3' }, source: 'workflow' }),
    JSON.stringify(pr({ run: {}, node: null, workflow: { provider: ' p3 ', model: 'm3' } })))
  // A-P4: nothing declared anywhere.
  const p4a = pr({})
  const p4b = pr({ run: null, node: U, workflow: null, role: U })
  check('A-P4 四层皆无效 -> {route:{}, source:"inherited"}（返回 null 或抛异常都判负）',
    eq(p4a, { route: {}, source: 'inherited' }) && eq(p4b, { route: {}, source: 'inherited' }),
    JSON.stringify([p4a, p4b]))
  check('A-P4b pickRoute(undefined/null) 不抛异常且同为 inherited（旧调用方可能不传 layers）',
    eq(pr(U), { route: {}, source: 'inherited' }) && eq(pr(null), { route: {}, source: 'inherited' }))
  // A-P5: role is the lowest declared layer.
  const p5 = pr({ role: { provider: 'p4', model: 'm4', reasoningEffort: 'high', maxTokens: 4096 } })
  check('A-P5 低层只在高层全空时生效：role 全字段原样成为结果（source=role）',
    eq(p5, { route: { provider: 'p4', model: 'm4', reasoningEffort: 'high', maxTokens: 4096 }, source: 'role' }), JSON.stringify(p5))
  // A-P6: maxTokens ALONE is a valid layer.
  const p6 = pr({ node: { maxTokens: 2048 } })
  check('A-P6 只有 maxTokens 也算有效层（P11-PLAN A6：source=node、route 只有 maxTokens；若被当作空层落到 role/inherited 即红）',
    eq(p6, { route: { maxTokens: 2048 }, source: 'node' }), JSON.stringify(p6))
  // A-P7: maxTokens:0 is illegal => the layer is not a declaration.
  const p7 = pr({ node: { maxTokens: 0 }, role: { model: 'm4' } })
  check('A-P7 maxTokens:0 非法 -> node 层无效并落到 role（若 0 被当成有效声明即红）',
    eq(p7, { route: { model: 'm4' }, source: 'role' }), JSON.stringify(p7))
  for (const bad of [-1, 0, 1.2e400, '5', true, null, '   ', {}, []]) {
    const r = pr({ node: { maxTokens: bad }, role: { model: 'm4' } })
    check('A-P7b 非法 maxTokens ' + JSON.stringify(bad === undefined ? null : bad) + ' 不得让 node 层生效（必须落到 role）',
      r.source === 'role' && r.route.maxTokens === undefined, JSON.stringify(r))
  }
  // Documented boundary of the current implementation, asserted so a future edit
  // is a deliberate one: 0 < maxTokens < 1 is kept by pickRoute even though the
  // role schema requires a POSITIVE INTEGER, so such a layer wins with a value
  // that the agent definition itself could never store. (P11-PLAN section 2.2
  // says only `Math.floor(v) >= 1` is valid, i.e. 0.5 would be dropped.)
  const frac = pr({ node: { maxTokens: 0.5 }, role: { provider: 'pr', model: 'mr' } })
  check('A-P7c [记录现状/偏差 O4] maxTokens=0.5（0<x<1 的小数）当前被当成有效字段并赢下 node 层；role schema 要求正整数，两者口径不一致',
    frac.source === 'node' && frac.route.maxTokens === 0.5, JSON.stringify(frac))
  // A-P8: three declared layers, only the highest participates.
  const p8 = pr({ run: { model: 'm1' }, workflow: { provider: 'p3', model: 'm3' }, role: { provider: 'p4', model: 'm4' } })
  check('A-P8 三层都有时只取最高层：run 的 {model:m1}，workflow/role 的字段一个都不出现',
    eq(p8, { route: { model: 'm1' }, source: 'run' }), JSON.stringify(p8))
  // A-P9: whitespace normalisation.
  const p9 = pr({ node: { provider: '  p9  ', model: ' m9 ' } })
  check('A-P9 有效字符串被 trim 后进入结果（前后空白不得被带到 agentOptions）',
    eq(p9.route, { provider: 'p9', model: 'm9' }), JSON.stringify(p9.route))
  // A-P10: reasoningEffort alone is a declaration too.
  check('A-P10 只有 reasoningEffort 也算有效层（effort 不构成 route 对，但确实是本层的一次声明）',
    eq(pr({ workflow: { reasoningEffort: 'low' } }), { route: { reasoningEffort: 'low' }, source: 'workflow' }),
    JSON.stringify(pr({ workflow: { reasoningEffort: 'low' } })))
  // A-P11: single-half layer still WINS the layer (the pair rule drops the half
  // later, in routeWarnings + the dispatch guard) -- but the attribution must
  // stay truthful about which layer the operator declared.
  const p11 = pr({ run: { model: 'only-model' }, role: { provider: 'pr', model: 'mr' } })
  check('A-P11 半对层仍赢得该层归属（source=run），成对作废发生在 routeWarnings/派发守卫，不在 pickRoute',
    p11.source === 'run' && p11.route.model === 'only-model' && p11.route.provider === undefined, JSON.stringify(p11))
  // A-P12: normalizeRouteLayer is the shared primitive; a non-object layer must
  // not be treated as a declaration.
  check('A-P12 normalizeRouteLayer 对非对象（数组/字符串/数字）一律返回 null（否则 "5" 会变有效层）',
    mod.normalizeRouteLayer([]) === null && mod.normalizeRouteLayer('p') === null && mod.normalizeRouteLayer(5) === null && mod.normalizeRouteLayer(undefined) === null,
    JSON.stringify([mod.normalizeRouteLayer([]), mod.normalizeRouteLayer('p'), mod.normalizeRouteLayer(5)]))
  // A-P13: pickRoute must not mutate the caller's layers (the scheduler passes
  // node/workflow records straight in).
  const layers = { run: { provider: '  x  ' }, node: { model: 'y' } }
  const before = JSON.stringify(layers)
  pr(layers)
  check('A-P13 pickRoute 不修改入参（规范化必须落在一份新对象上；就地改会让工作流记录被悄悄改写）',
    JSON.stringify(layers) === before, JSON.stringify(layers))
}

// ---------------------------------------------------------------------------
// A3. routeWarnings: the pair rule, the effort-clearing truth, illegal
//     maxTokens. Messages only, no IO. Fails if a message disappears, if a
//     half-declared pair stops being voided, or if a warning fires when it must
//     not (a warning that is always on carries no information).
// ---------------------------------------------------------------------------
console.log('\n[A3] routeWarnings')
{
  const rw = (route, parent) => mod.routeWarnings({ route }, parent)
  const onlyProvider = rw({ provider: 'p9' }, null)
  check('A3.1 只给 provider 不给 model -> 恰好一条成对作废警告，且点名被忽略的是 provider（成对规则消失即红）',
    Array.isArray(onlyProvider) && onlyProvider.length === 1 && onlyProvider[0].indexOf('成对') !== -1 &&
    onlyProvider[0].indexOf('provider') !== -1 && onlyProvider[0].indexOf('p9') !== -1,
    JSON.stringify(onlyProvider))
  check('A3.1b 警告说明"保留它会拼装出没有作者声明过的混合路由"（不说清后果的警告等于没说）',
    onlyProvider[0].indexOf('混合路由') !== -1, String(onlyProvider[0]).slice(0, 120))
  const onlyModel = rw({ model: 'm9' }, null)
  check('A3.2 只给 model 不给 provider -> 同样成对作废，且点名被忽略的是 model（两个方向都要有）',
    Array.isArray(onlyModel) && onlyModel.length === 1 && onlyModel[0].indexOf('成对') !== -1 && onlyModel[0].indexOf('m9') !== -1,
    JSON.stringify(onlyModel))
  check('A3.3 成对齐全时不出现成对警告（provider+model 都在 => 无成对条目）',
    rw({ provider: 'p1', model: 'm1' }, null).every((m) => m.indexOf('成对') === -1),
    JSON.stringify(rw({ provider: 'p1', model: 'm1' }, null)))
  // The mutation M2 target.
  const changed = rw({ provider: 'p1', model: 'm1' }, { provider: 'po', model: 'mo', reasoningEffort: 'high' })
  check('A3.4 route 变更且未声明 effort -> 明确写出"父级 effort 会被清除"（删掉该分支即红，这是本轮最容易被忽略的运行时真相）',
    changed.some((m) => m.indexOf('父级 effort 会被清除') !== -1), JSON.stringify(changed))
  check('A3.4b 该警告同时点名父级的 route（po/mo），排障才有一句话答案；且写明 effort 改由模型默认值决定',
    changed.some((m) => m.indexOf('po/mo') !== -1) && changed.some((m) => m.indexOf('默认值') !== -1), JSON.stringify(changed))
  check('A3.4c [记录现状/偏差 O2] 该警告未回显本层（胜出层）自己的 route；P11-PLAN §4 情况 4 只要求给出父级，故不判负，但排障时需自行比对',
    !changed.some((m) => m.indexOf('p1/m1') !== -1), JSON.stringify(changed))
  check('A3.5 父级未知（null）时同样提示 effort 会被清除，但必须写成"父级未知"而不是编造一个父级 route',
    rw({ provider: 'p1', model: 'm1' }, null).some((m) => m.indexOf('父级未知') !== -1),
    JSON.stringify(rw({ provider: 'p1', model: 'm1' }, null)))
  check('A3.6 route 与父级完全相同 -> 不得出现 effort 清除警告（routeChanged=false；恒开即红）',
    rw({ provider: 'p1', model: 'm1' }, { provider: 'p1', model: 'm1', reasoningEffort: 'high' }).every((m) => m.indexOf('父级 effort 会被清除') === -1),
    JSON.stringify(rw({ provider: 'p1', model: 'm1' }, { provider: 'p1', model: 'm1', reasoningEffort: 'high' })))
  check('A3.7 显式声明了 effort -> 不得出现 effort 清除警告（声明了就一定传下去）',
    rw({ provider: 'p1', model: 'm1', reasoningEffort: 'low' }, { provider: 'po', model: 'mo', reasoningEffort: 'high' }).every((m) => m.indexOf('父级 effort 会被清除') === -1),
    JSON.stringify(rw({ provider: 'p1', model: 'm1', reasoningEffort: 'low' }, { provider: 'po', model: 'mo', reasoningEffort: 'high' })))
  check('A3.8 只有 maxTokens、无 provider/model -> 不得凭空报 effort 清除（没换路由，父级 effort 不受影响）',
    rw({ maxTokens: 2048 }, { provider: 'po', model: 'mo', reasoningEffort: 'high' }).every((m) => m.indexOf('父级 effort') === -1),
    JSON.stringify(rw({ maxTokens: 2048 }, { provider: 'po', model: 'mo', reasoningEffort: 'high' })))
  const badMax = rw({ provider: 'p1', model: 'm1', maxTokens: 0 }, null)
  check('A3.9 maxTokens 非法 -> 明确写出"已忽略"并回显原值（静默丢字段即红）',
    badMax.some((m) => m.indexOf('maxTokens 非法') !== -1 && m.indexOf('已忽略') !== -1), JSON.stringify(badMax))
  check('A3.9b 非法 maxTokens 的警告里回显了原值 0（只说"非法的值"无法排障）',
    badMax.some((m) => m.indexOf('0') !== -1), JSON.stringify(badMax))
  check('A3.10 合法 maxTokens -> 不报任何 maxTokens 警告（恒开即红）',
    rw({ provider: 'p1', model: 'm1', maxTokens: 4096 }, null).every((m) => m.indexOf('maxTokens') === -1),
    JSON.stringify(rw({ provider: 'p1', model: 'm1', maxTokens: 4096 }, null)))
  check('A3.11 空 route -> 空数组（不得无条件塞噪音）', eq(rw({}, null), []), JSON.stringify(rw({}, null)))
  check('A3.12 接受裸 route 对象（不只 {route} 包装）与 undefined，且永不抛异常',
    rw(undefined, null).length >= 0 && mod.routeWarnings(undefined, undefined).length >= 0 && mod.routeWarnings({ provider: 'p' }, 'nope').length === 1,
    JSON.stringify(mod.routeWarnings(undefined, undefined)))
}

// ---------------------------------------------------------------------------
// A4. mergePersona: role -> workflow -> node, blank layers skipped, joined by a
//     blank line. Fails if the order flips, if a blank layer contributes an
//     empty slot, or if `layers` lists a layer that contributed nothing.
// ---------------------------------------------------------------------------
console.log('\n[A4] mergePersona')
{
  const mp = (l) => mod.mergePersona(l)
  const three = mp({ role: 'ROLE', workflow: 'WF', node: 'NODE' })
  check('A4.1 三层顺序 role -> workflow -> node，用两个换行连接（顺序反了即红）',
    three.text === 'ROLE\n\nWF\n\nNODE', JSON.stringify(three))
  check('A4.2 layers 数组按同一顺序只列真正贡献内容的层',
    eq(three.layers, ['role', 'workflow', 'node']), JSON.stringify(three.layers))
  check('A4.3 chars === text.length（UI 显示的"人设 xxx 字"必须与真实文本一致）',
    three.chars === three.text.length && three.chars === 'ROLE\n\nWF\n\nNODE'.length, String(three.chars))
  const mid = mp({ role: 'R', node: 'N' })
  check('A4.4 中间层缺席时不留下空槽：R 与 N 之间只有一个空行，layers=[role,node]',
    mid.text === 'R\n\nN' && eq(mid.layers, ['role', 'node']), JSON.stringify(mid))
  const blanks = mp({ role: '   ', workflow: '', node: '\n\t ', })
  check('A4.5 空层不参与：全为空白串时 text="" 且 layers=[]，chars=0（空白被当成内容即红）',
    blanks.text === '' && eq(blanks.layers, []) && blanks.chars === 0, JSON.stringify(blanks))
  const empty = mp({})
  check('A4.6 全空（对象缺失）-> {text:"", layers:[], chars:0}（这是"不设置 spec.persona"的判定依据）',
    empty.text === '' && eq(empty.layers, []) && empty.chars === 0, JSON.stringify(empty))
  check('A4.7 undefined / null 入参不抛异常且返回空结果',
    mp(undefined).text === '' && mp(null).text === '' && eq(mp(undefined).layers, []), JSON.stringify(mp(undefined)))
  const wfOnly = mp({ workflow: 'WF' })
  check('A4.8 只有 workflow 层 -> layers=["workflow"]（缺省层不得被补进数组）',
    wfOnly.text === 'WF' && eq(wfOnly.layers, ['workflow']), JSON.stringify(wfOnly))
  const keep = mp({ role: '  R  ' })
  check('A4.9 文本原样拼接、不做 trim/改写（用户写什么就是什么）',
    keep.text === '  R  ' && keep.chars === 5, JSON.stringify(keep))
  const nodeOnly = mp({ node: 'NODE-ONLY' })
  check('A4.10 node 层单独存在时也生效（node 是最高优先级的人设层，不能被吞掉）',
    nodeOnly.text === 'NODE-ONLY' && eq(nodeOnly.layers, ['node']), JSON.stringify(nodeOnly))
}

// ---------------------------------------------------------------------------
// A5. timeoutFor: a role may only TIGHTEN its own bound. Fails if a 0 / negative
//     declaration becomes an instant timeout, or if a huge one escapes the
//     ceiling (which would let one role hang a whole run).
// ---------------------------------------------------------------------------
console.log('\n[A5] timeoutFor 的夹紧')
{
  const tf = (def, ceiling) => mod.timeoutFor(def, ceiling)
  check('A5.1 声明 1000 -> 1000（下界本身允许）', tf({ timeoutMs: 1000 }, 600000) === 1000, String(tf({ timeoutMs: 1000 }, 600000)))
  check('A5.2 声明 10^9 -> 被夹到 ceiling 600000（越界声明不得抬高超时）', tf({ timeoutMs: 1000000000 }, 600000) === 600000, String(tf({ timeoutMs: 1000000000 }, 600000)))
  check('A5.3 未声明 -> ceiling（缺省即默认上限，不是无界）', tf({}, 300000) === 300000 && tf(undefined, 300000) === 300000, String(tf(undefined, 300000)))
  check('A5.4 声明 0 / 负数 -> 视为未声明，落在 ceiling 而不是 0 或 1000（0 不是"立即超时"而是笔误）',
    tf({ timeoutMs: 0 }, 300000) === 300000 && tf({ timeoutMs: -5 }, 300000) === 300000,
    JSON.stringify([tf({ timeoutMs: 0 }, 300000), tf({ timeoutMs: -5 }, 300000)]))
  check('A5.5 声明 1..999 -> 抬到下界 1000（避免出现必然超时的荒谬上界）', tf({ timeoutMs: 1 }, 600000) === 1000, String(tf({ timeoutMs: 1 }, 600000)))
  check('A5.6 非法 ceiling（0/NaN/负数/非数）-> 回落 600000，不得返回 0 或 NaN',
    tf({}, 0) === 600000 && tf({}, NaN) === 600000 && tf({}, -1) === 600000 && tf({}, 'x') === 600000,
    JSON.stringify([tf({}, 0), tf({}, NaN), tf({}, -1), tf({}, 'x')]))
  check('A5.7 声明值恰为 ceiling -> ceiling（边界不得被下界逻辑改写）', tf({ timeoutMs: 600000 }, 600000) === 600000, String(tf({ timeoutMs: 600000 }, 600000)))
}

// ---------------------------------------------------------------------------
// A6. TOOL_PRESETS / expandToolPreset: the four discipline presets, and the
//     "an unknown name is RECORDED, not dropped" rule (mutation M4 target).
// ---------------------------------------------------------------------------
console.log('\n[A6] TOOL_PRESETS 与 expandToolPreset')
{
  const P = mod.TOOL_PRESETS
  check('A6.1 四个预设 full/no-write/no-shell/read-only 齐备（缺一个即红，UI 的下拉就少一项）',
    P !== undefined && ['full', 'no-write', 'no-shell', 'read-only'].every((k) => Array.isArray(P[k])), P === undefined ? 'undefined' : Object.keys(P).join(','))
  check('A6.2 full 不附加任何 deny（只保留插件自身的 WORKER_DENY_TOOLS）', eq(P.full, []), JSON.stringify(P.full))
  check('A6.3 no-write 含 write / edit / str_replace_editor（写盘三件套，漏一个预设就形同虚设）',
    ['write', 'edit', 'str_replace_editor'].every((n) => P['no-write'].indexOf(n) !== -1), JSON.stringify(P['no-write']))
  check('A6.4 no-shell 含 pwsh / bash', ['pwsh', 'bash'].every((n) => P['no-shell'].indexOf(n) !== -1), JSON.stringify(P['no-shell']))
  check('A6.5 read-only 恰好等于 no-write ∪ no-shell 的并集（只改一个而漏另一个即红）',
    (() => {
      const union = [...new Set([...P['no-write'], ...P['no-shell']])].sort()
      return eq([...P['read-only']].sort(), union)
    })(), JSON.stringify(P['read-only']))
  const known = new Set(['read', 'write', 'edit', 'pwsh', 'web_fetch'])
  const nw = mod.expandToolPreset('no-write', known)
  check('A6.6 known 里没有 str_replace_editor 时不得进入 deny（把不存在的名字塞进 filter 会被运行时整条拒绝）',
    eq(nw.deny.sort(), ['edit', 'write']), JSON.stringify(nw))
  check('A6.7 不可见的名字必须出现在 unknown 里（M4 靶点：改成静默丢弃即红）',
    eq(nw.unknown, ['str_replace_editor']), JSON.stringify(nw.unknown))
  const ro = mod.expandToolPreset('read-only', known)
  check('A6.8 read-only 展开后 deny 含 write/edit/pwsh 且 unknown 含 str_replace_editor、bash',
    eq(ro.deny.sort(), ['edit', 'pwsh', 'write']) && eq(ro.unknown.sort(), ['bash', 'str_replace_editor']), JSON.stringify(ro))
  const all = mod.expandToolPreset('no-shell', undefined)
  check('A6.9 known 缺失（tools 服务不可用）-> 全量透传由运行时校验，unknown 必须为空（不得假装知道）',
    eq(all.deny, ['pwsh', 'bash']) && eq(all.unknown, []), JSON.stringify(all))
  check('A6.10 known 为空 Set（本部署一个工具都不可见）-> deny 空、unknown 全量',
    (() => { const r = mod.expandToolPreset('no-write', new Set()); return eq(r.deny, []) && eq(r.unknown, ['write', 'edit', 'str_replace_editor']) })(),
    JSON.stringify(mod.expandToolPreset('no-write', new Set())))
  check('A6.11 未知预设名 -> {deny:[], unknown:[]}，展开函数自己不抛异常（由调用方记 note）',
    eq(mod.expandToolPreset('nope', known), { deny: [], unknown: [] }) && eq(mod.expandToolPreset(undefined, known), { deny: [], unknown: [] }),
    JSON.stringify(mod.expandToolPreset('nope', known)))
  check('A6.12 deny 内不重复（重复名会被运行时当成两次声明，无意义且难排障）',
    mod.TOOL_PRESETS['read-only'].length === new Set(mod.TOOL_PRESETS['read-only']).size, JSON.stringify(P['read-only']))
}

// ===========================================================================
console.log('\n--- GROUP B: schema 兼容性（safeParse + 真实写路径） ---')
// ---------------------------------------------------------------------------
// B1. agentDefSchema: THE trap this round exists to fix -- an empty / missing
//     `model` must NOT be silently filled with deepseek/deepseek-chat. Fails if
//     a default comes back, or if any new field tightens the schema.
// ---------------------------------------------------------------------------
console.log('\n[B1] agentDefSchema（去默认值陷阱）')
{
  const noModel = mod.agentDefSchema.safeParse({ id: 'a1', name: 'A', updatedAt: 1 })
  check('B1.1 完全不带 model 的角色定义通过校验（收紧模型字段会让旧记录在域打开时炸掉）',
    noModel.success, JSON.stringify(noModel.success ? noModel.data.model : noModel.error.issues[0]))
  check('B1.2 [本轮核心靶点] 不带 model 时解析结果绝不被填成 deepseek / deepseek-chat（默认值回归即红）',
    noModel.success && JSON.stringify(noModel.data.model || {}).indexOf('deepseek') === -1,
    JSON.stringify(noModel.success ? noModel.data.model : null))
  const emptyModel = mod.agentDefSchema.safeParse({ id: 'a1', name: 'A', model: {}, updatedAt: 1 })
  check('B1.3 model:{} 解析后仍然是"没有 provider/model"（这是"没声明模型"能被表达出来的前提）',
    emptyModel.success && emptyModel.data.model.provider === undefined && emptyModel.data.model.model === undefined,
    JSON.stringify(emptyModel.success ? emptyModel.data.model : null))
  const halfModel = mod.agentDefSchema.safeParse({ id: 'a1', model: { provider: 'p' }, updatedAt: 1 })
  check('B1.4 半对 model{provider} 通过校验且不补出 model 字段（成对规则在派发侧处理，schema 不许编造）',
    halfModel.success && halfModel.data.model.provider === 'p' && halfModel.data.model.model === undefined,
    JSON.stringify(halfModel.success ? halfModel.data.model : null))
  const full = mod.agentDefSchema.safeParse({
    id: 'a2', name: 'A2', role: 'r', systemPrompt: 'sp',
    model: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 4096 },
    skills: ['pwsh'], tools: { preset: 'no-write', allow: [], deny: ['bash'] }, permissionPolicy: 'never', timeoutMs: 60000, updatedAt: 1,
  })
  check('B1.5 带 provider/model/reasoningEffort/maxTokens/timeoutMs/tools.preset 的记录通过校验（新字段必须是可选的加法）',
    full.success, full.success ? 'ok' : JSON.stringify(full.error.issues[0]))
  check('B1.6 新字段原样保留（reasoningEffort/maxTokens/timeoutMs/preset 不得在校验中被丢掉）',
    full.success && full.data.model.reasoningEffort === 'high' && full.data.model.maxTokens === 4096 && full.data.timeoutMs === 60000 && full.data.tools.preset === 'no-write',
    JSON.stringify(full.success ? full.data : null))
  const old = mod.agentDefSchema.safeParse({ id: 'old', name: '旧角色', role: 'r', systemPrompt: 'sp', model: { provider: 'deepseek-official', model: 'deepseek-flash' }, skills: [], tools: {}, updatedAt: 100 })
  check('B1.7 旧记录（无新字段、显式 provider/model）仍然通过校验（向后兼容的硬要求）', old.success, old.success ? 'ok' : JSON.stringify(old.error.issues[0]))
  check('B1.8 非法 maxTokens（0 / 1.5）仍被拒绝：这是一条既有约束，本轮不得放宽',
    !mod.agentDefSchema.safeParse({ id: 'a', model: { maxTokens: 0 }, updatedAt: 1 }).success &&
    !mod.agentDefSchema.safeParse({ id: 'a', model: { maxTokens: 1.5 }, updatedAt: 1 }).success)
  check('B1.9 非法 tools.preset 被拒绝（未知预设不得静默落库）',
    !mod.agentDefSchema.safeParse({ id: 'a', tools: { preset: 'no-everything' }, updatedAt: 1 }).success)
  check('B1.10 modelSchema 与 modelRouteSchema 是同一份形状（别名漂移即红）',
    mod.modelRouteSchema === mod.modelSchema, String(mod.modelRouteSchema === mod.modelSchema))
}

// ---------------------------------------------------------------------------
// B2. workflowSchema / workflowNodeSchema: route + prompt + promptAddon are
//     additive; old records keep validating.
// ---------------------------------------------------------------------------
console.log('\n[B2] workflowSchema / workflowNodeSchema')
{
  const wfNew = mod.workflowSchema.safeParse({
    id: 'w1', name: 'W',
    route: { provider: 'p', model: 'm', reasoningEffort: 'low', maxTokens: 1024 },
    prompt: 'FLOW-PERSONA',
    nodes: { n1: { id: 'n1', title: 'T', agent: 'Coder', dependsOn: [], route: { provider: 'p2', model: 'm2' }, promptAddon: 'NODE-ADDON', timeoutMs: 5000 } },
    updatedAt: 1,
  })
  check('B2.1 工作流级 route/prompt 与节点级 route/promptAddon/timeoutMs 通过校验',
    wfNew.success, wfNew.success ? 'ok' : JSON.stringify(wfNew.error.issues[0]))
  check('B2.2 节点级 route/promptAddon/timeoutMs 在解析结果里原样保留（加字段但被丢掉等于没加）',
    wfNew.success && wfNew.data.nodes.n1.route.provider === 'p2' && wfNew.data.nodes.n1.promptAddon === 'NODE-ADDON' && wfNew.data.nodes.n1.timeoutMs === 5000,
    JSON.stringify(wfNew.success ? wfNew.data.nodes.n1 : null))
  const wfOld = mod.workflowSchema.safeParse({ id: 'w0', name: '旧流程', nodes: { n1: { id: 'n1', title: 'T', agent: 'Coder', dependsOn: [] } }, updatedAt: 1 })
  check('B2.3 旧工作流记录（无 route/prompt/promptAddon）仍然通过校验',
    wfOld.success, wfOld.success ? 'ok' : JSON.stringify(wfOld.error.issues[0]))
  check('B2.3b 旧记录解析后不得凭空多出 route/prompt 键（凭空多键会让"是否声明"的判定失去意义）',
    wfOld.success && wfOld.data.route === undefined && wfOld.data.prompt === undefined && wfOld.data.nodes.n1.route === undefined,
    JSON.stringify(wfOld.success ? Object.keys(wfOld.data) : null))
  check('B2.4 节点 route 必须是可选：缺 route 的节点不得因此校验失败（收紧会让每条工作流在域打开时炸）',
    mod.workflowNodeSchema.safeParse({ id: 'n', dependsOn: [] }).success)
  check('B2.4b 节点 route 内的非法 maxTokens 被拒绝（新字段沿用既有约束，而不是自己放宽一套）',
    !mod.workflowNodeSchema.safeParse({ id: 'n', dependsOn: [], route: { maxTokens: -1 } }).success)
  check('B2.5 workflowSchema 的 review 字段未被本轮改动（review.maxRework 上界仍是 2）',
    mod.workflowSchema.safeParse({ id: 'w', nodes: {}, review: { reviewer: 'R', maxRework: 2, enabled: true }, updatedAt: 1 }).success &&
    !mod.workflowSchema.safeParse({ id: 'w', nodes: {}, review: { maxRework: 3 }, updatedAt: 1 }).success)
  check('B2.6 四个存储域常量仍导出且各有一张表（域契约不变）',
    mod.agentDefsDomain && mod.workflowsDomain && mod.taskLedgerDomain && mod.runsDomain &&
    mod.agentDefsDomain.tables.defs !== undefined && mod.workflowsDomain.tables.flows !== undefined)
}

// ===========================================================================
console.log('\n--- GROUP B/C: 真实宿主半挂在桩 ctx 上 ---')
// ---------------------------------------------------------------------------
// The stub ctx: in-memory storage DOMAINS that VALIDATE on open/put exactly like
// the real file backend (this is what makes "an old record still opens" a real
// check and not a claim), a recording `subagents` whose spawned run exposes a
// configurable child request header, a recording `tools`, a configurable `llm`,
// and a capturing `webServer`.
// ---------------------------------------------------------------------------
const TEST_TABLES = {
  team_agent_defs: { defs: mod.agentDefSchema },
  team_ledger: { tasks: { safeParse: () => ({ success: true }) } },
  team_workflows: { flows: mod.workflowSchema },
  team_runs: { runs: { safeParse: () => ({ success: true }) } },
}
function makeStorageStub() {
  const stores = new Map()
  const journal = []
  const openChecks = []
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
    // no longer matches the schema must make `open` REJECT. This is why "add an
    // optional field only" is a hard constraint, and it is asserted here.
    for (const tname of Object.keys(spec.tables || {})) {
      const t = table(tname)
      for (const [k, v] of t.entries()) {
        const schema = TEST_TABLES[dname] && TEST_TABLES[dname][tname]
        const r = schema ? schema.safeParse(v) : { success: true }
        openChecks.push({ domain: dname, table: tname, key: k, ok: r.success !== false, detail: r.success ? null : JSON.stringify(r.error && r.error.issues && r.error.issues[0]) })
        if (r.success === false) throw new Error('stub storage: domain ' + dname + ' record ' + k + ' fails validation: ' + JSON.stringify(r.error.issues[0]))
      }
    }
    return { name: dname, table, close: async () => {} }
  }
  return { open, stores, journal, openChecks, store }
}

// The child agent's own request header, the ONLY authoritative source for
// "what did it really run on". `answerFor(call)` decides it per dispatch:
//   { config }  -> measured:true      (a real read)
//   undefined   -> measured:false     (no header yet / never issued a request)
//   { throws }  -> measured:false     (a read that failed must not be invented)
const box = { child: null }
function makeSubagentsStub(calls, plan) {
  return {
    calls,
    async start(kind, spec) {
      const nodeId = String((spec && spec.label) || '')
      const prompt = spec && Array.isArray(spec.prompt) && spec.prompt[0] && typeof spec.prompt[0].text === 'string' ? spec.prompt[0].text : ''
      const call = {
        kind, nodeId, label: nodeId, prompt,
        role: /:review$/.test(nodeId) ? 'reviewer' : 'worker',
        round: (() => { const m = /round=(\d+)/.exec(prompt); return m ? Number(m[1]) : null })(),
        index: calls.length,
        agentOptions: spec && spec.agentOptions !== undefined ? JSON.parse(JSON.stringify(spec.agentOptions)) : null,
        persona: spec && spec.persona !== undefined ? spec.persona : null,
        hasPersonaKey: !!(spec && 'persona' in spec),
        toolFilter: spec && spec.toolFilter !== undefined ? JSON.parse(JSON.stringify(spec.toolFilter)) : null,
        hasAgentOptions: !!(spec && 'agentOptions' in spec && spec.agentOptions !== undefined),
        hasSignal: !!(spec && spec.signal && typeof spec.signal.addEventListener === 'function'),
      }
      calls.push(call)
      const r = (plan ? plan(call) : null) || {}
      if (r.startError) throw new Error(r.startError)
      const answerFor = r.answerFor || (() => undefined)
      const result = (async () => {
        if (r.resultError) throw new Error(r.resultError)
        const output = []
        if (r.text !== undefined && r.text !== null && r.text !== '') output.push({ type: 'text', text: String(r.text) })
        if (r.reasoning) output.push({ type: 'reasoning', text: String(r.reasoning) })
        return { output, stopReason: r.stopReason || 'completed', diagnostic: r.diagnostic }
      })()
      // The child's own request header, read through a SHARED BOX rather than a
      // fixed object graph. `box.child` is filled in at dispatch time and every
      // accessor below returns it live, so whichever path the plugin takes to
      // reach "the child agent" (`started.run.localAgent`, `started.stubChild`,
      // ...) it lands on the same live object. That is what makes `measured` a
      // real observation of the plugin's read and not of this stub's shape: if
      // the plugin did not read it, `measured` stays false (checked by C6.1).
      box.child = {
        session: {
          requestHeader: () => {
            const a = answerFor(call)
            if (a && a.throws) throw new Error('stub: requestHeader exploded')
            if (a === undefined || a === null) return undefined
            return a.config === undefined ? a : { config: a.config }
          },
        },
      }
      const started = { result, note: 'stub:' + call.role }
      // Lazy accessors, so the child is reachable no matter which property the
      // plugin walks through to get at "the child agent". Only `result` and
      // `note` are fixed; every "child-shaped" name resolves to the live object.
      for (const key of ['run', 'localAgent', 'stubChild', 'child']) {
        Object.defineProperty(started, key, { get: () => box.child, enumerable: true, configurable: true })
      }
      return started
    },
  }
}
const parentWithConfig = (config) => ({
  session: {
    requestHeader: () => {
      if (config === 'THROW') throw new Error('stub: parent requestHeader exploded')
      return config === undefined ? undefined : { config }
    },
  },
})

function makeToolsStub(names, opts) {
  const state = { names: names === undefined ? null : names.slice(), throwSchemas: !!(opts && opts.throwSchemas) }
  return {
    state,
    schemas() { if (state.throwSchemas) throw new Error('stub: schemas exploded'); return state.names === null ? undefined : state.names.map((n) => ({ name: n })) },
    register() { return () => {} },
    guard() { return () => {} },
  }
}

const storage = makeStorageStub()
const captured = {}
const webRoutes = new Map()
const ctxDisposers = []
let subagentsStub = null
const agentsSvcStub = { currentInitiator: () => undefined, roots: () => [] }
const webServerStub = { register(def) { webRoutes.set(def.path, def.handler); return () => webRoutes.delete(def.path) } }
let toolsStub = makeToolsStub(['read', 'write', 'edit', 'pwsh', 'web_fetch'])
let llmStub = null

// The catalogue every scenario uses unless it overrides it: ONE healthy provider
// (`p1`) plus enough models to exercise the effort rules.
const CATALOG = {
  p1: [
    { id: 'm1', name: 'M1', description: 'model one' },
    { id: 'm2', name: 'M2', description: null },
    { id: 'm3', name: 'M3', description: null },
  ],
  p2: [{ id: 'x1', name: 'X1', description: null }],
}
const EFFORTS = {
  p1: { m1: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high', contextWindow: 131072, defaultMaxTokens: 8192 },
        m2: { efforts: [], defaultEffort: null, contextWindow: 65536, defaultMaxTokens: 2048 },
        m3: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low', contextWindow: 8192, defaultMaxTokens: 1024 } },
  p2: { x1: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low', contextWindow: 4096, defaultMaxTokens: 512 } },
}
function makeLlmStub() {
  return {
    listProviders: () => Object.keys(CATALOG).map((id) => ({ id, name: 'Provider ' + id })),
    listModels: async (id) => (CATALOG[id] || []).map((m) => ({ provider: id, id: m.id, name: m.name, description: m.description })),
    resolveModelInfo: async (provider, model) => {
      const r = EFFORTS[provider] && EFFORTS[provider][model]
      if (!r) throw new Error('unknown model ' + provider + '/' + model)
      return { provider, id: model, name: model, context: { contextWindow: r.contextWindow }, defaultMaxTokens: r.defaultMaxTokens, reasoning: { efforts: r.efforts, defaultEffort: r.defaultEffort } }
    },
  }
}
llmStub = makeLlmStub()

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
    if (n === 'llm') return llmStub
    return undefined
  },
  provide(n, svc) { captured[n] = svc },
  effect(fn) { const d = fn(); if (typeof d === 'function') ctxDisposers.push(d); return () => {} },
  on() { return () => {} },
  logger: { warn() {}, error() {}, info() {} },
}
// The plugin warns about optional capabilities this stub does not provide.
// Silenced only around apply() so the suite's own output stays greppable.
const realWarn = console.warn
console.warn = () => {}
try { mod.apply(ctx) } finally { console.warn = realWarn }

const svc = captured.teamOrchestrator
check('BC.0 apply(ctx) 真的 provide 了 teamOrchestrator 且 upsertWorkflow/upsertAgent 可调用（否则整组 C 无意义）',
  svc !== undefined && typeof svc.upsertWorkflow === 'function' && typeof svc.upsertAgent === 'function', typeof svc)
check('BC.0b 宿主注册了 /progress、/role 与新的 /models 读接口（D 组要经真实 handler 取数）',
  webRoutes.has('/api/team-flowise/progress') && webRoutes.has('/api/team-flowise/role') && webRoutes.has('/api/team-flowise/models'),
  [...webRoutes.keys()].join(','))

const tableMap = (domain, table) => { const d = storage.stores.get(domain); return d === undefined ? undefined : d.get(table) }
const rec = (domain, table, key) => { const m = tableMap(domain, table); return m === undefined ? undefined : m.get(key) }
const allTasks = () => { const m = tableMap('team_ledger', 'tasks'); return m === undefined ? [] : [...m.values()] }
function rawPut(domain, table, key, value) {
  const d = storage.store(domain)
  if (!d.has(table)) d.set(table, new Map())
  d.get(table).set(key, value)
  return value
}
async function callRoute(path, qs) {
  const handler = webRoutes.get(path)
  if (handler === undefined) throw new Error('no route ' + path)
  let status = 0
  let body = null
  const headers = {}
  const res = { writableEnded: false, writeHead(s, h) { status = s; if (h) Object.assign(headers, h) }, end(t) { this.writableEnded = true; body = t } }
  const req = { url: path + (qs ? '?' + qs : ''), method: 'GET', socket: { remoteAddress: '127.0.0.1' } }
  await handler(req, res)
  let json = null
  try { json = body === null ? null : JSON.parse(body) } catch { /* non-JSON */ }
  return { status, json, raw: body, headers }
}

let seq = 0
/**
 * Run one scenario end to end through the real scheduler.
 *  nodes      -- the workflow's node map
 *  wfExtra    -- extra workflow fields (route / prompt / review)
 *  plan       -- (call) => { text, answerFor, startError, ... }
 *  opts       -- { runOpts, parentConfig, raw }
 */
async function scenario(name, nodes, wfExtra, plan, opts) {
  const calls = []
  subagentsStub = makeSubagentsStub(calls, plan)
  const o = opts || {}
  agentsSvcStub.currentInitiator = () => (o.parentConfig === 'NONE' ? undefined : parentWithConfig(o.parentConfig))
  agentsSvcStub.roots = () => (o.parentConfig === 'NONE' ? [] : [parentWithConfig(o.parentConfig)])
  const wfId = 'wf-p11c-' + String(++seq) + '-' + name
  if (o.raw) rawPut('team_workflows', 'flows', wfId, Object.assign({ id: wfId, name: wfId, nodes, updatedAt: Date.now() }, wfExtra || {}))
  else await svc.upsertWorkflow(Object.assign({ id: wfId, name: wfId, nodes }, wfExtra || {}))
  const mark = storage.journal.length
  const out = await withLimit(svc.runWorkflow(wfId, {}, undefined, o.runOpts), 20000, 'scenario ' + name)
  const run = rec('team_runs', 'runs', out.id)
  const writes = storage.journal.slice(mark).filter((w) => w.domain === 'team_runs' && w.key === out.id)
  return {
    name, wfId, runId: out.id, status: out.status, run, writes, calls,
    workers: calls.filter((c) => c.role === 'worker'),
    reviewers: calls.filter((c) => c.role === 'reviewer'),
    tasks: allTasks().filter((t) => t && t.workflowId === wfId),
  }
}
function statusSeq(writes, nid) {
  const raw = []
  for (const w of writes) {
    const ns = w.value && w.value.nodeStates
    if (ns && ns[nid] && typeof ns[nid].status === 'string') raw.push(ns[nid].status)
  }
  return raw.filter((s, i) => i === 0 || s !== raw[i - 1])
}
const node = (id, extra) => Object.assign({ id, title: 'T-' + id, agent: 'Coder', dependsOn: [], taskTemplate: { requirement: 'R-' + id, acceptanceCriteria: 'A-' + id } }, extra || {})
/** Seed one role definition through the REAL write path. */
async function seedAgent(id, extra) {
  return svc.upsertAgent(Object.assign({ id, name: id, role: 'r-' + id, model: {}, updatedAt: Date.now() }, extra || {}))
}
/** The last node state a run recorded for `nid`. */
function nodeState(s, nid) { return (s.run && s.run.nodeStates && s.run.nodeStates[nid]) || {} }
/** The stored record as the domain holds it (what the next process would read). */
const storedAgent = (id) => rec('team_agent_defs', 'defs', id)
const storedFlow = (id) => rec('team_workflows', 'flows', id)

// ===========================================================================
console.log('\n--- GROUP C: 调度器端到端（桩 ctx + 桩 subagents） ---')
// ---------------------------------------------------------------------------
// C1. A role that declares a route: `agentOptions` is EXACTLY the declared set.
//     Fails if a key is invented (e.g. a maxTokens nobody declared), if a
//     declared key is dropped, or if the values are not the declared ones.
// ---------------------------------------------------------------------------
console.log('\n[C1] 角色声明 route -> agentOptions 恰好是声明的那一组')
try {
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 } })
  const s = await scenario('role-route-full', { n1: node('n1') }, null, () => ({ text: 'W1' }))
  const w = s.workers[0]
  check('C1.1 worker 的 agentOptions 恰好 4 键 {provider,model,reasoningEffort,maxTokens}，多一个少一个都判负',
    w !== undefined && eq(w.agentOptions, { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 }), JSON.stringify(w && w.agentOptions))
  check('C1.2 派发确实收到了 AbortSignal（P11 没有破坏既有的可中断派发）', w !== undefined && w.hasSignal === true)
  check('C1.3 节点 completed 且 route.source="role"、verified=true、measured 与桩一致',
    nodeState(s, 'n1').status === 'completed' && nodeState(s, 'n1').route.source === 'role' && nodeState(s, 'n1').route.verified === true,
    JSON.stringify(nodeState(s, 'n1').route))
  check('C1.4 route.requested 记录的是角色层声明的原文（未校验、未过滤）',
    eq(nodeState(s, 'n1').route.requested, { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 }),
    JSON.stringify(nodeState(s, 'n1').route.requested))
} catch (e) { blockFailure('C1 角色全字段', e) }

// ---------------------------------------------------------------------------
// C2. Provider not registered => NO agentOptions at all (fall back to
//     inheritance), a non-empty warning, and a COMPLETED node. Fails if the
//     unusable route is still handed to the runtime (the child would die with
//     NO_ADAPTER) or if the node/run is reported failed.
// ---------------------------------------------------------------------------
console.log('\n[C2] provider 未注册 -> 不设置 agentOptions + warning + 节点仍 completed')
try {
  await seedAgent('Coder', { model: { provider: 'nope', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 } })
  const s = await scenario('role-provider-missing', { n1: node('n1') }, null, () => ({ text: 'W2' }))
  const w = s.workers[0]
  const st = nodeState(s, 'n1')
  check('C2.1 桩 subagents 收到 spec 里没有 agentOptions（回退继承父级 route；带上去会让第一次请求以 NO_ADAPTER 死掉）',
    w !== undefined && w.agentOptions === null && w.hasAgentOptions === false, JSON.stringify(w && w.agentOptions))
  check('C2.2 route.warning 非空且点名未注册的 provider "nope" 与"回退继承"',
    typeof st.route.warning === 'string' && st.route.warning.length > 0 && st.route.warning.indexOf('nope') !== -1 && st.route.warning.indexOf('回退继承') !== -1,
    String(st.route && st.route.warning))
  check('C2.3 降级不失败：节点 completed（"一律不让节点失败"是硬要求）', st.status === 'completed', String(st.status))
  check('C2.4 降级不失败：运行整体 completed', s.status === 'completed' && s.run.status === 'completed', String(s.run.status))
  check('C2.5 route.verified === false（未经校验/校验失败必须如实标注）', st.route.verified === false, String(st.route.verified))
  check('C2.6 route.effective 记录的是父级 route（本场景父级未知 -> 全 null），绝不是那个跑不通的 nope/m1',
    st.route.effective.provider !== 'nope' && st.route.effective.provider === null, JSON.stringify(st.route.effective))
} catch (e) { blockFailure('C2 provider 未注册', e) }

// ---------------------------------------------------------------------------
// C3. The declared effort is not in the model's efforts list. Two things must
//     hold: the node still completes with a warning that lists the legal
//     efforts, and NOTHING unusable reaches the runtime.
// ---------------------------------------------------------------------------
console.log('\n[C3] effort 不在模型 efforts 列表里')
try {
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1', reasoningEffort: 'ultra' } })
  const s = await scenario('role-effort-illegal', { n1: node('n1') }, null, () => ({ text: 'W3' }))
  const st = nodeState(s, 'n1')
  check('C3.1 节点 completed、运行 completed（非法 effort 绝不能让节点失败）',
    st.status === 'completed' && s.status === 'completed' && s.run.status === 'completed',
    JSON.stringify({ node: st.status, run: s.run.status }))
  check('C3.2 route.warning 说明该模型不接受 "ultra" 并列出可选 effort（low/high）',
    typeof st.route.warning === 'string' && st.route.warning.indexOf('ultra') !== -1 && st.route.warning.indexOf('low') !== -1 && st.route.warning.indexOf('high') !== -1,
    String(st.route && st.route.warning))
  check('C3.3 route.efforts 记录该模型的合法 effort id 列表（UI 才能改成一个能用的值）',
    eq(st.route.efforts, ['low', 'high']) && st.route.defaultEffort === 'high', JSON.stringify({ efforts: st.route.efforts, default: st.route.defaultEffort }))
  check('C3.4 非法 effort 绝不被送回运行时（核弹级：把不支持的强度发给适配器同样会打挂请求）',
    s.workers[0] === undefined || s.workers[0].agentOptions === null || s.workers[0].agentOptions.reasoningEffort !== 'ultra',
    JSON.stringify(s.workers[0] && s.workers[0].agentOptions))
} catch (e) { blockFailure('C3 effort 非法', e) }

// ---------------------------------------------------------------------------
// C4. Half a pair (provider without model) => neither half may be applied, and
//     the warning must name the pair rule. Fails if the surviving half is kept
//     (the runtime would merge it with the parent's other half).
// ---------------------------------------------------------------------------
console.log('\n[C4] 只声明 provider 不给 model')
try {
  await seedAgent('Coder', { model: { provider: 'p1', reasoningEffort: 'low', maxTokens: 2048 } })
  const s = await scenario('role-half-pair', { n1: node('n1') }, null, () => ({ text: 'W4' }))
  const w = s.workers[0]
  const st = nodeState(s, 'n1')
  check('C4.1 provider 不进 agentOptions，model 也不许被编造出来（成对作废，不是"只忽略缺的那个"）',
    w !== undefined && (w.agentOptions === null || (w.agentOptions.provider === undefined && w.agentOptions.model === undefined)),
    JSON.stringify(w && w.agentOptions))
  check('C4.2 route.warning 明确说明成对规则（关键词"成对"）且点名被忽略的 provider p1',
    typeof st.route.warning === 'string' && st.route.warning.indexOf('成对') !== -1 && st.route.warning.indexOf('p1') !== -1,
    String(st.route && st.route.warning))
  check('C4.3 同层的 reasoningEffort/maxTokens 仍单独生效（它们不选适配器，不受成对规则约束）',
    w !== undefined && w.agentOptions !== null && w.agentOptions.reasoningEffort === 'low' && w.agentOptions.maxTokens === 2048,
    JSON.stringify(w && w.agentOptions))
  check('C4.4 节点 completed、运行 completed', st.status === 'completed' && s.run.status === 'completed', String(s.run.status))
  check('C4.5 route.effective 里的 provider/model 不得出现 p1（半对已被作废）', st.route.effective.provider !== 'p1', JSON.stringify(st.route.effective))
} catch (e) { blockFailure('C4 半对声明', e) }

// ---------------------------------------------------------------------------
// C5. Only maxTokens declared: it must reach the runtime on its own, with no
//     provider/model keys beside it. Fails if a lone maxTokens is treated as
//     "no route at all" (silently losing the cap) or if a provider is invented.
// ---------------------------------------------------------------------------
console.log('\n[C5] 只声明 maxTokens')
try {
  await seedAgent('Coder', { model: { maxTokens: 2048 } })
  const s = await scenario('role-max-only', { n1: node('n1') }, null, () => ({ text: 'W5' }))
  const w = s.workers[0]
  check('C5.1 agentOptions 恰好 {maxTokens:2048}：不带 provider/model（带上就是拼装路由）',
    w !== undefined && eq(w.agentOptions, { maxTokens: 2048 }), JSON.stringify(w && w.agentOptions))
  check('C5.2 route.source === "role"（只有一个 maxTokens 也算角色层的一次声明）',
    nodeState(s, 'n1').route.source === 'role', String(nodeState(s, 'n1').route.source))
  check('C5.3 route.timeoutMs 记录本次实际使用的超时（正值）',
    typeof nodeState(s, 'n1').route.timeoutMs === 'number' && nodeState(s, 'n1').route.timeoutMs > 0, String(nodeState(s, 'n1').route.timeoutMs))
} catch (e) { blockFailure('C5 只声明 maxTokens', e) }

// ---------------------------------------------------------------------------
// C6. measured: the honest bit. Fails if a missing header is reported as a real
//     measurement (M3 target), or if a real header is not used as `effective`.
// ---------------------------------------------------------------------------
console.log('\n[C6] measured / effective 的诚实性')
try {
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 } })
  const CONFIG = { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 }
  const sYes = await scenario('measured-yes', { n1: node('n1') }, null, (c) => (c.role === 'worker' ? { text: 'W6', answerFor: () => ({ config: CONFIG }) } : { text: 'W6' }))
  const stYes = nodeState(sYes, 'n1')
  check('C6.1 桩给 config -> route.measured === true（读到了真实请求头才允许为 true）', stYes.route.measured === true, String(stYes.route.measured) + (process.env.P11_DEBUG ? ' DBG ao=' + JSON.stringify(sYes.workers[0] && sYes.workers[0].agentOptions) + ' calls=' + String(sYes.calls.length) : ''))
  check('C6.2 measured:true 时 effective 逐字段等于该 config（实测值是唯一权威来源）',
    eq(stYes.route.effective, CONFIG), JSON.stringify(stYes.route.effective))
      check('C6.3 实测值与请求值不同时，effective 必须取实测值（不许回显请求值冒充实测）',
        (await scenario('measured-differs', { n1: node('n1') }, null,
          (c) => (c.role === 'worker' ? { text: 'W6b', answerFor: () => ({ config: { provider: 'p2', model: 'x1', reasoningEffort: 'low', maxTokens: 512 } }) } : { text: 'W6b' })))
          .run.nodeStates.n1.route.effective.provider === 'p2',
        process.env.P11_DEBUG ? 'DBG probe' : '')
  const sNo = await scenario('measured-no', { n1: node('n1') }, null, () => ({ text: 'W6c', answerFor: () => undefined }))
  const stNo = nodeState(sNo, 'n1')
  check('C6.4 桩不给 config -> route.measured === false（M3 靶点：恒置 true 即红）', stNo.route.measured === false, String(stNo.route.measured))
  check('C6.5 measured:false 时 effective 仍是请求值（provider/model/effort/maxTokens 与声明一致），不得留空、不得伪造',
    stNo.route.effective.provider === 'p1' && stNo.route.effective.model === 'm1' && stNo.route.effective.reasoningEffort === 'high' && stNo.route.effective.maxTokens === 4096,
    JSON.stringify(stNo.route.effective))
  const sThrow = await scenario('measured-throws', { n1: node('n1') }, null, () => ({ text: 'W6d', answerFor: () => ({ throws: true }) }))
  check('C6.6 requestHeader 抛错 -> measured:false 且节点仍 completed（读取实测值绝不影响派发）',
    nodeState(sThrow, 'n1').route.measured === false && nodeState(sThrow, 'n1').status === 'completed',
    JSON.stringify({ measured: nodeState(sThrow, 'n1').route.measured, status: nodeState(sThrow, 'n1').status }))
} catch (e) { blockFailure('C6 measured', e) }

// ---------------------------------------------------------------------------
// C7. Persona layering through the real dispatch: all three layers reach the
//     child in order; with no layer at all, the `persona` key is absent from the
//     spec (byte-for-byte the pre-P11 dispatch).
// ---------------------------------------------------------------------------
console.log('\n[C7] 人物段分层（role -> workflow -> node）')
try {
  await seedAgent('Coder', { systemPrompt: 'ROLE-PERSONA', model: { provider: 'p1', model: 'm1' } })
  const s = await scenario('persona-three', { n1: node('n1', { promptAddon: 'NODE-ADDON' }) }, { prompt: 'WF-PERSONA' }, () => ({ text: 'W7' }))
  const w = s.workers[0]
  check('C7.1 三层文本按 role -> workflow -> node 顺序、以空行连接后进入 spec.persona',
    w !== undefined && w.persona === 'ROLE-PERSONA\n\nWF-PERSONA\n\nNODE-ADDON', JSON.stringify(w && w.persona))
  check('C7.2 顺序真的可分辨：role 出现在 workflow 之前、workflow 出现在 node 之前',
    w.persona.indexOf('ROLE-PERSONA') < w.persona.indexOf('WF-PERSONA') && w.persona.indexOf('WF-PERSONA') < w.persona.indexOf('NODE-ADDON'))
  check('C7.3 节点 persona 记账只存形状：chars 与 layers，不含全文（/progress 是 3 秒轮询的轻载荷）',
    nodeState(s, 'n1').persona.chars === w.persona.length && eq(nodeState(s, 'n1').persona.layers, ['role', 'workflow', 'node']) &&
    JSON.stringify(nodeState(s, 'n1').persona).indexOf('ROLE-PERSONA') === -1,
    JSON.stringify(nodeState(s, 'n1').persona))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' } })
  const sNone = await scenario('persona-none', { n1: node('n1') }, null, () => ({ text: 'W7b' }))
  check('C7.4 三层皆空时 spec 里根本没有 persona 键（与改动前逐字节一致）',
    sNone.workers[0] !== undefined && sNone.workers[0].hasPersonaKey === false, JSON.stringify(sNone.workers[0] && sNone.workers[0].hasPersonaKey))
  check('C7.5 三层皆空时节点上没有 persona 记录（null，而不是一个空对象）',
    nodeState(sNone, 'n1').persona === undefined || nodeState(sNone, 'n1').persona === null, JSON.stringify(nodeState(sNone, 'n1').persona))
  await seedAgent('Coder', { systemPrompt: 'BAD {{unknown_var}} TEXT', model: { provider: 'p1', model: 'm1' } })
  const sBad = await scenario('persona-braces', { n1: node('n1') }, null, () => ({ text: 'W7c' }))
  check('C7.6 含 {{...}} 的 persona 被中和而不是整段丢弃：人设仍然送出，只是 {{ 变成 { {（严格插值会 throw 并杀掉子代理）',
    sBad.workers[0].hasPersonaKey === true && typeof sBad.workers[0].persona === 'string' &&
    sBad.workers[0].persona.indexOf('{{') === -1 && sBad.workers[0].persona.indexOf('BAD') !== -1 && sBad.workers[0].persona.indexOf('unknown_var') !== -1,
    JSON.stringify(sBad.workers[0] && sBad.workers[0].persona))
  check('C7.7 改写被记录在 persona.warning 里且节点仍 completed（不许静默改写，也不许因此失败）',
    nodeState(sBad, 'n1').status === 'completed' &&
    nodeState(sBad, 'n1').persona !== null && nodeState(sBad, 'n1').persona !== undefined &&
    typeof nodeState(sBad, 'n1').persona.warning === 'string' && nodeState(sBad, 'n1').persona.warning.indexOf('替换') !== -1,
    JSON.stringify(nodeState(sBad, 'n1').persona))
  check('C7.7b [O3 已闭环] persona 记录对应的就是真正送出的人设：chars/layers 如实，且送出的文本里不含 {{',
    nodeState(sBad, 'n1').persona.chars > 0 && eq(nodeState(sBad, 'n1').persona.layers, ['role']) &&
    sBad.workers[0].persona.indexOf('{{') === -1,
    JSON.stringify(nodeState(sBad, 'n1').persona))
  const sRev = await scenario('persona-reviewer', { n1: node('n1', { reviewer: 'Reviewer', promptAddon: 'WORKER-ONLY-ADDON' }) }, { prompt: 'WF-P' },
    (c) => (c.role === 'reviewer'
      ? { text: '```json\n{"verdict":"pass","score":80,"findings":[]}\n```' }
      : { text: 'W7d' }))
  const rp = sRev.reviewers[0]
  check('C7.8 评审者只用 role+workflow 两层：带上了工作流人设，但绝不含被审节点的 promptAddon（被审者的说明不是审判者的说明）',
    rp !== undefined && typeof rp.persona === 'string' && rp.persona.indexOf('WF-P') !== -1 && rp.persona.indexOf('WORKER-ONLY-ADDON') === -1,
    JSON.stringify(rp && rp.persona))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' } })
} catch (e) { blockFailure('C7 persona 分层', e) }

// ---------------------------------------------------------------------------
// C8. Run-level override: wins over every other layer and is attributed
//     `source:'run'`. Fails if opts are ignored, or if the run layer is reported
//     by a dispatch that never passed one.
// ---------------------------------------------------------------------------
console.log('\n[C8] 运行级覆盖与向后兼容')
try {
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1', reasoningEffort: 'low' } })
  const sRun = await scenario('run-override', { n1: node('n1', { route: { provider: 'p2', model: 'x1' } }) },
    { route: { provider: 'p1', model: 'm1' } }, () => ({ text: 'W8' }), { runOpts: { route: { provider: 'p1', model: 'm1' } } })
  const stRun = nodeState(sRun, 'n1')
  check('C8.1 run 层生效：agentOptions 是 run 声明的 provider/model（node 层被完整压制）',
    eq(sRun.workers[0].agentOptions, { provider: 'p1', model: 'm1' }), JSON.stringify(sRun.workers[0] && sRun.workers[0].agentOptions))
  check('C8.2 route.source === "run"', stRun.route.source === 'run', String(stRun.route.source))
  check('C8.3 route.requested 记录 run 层原文，且不含 node 层的 p2/x1（禁止拼装）',
    eq(stRun.route.requested, { provider: 'p1', model: 'm1' }), JSON.stringify(stRun.route.requested))
  const sNoOpts = await scenario('no-run-opt', { n1: node('n1', { route: { provider: 'p2', model: 'x1' } }) }, null, () => ({ text: 'W8b' }))
  check('C8.4 不传 opts 时绝不出现 source:"run"（向后兼容的硬要求）',
    nodeState(sNoOpts, 'n1').route.source !== 'run', String(nodeState(sNoOpts, 'n1').route.source))
  check('C8.5 不传 opts 时 node 层正常胜出（source="node"、agentOptions 是 node 的声明）',
    nodeState(sNoOpts, 'n1').route.source === 'node' && eq(sNoOpts.workers[0].agentOptions, { provider: 'p2', model: 'x1' }),
    JSON.stringify({ source: nodeState(sNoOpts, 'n1').route.source, ao: sNoOpts.workers[0] && sNoOpts.workers[0].agentOptions }))
  // All four non-run sources, each on its own falsifiable scenario.
  const sWf = await scenario('src-workflow', { n1: node('n1') }, { route: { provider: 'p2', model: 'x1' } }, () => ({ text: 'W8c' }))
  check('C8.6 工作流层生效时 source==="workflow"（只有 node 层缺席才轮到它）',
    nodeState(sWf, 'n1').route.source === 'workflow' && eq(sWf.workers[0].agentOptions, { provider: 'p2', model: 'x1' }),
    JSON.stringify({ source: nodeState(sWf, 'n1').route.source, ao: sWf.workers[0] && sWf.workers[0].agentOptions }))
  const sRole = await scenario('src-role', { n1: node('n1') }, null, () => ({ text: 'W8d' }))
  check('C8.7 只有角色层声明时 source==="role"', nodeState(sRole, 'n1').route.source === 'role', String(nodeState(sRole, 'n1').route.source))
  await seedAgent('Coder', { model: {} })
  const sInh = await scenario('src-inherited', { n1: node('n1') }, null, () => ({ text: 'W8e' }))
  check('C8.8 四层皆无声明时 source==="inherited" 且 spec 里没有 agentOptions（与改动前的派发逐字节一致）',
    nodeState(sInh, 'n1').route.source === 'inherited' && sInh.workers[0].hasAgentOptions === false,
    JSON.stringify({ source: nodeState(sInh, 'n1').route.source, ao: sInh.workers[0] && sInh.workers[0].agentOptions }))
  check('C8.9 inherited 时 route.requested === null、节点 completed',
    nodeState(sInh, 'n1').route.requested === null && nodeState(sInh, 'n1').status === 'completed',
    JSON.stringify({ requested: nodeState(sInh, 'n1').route.requested, status: nodeState(sInh, 'n1').status }))
  // A parent that really runs somewhere changes the effort-clearing warning and
  // the degraded fallback: with no llm at all the route must pass through
  // UNVERIFIED (never silently reported as verified).
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 } })
  llmStub = null
  const sNoLlm = await scenario('no-llm', { n1: node('n1') }, null, () => ({ text: 'W8f' }))
  llmStub = makeLlmStub()
  check('C8.10 llm 服务缺失时 route 未经校验直接透传：verified=false、note 说明原因、agentOptions 照常带声明值',
    nodeState(sNoLlm, 'n1').route.verified === false &&
    typeof nodeState(sNoLlm, 'n1').route.note === 'string' && nodeState(sNoLlm, 'n1').route.note.indexOf('llm') !== -1 &&
    sNoLlm.workers[0] !== undefined && sNoLlm.workers[0].agentOptions !== null,
    JSON.stringify({ verified: nodeState(sNoLlm, 'n1').route.verified, note: nodeState(sNoLlm, 'n1').route.note, ao: sNoLlm.workers[0] && sNoLlm.workers[0].agentOptions, workers: sNoLlm.workers.length, src: nodeState(sNoLlm, 'n1').route.source }))
} catch (e) { blockFailure('C8 运行级覆盖/来源', e) }

// ---------------------------------------------------------------------------
// C9. Tool presets at dispatch. Fails if a preset is not expanded, if a name the
//     deployment does not have is pushed into the filter (the runtime rejects the
//     WHOLE filter then), or if that unusable name is dropped in silence.
// ---------------------------------------------------------------------------
console.log('\n[C9] 工具预设展开与未知名记录')
try {
  const WORKER_ONLY = ['ask_user_question', 'cordis_run']
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, tools: { preset: 'no-write' } })
  const s = await scenario('preset-no-write', { n1: node('n1') }, null, () => ({ text: 'W9' }))
  const w = s.workers[0]
  const deny = (w && w.toolFilter && w.toolFilter.deny) || []
  check('C9.1 no-write 展开出的 deny 含 write 与 edit（写盘能力真的被移除）',
    deny.indexOf('write') !== -1 && deny.indexOf('edit') !== -1, JSON.stringify(w && w.toolFilter))
  check('C9.2 本部署不可见的 str_replace_editor 不进 deny（塞进去会让运行时整条拒绝 filter）',
    deny.indexOf('str_replace_editor') === -1, JSON.stringify(deny))
  check('C9.3 不可见名被"记录"而不是静默丢弃：节点 toolNote 里出现它',
    typeof nodeState(s, 'n1').tools === 'string' && nodeState(s, 'n1').tools.indexOf('str_replace_editor') !== -1,
    String(nodeState(s, 'n1').tools).slice(0, 160))
  check('C9.4 插件自身的 WORKER_DENY_TOOLS 仍然在 deny 里（预设只能加，不能替换安全底线）',
    WORKER_ONLY.every((n) => deny.indexOf(n) !== -1), JSON.stringify(deny.slice(0, 6)))
  check('C9.5 节点 completed（展开失败也不能失败节点）', nodeState(s, 'n1').status === 'completed', String(nodeState(s, 'n1').status))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, tools: { preset: 'read-only' } })
  const sRo = await scenario('preset-read-only', { n1: node('n1') }, null, () => ({ text: 'W9b' }))
  const roDeny = (sRo.workers[0].toolFilter || {}).deny || []
  check('C9.6 read-only 的 deny 含 write/edit/pwsh（写盘 + 命令执行都被移除）',
    ['write', 'edit', 'pwsh'].every((n) => roDeny.indexOf(n) !== -1), JSON.stringify(roDeny))
  check('C9.7 read-only === no-write ∪ no-shell 的展开结果（在 same known 集合下的运行时等价）',
    roDeny.indexOf('bash') === -1 && roDeny.indexOf('str_replace_editor') === -1,
    JSON.stringify({ ro: roDeny, unknownNote: String(nodeState(sRo, 'n1').tools).slice(0, 120) }))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, tools: { preset: 'full' } })
  const sFull = await scenario('preset-full', { n1: node('n1') }, null, () => ({ text: 'W9c' }))
  check('C9.8 full 不追加任何预设 deny（只有 WORKER_DENY_TOOLS）',
    ((sFull.workers[0].toolFilter || {}).deny || []).indexOf('write') === -1, JSON.stringify(sFull.workers[0].toolFilter))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, tools: { deny: ['write'] } })
  const sDeny = await scenario('preset-def-deny', { n1: node('n1') }, null, () => ({ text: 'W9d' }))
  check('C9.9 角色自己的 tools.deny 与预设合并去重（去重后 write 只出现一次）',
    ((sDeny.workers[0].toolFilter || {}).deny || []).filter((n) => n === 'write').length === 1,
    JSON.stringify(sDeny.workers[0].toolFilter))
} catch (e) { blockFailure('C9 工具预设', e) }

// ---------------------------------------------------------------------------
// C10. Per-role timeout: recorded on the node, clamped to the ceiling.
// ---------------------------------------------------------------------------
console.log('\n[C10] 角色超时')
try {
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, timeoutMs: 1000 })
  const s = await scenario('timeout-small', { n1: node('n1') }, null, () => ({ text: 'W10' }))
  check('C10.1 角色声明 timeoutMs=1000 时 route.timeoutMs===1000', nodeState(s, 'n1').route.timeoutMs === 1000, String(nodeState(s, 'n1').route.timeoutMs))
  await seedAgent('Coder', { model: { provider: 'p1', model: 'm1' }, timeoutMs: 1000000000 })
  const sBig = await scenario('timeout-huge', { n1: node('n1') }, null, () => ({ text: 'W10b' }))
  check('C10.2 角色声明 10^9 时被夹到 worker ceiling 1800000（角色只能收紧，不能抬高）',
    nodeState(sBig, 'n1').route.timeoutMs === 1800000, String(nodeState(sBig, 'n1').route.timeoutMs))
} catch (e) { blockFailure('C10 超时', e) }

// ===========================================================================
console.log('\n--- GROUP B2: 真实写路径的落库形状 ---')
// ---------------------------------------------------------------------------
// B3. Through the real upsert paths, not just safeParse. Fails if a declared
//     field is dropped by the write path (declared-but-unstored is exactly the
//     defect the workflow `review` field already suffered from).
// ---------------------------------------------------------------------------
console.log('\n[B3] upsertAgent / upsertWorkflow 落库')
try {
  const a = await svc.upsertAgent({ id: 'p11-store-a', name: 'A', role: 'r', systemPrompt: 'SP', model: { provider: 'p1', model: 'm1', reasoningEffort: 'low', maxTokens: 1234 }, tools: { preset: 'no-shell' }, timeoutMs: 2000, updatedAt: 1 })
  const st = storedAgent('p11-store-a')
  check('B3.1 upsertAgent 落库保留 provider/model/reasoningEffort/maxTokens（四个键都要在）',
    st !== undefined && st.model.provider === 'p1' && st.model.model === 'm1' && st.model.reasoningEffort === 'low' && st.model.maxTokens === 1234,
    JSON.stringify(st && st.model))
  check('B3.2 upsertAgent 落库保留 tools.preset 与 timeoutMs', st.tools.preset === 'no-shell' && st.timeoutMs === 2000, JSON.stringify({ tools: st.tools, timeoutMs: st.timeoutMs }))
  check('B3.3 返回值与落库记录一致（调用方拿到的就是持久化的东西）', eq(a.model, st.model) && a.timeoutMs === st.timeoutMs)
  const bare = await svc.upsertAgent({ id: 'p11-store-bare', name: 'Bare', updatedAt: 1 })
  const stBare = storedAgent('p11-store-bare')
  check('B3.4 [核心靶点] 不声明模型的角色落库后没有 provider/model 键（改前会被填成 deepseek/deepseek-chat）',
    stBare !== undefined && stBare.model !== undefined && stBare.model.provider === undefined && stBare.model.model === undefined,
    JSON.stringify(stBare && stBare.model))
  check('B3.4b 落库串里根本不含 "deepseek"（脏数据的物证）', JSON.stringify(stBare).indexOf('deepseek') === -1, JSON.stringify(stBare))
  const wf = await svc.upsertWorkflow({ id: 'p11-store-wf', name: 'W', route: { provider: 'p1', model: 'm1' }, prompt: 'WF-PROMPT', nodes: { n1: { id: 'n1', dependsOn: [], route: { provider: 'p1', model: 'm1', maxTokens: 512 }, promptAddon: 'ADD', timeoutMs: 4000 } } })
  const stWf = storedFlow('p11-store-wf')
  check('B3.5 upsertWorkflow 落库保留工作流级 route/prompt（唯一写路径不得丢弃它们）',
    stWf !== undefined && stWf.route.provider === 'p1' && stWf.route.model === 'm1' && stWf.prompt === 'WF-PROMPT',
    JSON.stringify({ route: stWf && stWf.route, prompt: stWf && stWf.prompt }))
  check('B3.6 upsertWorkflow 落库保留节点级 route/promptAddon/timeoutMs',
    stWf.nodes.n1.route.maxTokens === 512 && stWf.nodes.n1.promptAddon === 'ADD' && stWf.nodes.n1.timeoutMs === 4000,
    JSON.stringify(stWf.nodes.n1))
  check('B3.7 落库记录能通过域 schema 的 safeParse（下次进程 open 时不会炸）',
    mod.workflowSchema.safeParse(stWf).success && mod.agentDefSchema.safeParse(stBare).success)
  const legacyAgent = rawPut('team_agent_defs', 'defs', 'p11-legacy-a', { id: 'p11-legacy-a', name: 'Legacy', role: 'r', systemPrompt: 'SP', model: { provider: 'deepseek-official', model: 'deepseek-flash' }, skills: [], tools: {}, updatedAt: 1 })
  const legacyWf = rawPut('team_workflows', 'flows', 'p11-legacy-wf', { id: 'p11-legacy-wf', name: 'LegacyW', nodes: { n1: { id: 'n1', title: 'T', agent: 'Coder', dependsOn: [] } }, updatedAt: 1 })
  check('B3.8 旧 agent 记录（显式 deepseek-official，无任何 P11 字段）仍通过 schema（域 open 的硬要求）',
    mod.agentDefSchema.safeParse(legacyAgent).success)
  check('B3.9 旧 workflow 记录仍通过 schema，且解析后不会凭空多出 route/prompt 键',
    (() => { const r = mod.workflowSchema.safeParse(legacyWf); return r.success && r.data.route === undefined && r.data.prompt === undefined && r.data.nodes.n1.route === undefined })())
  check('B3.10 域 open 时的校验结果全部为 ok（本测试文件自带的 open 期校验钩子）',
    storage.openChecks.every((c) => c.ok), JSON.stringify(storage.openChecks.filter((c) => !c.ok)))
} catch (e) { blockFailure('B3 写路径落库', e) }

// ===========================================================================
console.log('\n--- GROUP D: 读接口（真实 handler） ---')
// ---------------------------------------------------------------------------
// D1. /api/team-flowise/models. Fails if any degradation path turns into a 500,
//     if a broken provider is not skipped, or if failures stop being reported
//     as data.
// ---------------------------------------------------------------------------
console.log('\n[D1] /models')
try {
  const good = await callRoute('/api/team-flowise/models')
  const g = good.json || {}
  check('D1.1 HTTP 200 且 ok:true（只读目录端点永不 500）', good.status === 200 && g.ok === true, 'status=' + String(good.status))
  check('D1.2 providers[].id/name 来自 listProviders，models[] 来自 listModels',
    Array.isArray(g.providers) && g.providers.length === 2 && g.providers[0].id === 'p1' && g.providers[1].id === 'p2',
    JSON.stringify((g.providers || []).map((p) => p.id + ':' + p.name)))
  const p1 = (g.providers || []).find((p) => p.id === 'p1') || {}
  const m1 = (p1.models || []).find((m) => m.id === 'm1') || {}
  check('D1.3 model 条目带 id/name/description/contextWindow/defaultMaxTokens',
    m1.id === 'm1' && m1.name === 'M1' && m1.description === 'model one' && m1.contextWindow === 131072 && m1.defaultMaxTokens === 8192,
    JSON.stringify(m1))
  check('D1.4 reasoning.efforts 逐项 {id,name} 且 defaultEffort 来自 resolveModelInfo',
    eq(m1.reasoning, { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' }),
    JSON.stringify(m1.reasoning))
  check('D1.5 没有 reasoning 的模型返回 efforts:[] 与 defaultEffort:null（不得省略这两个键）',
    (() => { const m2 = (p1.models || []).find((m) => m.id === 'm2') || {}; return m2.reasoning !== undefined && eq(m2.reasoning.efforts, []) && m2.reasoning.defaultEffort === null })(),
    JSON.stringify((p1.models || []).find((m) => m.id === 'm2')))
  check('D1.6 正常路径 errors 为空数组', eq(g.errors, []), JSON.stringify(g.errors))

  // A provider whose listModels throws must be SKIPPED, named in errors, and the
  // response must stay 200.
  const baseLlm = makeLlmStub()
  llmStub = {
    listProviders: () => [{ id: 'p1', name: 'P1' }, { id: 'boom', name: 'Boom' }],
    listModels: async (id) => { if (id === 'boom') throw new Error('listModels exploded'); return baseLlm.listModels(id) },
    resolveModelInfo: baseLlm.resolveModelInfo,
  }
  const broken = await callRoute('/api/team-flowise/models')
  const b = broken.json || {}
  llmStub = makeLlmStub()
  check('D1.7 某 provider 的 listModels 抛错 -> 该 provider 被跳过（不出现在 providers 里），HTTP 仍 200',
    broken.status === 200 && b.ok === true && (b.providers || []).length === 1 && b.providers[0].id === 'p1',
    'status=' + String(broken.status) + ' providers=' + JSON.stringify((b.providers || []).map((p) => p.id)))
  check('D1.8 被跳过的 provider 在 errors 里点名，且说明是 listModels 失败（不得静默消失）',
    Array.isArray(b.errors) && b.errors.length >= 1 && b.errors.join(' ').indexOf('boom') !== -1 && b.errors.join(' ').indexOf('listModels') !== -1,
    JSON.stringify(b.errors))

  // resolveModelInfo failure: the model stays, the extras go null, errors names it.
  llmStub = {
    listProviders: () => [{ id: 'p1', name: 'P1' }],
    listModels: async () => [{ id: 'm1', name: 'M1' }],
    resolveModelInfo: async () => { throw new Error('resolve exploded') },
  }
  const noResolve = await callRoute('/api/team-flowise/models')
  const nr = noResolve.json || {}
  llmStub = makeLlmStub()
  check('D1.9 某 model 的 resolveModelInfo 抛错 -> 该 model 仍返回，但 context/defaultMaxTokens 为 null、reasoning 为空',
    noResolve.status === 200 && (nr.providers || [])[0] && (nr.providers[0].models || [])[0] &&
    nr.providers[0].models[0].contextWindow === null && nr.providers[0].models[0].defaultMaxTokens === null &&
    eq(nr.providers[0].models[0].reasoning, { efforts: [], defaultEffort: null }),
    JSON.stringify((nr.providers || [])[0]))
  check('D1.10 该失败同样进 errors 并点名 provider/model', Array.isArray(nr.errors) && nr.errors.join(' ').indexOf('resolveModelInfo') !== -1, JSON.stringify(nr.errors))

  // llm missing entirely.
  llmStub = undefined
  const noLlm = await callRoute('/api/team-flowise/models')
  const nl = noLlm.json || {}
  llmStub = makeLlmStub()
  check('D1.11 llm 缺失 -> ok:true、providers:[]、HTTP 200（降级成数据而不是异常）',
    noLlm.status === 200 && nl.ok === true && eq(nl.providers, []), 'status=' + String(noLlm.status) + ' body=' + String(noLlm.raw))
  check('D1.12 llm 缺失时 errors 说明原因（关键词 llm / 不可用）',
    Array.isArray(nl.errors) && nl.errors.length >= 1 && nl.errors.join(' ').indexOf('llm') !== -1, JSON.stringify(nl.errors))
  // listProviders throwing.
  llmStub = { listProviders: () => { throw new Error('providers exploded') }, listModels: async () => [], resolveModelInfo: async () => ({}) }
  const lp = await callRoute('/api/team-flowise/models')
  llmStub = makeLlmStub()
  check('D1.13 listProviders 抛错 -> ok:true、providers:[]、errors 点名 listProviders、HTTP 200',
    lp.status === 200 && (lp.json || {}).ok === true && eq((lp.json || {}).providers, []) && (lp.json || {}).errors.join(' ').indexOf('listProviders') !== -1,
    'status=' + String(lp.status) + ' errors=' + JSON.stringify((lp.json || {}).errors))
  // A provider with no models is legal, not an error.
  llmStub = { listProviders: () => [{ id: 'empty', name: 'Empty' }], listModels: async () => [], resolveModelInfo: async () => ({}) }
  const emptyP = await callRoute('/api/team-flowise/models')
  llmStub = makeLlmStub()
  check('D1.14 某 provider 返回空数组 -> 正常返回 models:[]，且不计入 errors（无模型是合法状态）',
    (emptyP.json || {}).providers.length === 1 && eq((emptyP.json || {}).providers[0].models, []) && eq((emptyP.json || {}).errors, []),
    JSON.stringify(emptyP.json))
  // A provider whose listModels HANGS must not hang /models: withTimeout turns it
  // into the same "skipped + named in errors" degradation (5s guard).
  llmStub = {
    listProviders: () => [{ id: 'hang', name: 'Hang' }, { id: 'p1', name: 'P1' }],
    listModels: async (id) => { if (id === 'hang') return new Promise(() => {}); return makeLlmStub().listModels(id) },
    resolveModelInfo: (p, m) => makeLlmStub().resolveModelInfo(p, m),
  }
  const hangStart = Date.now()
  const hang = await callRoute('/api/team-flowise/models')
  const hangMs = Date.now() - hangStart
  llmStub = makeLlmStub()
  check('D1.15 某 provider 的 listModels 挂住 -> 被 5s 守卫转成"跳过 + errors 点名"，其余 provider 照常返回，HTTP 200',
    hang.status === 200 && (hang.json || {}).providers.length === 1 && (hang.json || {}).providers[0].id === 'p1' &&
    (hang.json || {}).errors.join(' ').indexOf('hang') !== -1 && hangMs < 15000,
    'status=' + String(hang.status) + ' elapsed=' + String(hangMs) + 'ms providers=' + JSON.stringify((hang.json || {}).providers.map((p) => p.id)) + ' errors=' + JSON.stringify((hang.json || {}).errors))
} catch (e) { blockFailure('D1 /models', e) }

// ---------------------------------------------------------------------------
// D2. /progress + /role projections. A hand-seeded run (one reviewed node with a
//     full route record, one unreviewed node without any route) proves the
//     projections, the "old record => null" rule, and the UNCHANGED roles
//     invariant.
// ---------------------------------------------------------------------------
console.log('\n[D2] /progress 与 /role 的 route/persona 投影')
try {
  const DWF = 'wf-p11c-fixture'
  const DRUN = 'run-p11c-fixture'
  const T0 = Date.now() - 600000
  await svc.upsertWorkflow({
    id: DWF, name: 'P11-C 夹具工作流',
    nodes: {
      a: { id: 'a', title: '实现', agent: 'Coder', reviewer: 'Reviewer', dependsOn: [], taskTemplate: { requirement: 'REQ-A', acceptanceCriteria: 'AC-A' } },
      b: { id: 'b', title: '验收', agent: 'Tester', dependsOn: ['a'], taskTemplate: { requirement: 'REQ-B', acceptanceCriteria: 'AC-B' } },
    },
  })
  const fullRoute = {
    requested: { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 },
    source: 'role', effective: { provider: 'p1', model: 'm1', reasoningEffort: 'high', maxTokens: 4096 },
    measured: true, verified: true, warning: null, note: null,
    efforts: ['low', 'high'], defaultEffort: 'high', timeoutMs: 1800000,
  }
  const cstates = {
    a: { status: 'completed', assignee: 'Coder', startedAt: T0, endedAt: T0 + 1000, summary: 'A 完成',
      route: fullRoute,
      persona: { chars: 42, layers: ['role', 'workflow'], warning: null },
      review: { reviewer: 'Reviewer', reviewerName: 'Reviewer', verdict: 'pass', score: 90, summary: 'A 通过', blockingCount: 0, advisoryCount: 0, unresolved: false, rounds: 1, elapsedMs: 10, findings: [], resolved: [], uncertainties: [], notes: [], error: null, parseError: null },
      reviewRoute: { requested: null, source: 'inherited', effective: { provider: null, model: null, reasoningEffort: null, maxTokens: null }, measured: false, verified: false, warning: null, note: 'x', efforts: null, defaultEffort: null, timeoutMs: 600000 },
      reviewPersona: { chars: 7, layers: ['role'], warning: null } },
    b: { status: 'failed', assignee: 'Tester', startedAt: T0 + 1000, endedAt: T0 + 2000, error: 'T-ERROR' },
  }
  rawPut('team_runs', 'runs', DRUN, { id: DRUN, workflowId: DWF, status: 'running', nodeStates: cstates, startedAt: T0 })
  const prog = await callRoute('/api/team-flowise/progress', 'runId=' + DRUN)
  const p = prog.json || {}
  const byId = {}
  for (const n of p.nodes || []) byId[n.id] = n
  check('D2.1 /progress 经真实 handler 返回 ok:true 与本次 run', prog.status === 200 && p.ok === true && (p.run || {}).id === DRUN, 'status=' + String(prog.status))
  check('D2.2 节点 route 轻投影键集合精确 = [effective, measured, source, warning]（多带 efforts 会让 3 秒轮询变重）',
    eq(Object.keys(byId.a.route || {}).sort(), ['effective', 'measured', 'source', 'warning']), Object.keys(byId.a.route || {}).sort().join(','))
  check('D2.3 轻投影 effective 恰好四键 {provider,model,reasoningEffort,maxTokens}',
    eq(Object.keys(byId.a.route.effective || {}).sort(), ['maxTokens', 'model', 'provider', 'reasoningEffort']), JSON.stringify(byId.a.route.effective))
  check('D2.4 轻投影值正确：source=role、measured=true、warning=null、effective=p1/m1',
    byId.a.route.source === 'role' && byId.a.route.measured === true && byId.a.route.warning === null &&
    byId.a.route.effective.provider === 'p1' && byId.a.route.effective.model === 'm1' && byId.a.route.effective.reasoningEffort === 'high' && byId.a.route.effective.maxTokens === 4096,
    JSON.stringify(byId.a.route))
  check('D2.5 轻投影不带 efforts/defaultEffort/requested/verified（重字段只许出现在 /role）',
    byId.a.route.efforts === undefined && byId.a.route.defaultEffort === undefined && byId.a.route.requested === undefined && byId.a.route.verified === undefined,
    Object.keys(byId.a.route).join(','))
  check('D2.6 节点 persona 轻投影只有 {chars,layers}，且不含 warning 与全文',
    eq(Object.keys(byId.a.persona || {}).sort(), ['chars', 'layers']) && byId.a.persona.chars === 42 && eq(byId.a.persona.layers, ['role', 'workflow']),
    JSON.stringify(byId.a.persona))
  check('D2.7 无 route 记录的节点（旧 run）route === null，而不是空对象',
    byId.b.route === null && byId.b.persona === null, JSON.stringify({ route: byId.b.route, persona: byId.b.persona }))
  check('D2.8 /progress 不输出评审者的 route（评审者的路由不是节点产物的一部分）',
    byId.a.reviewRoute === undefined && byId.a.review !== undefined && Object.keys(byId.a.review).join(',').indexOf('route') === -1,
    Object.keys(byId.a.review || {}).join(','))
  const rollUpNames = (p.roles || []).map((r) => r.name).sort()
  const nodeNames = [...new Set((p.nodes || []).map((n) => (n.agentName === null ? '(未指派)' : n.agentName)))].sort()
  check('D2.9 [既有口径不许放宽] /progress 的 roles 集合仍恰好等于节点负责人集合',
    eq(rollUpNames, nodeNames), 'roles=' + JSON.stringify(rollUpNames) + ' nodes=' + JSON.stringify(nodeNames))
  check('D2.10 totals 仍是 9 键且 percent 仍为 completed/total（新增键不得挤进 totals）',
    eq(Object.keys(p.totals || {}).sort(), ['completed', 'failed', 'pending', 'percent', 'reviewing', 'rework', 'total', 'unresolved', 'working'].sort()) &&
    p.totals.percent === 50 && p.totals.total === 2,
    JSON.stringify(p.totals))
  check('D2.11 评审者绝不出现在 roles 里（它是监督者，不占 DAG 泳道）',
    rollUpNames.indexOf('Reviewer') === -1, JSON.stringify(rollUpNames))

  const roleFor = async (name) => (await callRoute('/api/team-flowise/role', 'runId=' + DRUN + '&agent=' + encodeURIComponent(name))).json || {}
  const dCoder = await roleFor('Coder')
  const owned = (dCoder.nodes || [])[0] || {}
  check('D2.12 /role 负责人条目带完整 route（requested/source/effective/measured/verified/warning/note/efforts/defaultEffort/timeoutMs 十键）',
    eq(Object.keys(owned.route || {}).sort(), ['defaultEffort', 'effective', 'efforts', 'measured', 'note', 'requested', 'source', 'timeoutMs', 'verified', 'warning'].sort()),
    Object.keys(owned.route || {}).sort().join(','))
  check('D2.13 /role 负责人条目 route 的值逐字段等于节点记录（不是轻投影）',
    eq(owned.route, fullRoute), JSON.stringify(owned.route))
  check('D2.14 /role 负责人条目带 persona（chars/layers/warning），仍不含全文',
    owned.persona !== undefined && owned.persona.chars === 42 && eq(owned.persona.layers, ['role', 'workflow']) && owned.persona.warning === null,
    JSON.stringify(owned.persona))
  const dTester = await roleFor('Tester')
  const ownedB = (dTester.nodes || [])[0] || {}
  check('D2.15 无 route 记录的节点在 /role 上同样是 null（旧 run 的卡片渲染不变）',
    ownedB.route === null && ownedB.persona === null, JSON.stringify({ route: ownedB.route, persona: ownedB.persona }))
  const dReviewer = await roleFor('Reviewer')
  const rev = (dReviewer.reviews || [])[0] || {}
  check('D2.16 /role 评审条目带 reviewRoute 与 reviewPersona（kind=review，评审者的路由是 review 的兄弟键）',
    rev.kind === 'review' && rev.reviewRoute !== undefined && rev.reviewRoute !== null && rev.reviewRoute.timeoutMs === 600000 && rev.reviewPersona !== undefined,
    JSON.stringify({ kind: rev.kind, reviewRoute: rev.reviewRoute, reviewPersona: rev.reviewPersona }))
  check('D2.17 评审条目的键集合 = 判决投影 30 键 + reviewRoute + reviewPersona（评审者的路由是 review 的兄弟键，且路由字段绝不出现在 top-level）',
    eq(Object.keys(rev).sort(), ['advisoryCount', 'blockingCount', 'elapsedMs', 'endedAt', 'error', 'findings', 'id', 'kind', 'nodeTitle', 'notes', 'order', 'parseError', 'reasoning', 'reasoningLen', 'resolved', 'reviewPersona', 'reviewRoute', 'reviewedAgentName', 'reviewedStatus', 'reviewedSummary', 'reviewer', 'reviewerName', 'rounds', 'score', 'startedAt', 'summary', 'taskId', 'toolNote', 'uncertainties', 'unresolved', 'unresolvedReason', 'verdict'].sort()),
    'revKeys=' + Object.keys(rev).sort().join(','))
  check('D2.17b 判决键与路由键零重叠：top-level 不得出现 source/effective/measured/requested/verified 等路由字段（说明它们确实在 reviewRoute 里）',
    ['source', 'effective', 'measured', 'requested', 'verified', 'efforts', 'defaultEffort', 'timeoutMs'].every((k) => !(k in rev)) &&
    ['source', 'measured', 'verified', 'timeoutMs'].every((k) => k in rev.reviewRoute),
    Object.keys(rev).filter((k) => ['source', 'effective', 'measured', 'requested', 'verified'].indexOf(k) !== -1).join(',') || '（无重叠）')
  check('D2.17c 评审条目不得输出节点产物字段（output/taskStatus/requirement/acceptanceCriteria/route/persona 一个都不许有）',
    ['output', 'taskStatus', 'requirement', 'acceptanceCriteria', 'route', 'persona', 'review'].every((k) => !(k in rev)),
    Object.keys(rev).filter((k) => ['output', 'taskStatus', 'requirement', 'acceptanceCriteria', 'route', 'persona', 'review'].indexOf(k) !== -1).join(',') || '（无泄漏）')
  check('D2.18 /role 未知角色仍返回空数组（既有形状不变）',
    (await roleFor('不存在的角色')).nodes !== undefined && eq((await roleFor('不存在的角色')).nodes, []))
} catch (e) { blockFailure('D2 读面投影', e) }

// ===========================================================================
summary()
process.exit(failures === 0 ? 0 : 1)
