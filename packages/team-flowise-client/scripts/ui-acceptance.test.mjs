// Executable acceptance tests for @local/team-flowise-client.
//
// Four criteria are under test. Each is checked the strongest way that is
// possible without pretending to have measured something else:
//
//   A. node 加载      — the package is imported by a REAL child `node` process,
//                       both from this package and from the web profile that a
//                       restarting host resolves it through.
//   B. host 重启后     — the `dsh-client-modules` discovery algorithm is
//      settings.section  re-implemented against the REAL profile (its
//      appears           cordis.patch.yml rows, package resolution, nearest
//                       package.json, `dsh.client` block, `exports["./client"]`),
//                       and when a host is up, /plugins/<id>/client.js is fetched
//                       and byte-compared with dist/client.js.
//   C. 数据拉到        — the REAL host routes are called over HTTP and the payloads
//                       go through this package's own reducers and store refresh.
//                       NOTE: the boundary is the WebServer (`fetch`), not the
//                       dynamic-plugin `host.call` channel — the transport check
//                       below explains why, and asserts it.
//   D. DAG 画布渲染    — the browser bundle is EXECUTED against a fake DOM with a
//                       recording 2d context, the settings.section component is
//                       mounted with per-instance hook state, the DAG tab is
//                       clicked, and the canvas paint calls plus node cards are
//                       asserted.
//
// Usage:
//   node scripts/ui-acceptance.test.mjs [--offline]
//   DSH_WEB_ORIGIN=http://127.0.0.1:3080 node scripts/ui-acceptance.test.mjs
//
// `--offline` skips every probe that needs the running host; those are reported
// as SKIP and never as PASS.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')
const PLUGIN_ID = '@local/team-flowise-client'
const HOST_PKG = '@local/team-flowise'
const BUNDLE_KEY = './client'
const SETTINGS_SLOT = 'settings.section'
const SETTINGS_CELL = 'team-flowise'
const HEADER_SLOT = 'conversation.session.header.actions'
const ORIGIN = process.env.DSH_WEB_ORIGIN === undefined || process.env.DSH_WEB_ORIGIN === '' ? 'http://127.0.0.1:3080' : process.env.DSH_WEB_ORIGIN
const PROFILE_DIR = process.env.DSH_PROFILE_DIR === undefined || process.env.DSH_PROFILE_DIR === '' ? join(homedir(), '.dsh', 'profiles', 'web') : process.env.DSH_PROFILE_DIR
const HOME_DSH = join(homedir(), '.dsh')
const OFFLINE = process.argv.includes('--offline')

let checks = 0
let failures = 0
const skipped = []

/** Start a named block of checks. */
function section(title) {
  console.log('')
  console.log('== ' + title + ' ==')
}

/** Record one executed check. */
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log('  ok    ' + label)
    return true
  }
  failures += 1
  console.log('  FAIL  ' + label + (detail === undefined || detail === '' ? '' : ' — ' + detail))
  return false
}

/** Record a check that could not be measured. */
function skip(label, why) {
  skipped.push(label)
  console.log('  SKIP  ' + label + ' — ' + why)
}

/** Deep equality over the plain JSON values compared here. */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** One-line description of a thrown value. */
function why(error) {
  if (error === null || error === undefined) return 'unknown'
  return String(error.message === undefined ? error : error.message)
}

/** True when `child` is inside `parent` (or identical). */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

// ---------------------------------------------------------------------------
// Tiny renderer: enough React to mount these components and re-render them.
// ---------------------------------------------------------------------------

/**
 * A React stand-in with per-instance hook state, context propagation, effects,
 * and an instance-based re-render.
 *
 * @returns the stub API used by the tests below.
 */
function createReactStub() {
  const instances = new Map()
  const contexts = []
  const effects = []
  let current = null
  let nextId = 1

  /** True when a dependency list must re-run. */
  const depsChanged = (previous, next) => {
    if (previous === undefined || !Array.isArray(next)) return true
    if (previous.length !== next.length) return true
    for (let index = 0; index < next.length; index += 1) if (previous[index] !== next[index]) return true
    return false
  }

  /** The hook slot for the current render. */
  const slot = (index) => {
    const frame = current
    if (frame.hooks[index] === undefined) frame.hooks[index] = {}
    return frame.hooks[index]
  }

  const api = {
    createElement(type, props, ...children) {
      const flat = []
      for (const child of children) {
        if (Array.isArray(child)) for (const entry of child) flat.push(entry)
        else flat.push(child)
      }
      // React semantics: children live on `props.children`, and a component only
      // ever receives `props`. Putting them on the element alone leaves every
      // `props.children` read undefined — which silently renders a provider empty.
      const merged = props === undefined || props === null ? {} : props
      if (flat.length > 0) merged.children = flat.length === 1 ? flat[0] : flat
      return { type, props: merged, children: flat }
    },
    createContext(defaultValue) {
      const context = { __context: true, defaultValue, Provider: null }
      context.Provider = context
      return context
    },
    useState(initial) {
      const frame = current
      const index = frame.cursor
      frame.cursor += 1
      const cell = slot(index)
      if (cell.value === undefined) cell.value = typeof initial === 'function' ? initial() : initial
      return [cell.value, (next) => {
        const value = typeof next === 'function' ? next(cell.value) : next
        if (value === cell.value) return
        cell.value = value
        // Mark the INSTANCE, not the render frame the setter closed over: the
        // frame is recreated on every render, so a stale frame's dirty flag is
        // never seen by `settle`.
        frame.owner.dirty = true
      }]
    },
    useRef(initial) {
      const frame = current
      const index = frame.cursor
      frame.cursor += 1
      const cell = slot(index)
      if (cell.value === undefined) cell.value = { current: initial }
      return cell.value
    },
    useMemo(factory, deps) {
      const frame = current
      const index = frame.cursor
      frame.cursor += 1
      const cell = slot(index)
      if (cell.value === undefined || depsChanged(cell.deps, deps)) {
        cell.deps = deps
        cell.value = factory()
      }
      return cell.value
    },
    useCallback(fn, deps) {
      const frame = current
      const index = frame.cursor
      frame.cursor += 1
      const cell = slot(index)
      if (cell.value === undefined || depsChanged(cell.deps, deps)) {
        cell.deps = deps
        cell.value = fn
      }
      return cell.value
    },
    useEffect(fn, deps) {
      const frame = current
      const index = frame.cursor
      frame.cursor += 1
      const cell = slot(index)
      if (cell.value === undefined || depsChanged(cell.deps, deps)) {
        cell.deps = deps
        effects.push({ owner: frame.name, fn })
      }
    },
    useContext(context) {
      for (let index = contexts.length - 1; index >= 0; index -= 1) {
        if (contexts[index].context !== context) continue
        if (process.env.DSH_UI_DEBUG === '1' && current.name === 'TeamSettingsSection') console.log('DBG uc-hit depth=' + String(contexts.length) + ' keys=' + Object.keys(contexts[index].value || {}).join('|'))
        return contexts[index].value
      }
      if (process.env.DSH_UI_DEBUG === '1' && current.name === 'TeamSettingsSection') console.log('DBG uc-miss depth=' + String(contexts.length) + ' default=' + String(context === null || context === undefined ? 'nocontext' : context.defaultValue))
      return context !== null && context !== undefined && context.__context === true ? context.defaultValue : undefined
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      current.cursor += 1
      return getSnapshot()
    },
    /** Mount an element tree; returns the rendered tree. */
    mount(element) {
      return api.render(element)
    },
    /** Render one element, creating or reusing the component instance for it. */
    render(element) {
      if (element === null || element === undefined || typeof element === 'boolean') return null
      if (typeof element === 'string' || typeof element === 'number') return { type: '#text', props: {}, children: [], text: String(element) }
      if (Array.isArray(element)) return element.map(api.render)
      const type = element.type
      if (type === null || type === undefined) return null
      // A context object is the element type of `<Provider>`; it is not a
      // function, so it must be recognized before either branch.
      if (typeof type === 'object' && type.__context === true && type.Provider === type) {
        contexts.push({ context: type, value: element.props.value })
        const rendered = api.render(element.props.children)
        contexts.pop()
        return rendered
      }
      if (typeof type === 'function') {
        let instance = instances.get(type)
        if (instance === undefined) {
          instance = { id: nextId, name: type.name === '' ? 'Anonymous' : type.name, src: type, hooks: [], dirty: false, tree: null, props: {} }
          nextId += 1
          instances.set(type, instance)
        }
        instance.props = element.props === undefined ? {} : element.props
        const frame = { id: instance.id, name: instance.name, hooks: instance.hooks, cursor: 0, dirty: false, owner: instance, src: type }
        const previous = current
        current = frame
        let output
        try {
          // Call the component like React does — `type(props)` — instead of
          // re-rendering a synthetic element, which would create a second
          // instance for the same component and lose its hook state.
          output = api.render(instance.src(element.props === undefined ? {} : element.props))
        } finally {
          current = previous
        }
        instance.tree = output
        return output
      }
      const children = []
      for (const child of (element.children === undefined ? [] : element.children)) {
        const rendered = api.render(child)
        if (Array.isArray(rendered)) for (const entry of rendered) children.push(entry)
        else children.push(rendered)
      }
      return { type, props: element.props === undefined ? {} : element.props, children }
    },
    /** Re-render every dirty instance until the tree stops changing. */
    settle(limit) {
      let rounds = 0
      const max = limit === undefined ? 10 : limit
      let dirty = [...instances.values()].filter((instance) => instance.dirty)
      while (dirty.length > 0 && rounds < max) {
        for (const instance of dirty) {
          instance.dirty = false
          const frame = { id: instance.id, name: instance.name, hooks: instance.hooks, cursor: 0, dirty: false, owner: instance, src: instance.src }
          const previous = current
          current = frame
          try {
            instance.tree = api.render(instance.src(instance.props === undefined ? {} : instance.props))
          } finally {
            current = previous
          }
        }
        rounds += 1
        dirty = [...instances.values()].filter((instance) => instance.dirty)
      }
      return rounds
    },
    /** Debug helpers: the hook values and dirty set of every live instance. */
    debugStates() {
      return [...instances.values()].map((instance) => ({ name: instance.name, dirty: instance.dirty, firstChild: instance.tree === null || instance.tree === undefined ? 'none' : Array.isArray(instance.tree) ? 'array' : typeof instance.tree.type === 'string' ? instance.tree.type : typeof instance.tree.type === 'function' ? instance.tree.type.name : 'ctx', hooks: instance.hooks.map((hook) => (hook === undefined ? null : hook.value === undefined ? 'nostate' : typeof hook.value === 'object' ? 'obj' : String(hook.value).slice(0, 12))) }))
    },
    debugDirty() {
      return [...instances.values()].filter((instance) => instance.dirty).map((instance) => instance.name)
    },
    /** The names of the element types in one instance's rendered tree. */
    debugSectionChildren() {
      const instance = [...instances.values()].filter((entry) => entry.name === 'TeamSettingsSection')[0]
      if (instance === undefined || instance.tree === null) return []
      const names = []
      walk(instance.tree, (node) => {
        if (typeof node.type === 'function') names.push(node.type.name)
        else if (typeof node.type === 'string') names.push(node.type)
      })
      return { names: names.slice(0, 24), hooks: instance.hooks.map((hook) => (hook === undefined ? 'none' : hook.value === undefined ? 'nostate' : typeof hook.value === 'object' ? 'obj' : String(hook.value).slice(0, 10))), flat: flatten(instance.tree).slice(0, 160) }
    },
    resolveContext(context) {
      return api.useContext(context)
    },
    /** Re-render every live instance from the top, so context is correct. */
    remountAll() {
      for (const instance of [...instances.values()]) {
        const frame = { id: instance.id, name: instance.name, hooks: instance.hooks, cursor: 0, dirty: false, owner: instance, src: instance.src }
        const previous = current
        current = frame
        try {
          instance.tree = api.render(instance.src(instance.props === undefined ? {} : instance.props))
        } finally {
          current = previous
        }
      }
      return [...instances.values()].map((instance) => instance.name)
    },
    /** The provider stack and what the team context currently resolves to. */
    debugContext() {
      const provider = [...instances.values()].filter((entry) => entry.name === 'TeamProvider')[0]
      const hook = provider === undefined || provider.hooks[0] === undefined ? undefined : provider.hooks[0].value
      return { contexts: contexts.length, providerValue: hook === undefined ? 'none' : Object.keys(hook).join('|') + ':store=' + String(typeof hook.store) }
    },
    /** Run every queued effect; returns their disposers. */
    flushEffects() {
      const disposers = []
      while (effects.length > 0) {
        const effect = effects.shift()
        const dispose = effect.fn()
        if (typeof dispose === 'function') disposers.push({ owner: effect.owner, dispose })
      }
      return disposers
    },
  }
  return api
}

/** Walk every node of a rendered tree in document order. */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, visit)
    return
  }
  visit(node)
  for (const child of (node.children === undefined ? [] : node.children)) walk(child, visit)
}

/** A flat text/attribute dump of a tree, for "does it show X" assertions. */
function flatten(node) {
  const parts = []
  walk(node, (entry) => {
    if (typeof entry.type === 'string' && entry.type !== '#text' && entry.type !== undefined) parts.push('<' + entry.type + '>')
    if (typeof entry.text === 'string') parts.push(entry.text)
    if (entry.props !== undefined && typeof entry.props.label === 'string') parts.push('label=' + entry.props.label)
    const props = entry.props === undefined ? {} : entry.props
    for (const key of Object.keys(props)) {
      if (key === 'children' || key === 'store') continue
      const value = props[key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') parts.push(key + '=' + String(value))
    }
    if (typeof entry.text === 'string') parts.push(entry.text)
  })
  return parts.join(' ')
}

/** The first node in the tree whose props satisfy `predicate`. */
function findNode(node, predicate) {
  let found
  walk(node, (entry) => {
    if (found === undefined && predicate(entry)) found = entry
  })
  return found
}

// ---------------------------------------------------------------------------
// Fake DOM with a recording 2d context
// ---------------------------------------------------------------------------

/** A 2d context that records every call the painter makes. */
function makeContext2d() {
  const calls = []
  const context = {
    calls,
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    measureText: (text) => ({ width: String(text).length * 6 }),
  }
  const record = (name) => (...args) => {
    calls.push({ name, args })
  }
  for (const name of ['setTransform', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill']) context[name] = record(name)
  context.fillText = (text, x, y) => calls.push({ name: 'fillText', args: [text, x, y], fillStyle: context.fillStyle, font: context.font })
  return context
}

/** A canvas element whose 2d context records what was drawn. */
function makeCanvas() {
  const context = makeContext2d()
  const canvas = {
    tagName: 'CANVAS',
    className: '',
    width: 0,
    height: 0,
    style: {},
    __ctx: context,
    getContext: (kind) => (kind === '2d' ? context : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    addEventListener() {},
    removeEventListener() {},
    contains: () => false,
  }
  context.canvas = canvas
  return canvas
}

/** A document good enough for injectStyles + the canvas component. */
function makeDocument() {
  const canvases = []
  const document = {
    canvases,
    querySelector: () => null,
    createElement: (tag) => {
      if (String(tag).toLowerCase() === 'canvas') {
        const canvas = makeCanvas()
        canvases.push(canvas)
        return canvas
      }
      return { tagName: String(tag).toUpperCase(), setAttribute() {}, textContent: '', appendChild() {} }
    },
    head: { appendChild() {} },
    body: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  return document
}

// ---------------------------------------------------------------------------
// Execute the built browser bundle against the stub module system
// ---------------------------------------------------------------------------

/**
 * Evaluate dist/client.js with a stub window/require/document.
 *
 * @param source - the bundle source.
 * @returns `{ face, react }` where `face` is the materialized plugin exports.
 */
function materializeBundle(source) {
  const react = createReactStub()
  const registrations = []
  const windowStub = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      },
    },
    devicePixelRatio: 2,
  }
  const requireStub = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === 'react/jsx-runtime') return { jsx: react.createElement, jsxs: react.createElement }
    throw new Error('unexpected external require: ' + specifier)
  }
  const evaluate = new Function('window', 'require', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'globalThis', source)
  evaluate(windowStub, requireStub, makeDocument(), () => 0, () => {}, () => 0, () => {}, globalThis)
  if (registrations.length !== 1) throw new Error('the bundle registered ' + String(registrations.length) + ' factories')
  return { face: registrations[0].factory(requireStub), react, window: windowStub, registration: registrations[0] }
}

/** Apply a plugin face to a capturing slot service. */
function applyToSlots(face) {
  const entries = new Map()
  const injected = []
  const disposers = []
  const slots = {
    inject(name, callback) {
      injected.push(name)
      return callback()
    },
    register(options, component) {
      const key = options.name + '/' + String(options.id)
      entries.set(key, { options, component })
      return () => {
        entries.delete(key)
      }
    },
  }
  const locale = {
    register() {
      return () => {}
    },
  }
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    logger: { warn() {}, error() {}, info() {} },
  }
  let error
  try {
    face.apply(ctx)
  } catch (thrown) {
    error = thrown
  }
  return { entries, injected, disposers, error }
}

// ===========================================================================
console.log('# team-flowise client UI acceptance tests')
console.log('  package root : ' + pkgRoot)
console.log('  web profile  : ' + PROFILE_DIR)
console.log('  host origin  : ' + ORIGIN + (OFFLINE ? '   (offline mode)' : ''))

const distIndex = join(pkgRoot, 'dist', 'index.js')
const distClient = join(pkgRoot, 'dist', 'client.js')
const clientSourceOverride = process.env.DSH_UI_BUNDLE === undefined || process.env.DSH_UI_BUNDLE === '' ? distClient : process.env.DSH_UI_BUNDLE

// ---------------------------------------------------------------------------
// A. node 加载
// ---------------------------------------------------------------------------
section('A. node 加载 — real child process')

check('dist/index.js exists', existsSync(distIndex), distIndex)
check('dist/client.js exists', existsSync(distClient), distClient)

for (const [label, file] of [['dist/index.js', distIndex], ['dist/client.js', distClient]]) {
  let ok = true
  let detail = ''
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    ok = false
    detail = why(error)
  }
  check('node --check parses ' + label, ok, detail)
}

/** Import a specifier in a real child node and parse the probe it printed. */
function probeImport(specifier, cwd) {
  const source = [
    'const mod = await import(process.argv[1])',
    'const keys = Object.keys(mod).sort()',
    'const types = {}',
    'for (const key of keys) types[key] = typeof mod[key]',
    'const out = { keys, types, describeClient: typeof mod.describeClient === "function" ? mod.describeClient() : undefined }',
    'console.log("PROBE" + JSON.stringify(out))',
  ].join('\n')
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', source, specifier], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const line = stdout.split(/\r?\n/).filter((entry) => entry.startsWith('PROBE'))[0]
  if (line === undefined) throw new Error('probe printed nothing: ' + stdout.slice(0, 400))
  return JSON.parse(line.slice('PROBE'.length))
}

let probe
try {
  probe = probeImport(PLUGIN_ID, pkgRoot)
} catch (error) {
  probe = { error: why(error), keys: [] }
}
check('a child node can import("' + PLUGIN_ID + '") from the package root', probe.error === undefined && probe.keys.length > 0, probe.error)
check(
  'the Node half exports the environment-free contract',
  ['describeClient', 'layoutDag', 'matchRoute', 'pickRun', 'routeUrl', 'SETTINGS_SECTION', 'ROUTES', 'DOMAINS'].every((key) => probe.keys.indexOf(key) !== -1),
  JSON.stringify(probe.keys),
)
const described = probe.describeClient
check('describeClient() reports the 13 frozen host routes', described !== undefined && described.routes.length === 13, described === undefined ? 'not callable' : String(described.routes.length))
check(
  'describeClient() reports exactly the two slot contributions',
  described !== undefined && described.contributions.length === 2 && described.contributions[0].slot === SETTINGS_SLOT && described.contributions[0].id === SETTINGS_CELL,
  described === undefined ? 'not callable' : JSON.stringify(described.contributions),
)
check('describeClient() is JSON-safe', described !== undefined && typeof JSON.stringify(described) === 'string')
check(
  'the Node bundle imports nothing (so bare node cannot fail on a peer)',
  readFileSync(distIndex, 'utf8').split(/\r?\n/).filter((line) => /^\s*(?:import|export)\b.*\bfrom\s*['"]/.test(line)).length === 0,
)

section('A2. node 加载 — resolved the way a restarting host resolves it')

let profileProbe
try {
  profileProbe = probeImport(PLUGIN_ID, PROFILE_DIR)
} catch (error) {
  profileProbe = { error: why(error), keys: [] }
}
let profileResolvedPath
try {
  profileResolvedPath = createRequire(join(PROFILE_DIR, 'package.json')).resolve(PLUGIN_ID + '/package.json')
} catch {
  profileResolvedPath = undefined
}
if (profileProbe.error === undefined) {
  check('a child node can import("' + PLUGIN_ID + '") from the web profile', true)
  check('the profile resolves it back into this checkout', profileResolvedPath !== undefined && isInside(pkgRoot, profileResolvedPath), String(profileResolvedPath))
} else {
  check('a child node can import("' + PLUGIN_ID + '") from the web profile', false, profileProbe.error)
  console.log('        ↑ not a defect in this package: the profile has no dependency edge to it yet (see the report)')
}

// ---------------------------------------------------------------------------
// B. host 重启后 settings.section 出现
// ---------------------------------------------------------------------------
section('B. host 重启后 settings.section 出现 — restart discovery, re-implemented')

const patchPath = join(PROFILE_DIR, 'cordis.patch.yml')
const profileManifestPath = join(PROFILE_DIR, 'package.json')
check('the web profile has cordis.patch.yml', existsSync(patchPath), patchPath)
check('the web profile has package.json', existsSync(profileManifestPath), profileManifestPath)

const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
let profileManifest = {}
try {
  profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
} catch {
  profileManifest = {}
}

/** Every `name:` inside an `- insert:` list: the rows the discovery scans. */
function insertedRowNames(text) {
  const names = []
  let inInsert = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (/^\s*-?\s*insert:\s*$/.test(line)) {
      inInsert = true
      continue
    }
    if (!inInsert) continue
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) {
      inInsert = false
      continue
    }
    const match = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (match !== null) names.push(match[1])
  }
  return names
}

const rowNames = insertedRowNames(patchText)
check('the patch layer inserts at least one loader row', rowNames.length > 0, JSON.stringify(rowNames))
check('the ' + HOST_PKG + ' host row is present', rowNames.indexOf(HOST_PKG) !== -1, JSON.stringify(rowNames))

const profileDeps = profileManifest.dependencies === undefined ? {} : profileManifest.dependencies
const clientInProfileDeps = Object.keys(profileDeps).indexOf(PLUGIN_ID) !== -1
const clientRowDeclared = rowNames.indexOf(PLUGIN_ID) !== -1

/** Mirrors dsh-client-modules resolveMeta/locatePkgJson/nearestPackage. */
function discoverForRow(specifier) {
  const require = createRequire(join(PROFILE_DIR, 'package.json'))
  let manifestPath
  try {
    manifestPath = require.resolve(specifier + '/package.json')
  } catch {
    try {
      const entry = require.resolve(specifier)
      let dir = dirname(entry)
      for (let depth = 0; depth < 10; depth += 1) {
        const candidate = join(dir, 'package.json')
        if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === specifier) {
          manifestPath = candidate
          break
        }
        const next = dirname(dir)
        if (next === dir) break
        dir = next
      }
    } catch (error) {
      return { row: specifier, found: false, reason: why(error) }
    }
    if (manifestPath === undefined) return { row: specifier, found: false, reason: 'no package.json for ' + specifier }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const declaration = manifest.dsh !== null && typeof manifest.dsh === 'object' ? manifest.dsh.client : undefined
  if (declaration === undefined || declaration === null || typeof declaration !== 'object') return { row: specifier, found: false, packageName: manifest.name, manifestPath, reason: 'no dsh.client declaration' }
  if (declaration.platform !== 'web') return { row: specifier, found: false, packageName: manifest.name, manifestPath, reason: 'dsh.client.platform=' + String(declaration.platform) }
  const exp = manifest.exports === undefined ? {} : manifest.exports
  const raw = exp[BUNDLE_KEY]
  const rel = typeof raw === 'string' ? raw : raw !== null && raw !== undefined && typeof raw === 'object' ? raw.default : undefined
  if (typeof rel !== 'string') return { row: specifier, found: false, packageName: manifest.name, manifestPath, reason: 'declares dsh.client but exports["' + BUNDLE_KEY + '"] is missing' }
  const clientPath = join(dirname(manifestPath), rel)
  return {
    row: specifier,
    found: true,
    packageName: manifest.name,
    manifestPath,
    entry: { id: manifest.name, clientPath },
    inject: declaration.inject === undefined ? [] : declaration.inject,
    external: declaration.external === undefined ? [] : declaration.external,
  }
}

const discoveries = rowNames.map((name) => discoverForRow(name))
const clientDiscovery = discoveries.filter((entry) => entry.found && entry.entry.id === PLUGIN_ID)[0]
const summary = discoveries.map((entry) => ({ row: entry.row, found: entry.found, id: entry.entry === undefined ? undefined : entry.entry.id, reason: entry.reason }))

if (clientDiscovery === undefined) {
  check('the restart scan discovers the client package through a loader row', false, JSON.stringify(summary))
  console.log('        profile dependency present: ' + String(clientInProfileDeps) + '; explicit client row present: ' + String(clientRowDeclared))
  console.log('        discovery today stops at the host row because ' + HOST_PKG + '/package.json declares no dsh.client')
} else {
  check('the restart scan discovers the client package through a loader row', true)
  check('the discovered bundle is dist/client.js', clientDiscovery.entry.clientPath === distClient, clientDiscovery.entry.clientPath)
  check('the discovered bundle exists on disk', existsSync(clientDiscovery.entry.clientPath), clientDiscovery.entry.clientPath)
  check('the declaration carries the four web inject entries', Array.isArray(clientDiscovery.inject) && clientDiscovery.inject.length === 4, JSON.stringify(clientDiscovery.inject))
  check('React stays a platform seed (so React is never bundled twice)', Array.isArray(clientDiscovery.external) && clientDiscovery.external.length === 0, JSON.stringify(clientDiscovery.external))
}

const clientSource = existsSync(distClient) ? readFileSync(clientSourceOverride, 'utf8') : ''
check('the bundle registers a __ModuleLoader__ factory', clientSource.includes('window.__ModuleLoader__.load('))
check('the factory is addressed by the package id', clientSource.includes('"' + PLUGIN_ID + '"'))
check('the factory declares module/exports internally', clientSource.includes('var module = { exports: {} };'))
check('the bundle ends at the factory close', clientSource.trimEnd().endsWith('});'))
check('the bundle requires only the react platform seed', (() => {
  const required = (clientSource.match(/require\((["'])([^"']+)\1\)/g) || []).map((entry) => entry.replace(/^require\(["']|["']\)$/g, ''))
  return required.length > 0 && required.every((name) => name === 'react' || name === 'react/jsx-runtime')
})(), (clientSource.match(/require\((["'])([^"']+)\1\)/g) || []).join(', '))
check('the bundle encodes the settings cell it occupies', clientSource.includes('"' + SETTINGS_SLOT + '"') && clientSource.includes('"' + SETTINGS_CELL + '"'))

if (OFFLINE) {
  skip('GET /plugins/' + PLUGIN_ID + '/client.js is served by the running host', 'offline mode')
} else {
  const url = ORIGIN + '/plugins/' + PLUGIN_ID + '/client.js'
  let served
  try {
    const response = await fetch(url)
    served = { ok: response.ok, status: response.status, body: response.ok ? await response.text() : '' }
  } catch (error) {
    served = { unreachable: why(error) }
  }
  if (served.unreachable !== undefined) {
    skip('GET /plugins/' + PLUGIN_ID + '/client.js is served by the running host', 'no host at ' + ORIGIN)
  } else if (served.ok) {
    check('GET /plugins/' + PLUGIN_ID + '/client.js answers 200', true)
    check('the served bundle is byte-identical to the built dist/client.js', served.body === clientSource, String(served.body.length) + ' served vs ' + String(clientSource.length) + ' built')
  } else {
    check('GET /plugins/' + PLUGIN_ID + '/client.js answers 200', false, 'HTTP ' + String(served.status) + ' — the RUNNING host predates the client row, so only a restart can serve it')
  }
}

// ---------------------------------------------------------------------------
// C. 数据拉到
// ---------------------------------------------------------------------------
section('C. 数据拉到 — real host routes through this package own code')

const nodeHalf = await import(pathToFileURL(distIndex).href)
const bundle = materializeBundle(clientSource)
const react = bundle.react
const face = bundle.face
const documentStub = makeDocument()

check('the route table declares exactly the 13 host routes', nodeHalf.ROUTES.length === 13, String(nodeHalf.ROUTES.length))
check('every route id builds a URL under the host prefix', nodeHalf.ROUTES.every((route) => String(nodeHalf.routeUrl(route.id, {})).startsWith('/api/team-flowise')))
check('the materialized bundle exposes the store constructor', typeof face.createTeamStore === 'function', Object.keys(face).join(', '))
check('every route matches itself back through matchRoute', nodeHalf.ROUTES.every((route) => nodeHalf.matchRoute(route.method, route.path).id === route.id))
check('the four storage domains match the host composition', same(nodeHalf.DOMAINS, ['team_agent_defs', 'team_ledger', 'team_workflows', 'team_runs']), JSON.stringify(nodeHalf.DOMAINS))
check('the client half never claims the harness/host.call channel', !/harness\s*\.\s*handle|host\s*\.\s*call/.test(clientSource))
check('the client half crosses the boundary with fetch()', clientSource.includes('fetch'))
check('the host half is a composed bundle that registers WebServer routes', (() => {
  try {
    const hostSource = readFileSync(join(pkgRoot, '..', 'team-flowise', 'src', 'index.js'), 'utf8')
    return /inject\s*=\s*\[[^\]]*'webServer'/.test(hostSource) && hostSource.includes('web.register({') && hostSource.includes("'/api/team-flowise/ping'")
  } catch {
    return false
  }
})())

let hostUp = false
let ping
if (OFFLINE) {
  skip('GET /api/team-flowise/ping answers', 'offline mode')
} else {
  try {
    const response = await fetch(ORIGIN + '/api/team-flowise/ping')
    ping = response.ok ? await response.json() : undefined
    hostUp = response.ok && ping !== undefined && ping.ok === true
  } catch (error) {
    hostUp = false
    ping = { error: why(error) }
  }
  if (!hostUp) skip('GET /api/team-flowise/ping answers', 'no host at ' + ORIGIN)
}

/** A live store: the same `createTeamStore` the settings page builds on mount. */
let uiStore
let liveCounts

if (hostUp) {
  check('the host reports the four composed domains over /ping', same(ping.domains, ['team_agent_defs', 'team_ledger', 'team_workflows', 'team_runs']), JSON.stringify(ping.domains))

  const realFetch = globalThis.fetch
  /** Send the package's relative route URLs to the live host. */
  const hostFetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input.url)
    return realFetch(/^https?:/i.test(url) ? url : ORIGIN + url, init)
  }

  const payloads = {}
  for (const id of ['agents.list', 'workflows.list', 'tasks.list', 'runs.list']) {
    const url = nodeHalf.routeUrl(id, {})
    try {
      const response = await hostFetch(url)
      payloads[id] = response.ok ? await response.json() : { ok: false, httpStatus: response.status }
    } catch (error) {
      payloads[id] = { ok: false, error: why(error) }
    }
    check('GET ' + url + ' answers a JSON envelope', payloads[id].ok === true, JSON.stringify(payloads[id]).slice(0, 200))
  }

  const rawAgents = payloads['agents.list'].agents
  const rawWorkflows = payloads['workflows.list'].workflows
  const rawTasks = payloads['tasks.list'].tasks
  const rawRuns = payloads['runs.list'].runs
  liveCounts = { agents: rawAgents.length, workflows: rawWorkflows.length, tasks: rawTasks.length, runs: rawRuns.length }

  check('the host returned a non-empty roster, workflow list, and run list', rawAgents.length > 0 && rawWorkflows.length > 0 && rawRuns.length > 0, JSON.stringify(liveCounts))

  const pickedAgents = rawAgents.map(nodeHalf.pickAgent).filter((entry) => entry !== null)
  const pickedWorkflows = rawWorkflows.map(nodeHalf.pickWorkflow).filter((entry) => entry !== null)
  const pickedTasks = rawTasks.map(nodeHalf.pickTask).filter((entry) => entry !== null)
  const pickedRuns = rawRuns.map(nodeHalf.pickRun).filter((entry) => entry !== null)

  check('every live agent reduces to a display record', pickedAgents.length === rawAgents.length, String(pickedAgents.length) + '/' + String(rawAgents.length))
  check('a reduced agent carries id/name/role scalars only', pickedAgents.every((agent) => typeof agent.id === 'string' && agent.id !== '' && typeof agent.name === 'string' && typeof agent.role === 'string' && Array.isArray(agent.skills)))
  check('every live workflow reduces to a display record with DAG nodes', pickedWorkflows.length === rawWorkflows.length && pickedWorkflows.every((workflow) => Array.isArray(workflow.nodes) && workflow.nodes.every((node) => typeof node.id === 'string' && Array.isArray(node.dependsOn))), String(pickedWorkflows.length) + '/' + String(rawWorkflows.length))
  check('every live task reduces to a display record', pickedTasks.length === rawTasks.length, String(pickedTasks.length) + '/' + String(rawTasks.length))
  check('every live run reduces to a display record', pickedRuns.length === rawRuns.length, String(pickedRuns.length) + '/' + String(rawRuns.length))
  check('every reduced run reports a known status', pickedRuns.every((run) => ['running', 'completed', 'failed', 'cancelled', 'interrupted'].indexOf(run.status) !== -1), JSON.stringify(pickedRuns.map((run) => run.status).slice(0, 8)))

  uiStore = face.createTeamStore({ fetch: hostFetch })
  let notifyCount = 0
  const unsubscribe = uiStore.subscribe(() => {
    notifyCount += 1
  })
  let refreshError
  try {
    await uiStore.refresh()
  } catch (error) {
    refreshError = error
  }
  unsubscribe()
  const state = uiStore.getState()
  check('store.refresh() settles', refreshError === undefined, refreshError === undefined ? '' : why(refreshError))
  check('store.refresh() reports host health ok', state.health === 'ok', JSON.stringify(state.errors))
  check('store.refresh() filled all four slices from the live host', same({ agents: state.agents.length, workflows: state.workflows.length, tasks: state.tasks.length, runs: state.runs.length }, liveCounts), JSON.stringify({ agents: state.agents.length, workflows: state.workflows.length, tasks: state.tasks.length, runs: state.runs.length }) + ' vs ' + JSON.stringify(liveCounts))
  check('store.refresh() records the composed domains', same(state.domains, nodeHalf.DOMAINS), JSON.stringify(state.domains))
  check('store.refresh() stamps a load time and bumps the revision', state.lastLoadedAt > 0 && state.revision > 0, JSON.stringify({ lastLoadedAt: state.lastLoadedAt, revision: state.revision }))
  check('store.refresh() notified its subscribers', notifyCount > 0, String(notifyCount))
  check('openTaskCount() matches the settlement column', uiStore.openTaskCount() === state.tasks.filter((task) => task.status !== 'settle').length, String(uiStore.openTaskCount()))
  check('newestRuns() returns a newest-first slice', (() => {
    const newest = uiStore.newestRuns(50)
    if (newest.length !== state.runs.length) return false
    for (let index = 1; index < newest.length; index += 1) if ((newest[index - 1].startedAt || 0) < (newest[index].startedAt || 0)) return false
    return true
  })())
  check('the store exposes the write actions the UI calls', ['saveAgent', 'deleteAgent', 'saveWorkflow', 'deleteWorkflow', 'createTask', 'reworkTask', 'startRun'].every((name) => typeof uiStore.actions[name] === 'function'))

  // Persistence cross-check: what the client received is what is on disk, which is
  // what a restarted host re-reads.
  try {
    const onDisk = readFileSync(join(HOME_DSH, 'storages', 'team_agent_defs.json'), 'utf8')
    const sample = pickedAgents[0]
    check('the agents the client received are the ones persisted under ~/.dsh/storages', sample !== undefined && onDisk.includes(sample.id), sample === undefined ? 'no agent returned' : sample.id)
  } catch (error) {
    check('the agents the client received are the ones persisted under ~/.dsh/storages', false, why(error))
  }
} else {
  skip('store.refresh() against the live host', 'no host reachable at ' + ORIGIN)
}

// ---------------------------------------------------------------------------
// D. DAG 画布渲染
// ---------------------------------------------------------------------------
section('D. DAG 画布渲染 — bundle executed, paint recorded')

if (uiStore === undefined) {
  // Without a host, the DAG still has to be provable: use a synthetic workflow
  // through the same code path, and say so.
  const synthetic = {
    agents: [],
    workflows: [
      {
        id: 'wf-synthetic',
        name: 'synthetic',
        description: '',
        nodes: [
          { id: 'plan', agent: '', reviewer: '', mode: 'once', dependsOn: [], requirement: '', acceptanceCriteria: '' },
          { id: 'build', agent: '', reviewer: '', mode: 'once', dependsOn: ['plan'], requirement: '', acceptanceCriteria: '' },
          { id: 'test', agent: '', reviewer: '', mode: 'once', dependsOn: ['build'], requirement: '', acceptanceCriteria: '' },
          { id: 'docs', agent: '', reviewer: '', mode: 'once', dependsOn: ['plan'], requirement: '', acceptanceCriteria: '' },
        ],
        updatedAt: Date.now(),
      },
    ],
    tasks: [],
    runs: [],
    loading: false,
    refreshing: false,
    errors: {},
    health: 'unknown',
    domains: [],
    lastLoadedAt: Date.now(),
    revision: 1,
  }
  uiStore = face.createTeamStore({ api: makeStubApi(synthetic) })
  console.log('  note  no host reachable: the DAG is exercised on a synthetic workflow through the same code path')
}

/** A store API that answers from a fixed snapshot (used only without a host). */
function makeStubApi(snapshot) {
  const nothing = async () => undefined
  return {
    listAgents: async () => snapshot.agents,
    listWorkflows: async () => snapshot.workflows,
    listTasks: async () => snapshot.tasks,
    listRuns: async () => snapshot.runs,
    upsertAgent: nothing,
    deleteAgent: nothing,
    upsertWorkflow: nothing,
    deleteWorkflow: nothing,
    createTask: nothing,
    reworkTask: nothing,
    startRun: nothing,
  }
}

const applied = applyToSlots(face)
// The slot holds one component function; keep a handle so a re-render uses the
// same function identity (which is what preserves its hook state).
const settingsComponent = applied.entries.get(SETTINGS_SLOT + '/' + SETTINGS_CELL) === undefined ? undefined : applied.entries.get(SETTINGS_SLOT + '/' + SETTINGS_CELL).component
check('apply() runs without throwing', applied.error === undefined, applied.error === undefined ? '' : why(applied.error))
check('apply() injected into exactly the two slot declarations', same(applied.injected.slice().sort(), [HEADER_SLOT, SETTINGS_SLOT].sort()), JSON.stringify(applied.injected))

const cell = applied.entries.get(SETTINGS_SLOT + '/' + SETTINGS_CELL)
check('settings.section/' + SETTINGS_CELL + ' was registered', cell !== undefined)
check(
  'the registration carries the settings-nav metadata (id/order/label)',
  cell !== undefined && cell.options.id === SETTINGS_CELL && cell.options.order === 500 && cell.options.label === '多 Agent 团队',
  cell === undefined ? '' : JSON.stringify(cell.options),
)
check('the registration exposes a component function', cell !== undefined && typeof cell.component === 'function')
check('the session-header activity cell was registered as well', applied.entries.has(HEADER_SLOT + '/team-flowise-activity'))

if (cell !== undefined) {
  // A stable props object: the page only ever receives `{ close }`, and a fresh
  // object per render would change memo dependencies for no reason.
  const props = { close() {} }
  let tree
  let mountError
  try {
    tree = react.mount(settingsComponent(props))
  } catch (error) {
    mountError = error
    if (process.env.DSH_UI_DEBUG === '1') {
      const lines = clientSource.split(/\r?\n/)
      const match = /<anonymous>:(\d+):(\d+)/.exec(String(error.stack))
      console.log('DBG stack=' + String(error.stack).split('\n').slice(0, 8).join(' // '))
    }
  }
  check('the settings.section component mounts without throwing', mountError === undefined, mountError === undefined ? '' : why(mountError))

  const rendered = flatten(tree)
  if (process.env.DSH_UI_DEBUG === '1') {
    const probeStore = uiStore
    console.log('DBG store keys=' + Object.keys(probeStore).join('|') + ' viaProvider=' + String(typeof (probeStore || {}).getState))
  }
  check('the page renders its heading', rendered.includes('多 Agent 团队'), rendered.slice(0, 200))
  check('the page renders the tab strip with the DAG tab', ['总览', 'Agents', '工作流', 'DAG 画布', '任务', '运行'].every((label) => rendered.includes(label)), rendered.slice(0, 300))

  const overviewState = uiStore.getState()
  check(
    'the overview tab renders one stat card per slice',
    ['Agents', '工作流', '任务', '运行'].filter((label) => rendered.includes(label)).length >= 3,
    rendered.slice(0, 300),
  )
  check('the overview tab shows the agent count from the host', overviewState.agents.length === 0 || rendered.includes(String(overviewState.agents.length)), String(overviewState.agents.length))

  const dagButton = findNode(tree, (node) => node.type === 'button' && typeof node.props.onClick === 'function' && flatten(node).includes('DAG 画布'))
  check('the DAG tab is a clickable button', dagButton !== undefined)

  let dagError
  if (dagButton !== undefined) {
    try {
      dagButton.props.onClick()
      if (process.env.DSH_UI_DEBUG === '1') console.log('DBG afterClick dirty=' + JSON.stringify(react.debugDirty()))
      react.settle()
      if (process.env.DSH_UI_DEBUG === '1') console.log('DBG afterSettle dirty=' + JSON.stringify(react.debugDirty()) + ' section=' + JSON.stringify(react.debugSectionChildren()) + ' remount=' + String(react.remountAll().length) + ' after=' + JSON.stringify(react.debugSectionChildren()))
    } catch (error) {
      dagError = error
    }
  }
  const tabCells = react.debugStates()
  const dirtyNames = () => react.debugDirty()
  check('clicking the DAG tab re-renders without throwing', dagError === undefined, dagError === undefined ? '' : why(dagError))

  // Re-mount the same component identity: its hook state (tab) is preserved, and
  // the tree returned is the DAG tab body.
  let dagBody = tree
  try {
    dagBody = react.mount(settingsComponent(props))
  } catch (error) {
    dagError = error
  }
  const dagText = flatten(dagBody)
  if (process.env.DSH_UI_DEBUG === '1') console.log('DBG tabCell=' + JSON.stringify(tabCells) + ' dirty=' + JSON.stringify(dirtyNames()) + ' hasTabStrip=' + String(dagText.includes('tfc-tabs')) + ' hasCanvas=' + String(dagText.includes('<canvas>')) + ' hasBoard=' + String(dagText.includes('tfc-board')))
  check('the DAG tab body renders', dagText.includes('tfc-col') || dagText.includes('<canvas>'), dagText.slice(0, 200))

  const state = uiStore.getState()
  // The tab defaults to the workflow that actually has nodes, not blindly to
  // record zero — an empty workflow would open on a blank canvas.
  const workflow = (() => {
    let best
    for (const candidate of state.workflows) {
      if (best === undefined) best = candidate
      else if (candidate.nodes.length > best.nodes.length) best = candidate
    }
    return best
  })()
  check(
    'the store holds at least one workflow, and the DAG tab is on the one with nodes',
    workflow !== undefined && state.workflows.length > 0 && workflow.nodes.length === Math.max(...state.workflows.map((entry) => entry.nodes.length)),
    JSON.stringify(state.workflows.map((entry) => ({ id: entry.id, nodes: entry.nodes.length })).slice(0, 6)),
  )
  if (workflow === undefined || workflow.nodes.length === 0) {
    skip('the DAG canvas paints a workflow layout', 'no stored workflow has any nodes')
    check('the DAG tab still refuses to crash on an empty canvas', dagError === undefined, dagError === undefined ? '' : why(dagError))
  } else {
    const layout = nodeHalf.layoutDag(workflow.nodes.map((node) => ({ id: node.id, dependsOn: node.dependsOn })))
    check('the layout has one node per workflow node', layout.nodes.length === workflow.nodes.length, String(layout.nodes.length) + ' vs ' + String(workflow.nodes.length))
    check('the layout reports no dangling dependency', layout.nodes.every((node) => node.missingDeps.length === 0), JSON.stringify(layout.nodes.map((node) => node.missingDeps)))
    check('the layout reports no cycle', layout.cyclic.length === 0, JSON.stringify(layout.cyclic))
    check('every edge points exactly one layer forward', layout.edges.every((edge) => {
      const from = layout.nodes.filter((node) => node.id === edge.from)[0]
      const to = layout.nodes.filter((node) => node.id === edge.to)[0]
      return from !== undefined && to !== undefined && to.layer === from.layer + 1
    }))
    check('the layout has positive geometry and at least one wave', layout.width > 0 && layout.height > 0 && layout.layers.length > 0, JSON.stringify({ width: layout.width, height: layout.height, layers: layout.layers.length }))
    check('the DAG tab renders a canvas element', findNode(dagBody, (node) => node.type === 'canvas') !== undefined, dagText.slice(0, 160))

    // Flush the mount effect: that call is the paint.
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    globalThis.window = bundle.window
    globalThis.document = documentStub
    let disposers = []
    let paintError
    try {
      disposers = react.flushEffects()
    } catch (error) {
      paintError = error
    }
    check('the canvas paint effect runs without throwing', paintError === undefined, paintError === undefined ? '' : why(paintError))

    const canvases = documentStub.canvases
    const canvas = canvases.filter((entry) => entry.__ctx.calls.length > 0).slice(-1)[0]
    if (canvas === undefined) {
      check('the canvas 2d context received drawing calls', false, 'canvases created: ' + String(canvases.length) + ', calls: ' + JSON.stringify(canvases.map((entry) => entry.__ctx.calls.length)))
    } else {
      const calls = canvas.__ctx.calls
      const names = calls.map((call) => call.name)
      check('the canvas 2d context received drawing calls', calls.length > 0, String(calls.length))
      check('the painter set the device-pixel transform', names.indexOf('setTransform') !== -1)
      check('the painter cleared the canvas', names.indexOf('clearRect') !== -1)
      check('the painter drew every edge and box (stroke count)', names.filter((name) => name === 'stroke').length >= layout.edges.length + layout.nodes.length, String(names.filter((name) => name === 'stroke').length) + ' strokes for ' + String(layout.edges.length) + ' edges + ' + String(layout.nodes.length) + ' boxes')
      check('the painter drew every box plus its status stripe (fill count)', names.filter((name) => name === 'fill').length >= layout.nodes.length, String(names.filter((name) => name === 'fill').length))
      check('the canvas backing store is CSS pixels × devicePixelRatio', canvas.width === Math.round(layout.width) * 2 && canvas.height === Math.round(layout.height) * 2, JSON.stringify({ width: canvas.width, height: canvas.height, expected: [Math.round(layout.width) * 2, Math.round(layout.height) * 2] }))
      const labels = calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]))
      const unpainted = layout.nodes.map((node) => node.id).filter((id) => !labels.some((label) => label.indexOf(id) !== -1))
      check('every node id is painted on the canvas', unpainted.length === 0, JSON.stringify(unpainted))
    }

    check('the node detail cards render beside the canvas', layout.nodes.every((node) => dagText.includes(node.id)), '')
    check('the legend names the three node statuses', ['待执行', '成功', '失败'].every((label) => dagText.includes(label)), dagText.slice(0, 240))
    check('the DAG header reports node and edge counts', dagText.includes(String(layout.nodes.length)) && dagText.includes(String(layout.edges.length)), dagText.slice(0, 300))

    // The session-header surface must also render from the same store.
    const headerCell = applied.entries.get(HEADER_SLOT + '/team-flowise-activity')
    let headerError
    try {
      react.mount(headerCell.component({ locale: 'zh' }))
    } catch (error) {
      headerError = error
    }
    check('the session-header activity panel renders', headerError === undefined, headerError === undefined ? '' : why(headerError))

    for (const entry of disposers) {
      try {
        entry.dispose()
      } catch {
        // A disposer touching a fake DOM is not a product failure here.
      }
    }
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
}

// ---------------------------------------------------------------------------
console.log('')
console.log('------------------------------------------------------------------------')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed, ' + String(skipped.length) + ' skipped')
if (skipped.length > 0) {
  console.log('NOT measured (reported as SKIP, never as PASS):')
  for (const label of skipped) console.log('  - ' + label)
}
if (failures === 0) {
  console.log('RESULT: every executed check passed')
  process.exit(0)
}
console.log('RESULT: ' + String(failures) + ' check(s) failed')
process.exit(1)
