/** Falsifiability check for validation/p17-client-ui.mjs: break one thing at a time. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SRC = 'packages/team-flowise/src/client/index.js'
const original = fs.readFileSync(SRC, 'utf8')

const MUTATIONS = [
  {
    id: 'C-M1',
    what: 'the scroll container is removed from the progress page',
    from: '.tf-pg{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937);padding:2px;box-sizing:border-box;max-height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}',
    to: '.tf-pg{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937);padding:2px}',
    expect: 'C2.1',
  },
  {
    id: 'C-M2',
    what: 'the task delete button ignores the working state (deletes under a live worker)',
    from: 'disabled: working,',
    to: 'disabled: false,',
    expect: 'C1.7',
  },
  {
    id: 'C-M3',
    what: 'the bundle throws at module scope',
    from: '  var API = ',
    to: '  throw new Error("boom at module scope");\n  var API = ',
    expect: 'A1.1',
  },
  {
    id: 'C-M4',
    what: 'the resume button no longer jumps to the new run',
    from: "if (d && d.run && d.run.id) { setRunId(d.run.id); setMode('session'); }",
    to: 'if (false) { setRunId(null); }',
    expect: 'C3.2',
  },
]

const dir = fs.mkdtempSync(join(tmpdir(), 'tf-p17c-mut-'))
let allGood = true
for (const m of MUTATIONS) {
  if (!original.includes(m.from)) {
    console.log(`  ?? ${m.id}: anchor not found; NOT applied`)
    allGood = false
    continue
  }
  const file = join(dir, m.id + '.js')
  // Replace ALL occurrences: `disabled: working` appears in both the board card and
  // the task list, and replacing only the first would leave the second one proving
  // the check while the mutation looks "not caught".
  fs.writeFileSync(file, original.split(m.from).join(m.to))
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, ['validation/p17-client-ui.mjs'], { env: { ...process.env, P17_CLIENT: file }, encoding: 'utf8' })
  } catch (e) {
    code = e.status === undefined ? -1 : e.status
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const summary = (out.match(/^checks=\d+\s+failures=\d+$/m) || ['(none)'])[0]
  const failed = [...out.matchAll(/^  - (.+)$/gm)].map((x) => x[1].trim())
  const hit = failed.some((f) => f.startsWith(m.expect))
  const red = code !== 0 && failed.length > 0
  if (!red || !hit) allGood = false
  console.log(`  ${red && hit ? 'ok  ' : 'BAD '} ${m.id} ${m.what}`)
  console.log(`         expected ${m.expect}; exit=${code} ${summary}`)
  for (const f of failed.slice(0, 3)) console.log(`           - ${f.slice(0, 110)}`)
}
console.log(`\nmutation dir: ${dir}`)
console.log(allGood ? 'RESULT: every client mutation turned its intended check red' : 'RESULT: a mutation did not prove its check')
process.exit(allGood ? 0 : 1)
