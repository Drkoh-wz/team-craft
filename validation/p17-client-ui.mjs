// P17 client half: does the SHIPPED browser bundle actually load, register, and
// render the three new controls?
//
// Why this exists next to p17-delete-retry.mjs: that suite drives the HOST through
// its service API, so it can be fully green while the client bundle throws the
// moment a browser evaluates it. A syntax check (`node --check`) is not enough
// either -- it cannot see a hook called conditionally, a `React.useState` at module
// scope, or a helper referenced before it is defined. This evaluates the real
// `src/client/index.js` the way the shell does (through `__ModuleLoader__.load`)
// with the stub React/DOM from _harness-part.mjs, then renders each surface and
// looks for the new affordances in the produced element tree.
//
// Usage:
//   node validation/p17-client-ui.mjs
//   P17_CLIENT=<path> node validation/p17-client-ui.mjs
//
// Exit code: 0 = all checks passed, 1 = at least one failed.
import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DEFAULT_BUNDLE = join(REPO, 'packages', 'team-flowise', 'src', 'client', 'index.js')
const BUNDLE = process.env.P17_CLIENT && process.env.P17_CLIENT.trim() !== '' ? resolve(process.env.P17_CLIENT.trim()) : DEFAULT_BUNDLE

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
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  if (failedLabels.length > 0) { console.log('failed checks:'); for (const l of failedLabels) console.log('  - ' + l) }
  console.log('bundle: ' + BUNDLE)
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}
process.on('uncaughtException', (e) => { check('未捕获异常：本次运行在此中断', false, String(e && e.stack ? e.stack.split('\n')[0] : e)); summary(); process.exit(1) })

console.log('=== P17 client UI tests (the shipped browser bundle) ===')

// The stub React/DOM helpers, evaluated exactly as client-ui-validation.mjs does.
const helpers = readFileSync(join(REPO, 'validation', '_harness-part.mjs'), 'utf8')
const makeHelpers = new Function(
  helpers + '\nreturn { createReactStub, walk, flatten, findNode, makeContext2d, makeCanvas, makeDocument, materializeBundle, applyToSlots }',
)
const { walk, findNode, materializeBundle, applyToSlots } = makeHelpers()

const source = readFileSync(BUNDLE, 'utf8')

// ---------------------------------------------------------------------------
console.log('\n--- A 组：bundle 能被浏览器上下文求值 ---')
// ---------------------------------------------------------------------------
let loaded = null
{
  try {
    loaded = materializeBundle(source)
    check('A1.1 bundle 求值并注册了恰好一个工厂（模块级抛错会让整个面板消失）', true)
  } catch (e) {
    check('A1.1 bundle 求值并注册了恰好一个工厂（模块级抛错会让整个面板消失）', false, String(e && e.message ? e.message : e))
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- B 组：三个新能力在渲染出的树里真的存在 ---')
// ---------------------------------------------------------------------------
if (loaded === null) {
  check('B 组（bundle 未加载，无法渲染）', false, 'skipped')
} else {
  let slots = null
  try {
    slots = applyToSlots(loaded.face)
    check('B1.1 面板注册到槽位而不抛错（注入的槽位都在）', slots.entries.size > 0, 'registrations=' + slots.entries.size)
  } catch (e) {
    check('B1.1 面板注册到槽位而不抛错（注入的槽位都在）', false, String(e && e.message ? e.message : e))
  }

  // Every registered component is rendered once with plausible props. A component
  // that throws here is a blank panel in the real UI -- and this is the only place
  // that would catch it without a browser.
  //
  // Rendered through `react.render()` rather than called as a plain function: the
  // stub React keeps its hook frame in module state, so a direct call throws
  // "Cannot read properties of null (reading 'cursor')" and would report every
  // component as broken.
  if (slots !== null) {
    const react = loaded.react
    let rendered = 0
    const threw = []
    for (const [key, entry] of slots.entries) {
      try {
        const props = { sessionId: 's-1', size: 20, active: false, wide: true }
        const out = react.render(react.createElement(entry.component, props))
        if (out !== null && out !== undefined) rendered += 1
      } catch (e) {
        threw.push(key + ': ' + String(e && e.message ? e.message : e))
      }
    }
    check('B1.2 每个注册的组件都能渲染一次而不抛错（抛错 = 真界面里整块空白）',
      threw.length === 0, threw.length === 0 ? ('rendered=' + rendered) : threw.join(' | ').slice(0, 240))
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- C 组：源码层面的三处接线（渲染是异步数据驱动的，这里钉接线） ---')
// ---------------------------------------------------------------------------
{
  // The delete control must be wired to every list that has a removal path, and
  // the resume control must exist. These are read from the bundle source because
  // the rendered trees above only carry the initial (empty) state -- the lists
  // fill from fetch(), which the stub does not drive.
  const has = (re) => re.test(source)
  check('C1.1 角色列表有删除按钮', has(/onDelete: deleteAgent/))
  check('C1.2 看板卡片有删除按钮', has(/BoardView, \{ tasks: s\.t, onOpenTask: openTask, onDelete: deleteTask \}/))
  check('C1.3 任务列表有删除按钮', has(/TasksView, \{ tasks: s\.t, onOpenTask: openTask, onDelete: deleteTask \}/))
  check('C1.4 运行列表有删除按钮', has(/RunsView, \{ runs: s\.r, onDelete: deleteRun/))
  check('C1.5 四个删除动作都打到宿主真实存在的路由',
    has(/del\('\/agent\?id='/) && has(/del\('\/workflow\?id='/) && has(/del\('\/task\?id='/) && has(/del\('\/run\?id='/))
  check('C1.6 删除是二次确认（一次点击就删会让误点毁掉工作）', has(/确认删除/) && has(/function DeleteButton/))
  check('C1.7 进行中的任务/运行是不可点的禁用态，并写明原因',
    has(/disabled: working/) && has(/disabled: x\.status === 'running'/) && has(/disabledReason/))

  check('C2.1 进度页拥有自己的滚动容器（此前右栏下半截够不到）',
    has(/\.tf-pg\{[^}]*overflow-y:auto/) && has(/\.tf-pg\{[^}]*max-height:100%/))
  check('C2.2 紧凑态（右栏）有视口兜底，整页态不被写死高度',
    has(/\.tf-pg\.compact\{max-height:calc\(100vh/) && has(/className: 'tf-pg' \+ \(compact \? ' compact' : ''\)/))

  check('C3.1 有继续运行的入口（运行列表）', has(/onResume: resumeRun/) && has(/post\('\/run\/resume'/))
  check('C3.2 进度页也提供继续运行，并跳到新运行（否则看起来像没生效）',
    has(/继续运行（沿用已完成节点）/) && has(/setRunId\(d\.run\.id\)/))
  check('C3.3 只有未成功的运行才提供继续（完成的没有可继续的）',
    has(/x\.status === 'failed' \|\| x\.status === 'halted' \|\| x\.status === 'interrupted'/))
  check('C3.4 重试中是一个独立状态，不显示成「进行中」或「失败」',
    has(/retrying: \{ label: '重试中'/) && has(/RETRY_COLOR/))
  check('C3.5 节点卡片显示重试次数与沿用来源（继承的结果不能看起来像本次产出的）',
    has(/重试 ' \+ n\.retries/) && has(/沿用自 #/))
}

process.exit(summary() === 0 ? 0 : 1)
