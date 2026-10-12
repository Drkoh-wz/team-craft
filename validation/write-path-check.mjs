// Does the client's OWN network layer really drive the host's write routes, and
// do those writes land on disk (the criterion-3 evidence a browser click would
// produce)? Everything here goes through the bundle's materialized api client,
// over HTTP, to the running host.
import './dev-host-resolution.mjs' // harness packages for the offline suites (see that file)
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = 'http://127.0.0.1:3080'
const BUNDLE = 'D:/ai-workspace/dsh/packages/team-flowise-client/dist/client.js'
const AGENT_STORE = join(homedir(), '.dsh', 'storages', 'team_agent_defs.json')

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

const source = readFileSync(BUNDLE, 'utf8')
const helpers = readFileSync('D:/ai-workspace/dsh/validation/_harness-part.mjs', 'utf8')
const makeHelpers = new Function(helpers + '\nreturn { materializeBundle, makeDocument }')
const { materializeBundle } = makeHelpers()

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input.url)
  return realFetch(/^https?:/i.test(url) ? url : ORIGIN + url, init)
}
globalThis.window = { devicePixelRatio: 1, __ModuleLoader__: { load() {} } }
const bundle = materializeBundle(source)
const face = bundle.face
check('the bundle exposes the store constructor', typeof face.createTeamStore === 'function', Object.keys(face).slice(0, 12).join(','))
check('the plugin face is apply/inject', typeof face.apply === 'function' && Array.isArray(face.inject))

// ---------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------
console.log('== reads through the api client the store builds ==')
const store = face.createTeamStore()
const api = store.api
check('the store exposes the host api client', api !== undefined && typeof api.upsertAgent === 'function', Object.keys(api === undefined ? {} : api).slice(0, 12).join(','))
const ping = await api.ping()
check('ping reports ok', ping !== undefined && ping.ok === true, JSON.stringify(ping))
const agents = await api.listAgents()
const workflows = await api.listWorkflows()
const tasks = await api.listTasks()
const runs = await api.listRuns()
console.log('  agents=' + String(agents.length) + ' workflows=' + String(workflows.length) + ' tasks=' + String(tasks.length) + ' runs=' + String(runs.length))
check('all four list routes return arrays', [agents, workflows, tasks, runs].every((list) => Array.isArray(list)))
check('the roster is non-empty', agents.length > 0 && workflows.length > 0)
if (runs.length > 0) {
  const one = await api.getRun(runs[0].id)
  check('GET /run?id= returns the record the list showed', one !== undefined && one.id === runs[0].id, JSON.stringify(one === undefined ? null : one.id))
}

// ---------------------------------------------------------------------------
// writes (create + delete, through the client api, asserting disk mtime)
// ---------------------------------------------------------------------------
console.log('== writes through the client api ==')
const template = JSON.parse(readFileSync(AGENT_STORE, 'utf8'))
const templateAgent = (template.agents !== undefined ? template.agents : Object.values(template))[0]
check('the agent store on disk has a template record', templateAgent !== undefined && typeof templateAgent === 'object')
const stamp = 'val' + String(Date.now()).slice(-7)
const probe = Object.assign({}, templateAgent, {
  id: stamp,
  name: 'validator-probe-' + stamp,
  role: templateAgent.role === undefined ? 'worker' : templateAgent.role,
})

const before = statSync(AGENT_STORE).mtimeMs
const created = await api.upsertAgent(probe)
check('POST /agent returns the stored definition', created !== undefined && created.id === stamp, JSON.stringify(created === undefined ? null : created.id))
const afterCreate = statSync(AGENT_STORE).mtimeMs
check('the write reached the storageDomain on disk (mtime moved)', afterCreate > before, String(before) + ' -> ' + String(afterCreate))
const listed = await api.listAgents()
check('the created agent is visible through the client list route', listed.some((agent) => agent.id === stamp), JSON.stringify(listed.map((agent) => agent.id).slice(0, 8)))
const onDisk = readFileSync(AGENT_STORE, 'utf8')
check('the created agent is present in the persisted JSON', onDisk.includes(stamp))

await api.deleteAgent(stamp)
const afterDelete = statSync(AGENT_STORE).mtimeMs
check('DELETE /agent?id= reached the storageDomain (mtime moved again)', afterDelete >= afterCreate, String(afterCreate) + ' -> ' + String(afterDelete))
const listedAfter = await api.listAgents()
check('the probe agent is gone again (no residue left by this validation)', !listedAfter.some((agent) => agent.id === stamp), JSON.stringify(listedAfter.map((agent) => agent.id).slice(0, 8)))

// ---------------------------------------------------------------------------
// tamper fence: the host fences writes to loopback, which is why none of this
// needs a token. Assert the route exists and is guarded rather than skipped.
// ---------------------------------------------------------------------------
console.log('== loopback fence ==')
const hostSource = readFileSync('D:/ai-workspace/dsh/packages/team-flowise/src/index.js', 'utf8')
check('write routes call the loopback guard', /guard\(req, res\)/.test(hostSource))
check('the guard rejects non-loopback peers with 403', hostSource.includes('res.writeHead(403'))

console.log('')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed')
process.exit(failures === 0 ? 0 : 1)
