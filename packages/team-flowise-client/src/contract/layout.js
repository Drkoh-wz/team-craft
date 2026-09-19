// Deterministic DAG layout for the workflow canvas.
//
// Pure and environment-free on purpose: the same solver runs in the Node half
// (so it can be unit-checked without a browser) and in the browser half (to
// place nodes on the canvas). It never touches a workflow record in place —
// callers pass `{ id, dependsOn }` entries and get a fresh geometry object.

/** Geometry defaults. Kept in one place so the canvas and the hit-test agree. */
export const LAYOUT = {
  nodeWidth: 168,
  nodeHeight: 62,
  gapX: 92,
  gapY: 26,
  padding: 22,
}

/**
 * Topologically order nodes and detect cycles.
 *
 * Kahn's algorithm with stable tie-breaking on first-seen order, so a given
 * workflow always produces the same picture — a canvas that reshuffles between
 * polls is unreadable.
 *
 * @param ids - node ids in record order.
 * @param depsOf - id → array of dependency ids.
 * @returns `{ order, cyclic }`; when cyclic, `order` holds the acyclic prefix and
 *   `cyclic` lists the ids left unresolved.
 */
export function topologicalOrder(ids, depsOf) {
  const indegree = new Map()
  const children = new Map()
  for (const id of ids) {
    indegree.set(id, 0)
    children.set(id, [])
  }
  for (const id of ids) {
    for (const dep of depsOf(id)) {
      if (!indegree.has(dep)) continue
      indegree.set(id, indegree.get(id) + 1)
      children.get(dep).push(id)
    }
  }
  const order = []
  const ready = ids.filter((id) => indegree.get(id) === 0)
  while (ready.length > 0) {
    const id = ready.shift()
    order.push(id)
    for (const child of children.get(id)) {
      indegree.set(child, indegree.get(child) - 1)
      if (indegree.get(child) === 0) ready.push(child)
    }
  }
  const cyclic = ids.filter((id) => order.indexOf(id) === -1)
  return { order, cyclic }
}

/**
 * Lay a workflow out left-to-right in dependency waves.
 *
 * Layer `n` holds every node whose longest path from a root is `n`, so an edge
 * always points strictly to a later layer and no edge is drawn backwards.
 * Nodes inside a layer are ordered by the mean row of their parents (one
 * barycenter pass) to pull connected chains into straight lines.
 *
 * @param nodes - workflow nodes: `{ id, dependsOn }` (extra fields are ignored).
 * @param options - optional geometry overrides merged over {@link LAYOUT}.
 * @returns `{ nodes, edges, layers, width, height, cyclic, entryIds, terminalIds }`
 *   where each returned node is `{ id, layer, row, x, y, width, height, missingDeps }`.
 */
export function layoutDag(nodes, options) {
  const geometry = Object.assign({}, LAYOUT, options === undefined || options === null ? {} : options)
  const list = Array.isArray(nodes) ? nodes : []
  const ids = []
  const known = new Set()
  for (const node of list) {
    const id = node !== null && typeof node === 'object' && node.id !== undefined ? String(node.id) : ''
    if (id === '' || known.has(id)) continue
    known.add(id)
    ids.push(id)
  }
  const byId = new Map()
  for (const node of list) {
    if (node === null || typeof node !== 'object') continue
    const id = node.id === undefined ? '' : String(node.id)
    if (id === '' || byId.has(id)) continue
    byId.set(id, node)
  }
  /** Dependencies of `id` that exist in this workflow, de-duplicated. */
  const depsOf = (id) => {
    const node = byId.get(id)
    const raw = node !== undefined && Array.isArray(node.dependsOn) ? node.dependsOn : []
    const out = []
    for (const dep of raw) {
      const key = String(dep)
      if (known.has(key) && key !== id && out.indexOf(key) === -1) out.push(key)
    }
    return out
  }
  /** Dependency ids recorded on the node but absent from the workflow. */
  const missingOf = (id) => {
    const node = byId.get(id)
    const raw = node !== undefined && Array.isArray(node.dependsOn) ? node.dependsOn : []
    const out = []
    for (const dep of raw) {
      const key = String(dep)
      if (key === id || known.has(key) || out.indexOf(key) !== -1) continue
      out.push(key)
    }
    return out
  }
  const { order, cyclic } = topologicalOrder(ids, depsOf)
  const layerOf = new Map()
  for (const id of order) {
    let layer = 0
    for (const dep of depsOf(id)) {
      const candidate = (layerOf.has(dep) ? layerOf.get(dep) : 0) + 1
      if (candidate > layer) layer = candidate
    }
    layerOf.set(id, layer)
  }
  // A node inside a cycle never reached a layer: park it past the resolved graph
  // so it stays visible instead of silently disappearing from the canvas.
  let maxLayer = 0
  for (const layer of layerOf.values()) if (layer > maxLayer) maxLayer = layer
  for (const id of cyclic) layerOf.set(id, maxLayer + 1)
  const layers = []
  for (const id of ids) {
    const layer = layerOf.get(id)
    while (layers.length <= layer) layers.push([])
    layers[layer].push(id)
  }
  // One barycenter pass: order each layer by the mean row of its parents.
  const rowOf = new Map()
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]
    const scored = layer.map((id, position) => {
      const parents = depsOf(id).filter((dep) => rowOf.has(dep))
      if (parents.length === 0) return { id, score: position, hasParents: false }
      let sum = 0
      for (const parent of parents) sum += rowOf.get(parent)
      return { id, score: sum / parents.length, hasParents: true }
    })
    scored.sort((a, b) => {
      if (a.hasParents !== b.hasParents) return a.hasParents ? 1 : -1
      if (a.score !== b.score) return a.score - b.score
      return layer.indexOf(a.id) - layer.indexOf(b.id)
    })
    layers[index] = scored.map((entry) => entry.id)
    for (let row = 0; row < layers[index].length; row += 1) rowOf.set(layers[index][row], row)
  }
  const outNodes = []
  const positions = new Map()
  let maxRows = 0
  for (let layer = 0; layer < layers.length; layer += 1) {
    if (layers[layer].length > maxRows) maxRows = layers[layer].length
  }
  for (let layer = 0; layer < layers.length; layer += 1) {
    const count = layers[layer].length
    // Centre each layer's column vertically so a short layer does not hug the top.
    const offset = ((maxRows - count) * (geometry.nodeHeight + geometry.gapY)) / 2
    for (let row = 0; row < count; row += 1) {
      const id = layers[layer][row]
      const x = geometry.padding + layer * (geometry.nodeWidth + geometry.gapX)
      const y = geometry.padding + offset + row * (geometry.nodeHeight + geometry.gapY)
      const entry = {
        id,
        layer,
        row,
        x,
        y,
        width: geometry.nodeWidth,
        height: geometry.nodeHeight,
        missingDeps: missingOf(id),
      }
      positions.set(id, entry)
      outNodes.push(entry)
    }
  }
  const edges = []
  for (const id of ids) {
    for (const dep of depsOf(id)) {
      const from = positions.get(dep)
      const to = positions.get(id)
      if (from === undefined || to === undefined) continue
      edges.push({
        from: dep,
        to: id,
        x1: from.x + from.width,
        y1: from.y + from.height / 2,
        x2: to.x,
        y2: to.y + to.height / 2,
      })
    }
  }
  const width = layers.length === 0 ? geometry.padding * 2 : geometry.padding * 2 + layers.length * geometry.nodeWidth + (layers.length - 1) * geometry.gapX
  const height = maxRows === 0 ? geometry.padding * 2 : geometry.padding * 2 + maxRows * geometry.nodeHeight + (maxRows - 1) * geometry.gapY
  const entryIds = layers.length === 0 ? [] : layers[0].slice()
  const terminalIds = []
  for (const id of ids) {
    let hasChild = false
    for (const other of ids) {
      if (depsOf(other).indexOf(id) !== -1) {
        hasChild = true
        break
      }
    }
    if (!hasChild) terminalIds.push(id)
  }
  return { nodes: outNodes, edges, layers, width, height, cyclic, entryIds, terminalIds }
}

/**
 * Merge a workflow's geometry with live per-node run state.
 *
 * @param layout - a value from {@link layoutDag}.
 * @param nodeStates - run nodes from `pickRun`, or `undefined` for a static view.
 * @returns a new node array where each entry carries `status` and node detail.
 */
export function decorateDag(layout, nodeStates) {
  const byId = new Map()
  if (Array.isArray(nodeStates)) for (const state of nodeStates) byId.set(state.id, state)
  return layout.nodes.map((node) => {
    const state = byId.get(node.id)
    return Object.assign({}, node, {
      status: state === undefined ? 'pending' : state.status,
      assignee: state === undefined ? '' : state.assignee,
      output: state === undefined ? '' : state.output,
      error: state === undefined ? '' : state.error,
      tools: state === undefined ? '' : state.tools,
    })
  })
}
