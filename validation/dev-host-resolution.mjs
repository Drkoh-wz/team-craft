/**
 * Supply the harness packages to a plain-node test process.
 *
 * The plugin imports `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-storage-domain`
 * as PEERS; a real harness supplies them at import time. A test process has no
 * harness, so the suites would fail with ERR_MODULE_NOT_FOUND the moment the
 * package directory stopped vendoring a copy of them -- which it must not do,
 * because that vendored copy is what broke DSH Desktop.
 *
 * This registers the same kind of `node:module` hook the harness itself uses, and
 * resolves those packages from `.dev-host-packages/` (populated once by
 * `node validation/dev-host-packages.mjs`). The directory sits beside the
 * checkout, NOT above the plugin: a repository-root `node_modules` would be found
 * by a junction install pointing at this checkout, which is the exact install
 * shape the Desktop fix has to keep working.
 *
 * Normal resolution is tried FIRST and the hook only steps in when it genuinely
 * fails -- the same order as the harness's own fallback, so a suite that installs
 * a package on purpose still gets its copy.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEV_DIR = path.join(HERE, '..', '.dev-host-packages')

export const DEV_PACKAGES_DIR = DEV_DIR

if (!fs.existsSync(path.join(DEV_DIR, 'node_modules'))) {
  throw new Error(
    'the offline suites need the harness packages that this plugin imports as peers.\n' +
    '  the package directory must NOT carry a copy (that is the DSH Desktop outage),\n' +
    '  so they live outside it: ' + DEV_DIR + '\n' +
    '  populate it once with:  node validation/dev-host-packages.mjs',
  )
}

const fromDevDir = createRequire(path.join(DEV_DIR, 'anchor.cjs'))

// Suites spawn children (mutation runs, scenario harnesses, real installs), and a
// hook registered in this process does not reach them: a child re-imports the
// plugin source and dies with the same ERR_MODULE_NOT_FOUND this file exists to
// prevent. NODE_OPTIONS is inherited, so put the helper on the child's command
// line too. Absolute file URL, so it works whatever cwd the child picks.
const SELF_URL = pathToFileURL(fileURLToPath(import.meta.url)).href
const alreadyInherited = String(process.env.NODE_OPTIONS ?? '').includes(SELF_URL)
if (!alreadyInherited) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import=${SELF_URL}`.trim()
}

// The plugin's own dependency is included deliberately. A link-style install does
// not install the target's dependencies, so the package directory has to carry
// zod -- but a test process must not depend on that copy surviving, because
// whatever runs the fixtures may prune it and then every suite fails with a
// confusing "Cannot find package 'zod'" from inside the module under test.
const SUPPLIED = (spec) => spec.startsWith('@deepseek-ai/') || spec === 'zod'

/**
 * Remove a tree WITHOUT following links out of it.
 *
 * Measured on Node 24 / Windows, and it cost a checkout twice:
 *
 *     tree/node_modules/@local/team-flowise  ->  junction to the plugin source
 *     rmSync(tree, { recursive: true })      ->  OK, and the TARGET IS NOW EMPTY
 *
 * `rmSync(recursive:true)` follows a junction and deletes what it points at. Every
 * fixture profile in these suites holds exactly such a junction (the installer
 * made it), so cleaning the fixture up at the end of a run deleted the plugin's
 * source -- silently, and after the checks had already passed. Walk the tree and
 * unlink links first; then the directories hold nothing that leads outside.
 */
export function safeRemoveTree(root) {
  const walk = (p) => {
    let entries
    try { entries = readdirSync(p, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const child = path.join(p, e.name)
      let link = false
      try { link = lstatSync(child).isSymbolicLink() } catch { /* raced */ }
      if (link) {
        try { unlinkSync(child) } catch { /* best effort */ }
      } else if (e.isDirectory()) {
        walk(child)
      }
    }
  }
  try { walk(root) } catch { /* best effort */ }
  rmSync(root, { recursive: true, force: true })
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!SUPPLIED(specifier)) return nextResolve(specifier, context)
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      // Both spellings matter: ESM reports ERR_MODULE_NOT_FOUND, a require()
      // reports MODULE_NOT_FOUND. Accepting only the first made the hook throw
      // for every CommonJS caller instead of falling back.
      const retryable = error && (
        error.code === 'ERR_MODULE_NOT_FOUND'
        || error.code === 'MODULE_NOT_FOUND'
        || error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      )
      // Preserve the first failure's message: only it names the importer.
      if (!retryable) throw error
      try {
        return { url: pathToFileURL(fromDevDir.resolve(specifier)).href, shortCircuit: true }
      } catch (devError) {
        error.message += `\n  dev fallback from ${DEV_DIR} also failed: ${devError.message}`
        throw error
      }
    }
  },
})
