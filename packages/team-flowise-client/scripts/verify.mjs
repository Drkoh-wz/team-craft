// Build verification for @local/team-flowise-client.
//
// Two acceptance criteria are checked mechanically here rather than by eye:
//
//   1. The package is buildable — `dist/index.js` and `dist/client.js` exist and
//      `node --check` parses both.
//   2. The package is loadable in Node — `import('@local/team-flowise-client')`
//      resolves, and its pure contract functions (route matching, record
//      reducers, DAG layout) return the expected geometry. The browser bundle is
//      additionally EXECUTED against a stub `window.__ModuleLoader__`, a stub
//      `require`, and a minimal renderer, which is the only way to prove the
//      factory face (`{ name?, inject, apply }`) is really reachable and that
//      `apply` registers both slot entries without touching a real DOM.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
let checks = 0

/**
 * Record one check.
 *
 * @param label - what was checked.
 * @param condition - the outcome.
 * @param detail - optional extra context printed on failure.
 */
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

/** Deep-ish structural equality for the plain values asserted below. */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

console.log('# artifacts')
const nodeEntry = join(root, 'dist', 'index.js')
const clientEntry = join(root, 'dist', 'client.js')
check('dist/index.js exists', existsSync(nodeEntry))
check('dist/client.js exists', existsSync(clientEntry))
if (!existsSync(nodeEntry) || !existsSync(clientEntry)) {
  console.log('\n' + String(failures) + ' of ' + String(checks) + ' checks failed (run `npm run build` first)')
  process.exit(1)
}
const clientSource = readFileSync(clientEntry, 'utf8')
check('client bundle registers via __ModuleLoader__.load', clientSource.includes('window.__ModuleLoader__.load('))
check('client bundle declares the package id', clientSource.includes('"@local/team-flowise-client"'))
check('client bundle declares module/exports inside the factory', clientSource.includes('var module = { exports: {} };'))
check('client bundle ends at the factory close', clientSource.trimEnd().endsWith('});'))
check('client bundle carries no source-map trailer', !clientSource.includes('sourceMappingURL'))

console.log('# node half')
const api = await import(pathToFileURL(nodeEntry).href)
check('exports describeClient', typeof api.describeClient === 'function')
check('exports layoutDag', typeof api.layoutDag === 'function')
check('exports matchRoute', typeof api.matchRoute === 'function')
const description = api.describeClient()
check('describeClient reports 13 host routes', description.routes.length === 13, String(description.routes.length))
check('describeClient reports both slot contributions', description.contributions.length === 2)
check(
  'settings contribution targets settings.section',
  description.contributions.filter((entry) => entry.slot === 'settings.section').length === 1,
)
check(
  'header contribution targets session header actions',
  description.contributions.filter((entry) => entry.slot === 'conversation.session.header.actions').length === 1,
)
check('describeClient output is JSON-safe', typeof JSON.stringify(description) === 'string')

console.log('# route table')
check('GET /agents matches', api.matchRoute('GET', '/agents').id === 'agents.list')
check('HEAD resolves to the GET route', api.matchRoute('HEAD', '/agents').id === 'agents.list')
check('POST /run/start matches', api.matchRoute('POST', '/run/start').id === 'runs.start')
check('DELETE /workflow matches', api.matchRoute('DELETE', '/workflow').id === 'workflows.delete')
check('an unknown path does not match', api.matchRoute('GET', '/nope').id === 'none')
check('routeUrl encodes ids', api.routeUrl('runs.get', { id: 'a b' }) === '/api/team-flowise/run?id=a%20b', String(api.routeUrl('runs.get', { id: 'a b' })))
check('routeUrl drops empty query values', api.routeUrl('runs.get', { id: '' }) === '/api/team-flowise/run')

console.log('# record reducers')
const agent = api.pickAgent({ id: 'a1', name: 'qa', role: 'reviewer', model: { provider: 'deepseek', model: 'deepseek-chat' }, tools: { deny: ['pwsh'] }, skills: ['x'] })
check('pickAgent keeps scalars', agent.name === 'qa' && agent.provider === 'deepseek' && same(agent.deny, ['pwsh']))
check('pickAgent rejects a non-object', api.pickAgent(null) === null)
const workflow = api.pickWorkflow({ id: 'w1', name: 'wf', nodes: { plan: { agent: 'pm', dependsOn: [] }, build: { agent: 'dev', dependsOn: ['plan'] } } })
check('pickWorkflow flattens nodes', workflow.nodes.length === 2 && workflow.nodes[1].dependsOn[0] === 'plan')
const task = api.pickTask({ id: 't1', status: 'working', iteration: 2, history: [{ iteration: 2, status: 'reworked', at: 5, feedback: 'redo' }] })
check('pickTask decodes history', task.steps.length === 1 && task.steps[0].feedback === 'redo')
const run = api.pickRun({ id: 'r1', status: 'running', nodeStates: { plan: { status: 'completed' }, build: { status: 'failed', error: 'boom' } }, result: { summary: 'partial' } })
check('pickRun keeps node scalars', run.nodes.length === 2 && run.summary === 'partial')
check('runProgress counts completed nodes', api.runProgress(run) === 50, String(api.runProgress(run)))

console.log('# DAG layout')
const layout = api.layoutDag([
  { id: 'plan', dependsOn: [] },
  { id: 'build', dependsOn: ['plan'] },
  { id: 'test', dependsOn: ['build'] },
  { id: 'docs', dependsOn: ['plan'] },
])
check('no cycle reported', layout.cyclic.length === 0)
check('three dependency waves', layout.layers.length === 3, String(layout.layers.length))
check('layer 0 is the root', same(layout.layers[0], ['plan']))
check('layer 1 keeps both children', layout.layers[1].length === 2)
check('edges equal dependencies', layout.edges.length === 3, String(layout.edges.length))
check('an edge always points to a later layer', layout.edges.every((edge) => {
  const from = layout.nodes.filter((node) => node.id === edge.from)[0]
  const to = layout.nodes.filter((node) => node.id === edge.to)[0]
  return to.layer === from.layer + 1
}))
check('terminal nodes are leaves', same(layout.terminalIds.slice().sort(), ['docs', 'test']))
check('canvas size is positive', layout.width > 0 && layout.height > 0)
const cyclic = api.layoutDag([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])
check('a cycle is reported', cyclic.cyclic.length === 2, JSON.stringify(cyclic.cyclic))
check('a cycle still lays nodes out', cyclic.nodes.length === 2)
const missing = api.layoutDag([{ id: 'a', dependsOn: ['ghost'] }])
check('a dangling dependency is flagged', same(missing.nodes[0].missingDeps, ['ghost']))
const decorated = api.decorateDag(layout, [{ id: 'plan', status: 'completed' }])
check('decorateDag merges run state', decorated.filter((node) => node.id === 'plan')[0].status === 'completed')
check('decorateDag defaults to pending', decorated.filter((node) => node.id === 'build')[0].status === 'pending')

console.log('# browser bundle (executed against a stub module system)')
/** A minimal React stand-in: enough for element trees, hooks, and effects. */
function createReactStub() {
  const states = []
  let cursor = 0
  const internals = {
    useState(initial) {
      const index = cursor
      cursor += 1
      if (states[index] === undefined) states[index] = typeof initial === 'function' ? initial() : initial
      const setter = (next) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next
      }
      return [states[index], setter]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (states[index] === undefined) states[index] = { current: initial }
      return states[index]
    },
    useMemo(factory) {
      cursor += 1
      return factory()
    },
    useCallback(fn) {
      cursor += 1
      return fn
    },
    useEffect() {
      // Deliberately not invoked: the surfaces poll on mount, and this script
      // checks that they RENDER, not that they fetch. Running the effect would
      // fire a real request per component under test.
      cursor += 1
      return undefined
    },
    useContext() {
      cursor += 1
      return undefined
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor += 1
      return getSnapshot()
    },
    createElement(type, props, ...children) {
      return { type, props: props === null || props === undefined ? {} : props, children }
    },
    createContext(defaultValue) {
      const context = { __teamContext: true, defaultValue }
      context.Provider = context
      return context
    },
    reset() {
      cursor = 0
    },
  }
  return internals
}

const reactStub = createReactStub()
const registrations = []
const unregistered = []
const effects = []
const slotEntries = new Map()
const fakeWindow = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
  devicePixelRatio: 1,
}

/** A `require` that answers the platform seeds and nothing else. */
function fakeRequire(specifier) {
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') return { jsx: reactStub.createElement, jsxs: reactStub.createElement }
  throw new Error('unexpected external require: ' + specifier)
}

globalThis.window = fakeWindow
const evaluate = new Function('window', 'require', 'document', 'setTimeout', 'clearTimeout', 'globalThis', clientSource)
evaluate(fakeWindow, fakeRequire, undefined, setTimeout, clearTimeout, globalThis)

check('the bundle registered exactly one factory', registrations.length === 1, String(registrations.length))
const registration = registrations[0]
check('the factory is addressed by package id', registration !== undefined && registration.id === '@local/team-flowise-client')
const moduleExports = registration.factory(fakeRequire)
check('the factory returns a plugin face', moduleExports !== null && typeof moduleExports === 'object')
check('the face declares inject', Array.isArray(moduleExports.inject) && moduleExports.inject.indexOf('slots') !== -1)
check('the face exports apply', typeof moduleExports.apply === 'function')

const fakeSlots = {
  inject(name, callback) {
    effects.push({ kind: 'inject', name })
    return callback()
  },
  register(options, component) {
    slotEntries.set(name0(options), { options, component })
    return () => {
      unregistered.push(options.id)
    }
  },
}
/** The slot name a registration used. */
function name0(options) {
  return options.name + '/' + String(options.id)
}
const fakeLocale = {
  register(namespace, dictionaries) {
    if (dictionaries === null || typeof dictionaries !== 'object') throw new Error('bad dictionaries')
    return () => {}
  },
}
let styleInjected = 0
const fakeDocument = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '', parentNode: null }),
  head: {
    appendChild() {
      styleInjected += 1
    },
  },
  addEventListener() {},
  removeEventListener() {},
}

const ctx = {
  get(name) {
    if (name === 'slots') return fakeSlots
    if (name === 'locale') return fakeLocale
    return undefined
  },
  effect(callback) {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  logger: { warn() {}, error() {} },
}

delete globalThis.window
let applyError
try {
  moduleExports.apply(ctx)
} catch (error) {
  applyError = error
}
check('apply runs without throwing', applyError === undefined, applyError === undefined ? '' : String(applyError && applyError.message))
check('apply injected into both slots', effects.filter((entry) => entry.kind === 'inject').length === 2, JSON.stringify(effects))
check('settings.section was registered', slotEntries.has('settings.section/team-flowise'))
check('session header action was registered', slotEntries.has('conversation.session.header.actions/team-flowise-activity'))
for (const [key, entry] of slotEntries) {
  check('registration ' + key + ' carries a component', typeof entry.component === 'function')
}

// Rendering the surfaces is what proves the component tree is well-formed. The
// stub renders elements without reconciliation, so this catches a bad element
// shape or a hook used outside a component, not a visual regression.
const settingsEntry = slotEntries.get('settings.section/team-flowise')
reactStub.reset()
let renderError
let tree
try {
  tree = settingsEntry.component({ close() {} })
} catch (error) {
  renderError = error
}
check('the settings section renders', renderError === undefined, renderError === undefined ? '' : String(renderError && renderError.message))
check(
  'the settings section wraps its page in a provider carrying the store',
  tree !== undefined && tree !== null && tree.type !== undefined && tree.type.name === 'TeamProvider' && tree.props.store !== undefined && tree.props.store !== null,
)
check('the settings section renders exactly one child', tree !== undefined && tree !== null && tree.children.length === 1)
check('the wrapped child is the settings page component', tree !== undefined && tree !== null && tree.children[0].type !== undefined && tree.children[0].type.name === 'TeamSettingsSection')
const headerEntry = slotEntries.get('conversation.session.header.actions/team-flowise-activity')
reactStub.reset()
let headerError
try {
  headerEntry.component({ locale: 'zh' })
} catch (error) {
  headerError = error
}
check('the header activity panel renders', headerError === undefined, headerError === undefined ? '' : String(headerError && headerError.message))

console.log('')
if (failures === 0) {
  console.log(String(checks) + ' checks passed')
  process.exit(0)
}
console.log(String(failures) + ' of ' + String(checks) + ' checks failed')
process.exit(1)
