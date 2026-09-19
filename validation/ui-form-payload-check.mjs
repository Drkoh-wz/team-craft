// The acceptance criterion is "a user can create an Agent in the UI". The UI
// builds its payload in settings-section.js saveAgent(); this posts that EXACT
// definition (minimal: no model when the provider/model fields are blank) and
// asserts the host stores it and the list returns it.
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = 'http://127.0.0.1:3080'
const BUNDLE = 'D:/ai-workspace/dsh/packages/team-flowise-client/dist/client.js'
const AGENT_STORE = join(homedir(), '.dsh', 'storages', 'team_agent_defs.json')

let failures = 0
let checks = 0
function check(label, condition, detail) {
  checks += 1
  if (condition) console.log('  ok   ' + label)
  else {
    failures += 1
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
  }
}

const source = readFileSync(BUNDLE, 'utf8')
const helpers = readFileSync('D:/ai-workspace/dsh/validation/_harness-part.mjs', 'utf8')
const makeHelpers = new Function(helpers + '\nreturn { materializeBundle }')
const { materializeBundle } = makeHelpers()

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : String(input.url)
  return realFetch(/^https?:/i.test(url) ? url : ORIGIN + url, init)
}
globalThis.window = { devicePixelRatio: 1 }
const face = materializeBundle(source).face
const store = face.createTeamStore()
await store.refresh()
const stateBefore = store.getState()
console.log('  store load: health=' + String(stateBefore.health) + ' agents=' + String(stateBefore.agents.length) + ' errors=' + JSON.stringify(stateBefore.errors))
check('the client store loads from the live host', stateBefore.health === 'ok' && stateBefore.agents.length > 0)

const stamp = 'ui' + String(Date.now()).slice(-6)
const definition = {
  id: '',
  name: 'UI-probe-' + stamp,
  role: 'worker',
  systemPrompt: 'validation probe',
  skills: ['pwsh'],
  tools: { allow: [], deny: [] },
  // no model: both provider and model inputs were left blank in the form
}
const before = statSync(AGENT_STORE).mtimeMs
const created = await store.actions.saveAgent(definition)
check('store.actions.saveAgent reports ok for the exact form payload', created.ok === true, JSON.stringify(created))
check('the host assigned an id', created.ok === true && created.value !== undefined && typeof created.value.id === 'string' && created.value.id !== '', JSON.stringify(created.ok ? created.value : null))
const stateAfter = store.getState()
check('the new agent appears in the store after the write', stateAfter.agents.some((agent) => agent.name === definition.name), JSON.stringify(stateAfter.agents.map((a) => a.name).slice(0, 8)))
check('the write reached ~/.dsh/storages', statSync(AGENT_STORE).mtimeMs > before, String(before))

const probeId = created.ok ? created.value.id : undefined
if (probeId !== undefined) {
  const removed = await store.actions.deleteAgent(probeId)
  check('store.actions.deleteAgent reports ok', removed.ok === true, JSON.stringify(removed))
  check('the probe is gone from the store', !store.getState().agents.some((agent) => agent.id === probeId))
  check('no probe residue on disk', !readFileSync(AGENT_STORE, 'utf8').includes(definition.name))
}

console.log('')
console.log(String(checks - failures) + ' passed, ' + String(failures) + ' failed')
process.exit(failures === 0 ? 0 : 1)
