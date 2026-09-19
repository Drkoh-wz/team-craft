import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const text = readFileSync(join(homedir(), '.dsh', 'storages', 'team_agent_defs.json'), 'utf8')
const parsed = JSON.parse(text)
console.log('top-level keys:', Object.keys(parsed).join(','))
console.log('contains validator-probe:', text.includes('validator-probe'))
console.log('contains val-prefixed id:', /"id"\s*:\s*"val\d+"/.test(text))
const ids = [...text.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1])
console.log('ids (' + String(ids.length) + '):', ids.join(' '))
