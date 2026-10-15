// The Desktop installer's own regression test.
//
// Why this exists: scripts/install-desktop.ps1 downloads the release asset and
// installs from the LOCAL path (pnpm cannot install an https tarball URL reliably --
// ERR_PNPM_MISSING_TARBALL_INTEGRITY). That means pnpm records `file:<path>` as the
// profile's dependency, so the file it downloaded has to STILL BE THERE afterwards.
//
// The first version downloaded to %TMP% and deleted it on the way out, which left the
// profile pointing at nothing: `dsh plugin list` still worked (node_modules was already
// populated) but the next `pnpm install` -- which Desktop's own profile maintenance
// runs -- died with ENOENT. Nothing caught it, because the release gate installs from
// `file:<repo>` and a local bare git, both of which are stable paths.
//
// This suite drives the real script and then runs a real `pnpm install`, because the
// consequence is the thing worth pinning, not the file's presence.
//
// Two harness details that are easy to get wrong and were:
//   * the asset is served over loopback from THIS process, so the suite does not fail
//     when github.com is unreachable -- and the child processes are spawned
//     ASYNCHRONOUSLY, because spawnSync blocks the event loop and the server could
//     then never answer the download (it hung until the timeout, exit=null);
//   * DESKTOP_ROOT lets the suite run against an install somewhere other than the
//     default path.
//
// Usage:
//   node validation/desktop-install.mjs
//   DESKTOP_ROOT="D:\path\to\DSH Desktop" node validation/desktop-install.mjs
//
// Exit code: 0 = all checks passed, 1 = at least one failed.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let checks = 0
let failures = 0
const failedLabels = []
function check(label, ok, detail) {
  checks += 1
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
  failures += 1
  failedLabels.push(label)
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
  return false
}
function skip(label, detail) { console.log('  ...  ' + label + (detail ? '  -> ' + detail : '')) }
function summary() {
  console.log('\n=== SUMMARY ===')
  console.log('checks=' + checks + '  failures=' + failures)
  if (failedLabels.length > 0) { console.log('failed checks:'); for (const l of failedLabels) console.log('  - ' + l) }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
  return failures
}

/** Run a command to completion WITHOUT blocking the event loop (the server needs it). */
function run(cmd, args, opts = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { ...opts, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, opts.timeout || 900000)
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on('error', (e) => { clearTimeout(timer); done({ status: -1, out, err: err + String(e.message) }) })
    child.on('close', (code) => { clearTimeout(timer); done({ status: code, out, err }) })
  })
}

console.log('=== Desktop installer (download -> install -> SURVIVE maintenance) ===')

const DESKTOP = (process.env.DESKTOP_ROOT && process.env.DESKTOP_ROOT.trim() !== '')
  ? resolve(process.env.DESKTOP_ROOT.trim())
  : 'D:\\dsh\\DSH Desktop'
if (!fs.existsSync(DESKTOP)) {
  skip('no DSH Desktop at ' + DESKTOP + '; pass DESKTOP_ROOT to point at one')
  process.exit(summary() === 0 ? 0 : 1)
}
const NODE_ENTRY = join(DESKTOP, 'resources', 'harness-node-entry.mjs')
const BIN = join(DESKTOP, 'resources', 'app.asar', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const EXE = join(DESKTOP, 'DSH Desktop.exe')
const PS1 = join(REPO, 'scripts', 'install-desktop.ps1')

const SCRATCH = join(REPO, '.desktop-install-test')
fs.rmSync(SCRATCH, { recursive: true, force: true })
fs.mkdirSync(SCRATCH, { recursive: true })

const TARBALL = join(REPO, 'dist', 'team-flowise.tgz')
if (!fs.existsSync(TARBALL)) {
  skip('dist/team-flowise.tgz is missing; run scripts/pack-plugin.mjs first')
  process.exit(summary() === 0 ? 0 : 1)
}
const server = createServer((_req, res) => {
  const body = fs.readFileSync(TARBALL)
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(body.length) })
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const SPEC_URL = `http://127.0.0.1:${server.address().port}/team-flowise.tgz`
console.log('local asset server: ' + SPEC_URL + '  (' + fs.statSync(TARBALL).size + ' bytes)')

const dsh = (args, home) => run(EXE, [NODE_ENTRY, BIN, ...args], {
  cwd: REPO, timeout: 900000, env: { ...process.env, DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1' },
})
const ps1 = (args, home) => run('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-DshHome', home, '-Profile', 'web', ...args,
], { cwd: REPO, timeout: 900000 })

try {
  const home = join(SCRATCH, 'home')
  fs.mkdirSync(home, { recursive: true })

  console.log('\n--- A 组：前置 ---')
  const init = await dsh(['plugin', '--profile', 'web', 'list'], home)
  check('A1.1 一次性 DSH_HOME 里的 web profile 已建立（脚本不会替你建 profile）',
    fs.existsSync(join(home, 'profiles', 'web')), 'init exit=' + init.status)

  console.log('\n--- B 组：安装 ---')
  const install = await ps1(['-Action', 'install', '-Spec', SPEC_URL], home)
  const out = install.out + install.err
  check('B1.1 安装退出 0', install.status === 0,
    'exit=' + install.status + ' :: ' + (out.split('\n').find((l) => /failed|error/i.test(l)) || '').trim().slice(0, 120))
  const pkgPath = join(home, 'profiles', 'web', 'node_modules', '@local', 'team-flowise', 'package.json')
  check('B1.2 包真的落到了 profile 里', fs.existsSync(pkgPath),
    fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version : 'missing')
  check('B1.3 没有把 @deepseek-ai/* 打包进来（harness 自己供给，副本会遮蔽它）',
    !fs.existsSync(join(home, 'profiles', 'web', 'node_modules', '@local', 'team-flowise', 'node_modules', '@deepseek-ai')))
  const profilePkg = JSON.parse(fs.readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  check('B1.4 插件登记进了 profile 的 bundles（只装依赖不登记 = 什么都不注册）',
    (profilePkg.dsh?.profile?.bundles || []).includes('@local/team-flowise'),
    JSON.stringify(profilePkg.dsh?.profile?.bundles))

  console.log('\n--- C 组：下载文件必须留下（此前删掉它 = profile 指向空路径） ---')
  const dep = profilePkg.dependencies?.['@local/team-flowise'] || ''
  check('C1.1 profile 记录的是一个 file: 依赖（这是安装形态本身，不是缺陷）', dep.startsWith('file:'), dep)
  const target = dep.startsWith('file:') ? dep.slice(5).replace(/\//g, '\\') : ''
  check('C1.2 它指向的文件现在仍然存在（删掉它 = 下一次 pnpm install 直接 ENOENT）',
    target !== '' && fs.existsSync(target), target)
  check('C1.3 它不在临时目录里（%TMP% 会被清理，路径必须稳定）',
    target !== '' && !/\\TMP\\|\\Temp\\/i.test(target), target)

  console.log('\n--- D 组：后续维护（Desktop 自己会跑 pnpm install） ---')
  const pnpmShim = join(process.env.APPDATA || '', 'dsh-desktop', 'harness', '.desktop-bin', 'pnpm.cmd')
  if (!fs.existsSync(pnpmShim)) {
    skip('D 组：找不到 Desktop 的 pnpm shim', pnpmShim)
  } else {
    const maint = await run(pnpmShim, ['install'], { cwd: join(home, 'profiles', 'web'), timeout: 900000, shell: true })
    const mout = maint.out + maint.err
    check('D1.1 后续 pnpm install 不报 ENOENT（这是那个缺陷的真实后果）',
      !/ENOENT/.test(mout), (mout.match(/ENOENT[^\n]*/) || ['(no ENOENT)'])[0].slice(0, 140))
    check('D1.2 插件在维护之后仍然在（profile 没有被这次 install 破坏）', fs.existsSync(pkgPath))
  }

  console.log('\n--- E 组：重跑 ---')
  const again = await ps1(['-Action', 'install', '-Spec', SPEC_URL], home)
  check('E1.1 再装一次仍然退出 0', again.status === 0, 'exit=' + again.status)
  const profilePkg2 = JSON.parse(fs.readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  check('E1.2 依赖没有变成两条（稳定文件名，不是每次一个新临时名）',
    Object.keys(profilePkg2.dependencies || {}).filter((k) => k === '@local/team-flowise').length === 1,
    JSON.stringify(profilePkg2.dependencies))
  check('E1.3 bundles 里也仍然只有一条',
    (profilePkg2.dsh?.profile?.bundles || []).filter((b) => b === '@local/team-flowise').length === 1,
    JSON.stringify(profilePkg2.dsh?.profile?.bundles))

  console.log('\n--- F 组：--check ---')
  const chk = await ps1(['-Action', 'check'], home)
  check('F1.1 --check 在装好之后退出 0', chk.status === 0, 'exit=' + chk.status)

  console.log('\n--- G 组：运行中的 Desktop 不应阻塞另一个 home 的安装 ---')
  const g = await ps1(['-Action', 'install', '-Spec', SPEC_URL], home)
  const gout = g.out + g.err
  check('G1.1 Desktop 正在运行时，装到**另一个** home 不会被拒绝（只该拒绝它自己拥有的 home）',
    g.status === 0 && /different home/.test(gout), 'exit=' + g.status)
} catch (e) {
  check('套件未捕获异常（后续检查未执行）', false, String(e && e.stack ? e.stack.split('\n')[0] : e))
} finally {
  fs.rmSync(SCRATCH, { recursive: true, force: true })
  server.close()
}

process.exit(summary() === 0 ? 0 : 1)
