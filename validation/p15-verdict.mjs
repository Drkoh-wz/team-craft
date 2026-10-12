// P15/N3: the reviewer's conclusion must be READ, never assumed.
//
// The defect this suite locks: `normalizeReview` read the verdict from exactly one
// key (`verdict`) compared against exactly one token (`'rework'`). Everything else
// fell through to `pass` WITH AN EMPTY NOTES ARRAY -- so a reviewer that concluded
// FAIL was recorded as a clean pass, and the ledger could contradict itself
// (`blockingCount: 1` next to `verdict: 'pass'`). Measured on the pre-fix build:
//
//   {overall_verdict:'FAIL', required_corrections:[...]}   -> pass, notes=[]
//   {findings:[{severity:'blocking',criterion,evidence}]}   -> pass, notes=[]  blockingCount:1
//   {verdict:'FAIL'} / {verdict:'lgtm'} / {verdict:'通过'}   -> pass, notes=[]
//
// The first shape is what a specialization pack naturally emits -- the leasing
// pack's native contract is `overall_verdict` / `required_corrections` -- so this
// was reachable in production, not hypothetical.
//
// Group A is the behaviour table on the fixed module. Group B runs THE SAME TABLE
// against the module as it was before R9 (read out of git), and asserts the old
// rows really were the silent pass: without it, group A could be green because the
// table tests nothing. Group C pins the invariants R9 must not have broken --
// R2/R3/R4 stay downgrade-only, R6 keeps its pinned outcomes, R7 still forces
// rework, and the result OBJECT KEY SET is unchanged. Group D proves the suite can
// fail by pointing "before R9" at the fixed module.
//
// Usage:
//   node validation/p15-verdict.mjs
//   P15V_OLD_REF=<git-ref> node validation/p15-verdict.mjs
//
// Exit code: 0 = all checks passed, 1 = at least one failed.

import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')

function gitRaw(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

// "The module before R9" is self-locating: the commit that INTRODUCED
// REVIEW_VERDICT_KEYS, minus one. Hard-coding a sha or using HEAD^ would rot the
// moment anyone commits again -- and a suite that silently starts comparing the
// fixed module with itself goes green for the wrong reason (p15-merge did exactly
// that once). While R9 is still uncommitted the pickaxe finds nothing and the
// fallback HEAD is the correct pre-R9 module anyway.
const DEFAULT_OLD_REF = (() => {
  try {
    const intro = gitRaw(['log', '-1', '--format=%H', '-S', 'REVIEW_VERDICT_KEYS', '--', 'packages/team-flowise/src/index.js']).trim()
    if (intro !== '') return intro + '^'
  } catch { /* fall through */ }
  return 'HEAD'
})()
const OLD_REF = process.env.P15V_OLD_REF && process.env.P15V_OLD_REF.trim() !== '' ? process.env.P15V_OLD_REF.trim() : DEFAULT_OLD_REF
// An explicit PATH override for "the module before R9". The falsification in group
// D needs to point "before" at the FIXED module, which git cannot name while the
// change is uncommitted -- with only a ref override the child would have compared
// HEAD with HEAD and stayed green (it did, once, which is why this exists).
const OLD_SRC = process.env.P15V_OLD_SRC && process.env.P15V_OLD_SRC.trim() !== '' ? resolve(process.env.P15V_OLD_SRC.trim()) : null
const CHILD = process.env.P15V_CHILD === '1'

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
  console.log('fixed module under test : ' + SRC)
  console.log('pre-R9 module compared to : ' + oldLabel)
  if (failedLabels.length > 0) {
    console.log('failed checks:')
    for (const l of failedLabels) console.log('  - ' + l)
  }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })
process.on('unhandledRejection', (e) => { blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })

console.log('=== P15 verdict-vocabulary tests (R9) ===')

const BLOCK_EVID = '第 12 行写的是资产负载率 3.1，与验收标准要求的 4.2 不符，属实质性偏差'
const blockingFinding = (criterion, evidence) => ({ severity: 'blocking', criterion, evidence })
const notesText = (r) => (Array.isArray(r.notes) ? r.notes.join(' | ') : '')

/* ------------------------------------------------------------------ table */
// verdict / noteHas  = expected on the FIXED module
// oldVerdict / oldNotesEmpty = what the PRE-R9 module did (group B asserts this)
const TABLE = [
  { label: 'A1 原生包词汇 FAIL（无阻塞项）', payload: { overall_verdict: 'FAIL', required_corrections: ['资产负载率算错'] },
    verdict: 'error', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A2 原生包词汇 PASS', payload: { overall_verdict: 'PASS', recalculation_results: [] },
    verdict: 'pass', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A3 原生包词汇 CONDITIONAL_PASS', payload: { overall_verdict: 'CONDITIONAL_PASS' },
    verdict: 'pass', noteHas: '有条件通过', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A4 有条目、没给结论字段', payload: { findings: [{ severity: 'blocking', criterion: '验收标准 3', evidence: BLOCK_EVID }] },
    verdict: 'rework', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true, oldBlocking: 1 },
  { label: 'A5 verdict=FAIL（大写）', payload: { verdict: 'FAIL' },
    verdict: 'error', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A6 verdict=驳回（中文别名）', payload: { verdict: '驳回' },
    verdict: 'error', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A7 verdict=maybe（无法解读）', payload: { verdict: 'maybe' },
    verdict: 'error', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A8 verdict=lgtm（等价通过）', payload: { verdict: 'lgtm' },
    verdict: 'pass', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A9 conclusion=FAIL（另一个别名字段）', payload: { conclusion: 'FAIL' },
    verdict: 'error', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A10 decision=approve', payload: { decision: 'approve' },
    verdict: 'pass', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A11 空对象', payload: {},
    verdict: 'pass', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  { label: 'A12 verdict=pass 但带一条合格阻塞项（自相矛盾，阻塞项优先）', payload: { verdict: 'pass', findings: [blockingFinding('验收标准 2', BLOCK_EVID)] },
    verdict: 'rework', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true, oldBlocking: 1 },
  { label: 'A13 非契约字段 FAIL + 合格阻塞项（有可返工的东西 -> 返工）', payload: { overall_verdict: 'FAIL', findings: [blockingFinding('验收标准 4', BLOCK_EVID)] },
    verdict: 'rework', noteHas: null, oldVerdict: 'pass', oldNotesEmpty: true, oldBlocking: 1 },
  { label: 'A14 两个结论字段互相矛盾（以第一个可识别字段为准）', payload: { verdict: 'rework', overall_verdict: 'PASS' },
    verdict: 'pass', noteHas: '互相矛盾', oldVerdict: 'pass', oldNotesEmpty: false },
  { label: 'A15 verdict 是嵌套对象（不是结论 token）', payload: { verdict: { nested: 1 } },
    verdict: 'pass', noteHas: 'R9', oldVerdict: 'pass', oldNotesEmpty: true },
  // The four rows below are pinned by p10-review and must be UNCHANGED by R9.
  { label: 'A16 [R6 不变] verdict=rework，只有 advisory 条目', payload: { verdict: 'rework', score: 45, summary: '感觉不太行', findings: [{ severity: 'advisory', criterion: '风格可以更好', evidence: '整体文字偏口语化，建议更正式一些' }] },
    verdict: 'pass', noteHas: 'R6', oldVerdict: 'pass', oldNotesEmpty: false },
  { label: 'A17 [R6 不变] verdict=rework，findings 为空数组', payload: { verdict: 'rework', findings: [] },
    verdict: 'pass', noteHas: 'R6', oldVerdict: 'pass', oldNotesEmpty: false },
  { label: 'A18 [R6 不变] verdict=rework，无 findings 无 score', payload: { verdict: 'rework' },
    verdict: 'pass', noteHas: 'R6', oldVerdict: 'pass', oldNotesEmpty: false },
  { label: 'A19 [不变] verdict=rework 且有合格阻塞项 -> 保持 rework 且无留痕', payload: { verdict: 'rework', findings: [blockingFinding('验收标准 1', BLOCK_EVID)] },
    verdict: 'rework', noteHas: null, oldVerdict: 'rework', oldNotesEmpty: true },
]

/* -------------------------------------------------- import both modules */
const MUT_TMP = join(tmpdir(), 'tf-p15v-' + String(process.pid) + '-' + String(Date.now()))
const IMPORT_SPECS = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain', 'zod']
function importableCopy(text, outFile) {
  const require = createRequire(SRC)
  let out = text
  for (const spec of IMPORT_SPECS) {
    const resolved = pathToFileURL(require.resolve(spec, { paths: [dirname(SRC)] })).href
    const re = new RegExp("from '" + spec.replace(/[/@.]/g, (c) => '\\' + c) + "'", 'g')
    if (!re.test(out)) throw new Error('specifier ' + spec + ' not found in ' + SRC)
    out = out.replace(re, "from '" + resolved + "'")
  }
  writeFileSync(outFile, out, 'utf8')
  return outFile
}
let fixed = null
let old = null
let oldLabel = OLD_REF
try {
  const fixedUrl = pathToFileURL(SRC).href
  fixed = await import(fixedUrl + '?p15v-fixed')
  if (OLD_SRC !== null) {
    old = await import(pathToFileURL(OLD_SRC).href + '?p15v-old')
    oldLabel = OLD_SRC + ' (P15V_OLD_SRC override)'
  } else {
    mkdirSync(MUT_TMP, { recursive: true })
    const oldText = gitRaw(['show', OLD_REF + ':packages/team-flowise/src/index.js'])
    const oldFile = importableCopy(oldText, join(MUT_TMP, 'pre-r9-index.mjs'))
    old = await import(pathToFileURL(oldFile).href)
    oldLabel = OLD_REF + ' (' + oldText.length + ' bytes from git)'
  }
  check('B0.1 修复前的模块与修复后的模块都被真的导入了（差分才有意义）',
    typeof old.normalizeReview === 'function' && typeof fixed.normalizeReview === 'function',
    'pre-R9 = ' + oldLabel)
  check('B0.2 修复前的模块确实没有 R9（否则"旧行为"没有依据）',
    typeof old.resolveReviewVerdict !== 'function' && typeof fixed.resolveReviewVerdict === 'function')
} catch (e) { blockFailure('B0 导入两个版本的模块', e) }

/* ------------------------------------------------------------------ group A */
console.log('\n--- GROUP A: 结论必须被读出来（修复后的行为） ---')
if (fixed !== null) {
  for (const row of TABLE) {
    let r = null
    try { r = fixed.normalizeReview(row.payload, { round: 1, knownBlocking: [] }) } catch (e) { blockFailure(row.label, e); continue }
    const okVerdict = r.verdict === row.verdict
    const okNote = row.noteHas === null ? r.notes.length === 0 : notesText(r).indexOf(row.noteHas) !== -1
    check(row.label, okVerdict && okNote,
      'verdict=' + String(r.verdict) + ' blocking=' + r.blockingCount + ' notes=' + JSON.stringify(r.notes).slice(0, 120))
  }
  // N3's exact complaint was that the failure was INVISIBLE: parseable, no parse
  // error, no notes. Being parseable is not the same as being understandable.
  for (const label of ['A1 原生包词汇 FAIL（无阻塞项）', 'A5 verdict=FAIL（大写）', 'A7 verdict=maybe（无法解读）']) {
    const row = TABLE.filter((x) => x.label === label)[0]
    const r = fixed.normalizeReview(row.payload, { round: 1 })
    check('A20 [N3 核心] ' + label + '：可解析（parseError=null）不等于可解读，必须留下 notes',
      r.parseError === null && r.notes.length > 0,
      'parseError=' + JSON.stringify(r.parseError) + ' notes=' + r.notes.length)
  }
  const errRow = fixed.normalizeReview({ verdict: 'maybe' }, { round: 1 })
  check('A21 error 结论的摘要（无 summary 时）说明"未经实质评审"，不是"要求返工"',
    /未经实质评审/.test(String(errRow.summary)) && !/要求返工/.test(String(errRow.summary)), String(errRow.summary).slice(0, 90))
}

/* ------------------------------------------------------------------ group B */
console.log('\n--- GROUP B: 修复前这些行真的会静默通过（否则 A 组是空转） ---')
if (old !== null) {
  const changed = TABLE.filter((row) => row.oldNotesEmpty === true || row.oldVerdict !== row.verdict)
  check('B1.0 表里确实有"修复前会静默通过"的行（夹具非空转）', changed.length >= 8, 'rows=' + changed.length)
  for (const row of TABLE) {
    let r = null
    try { r = old.normalizeReview(row.payload, { round: 1, knownBlocking: [] }) } catch (e) { blockFailure('B ' + row.label, e); continue }
    if (row.oldNotesEmpty === true) {
      const matches = r.verdict === row.oldVerdict && r.notes.length === 0
        && (row.oldBlocking === undefined || r.blockingCount === row.oldBlocking)
      check('B ' + row.label + '：修复前 verdict=' + row.oldVerdict + (row.oldBlocking === undefined ? '' : ' 且 blockingCount=' + row.oldBlocking) + '，notes 为空（静默）',
        matches, 'verdict=' + String(r.verdict) + ' blocking=' + r.blockingCount + ' notes=' + JSON.stringify(r.notes).slice(0, 80))
    } else {
      // R6-pinned rows: the OLD module already behaved this way, and it must be the
      // same behaviour the fixed module still has (that is the point of A16-A19).
      check('B ' + row.label + '：修复前后行为一致（R6 那几个形状不许被 R9 改动）',
        r.verdict === row.verdict, 'old=' + String(r.verdict) + ' now=' + row.verdict)
    }
  }
  const oldBlockingNoVerdict = old.normalizeReview({ findings: [blockingFinding('c', BLOCK_EVID)] }, { round: 1 })
  check('B2.1 [自相矛盾的账本] 修复前：一条合格阻塞项 + 无结论 -> verdict=pass 而 blockingCount=1，且无任何 notes',
    oldBlockingNoVerdict.verdict === 'pass' && oldBlockingNoVerdict.blockingCount === 1 && oldBlockingNoVerdict.notes.length === 0,
    'verdict=' + oldBlockingNoVerdict.verdict + ' blocking=' + oldBlockingNoVerdict.blockingCount + ' notes=' + JSON.stringify(oldBlockingNoVerdict.notes))
}

/* ------------------------------------------------------------------ group C */
console.log('\n--- GROUP C: R9 不许破坏既有不变量 ---')
if (fixed !== null && old !== null) {
  const kFixed = Object.keys(fixed.normalizeReview({ verdict: 'pass' }, { round: 1 })).sort().join(',')
  const kOld = Object.keys(old.normalizeReview({ verdict: 'pass' }, { round: 1 })).sort().join(',')
  check('C1.1 normalizeReview 的结果键集与修复前完全一致（R9 不新增字段：键集就是契约）', kFixed === kOld, kFixed)

  const nr = (p, o) => fixed.normalizeReview(p, o || { round: 1 })
  const bogus = nr({ verdict: 'rework', findings: [{ severity: 'BLOCKING', criterion: 'c', evidence: BLOCK_EVID }] })
  check('C2.1 [R2 只降不升] 非法 severity 不能制造阻塞项：仍按 R6 归为 pass',
    bogus.verdict === 'pass' && bogus.blockingCount === 0 && notesText(bogus).indexOf('R6') !== -1, 'verdict=' + bogus.verdict)
  const shortEv = nr({ verdict: 'rework', findings: [{ severity: 'blocking', criterion: 'c', evidence: '太短' }] })
  check('C2.2 [R3] 证据不足的 blocking 降级为 advisory，不阻塞',
    shortEv.verdict === 'pass' && shortEv.blockingCount === 0 && shortEv.advisoryCount === 1, 'verdict=' + shortEv.verdict)
  const r4 = nr({ verdict: 'rework', findings: [blockingFinding('全新问题', BLOCK_EVID)] }, { round: 2, knownBlocking: ['上一轮的问题'] })
  check('C2.3 [R4] 复审不得新增阻塞项：降级后按 R6 归为 pass', r4.verdict === 'pass' && r4.blockingCount === 0, 'verdict=' + r4.verdict)
  const r7 = nr({ verdict: 'pass', findings: [], resolved: [{ finding: '上一轮的问题', resolved: false, evidence: '仍未修复' }] }, { round: 2, knownBlocking: ['上一轮的问题'] })
  check('C3.1 [R7 仍然更强] 评审者自己说上一轮阻塞项未解决 -> rework，压过 verdict=pass',
    r7.verdict === 'rework' && r7.blockingCount === 1 && r7.carriedCount === 1, 'verdict=' + r7.verdict + ' carried=' + r7.carriedCount)
  const carriedKeys = Object.keys(nr({ verdict: 'error' }, { round: 1 })).sort().join(',')
  check('C3.2 error 结论也带着完整的键集（不因新结论少字段）', carriedKeys === kOld, carriedKeys)

  // The resolver itself, unit level: exported, pure, and it must not treat a
  // nested object as a token (that trap would turn every such payload into error).
  check('C4.1 resolveReviewVerdict / classifyReviewVerdict 已导出', typeof fixed.resolveReviewVerdict === 'function' && typeof fixed.classifyReviewVerdict === 'function')
  const cls = [
    ['rework', 'negative'], ['FAIL', 'negative'], ['  Failed ', 'negative'], ['驳回', 'negative'],
    ['pass', 'positive'], ['OK', 'positive'], ['通过', 'positive'], ['LGTM', 'positive'],
    ['conditional_pass', 'conditional'], ['有条件通过', 'conditional'],
    ['maybe', 'unreadable'], ['', 'absent'], [null, 'absent'], [undefined, 'absent'], [{ a: 1 }, 'unreadable'],
  ]
  const bad = cls.filter(([v, want]) => fixed.classifyReviewVerdict(v) !== want)
  check('C4.2 词汇分类表逐项正确（大小写、空白、下划线、中文别名）', bad.length === 0,
    bad.length ? JSON.stringify(bad) : 'cases=' + cls.length)
  const nested = fixed.resolveReviewVerdict({ verdict: { a: 1 } })
  check('C4.3 verdict 是嵌套对象时按"没有结论"处理，而不是"无法解读"（否则每个这种载荷都会变成 error）',
    nested.kind === 'absent' && nested.key === null, JSON.stringify(nested.kind))
  const conflict = fixed.resolveReviewVerdict({ verdict: 'rework', overall_verdict: 'PASS' })
  check('C4.4 冲突时以第一个可识别字段为准，并把另一方记进 conflicts',
    conflict.kind === 'negative' && conflict.key === 'verdict' && conflict.conflicts.length === 1 && conflict.conflicts[0].key === 'overall_verdict',
    JSON.stringify({ key: conflict.key, conflicts: conflict.conflicts.map((c) => c.key) }))
  const absentOnNonObject = fixed.resolveReviewVerdict(null)
  check('C4.5 非对象输入不抛异常，按"没有结论"处理', absentOnNonObject.kind === 'absent')
}

/* ------------------------------------------------------------------ group D */
console.log('\n--- GROUP D: 本套件真的会红（不碰仓库源码的反证） ---')
if (CHILD) {
  console.log('  ...  子进程模式（P15V_CHILD=1）-> 不再递归跑反证')
} else {
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, P15V_OLD_SRC: SRC, P15V_CHILD: '1' },
    })
    check('D1.1 把"修复前"指向修复后的模块本体，本套件必须变红（否则 B 组是装饰品）', false, 'exit=0 (it stayed green) :: ' + out.slice(0, 120))
  } catch (e) {
    const stdout = String(e.stdout || '')
    const status = e.status === undefined || e.status === null ? -1 : e.status
    const labels = (() => {
      const at = stdout.indexOf('failed checks:')
      if (at === -1) return []
      return stdout.slice(at).split('\n').slice(1).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l !== '')
    })()
    const childStats = /checks=(\d+)\s+failures=(\d+)/.exec(stdout)
    check('D1.1 把"修复前"指向修复后的模块本体，本套件必须变红（否则 B 组是装饰品）', status === 1, 'exit=' + status)
    check('D1.2 变红的正是 B 组那几条（修复前后的差异锁在这里）',
      labels.filter((l) => /^B /.test(l)).length >= 8, 'B 组变红=' + labels.filter((l) => /^B /.test(l)).length)
    check('D1.3 红在"检查"上而不是套件崩溃：SUMMARY 打印了，且没有 FATAL / 未捕获异常',
      stdout.includes('=== SUMMARY ===') && !/未捕获异常/.test(stdout), 'summary=' + stdout.includes('=== SUMMARY ==='))
    if (childStats) console.log('       [反证原始输出] exit=' + status + ' checks=' + childStats[1] + ' failures=' + childStats[2])
  }
  try { rmSync(MUT_TMP, { recursive: true, force: true }) } catch { /* ignore */ }
  check('D2.1 反证用的临时副本已删除', !existsSync(MUT_TMP), MUT_TMP)
}
// Cleanup belongs OUTSIDE the parent-only branch: the child creates the same temp
// copy and used to exit before removing it, leaking one directory per run.
try { rmSync(MUT_TMP, { recursive: true, force: true }) } catch { /* ignore */ }

process.exit(summary() === 0 ? 0 : 1)
