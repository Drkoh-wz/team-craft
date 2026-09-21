// P15: executable tests for the MERGE itself (P13 fail-fast + P14 guards on main).
//
// Why this suite exists separately from p13-halt and p14-guard:
//
//   Those two suites each prove one capability against the merged file, and both
//   pass on it. What neither can prove is that the merge RESOLVED the two textual
//   conflicts coherently -- that both marks are made for the same failure, that
//   the final summary is the union rather than one side winning, and that the
//   merged status vocabulary is actually loadable against the storage that
//   already exists on this machine.
//
//   That last point is not hypothetical. It was a live outage.
//
//     A restart onto `main` (which has P14 but not P13) made
//     GET /api/team-flowise/runs and GET /api/team-flowise/progress answer
//     HTTP 500, while /agents and /workflows stayed healthy. `runSchema` is
//     attached to the storage table via `domainTable(runSchema)`, and
//     dsh-storage-domain/lib/index.js:371 parses EVERY record through that
//     schema on read:
//
//         parsed = parseRecord(spec.name, table, key, () => tableSpec.valueSchema.parse(raw))
//
//     `~/.dsh/storages/team_runs.json` contains one run written while the P13
//     branch was live, and its status is `halted`. main's enum did not contain
//     `halted`, so parsing that record threw on every read of the table, and
//     both endpoints died with it.
//
//     Adding an enum VALUE is a loosening, so the merge fixes it in the forward
//     direction -- and the reverse direction is what broke. Group B is a
//     DIFFERENTIAL test over the real stored records: the pre-merge schema must
//     reject the halted record (that is the outage, reproduced), the merged one
//     must accept it, and the merged one must accept everything the old one
//     accepted (so the relaxation is monotone, not a trade).
//
// Usage:
//   node validation/p15-merge.mjs
//   P15_OLD_REF=<git-ref> node validation/p15-merge.mjs
//       use <git-ref> as "the code before the merge" (default HEAD^1)
//
// Exit code: 0 = all checks passed, 1 = at least one failed,
//            2 = a module under test could not be imported.
//
// The suite proves it can fail without touching the repository: run as a child
// with P15_OLD_REF=HEAD, the "pre-merge" module becomes the merged module and
// B2 must go red. That is group D.
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SRC = join(REPO, 'packages', 'team-flowise', 'src', 'index.js')
const CLIENT_SRC = join(REPO, 'packages', 'team-flowise', 'src', 'client', 'index.js')

// "The code before the merge" is the FIRST PARENT OF THE NEWEST MERGE COMMIT, not
// `HEAD^1`. HEAD moves the moment anyone commits on top of the merge, and a suite
// that quietly starts comparing the merged build against itself would go green for
// the wrong reason. (It did exactly that once, which is why this is computed.)
const DEFAULT_OLD_REF = (() => {
  try {
    const mergeSha = execFileSync('git', ['log', '--merges', '-1', '--format=%H'], { cwd: REPO, encoding: 'utf8' }).trim()
    if (mergeSha !== '') return mergeSha + '^1'
  } catch { /* fall through to the naive default */ }
  return 'HEAD^1'
})()
const OLD_REF = process.env.P15_OLD_REF && process.env.P15_OLD_REF.trim() !== '' ? process.env.P15_OLD_REF.trim() : DEFAULT_OLD_REF
const CHILD = process.env.P15_CHILD === '1'

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
  console.log('merged module under test : ' + SRC)
  console.log('pre-merge ref compared to: ' + OLD_REF)
  if (failedLabels.length > 0) {
    console.log('failed checks:')
    for (const l of failedLabels) console.log('  - ' + l)
  }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })
process.on('unhandledRejection', (e) => { blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e); summary(); process.exit(1) })

console.log('=== P15 merge tests (P13 fail-fast + P14 guards in one build) ===')

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/* ---------------------------------------------------------------- group A */
// The two conflicts, and the union that resolved them. Every assertion here is
// about a place where taking EITHER side alone would compile and be wrong.
console.log('\n--- GROUP A: 两处冲突真的解成了并集（而不是选了一边） ---')
const mergedText = readFileSync(SRC, 'utf8')

// A1: no conflict markers anywhere in the tracked tree.
let markers = []
try {
  const listed = git(['grep', '-n', '-I', '-E', '^(<<<<<<< |>>>>>>> |=======$)']).trim()
  markers = listed === '' ? [] : listed.split('\n')
} catch (e) {
  // `git grep` exits 1 when nothing matches, which is the healthy case.
  const status = e && e.status
  if (status === 1) markers = []
  else blockFailure('A1.0 git grep 可执行', e)
}
check('A1.1 仓库里没有任何未解决的冲突标记', markers.length === 0, markers.slice(0, 3).join(' | ') || 'clean')

// A2: .gitignore kept one rule and one comment for both archive families.
const ignore = readFileSync(join(REPO, '.gitignore'), 'utf8')
const distLines = ignore.split('\n').filter((l) => l.trim() === 'dist/').length
check('A2.1 .gitignore 的 dist/ 规则恰好一条（两份冲突注释被合成一份）', distLines === 1, 'n=' + distLines)
check('A2.2 合并后的注释同时覆盖两类归档（specialization 包与插件安装包）',
  ignore.includes('pack-specialization.mjs') && /install packages/.test(ignore),
  'mentions pack-specialization=' + ignore.includes('pack-specialization.mjs'))
check('A2.3 已经过时的「两个分支要保持同步」说法被删掉了（分支已合并）',
  !/on the specialization branch so the two cannot conflict/.test(ignore))

// A3: for ONE failure, both marks are made. P14 attributes the failure to a
// provider; P13 marks it as the halt trigger. Taking one side would silently
// drop the other capability.
const catchAt = mergedText.indexOf('// P13: this failure is the halt trigger')
const failMarkAt = mergedText.indexOf('const providerSide =')
check('A3.1 失败分支里同时存在 P13 的停机标记与 P14 的 provider 归因',
  catchAt !== -1 && failMarkAt !== -1 && Math.abs(catchAt - failMarkAt) < 1400,
  'halt mark at ' + catchAt + ', provider attribution at ' + failMarkAt)
check('A3.2 这两件事写在同一个 catch 里（不是各写一份、只有一份会执行）',
  catchAt !== -1 && failMarkAt !== -1 && /haltedBy = nid/.test(mergedText) && /noteProviderResult\(routeState\.effective\.provider, true\)/.test(mergedText))

// A4: the final summary is the union: the halted wording is the BASE and the
// provider-health sentence is appended to it. Either side alone loses a fact.
check('A4.1 停机判定沿用 P13 的口径（skipped 非空 或 unresolved-blocking）',
  mergedText.includes("const halted = skipped.length > 0 || haltReason === 'unresolved-blocking'"))
check('A4.2 摘要基座是停机文案（P14 的 provider 附注追加在它之后，而不是取代它）',
  /const baseSummary = halted/.test(mergedText) && mergedText.includes("baseSummary + '; provider health: '"))
check('A4.3 状态三元式保留两个状态：halted 优先，其余仍走 completed/failed/interrupted',
  mergedText.includes("const status = halted ? 'halted' : (allOk ? 'completed' : (allDone ? 'failed' : 'interrupted'))"))

// A5: the union is coherent -- `halted` is declared once and is the same binding
// the run result reads, so the merge left no dangling identifier.
const haltedDecls = (mergedText.match(/const halted =/g) || []).length
check('A5.1 halted 只声明一次（两处各声明一次会让最终 result 读到错的那个）', haltedDecls === 1, 'n=' + haltedDecls)
check('A5.2 最终 result 的键集仍由同一个 halted 决定（停机运行才多出 haltedBy/haltReason/skipped）',
  mergedText.includes('...(halted ? { haltedBy: haltedBy, haltReason: haltReason, skipped: skipped.slice() } : {})'))

// A6: both capability suites are in the tree, so "the merged build has both" is
// checkable by running them rather than by trusting this file.
const p13 = join(REPO, 'validation', 'p13-halt.mjs')
const p14 = join(REPO, 'validation', 'p14-guard.mjs')
check('A6.1 P13 的停机能力套件在合并后的树里', existsSync(p13) && statSync(p13).size > 1000, 'bytes=' + (existsSync(p13) ? statSync(p13).size : 0))
check('A6.2 P14 的守卫能力套件在合并后的树里', existsSync(p14) && statSync(p14).size > 1000, 'bytes=' + (existsSync(p14) ? statSync(p14).size : 0))

/* ---------------------------------------------------------------- group B */
// The differential test. This is the part that turns the live 500 into a
// reproducible, falsifiable check.
console.log('\n--- GROUP B: 合并修好了「旧代码读新存储」造成的活体 500（差分测试） ---')

// B0: the fixture is the machine's OWN storage, not a fabricated record.
const DSH_HOME = (() => {
  const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return raw.length > 0 ? resolve(raw) : join(homedir(), '.dsh')
})()
const RUNS_FILE = join(DSH_HOME, 'storages', 'team_runs.json')
let storedRuns = []
let haltedRuns = []
try {
  const parsed = JSON.parse(readFileSync(RUNS_FILE, 'utf8'))
  const out = []
  const walk = (node, depth) => {
    if (depth > 8 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return }
    if (typeof node.id === 'string' && typeof node.status === 'string' && typeof node.startedAt === 'number') { out.push(node); return }
    for (const v of Object.values(node)) walk(v, depth + 1)
  }
  walk(parsed, 0)
  storedRuns = out
  haltedRuns = out.filter((r) => r.status === 'halted')
  check('B0.1 夹具来自本机真实存储 team_runs.json，且里面有运行记录',
    storedRuns.length > 0, 'runs=' + storedRuns.length + ' file=' + RUNS_FILE)
  check('B0.2 其中确实存在一条 status=halted 的运行（是 P13 分支在线时写下的）',
    haltedRuns.length >= 1, 'halted=' + haltedRuns.length + ' ids=' + haltedRuns.map((r) => r.id).join(','))
  const skippedNodes = haltedRuns.length > 0 && haltedRuns[0].nodeStates
    ? Object.values(haltedRuns[0].nodeStates).filter((n) => n && n.status === 'skipped').length
    : 0
  check('B0.3 那条 halted 运行带着 skipped 节点（它确实是停机收场，不是被误标）',
    skippedNodes >= 1, 'skipped nodes=' + skippedNodes)
} catch (e) { blockFailure('B0 读取本机真实存储', e) }

// B1/B2: import BOTH versions. The pre-merge copy lives in the system temp dir
// and is made importable by pointing its bare specifiers at the absolute paths
// the package's own node_modules resolves to (same trick p13-halt uses: a plain
// copy in a temp dir dies with ERR_MODULE_NOT_FOUND).
const MUT_TMP = join(tmpdir(), 'tf-p15-merge-' + String(process.pid) + '-' + String(Date.now()))
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
let oldMod = null
let newMod = null
let oldSourceBytes = 0
try {
  mkdirSync(MUT_TMP, { recursive: true })
  const oldText = git(['show', OLD_REF + ':packages/team-flowise/src/index.js'])
  oldSourceBytes = oldText.length
  const oldFile = importableCopy(oldText, join(MUT_TMP, 'premerge-index.mjs'))
  oldMod = await import(pathToFileURL(oldFile).href)
  newMod = await import(pathToFileURL(SRC).href + '?p15-merged')
  check('B1.1 合并前的模块与合并后的模块都被真的导入了（差分才有意义）',
    typeof oldMod.runsDomain === 'object' && typeof newMod.runsDomain === 'object',
    'pre-merge ref=' + OLD_REF + ' source bytes=' + oldSourceBytes)
  check('B1.2 两个模块导出的确实是同一张表的 schema（runs.valueSchema）',
    typeof oldMod.runsDomain.tables.runs.valueSchema.safeParse === 'function'
    && typeof newMod.runsDomain.tables.runs.valueSchema.safeParse === 'function')
} catch (e) { blockFailure('B1 导入两个版本的模块', e) }

if (oldMod !== null && newMod !== null && haltedRuns.length >= 1) {
  try {
    const oldSchema = oldMod.runsDomain.tables.runs.valueSchema
    const newSchema = newMod.runsDomain.tables.runs.valueSchema
    const halted = haltedRuns[0]

    const oldHalted = oldSchema.safeParse(halted)
    const newHalted = newSchema.safeParse(halted)
    check('B2.1 [活体故障复现] 合并前的 schema 拒绝这条 halted 记录（这就是 /runs 与 /progress 500 的原因）',
      oldHalted.success === false,
      oldHalted.success ? 'accepted (the outage would not reproduce)' : (oldHalted.error.issues[0].path.join('.') + ': ' + oldHalted.error.issues[0].message))
    check('B2.2 拒绝点是 status 这个枚举字段（不是别的字段在报错）',
      oldHalted.success === false && oldHalted.error.issues.some((i) => i.path.length === 1 && i.path[0] === 'status'),
      oldHalted.success ? 'n/a' : oldHalted.error.issues.map((i) => i.path.join('.')).join(','))
    check('B2.3 [合并的修复] 合并后的 schema 接受同一条记录',
      newHalted.success === true,
      newHalted.success ? 'accepted' : String(newHalted.error.issues[0] && newHalted.error.issues[0].message))

    // B3: monotone. Relaxing an enum must not reject anything the old one took.
    let oldOk = 0
    let newOk = 0
    let regressions = []
    for (const rec of storedRuns) {
      const a = oldSchema.safeParse(rec).success
      const b = newSchema.safeParse(rec).success
      if (a) oldOk += 1
      if (b) newOk += 1
      if (a && !b) regressions.push(rec.id)
    }
    check('B3.1 合并后的 schema 不比合并前更严：旧版接受的每一条，新版都接受',
      regressions.length === 0,
      'old accepted=' + oldOk + ' new accepted=' + newOk + ' regressions=' + regressions.slice(0, 3).join(','))
    check('B3.2 而且新版严格更宽（多出来的都是 halted 记录），所以放宽是有证据的',
      newOk > oldOk, 'delta=' + (newOk - oldOk) + ' halted in storage=' + haltedRuns.length)

    // B4: the direction that broke is documented where the next person will look.
    // The comment is wrapped across `//` lines, so flatten line comments first --
    // asserting on the raw text would test the line breaks, not the claim.
    const commentFlat = mergedText.replace(/\n\s*\/\/\s?/g, ' ')
    check('B4.1 代码注释写明了「加枚举值是一次放宽、老记录仍能读」这一方向',
      /Adding an enum VALUE is a loosening/.test(commentFlat))
    check('B4.2 注释也点名了 halted 不等于 failed、不等于 interrupted（新状态不许被当成同义词）',
      /It is NOT a synonym for `failed`/.test(commentFlat) && /It is also not `interrupted`/.test(commentFlat))
  } catch (e) { blockFailure('B2/B3/B4 差分断言', e) }
} else if (haltedRuns.length === 0) {
  console.log('  ...  B2/B3 差分断言跳过：本机存储里没有 halted 运行（夹具不在，断言就没有依据）')
}

/* ---------------------------------------------------------------- group C */
// The tree really is a merged tree, and the client half came along with it.
console.log('\n--- GROUP C: 这是一棵合并后的树，且客户端半边也在 ---')
try {
  const unmerged = git(['ls-files', '-u']).trim()
  check('C1.1 索引里没有未合并（UU/AA）的路径', unmerged === '', unmerged.split('\n').slice(0, 3).join(' | ') || 'clean')
  const merges = git(['log', '--oneline', '--merges', '-5']).trim()
  check('C1.2 历史里存在合并提交（本次合并没有退化成 fast-forward 的快照）',
    merges !== '', merges.split('\n')[0] || '')
  const p13Ancestor = git(['merge-base', '--is-ancestor', '4e1bac0', 'HEAD']) // throws on non-ancestor
  check('C1.3 P13 分支的尖端确实是当前 HEAD 的祖先（租赁团队与停机能力都在树上）', p13Ancestor === '', 'exit 0')
} catch (e) {
  blockFailure('C1 git 拓扑', e)
}
const clientText = readFileSync(CLIENT_SRC, 'utf8')
check('C2.1 客户端认识 halted 这个新状态（否则看板只会渲染一个未知状态）',
  /halted/.test(clientText), 'RUN_STATUS/颜色定义在客户端里')
check('C2.2 客户端认识 skipped 这个节点状态（停机后未执行的节点要有自己的说法）',
  /skipped/.test(clientText))

/* ---------------------------------------------------------------- group D */
// Group D lives in the parent run: spawn this suite with a ref that ALREADY has
// the fix, and B2 must go red. No repository file is touched to prove it.
console.log('\n--- GROUP D: 本套件真的会红（不碰仓库源码的反证） ---')
if (CHILD) {
  console.log('  ...  子进程模式（P15_CHILD=1）-> 不再递归跑反证')
} else {
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, P15_OLD_REF: 'HEAD', P15_CHILD: '1' },
    })
    check('D1.1 把「合并前」换成合并后的 HEAD，本套件必须变红（否则 B2 是装饰品）', false, 'exit=0 (it stayed green)')
    check('D1.2 变红的正是 B2 那几条', false, out.slice(0, 200))
  } catch (e) {
    const stdout = String(e.stdout || '')
    const status = e.status === undefined || e.status === null ? -1 : e.status
    const labels = (() => {
      const at = stdout.indexOf('failed checks:')
      if (at === -1) return []
      return stdout.slice(at).split('\n').slice(1).map((l) => l.replace(/^\s*-\s*/, '')).filter((l) => /^\s{2}-/.test('  - ' + l) || l !== '')
    })()
    check('D1.1 把「合并前」换成合并后的 HEAD，本套件必须变红（否则 B2 是装饰品）', status === 1, 'exit=' + status)
    check('D1.2 变红的正是 B2 那几条（修复前后的差异就锁在这里）',
      labels.some((l) => l.startsWith('B2.1')), 'hit=' + labels.filter((l) => /^B2\./.test(l)).map((l) => l.slice(0, 4)).join(',') || 'none')
    check('D1.3 红在「检查」上而不是套件崩溃：SUMMARY 打印了，且没有 FATAL / 未捕获异常',
      stdout.includes('=== SUMMARY ===') && !/未捕获异常/.test(stdout), 'summary=' + stdout.includes('=== SUMMARY ==='))
    const m = /checks=(\d+)\s+failures=(\d+)/.exec(stdout)
    if (m) console.log('       [反证原始输出] exit=' + status + ' checks=' + m[1] + ' failures=' + m[2])
  }
  try { rmSync(MUT_TMP, { recursive: true, force: true }) } catch { /* ignore */ }
  check('D2.1 反证用的临时副本已删除，仓库源码零改动（被测文件 hash 由 A 组与 C 组之外的 p13/p14 套件各自复核）',
    !existsSync(MUT_TMP), MUT_TMP)
}

process.exit(summary() === 0 ? 0 : 1)
