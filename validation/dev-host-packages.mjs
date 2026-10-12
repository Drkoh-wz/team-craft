/**
 * Populate the dev-only directory the offline suites resolve harness packages
 * from. Run once (and again when the harness version moves):
 *
 *   node validation/dev-host-packages.mjs
 *
 * The plugin imports `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-storage-domain`
 * as PEERS and that is load-bearing, not tidiness: Node resolves a linked plugin's
 * imports from the plugin's own directory first, so a copy there shadows the
 * harness's own and the harness's fallback never gets to run (it only retries on a
 * resolution *failure*). That is precisely how a stale `dsh-tools@0.1.x` took DSH
 * Desktop's bootstrap down. So the package directory must stay free of them -- and
 * so must every directory above it, because a junction install points straight at
 * this checkout and would find a repository-root `node_modules` too.
 *
 * Hence a sibling directory that is on nobody's resolution path, reached only by
 * the hook in `dev-host-resolution.mjs` -- the same `node:module` mechanism the
 * harness uses to supply these packages to a real install.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Pinned to the harness this release is verified against; see the README. */
const HARNESS_VERSION = '0.2.0-rc.2'
const PACKAGES = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-storage-domain']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEV_DIR = path.join(HERE, '..', '.dev-host-packages')

console.log('dev host packages -> ' + DEV_DIR)
console.log('harness version   : ' + HARNESS_VERSION)
fs.mkdirSync(DEV_DIR, { recursive: true })

const args = [
  'install',
  '--prefix', DEV_DIR,
  '--no-package-lock',
  '--no-audit',
  '--no-fund',
  '--loglevel=error',
  ...PACKAGES.map((p) => `${p}@${HARNESS_VERSION}`),
]
console.log('npm ' + args.filter((a) => !a.startsWith('--prefix') && a !== DEV_DIR).join(' '))
execFileSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' })

const missing = PACKAGES.filter((p) => !fs.existsSync(path.join(DEV_DIR, 'node_modules', ...p.split('/'))))
if (missing.length > 0) {
  console.error('\nFAILED: not installed: ' + missing.join(', '))
  process.exitCode = 1
} else {
  const count = fs.readdirSync(path.join(DEV_DIR, 'node_modules', '@deepseek-ai')).length
  console.log('\nok: ' + PACKAGES.length + ' requested, ' + count + ' @deepseek-ai packages present')
  console.log('the offline suites can now import the plugin source. The plugin directory')
  console.log('itself is untouched -- it must carry no harness package at all.')
}
