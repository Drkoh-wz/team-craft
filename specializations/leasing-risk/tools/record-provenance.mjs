// 重新生成 PROVENANCE.json：记录 prompts/ 下每个文件的 sha256 与字符数。
//
// 用途是**防误改**（后续有人手滑改了用户原文时 selftest 会红），
// 不是"证明转录无误"——转录的正确性由授权人核对，脚本无法证明。
//
// 用法：node specializations/leasing-risk/tools/record-provenance.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACK = join(HERE, '..')
const PROMPTS = join(PACK, 'prompts')

const files = readdirSync(PROMPTS).filter((f) => f.endsWith('.md')).sort()
const out = {
  note: 'prompts/ 下用户提供的人设原文的 sha256。由 tools/record-provenance.mjs 生成；selftest.mjs 会重算校验（防误改，不用于证明转录正确）。',
  generatedBy: 'tools/record-provenance.mjs',
  source: '用户需求原文「各角色Prompt设计」（2026-09-21 提供）',
  files: {},
}
for (const f of files) {
  const buf = readFileSync(join(PROMPTS, f))
  out.files[f] = { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length, chars: buf.toString('utf8').length }
}
writeFileSync(join(PACK, 'PROVENANCE.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('recorded ' + files.length + ' prompt files')
for (const f of files) console.log('  ' + f + '  ' + out.files[f].sha256.slice(0, 16) + '…  ' + out.files[f].chars + ' chars')
