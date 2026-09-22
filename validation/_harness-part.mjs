// Independently assembled verification harness (validator-authored).
// Reuses the stub React/DOM helpers by EXTRACTING them verbatim from
// scripts/ui-acceptance.test.mjs lines 107-524, then adds the one thing the
// original run never did: the store's transport (globalThis.fetch) is
// stubbed to the live host BEFORE the settings surface mounts.
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
      // `props.children` read undefined 鈥?which silently renders a provider empty.
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
          // Call the component like React does 鈥?`type(props)` 鈥?instead of
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
