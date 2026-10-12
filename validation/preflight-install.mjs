/**
 * validation/preflight-install.mjs — the release gate: does the artefact we are
 * about to publish actually install, and does a freshly installed copy work?
 *
 * Every other suite in this directory tests the SOURCE. This one tests the
 * PUBLISHED FORM, and it is deliberately the only one that does not share the
 * repository's own checkout with the running plugin — each route gets its own
 * throwaway DSH_HOME and is judged on effects, never on the installer's report:
 *
 *   A.  three install routes, each in a profile of its own:
 *         file:<package dir>                     (the clone / manual route)
 *         git+file://<bare clone>#path:…         (the GitHub route, stood in for by
 *                                                 a bare clone of THIS repository,
 *                                                 so the multi-package layout and
 *                                                 the absent root package.json are
 *                                                 the real ones)
 *         <dist/team-flowise.tgz>                (the catalog's `tarball:` field)
 *       judged by: exit code, the files that landed, whether the package's own
 *       imports resolve from where they landed, and whether the composed profile
 *       tree carries the host row.
 *
 *   A2. the registration order inside apply(), which is what lets B2 below speak
 *       for tool registration without a model to call the tools.
 *
 *   B1. the case that used to brick a profile, now asserted the other way round:
 *       `dsh plugin add` initializes a brand-new profile with only
 *       `@deepseek-ai/dsh-base`, which has no webServer. The browser bridge is
 *       requested dynamically (`ctx.inject`) rather than declared in `inject`, so
 *       such a profile must boot and stay up — the missing web server costs the
 *       browser half, not the whole host.
 *
 *   B2. install into a web-shaped profile (what `dsh plugin --profile web add`
 *       is), boot it on a free port, and drive the whole HTTP surface: the four
 *       domains, every read route, the zod-validated write path, the task state
 *       machine, the scheduler, and the two storage files on disk.
 *
 * Requires: `dsh` on PATH and network access for pnpm. Starts a temporary dsh
 * host on a free loopback port and kills it (with its process tree) afterwards;
 * it never touches the default profile.
 *
 * Usage: node validation/preflight-install.mjs [--repo <dir>] [--tgz <file>]
 * Exit:  0 = every route installs and the booted copy works, 1 = something did not.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const argvFlag = (flag) => {
  const i = process.argv.indexOf(flag)
  return i === -1 || i + 1 >= process.argv.length ? null : process.argv[i + 1]
}
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(argvFlag('--repo') ?? join(HERE, '..'))
const DIST_TGZ = resolve(argvFlag('--tgz') ?? join(REPO, 'dist', 'team-flowise.tgz'))

/* ------------------------------------------------------------------ harness
 * Which harness to install into and boot. This used to be the npm-global `dsh`
 * on PATH, which is an assumption that does not hold on a machine running DSH
 * Desktop: there the CLI lives inside the app bundle and no global `dsh` exists
 * at all, so every route reported "PACKAGE MISSING" instead of testing anything.
 *
 * Discovery, first hit wins:
 *   --dsh <path to lib/bin.js>   explicit
 *   $DSH_BIN                     same thing, in the environment
 *   the npm-global install       the classic CLI
 *   DSH Desktop                  its bundled harness, run through Electron in
 *                                Node mode (it has to read packages out of app.asar)
 */
const DESKTOP_ROOT = argvFlag('--desktop') ?? 'D:\\dsh\\DSH Desktop'

function discoverHarness() {
  const explicit = argvFlag('--dsh') ?? process.env.DSH_BIN ?? null
  const candidates = []
  if (explicit !== null) candidates.push({ label: 'given', bin: explicit, node: process.execPath, prefix: [] })
  candidates.push({
    label: 'npm-global dsh',
    bin: join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    node: process.execPath,
    prefix: [],
  })
  candidates.push({
    label: 'DSH Desktop',
    bin: join(DESKTOP_ROOT, 'resources', 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    node: join(DESKTOP_ROOT, 'DSH Desktop.exe'),
    prefix: [join(DESKTOP_ROOT, 'resources', 'harness-node-entry.mjs')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
  for (const c of candidates) {
    if (!fs.existsSync(c.bin)) continue
    try {
      // A shim without its package (npm left the launcher and removed the tree)
      // looks installed and answers nothing -- so actually run it.
      const v = execFileSync(c.node, [...c.prefix, c.bin, '--version'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
        env: { ...process.env, ...(c.env ?? {}) },
      }).trim()
      if (v !== '') return { ...c, version: v }
    } catch { /* try the next one */ }
  }
  throw new Error(
    'no usable DSH harness found. Pass --dsh <path to .../@deepseek-ai/dsh/lib/bin.js>, ' +
    `or --desktop <DSH Desktop install dir> (tried: ${candidates.map((c) => c.label).join(', ')})`,
  )
}

const HARNESS = discoverHarness()
/**
 * Run one harness command synchronously.
 *
 * Deliberately NOT through `sh()`: that one goes through a shell to let `git` and
 * `taskkill` be found on PATH, and a shell splits an executable path on its spaces
 * — `D:\dsh\DSH Desktop\DSH Desktop.exe` never ran, so every route reported a
 * failed install and the gate blamed the plugin for it.
 */
const harness = (args, env) =>
  execFileSync(HARNESS.node, [...HARNESS.prefix, HARNESS.bin, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, ...(HARNESS.env ?? {}) },
  })
/** Spawn a long-lived harness process (the web app). */
const harnessSpawn = (args, env) =>
  spawn(HARNESS.node, [...HARNESS.prefix, HARNESS.bin, ...args],
    { env: { ...env, ...(HARNESS.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

console.log(`harness: ${HARNESS.label} ${HARNESS.version}  (${HARNESS.bin})`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-preflight-'))
const results = []
const ok = (label, cond, detail = '') => {
  results.push({ label, cond: !!cond, detail })
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? '  -> ' + detail : ''}`)
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts })

const freePort = () => new Promise((resolve) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(url, { method = 'GET', body, timeout = 15000 } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, text, json }
  } catch (e) {
    return { status: 0, text: String(e.message), json: null }
  }
}

function installedFiles(dir) {
  if (!fs.existsSync(dir)) return null
  const walk = (d, base = d, acc = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, base, acc)
      else acc.push(path.relative(base, p).split(path.sep).join('/'))
    }
    return acc
  }
  return walk(dir).sort()
}

/**
 * Where each import resolves FROM THE INSTALLED COPY, by plain Node resolution.
 *
 * The two answers mean different things, and conflating them is what let the
 * Desktop failure through:
 *   - the plugin's own dependency (zod) must resolve — a link-style install never
 *     installs the target's dependencies, so the plugin has to carry its own;
 *   - a host package (`@deepseek-ai/*`) must NOT resolve from inside the plugin
 *     directory. The harness supplies those at import time, and a copy sitting in
 *     the plugin's own tree is found first and wins.
 * So this returns the resolved PATH, not a verdict, and the caller judges.
 */
function resolveFrom(profileDir) {
  const base = path.join(profileDir, 'node_modules', '@local', 'team-flowise', 'src', 'index.js')
  if (!fs.existsSync(base)) return { missing: true }
  const req = createRequire(base)
  const out = {}
  for (const s of ['zod', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain']) {
    try { out[s] = req.resolve(s) } catch (e) { out[s] = e.code }
  }
  return out
}

/* ======================================================================
   A. the three install routes
   ====================================================================== */
const routes = []

async function installRoute(id, spec, { bare } = {}) {
  console.log(`\n=== route ${id} ===`)
  console.log(`  spec: ${spec}`)
  const home = path.join(tmp, `home-${id}`)
  fs.mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }
  let out = ''
  let code = 0
  try {
    out = harness(['plugin', '--profile', id, 'add', spec], env)
  } catch (e) {
    code = e.status ?? -1
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const tail = out.split('\n').filter((l) => /Packages:|Done|WARN|ERR|error/i.test(l)).map((l) => '    ' + l.trim()).join('\n')
  console.log(tail || '    (no summary lines)')
  const profileDir = path.join(home, 'profiles', id)
  const pkgDir = path.join(profileDir, 'node_modules', '@local', 'team-flowise')
  const files = installedFiles(pkgDir)
  let dump = ''
  try { dump = harness(['--profile', id, '--dump-config'], env) } catch (e) { dump = String(e.stdout || '') + String(e.stderr || '') }
  const rec = {
    id, spec, code, profileDir, files,
    hasRow: /-\s*id:\s*flowise-team/.test(dump),
    resolution: resolveFrom(profileDir),
  }
  routes.push(rec)
  console.log(`    installed entries: ${files === null ? 'PACKAGE MISSING' : files.length + ' -> ' + files.join(', ')}`)
  console.log(`    composed row: ${rec.hasRow ? 'present' : 'ABSENT'}`)
  console.log(`    resolution: ${JSON.stringify(rec.resolution)}`)
  return rec
}

console.log('### A. install routes')
await installRoute('rFile', `file:${path.join(REPO, 'packages', 'team-flowise')}`)

// The GitHub route, stood in for by a bare clone of this very repository (so the
// multi-package layout, the absent root package.json and .gitattributes are all
// the real ones).
const bare = path.join(tmp, 'team-craft.git')
sh('git', ['clone', '-q', '--bare', REPO, bare])
const bareUrl = 'git+file:///' + bare.replace(/\\/g, '/')
await installRoute('rGit', `${bareUrl}#path:packages/team-flowise`)

// The route the catalog's `tarball:` field points at.
await installRoute('rTgz', DIST_TGZ)

for (const r of routes) {
  console.log(`\n-- ${r.id}: judgements`)
  ok(`${r.id}: the install command exits 0`, r.code === 0, 'exit=' + r.code)
  ok(`${r.id}: the package landed in the profile`, Array.isArray(r.files) && r.files.length > 0, (r.files || []).length + ' entries')
  ok(`${r.id}: every file the runtime needs is present`,
    Array.isArray(r.files) && ['package.json', 'cordis.patch.yml', 'src/index.js', 'src/client/index.js'].every((f) => r.files.includes(f)))
  ok(`${r.id}: the plugin's own dependency (zod) resolves from where it landed`,
    r.resolution.zod !== undefined && !/^ERR_/.test(String(r.resolution.zod)), String(r.resolution.zod))
  const pluginDir = path.join(r.profileDir, 'node_modules', '@local', 'team-flowise')
  const vendored = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain']
    .filter((s) => typeof r.resolution[s] === 'string' && r.resolution[s].startsWith(pluginDir))
  ok(`${r.id}: no host package is vendored into the installed copy (the harness supplies them; a copy in the plugin's own tree shadows it)`,
    vendored.length === 0, vendored.join(', ') || JSON.stringify(['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain'].map((s) => r.resolution[s])))
  ok(`${r.id}: the composed tree carries the flowise-team row`, r.hasRow)
  ok(`${r.id}: no screenshot assets shipped`, !(r.files || []).some((f) => f.includes('screenshots')))
}

/* ======================================================================
   A2. the argument that makes /ping evidence for the tools: both are registered
       in the same synchronous apply(), tools first. Asserted against the source
       rather than remembered, because it is what lets the boot test below speak
       for tool registration without a model to call them.
   ====================================================================== */
console.log('\n### A2. registration order inside apply()')
{
  const src = fs.readFileSync(path.join(REPO, 'packages', 'team-flowise', 'src', 'index.js'), 'utf8')
  const idx = (s) => src.indexOf(s)
  const toolAt = idx('tools.register(defineTool(')
  const routeAt = idx("route('exact', '/api/team-flowise/ping'")
  const provideAt = idx("ctx.provide('teamOrchestrator'")
  const names = [...new Set([...src.matchAll(/mk\(\s*'?(team_[a-z_]+)'?/g)].map((m) => m[1]))]
  console.log('    tool registration @' + toolAt + ', service @' + provideAt + ', first route @' + routeAt)
  console.log('    tools declared: ' + names.join(', '))
  ok('A2: model tools are registered before the service and the HTTP routes, in one synchronous apply()',
    toolAt > 0 && provideAt > toolAt && routeAt > provideAt, `${toolAt} < ${provideAt} < ${routeAt}`)
  ok('A2: all 7 documented team_* tools exist in the source', names.length === 7, names.length + ' -> ' + names.join(', '))
}

/* ======================================================================
   A3. the source-tree invariant whose violation cost a DSH Desktop outage.

   Node resolves a symlinked plugin's imports from the plugin's physical source
   directory first. A copy of a HOST package sitting in that directory therefore
   wins, and the host's own module fallback never runs — its retry only fires on
   a resolution *failure*. That is exactly what happened: the package carried
   `@deepseek-ai/dsh-tools@0.1.x` from an old local install, Desktop was on
   0.2.0-rc.2, and the stale copy crashed importing `CallId` from the host's
   `dsh-llm`, taking the whole bootstrap down with it ("1 required plugin did not
   activate").

   Host packages are peers and must never be vendored here. The plugin's own
   dependency (zod) is different: a link-style install does not install the
   target's dependencies, so that one has to be present.
   ====================================================================== */
console.log('\n### A3. the plugin directory carries no host package')
{
  const nm = path.join(REPO, 'packages', 'team-flowise', 'node_modules')
  const hostCopies = []
  const walkDirs = (d, depth = 0) => {
    if (depth > 4) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      if (e.name === '@deepseek-ai') hostCopies.push(path.relative(REPO, p).replace(/\\/g, '/'))
      walkDirs(p, depth + 1)
    }
  }
  const hasNodeModules = fs.existsSync(nm)
  if (hasNodeModules) walkDirs(nm)
  console.log('    plugin node_modules: ' + (hasNodeModules ? 'present' : 'absent') +
    (hasNodeModules ? ', host copies: ' + (hostCopies.length === 0 ? 'none' : hostCopies.join(', ')) : ''))
  ok('A3: no @deepseek-ai package is vendored inside the plugin directory (a copy there shadows the host and disables its fallback)',
    hostCopies.length === 0, hostCopies.join(', ') || 'clean')
  const ownDepPresent = !hasNodeModules || fs.existsSync(path.join(nm, 'zod'))
  ok('A3: if the directory has a node_modules, it carries the plugin\'s OWN dependency (zod) for link-style installs',
    ownDepPresent, hasNodeModules ? 'zod ' + (fs.existsSync(path.join(nm, 'zod')) ? 'present' : 'MISSING') : 'no node_modules at all')
}

/* ======================================================================
   B1. the case that used to brick a profile: `dsh plugin add` initializes a
       profile for an unknown name with only `@deepseek-ai/dsh-base`, which has
       no webServer. That is now a missing FEATURE (no browser bridge) instead of
       an assembly precondition, so the profile must boot and stay up. This is
       the inverse of the failure that motivated the change, asserted rather than
       remembered.
   ====================================================================== */
console.log('\n### B1. install into a profile that has no web server (dsh plugin add initializes one)')
{
  const id = 'rBare'
  const home = path.join(tmp, `home-${id}`)
  fs.mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }
  harness(['plugin', '--profile', id, 'add', DIST_TGZ], env)
  const profilePkg = JSON.parse(fs.readFileSync(path.join(home, 'profiles', id, 'package.json'), 'utf8'))
  console.log('    bundles it initialized with: ' + JSON.stringify(profilePkg.dsh.profile.bundles))
  const port = await freePort()
  let log = ''
  const bare = harnessSpawn(['--profile', id, '--port', String(port)], env)
  bare.stdout.on('data', (d) => { log += d.toString() })
  bare.stderr.on('data', (d) => { log += d.toString() })
  await sleep(20000)
  const stillRunning = bare.exitCode === null
  const activationFailure = /did not activate|waiting for service/.test(log)
  console.log('    after 20s: exitCode=' + String(bare.exitCode) + ' stdout+stderr bytes=' + log.length)
  if (log.trim() !== '') console.log('    log:\n      ' + log.split('\n').filter(Boolean).slice(0, 10).join('\n      ').slice(0, 700))
  ok('B1: a profile with no web server boots with this plugin instead of refusing to start',
    stillRunning, 'exitCode=' + String(bare.exitCode))
  ok('B1: the old activation failure is gone (no "did not activate", no "waiting for service")',
    !activationFailure, activationFailure ? log.split('\n').find((l) => /did not activate|waiting for service/.test(l)).trim().slice(0, 200) : 'clean')
  try { sh('taskkill', ['/F', '/T', '/PID', String(bare.pid)]) } catch { /* already gone */ }
}

/* ======================================================================
   B2. the route the README documents: install into a WEB-shaped profile
       (what `dsh plugin --profile web add` is), boot it, drive everything.
   ====================================================================== */
console.log('\n### B2. install into a web-shaped profile, boot it, and drive its whole HTTP surface')
const webProfile = 'rWeb'
const webHome = path.join(tmp, `home-${webProfile}`)
{
  // The live web profile's bundle list, minus the unrelated third-party plugin:
  // this is what `dsh plugin --profile web add <spec>` runs against.
  const dir = path.join(webHome, 'profiles', webProfile)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n', 'utf8')
  // The workspace file dsh itself writes when it initialises a profile (copied
  // from one, not invented). Without it pnpm falls back to ITS OWN defaults --
  // autoInstallPeers true, the isolated linker -- and installs 27 packages with a
  // nested node_modules into a shape no real dsh profile ever has. That is a
  // harness bug rather than a plugin one, and it is invisible unless the installed
  // SET is asserted: with the wrong defaults this profile still booted and served.
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8')
  const env = { ...process.env, DSH_HOME: webHome }
  harness(['plugin', '--profile', webProfile, 'add', DIST_TGZ], env)
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  console.log('    bundles after add: ' + JSON.stringify(pkg.dsh.profile.bundles))
  const files = installedFiles(path.join(dir, 'node_modules', '@local', 'team-flowise'))
  console.log('    installed entries: ' + (files === null ? 'MISSING' : files.length + ' -> ' + files.join(', ')))
  ok('B2: the plugin lands in a web-shaped profile and joins its bundle list',
    Array.isArray(files) && files.includes('src/index.js') && pkg.dsh.profile.bundles.includes('@local/team-flowise'))
  // Exactly the published set, and nothing else: this is the assertion that would
  // have caught the harness installing under pnpm's defaults instead of dsh's.
  ok('B2: the install pulls exactly the published 7 entries (a nested node_modules here would mean the profile is not shaped like a real one)',
    Array.isArray(files) && files.length === 7 && !files.some((f) => f.includes('screenshots') || f.includes('node_modules')),
    (files || []).length + ' entries')
}
const port = await freePort()
const env = { ...process.env, DSH_HOME: webHome }
const child = harnessSpawn(['--profile', webProfile, '--port', String(port)], env)
let bootLog = ''
child.stdout.on('data', (d) => { bootLog += d.toString() })
child.stderr.on('data', (d) => { bootLog += d.toString() })
const base = `http://127.0.0.1:${port}`

let up = false
for (let i = 0; i < 60; i += 1) {
  await sleep(1000)
  const r = await http(`${base}/api/team-flowise/ping`, { timeout: 3000 })
  if (r.status === 200) { up = true; break }
  if (child.exitCode !== null) break
}
ok(`a host booted from the installed copy answers /ping (port ${port})`, up,
  up ? 'status 200' : `exitCode=${child.exitCode} log=${bootLog.split('\n').slice(-3).join(' | ').slice(0, 300)}`)

if (up) {
  const ping = await http(`${base}/api/team-flowise/ping`)
  ok('ping reports ok:true', ping.json?.ok === true, JSON.stringify(ping.json).slice(0, 120))
  ok('all four storage domains are open', Array.isArray(ping.json?.domains) && ping.json.domains.length === 4, JSON.stringify(ping.json?.domains))

  // Every read route answers with the shape the client half expects.
  for (const [name, url, key] of [
    ['GET /agents', '/agents', 'agents'],
    ['GET /workflows', '/workflows', 'workflows'],
    ['GET /tasks', '/tasks', 'tasks'],
    ['GET /runs', '/runs', 'runs'],
  ]) {
    const r = await http(base + '/api/team-flowise' + url)
    ok(`${name} -> 200 with a "${key}" array`, r.status === 200 && Array.isArray(r.json?.[key]), 'status=' + r.status)
  }
  const models = await http(`${base}/api/team-flowise/models`)
  ok('GET /models never 500s (reports missing configuration as data)', models.status === 200 && models.json?.ok === true,
    JSON.stringify(models.json).slice(0, 160))

  // Write path: create a role, read it back, create a workflow, then a task.
  const agentId = 'preflight-role'
  const a = await http(`${base}/api/team-flowise/agent`, {
    method: 'POST',
    body: { id: agentId, name: 'Preflight', role: 'verifier', systemPrompt: 'Say ok.', model: { provider: 'deepseek-official', model: 'deepseek-flash' } },
  })
  ok('POST /agent stores a role (zod-validated write path)', a.status === 200 && a.json?.ok === true && a.json?.agent?.id === agentId,
    JSON.stringify(a.json).slice(0, 160))

  const agents = await http(`${base}/api/team-flowise/agents`)
  ok('the role is readable back from durable storage', (agents.json?.agents || []).some((x) => x.id === agentId))

  const wfId = 'preflight-flow'
  const w = await http(`${base}/api/team-flowise/workflow`, {
    method: 'POST',
    body: {
      id: wfId,
      name: 'Preflight flow',
      nodes: {
        n1: { id: 'n1', title: 'first', agent: agentId, taskTemplate: { requirement: 'do the first thing', acceptanceCriteria: 'it is done' }, dependsOn: [] },
        n2: { id: 'n2', title: 'second', agent: agentId, taskTemplate: { requirement: 'then the second' }, dependsOn: ['n1'] },
      },
    },
  })
  ok('POST /workflow stores a two-node graph', w.status === 200 && w.json?.ok === true && Object.keys(w.json?.workflow?.nodes || {}).length === 2,
    JSON.stringify(w.json).slice(0, 200))

  const wf = await http(`${base}/api/team-flowise/workflows`)
  ok('the workflow is readable back', (wf.json?.workflows || []).some((x) => x.id === wfId))

  const tc = await http(`${base}/api/team-flowise/task/create`, {
    method: 'POST', body: { requirement: 'a hand-made task', assignee: agentId, workflowId: wfId },
  })
  const taskId = tc.json?.task?.id
  ok('POST /task/create puts a task on the ledger', tc.status === 200 && tc.json?.ok === true && typeof taskId === 'string', JSON.stringify(tc.json).slice(0, 160))

  const rw = await http(`${base}/api/team-flowise/task/rework`, { method: 'POST', body: { id: taskId, feedback: 'try again' } })
  // A queued task may NOT go straight to reworked: TASK_TRANSITIONS.queued is
  // ['submitted']. Asking for it anyway must be refused by the state machine
  // rather than silently accepted, and the message must name the transition.
  console.log('    rework-on-queued response: ' + JSON.stringify(rw.json).slice(0, 200))
  ok('POST /task/rework refuses an illegal transition instead of forcing it (queued -> reworked is not in TASK_TRANSITIONS)',
    rw.json?.ok === false && /invalid transition/i.test(String(rw.json?.error)), JSON.stringify(rw.json).slice(0, 160))

  const tasks = await http(`${base}/api/team-flowise/tasks`)
  ok('the ledger shows the hand-made task', (tasks.json?.tasks || []).some((x) => x.id === taskId))
  ok('the refused rework left the task queued and untouched',
    (tasks.json?.tasks || []).some((x) => x.id === taskId && x.status === 'queued' && (x.history || []).length === 0))

  // The scheduler. With no model configured in this throwaway home the worker
  // cannot run, and that is the point: what is being checked is that the run is
  // created, published with an id, and its nodes reach a terminal state with the
  // failure recorded -- not that a model answered.
  const rs = await http(`${base}/api/team-flowise/run/start`, { method: 'POST', body: { workflowId: wfId } })
  const runId = rs.json?.run?.id
  ok('POST /run/start publishes a run id', rs.status === 200 && typeof runId === 'string', JSON.stringify(rs.json).slice(0, 160))

  if (runId) {
    let detail = null
    for (let i = 0; i < 20; i += 1) {
      await sleep(3000)
      const r = await http(`${base}/api/team-flowise/run?id=${encodeURIComponent(runId)}`)
      detail = r.json?.run
      const states = Object.values(detail?.nodeStates || {})
      if (states.length > 0 && states.every((s) => s.status === 'completed' || s.status === 'failed')) break
    }
    const states = Object.entries(detail?.nodeStates || {})
    console.log('    run outcome: status=' + detail?.status + ' nodes=' +
      JSON.stringify(states.map(([k, v]) => [k, v.status])))
    if (states.length > 0) {
      console.log('    first node error: ' + String(states[0][1].error || '(none)').slice(0, 160))
    }
    ok('the run was recorded with per-node state (the scheduler ran)', states.length > 0, 'nodes=' + states.length)
    ok('per-node state reached a terminal status rather than hanging',
      states.length > 0 && states.every(([, v]) => v.status === 'completed' || v.status === 'failed'))

    const prog = await http(`${base}/api/team-flowise/progress?runId=${encodeURIComponent(runId)}`)
    ok('GET /progress returns a summary for the run', prog.status === 200 && prog.json?.ok === true,
      JSON.stringify(prog.json).slice(0, 140))
    const role = await http(`${base}/api/team-flowise/role?runId=${encodeURIComponent(runId)}&agent=${encodeURIComponent(agentId)}`)
    ok('GET /role returns that role\'s view of the run', role.status === 200 && role.json?.ok === true,
      JSON.stringify(role.json).slice(0, 140))
  }

  /* ---- the client half ------------------------------------------------------
     What is measurable here is that the installed copy SHIPS the browser half
     and declares it: a stale or missing `src/client/index.js` is exactly the
     failure this catches. What is NOT measurable from this throwaway home is the
     last hop — a real browser fetching it — because dsh's web shell wants its own
     credentials and, in a synthetic profile, answered 401 with the boot token and
     404 without. That hop is reported below as information, not asserted. */
  console.log('\n  -- client half --')
  const repoClient = path.join(REPO, 'packages', 'team-flowise', 'src', 'client', 'index.js')
  const instClient = path.join(webHome, 'profiles', webProfile, 'node_modules', '@local', 'team-flowise', 'src', 'client', 'index.js')
  const sha = (p) => (fs.existsSync(p) ? execFileSync(process.execPath, ['-e', "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))", p], { encoding: 'utf8' }).trim() : null)
  const repoClientHash = sha(repoClient)
  const instClientHash = sha(instClient)
  ok('the installed copy ships the browser half, byte-identical to the source',
    repoClientHash !== null && repoClientHash === instClientHash,
    'repo=' + String(repoClientHash).slice(0, 16) + ' installed=' + String(instClientHash).slice(0, 16))
  const instPkg = JSON.parse(fs.readFileSync(path.join(webHome, 'profiles', webProfile, 'node_modules', '@local', 'team-flowise', 'package.json'), 'utf8'))
  ok('the installed manifest declares dsh.client for the web platform (this is what makes the shell load it)',
    instPkg.dsh?.client?.platform === 'web' && Array.isArray(instPkg.dsh.client.inject) && instPkg.dsh.client.inject.length === 8,
    JSON.stringify(instPkg.dsh?.client && { platform: instPkg.dsh.client.platform, injects: instPkg.dsh.client.inject.length }))

  const tokenMatch = /\?token=([A-Za-z0-9_-]+)/.exec(bootLog)
  const token = tokenMatch === null ? null : tokenMatch[1]
  const index = await http(base + '/' + (token === null ? '' : '?token=' + token), { timeout: 15000 })
  const indexNoToken = await http(base + '/', { timeout: 15000 })
  console.log('    info: GET / -> ' + indexNoToken.status + ' without a token, ' + index.status + ' with the boot token')
  console.log('    info: not asserted — dsh\'s web shell owns that gate, not this plugin; the live deployment serves the same bytes')

  /* ---- storage really landed on disk in THIS home ---- */
  const storageFiles = ['team_agent_defs.json', 'team_ledger.json', 'team_workflows.json', 'team_runs.json']
    .filter((f) => fs.existsSync(path.join(webHome, 'storages', f)))
  ok('all four storage domains wrote their own file under this DSH_HOME', storageFiles.length === 4, storageFiles.join(', '))

  // Clean up the two records so the check is repeatable.
  await http(`${base}/api/team-flowise/agent?id=${encodeURIComponent(agentId)}`, { method: 'DELETE' })
  await http(`${base}/api/team-flowise/workflow?id=${encodeURIComponent(wfId)}`, { method: 'DELETE' })
  const after = await http(`${base}/api/team-flowise/agents`)
  ok('DELETE /agent removes the record again', !(after.json?.agents || []).some((x) => x.id === agentId))
}

console.log('\n  -- boot log scan --')
const pluginLines = bootLog.split('\n').map((l) => l.trim()).filter((l) => /team-flowise/i.test(l))
console.log('    team-flowise lines at boot: ' + pluginLines.length)
for (const l of pluginLines.slice(0, 6)) console.log('      ' + l.slice(0, 190))
// The route notice is deliberate: the role I created declares provider/model but
// no reasoningEffort, and the plugin says so instead of silently clearing the
// parent's effort. Anything ELSE the plugin says at boot is unexpected.
const notTheRouteNotice = pluginLines.filter((l) => !/route: route 已变更（provider\/model 父级未知）但未声明 reasoningEffort/.test(l))
ok('the plugin did speak at boot (so the log is really being read)', pluginLines.length > 0, pluginLines.length + ' lines')
ok('every line it printed is the documented route notice — no error, no warning',
  notTheRouteNotice.length === 0, notTheRouteNotice.slice(0, 3).join(' | ').slice(0, 300))

try { sh('taskkill', ['/F', '/T', '/PID', String(child.pid)]) } catch { /* already gone */ }
await sleep(1500)
const dead = await http(`${base}/api/team-flowise/ping`, { timeout: 3000 })
ok('the temporary host is gone (port closed again)', dead.status === 0, 'status=' + dead.status)

fs.rmSync(tmp, { recursive: true, force: true })

console.log('\n### SUMMARY')
const failed = results.filter((r) => !r.cond)
console.log(`checks=${results.length} failures=${failed.length}`)
for (const f of failed) console.log('  FAILED>> ' + f.label + (f.detail ? '  -> ' + f.detail : ''))
console.log(failed.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exitCode = failed.length === 0 ? 0 : 1
