/**
 * Mutation harness for validation/p17-delete-retry.mjs.
 *
 * Each mutation breaks exactly ONE of the three behaviours the suite pins, so a
 * green run after a mutation would mean the suite is not really testing it.
 * Written in Node (not PowerShell) on purpose: a Get-Content/Set-Content round
 * trip re-encodes the file and produces SyntaxErrors, which makes every mutation
 * look like it "went red" for the wrong reason.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SRC = 'packages/team-flowise/src/index.js'
const original = fs.readFileSync(SRC, 'utf8')

const MUTATIONS = [
  {
    id: 'M1',
    what: 'the infrastructure classifier becomes unconditional (every failure is retried)',
    from: "const isInfrastructureFailure = (message) => INFRA_FAILURE_RE.test(String(message));",
    to: 'const isInfrastructureFailure = (message) => true;',
    expect: 'B3 (a work failure must NOT be retried)',
  },
  {
    id: 'M2',
    what: 'resume adopts FAILED nodes as well (it reuses the very node it exists to retry)',
    from: "if (!prev || prev.status !== 'completed') continue;",
    to: 'if (!prev) continue;',
    expect: 'C4 (only successful nodes are adopted)',
  },
  {
    id: 'M3',
    what: 'the retry bound is dropped (retry forever)',
    from: 'if (isInfra && attempt < retryCap && haltedBy === null) {',
    to: 'if (isInfra && haltedBy === null) {',
    expect: 'B2 (the retry cap really bounds the attempts)',
  },
  {
    id: 'M4',
    what: 'the workflow write path forgets maxRetries (accepted by the schema, dropped on write)',
    from: 'inheritMaxEvents: wf && wf.inheritMaxEvents, maxRetries: wf && wf.maxRetries, updatedAt: now()',
    to: 'inheritMaxEvents: wf && wf.inheritMaxEvents, updatedAt: now()',
    expect: 'C5 (the workflow-level bound is really stored)',
  },
  {
    id: 'M5',
    what: 'resumePlan no longer refuses a fully-completed run (it would start an empty run)',
    from: "if (nodeIds.length > 0 && pending.length === 0) return { ok: false, error: 'every node of that run already completed; there is nothing to resume' };",
    to: 'if (false) return { ok: false, error: "x" };',
    expect: 'C3.2 (nothing left to resume is refused)',
  },
]

const dir = fs.mkdtempSync(join(tmpdir(), 'tf-p17-mut-'))
let allGood = true

for (const m of MUTATIONS) {
  if (!original.includes(m.from)) {
    console.log(`  ?? ${m.id}: the anchor text is not in the source; mutation NOT applied (the suite cannot be credited for it)`)
    allGood = false
    continue
  }
  const file = join(dir, m.id + '.js')
  fs.writeFileSync(file, original.replace(m.from, m.to))
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, ['validation/p17-delete-retry.mjs'], {
      env: { ...process.env, P17_SRC: file },
      encoding: 'utf8',
    })
  } catch (e) {
    code = e.status === undefined ? -1 : e.status
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const summary = (out.match(/^checks=\d+\s+failures=\d+$/m) || ['(no summary)'])[0]
  const failed = [...out.matchAll(/^  FAILED>> (.+)$/gm)].map((x) => x[1].trim())
  // A mutation must fail the suite AND the named expectation must be among the
  // failures -- "it went red somewhere" is not evidence for the intended check.
  const hitExpected = failed.some((f) => f.startsWith(m.expect.split(' ')[0]))
  const red = code !== 0 && failed.length > 0
  if (!red || !hitExpected) allGood = false
  console.log(`  ${red && hitExpected ? 'ok  ' : 'BAD '} ${m.id} ${m.what}`)
  console.log(`         expected to break: ${m.expect}`)
  console.log(`         exit=${code}  ${summary}  failed=${failed.length}`)
  for (const f of failed.slice(0, 4)) console.log(`           - ${f.slice(0, 110)}`)
}

console.log(`\nmutation dir: ${dir}`)
console.log(allGood ? 'RESULT: every mutation turned its intended check red' : 'RESULT: at least one mutation did NOT prove its check')
process.exit(allGood ? 0 : 1)
