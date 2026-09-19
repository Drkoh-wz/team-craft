import { readFileSync } from 'node:fs'
const payload = await (await fetch('http://127.0.0.1:3080/api/team-flowise/workflows')).json()
const wf = payload.workflows
console.log('count:', wf.length)
console.log('first record keys:', Object.keys(wf[0]).join(','))
console.log('first record:', JSON.stringify(wf[0]).slice(0, 400))
console.log('names:', JSON.stringify(wf.map((entry) => entry.name)))
const nodeHalf = await import('file:///D:/ai-workspace/dsh/packages/team-flowise-client/dist/index.js')
console.log('reduced:', JSON.stringify(wf.map(nodeHalf.pickWorkflow).map((entry) => ({ id: entry.id, name: entry.name, nodes: entry.nodes.length })), null, 0).slice(0, 600))
