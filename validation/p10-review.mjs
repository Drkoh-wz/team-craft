// P10-C: executable tests for the P10 review engine (the `reviewer` role of
// team-flowise). Everything here is provable WITHOUT the host: group A drives
// the module-level pure functions, groups B/C mount the REAL host half against
// an in-memory stub `ctx` and drive the real scheduler / data plane.
//
// Usage:
//   node validation/p10-review.mjs                       # test the repo source
//   P10_SRC=<path-to-a-copy> node validation/p10-review.mjs
//       -> test a COPY (used by the mutation runs: the copy is broken on
//          purpose in the system temp dir, never in the repository).
//
// Exit code: 0 = every check passed, 1 = at least one check failed,
//            2 = the module under test could not even be imported.
//
// Every check below states what it verifies. A check is only useful if a
// concrete, nameable change to the source can turn it red; the mutation runs
// in the report prove that for three of them.
import { readFileSync } from 'node:fs'

const SRC = process.env.P10_SRC && process.env.P10_SRC.trim() !== ''
  ? process.env.P10_SRC.trim()
  : 'D:/ai-workspace/dsh/packages/team-flowise/src/index.js'
const SRC_URL = /^file:/.test(SRC) ? SRC : 'file:///' + SRC.replace(/\\/g, '/')

let checks = 0
let failures = 0
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
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

console.log('\n=== P10-C review-engine tests ===')
let srcSize = -1
try { srcSize = readFileSync(SRC).length } catch { /* keep -1 */ }
console.log('module under test: ' + SRC_URL)
console.log('source bytes: ' + String(srcSize) + (process.env.P10_SRC ? '  (MUTATION MODE: not the repository file)' : ''))

let mod = null
try { mod = await import(SRC_URL) } catch (e) {
  console.log('FATAL: cannot import the module under test: ' + String(e && e.message ? e.message : e))
  process.exit(2)
}

// ===========================================================================
console.log('\n--- GROUP A: module-level pure functions (no ctx, no restart) ---')
// ---------------------------------------------------------------------------
// A1. REVIEW_LIMITS: the mechanical bounds on how long a review step can
//     stretch a run. Fails if any bound is missing, wrong, unbounded, or
//     non-integral -- each is a separate check so a single edit is pinpointed.
// ---------------------------------------------------------------------------
console.log('\n[A1] REVIEW_LIMITS')
const L = mod.REVIEW_LIMITS
check('A1.1 REVIEW_LIMITS 已导出且为对象（否则 B 组的全部上界断言都无从谈起）',
  L !== null && typeof L === 'object' && !Array.isArray(L), JSON.stringify(L))
const wantLimits = { timeoutMs: 600000, maxFindings: 20, maxReworkPerNode: 2, maxReworkPerRun: 3, artifactMax: 20000 }
if (L !== null && typeof L === 'object') {
  check('A1.2 REVIEW_LIMITS 恰好五个字段（多一个字段意味着有未被测试覆盖的新上界）',
    Object.keys(L).sort().join(',') === Object.keys(wantLimits).sort().join(','), Object.keys(L).join(','))
  for (const k of Object.keys(wantLimits)) {
    check('A1.3 ' + k + ' 的值必须恰为 ' + String(wantLimits[k]) + '（改动它会直接改变运行时长上界）',
      L[k] === wantLimits[k], k + '=' + String(L[k]))
  }
  check('A1.4 maxReworkPerNode 是有界正整数 1..8（0 会让评审形同虚设，无界会拉长任务）',
    Number.isInteger(L.maxReworkPerNode) && L.maxReworkPerNode >= 1 && L.maxReworkPerNode <= 8, String(L.maxReworkPerNode))
  check('A1.5 maxReworkPerRun 是有界正整数 1..8（整次运行的返工总闸，必须有限）',
    Number.isInteger(L.maxReworkPerRun) && L.maxReworkPerRun >= 1 && L.maxReworkPerRun <= 8, String(L.maxReworkPerRun))
  check('A1.6 maxReworkPerNode <= maxReworkPerRun（单节点上限不得比整轮上限还松）',
    L.maxReworkPerNode <= L.maxReworkPerRun, L.maxReworkPerNode + ' <= ' + L.maxReworkPerRun)
  check('A1.7 timeoutMs 为正整数且 <= 1800000（评审必须有超时，否则坏评审者会挂住整次运行）',
    Number.isInteger(L.timeoutMs) && L.timeoutMs > 0 && L.timeoutMs <= 1800000, String(L.timeoutMs))
  check('A1.8 maxFindings / artifactMax 为正整数且前者 <= 100（评审载荷必须有界）',
    Number.isInteger(L.maxFindings) && L.maxFindings > 0 && L.maxFindings <= 100 && Number.isInteger(L.artifactMax) && L.artifactMax > 0,
    'maxFindings=' + String(L.maxFindings) + ' artifactMax=' + String(L.artifactMax))
  check('A1.9 三个纯函数均已具名导出（缺一个就等于 A2/A3/A4 的覆盖面归零）',
    typeof mod.buildReviewPrompt === 'function' && typeof mod.buildReworkPrompt === 'function' && typeof mod.parseReviewVerdict === 'function' && typeof mod.normalizeReview === 'function',
    [typeof mod.buildReviewPrompt, typeof mod.buildReworkPrompt, typeof mod.parseReviewVerdict, typeof mod.normalizeReview].join(','))
}

// ---------------------------------------------------------------------------
// A2. buildReviewPrompt: the reviewer's contract. Fails if a dimension, a JSON
//     key, the "no blocking => pass" rule, the truncation disclosure or the
//     re-review no-new-blocking ban stops being written into the prompt.
// ---------------------------------------------------------------------------
console.log('\n[A2] buildReviewPrompt')
{
  const base = { round: 1, nodeId: 'n1', title: '节点一', agentName: 'Coder', requirement: 'REQ-BODY', acceptanceCriteria: 'AC-BODY', artifact: 'ARTIFACT-BODY-MARKER', artifactTruncated: false }
  const rp1 = mod.buildReviewPrompt(base)
  const rp2 = mod.buildReviewPrompt(Object.assign({}, base, { round: 2, knownBlocking: ['KNOWN-BLOCKING-CRITERION'] }))
  const rpTrunc = mod.buildReviewPrompt(Object.assign({}, base, { artifactTruncated: true }))
  check('A2.1 返回非空字符串并把被审节点信息写全（title/id/agent/requirement/AC 缺一即失败）',
    typeof rp1 === 'string' && rp1.length > 200 && rp1.indexOf('节点一') !== -1 && rp1.indexOf('n1') !== -1 && rp1.indexOf('Coder') !== -1 && rp1.indexOf('REQ-BODY') !== -1 && rp1.indexOf('AC-BODY') !== -1,
    'len=' + String(rp1.length))
  check('A2.2 交付物正文原文进入提示词（评审必须看到被审内容）', rp1.indexOf('ARTIFACT-BODY-MARKER') !== -1)
  for (const dim of ['需求符合性', '正确性', '完整性', '风险', '优化空间']) {
    check('A2.3 五个评审维度之一以 "- ' + dim + '：" 的形式逐条列出（删掉任一维度即红）',
      rp1.indexOf('- ' + dim + '：') !== -1, dim)
  }
  check('A2.4 维度段有固定标题，声明 dimension 只能取这五个（防止评审者自创评审轴）',
    rp1.indexOf('## 五个固定评审维度') !== -1 && rp1.indexOf('只能取这五个') !== -1)
  for (const key of ['"verdict"', '"findings"', '"evidence"', '"uncertainties"']) {
    check('A2.5 JSON 契约关键字 ' + key + ' 出现在提示词中', rp1.indexOf(key) !== -1)
  }
  check('A2.6 JSON 契约还包含 criterion / impact / suggestion / resolved / score / severity（少一个评审者就会漏字段）',
    ['"criterion"', '"impact"', '"suggestion"', '"resolved"', '"score"', '"severity"'].every((k) => rp1.indexOf(k) !== -1))
  check('A2.7 明确写出"没有 blocking 时必须 pass"（这是防吹毛求疵的第一条文字约束）',
    /没有 blocking 条目时 verdict 必须为 "pass"/.test(rp1), '')
  check('A2.8 明确禁止为了显得尽责而制造 blocking', rp1.indexOf('禁止为了显得尽责而制造 blocking') !== -1)
  check('A2.9 风格/命名/可读性等一律 advisory、永不阻塞（否则评审者可用品味拦任务）',
    rp1.indexOf('一律 advisory，永不阻塞') !== -1)
  check('A2.10 无法判断的必须写进 uncertainties 而不是当 blocking',
    /无法判断的写进 uncertainties，不得当作 blocking/.test(rp1))
  check('A2.11 artifactTruncated:true 时出现截断声明且写明字符上限 ' + String(L.artifactMax),
    rpTrunc.indexOf('截断') !== -1 && rpTrunc.indexOf(String(L.artifactMax)) !== -1)
  check('A2.12 截断声明写明未展示部分不得作为 blocking 依据（评审者不得因没看到的内容判阻塞）',
    rpTrunc.indexOf('不得作为 blocking 依据') !== -1)
  check('A2.13 artifactTruncated 非 true 时不得出现截断声明（否则评审者会以为产物不完整）',
    rp1.indexOf('已截断') === -1)
  check('A2.14 round>=2 时出现"禁止提出新的 blocking"与复审专属说明（返工复审必须收敛）',
    rp2.indexOf('禁止提出新的 blocking') !== -1 && rp2.indexOf('这是返工之后的复审') !== -1)
  check('A2.15 round=1 时不得出现复审专属说明（首轮必须允许发现阻塞项）',
    rp1.indexOf('这是返工之后的复审') === -1 && rp1.indexOf('这是首轮评审') !== -1)
  check('A2.16 round>=2 时上一轮阻塞项原文逐条列出（knownBlocking 必须真的进提示词）',
    rp2.indexOf('KNOWN-BLOCKING-CRITERION') !== -1 && rp2.indexOf('## 上一轮列出的阻塞项') !== -1)
  check('A2.17 round=1 时不得出现"上一轮阻塞项"段落（首轮没有上一轮）',
    rp1.indexOf('## 上一轮列出的阻塞项') === -1)
  check('A2.18 轮次号出现在提示词里且被标为复审（round=2 与 round=1 的文案必须不同）',
    rp2.indexOf('round=2') !== -1 && rp1.indexOf('round=1') !== -1)
}

// ---------------------------------------------------------------------------
// A3. buildReworkPrompt: what the worker is told on the second dispatch. Fails
//     if the blocking criterion/evidence stops being quoted verbatim, or if the
//     "do not widen the scope" constraint disappears (that constraint is what
//     keeps a rework from costing more than the node).
// ---------------------------------------------------------------------------
console.log('\n[A3] buildReworkPrompt')
{
  const bf = { severity: 'blocking', dimension: '正确性', criterion: 'CRIT-条款原文-ABC', evidence: 'EVID-证据原文-XYZ', impact: 'IMPACT-原文', suggestion: 'SUG-原文' }
  const wp = mod.buildReworkPrompt({ who: 'Coder', round: 1, requirement: 'REQ-REWORK', acceptanceCriteria: 'AC-REWORK', blocking: [bf] })
  check('A3.1 返回非空字符串并指明返工对象与轮次', typeof wp === 'string' && wp.indexOf('Coder') !== -1 && wp.length > 200, 'len=' + String(wp.length))
  check('A3.2 blocking 的 criterion 原文出现在提示词里（返工目标必须逐字可核对）', wp.indexOf('CRIT-条款原文-ABC') !== -1)
  check('A3.3 blocking 的 evidence 原文出现在提示词里（工人必须看到证据本身）', wp.indexOf('EVID-证据原文-XYZ') !== -1)
  check('A3.4 impact / suggestion 原文也在（不修会怎样 + 怎么修）',
    wp.indexOf('IMPACT-原文') !== -1 && wp.indexOf('SUG-原文') !== -1)
  check('A3.5 出现"不得扩大改动范围"一类约束（防止返工变成重构）', wp.indexOf('不得扩大改动范围') !== -1)
  check('A3.6 声明要逐条修复并逐条说明改了什么', wp.indexOf('逐条修复') !== -1 && wp.indexOf('逐条说明') !== -1)
  check('A3.7 写明阻塞项条数，且原任务要求/验收标准一并带上',
    wp.indexOf('共 1 条') !== -1 && wp.indexOf('REQ-REWORK') !== -1 && wp.indexOf('AC-REWORK') !== -1)
  const wpEmpty = mod.buildReworkPrompt({ blocking: [] })
  check('A3.8 空 blocking 列表时不伪造条目（写"（无）"而不是留下未闭合的段落）', wpEmpty.indexOf('（无）') !== -1)
  {
    // Strengthened: the old predicate was only `typeof === 'string'`, whose sole
    // failure mode was an exception -- and an exception in group A killed the
    // process instead of failing a check. Assert the degraded prompt is actually
    // a well-formed prompt (placeholders + the scope constraint), not just "did
    // not throw".
    const wpUndef = mod.buildReworkPrompt(undefined)
    check('A3.9 传入 undefined 时仍返回结构完整的提示词（非空长度 + 空占位 + 范围约束），而不是空串或抛异常',
      typeof wpUndef === 'string' && wpUndef.length > 100 && wpUndef.indexOf('（无）') !== -1 &&
        wpUndef.indexOf('（未提供）') !== -1 && wpUndef.indexOf('不得扩大改动范围') !== -1,
      'len=' + String(wpUndef && wpUndef.length))
  }
}

// ---------------------------------------------------------------------------
// A4. parseReviewVerdict: text -> object, never throwing. Fails if any of the
//     six required input shapes stops producing the documented parsed/parseError.
// ---------------------------------------------------------------------------
console.log('\n[A4] parseReviewVerdict')
{
  const pv = (t) => mod.parseReviewVerdict(t)
  const fence = pv('```json\n{"verdict":"pass","score":80}\n```')
  check('A4.1 围栏 JSON：parsed 命中对象、verdict=pass、parseError 为空、来源标为 fence',
    fence.parsed !== null && fence.parsed.verdict === 'pass' && fence.parsed.score === 80 && fence.parseError === null && fence.source === 'fence',
    JSON.stringify({ parsed: fence.parsed, parseError: fence.parseError, source: fence.source }))
  const bare = pv('{"verdict":"pass","score":80}')
  check('A4.2 裸 JSON：括号扫描取出对象（source=scan）',
    bare.parsed !== null && bare.parsed.score === 80 && bare.source === 'scan' && bare.parseError === null)
  const prose = pv('好的，以下是结论：\n{"verdict":"pass","score":77}\n以上是全部内容。')
  check('A4.3 JSON 前后有解释文字：仍能取出对象（评审者爱写开场白）',
    prose.parsed !== null && prose.parsed.score === 77, JSON.stringify(prose.parsed))
  const trickyText = JSON.stringify({ verdict: 'rework', summary: '他说 "不行"，并且 {a: 1} 未定义 \\ 结束' })
  const tricky = pv(trickyText)
  check('A4.4 字符串里含花括号与转义引号：扫描器不被截断，summary 逐字还原',
    tricky.parsed !== null && tricky.parsed.summary === JSON.parse(trickyText).summary, trickyText)
  const nonJson = pv('这是一份很好的方案，我打 90 分。')
  check('A4.5 完全非 JSON：parsed 为 null 且 parseError 给出原因（必须由 R1 兜底放行）',
    nonJson.parsed === null && typeof nonJson.parseError === 'string' && nonJson.parseError.length > 0, String(nonJson.parseError))
  const empty = pv('')
  check('A4.6 空字符串：parsed 为 null 且 parseError 指出输出为空',
    empty.parsed === null && typeof empty.parseError === 'string' && empty.parseError.indexOf('空') !== -1, String(empty.parseError))
  const blank = pv('   \n  ')
  check('A4.7 纯空白字符串与空串同待遇（空格不得被当成有效输出）', blank.parsed === null && blank.parseError !== null)
  const two = pv('{"verdict":"pass"} 然后补充 {"verdict":"rework","score":40}')
  check('A4.8 出现两个顶层对象时取最后一个（评审者先复述示例的场景不得取错）',
    two.parsed !== null && two.parsed.verdict === 'rework' && two.parsed.score === 40, JSON.stringify(two.parsed))
  const arr = pv('```json\n[1,2,3]\n```')
  check('A4.9 围栏里是数组：不得被当成结论对象（parsed 必须为 null）',
    arr.parsed === null, 'parseError=' + String(arr.parseError))
  check('A4.10 无 json 标记的普通围栏也能解析（模型经常只写 ```）',
    (() => { const r = pv('```\n{"verdict":"pass"}\n```'); return r.parsed !== null && r.parsed.verdict === 'pass' })())
  const nested = pv('说明 {"outer":{"verdict":"pass"}} 结束')
  check('A4.11 嵌套对象按深度配对（内层 } 不得提前闭合）',
    nested.parsed !== null && nested.parsed.outer !== undefined && nested.parsed.outer.verdict === 'pass', JSON.stringify(nested.parsed))
  check('A4.12 非字符串输入（null）不抛异常，只报 parseError',
    (() => { const r = pv(null); return r.parsed === null && typeof r.parseError === 'string' })())
  check('A4.13 fenced 内括号配对兜底：围栏里带前后缀时仍能取出对象',
    (() => { const r = pv('```json\n结论如下 {"verdict":"pass","score":11} 完毕\n```'); return r.parsed !== null && r.parsed.score === 11 })())
  // Coverage gap found by the P10-D review (mutation M9): "the LAST json fence
  // wins" was implemented and documented but never asserted, so a change to the
  // fence regex could silently start trusting a reviewer's echoed example.
  const twoFences = pv('先给一个格式示例：\n```json\n{"verdict":"pass","score":1}\n```\n下面是本次的真实结论：\n```json\n{"verdict":"rework","score":2}\n```')
  check('A4.14 出现两个 json 围栏时必须取最后一个（不得采信评审者复述的示例模板）',
    twoFences.parsed !== null && twoFences.parsed.verdict === 'rework' && twoFences.parsed.score === 2,
    JSON.stringify(twoFences.parsed))
  // D2 fix: when the fence parses but yields an array/scalar, JSON.parse succeeds
  // so no catch fires -- the failure reason used to be lost entirely.
  const arrReason = pv('```json\n[1,2,3]\n```')
  check('A4.15 围栏顶层是数组时 parseError 必须给出原因（不得只给 parsed:null）',
    arrReason.parsed === null && typeof arrReason.parseError === 'string' && arrReason.parseError.length > 0,
    String(arrReason.parseError))
}

// ---------------------------------------------------------------------------
// A5. normalizeReview R1-R6. Each rule gets its own case, and each case asserts
//     the DEGRADED severity / blockingCount / verdict plus the audit note, so
//     "did not throw" is never mistaken for "the rule fired".
// ---------------------------------------------------------------------------
console.log('\n[A5] normalizeReview 的六条兜底 R1-R6')
{
  const nr = (raw, opts) => mod.normalizeReview(raw, opts)
  const notesText = (r) => (Array.isArray(r.notes) ? r.notes.join(' | ') : '')
  const longCrit = '验收标准 AC-1 要求交付物给出可执行的验证命令'
  const longEvid = '产物第 12 行只写了"已验证"，没有任何命令或输出'

  // R1 -- reviewer produced nothing parseable: the reviewer is broken, not the
  // artifact, so the node must not block.
  for (const [label, input] of [['null', null], ['字符串', '我打 90 分'], ['数组', [1, 2]], ['数字', 42]]) {
    const r = nr(input, { parseError: 'parse-failed-for-test' })
    check('A5.1 R1(' + label + ')：verdict=error、findings 空、blockingCount=0、notes 指明 R1',
      r.verdict === 'error' && Array.isArray(r.findings) && r.findings.length === 0 && r.blockingCount === 0 && notesText(r).indexOf('R1') !== -1,
      'verdict=' + String(r.verdict) + ' blocking=' + String(r.blockingCount) + ' notes=' + notesText(r).slice(0, 80))
  }
  const r1sum = nr(null, { parseError: 'boom' })
  check('A5.2 R1：summary 明写"未经实质评审"（UI 靠它把这条显式标出来）',
    typeof r1sum.summary === 'string' && r1sum.summary.indexOf('未经实质评审') !== -1, r1sum.summary)
  check('A5.3 R1：notes 里带上 parseError 原文（可追查为什么没生效）', notesText(r1sum).indexOf('boom') !== -1, notesText(r1sum))

  // R2 -- illegal severity enum. One-way invariant: never upgrades.
  const r2 = nr({ verdict: 'rework', score: 40, findings: [{ severity: 'CRITICAL', criterion: longCrit, evidence: longEvid }] })
  check('A5.4 R2：非法 severity(CRITICAL) 降级为 advisory，blockingCount=0',
    r2.findings[0].severity === 'advisory' && r2.blockingCount === 0, 'severity=' + String(r2.findings[0].severity) + ' blocking=' + String(r2.blockingCount))
  check('A5.5 R2：降级被留痕（downgraded=true + downgradeReason 指明 R2）',
    r2.findings[0].downgraded === true && String(r2.findings[0].downgradeReason).indexOf('R2') !== -1, String(r2.findings[0].downgradeReason))
  check('A5.6 R2：非法枚举不得让结论停在 rework（R6 接力改为 pass）',
    r2.verdict === 'pass' && notesText(r2).indexOf('R6') !== -1, 'verdict=' + String(r2.verdict))
  for (const bad of ['blocker', 'BLOCKING', 'high', 'fatal', '严重', undefined, null, 3, {}]) {
    const r = nr({ verdict: 'rework', score: 10, findings: [{ severity: bad, criterion: longCrit, evidence: longEvid }] })
    check('A5.7 R2 单行道：输入 ' + JSON.stringify(bad === undefined ? null : bad) + ' 时输出永不升级为 blocking',
      r.blockingCount === 0 && r.findings[0].severity === 'advisory', 'severity=' + String(r.findings[0].severity))
  }
  const r2ok = nr({ verdict: 'rework', score: 40, findings: [{ severity: 'blocking', criterion: longCrit, evidence: longEvid }] })
  check('A5.8 正例：severity 恰为 "blocking" 时才入列（blockingCount=1 且 verdict=rework、无降级留痕）',
    r2ok.blockingCount === 1 && r2ok.verdict === 'rework' && r2ok.findings[0].downgraded === false,
    'blocking=' + String(r2ok.blockingCount) + ' verdict=' + String(r2ok.verdict))

  // R3 -- a blocking item must be doubly verifiable (which clause + where).
  const r3a = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: '   ', evidence: longEvid }] })
  check('A5.9 R3：blocking 但 criterion 空白 -> advisory，blockingCount=0，notes 指明 R3',
    r3a.findings[0].severity === 'advisory' && r3a.blockingCount === 0 && notesText(r3a).indexOf('R3') !== -1,
    'severity=' + String(r3a.findings[0].severity) + ' blocking=' + String(r3a.blockingCount) + ' notes=' + notesText(r3a).slice(0, 90))
  const r3b = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: longCrit, evidence: '短' }] })
  check('A5.10 R3：blocking 但 evidence 过短 -> advisory，blockingCount=0，notes 点名 evidence',
    r3b.findings[0].severity === 'advisory' && r3b.blockingCount === 0 && notesText(r3b).indexOf('evidence') !== -1,
    'severity=' + String(r3b.findings[0].severity) + ' blocking=' + String(r3b.blockingCount) + ' notes=' + notesText(r3b).slice(0, 90))
  check('A5.11 R3 边界：evidence 恰为 8 字符时仍算合格（阈值是 < 8，不是 <= 8）',
    nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: longCrit, evidence: '12345678' }] }).blockingCount === 1)
  check('A5.12 R3 边界：evidence 7 字符时降级（差一个字符就该红）',
    nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: longCrit, evidence: '1234567' }] }).blockingCount === 0)
  check('A5.13 R3：降级后原文保留（evidence 不被清空，便于追查评审者到底说了什么）',
    r3b.findings[0].evidence === '短' && r3b.findings[0].criterion === longCrit)

  // R4 -- in a re-review only the PREVIOUS round's blocking items may block.
  const known = [longCrit]
  const r4new = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: '验收标准 AC-2 要求交付物提供回滚步骤', evidence: longEvid }] }, { round: 2, knownBlocking: known })
  check('A5.14 R4：复审(round=2)里的全新阻塞项降级为 advisory，blockingCount=0',
    r4new.findings[0].severity === 'advisory' && r4new.blockingCount === 0 && String(r4new.findings[0].downgradeReason).indexOf('R4') !== -1,
    'severity=' + String(r4new.findings[0].severity) + ' reason=' + String(r4new.findings[0].downgradeReason).slice(0, 80))
  check('A5.15 R4：本轮无既有阻塞项 -> R6 接力，verdict 归为 pass（返工不得无限续期）',
    r4new.verdict === 'pass' && notesText(r4new).indexOf('R6') !== -1, 'verdict=' + String(r4new.verdict))
  const r4known = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: '  ' + longCrit + '，。 ', evidence: longEvid }] }, { round: 2, knownBlocking: known })
  check('A5.16 R4：与上一轮同一条（仅标点/空白不同）保留为 blocking，blockingCount=1',
    r4known.findings[0].severity === 'blocking' && r4known.blockingCount === 1 && r4known.verdict === 'rework',
    'severity=' + String(r4known.findings[0].severity) + ' verdict=' + String(r4known.verdict))
  const r4first = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: '验收标准 AC-2 要求交付物提供回滚步骤', evidence: longEvid }] }, { round: 1, knownBlocking: known })
  check('A5.17 R4 边界：首轮(round=1)不受 R4 约束，全新阻塞项照常生效',
    r4first.blockingCount === 1 && r4first.verdict === 'rework', 'blocking=' + String(r4first.blockingCount))
  const r4noKnown = nr({ verdict: 'rework', score: 30, findings: [{ severity: 'blocking', criterion: longCrit, evidence: longEvid }] }, { round: 2, knownBlocking: [] })
  check('A5.18 R4 边界：复审但缺 knownBlocking（调度器没传上一轮项）时一律降级，宁可不返工',
    r4noKnown.blockingCount === 0)

  // R5 -- bound the payload.
  const many = { verdict: 'pass', score: 70, findings: [] }
  for (let i = 0; i < L.maxFindings + 5; i++) many.findings.push({ severity: 'advisory', criterion: 'advisory-' + i, evidence: 'evidence-' + i })
  const r5 = nr(many)
  check('A5.19 R5：findings 超过 ' + String(L.maxFindings) + ' 条时截断到上限',
    r5.findings.length === L.maxFindings && notesText(r5).indexOf('R5') !== -1,
    'findings=' + String(r5.findings.length) + ' notes=' + notesText(r5).slice(0, 80))
  check('A5.20 R5：保留的是前 N 条（顺序不得被重排）',
    r5.findings[0].criterion === 'advisory-0' && r5.findings[L.maxFindings - 1].criterion === 'advisory-' + String(L.maxFindings - 1))

  // R6 -- "rework" with nothing blocking is self-contradictory.
  const r6 = nr({ verdict: 'rework', score: 45, summary: '感觉不太行', findings: [{ severity: 'advisory', criterion: '风格可以更好', evidence: '整体文字偏口语化，建议更正式一些' }] })
  check('A5.21 R6：verdict=rework 但无阻塞项 -> 改判 pass，blockingCount=0，notes 指明 R6',
    r6.verdict === 'pass' && r6.blockingCount === 0 && notesText(r6).indexOf('R6') !== -1,
    'verdict=' + String(r6.verdict) + ' notes=' + notesText(r6).slice(0, 80))
  check('A5.22 R6：findings 为空数组时同样改判 pass（自相矛盾不得触发返工）',
    nr({ verdict: 'rework', score: 45, findings: [] }).verdict === 'pass')
  check('A5.23 R6：score 非法/缺失时不得凭分数制造返工（无阻塞项即 pass）',
    nr({ verdict: 'rework' }).verdict === 'pass')
  check('A5.24 正例：有合格阻塞项时 verdict=rework 保持不被改写，且无 R6 留痕',
    r2ok.verdict === 'rework' && notesText(r2ok).indexOf('R6') === -1)

  // cross-rule invariants + auditability
  const mixed = nr({ verdict: 'rework', score: 130.7, summary: '   ', findings: [{ severity: 'blocking', criterion: longCrit, evidence: longEvid }, { severity: 'CRITICAL', criterion: 'x', evidence: 'y' }] }, { round: 1 })
  check('A5.25 计数自洽：blockingCount + advisoryCount === findings.length',
    mixed.blockingCount + mixed.advisoryCount === mixed.findings.length,
    'blocking=' + String(mixed.blockingCount) + ' advisory=' + String(mixed.advisoryCount) + ' n=' + String(mixed.findings.length))
  check('A5.26 score 归一：130.7 -> 100（越界分不得原样透出）', mixed.score === 100, String(mixed.score))
  check('A5.27 空 summary 有兜底文案（缺摘要不得让页面出现空标题）',
    typeof mixed.summary === 'string' && mixed.summary.length > 0 && mixed.summary.indexOf('未提供摘要') !== -1, mixed.summary)
  check('A5.28 每次降级都留下可读的 notes（"降级但不说为什么"会让兜底无法审计）',
    mixed.notes.length >= 1 && mixed.notes.every((n) => typeof n === 'string' && n.length > 8), JSON.stringify(mixed.notes).slice(0, 160))
  check('A5.29 未降级时 notes 为空数组（不得无条件塞噪音）',
    Array.isArray(r2ok.notes) && r2ok.notes.length === 0, JSON.stringify(r2ok.notes))
  check('A5.30 返回值字段齐备（每一条都是后续 UI/数据面要读的键）',
    ['verdict', 'score', 'summary', 'findings', 'resolved', 'uncertainties', 'blockingCount', 'advisoryCount', 'notes'].every((k) => k in mixed),
    Object.keys(mixed).join(','))
  check('A5.31 resolved/uncertainties 缺省为空数组（旧数据没有这两个键）',
    eq(nr({ verdict: 'pass' }).resolved, []) && eq(nr({ verdict: 'pass' }).uncertainties, []))
  check('A5.32 resolved 条目被归一为 {finding,resolved,evidence} 形状',
    (() => { const r = nr({ verdict: 'pass', resolved: [{ criterion: 'C1', resolved: true, evidence: 'E1' }] }); return r.resolved.length === 1 && r.resolved[0].finding === 'C1' && r.resolved[0].resolved === true && r.resolved[0].evidence === 'E1' })())
}

// ===========================================================================
console.log('\n--- GROUP B/C: real host half mounted on a stub ctx ---')
// ---------------------------------------------------------------------------
// A stub `ctx` faithful enough to drive the real scheduler:
//  * storageDomain -- in-memory KV tables with the real put/get/entries/update
//    semantics (update must really run the callback: `transition` depends on
//    it), plus a journal so every state write is observable.
//  * subagents      -- records every dispatch and answers per scenario.
//  * webServer      -- captures the registered routes so /progress and /role
//    can be called through the REAL handlers.
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
      // The R8 repair call is labelled `<node>:review-repair`, so it must classify
      // as a reviewer call too -- otherwise a repair attempt looks like a worker
      // and a "how many reviewer calls happened" assertion silently undercounts.
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
  // Cordis `inject` hands the declared services over as ctx PROPERTIES, and the
  // plugin reads `ctx.storageDomain.open(...)` directly -- so the stub must
  // expose them both as properties and through ctx.get().
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
// The plugin warns on the two optional capabilities this stub does not provide
// (tools / llm). Silenced only around apply() so the suite's own output stays
// greppable; nothing about the plugin's behaviour is hidden.
const realWarn = console.warn
console.warn = () => {}
try { mod.apply(ctx) } finally { console.warn = realWarn }

const svc = captured.teamOrchestrator
check('BC.0 apply(ctx) 真的 provide 了 teamOrchestrator 且 runWorkflow 可调用（否则整组 B/C 无意义）',
  svc !== undefined && typeof svc.runWorkflow === 'function', typeof svc)
check('BC.0b 宿主注册了 /progress 与 /role 读接口（C 组要经真实 handler 取数）',
  webRoutes.has('/api/team-flowise/progress') && webRoutes.has('/api/team-flowise/role'),
  [...webRoutes.keys()].join(','))

const tableMap = (domain, table) => { const d = storage.stores.get(domain); return d === undefined ? undefined : d.get(table) }
const rec = (domain, table, key) => { const m = tableMap(domain, table); return m === undefined ? undefined : m.get(key) }
const allTasks = () => { const m = tableMap('team_ledger', 'tasks'); return m === undefined ? [] : [...m.values()] }
// Write a record straight into the in-memory domain, bypassing the plugin's
// own upsert path. Used to tell "the scheduler does not read wf.review" apart
// from "the write path never stores wf.review" (they are different defects).
function rawPut(domain, table, key, value) {
  if (!storage.stores.has(domain)) storage.stores.set(domain, new Map())
  const d = storage.stores.get(domain)
  if (!d.has(table)) d.set(table, new Map())
  d.get(table).set(key, value)
  return value
}
const flowsSchema = mod.workflowsDomain.tables.flows.valueSchema

async function callRoute(path, qs) {
  const handler = webRoutes.get(path)
  if (handler === undefined) throw new Error('no route ' + path)
  let status = 0
  let body = null
  const res = { writableEnded: false, writeHead(s) { status = s }, end(t) { this.writableEnded = true; body = t } }
  const req = { url: path + (qs ? '?' + qs : ''), method: 'GET', socket: { remoteAddress: '127.0.0.1' } }
  await handler(req, res)
  let json = null
  try { json = body === null ? null : JSON.parse(body) } catch { /* non-JSON */ }
  return { status, json, raw: body }
}

let seq = 0
async function scenario(name, nodes, wfExtra, plan, opts) {
  const calls = []
  subagentsStub = makeSubagentsStub(calls, plan)
  const wfId = 'wf-p10c-' + String(++seq) + '-' + name
  if (opts && opts.raw) rawPut('team_workflows', 'flows', wfId, Object.assign({ id: wfId, name: wfId, nodes, updatedAt: Date.now() }, wfExtra || {}))
  else await svc.upsertWorkflow(Object.assign({ id: wfId, name: wfId, nodes }, wfExtra || {}))
  const mark = storage.journal.length
  const out = await withLimit(svc.runWorkflow(wfId, {}, undefined), 20000, 'scenario ' + name)
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

// ---------------------------------------------------------------------------
// B1. No reviewer declared => byte-for-byte the pre-P10 behaviour.
// ---------------------------------------------------------------------------
console.log('\n[B1] 场景 1：节点无 reviewer')
try {
  const s = await scenario('no-reviewer', { n1: node('n1') }, null, () => ({ text: 'WORKER-OUT-1' }))
  const st = s.run.nodeStates.n1
  check('B1.1 无 reviewer 时节点照常 completed 并留下产出',
    st.status === 'completed' && typeof st.output === 'string' && st.output.indexOf('WORKER-OUT-1') !== -1, JSON.stringify({ status: st.status, output: st.output }))
  check('B1.2 无 reviewer 时 nodeStates 里不得出现 review 键（写了就是凭空多出一个字段）',
    !('review' in st), Object.keys(st).join(','))
  check('B1.3 无 reviewer 时只派发 1 次 worker、0 次评审',
    s.workers.length === 1 && s.reviewers.length === 0, 'workers=' + String(s.workers.length) + ' reviewers=' + String(s.reviewers.length))
  check('B1.4 无 reviewer 时状态序列与改动前一致：working -> completed（没有 reviewing 中间态）',
    statusSeq(s.writes, 'n1').join('>') === 'working>completed', statusSeq(s.writes, 'n1').join('>'))
  check('B1.5 无 reviewer 时运行整体 completed，且 result.reviews 为空对象',
    s.status === 'completed' && s.run.status === 'completed' && s.run.result && Object.keys(s.run.result.reviews || {}).length === 0,
    JSON.stringify({ status: s.status, reviews: s.run.result && s.run.result.reviews }))
  check('B1.6 无 reviewer 时进度数据面报 review=null、reviewers=[]（旧 run 记录同待遇）',
    (await (async () => { const p = await callRoute('/api/team-flowise/progress', 'runId=' + s.runId); const n = (p.json.nodes || [])[0] || {}; return n.review === null && eq(p.json.reviewers, []) })()))
  check('B1.7 [记录现状/偏差 O1] 无 reviewer 时任务台账的 reviewer 字段是空串（改动前该键不存在）',
    s.tasks.length === 1 && s.tasks[0].reviewer === '', JSON.stringify(s.tasks[0] && s.tasks[0].reviewer))
} catch (e) { blockFailure('B1 场景 1（无 reviewer）', e) }

// ---------------------------------------------------------------------------
// B2. Reviewer returns pass => node completed, verdict pass, 0 blocking.
// ---------------------------------------------------------------------------
console.log('\n[B2] 场景 2：评审者返回 pass')
try {
  const s = await scenario('review-pass', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer' ? { text: verdictJson({ verdict: 'pass', findings: [advisoryFinding()] }) } : { text: 'WORKER-OUT-2' }))
  const st = s.run.nodeStates.n1
  const rv = st.review || {}
  check('B2.1 节点 completed 且 review 记录存在', st.status === 'completed' && typeof st.review === 'object' && st.review !== null, JSON.stringify(st.review))
  check('B2.2 review.verdict === "pass"', rv.verdict === 'pass', String(rv.verdict))
  check('B2.3 review.blockingCount === 0（advisory 不得被计成阻塞）', rv.blockingCount === 0, String(rv.blockingCount))
  check('B2.4 review.rounds === 1 且 unresolved === false（首轮通过不该标未闭合）',
    rv.rounds === 1 && rv.unresolved === false, 'rounds=' + String(rv.rounds) + ' unresolved=' + String(rv.unresolved))
  check('B2.5 review.reviewerName / reviewer 记录为规范化后的评审者名', rv.reviewerName === 'Reviewer' && rv.reviewer === 'Reviewer', String(rv.reviewerName))
  check('B2.6 advisory 发现项被保留且 severity 为 advisory（建议不得被丢掉）',
    Array.isArray(rv.findings) && rv.findings.length === 1 && rv.findings[0].severity === 'advisory', JSON.stringify(rv.findings))
  check('B2.7 worker 1 次 / 评审 1 次，且评审者 label 是 <node>:review（评审是一次独立子代理调用）',
    s.workers.length === 1 && s.reviewers.length === 1 && s.reviewers[0].label === 'n1:review',
    'workers=' + String(s.workers.length) + ' reviewers=' + String(s.reviewers.length) + ' label=' + String(s.reviewers[0] && s.reviewers[0].label))
  check('B2.8 状态序列 working>reviewing>completed：评审真的插在派发与完成之间',
    statusSeq(s.writes, 'n1').join('>') === 'working>reviewing>completed', statusSeq(s.writes, 'n1').join('>'))
  check('B2.9 运行整体 completed', s.status === 'completed' && s.run.status === 'completed', String(s.run.status))
  check('B2.10 落库的 run 记录能通过 runs 域的 zod 校验（域重新打开时会校验，形状错就爆）',
    mod.runsDomain.tables.runs.valueSchema.safeParse(s.run).success)
  check('B2.11 落库的任务记录能通过 tasks 域的 zod 校验',
    s.tasks.length === 1 && mod.taskLedgerDomain.tables.tasks.valueSchema.safeParse(s.tasks[0]).success)
  check('B2.12 评审提示词里带上被审节点的验收标准（评审者必须知道验收口径）',
    s.reviewers[0].prompt.indexOf('A-n1') !== -1)
} catch (e) { blockFailure('B2 场景 2（评审 pass）', e) }

// ---------------------------------------------------------------------------
// B3. One qualified blocking item -> rework -> pass on re-review. This is the
//     only scenario that proves the rework loop reuses the existing task state
//     machine and that the second dispatch carries the blocking items.
// ---------------------------------------------------------------------------
console.log('\n[B3] 场景 3：一条合规 blocking -> 返工 -> 复审 pass')
try {
  let attempt = 0
  const s = await scenario('rework-then-pass', { n1: node('n1', { reviewer: 'Reviewer' }) }, null, (c) => {
    if (c.role === 'reviewer') {
      return { text: c.round >= 2
        ? verdictJson({ verdict: 'pass', score: 85, findings: [], resolved: [{ finding: BLOCK_CRIT, resolved: true, evidence: 'v2 第 3 行' }] })
        : verdictJson({ verdict: 'rework', score: 40, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
    }
    attempt += 1
    return { text: 'WORKER-ATTEMPT-' + String(attempt) }
  })
  const st = s.run.nodeStates.n1
  const rv = st.review || {}
  check('B3.1 worker 被派发 2 次（返工真的重新派发了工人）', s.workers.length === 2, 'workers=' + String(s.workers.length))
  check('B3.2 评审被派发 2 次（首轮 + 复审）', s.reviewers.length === 2, 'reviewers=' + String(s.reviewers.length))
  check('B3.3 节点最终 completed 且 review.verdict === "pass"',
    st.status === 'completed' && rv.verdict === 'pass', JSON.stringify({ status: st.status, verdict: rv.verdict }))
  check('B3.4 review.rounds === 2（记录的结论来自第二版产物的评审）', rv.rounds === 2, String(rv.rounds))
  check('B3.5 第二次 worker 派发的 prompt 含 blocking 的 criterion 原文（返工提示词带着阻塞项）',
    s.workers[1].prompt.indexOf(BLOCK_CRIT) !== -1)
  check('B3.6 第二次 worker 派发的 prompt 含 blocking 的 evidence 原文', s.workers[1].prompt.indexOf(BLOCK_EVID) !== -1)
  check('B3.7 第二次 worker 派发的 prompt 含"不得扩大改动范围"（返工不得变成重构）',
    s.workers[1].prompt.indexOf('不得扩大改动范围') !== -1)
  check('B3.8 第一次 worker 派发的 prompt 不含返工约束（首轮就是普通派发）',
    s.workers[0].prompt.indexOf('不得扩大改动范围') === -1)
  check('B3.9 复审 prompt 含上一轮的 criterion（knownBlocking 真的传下去了）',
    s.reviewers[1].prompt.indexOf(BLOCK_CRIT) !== -1 && s.reviewers[1].round === 2,
    'round=' + String(s.reviewers[1].round))
  check('B3.10 任务台账 iteration >= 1（走的是既有 completed->reworked 状态机）',
    s.tasks.length === 1 && s.tasks[0].iteration >= 1, 'iteration=' + String(s.tasks[0] && s.tasks[0].iteration))
  check('B3.11 history 记录了返工反馈，且反馈里带着 blocking 的 criterion',
    Array.isArray(s.tasks[0].history) && s.tasks[0].history.length >= 1 && s.tasks[0].history[0].status === 'reworked' &&
    typeof s.tasks[0].history[0].feedback === 'string' && s.tasks[0].history[0].feedback.indexOf(BLOCK_CRIT) !== -1,
    JSON.stringify(s.tasks[0].history))
  check('B3.12 一个节点一辈子只有一个任务（不是每次尝试新建任务）', s.tasks.length === 1)
  check('B3.13 状态序列 working>reviewing>rework>working>reviewing>completed',
    statusSeq(s.writes, 'n1').join('>') === 'working>reviewing>rework>working>reviewing>completed', statusSeq(s.writes, 'n1').join('>'))
  check('B3.14 会话最终仍落回既有终态：任务 completed、运行 completed',
    s.tasks[0].status === 'completed' && s.run.status === 'completed', 'task=' + String(s.tasks[0].status))
  check('B3.15 resolved 回应被记录进 review（复审对上一轮阻塞项的逐条回应）',
    Array.isArray(rv.resolved) && rv.resolved.length === 1 && rv.resolved[0].resolved === true, JSON.stringify(rv.resolved))
} catch (e) { blockFailure('B3 场景 3（返工后通过）', e) }

// ---------------------------------------------------------------------------
// B4. Reviewer keeps blocking => the node cap must stop the loop. The objective
//     assertion is the worker dispatch COUNT, not the reviewer's opinion.
// ---------------------------------------------------------------------------
console.log('\n[B4] 场景 4：连续 blocking 触到单节点上限')
try {
  const s = await scenario('node-cap', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 30, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'WORKER-STILL-BROKEN' }))
  const st = s.run.nodeStates.n1
  const rv = st.review || {}
  const cap = L.maxReworkPerNode
  check('B4.1 worker 派发次数 === maxReworkPerNode + 1 === ' + String(cap + 1) + '（硬上界，超一次即为缺陷）',
    s.workers.length === cap + 1, 'workers=' + String(s.workers.length))
  check('B4.2 实际返工轮数 === maxReworkPerNode === ' + String(cap), s.workers.length - 1 === cap, String(s.workers.length - 1))
  check('B4.3 触顶后节点仍然 completed（产物存在，不是 failed）', st.status === 'completed', String(st.status))
  check('B4.4 review.unresolved === true（明确标记"阻塞项未解决，需人工介入"）', rv.unresolved === true, String(rv.unresolved))
  check('B4.5 unresolvedReason 写明触顶原因（含 单节点返工上限 与 maxReworkPerNode=' + String(cap) + '）',
    typeof rv.unresolvedReason === 'string' && rv.unresolvedReason.indexOf('单节点返工上限') !== -1 && rv.unresolvedReason.indexOf('maxReworkPerNode=' + String(cap)) !== -1,
    String(rv.unresolvedReason))
  check('B4.6 review.verdict 保持 "rework"（触顶不得被悄悄改写成 pass 而不留痕）', rv.verdict === 'rework', String(rv.verdict))
  check('B4.7 状态序列里 rework 恰好出现 ' + String(cap) + ' 次',
    statusSeq(s.writes, 'n1').filter((x) => x === 'rework').length === cap, statusSeq(s.writes, 'n1').join('>'))
  check('B4.8 触顶不把整次运行拖成 failed', s.status === 'completed' && s.run.status === 'completed', String(s.run.status))
  check('B4.9 复审里的同一条 criterion 未被 R4 误降级（最终 blockingCount 仍为 1）', rv.blockingCount === 1, String(rv.blockingCount))
  check('B4.10 评审总次数 === worker 派发次数（每版产物都评了一次）', s.reviewers.length === s.workers.length, String(s.reviewers.length))
} catch (e) { blockFailure('B4 场景 4（单节点上限）', e) }

// ---------------------------------------------------------------------------
// B5. verdict=rework with zero blocking => R6 must refuse the rework.
// ---------------------------------------------------------------------------
console.log('\n[B5] 场景 5：rework 但全是 advisory')
try {
  const s = await scenario('rework-no-blocking', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 35, summary: '感觉不太行', findings: [advisoryFinding()] }) }
      : { text: 'WORKER-ONCE' }))
  const st = s.run.nodeStates.n1
  const rv = st.review || {}
  check('B5.1 worker 只被派发 1 次（拒绝返工，任务不得被拉长）', s.workers.length === 1, 'workers=' + String(s.workers.length))
  check('B5.2 review.verdict 最终为 "pass"（自相矛盾的结论被改判）', rv.verdict === 'pass', String(rv.verdict))
  check('B5.3 review.blockingCount === 0', rv.blockingCount === 0, String(rv.blockingCount))
  check('B5.4 review.notes 里留下 R6 留痕（改判必须可审计）',
    Array.isArray(rv.notes) && rv.notes.join(' ').indexOf('R6') !== -1, JSON.stringify(rv.notes))
  check('B5.5 建议项仍被保留下来（拒绝返工不等于丢弃意见）',
    Array.isArray(rv.findings) && rv.findings.length === 1 && rv.findings[0].severity === 'advisory', JSON.stringify(rv.findings))
  check('B5.6 状态序列里不出现 rework / need_rework', statusSeq(s.writes, 'n1').join('>').indexOf('rework') === -1, statusSeq(s.writes, 'n1').join('>'))
  check('B5.7 评审只被派发 1 次，节点 completed', s.reviewers.length === 1 && st.status === 'completed', String(st.status))
} catch (e) { blockFailure('B5 场景 5（rework 无阻塞项）', e) }

// ---------------------------------------------------------------------------
// B6. A broken reviewer never breaks the node or the run.
// ---------------------------------------------------------------------------
console.log('\n[B6] 场景 6：评审者抛错 / 超时 / 非正常停止 / 非 JSON')
try {
  const cases = [
    ['a 评审者启动即抛错', () => ({ startError: 'stub: reviewer transport exploded' }), 'exploded'],
    ['b 评审者超时（withTimeout 守卫拒绝）', () => ({ resultError: 'team-flowise: review of node n1 timed out after ' + String(L.timeoutMs) + 'ms' }), 'timed out'],
    ['c 评审者非正常停止 stopReason=length', () => ({ text: '{"verdict":"pa', stopReason: 'length' }), 'length'],
    ['d 评审者返回完全非 JSON', () => ({ text: '这份方案我看行，给 90 分。' }), ''],
  ]
  for (const [label, mk, marker] of cases) {
    const s = await scenario('review-error-' + label.slice(0, 1), { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
      (c) => (c.role === 'reviewer' ? mk() : { text: 'WORKER-OK' }))
    const st = s.run.nodeStates.n1
    const rv = st.review || {}
    check('B6.1(' + label + ') 节点仍 completed，review.verdict === "error"',
      st.status === 'completed' && rv.verdict === 'error', JSON.stringify({ status: st.status, verdict: rv.verdict }))
    check('B6.2(' + label + ') worker 只派发 1 次、blockingCount=0（坏评审者不得触发返工）',
      s.workers.length === 1 && rv.blockingCount === 0, 'workers=' + String(s.workers.length) + ' blocking=' + String(rv.blockingCount))
    check('B6.3(' + label + ') 运行整体 completed，不 failed、不挂起（已用 20s 超时护栏兜住挂起）',
      s.status === 'completed' && s.run.status === 'completed' && s.run.endedAt !== undefined, JSON.stringify({ status: s.run.status, endedAt: s.run.endedAt }))
    check('B6.4(' + label + ') 评审异常被记录成数据而不是异常（error / parseError 之一带上原文）',
      (() => {
        const detail = rv.error !== null && rv.error !== undefined ? String(rv.error) : (rv.parseError === null || rv.parseError === undefined ? '' : String(rv.parseError))
        return detail.length > 0 && (marker === '' || detail.indexOf(marker) !== -1)
      })(), String(rv.error !== null && rv.error !== undefined ? rv.error : rv.parseError).slice(0, 90))
  }
  const s6d = await scenario('review-error-nonjson-detail', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer' ? { text: '这份方案我看行，给 90 分。' } : { text: 'WORKER-OK' }))
  const rv6d = s6d.run.nodeStates.n1.review || {}
  check('B6.5(非 JSON) summary 明写"未经实质评审"，UI 才有依据把它标出来',
    typeof rv6d.summary === 'string' && rv6d.summary.indexOf('未经实质评审') !== -1, String(rv6d.summary))
  check('B6.6(非 JSON) notes 里带 R1 留痕与 parseError 原因',
    Array.isArray(rv6d.notes) && rv6d.notes.join(' ').indexOf('R1') !== -1, JSON.stringify(rv6d.notes))
} catch (e) { blockFailure('B6 场景 6（评审者故障）', e) }

// ---------------------------------------------------------------------------
// B7. Run-level rework budget: three nodes all want a rework; the run total is
//     the master gate. Asserted by the TOTAL worker dispatch count.
// ---------------------------------------------------------------------------
console.log('\n[B7] 场景 7：整次运行的返工总闸')
try {
  const nodes7 = { a: node('a', { reviewer: 'Reviewer' }), b: node('b', { reviewer: 'Reviewer' }), c: node('c', { reviewer: 'Reviewer' }) }
  const s = await scenario('run-budget', nodes7, null,
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 20, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'WORKER-BROKEN' }))
  const perNode = Object.keys(s.run.nodeStates).map((id) => id + '=' + String(s.workers.filter((w) => w.nodeId === id).length)).join(' ')
  const totalRework = s.workers.length - Object.keys(nodes7).length
  check('B7.1 worker 总派发次数 === 节点数 + maxReworkPerRun === ' + String(3 + L.maxReworkPerRun) + '（总时长上界的唯一可执行证据）',
    s.workers.length === 3 + L.maxReworkPerRun, 'workers=' + String(s.workers.length) + ' 分布[' + perNode + ']')
  check('B7.2 整次运行实际返工轮数 === maxReworkPerRun === ' + String(L.maxReworkPerRun),
    totalRework === L.maxReworkPerRun, 'rework=' + String(totalRework))
  check('B7.3 任一单节点的返工次数都不超过 maxReworkPerNode', Object.keys(nodes7).every((id) => s.workers.filter((w) => w.nodeId === id).length - 1 <= L.maxReworkPerNode), perNode)
  check('B7.4 三个节点全部 completed（预算耗尽不等于节点失败）',
    Object.keys(nodes7).every((id) => s.run.nodeStates[id].status === 'completed'),
    Object.keys(nodes7).map((id) => id + ':' + s.run.nodeStates[id].status).join(' '))
  check('B7.5 每个节点的 unresolvedReason 都写明是整轮预算触顶（maxReworkPerRun=' + String(L.maxReworkPerRun) + '）',
    Object.keys(nodes7).every((id) => {
      const rv = s.run.nodeStates[id].review || {}
      return rv.unresolved === true && typeof rv.unresolvedReason === 'string' && rv.unresolvedReason.indexOf('maxReworkPerRun=' + String(L.maxReworkPerRun)) !== -1
    }),
    Object.keys(nodes7).map((id) => String((s.run.nodeStates[id].review || {}).unresolvedReason).slice(0, 44)).join(' // '))
  check('B7.6 三个节点全部 unresolved=true（没有任何一个被悄悄放行成 pass）',
    Object.keys(nodes7).every((id) => (s.run.nodeStates[id].review || {}).unresolved === true))
  check('B7.7 运行整体 completed 且不是 failed/interrupted', s.status === 'completed' && s.run.status === 'completed', String(s.run.status))
  check('B7.8 评审总次数 === worker 总次数（每版产物都评过）', s.reviewers.length === s.workers.length, String(s.reviewers.length))
  check('B7.9 三条独立节点的第一轮都拿到了返工额度（不是被某一个节点独吞）',
    Object.keys(nodes7).every((id) => s.workers.filter((w) => w.nodeId === id).length >= 1))
} catch (e) { blockFailure('B7 场景 7（整轮预算）', e) }

// ---------------------------------------------------------------------------
// B8/B9. Workflow-level review settings: inheritance, the (unread) `enabled`
//        flag, and the node/workflow maxRework clamp.
// ---------------------------------------------------------------------------
console.log('\n[B8/B9] 场景 8/9：工作流级 review 设置与 maxRework 收紧')
try {
  // The scheduler-side logic is probed with a RAW-seeded workflow record, so
  // that "does the scheduler read wf.review" is separated from "does the write
  // path ever store wf.review" (the latter is defect D3, asserted separately).
  const s8 = await scenario('wf-review-inherit', { n1: node('n1') }, { review: { reviewer: 'Reviewer' } },
    (c) => (c.role === 'reviewer' ? { text: verdictJson({ verdict: 'pass' }) } : { text: 'W' }), { raw: true })
  check('B8.1 记录里有 wf.review.reviewer 时，未声明 reviewer 的节点继承并真的评审',
    s8.reviewers.length === 1 && (s8.run.nodeStates.n1.review || {}).verdict === 'pass',
    'reviewers=' + String(s8.reviewers.length) + ' verdict=' + String((s8.run.nodeStates.n1.review || {}).verdict))
  // D3 fix: `enabled:false` is the workflow-level OFF switch and must actually
  // switch the default off. (A node naming its own reviewer still wins -- that
  // precedence is covered by B9.4/B9.6, which declare a reviewer on the node.)
  const s8off = await scenario('wf-review-disabled', { n1: node('n1') }, { review: { reviewer: 'Reviewer', enabled: false } },
    (c) => (c.role === 'reviewer' ? { text: verdictJson({ verdict: 'pass' }) } : { text: 'W' }), { raw: true })
  check('B8.2 review.enabled=false 关闭工作流级默认评审：不派发评审者、节点无 review 记录',
    s8off.reviewers.length === 0 && !('review' in s8off.run.nodeStates.n1),
    'reviewers=' + String(s8off.reviewers.length))
  // D3 fix: `review` must survive the ONLY write path (upsertWorkflow). While it
  // was dropped, no workflow created through the real API or the
  // team_create_workflow tool could ever enable supervision.
  const d3 = await svc.upsertWorkflow({ id: 'wf-p10c-d3', name: 'd3', nodes: { n1: node('n1') }, review: { reviewer: 'Reviewer', maxRework: 0, enabled: false } })
  const d3stored = rec('team_workflows', 'flows', 'wf-p10c-d3') || {}
  check('B8.3 upsertWorkflow 保留工作流级 review 字段（唯一写路径不得丢弃它）',
    d3 !== null && d3.review !== undefined && d3stored.review !== undefined && d3stored.review.reviewer === 'Reviewer' && d3stored.review.maxRework === 0,
    'stored review=' + JSON.stringify(d3stored.review))
  const s8d3 = await scenario('wf-review-persisted', { n1: node('n1') }, { review: { reviewer: 'Reviewer' } },
    (c) => (c.role === 'reviewer' ? { text: verdictJson({ verdict: 'pass' }) } : { text: 'W' }))
  check('B8.4 经 upsertWorkflow 写入的工作流级 reviewer 真的派发评审（写入面到调度面已打通）',
    s8d3.reviewers.length === 1 && (s8d3.run.nodeStates.n1.review || {}).verdict === 'pass',
    'reviewers=' + String(s8d3.reviewers.length))
  check('B8.5 schema 本身接受 review.reviewer / maxRework / enabled（问题只在上层没把 review 传进 parse）',
    flowsSchema.safeParse({ id: 'x', nodes: {}, review: { reviewer: 'R', maxRework: 1, enabled: false }, updatedAt: 1 }).success)
  const s9 = await scenario('wf-maxrework-zero', { n1: node('n1') }, { review: { reviewer: 'Reviewer', maxRework: 0 } },
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 10, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'W' }), { raw: true })
  const rv9 = s9.run.nodeStates.n1.review || {}
  check('B9.1 工作流级 maxRework=0 时首次 blocking 即触顶：worker 只派发 1 次、不返工',
    s9.workers.length === 1, 'workers=' + String(s9.workers.length))
  check('B9.2 unresolvedReason 写明单节点上限为 0（工作流级声明真的被读到并生效）',
    typeof rv9.unresolvedReason === 'string' && rv9.unresolvedReason.indexOf('maxReworkPerNode=0') !== -1, String(rv9.unresolvedReason))
  check('B9.3 该节点仍 completed，运行 completed',
    s9.run.nodeStates.n1.status === 'completed' && s9.run.status === 'completed', String(s9.run.status))
  const s9c = await scenario('node-maxrework-raise', { n1: node('n1', { reviewer: 'Reviewer', maxRework: 5 }) }, null,
    (c) => (c.role === 'reviewer'
      ? { text: verdictJson({ verdict: 'rework', score: 10, findings: [blockingFinding(BLOCK_CRIT, BLOCK_EVID)] }) }
      : { text: 'W' }))
  check('B9.4 节点声明 maxRework=5 只能被硬上界收紧：worker 仍只派发 maxReworkPerNode+1 === ' + String(L.maxReworkPerNode + 1) + ' 次',
    s9c.workers.length === L.maxReworkPerNode + 1, 'workers=' + String(s9c.workers.length))
  check('B9.5 节点声明 maxRework=5 时 unresolvedReason 里的上限仍是硬上界 ' + String(L.maxReworkPerNode),
    String((s9c.run.nodeStates.n1.review || {}).unresolvedReason).indexOf('maxReworkPerNode=' + String(L.maxReworkPerNode)) !== -1,
    String((s9c.run.nodeStates.n1.review || {}).unresolvedReason).slice(0, 80))
  const s9d = await scenario('wf-review-absent', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer' ? { text: verdictJson({ verdict: 'pass' }) } : { text: 'W' }))
  check('B9.6 无工作流级 review 时按硬上界默认生效（缺省不等于无界）',
    s9d.workers.length === 1 && s9d.run.status === 'completed', 'workers=' + String(s9d.workers.length))
  check('B9.7 schema 拒绝越界的 review.maxRework=99（越界声明不得静默生效）',
    !flowsSchema.safeParse({ id: 'x', nodes: {}, review: { reviewer: 'R', maxRework: 99 }, updatedAt: 1 }).success)
  check('B9.8 schema 拒绝 review.maxRework=-1（负返工次数无意义）',
    !flowsSchema.safeParse({ id: 'x', nodes: {}, review: { reviewer: 'R', maxRework: -1 }, updatedAt: 1 }).success)
} catch (e) { blockFailure('B8/B9 场景 8/9（工作流级设置）', e) }

// ===========================================================================
// GROUP C: the read plane, driven through the REAL route handlers.
// ---------------------------------------------------------------------------
console.log('\n--- GROUP C: /progress 与 /role 读接口 ---')
const CWF = 'wf-p10c-fixture'
const CRUN = 'run-p10c-fixture'
const T0 = Date.now() - 600000
let prog = null
try {
  await svc.upsertWorkflow({
    id: CWF, name: 'P10-C 夹具工作流',
    nodes: {
      a: { id: 'a', title: '方案', agent: 'Planner', reviewer: 'Reviewer', dependsOn: [], taskTemplate: { requirement: 'REQ-A', acceptanceCriteria: 'AC-A' } },
      b: { id: 'b', title: '实现', agent: 'Coder', reviewer: 'Reviewer', dependsOn: ['a'], taskTemplate: { requirement: 'REQ-B', acceptanceCriteria: 'AC-B' } },
      c: { id: 'c', title: '加固', agent: 'Coder', reviewer: 'Auditor', dependsOn: ['b'], taskTemplate: { requirement: 'REQ-C', acceptanceCriteria: 'AC-C' } },
      d: { id: 'd', title: '验收', agent: 'Tester', reviewer: 'Coder', dependsOn: ['c'], taskTemplate: { requirement: 'REQ-D', acceptanceCriteria: 'AC-D' } },
      e: { id: 'e', title: '文档', reviewer: 'Reviewer2', dependsOn: ['d'], taskTemplate: { requirement: 'REQ-E', acceptanceCriteria: 'AC-E' } },
    },
  })
  const rvOf = (o) => Object.assign({
    reviewer: null, reviewerName: null, verdict: null, score: null, summary: null,
    findings: [], resolved: [], uncertainties: [], notes: [],
    blockingCount: 0, advisoryCount: 0, rounds: 1, unresolved: false, unresolvedReason: null,
    elapsedMs: 0, error: null, parseError: null,
  }, o)
  const cstates = {
    a: { status: 'completed', assignee: 'Planner', startedAt: T0, endedAt: T0 + 60000, summary: '方案已交付',
      review: rvOf({ reviewer: 'Reviewer', reviewerName: 'Reviewer', verdict: 'pass', score: 88, summary: 'A 通过', blockingCount: 0, advisoryCount: 1, elapsedMs: 1000,
        findings: [{ severity: 'advisory', dimension: '优化空间', criterion: null, evidence: '第 2 段可删', impact: null, suggestion: '删除', downgraded: false, downgradeReason: null }],
        uncertainties: ['未确认并发下的扣减顺序'] }) },
    b: { status: 'reviewing', assignee: 'Coder', startedAt: T0 + 60000,
      review: rvOf({ reviewer: 'Reviewer', reviewerName: 'Reviewer', verdict: 'rework', score: 42, summary: 'B 必须返工', blockingCount: 1, advisoryCount: 2, elapsedMs: 2000,
        findings: [{ severity: 'blocking', dimension: '正确性', criterion: 'AC-B 未满足', evidence: '产物第 3 行只写了"已验证"', impact: '无法验收', suggestion: '补命令', downgraded: false, downgradeReason: null }] }) },
    c: { status: 'rework', assignee: 'Coder', startedAt: T0 + 120000,
      review: rvOf({ reviewer: 'Auditor', reviewerName: 'Auditor', verdict: 'rework', score: 30, summary: 'C 仍未修好', blockingCount: 2, advisoryCount: 0, rounds: 3, unresolved: true,
        unresolvedReason: '已达单节点返工上限（maxReworkPerNode=2 轮，已用 2 轮），不再返工。', elapsedMs: 3000 }) },
    d: { status: 'failed', assignee: 'Tester', startedAt: T0 + 180000, endedAt: T0 + 190000, error: 'T-ERROR',
      review: rvOf({ reviewer: 'Coder', reviewerName: 'Coder', verdict: 'error', summary: '评审未生效', elapsedMs: 500, error: 'reviewer transport exploded' }) },
  }
  rawPut('team_runs', 'runs', CRUN, { id: CRUN, workflowId: CWF, status: 'running', nodeStates: cstates, startedAt: T0 })
  prog = await callRoute('/api/team-flowise/progress', 'runId=' + CRUN)
  const p = prog.json || {}
  const to = p.totals || {}
  const byId = {}
  for (const n of p.nodes || []) byId[n.id] = n

  check('C8.1 /progress 经真实 handler 返回 ok:true 与本次 run', prog.status === 200 && p.ok === true && (p.run || {}).id === CRUN, 'status=' + String(prog.status))
  check('C8.2 totals 六项守恒（含新增的 reviewing/rework）',
    (to.completed || 0) + (to.failed || 0) + (to.working || 0) + (to.reviewing || 0) + (to.rework || 0) + (to.pending || 0) === to.total,
    JSON.stringify(to))
  check('C8.3 正在评审的节点计入 reviewing，不得被算进 pending（方向性错误，不是误差）',
    to.reviewing === 1 && to.pending === 1, JSON.stringify({ reviewing: to.reviewing, pending: to.pending }))
  check('C8.4 返工中的节点计入 rework，不得被算进 pending',
    to.rework === 1 && to.pending === 1, JSON.stringify({ rework: to.rework, pending: to.pending }))
  check('C8.5 percent 口径未变：仍只按 completed/total 计算（1/5 -> 20）',
    to.percent === 20, 'percent=' + String(to.percent))
  check('C8.6 totals.total === nodes.length', to.total === (p.nodes || []).length, String(to.total))
  check('C8.7 totals.unresolved 统计未闭合节点数（1 个）', to.unresolved === 1, String(to.unresolved))
  const rollUpNames = (p.roles || []).map((r) => r.name).sort()
  const nodeNames = [...new Set((p.nodes || []).map((n) => (n.agentName === null ? '(未指派)' : n.agentName)))].sort()
  check('C8.8 roles 名字集合仍然恰好等于节点负责人集合（既有断言口径，不许放宽）',
    rollUpNames.length === nodeNames.length && nodeNames.every((x) => rollUpNames.includes(x)),
    'roles=' + JSON.stringify(rollUpNames) + ' nodes=' + JSON.stringify(nodeNames))
  check('C8.9 roles 的 total 之和 === nodes.length', (p.roles || []).reduce((a, r) => a + (r.total || 0), 0) === (p.nodes || []).length, JSON.stringify(p.roles))
  check('C8.10 逐角色分桶正确（Coder: reviewing 1 / rework 1，两者都不落 pending）',
    (() => {
      const c = (p.roles || []).find((r) => r.name === 'Coder')
      return c !== undefined && c.total === 2 && c.reviewing === 1 && c.rework === 1 && c.pending === 0 && c.completed === 0
    })(), JSON.stringify((p.roles || []).find((r) => r.name === 'Coder')))
  check('C8.11 评审者绝不出现在 roles 里（它是监督者，不占 DAG 泳道）',
    rollUpNames.indexOf('Reviewer') === -1 && rollUpNames.indexOf('Auditor') === -1 && rollUpNames.indexOf('Reviewer2') === -1,
    JSON.stringify(rollUpNames))
  const wantReviewers = [
    { name: 'Reviewer', reviewed: 2, pass: 1, rework: 1, error: 0, blocking: 1, advisory: 3, unresolved: 0, elapsedMs: 3000 },
    { name: 'Auditor', reviewed: 1, pass: 0, rework: 1, error: 0, blocking: 2, advisory: 0, unresolved: 1, elapsedMs: 3000 },
    { name: 'Coder', reviewed: 1, pass: 0, rework: 0, error: 1, blocking: 0, advisory: 0, unresolved: 0, elapsedMs: 500 },
    { name: 'Reviewer2', reviewed: 0, pass: 0, rework: 0, error: 0, blocking: 0, advisory: 0, unresolved: 0, elapsedMs: 0 },
  ]
  check('C8.12 reviewers 聚合数字与由桩数据推出的期望完全一致（含 pass/rework/error/均分口径）',
    eq(p.reviewers, wantReviewers), 'actual=' + JSON.stringify(p.reviewers))
  check('C8.13 声明了 reviewer 但尚无评审记录的节点计 0 次评审（不得虚报通过）',
    (() => { const r = (p.reviewers || []).find((x) => x.name === 'Reviewer2'); return r !== undefined && r.reviewed === 0 && r.pass === 0 && r.rework === 0 })())
  check('C8.14 节点 review 是 8 键轻投影（/progress 是 3 秒轮询，不得带 findings 全量）',
    eq(Object.keys(byId.a.review).sort(), ['advisory', 'blocking', 'elapsedMs', 'reviewerName', 'rounds', 'summary', 'unresolved', 'verdict']),
    Object.keys(byId.a.review || {}).join(','))
  check('C8.15 无评审的节点 review 为 null（旧 run 记录同待遇）', byId.e.review === null, JSON.stringify(byId.e.review))
  check('C8.16 节点级 reviewer 字段仍输出定义里的评审者名，且未被混进 agent/agentName',
    byId.b.reviewer === 'Reviewer' && byId.b.agentName === 'Coder', JSON.stringify({ reviewer: byId.b.reviewer, agentName: byId.b.agentName }))
  check('C8.17 每个节点的 review.reviewerName 与 def.reviewer 的规范化名一致',
    byId.a.review.reviewerName === 'Reviewer' && byId.c.review.reviewerName === 'Auditor' && byId.d.review.reviewerName === 'Coder')
  check('C8.18 reviews 轻投影保留 unresolved/unresolvedReason 之外的布尔与轮数（C 节点 unresolved=true, rounds=3）',
    byId.c.review.unresolved === true && byId.c.review.rounds === 3 && byId.a.review.rounds === 1,
    JSON.stringify(byId.c.review))
  // This is the objective reason p8-acceptance.mjs:483 HAD to grow from four
  // buckets to six: with the old four-term sum this very payload does not
  // conserve, so a live run in `reviewing`/`rework` would report a bogus FAIL.
  const oldFourTerm = (to.completed || 0) + (to.failed || 0) + (to.working || 0) + (to.pending || 0)
  check('C8.19 [驱动 p8:483 扩展] 旧四项求和式在含 reviewing/rework 的载荷上不守恒，六项式守恒',
    oldFourTerm !== to.total && (to.completed + to.failed + to.working + to.reviewing + to.rework + to.pending) === to.total,
    '旧四项 sum=' + String(oldFourTerm) + ' vs total=' + String(to.total) + '（六项式守恒）')

  // ---- /role ----
  const roleFor = async (name) => (await callRoute('/api/team-flowise/role', 'runId=' + CRUN + '&agent=' + encodeURIComponent(name))).json || {}
  const dReviewer = await roleFor('Reviewer')
  check('C9.1 /role 对纯评审者角色返回 kind:"review" 条目、nodes 为空',
    (dReviewer.nodes || []).length === 0 && (dReviewer.reviews || []).length === 2 && (dReviewer.reviews || []).every((r) => r.kind === 'review'),
    JSON.stringify({ nodes: (dReviewer.nodes || []).length, reviews: (dReviewer.reviews || []).length, kinds: (dReviewer.reviews || []).map((r) => r.kind) }))
  check('C9.2 评审条目带回完整评审记录（findings/resolved/uncertainties/blockingCount/score）',
    (() => {
      const bad = (dReviewer.reviews || []).find((r) => r.id === 'b') || {}
      return Array.isArray(bad.findings) && bad.findings.length === 1 && bad.blockingCount === 1 && bad.score === 42 && typeof bad.summary === 'string' && bad.reviewedAgentName === 'Coder'
    })(), JSON.stringify((dReviewer.reviews || []).find((r) => r.id === 'b')))
  check('C9.3 评审条目带上被审节点的标题与状态（UI 才能跳转）',
    (dReviewer.reviews || []).every((r) => typeof r.nodeTitle === 'string' && typeof r.reviewedStatus === 'string'))
  check('C9.4 /role 的 reviews 绝不含"我负责的节点"字段泄漏（nodes 仍为空）',
    !('output' in ((dReviewer.reviews || [])[0] || {})) && !('iteration' in ((dReviewer.reviews || [])[0] || {})))

  const dCoder = await roleFor('Coder')
  check('C9.5 兼为负责人与评审者的角色：nodes 只含它负责的两个节点（b,c），不含它评审的 d',
    (dCoder.nodes || []).map((n) => n.id).sort().join(',') === 'b,c', JSON.stringify((dCoder.nodes || []).map((n) => n.id)))
  check('C9.6 同一角色的 reviews 精确等于它评审过的节点（d），kind=review',
    (dCoder.reviews || []).map((r) => r.id).join(',') === 'd' && (dCoder.reviews || []).every((r) => r.kind === 'review'),
    JSON.stringify((dCoder.reviews || []).map((r) => r.id)))
  check('C9.7 /role 只返回该角色负责的节点（既有断言口径：every agentName === role）',
    (dCoder.nodes || []).every((n) => n.agentName === 'Coder'), JSON.stringify((dCoder.nodes || []).map((n) => n.agentName)))
  // P11 added exactly TWO keys to this owner entry -- `route` (the FULL route
  // record: requested/source/effective/measured/verified/warning/note/efforts/
  // defaultEffort/timeoutMs) and `persona` (chars + which layers contributed).
  // The NodeCard is rendered from THIS entry, so without them the card cannot
  // say what the node really ran on. The assertion stays an EXACT key-set
  // comparison (not "contains"): the other 25 keys must be unchanged and no
  // third key may appear without this line being updated in the same edit.
  const wantKeys = ['acceptanceCriteria', 'agent', 'agentName', 'dependsOn', 'elapsedMs', 'endedAt', 'error', 'id', 'iteration', 'order', 'output', 'outputLen', 'outputTruncated', 'persona', 'reasoning', 'reasoningLen', 'requirement', 'review', 'reviewer', 'route', 'startedAt', 'status', 'summary', 'taskId', 'taskStatus', 'title', 'tools']
  check('C9.8 负责人条目的键集合 = 改动前的 24 键 + review + route + persona（27 键精确集合，其余逐键一致）',
    eq(Object.keys((dCoder.nodes || [])[0] || {}).sort(), wantKeys),
    Object.keys((dCoder.nodes || [])[0] || {}).sort().join(','))
  // B1 guard (host half): NodeCard is rendered from the OWNER entry, so a review
  // that only reaches the supervisor list is unreachable where the UI promises to
  // show it. Owner entries must carry it, and must use `null` -- not an all-null
  // object -- for a node that was never reviewed, or the client would render an
  // empty verdict block instead of falling back to "no record yet".
  const ownedB = (dCoder.nodes || []).filter((n) => n.id === 'b')[0]
  check('C9.12 被评审节点的负责人条目带上 review（verdict 可达节点卡片）',
    ownedB !== undefined && ownedB.review !== null && typeof ownedB.review === 'object' && ownedB.review.verdict === 'rework',
    JSON.stringify(ownedB && ownedB.review ? { id: ownedB.id, verdict: ownedB.review.verdict, blocking: ownedB.review.blockingCount } : null))
  // Node `e` is the fixture's genuinely unreviewed node: it has no state entry at
  // all, so it proves the "no record" case (a, b, c and d all carry a review).
  const dUnassigned = await roleFor('(未指派)')
  const ownedE = (dUnassigned.nodes || []).filter((n) => n.id === 'e')[0]
  check('C9.13 /role 能按 (未指派) 查到未指派节点（两条读面同一占位符字面量），且其 review 为 null',
    ownedE !== undefined && 'review' in ownedE && ownedE.review === null,
    JSON.stringify(ownedE ? { id: ownedE.id, review: ownedE.review } : null))
  const dTester = await roleFor('Tester')
  check('C9.9 纯负责人角色：nodes=[d]，reviews=[]（没有评审记录就不该有 reviews 键的内容）',
    (dTester.nodes || []).map((n) => n.id).join(',') === 'd' && eq(dTester.reviews, []),
    JSON.stringify({ nodes: (dTester.nodes || []).map((n) => n.id), reviews: dTester.reviews }))
  const dNobody = await roleFor('不存在的角色')
  check('C9.10 未知角色：nodes 与 reviews 都为空数组，形状与现状一致',
    eq(dNobody.nodes, []) && eq(dNobody.reviews, []), JSON.stringify({ nodes: dNobody.nodes, reviews: dNobody.reviews }))
  check('C9.11 /role 回显被查询的角色名与本次 run',
    dReviewer.role === 'Reviewer' && (dReviewer.run || {}).id === CRUN, JSON.stringify({ role: dReviewer.role, run: dReviewer.run }))
} catch (e) { blockFailure('C 组（读接口夹具）', e) }

// ===========================================================================
// G. The P12 fixes, each of which came from WATCHING the live P12 run:
//    * R7 -- a re-review that reports a previous blocking item as still
//      unresolved in fresh words was downgraded by R4 and then forced to `pass`
//      by R6, so an acknowledged-but-unfixed blocker shipped as a pass.
//    * R8 -- one review in six was lost entirely to malformed JSON.
//    * the worker tool policy named read-only Inspect tools it did not need to
//      forbid (the client-platform hang is refused at dispatch instead).
// ===========================================================================
console.log('\n[G] P12 修复：R7 遗留阻塞项 / R8 解析重试 / worker 工具策略')
{
  const prior = ['AC-1 未满足']
  const g1 = mod.normalizeReview({ verdict: 'pass', findings: [blockingFinding('换个说法的同一个问题', BLOCK_EVID)], resolved: [{ finding: 'AC-1 未满足', resolved: false, evidence: '复查后仍然缺失' }] }, { round: 2, knownBlocking: prior })
  check('G1.1 [R7] 复审把上一轮阻塞项标为未解决时，即使 verdict 写 pass 也必须按阻塞处理', g1.verdict === 'rework', String(g1.verdict))
  check('G1.2 [R7] 遗留项被补成一条 carried 阻塞项（返工提示词因此有据可依，而不是空 findings）',
    g1.findings.filter((f) => f.carried === true).length === 1 && g1.carriedCount === 1, JSON.stringify({ carried: g1.carriedCount }))
  check('G1.3 [R7] 改写措辞的新条目仍被 R4 降级（不得因此重新开放无限返工）',
    g1.findings.filter((f) => f.carried !== true)[0].severity === 'advisory',
    JSON.stringify((g1.findings.filter((f) => f.carried !== true)[0] || {}).severity))
  check('G1.4 [R7] 真解决了就放行：resolved:true 时不补遗留项、不强行返工',
    (() => { const r = mod.normalizeReview({ verdict: 'rework', findings: [blockingFinding('全新问题', BLOCK_EVID)], resolved: [{ finding: 'AC-1 未满足', resolved: true }] }, { round: 2, knownBlocking: prior }); return r.carriedCount === 0 && r.verdict === 'pass' })())
  check('G1.5 [R7] 首轮不适用（没有上一轮可比）',
    (() => { const r = mod.normalizeReview({ verdict: 'pass', findings: [], resolved: [{ finding: 'AC-1 未满足', resolved: false }] }, { round: 1, knownBlocking: [] }); return r.carriedCount === 0 && r.verdict === 'pass' })())
  check('G1.6 [R7] 不是上一轮阻塞项的条目被忽略（不得凭 resolved 数组凭空造阻塞项）',
    (() => { const r = mod.normalizeReview({ verdict: 'pass', findings: [], resolved: [{ finding: '从没出现过的条目', resolved: false }] }, { round: 2, knownBlocking: prior }); return r.carriedCount === 0 && r.verdict === 'pass' })())
  check('G1.7 [R7] R5 截断不得把 carried 阻塞项挤掉（它排在最终数组最前）',
    (() => { const many = Array.from({ length: 30 }, (_, i) => blockingFinding('c' + i, BLOCK_EVID)); const r = mod.normalizeReview({ verdict: 'rework', findings: many, resolved: [{ finding: 'AC-1 未满足', resolved: false }] }, { round: 2, knownBlocking: prior }); return r.findings.length === mod.REVIEW_LIMITS.maxFindings && r.findings.filter((f) => f.carried === true).length === 1 })())

  const rp = mod.buildReviewRepairPrompt({ reason: 'Expected comma at position 1305', knownBlocking: prior })
  check('G2.1 [R8] 修复提示词带上原始解析失败原因', rp.indexOf('Expected comma at position 1305') !== -1)
  check('G2.2 [R8] 点名最常见的失败原因：字符串里未转义的双引号', rp.indexOf('未转义的双引号') !== -1)
  check('G2.3 [R8] 复审场景下重申上一轮阻塞项与"不得新增阻塞项"',
    rp.indexOf('AC-1 未满足') !== -1 && rp.indexOf('不得提出新的 blocking') !== -1)
  check('G2.4 [R8] 无上一轮时省略该条款，且仍是一段可用的提示词',
    (() => { const q = mod.buildReviewRepairPrompt({}); return q.indexOf('返工后的复审') === -1 && q.length > 200 })())
}

console.log('\n[G3] R8 端到端：第一次返回坏 JSON，第二次返回合法结论')
try {
  const s = await scenario('repair-retry', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => {
      if (c.role !== 'reviewer') return { text: 'WORKER-G3' }
      if (c.repair === true) return { text: verdictJson({ verdict: 'pass', findings: [advisoryFinding()] }) }
      // First attempt: an unescaped inner quote -- exactly the live P12 failure.
      return { text: '```json\n{"verdict":"pass","score":80,"summary":"他说 "已验证" 了","findings":[],"resolved":[],"uncertainties":[]}\n```' }
    })
  const rv = (s.run.nodeStates.n1.review) || {}
  check('G3.1 评审者答坏 JSON 时真的发起了第二次修复调用，且只有一次',
    s.reviewers.length === 2 && s.reviewers.filter((c) => c.repair === true).length === 1,
    'reviewer calls=' + String(s.reviewers.length) + ' labels=' + JSON.stringify(s.reviewers.map((c) => c.label)))
  check('G3.2 修复调用被记录在 review.repair 上（不掩盖"这次结论是救回来的"）',
    rv.repair !== null && rv.repair !== undefined && rv.repair.attempted === true && rv.repair.ok === true, JSON.stringify(rv.repair))
  check('G3.3 救回来的结论被正常采用：verdict=pass、parseError 为空、节点 completed',
    rv.verdict === 'pass' && (rv.parseError === null || rv.parseError === undefined) && s.run.nodeStates.n1.status === 'completed',
    JSON.stringify({ verdict: rv.verdict, parseError: rv.parseError, status: s.run.nodeStates.n1.status }))
  const bad = await scenario('repair-fail', { n1: node('n1', { reviewer: 'Reviewer' }) }, null,
    (c) => (c.role === 'reviewer' ? { text: '完全不是 JSON' } : { text: 'WORKER-G3b' }))
  const r2 = (bad.run.nodeStates.n1.review) || {}
  check('G3.4 修复也失败时不阻塞：节点仍 completed、verdict=error、attempted 记录在案',
    bad.run.nodeStates.n1.status === 'completed' && r2.verdict === 'error' && bad.reviewers.length === 2 &&
    r2.repair !== null && r2.repair.attempted === true && r2.repair.ok === false,
    JSON.stringify({ status: bad.run.nodeStates.n1.status, verdict: r2.verdict, repair: r2.repair }))
} catch (e) { blockFailure('G3 场景（R8 解析重试）', e) }

console.log('\n[G4] worker 工具策略：只读 Inspect 不再被列为禁项，变更型工具仍然在列')
try {
  const s = await scenario('worker-tools', { n1: node('n1') }, null, () => ({ text: 'W' }))
  const note = String((s.run.nodeStates.n1.tools) || '')
  const denyMatch = /"deny":\[(.*?)\]/.exec(note)
  const denied = denyMatch === null ? [] : denyMatch[1].split(',').map((x) => x.replace(/"/g, '').trim())
  check('G4.1 只读 Inspect 三件套不在 worker 的 deny 名单里（该策略本来也拦不住它们，见下）',
    denied.indexOf('cordis_inspect_list') === -1 && denied.indexOf('cordis_inspect_query') === -1 && denied.indexOf('cordis_inspect_self') === -1,
    JSON.stringify(denied.filter((n) => n.indexOf('cordis_inspect') === 0)))
  check('G4.2 变更型与编排型工具仍在 deny 名单里（define/run/stop/undefine、human prompt、workflow/subagent、team_*）',
    ['cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine', 'ask_user_question', 'workflow', 'subagent', 'team_run_workflow'].every((n) => denied.indexOf(n) !== -1),
    JSON.stringify(denied))
  check('G4.3 deny 名单非空（"什么都没禁"必须是失败而不是静默通过）', denied.length >= 15, String(denied.length))
} catch (e) { blockFailure('G4 场景（worker 工具策略）', e) }

// ===========================================================================
summary()
process.exit(failures === 0 ? 0 : 1)
