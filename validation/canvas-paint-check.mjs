// Canvas paint check: calls the bundle's OWN paintDag against a recording 2d
// context, which is the only way to prove the DAG tab paints (the React stub has
// no ref assignment, so the component's effect always sees a null canvas).
import { readFileSync } from 'node:fs'

const BUNDLE = 'D:/ai-workspace/dsh/packages/team-flowise-client/dist/client.js'
const source = readFileSync(BUNDLE, 'utf8')
const nodeHalf = await import('file:///D:/ai-workspace/dsh/packages/team-flowise-client/dist/index.js')

let checks = 0
let failures = 0
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start === -1) return undefined
  const end = source.indexOf(endMarker, start)
  if (end === -1) return undefined
  return source.slice(start, end)
}

const paintSource = sliceBetween('function paintDag(', 'function DagCanvas(')
check('the bundle contains the paintDag painter', paintSource !== undefined && paintSource.length > 500, String(paintSource === undefined ? 0 : paintSource.length))
check('the bundle contains layoutDag', source.indexOf('function layoutDag(') !== -1)
check('the bundle contains decorateDag', source.indexOf('function decorateDag(') !== -1)

// The painter sits inside the factory closure alongside ~100 sibling helpers,
// so it cannot be evaluated in isolation without its whole call graph. Instead:
// brace-match the painter's own body out of the emitted chunk, and evaluate it
// with the bundle's OTHER real dependency — layoutDag — imported from
// dist/index.js, which is the same contract module the browser half calls.
function takeFunction(marker) {
  const start = source.indexOf(marker)
  if (start === -1) return undefined
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return undefined
}

const paintBody = takeFunction('function paintDag(')
check('the paintDag body was extracted by brace matching', paintBody !== undefined && paintBody.startsWith('function paintDag(') && paintBody.endsWith('}'), String(paintBody === undefined ? 0 : paintBody.length))
const helperNames = ['function roundRect(', 'function fitText(', 'function statusColor(', 'function decorateDag(']
const helperBodies = helperNames.map((marker) => takeFunction(marker)).filter((entry) => entry !== undefined)
console.log('  extracted paintDag + ' + String(helperBodies.length) + '/' + String(helperNames.length) + ' helpers verbatim from the bundle')

const decls = [...helperBodies, paintBody]

console.log('  assembled ' + String(decls.length) + ' declarations (' + String(decls.reduce((sum, entry) => sum + entry.length, 0)) + ' chars)')

// `layoutDag` comes from dist/index.js — the same contract module the browser
// half imports — and LAYOUT / the palette map are supplied as plain values,
// because those are data, not the code under test.
const contract = nodeHalf
const factory = new Function(
  'layoutDag',
  'LAYOUT',
  'STATUS_ROLE',
  'STATUS_FALLBACK',
  'resolvePalette',
  decls.join('\n') + '\nfunction paintDagWrap(canvas, layout, nodeStates) { return paintDag(canvas, layout, nodeStates) }\nreturn { paintDag: paintDagWrap, layoutDag: layoutDag, LAYOUT: LAYOUT }',
)
let api
try {
  api = factory(
    contract.layoutDag,
    { padding: 16, nodeWidth: 168, nodeHeight: 62, gapX: 24, gapY: 28 },
    { pending: 'muted', completed: 'success', failed: 'danger' },
    { pending: '#c4c8ce', completed: '#4caf50', failed: '#f44336' },
    () => ({ muted: '#c4c8ce', success: '#4caf50', danger: '#f44336', border: '#d0d3d8', surface: '#ffffff', text: '#111111', warn: '#e6a700' }),
  )
} catch (error) {
  check('the extracted declarations evaluate', false, String(error))
}

if (api !== undefined) {
  check('the extracted declarations evaluate', true)
  const calls = []
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    measureText: (text) => ({ width: String(text).length * 6 }),
  }
  const record = (name) => (...args) => calls.push({ name, args })
  for (const name of ['setTransform', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill']) context[name] = record(name)
  context.fillText = (text, x, y) => calls.push({ name: 'fillText', args: [text, x, y] })
  const canvas = { width: 0, height: 0, style: {}, getContext: () => context }

  globalThis.window = { devicePixelRatio: 2 }
  const layout = api.layoutDag([
    { id: 'plan', dependsOn: [] },
    { id: 'build', dependsOn: ['plan'] },
    { id: 'test', dependsOn: ['build'] },
    { id: 'docs', dependsOn: ['plan'] },
  ])
  let paintError
  let painted
  try {
    painted = api.paintDag(canvas, layout, [{ id: 'plan', status: 'completed', assignee: 'pm', output: '', error: '', layer: 0, missingDeps: [] }])
  } catch (error) {
    paintError = error
  }
  check('paintDag runs without throwing', paintError === undefined, paintError === undefined ? '' : String(paintError))
  const names = calls.map((call) => call.name)
  const labels = calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]))
  console.log('  paint: ' + String(calls.length) + ' calls, setTransform=' + String(names.includes('setTransform')) + ', clearRect=' + String(names.includes('clearRect')) + ', strokes=' + String(names.filter((n) => n === 'stroke').length) + ', fills=' + String(names.filter((n) => n === 'fill').length))
  console.log('  labels: ' + JSON.stringify(labels))
  check('the painter transforms and clears the canvas', names.includes('setTransform') && names.includes('clearRect'))
  check('the painter strokes each edge and each box', names.filter((n) => n === 'stroke').length >= layout.edges.length + layout.nodes.length, String(names.filter((n) => n === 'stroke').length) + ' for ' + String(layout.edges.length) + ' edges + ' + String(layout.nodes.length) + ' boxes')
  check('the painter labels every node id', ['plan', 'build', 'test', 'docs'].every((id) => labels.some((label) => label.indexOf(id) !== -1)), JSON.stringify(labels))
  check('the backing store honours devicePixelRatio', canvas.width === Math.round(painted.width) * 2 && canvas.height === Math.round(painted.height) * 2, JSON.stringify({ canvas: [canvas.width, canvas.height], laid: [painted.width, painted.height] }))
}

console.log('')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed')
process.exit(failures === 0 ? 0 : 1)
