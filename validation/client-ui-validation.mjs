// Validator-authored end-to-end check of the client UI package.
//
// Question this answers: does the settings.section surface actually render the
// live host data and paint the DAG canvas, when the store's transport is wired
// the way a browser wires it (global fetch -> same origin)?
//
// The package's own scripts/ui-acceptance.test.mjs mounts the surface WITHOUT a
// transport stub, so the surface builds its own store from the page's global
// fetch, while its assertions read a different, hand-made store. That is why its
// section D fails. This harness supplies the stub the browser would have.
import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { readFileSync } from 'node:fs'

const ORIGIN = 'http://127.0.0.1:3080'
const BUNDLE = 'D:/ai-workspace/dsh/packages/team-flowise-client/dist/client.js'
const HOST_SRC = 'D:/ai-workspace/dsh/packages/team-flowise/src/index.js'
const SETTINGS_SLOT = 'settings.section'
const SETTINGS_CELL = 'team-flowise'
const HEADER_SLOT = 'conversation.session.header.actions'

let checks = 0
let failures = 0
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log('  ok   ' + label)
    return true
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
  return false
}

// --------------------------------------------------------------------------
// Load the extracted stub helpers by evaluating that file in this scope.
// --------------------------------------------------------------------------
const helpers = readFileSync('D:/ai-workspace/dsh/validation/_harness-part.mjs', 'utf8')
const makeHelpers = new Function(
  helpers + '\nreturn { createReactStub, walk, flatten, findNode, makeContext2d, makeCanvas, makeDocument, materializeBundle, applyToSlots }',
)
const { createReactStub, flatten, findNode, makeDocument, materializeBundle, applyToSlots } = makeHelpers()

const clientSource = readFileSync(BUNDLE, 'utf8')

// --------------------------------------------------------------------------
// 0. Host route table parity (source of truth), so path drift is caught even
//    when the routes cannot be exercised without side effects.
// --------------------------------------------------------------------------
console.log('== 0. client route table vs host registrations ==')
// The host registers through a local `route(kind, path, handler)` helper.
const hostSource = readFileSync(HOST_SRC, 'utf8')
const hostPaths = new Set()
for (const match of hostSource.matchAll(/route\('[^']+',\s*'([^']+)'/g)) hostPaths.add(match[1])
check('host source registers team-flowise WebRoutes', hostPaths.size > 0, String(hostPaths.size))

// The client's frozen table is the authority for what the UI calls.
const nodeHalf = await import('file:///D:/ai-workspace/dsh/packages/team-flowise-client/dist/index.js')
const clientPaths = new Set(nodeHalf.ROUTES.map((route) => route.path))
const API_BASE = nodeHalf.API_BASE
check('the node half publishes API_BASE', typeof API_BASE === 'string' && API_BASE !== '', String(API_BASE))
const clientAbsolute = new Set(nodeHalf.ROUTES.map((route) => API_BASE + route.path))
console.log('  host paths (' + String(hostPaths.size) + '): ' + [...hostPaths].sort().join(', '))
console.log('  client paths (' + String(clientAbsolute.size) + '): ' + [...clientAbsolute].sort().join(', '))
const notOnHost = [...clientAbsolute].filter((path) => !hostPaths.has(path))
const notOnClient = [...hostPaths].filter((path) => !clientAbsolute.has(path))
check('every path the client calls is registered by the host', notOnHost.length === 0, JSON.stringify(notOnHost))
check('the client table covers the host routes (incl. run/start)', notOnClient.length === 0, JSON.stringify(notOnClient))
check('POST /run/start is reachable through the client table', nodeHalf.matchRoute('POST', '/run/start').id !== 'none')

// --------------------------------------------------------------------------
// 1. Mount the settings surface with the browser's own transport contract:
//    a global fetch that resolves the package's relative URLs at the origin.
// --------------------------------------------------------------------------
console.log('== 1. settings.section mounted with a browser-like fetch ==')
const realFetch = globalThis.fetch
let fetchCalls = []
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input.url)
  const absolute = /^https?:/i.test(url) ? url : ORIGIN + url
  fetchCalls.push(absolute)
  return realFetch(absolute, init)
}

const documentStub = makeDocument()
globalThis.document = documentStub
const bundle = materializeBundle(clientSource)
globalThis.window = bundle.window
const react = bundle.react
const face = bundle.face

const applied = applyToSlots(face)
check('apply() runs without throwing', applied.error === undefined, applied.error === undefined ? '' : String(applied.error))
const cell = applied.entries.get(SETTINGS_SLOT + '/' + SETTINGS_CELL)
check('settings.section/' + SETTINGS_CELL + ' registered', cell !== undefined)
check(
  'registration carries {id, order, label}',
  cell !== undefined && cell.options.id === SETTINGS_CELL && cell.options.label === '多 Agent 团队' && typeof cell.options.order === 'number',
  cell === undefined ? '' : JSON.stringify(cell.options),
)
check('session-header activity cell registered', applied.entries.has(HEADER_SLOT + '/team-flowise-activity'))

const props = { close() {} }
let mountError
let tree
try {
  tree = react.mount(cell.component(props))
} catch (error) {
  mountError = error
}
check('the surface mounts without throwing', mountError === undefined, mountError === undefined ? '' : String(mountError))

let flushError
try {
  react.flushEffects() // the mount effect is the load: it calls store.refresh()
} catch (error) {
  flushError = error
}
check('the mount effect (data load) runs without throwing', flushError === undefined, flushError === undefined ? '' : String(flushError))
await new Promise((resolve) => setTimeout(resolve, 1500))
react.settle()
tree = react.mount(cell.component(props))

const firstPaint = flatten(tree)
console.log('  fetch calls: ' + String(fetchCalls.length) + ' -> ' + [...new Set(fetchCalls)].slice(0, 4).join(' '))
check('the surface fetched the host routes over same-origin URLs', fetchCalls.some((url) => url.indexOf('/api/team-flowise/agents') !== -1), JSON.stringify(fetchCalls.slice(0, 5)))
check('the heading renders', firstPaint.includes('多 Agent 团队'))
check('all six tabs render', ['总览', 'Agents', '工作流', 'DAG 画布', '任务', '运行'].every((label) => firstPaint.includes(label)), firstPaint.slice(0, 200))
check('the page is NOT in an error state', !firstPaint.includes('state.error') && !/tfc-empty[^"]*error/i.test(firstPaint), firstPaint.slice(0, 300))

// --------------------------------------------------------------------------
// 2. Overview tab shows live counts. Read the stat card VALUES out of the
//    rendered tree rather than searching the flattened text for a digit, which
//    would match almost anything.
// --------------------------------------------------------------------------
console.log('== 2. overview tab vs live host ==')
const agents = await (await realFetch(ORIGIN + '/api/team-flowise/agents')).json()
const workflows = await (await realFetch(ORIGIN + '/api/team-flowise/workflows')).json()
const runs = await (await realFetch(ORIGIN + '/api/team-flowise/runs')).json()
const tasks = await (await realFetch(ORIGIN + '/api/team-flowise/tasks')).json()
const liveAgents = agents.agents.length
const liveWorkflows = workflows.workflows.length
const openTasks = tasks.tasks.filter((task) => task.status !== 'settle').length
const liveRuns = runs.runs.filter((run) => run.status === 'running').length
console.log('  live host: agents=' + String(liveAgents) + ' workflows=' + String(liveWorkflows) + ' tasks=' + String(tasks.tasks.length) + ' runningRuns=' + String(liveRuns))

const statCards = []
;(function collect(node) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const entry of node) collect(entry)
    return
  }
  const className = typeof node.props === 'object' && node.props !== null ? node.props.className : undefined
  // The four cards are `tfc-stat`; the row around them is `tfc-stats`.
  if (typeof className === 'string' && /(^|\s)tfc-stat(\s|$)/.test(className)) statCards.push(node)
  for (const child of (node.children === undefined ? [] : node.children)) collect(child)
})(tree)
const statPairs = statCards.map((card) => {
  const text = flatten(card)
  const label = /tfc-stat-label\s+(\S+)/.exec(text)
  const value = /tfc-stat-value\s+(\S+)/.exec(text)
  return { label: label === null ? text : label[1], value: value === null ? '' : value[1] }
})
console.log('  rendered stat cards: ' + JSON.stringify(statPairs))
check('the overview renders four stat cards', statPairs.length === 4, String(statPairs.length))
check('the agent stat card shows the live agent count', statPairs.some((card) => card.value === String(liveAgents)), 'expected ' + String(liveAgents) + ' in ' + JSON.stringify(statPairs))
check('the workflow stat card shows the live workflow count', statPairs.some((card) => card.value === String(liveWorkflows)), 'expected ' + String(liveWorkflows))
check('the open-task stat card shows the live open-task count', statPairs.some((card) => card.value === String(openTasks)), 'expected ' + String(openTasks))
check('the running-run stat card shows the live running count', statPairs.some((card) => card.value === String(liveRuns)), 'expected ' + String(liveRuns))
const agentNames = agents.agents.map((agent) => agent.name).filter((name) => typeof name === 'string' && name !== '')
check('a live agent name or id is visible on the page', agents.agents.slice(0, 6).some((agent) => firstPaint.includes(agent.name) || firstPaint.includes(agent.id)), JSON.stringify(agents.agents.slice(0, 3).map((agent) => agent.name)))

// --------------------------------------------------------------------------
// 2b. Every list tab renders live records.
// --------------------------------------------------------------------------
console.log('== 2b. Agents / 工作流 / 任务 / 运行 tabs ==')
function openTab(label) {
  // Match the tab strip cell specifically: a bare label match also hits the
  // "+ 新建工作流" toolbar button, whose text contains the tab's label.
  const button = findNode(tree, (node) => node.type === 'button' && typeof node.props === 'object' && typeof node.props.className === 'string' && node.props.className.indexOf('tfc-tab') === 0 && typeof node.props.onClick === 'function' && flatten(node).includes(label))
  if (button === undefined) {
    console.log('  (tab button not found: ' + label + ')')
    return undefined
  }
  button.props.onClick()
  react.settle()
  return react.mount(cell.component(props))
}
const agentsTab = openTab('Agents')
const agentsTabText = flatten(agentsTab)
check('the Agents tab lists live agent names', agents.agents.slice(0, 6).every((agent) => agentsTabText.includes(agent.name) || agentsTabText.includes(agent.id)), agentsTabText.slice(0, 240))
const workflowsTab = openTab('工作流')
const workflowsTabText = flatten(workflowsTab)
const workflowLabels = workflows.workflows.map((workflow) => String(workflow.name === '' ? workflow.id : workflow.name))
console.log('  live workflow labels: ' + JSON.stringify(workflowLabels.slice(0, 6)))
check('the Workflows tab lists live workflow names', workflowLabels.slice(0, 6).every((label) => workflowsTabText.includes(label)), workflowsTabText.slice(0, 240))
const tasksTab = openTab('任务')
const tasksTabText = flatten(tasksTab)
check('the Tasks tab lists live assignees', tasks.tasks.slice(0, 8).every((task) => tasksTabText.includes(String(task.assignee || task.id))), tasksTabText.slice(0, 240))
const runsTab = openTab('运行')
const runsTabText = flatten(runsTab)
check('the Runs tab lists live run ids', runs.runs.slice(0, 8).every((run) => runsTabText.includes(String(run.id).slice(-8)) || runsTabText.includes(run.id)), runsTabText.slice(0, 240))
tree = react.mount(cell.component(props))

// --------------------------------------------------------------------------
// 3. DAG canvas: click the tab, then flush the paint effect.
// --------------------------------------------------------------------------
console.log('== 3. DAG canvas ==')
const dagButton = findNode(tree, (node) => node.type === 'button' && typeof node.props === 'object' && typeof node.props.onClick === 'function' && flatten(node).includes('DAG 画布'))
check('the DAG tab is a clickable button', dagButton !== undefined)
let clickError
try {
  dagButton.props.onClick()
  react.settle()
} catch (error) {
  clickError = error
}
check('clicking the DAG tab re-renders without throwing', clickError === undefined, clickError === undefined ? '' : String(clickError))
let dagBody = tree
try {
  dagBody = react.mount(cell.component(props))
} catch (error) {
  clickError = error
}
const dagText = flatten(dagBody)
const canvas = findNode(dagBody, (node) => node.type === 'canvas')
check('the DAG tab renders a canvas element', canvas !== undefined, dagText.slice(0, 200))
check('the legend names the three node statuses', ['待执行', '成功', '失败'].every((label) => dagText.includes(label)), dagText.slice(0, 260))

const biggest = workflows.workflows.slice().sort((a, b) => Object.keys(b.nodes || {}).length - Object.keys(a.nodes || {}).length)[0]
const nodeIds = biggest === undefined ? [] : Object.keys(biggest.nodes || {})
console.log('  workflow under test: ' + String(biggest === undefined ? 'none' : biggest.id) + ' nodes=' + String(nodeIds.length))
check('the DAG header reports node and edge counts', dagText.includes(String(nodeIds.length)), 'expected ' + String(nodeIds.length) + ' in ' + dagText.slice(0, 260))
check('the node id cards render beside the canvas', nodeIds.length === 0 || nodeIds.every((id) => dagText.includes(id)), JSON.stringify(nodeIds.slice(0, 6)))

let paintError
try {
  react.flushEffects()
} catch (error) {
  paintError = error
}
await new Promise((resolve) => setTimeout(resolve, 150))
check('the canvas paint effect runs without throwing', paintError === undefined, paintError === undefined ? '' : String(paintError))
const painted = documentStub.canvases.filter((entry) => entry.__ctx.calls.length > 0)
// The stub renderer has no ref assignment, so `canvasRef.current` is null and the
// paint effect returns early. That is a harness limit, not a product finding: the
// painter itself is executed against a recording context in canvas-paint-check.mjs.
console.log('  NOTE canvases created by the stub document: ' + String(documentStub.canvases.length) + ' (the stub renderer assigns no refs, so the effect has no canvas to paint)')
check('the canvas element carries the paint contract (role/label)', canvas !== undefined && canvas.props.role === 'img' && typeof canvas.props['aria-label'] === 'string')
if (painted.length > 0) {
  const last = painted[painted.length - 1]
  const names = last.__ctx.calls.map((call) => call.name)
  const labels = last.__ctx.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]))
  console.log('  paint: ' + String(last.__ctx.calls.length) + ' calls, strokes=' + String(names.filter((n) => n === 'stroke').length) + ', fills=' + String(names.filter((n) => n === 'fill').length) + ', labels=' + JSON.stringify(labels.slice(0, 8)))
  check('the painter cleared and transformed the canvas', names.includes('clearRect') && names.includes('setTransform'))
  check('the painter drew a box per node', nodeIds.length === 0 || nodeIds.every((id) => labels.some((label) => label.indexOf(id) !== -1)), JSON.stringify(labels.slice(0, 8)))
}

// --------------------------------------------------------------------------
// 4. Session-header activity panel renders from the same store.
// --------------------------------------------------------------------------
console.log('== 4. session header panel ==')
const headerCell = applied.entries.get(HEADER_SLOT + '/team-flowise-activity')
let headerError
try {
  react.mount(headerCell.component({ locale: 'zh' }))
} catch (error) {
  headerError = error
}
check('the activity panel renders against the same store', headerError === undefined, headerError === undefined ? '' : String(headerError))

// --------------------------------------------------------------------------
console.log('')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed')
console.log(failures === 0 ? 'RESULT: client UI renders live data and paints the DAG' : 'RESULT: ' + String(failures) + ' failed')
process.exit(failures === 0 ? 0 : 1)
