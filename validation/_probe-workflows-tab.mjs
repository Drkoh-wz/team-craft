// Focused probe: does the Workflows tab actually render the live workflow names?
import { readFileSync } from 'node:fs'
const ORIGIN = 'http://127.0.0.1:3080'
const source = readFileSync('D:/ai-workspace/dsh/packages/team-flowise-client/dist/client.js', 'utf8')
const helpers = readFileSync('D:/ai-workspace/dsh/validation/_harness-part.mjs', 'utf8')
const { materializeBundle, applyToSlots, flatten, findNode, makeDocument, walk } = new Function(
  helpers + '\nreturn { materializeBundle, applyToSlots, flatten, findNode, makeDocument, walk }',
)()
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input.url)
  return realFetch(/^https?:/i.test(url) ? url : ORIGIN + url, init)
}
globalThis.document = makeDocument()
const bundle = materializeBundle(source)
globalThis.window = bundle.window
const react = bundle.react
const applied = applyToSlots(bundle.face)
const component = applied.entries.get('settings.section/team-flowise').component
const props = { close() {} }
let tree = react.mount(component(props))
react.flushEffects()
await new Promise((resolve) => setTimeout(resolve, 1200))
react.settle()
tree = react.mount(component(props))

function tabButtons(node) {
  const out = []
  walk(node, (entry) => {
    if (entry.type !== 'button') return
    const text = flatten(entry).replace(/<([a-z]+)>/g, ' ').replace(/className=\S+/g, '').replace(/key=\S+/g, '').replace(/type=\S+/g, '').replace(/disabled=\S+/g, '').replace(/\s+/g, ' ').trim()
    out.push(text)
  })
  return out
}
console.log('buttons before click:', JSON.stringify(tabButtons(tree)))
const target = findNode(tree, (node) => node.type === 'button' && typeof node.props === 'object' && typeof node.props.onClick === 'function' && node.props.className === 'tfc-tab' && flatten(node).includes('工作流'))
console.log('tab button matched by className tfc-tab:', target !== undefined)
// Which index is it in the tab strip?
const tabs = []
walk(tree, (entry) => {
  if (entry.type === 'button' && typeof entry.props === 'object' && typeof entry.props.className === 'string' && entry.props.className.indexOf('tfc-tab') === 0) tabs.push(entry)
})
console.log('tab strip labels:', JSON.stringify(tabs.map((entry) => flatten(entry).replace(/<([a-z]+)>/g, ' ').replace(/className=\S+/g, '').replace(/type=\S+/g, '').replace(/\s+/g, ' ').trim())))
target.props.onClick()
react.settle()
const after = react.mount(component(props))
const text = flatten(after)
const names = (await (await realFetch(ORIGIN + '/api/team-flowise/workflows')).json()).workflows.map((w) => w.name)
console.log('after click, rendered text contains each live workflow name:')
for (const name of names) console.log('   ' + String(text.includes(name)).padEnd(6) + name)
console.log('item titles rendered:', JSON.stringify([...text.matchAll(/tfc-item-title\s+([^\s]+(?:\s[^\s]+)?)/g)].map((m) => m[1]).slice(0, 10)))
console.log('full stripped text:', text.replace(/<([a-z]+)>/g, ' ').replace(/className=\S+/g, '').replace(/key=\S+/g, '').replace(/type=\S+/g, '').replace(/disabled=\S+/g, '').replace(/\s+/g, ' ').slice(0, 1200))
process.exit(0)
