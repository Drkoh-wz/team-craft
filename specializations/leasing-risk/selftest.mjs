#!/usr/bin/env node
/**
 * 融资租赁客户还款风险评估专用团队 —— 随包自检（selftest.mjs）
 *
 * 契约来源：P13-PLAN.md 第 3.4 节。这份文件随移植包一起分发，**接收方也能跑**：
 * 它不依赖运行中的 dsh —— 绝大部分检查是「离线」的（读包内 JSON / Markdown，
 * 重算 sha256，检查 DAG，逐个交叉校验文件名与角色引用）。只有最后一组会在
 * 端点可达时额外校验「已装载状态」，不可达就跳过并明确标注（不算失败）。
 *
 * 十五组检查（每组都有「怎么让它变红」）：
 *   A 必需文件齐备 / 可读 / 非空
 *   B 五个 JSON 文件能解析，且顶层结构是这份包依赖的形状
 *   C DAG 无环、无悬空 dependsOn、节点 id 与键一致、至少要有一个根节点
 *   D 节点 agent / reviewer 都能解析到 roles.json 里的 id 或 name
 *   E pack.targets.roleIds 与 roles.json 双向一一对应（多一个少一个都红）
 *   F 产物文件名双向逐字一致（pack.caseDirContract.artifacts <-> workflow.json）
 *   G workflow.json 的 prompt 指向 adapters/ 下真实存在的文件
 *   H 每个角色的 prompt / adapter 文件存在，且没有「只在磁盘上、没人引用」的孤儿文件
 *   I prompts/ 与 adapters/ 里没有 "{{"（运行时会把它改写成 "{ {"）
 *   J PROVENANCE.json 的 sha256 与 prompts/ 实际内容一致（逐文件 + 逐字节）
 *   K workflow.json 字节数 < 65536（宿主 readJsonBody 的请求体上限）
 *   L models.map.json：prefer 结构合法、无重复项、reasoningEffort 策略可识别；
 *     角色声明的 modelIntent 都在表里（有意的降级只告警，结构错误才失败）
 *   M pack.json 声明的入口脚本存在（install.mjs / uninstall.mjs / selftest.mjs）、
 *     能力声明与数据不许各说各话（capabilities 里的 haltOnFailure / inheritContext，
 *     以及 contextPolicy.declared 必须与 workflow.json 的实际声明逐字对应）
 *   N SKILL.md 的 YAML frontmatter 合规且 name == pack.targets.skillName
 *     （宿主对不合规 frontmatter 是**静默忽略**，装上去等于没装）
 *   Z 可选：端点可达时校验已装载状态（不可达 -> 跳过并标注，不影响退出码）
 *
 * 退出码：0 = 全部通过（可选的运行时组跳过也算通过）；1 = 至少一项失败；
 *         2 = 连包目录都找不到（用法错误）。
 *
 * 只读：本文件不写任何文件、不发送任何写请求（运行时组只发 GET）。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK_DIR = dirname(fileURLToPath(import.meta.url));

// 与 install.mjs 保持同一常量（P13-PLAN 1.2：readJsonBody(req, maxBytes=65536)）
const MAX_BODY_BYTES = 65536;

const argv = process.argv.slice(2);
const WANT_HELP = argv.includes('--help') || argv.includes('-h');
if (WANT_HELP) {
  process.stdout.write(`随包自检 —— 融资租赁客户还款风险评估专用团队

用法：
  node selftest.mjs [--endpoint <url>] [--no-runtime] [--help]

选项：
  --endpoint <url>  运行中的 DSH 地址（默认 http://127.0.0.1:3080）。
                    不可达时自动跳过「已装载状态」检查并标注，不影响退出码。
  --no-runtime      连探测都不做，完全离线运行
  --help, -h        显示本帮助

退出码：
  0  全部通过（含「端点不可达，运行时组已跳过」）
  1  至少一项失败（检查项逐条列出）
  2  用法错误（找不到包目录 / 参数非法）
`);
  process.exitCode = 0;
  // --help 必须立刻结束：后续正文会打印检查结果并（在有端点时）发请求。
  // 此时还没有任何打开的句柄，直接 exit 是安全的（有 fetch 在飞时才不能强退，
  // 见文件末尾的说明）。
  process.exit(0);
}

let ENDPOINT = 'http://127.0.0.1:3080';
let RUNTIME = true;
let USAGE_ERROR = null;
if (!WANT_HELP) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--no-runtime') RUNTIME = false;
    else if (a === '--endpoint') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { USAGE_ERROR = '--endpoint 需要一个取值'; break; }
      ENDPOINT = v;
      i += 1;
    } else {
      USAGE_ERROR = `未知参数 ${a}（用 --help 看用法）`;
      break;
    }
  }
  if (USAGE_ERROR === null) {
    ENDPOINT = String(ENDPOINT).replace(/\/+$/, '');
    try { new URL(ENDPOINT); } catch { USAGE_ERROR = `--endpoint 不是合法 URL：${ENDPOINT}`; }
  }
}
if (USAGE_ERROR !== null) {
  process.stderr.write(`用法错误：${USAGE_ERROR}\n`);
  process.exitCode = 2;
  process.exit(2); // 同上：此时没有任何打开的句柄
}

// ---------------------------------------------------------------- 检查框架

let checks = 0;
let failures = 0;
let skipped = 0;
const failedLabels = [];
const SKIP = Symbol('skip');

function check(label, fn, detailIfFailed) {
  checks += 1;
  let result;
  try { result = fn(); } catch (e) {
    failures += 1;
    failedLabels.push(label);
    console.log(`  FAIL ${label}  -> 抛出异常：${e && e.message ? e.message : e}`);
    return false;
  }
  if (result === SKIP) {
    checks -= 1;
    skipped += 1;
    console.log(`  skip ${label}${detailIfFailed ? '  -> ' + detailIfFailed : ''}`);
    return true;
  }
  if (result === true) { console.log(`  ok   ${label}`); return true; }
  failures += 1;
  failedLabels.push(label);
  const detail = typeof result === 'string' ? result : (detailIfFailed || '');
  console.log(`  FAIL ${label}${detail ? '  -> ' + detail : ''}`);
  return false;
}

const readText = (p) => {
  const t = readFileSync(p, 'utf8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
};
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const jsonCache = new Map();
function readJson(name) {
  if (jsonCache.has(name)) return jsonCache.get(name);
  const p = join(PACK_DIR, name);
  let v;
  try { v = JSON.parse(readText(p)); } catch (e) { v = { __parseError: String(e && e.message ? e.message : e) }; }
  jsonCache.set(name, v);
  return v;
}

console.log('=== 融资租赁客户还款风险评估专用团队 · 随包自检 ===');
console.log('包目录：' + PACK_DIR);
console.log('端点  ：' + (RUNTIME ? ENDPOINT + '（仅 GET，用于可选的第 Z 组）' : '未使用（--no-runtime）'));
console.log('');

if (!existsSync(join(PACK_DIR, 'pack.json'))) {
  console.log('FATAL：当前目录里没有 pack.json —— selftest.mjs 必须放在移植包根目录下运行。');
  console.log('       实际目录：' + PACK_DIR);
  process.exit(2);
}

// ===========================================================================
console.log('--- A 必需文件 ---');
// ===========================================================================
const REQUIRED_FILES = [
  'pack.json', 'roles.json', 'workflow.json', 'models.map.json', 'PROVENANCE.json',
  'install.mjs', 'uninstall.mjs', 'selftest.mjs', 'SKILL.md', 'README.md',
];
check(`A1 包目录下有 ${REQUIRED_FILES.length} 个必需文件，且每个都非空`, () => {
  const bad = [];
  for (const f of REQUIRED_FILES) {
    const p = join(PACK_DIR, f);
    if (!existsSync(p)) { bad.push(f + ':缺失'); continue; }
    try { if (statSync(p).size === 0) bad.push(f + ':空文件'); } catch (e) { bad.push(f + ':' + (e && e.message)); }
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('A2 prompts/ 与 adapters/ 两个目录都存在，且 prompts/ 至少 1 份 .md', () => {
  const bad = [];
  for (const d of ['prompts', 'adapters']) {
    if (!existsSync(join(PACK_DIR, d))) bad.push(d + '/ 缺失');
  }
  const prompts = existsSync(join(PACK_DIR, 'prompts'))
    ? readdirSync(join(PACK_DIR, 'prompts')).filter((n) => /\.md$/i.test(n))
    : [];
  if (prompts.length === 0) bad.push('prompts/ 里没有 .md');
  return bad.length === 0 ? true : bad.join(', ');
});
check('A3 入口脚本是 ESM（含 import/export 语句，纯 .mjs 约定）', () => {
  const bad = [];
  for (const f of ['install.mjs', 'uninstall.mjs', 'selftest.mjs']) {
    const t = readText(join(PACK_DIR, f));
    if (!/^\s*(import|export)\s/m.test(t)) bad.push(f);
  }
  return bad.length === 0 ? true : bad.join(', ') + '（没有 ESM 语句）';
});

// ===========================================================================
console.log('\n--- B JSON 可解析 + 顶层结构 ---');
// ===========================================================================
for (const f of ['pack.json', 'roles.json', 'workflow.json', 'models.map.json', 'PROVENANCE.json']) {
  check(`B1 ${f} 是合法 JSON（解析失败 = 安装器第 1 步就退出码 1）`, () => {
    const v = readJson(f);
    return v && v.__parseError ? v.__parseError : true;
  });
}

const pack = readJson('pack.json');
const rolesDoc = readJson('roles.json');
const wfDoc = readJson('workflow.json');
const modelsMap = readJson('models.map.json');
const provenance = readJson('PROVENANCE.json');

check('B2 pack.json 有 packId / version / targets{workflowId,roleIds,skillName} / caseDirContract.artifacts', () => {
  const bad = [];
  if (typeof pack.packId !== 'string' || pack.packId === '') bad.push('packId');
  if (typeof pack.version !== 'string' || pack.version === '') bad.push('version');
  const t = pack.targets;
  if (!t || typeof t !== 'object') bad.push('targets');
  else {
    if (typeof t.workflowId !== 'string' || t.workflowId === '') bad.push('targets.workflowId');
    if (!Array.isArray(t.roleIds) || t.roleIds.length === 0) bad.push('targets.roleIds');
    if (typeof t.skillName !== 'string' || t.skillName === '') bad.push('targets.skillName');
  }
  const a = pack.caseDirContract && pack.caseDirContract.artifacts;
  if (!Array.isArray(a) || a.length === 0) bad.push('caseDirContract.artifacts');
  return bad.length === 0 ? true : bad.join(', ');
});
check('B3 roles.json 有非空 roles 数组，每个角色 id/name/prompt 都是非空字符串', () => {
  if (!Array.isArray(rolesDoc.roles) || rolesDoc.roles.length === 0) return 'roles 数组缺失或为空';
  const bad = [];
  for (const r of rolesDoc.roles) {
    if (!r || typeof r.id !== 'string' || r.id === '') { bad.push('(缺 id 的角色)'); continue; }
    if (typeof r.name !== 'string' || r.name === '') bad.push(r.id + ':name');
    if (typeof r.prompt !== 'string' || r.prompt === '') bad.push(r.id + ':prompt');
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('B4 workflow.json 有 id / nodes 对象 / prompt 字符串', () => {
  const bad = [];
  if (typeof wfDoc.id !== 'string' || wfDoc.id === '') bad.push('id');
  if (!wfDoc.nodes || typeof wfDoc.nodes !== 'object' || Object.keys(wfDoc.nodes).length === 0) bad.push('nodes');
  if (typeof wfDoc.prompt !== 'string' || wfDoc.prompt === '') bad.push('prompt');
  return bad.length === 0 ? true : bad.join(', ');
});
check('B5 workflow.json 声明了 haltOnFailure: true（引擎级硬停；缺了只剩产物级阻断）',
  () => (wfDoc.haltOnFailure === true ? true : `haltOnFailure=${JSON.stringify(wfDoc.haltOnFailure)}`));
check('B6 workflow.json 的 review.maxRework 是 0..2 的整数（宿主 schema 上限为 2）', () => {
  const mr = wfDoc.review && wfDoc.review.maxRework;
  if (!Number.isInteger(mr) || mr < 0 || mr > 2) return `review.maxRework=${JSON.stringify(mr)}`;
  return true;
});
check('B8 workflow.json 在 workflow 层钉住 inheritContext: "none"（改成 session/true 即红——这条流水线的产物总线是 case_dir 文件系统，继承会话上下文只会变慢并污染案情）',
  () => (wfDoc.inheritContext === 'none' ? true : `inheritContext=${JSON.stringify(wfDoc.inheritContext)}`));
check('B9 工作流里没有任何节点/角色单点开继承（workflow 层的 none 是这条流水线唯一的继承策略来源）', () => {
  const bad = [];
  for (const [key, n] of Object.entries(wfDoc.nodes || {})) {
    if (n && (n.inheritContext === 'session' || n.inheritContext === true)) bad.push(`节点 ${key}`);
  }
  for (const r of (rolesDoc.roles || [])) {
    if (r && (r.inheritContext === 'session' || r.inheritContext === true)) bad.push(`角色 ${r.id}`);
  }
  return bad.length === 0 ? true : bad.join('、');
});
check('B7 workflow.json 的 id 与 pack.targets.workflowId 一致（否则安装器写出的 id 会与声明不符）',
  () => (wfDoc.id === pack.targets.workflowId ? true : `workflow.json.id=${JSON.stringify(wfDoc.id)} pack=${JSON.stringify(pack.targets.workflowId)}`));

// ===========================================================================
console.log('\n--- C DAG 结构 ---');
// ===========================================================================
const nodeIds = Object.keys(wfDoc.nodes || {});
check('C1 每个节点的 id 字段与它在 nodes 里的键一致（不一致 = 调度器与界面看到两个 id）', () => {
  const bad = [];
  for (const k of nodeIds) if (wfDoc.nodes[k].id !== k) bad.push(`${k}->${String(wfDoc.nodes[k].id)}`);
  return bad.length === 0 ? true : bad.join(', ');
});
check('C2 每个节点都有 dependsOn 数组', () => {
  const bad = [];
  for (const k of nodeIds) if (!Array.isArray(wfDoc.nodes[k].dependsOn)) bad.push(k);
  return bad.length === 0 ? true : bad.join(', ');
});
check('C3 无悬空 dependsOn（每个依赖都指向一个真实节点）—— 删掉安装器的悬空检查不会让本项变绿', () => {
  const bad = [];
  for (const k of nodeIds) {
    for (const d of (wfDoc.nodes[k].dependsOn || [])) {
      if (!Object.prototype.hasOwnProperty.call(wfDoc.nodes, d)) bad.push(`${k}->${d}`);
      else if (d === k) bad.push(`${k}->自身`);
    }
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('C4 无环（Kahn 拓扑排序能覆盖全部节点）—— 造一个 A<->B 的环即红', () => {
  const indeg = new Map(nodeIds.map((id) => [id, 0]));
  for (const id of nodeIds) for (const d of (wfDoc.nodes[id].dependsOn || [])) if (indeg.has(id)) indeg.set(id, indeg.get(id) + 1);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    seen += 1;
    for (const other of nodeIds) {
      if (!(wfDoc.nodes[other].dependsOn || []).includes(id)) continue;
      indeg.set(other, indeg.get(other) - 1);
      if (indeg.get(other) === 0) queue.push(other);
    }
  }
  return seen === nodeIds.length ? true : `只剩 ${nodeIds.filter((id) => indeg.get(id) > 0).join(', ')} 无法拓扑排序`;
});
check('C5 至少有一个根节点（dependsOn 引用集合里没有它）—— 全环时会红', () => {
  const referenced = new Set();
  for (const k of nodeIds) for (const d of (wfDoc.nodes[k].dependsOn || [])) referenced.add(d);
  const roots = nodeIds.filter((id) => !referenced.has(id));
  return roots.length > 0 ? true : '没有根节点';
});
check('C6 每个节点都有 agent 与 taskTemplate.requirement（没有派发者的节点是死节点）', () => {
  const bad = [];
  for (const k of nodeIds) {
    const n = wfDoc.nodes[k];
    if (typeof n.agent !== 'string' || n.agent === '') bad.push(k + ':agent');
    if (!n.taskTemplate || typeof n.taskTemplate.requirement !== 'string' || n.taskTemplate.requirement === '') bad.push(k + ':requirement');
  }
  return bad.length === 0 ? true : bad.join(', ');
});
// C7 (from the P13 adversarial review, item N10): the DAG declares ORDER, but
// nothing checked that a node's INPUTS are actually produced by something it
// depends on. `finance` reading 02-web.json while `collect` was merely a
// same-round sibling is the exact case: it happened to be safe only because the
// scheduler runs a round as a barrier, so the read edge was never part of the
// declared graph. This makes "read after write" a declared property instead of a
// lucky one -- removing `collect` from finance's dependsOn turns C7 red.
check('C7 每个节点读到的产物文件，都由它自己或它的某个祖先节点写出（读边必须体现在 dependsOn 里）—— 把 collect 从 finance 的 dependsOn 里删掉即红', () => {
  const producer = new Map();
  for (const a of ((pack.caseDirContract && pack.caseDirContract.artifacts) || [])) {
    if (a && typeof a.file === 'string' && typeof a.node === 'string') producer.set(a.file, a.node);
  }
  const ancestors = (id) => {
    const seen = new Set();
    const stack = [...((wfDoc.nodes[id] || {}).dependsOn || [])];
    while (stack.length > 0) {
      const d = stack.pop();
      if (seen.has(d) || wfDoc.nodes[d] === undefined) continue;
      seen.add(d);
      for (const x of (wfDoc.nodes[d].dependsOn || [])) stack.push(x);
    }
    return seen;
  };
  const bad = [];
  for (const k of nodeIds) {
    const n = wfDoc.nodes[k] || {};
    const text = [n.taskTemplate && n.taskTemplate.requirement, n.taskTemplate && n.taskTemplate.acceptanceCriteria, n.promptAddon]
      .filter((x) => typeof x === 'string').join('\n');
    const anc = ancestors(k);
    for (const f of new Set(text.match(/\d\d-[a-z-]+\.(?:json|md)/g) || [])) {
      const prod = producer.get(f);
      if (prod === undefined) { bad.push(`${k} 读了没有任何节点写出的 ${f}`); continue; }
      if (prod === k) continue;
      if (!anc.has(prod)) bad.push(`${k} 读了 ${f}，但写出者 ${prod} 不在它的 dependsOn 祖先里`);
    }
  }
  return bad.length === 0 ? true : bad.join('; ');
});

// ===========================================================================
console.log('\n--- D 角色引用可解析 ---');
// ===========================================================================
const roleById = new Map();
const roleByName = new Map();
for (const r of (rolesDoc.roles || [])) {
  if (r && typeof r.id === 'string') roleById.set(r.id, r);
  if (r && typeof r.name === 'string' && r.name !== '' && !roleByName.has(r.name)) roleByName.set(r.name, r);
}
const resolveRole = (ref) => (typeof ref === 'string' && ref !== '' ? (roleById.get(ref) || roleByName.get(ref) || null) : null);

check('D1 每个节点的 agent 都能解析到 roles.json 里的 id 或 name（改一个 agent 为 NoSuchRole 即红）', () => {
  const bad = [];
  for (const k of nodeIds) if (!resolveRole(wfDoc.nodes[k].agent)) bad.push(`${k}:${String(wfDoc.nodes[k].agent)}`);
  return bad.length === 0 ? true : bad.join(', ');
});
check('D2 每个非空 reviewer 都能解析到 roles.json 里的角色（空串/null 表示不评审，合法）', () => {
  const bad = [];
  for (const k of nodeIds) {
    const rv = wfDoc.nodes[k].reviewer;
    if (rv === undefined || rv === null || rv === '') continue;
    if (!resolveRole(rv)) bad.push(`${k}:${String(rv)}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('D3 每条工作流里用到的角色都真的被某个节点派发（不允许出现"只挂名不干活"的引用）', () => {
  const used = new Set();
  for (const k of nodeIds) {
    const a = resolveRole(wfDoc.nodes[k].agent);
    if (a) used.add(a.id);
  }
  const unused = [...roleById.keys()].filter((id) => !used.has(id));
  return unused.length === 0 ? true : '以下角色没有被任何节点当 agent 派发：' + unused.join(', ');
});
check('D4 工作流级 review.reviewer（若声明）也能解析到角色', () => {
  const rv = wfDoc.review && wfDoc.review.reviewer;
  if (rv === undefined || rv === null || rv === '') return true;
  return resolveRole(rv) ? true : `review.reviewer=${String(rv)} 解析不到`;
});

// ===========================================================================
console.log('\n--- E 角色清单双向一致 ---');
// ===========================================================================
const targetIds = (pack.targets && Array.isArray(pack.targets.roleIds)) ? pack.targets.roleIds.slice() : [];
check('E1 角色 id 唯一（重复 id = 安装器会建出两份同名角色）', () => {
  const dup = targetIds.filter((x, i) => targetIds.indexOf(x) !== i);
  const dupRoles = (rolesDoc.roles || []).map((r) => r && r.id).filter((x, i, a) => a.indexOf(x) !== i);
  const all = [...new Set(dup.concat(dupRoles))];
  return all.length === 0 ? true : all.join(', ');
});
check('E2 pack.targets.roleIds 里的每个 id 都在 roles.json 里', () => {
  const miss = targetIds.filter((id) => !roleById.has(id));
  return miss.length === 0 ? true : miss.join(', ');
});
check('E3 roles.json 里的每个角色都在 pack.targets.roleIds 里（多出一份未被管理的角色即红）', () => {
  const extra = [...roleById.keys()].filter((id) => !targetIds.includes(id));
  return extra.length === 0 ? true : extra.join(', ');
});
check('E4 两边的角色数量相同且非空', () => {
  const n1 = targetIds.length;
  const n2 = (rolesDoc.roles || []).length;
  if (n1 === 0 || n2 === 0) return '一侧为空';
  return n1 === n2 ? true : `pack=${n1} roles.json=${n2}`;
});
check('E5 roles.json 的 roles 顺序与 pack.targets.roleIds 顺序一致（安装顺序可预期）',
  () => (eq((rolesDoc.roles || []).map((r) => r.id), targetIds) ? true : `roles.json: ${(rolesDoc.roles || []).map((r) => r.id).join(',')}`));

// ===========================================================================
console.log('\n--- F 产物文件名双向一致（case_dir 契约） ---');
// ===========================================================================
const artifacts = (pack.caseDirContract && Array.isArray(pack.caseDirContract.artifacts)) ? pack.caseDirContract.artifacts : [];
const artifactFiles = artifacts.map((a) => a && a.file).filter((x) => typeof x === 'string');
const wfText = existsSync(join(PACK_DIR, 'workflow.json')) ? readText(join(PACK_DIR, 'workflow.json')) : '';
/** workflow.json 正文里以 <case_dir>/XX-name.ext 形式出现的产物文件名。 */
const referenced = [...new Set([...wfText.matchAll(/<case_dir>[\\/]([0-9]{2}-[A-Za-z0-9._-]+\.(?:json|md))/g)].map((m) => m[1]))];

check(`F1 caseDirContract.artifacts 非空且文件名唯一（当前 ${artifactFiles.length} 个）`, () => {
  if (artifactFiles.length === 0) return '清单为空';
  const dup = artifactFiles.filter((x, i) => artifactFiles.indexOf(x) !== i);
  return dup.length === 0 ? true : '重复：' + dup.join(', ');
});
check('F2 清单里每个产物文件名都在 workflow.json 正文里出现过（正向）—— 从清单删一个文件名不会变绿，但把 workflow 里的引用删掉会让 F3 变红', () => {
  const miss = artifactFiles.filter((f) => !wfText.includes(f));
  return miss.length === 0 ? true : miss.join(', ');
});
check('F3 workflow.json 引用的每个 <case_dir>/XX-*.json|md 都在清单里（反向；写了一个清单外的产物名即红）', () => {
  const extra = referenced.filter((f) => !artifactFiles.includes(f));
  return extra.length === 0 ? true : '清单外引用：' + extra.join(', ');
});
check('F4 双向集合逐字一致（清单 = 正文引用集合）', () => {
  const a = [...artifactFiles].sort();
  const b = [...referenced].sort();
  return eq(a, b) ? true : `清单=${a.join(',')} | 引用=${b.join(',')}`;
});
check('F5 清单里每个 artifact 都点名了一个真实节点（file -> node），且节点里唯一', () => {
  const bad = [];
  for (const a of artifacts) {
    if (!a || typeof a.file !== 'string' || typeof a.node !== 'string' || a.node === '') { bad.push(JSON.stringify(a)); continue; }
    if (!Object.prototype.hasOwnProperty.call(wfDoc.nodes || {}, a.node)) bad.push(`${a.file}->${a.node}(不存在)`);
  }
  const nodes = artifacts.map((a) => a && a.node);
  const dup = nodes.filter((x, i) => nodes.indexOf(x) !== i);
  return (bad.length === 0 && dup.length === 0) ? true : bad.concat(dup.map((d) => d + '(重复)')).join(', ');
});
check('F6 每个节点的 promptAddon 都点名了它自己的那一个产物文件名（节点不知道自己该写什么 = 契约断链）', () => {
  const bad = [];
  for (const a of artifacts) {
    if (!a || typeof a.node !== 'string') continue;
    const n = (wfDoc.nodes || {})[a.node];
    if (!n) continue;
    if (typeof n.promptAddon !== 'string' || !n.promptAddon.includes(a.file)) bad.push(`${a.node} 缺 ${a.file}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('F7 只有一个节点写同一个产物文件（两个节点写同一个文件 = 产物互相覆盖）', () => {
  const seen = new Map();
  for (const a of artifacts) {
    if (!a || typeof a.file !== 'string') continue;
    seen.set(a.file, (seen.get(a.file) || 0) + 1);
  }
  const dup = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  return dup.length === 0 ? true : dup.join(', ');
});

// ===========================================================================
console.log('\n--- G 工作流契约文件 ---');
// ===========================================================================
check('G1 workflow.json 的 prompt 指向 adapters/ 下真实存在的文件（工作流级人设层的来源）', () => {
  const ref = wfDoc.prompt;
  if (typeof ref !== 'string' || ref === '') return 'prompt 不是非空字符串';
  const p = resolve(PACK_DIR, ref);
  if (!existsSync(p)) return `${ref} 不存在`;
  return statSync(p).isFile() ? true : `${ref} 不是文件`;
});
check('G2 该契约文件不含 "{{"（工作流级 prompt 也会走同一套插值改写）', () => {
  const ref = wfDoc.prompt;
  if (typeof ref !== 'string' || !existsSync(resolve(PACK_DIR, ref))) return true;
  const t = readText(resolve(PACK_DIR, ref));
  const at = t.indexOf('{{');
  return at === -1 ? true : `第 ${t.slice(0, at).split('\n').length} 行`;
});

// ===========================================================================
console.log('\n--- H 人设 / 适配文件 ---');
// ===========================================================================
check('H1 每个角色的 prompt 文件存在且非空', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    const p = resolve(PACK_DIR, r.prompt);
    if (!existsSync(p)) { bad.push(`${id}:${r.prompt}(缺失)`); continue; }
    if (statSync(p).size === 0) bad.push(`${id}:${r.prompt}(空)`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('H2 每个声明了 adapter 的角色的适配文件存在且非空', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    if (r.adapter === null || r.adapter === undefined) continue;
    if (typeof r.adapter !== 'string' || r.adapter === '') { bad.push(`${id}:adapter=${JSON.stringify(r.adapter)}`); continue; }
    const p = resolve(PACK_DIR, r.adapter);
    if (!existsSync(p)) { bad.push(`${id}:${r.adapter}(缺失)`); continue; }
    if (statSync(p).size === 0) bad.push(`${id}:${r.adapter}(空)`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('H3 prompts/ 与 adapters/ 里没有"没人引用"的孤儿 .md（分发出去的包不留死文件）', () => {
  const referencedFiles = new Set();
  for (const r of roleById.values()) {
    if (typeof r.prompt === 'string') referencedFiles.add(relative(PACK_DIR, resolve(PACK_DIR, r.prompt)).replace(/\\/g, '/'));
    if (typeof r.adapter === 'string') referencedFiles.add(relative(PACK_DIR, resolve(PACK_DIR, r.adapter)).replace(/\\/g, '/'));
  }
  if (typeof wfDoc.prompt === 'string') referencedFiles.add(relative(PACK_DIR, resolve(PACK_DIR, wfDoc.prompt)).replace(/\\/g, '/'));
  const orphans = [];
  for (const dir of ['prompts', 'adapters']) {
    const abs = join(PACK_DIR, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!/\.md$/i.test(name)) continue;
      const rel = `${dir}/${name}`;
      if (!referencedFiles.has(rel)) orphans.push(rel);
    }
  }
  return orphans.length === 0 ? true : orphans.join(', ');
});
check('H4 prompts/ 里的 .md 数量与角色数一致（一份人设对一个角色）', () => {
  const abs = join(PACK_DIR, 'prompts');
  if (!existsSync(abs)) return 'prompts/ 不存在';
  const n = readdirSync(abs).filter((x) => /\.md$/i.test(x)).length;
  return n === roleById.size ? true : `prompts/=${n} roles=${roleById.size}`;
});
check('H5 角色 systemPrompt 的组装输入非空（人设正文 + 适配正文两段都真的会进提示词）', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    const p = resolve(PACK_DIR, r.prompt);
    if (!existsSync(p)) continue;
    if (readText(p).trim() === '') bad.push(id);
  }
  return bad.length === 0 ? true : '以下人设正文为空白：' + bad.join(', ');
});
check('H6 每个人设正文都含中文（本包的 prompts 是中文原文；出现纯英文文件提示可能放错了文件）', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    const p = resolve(PACK_DIR, r.prompt);
    if (!existsSync(p)) continue;
    if (!/[\u4e00-\u9fff]/.test(readText(p))) bad.push(id);
  }
  return bad.length === 0 ? true : bad.join(', ');
});

// ===========================================================================
console.log('\n--- I {{ 插值陷阱 ---');
// ===========================================================================
const braceTargets = [];
for (const dir of ['prompts', 'adapters']) {
  const abs = join(PACK_DIR, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) if (/\.md$/i.test(name)) braceTargets.push({ label: `${dir}/${name}`, path: join(abs, name) });
}
check(`I1 prompts/ 与 adapters/ 共 ${braceTargets.length} 个 .md 里都没有 "{{"（运行时会把 {{ 改写成 { { 并在 persona.warning 里记录）`, () => {
  const hits = [];
  for (const t of braceTargets) {
    const text = readText(t.path);
    const at = text.indexOf('{{');
    if (at >= 0) hits.push(`${t.label}:${text.slice(0, at).split('\n').length} 行`);
  }
  return hits.length === 0 ? true : hits.join(', ');
});
check('I2 单字符 "{" 与 "}" 允许出现（只拦 "{{"；顺手确认本项不是空转：包里确实有花括号文本）', () => {
  const withBrace = braceTargets.filter((t) => /[{}]/.test(readText(t.path))).length;
  return withBrace > 0 ? true : '没有任何 .md 含花括号 —— 本项可能空转，请复核提示词模板语法';
});
check('I3 workflow.json 正文里也没有 "{{"（workflow.prompt 之外的节点文本同样是插值路径）', () => {
  const at = wfText.indexOf('{{');
  return at === -1 ? true : `第 ${wfText.slice(0, at).split('\n').length} 行`;
});

// ===========================================================================
console.log('\n--- J PROVENANCE（prompts 的 sha256） ---');
// ===========================================================================
const provFiles = (provenance && provenance.files && typeof provenance.files === 'object') ? provenance.files : null;
check('J1 PROVENANCE.json 有 files 对象（缺失则整组 J 无意义）', () => (provFiles === null ? '缺少 files' : true));
check('J2 PROVENANCE.json 记录的每个文件都在 prompts/ 下真实存在', () => {
  if (provFiles === null) return '缺少 files';
  const miss = Object.keys(provFiles).filter((k) => !existsSync(join(PACK_DIR, 'prompts', k)));
  return miss.length === 0 ? true : miss.join(', ');
});
check('J3 PROVENANCE.json 覆盖 prompts/ 下每一个 .md（漏记 = 有人改了文件而清单看不出来）—— 往 prompts/ 添一个新文件即红', () => {
  if (provFiles === null) return '缺少 files';
  const abs = join(PACK_DIR, 'prompts');
  if (!existsSync(abs)) return 'prompts/ 不存在';
  const onDisk = readdirSync(abs).filter((x) => /\.md$/i.test(x)).sort();
  const miss = onDisk.filter((x) => !Object.prototype.hasOwnProperty.call(provFiles, x));
  return miss.length === 0 ? true : '未记录：' + miss.join(', ');
});
check('J4 每份人设的 sha256 与磁盘内容逐字节一致 —— 篡改任意一个字节即红（这是本组的主检查）', () => {
  if (provFiles === null) return '缺少 files';
  const bad = [];
  for (const [name, entry] of Object.entries(provFiles)) {
    const p = join(PACK_DIR, 'prompts', name);
    if (!existsSync(p)) { bad.push(`${name}(缺失)`); continue; }
    if (!entry || typeof entry.sha256 !== 'string' || entry.sha256 === '') { bad.push(`${name}(清单里没有 sha256)`); continue; }
    const actual = sha256(readText(p));
    if (actual !== entry.sha256) bad.push(`${name}: 清单=${entry.sha256.slice(0, 12)}… 实际=${actual.slice(0, 12)}…`);
  }
  return bad.length === 0 ? true : bad.join(' ; ');
});
check('J5 清单里的 bytes 与磁盘文件大小一致（字符数与字节数在中文文本上不同，所以两个都要记）', () => {
  if (provFiles === null) return '缺少 files';
  const bad = [];
  for (const [name, entry] of Object.entries(provFiles)) {
    const p = join(PACK_DIR, 'prompts', name);
    if (!existsSync(p) || !entry || typeof entry.bytes !== 'number') continue;
    const actual = statSync(p).size;
    if (actual !== entry.bytes) bad.push(`${name}: 清单=${entry.bytes} 实际=${actual}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('J6 清单里的 chars 与磁盘内容的字符数一致', () => {
  if (provFiles === null) return '缺少 files';
  const bad = [];
  for (const [name, entry] of Object.entries(provFiles)) {
    const p = join(PACK_DIR, 'prompts', name);
    if (!existsSync(p) || !entry || typeof entry.chars !== 'number') continue;
    const actual = readText(p).length;
    if (actual !== entry.chars) bad.push(`${name}: 清单=${entry.chars} 实际=${actual}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('J7 每个角色的 prompt 路径都出现在 PROVENANCE 清单里（角色引用了没被记录的人设 = 漂移无据可查）', () => {
  if (provFiles === null) return '缺少 files';
  const bad = [];
  for (const [id, r] of roleById) {
    if (typeof r.prompt !== 'string') continue;
    const key = r.prompt.replace(/^prompts[\\/]/, '');
    if (!Object.prototype.hasOwnProperty.call(provFiles, key)) bad.push(`${id}:${r.prompt}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});

// ===========================================================================
console.log('\n--- K 请求体上限 ---');
// ===========================================================================
const wfPath = join(PACK_DIR, 'workflow.json');
const wfBytes = existsSync(wfPath) ? statSync(wfPath).size : -1;
check(`K1 workflow.json = ${wfBytes} 字节，必须 > 0 且 < ${MAX_BODY_BYTES}（宿主 readJsonBody 的请求体上限；超限直接 {ok:false,error:'bad body'}）`,
  () => ((wfBytes > 0 && wfBytes < MAX_BODY_BYTES) ? true : `${wfBytes} 字节`));
check('K2 组装出的工作流请求体（workflow.json + 契约 prompt）也小于上限', () => {
  let promptLen = 0;
  if (typeof wfDoc.prompt === 'string' && existsSync(resolve(PACK_DIR, wfDoc.prompt))) promptLen = readText(resolve(PACK_DIR, wfDoc.prompt)).length;
  const body = { id: wfDoc.id, name: wfDoc.name, description: wfDoc.description, nodes: wfDoc.nodes, haltOnFailure: wfDoc.haltOnFailure === true, inheritContext: wfDoc.inheritContext, prompt: 'x'.repeat(promptLen) };
  const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  return bytes < MAX_BODY_BYTES ? true : `约 ${bytes} 字节（prompt ${promptLen} 字符）`;
});
check('K3 每个角色的 systemPrompt 组装结果也小于上限（人设 + 适配两段之和）', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    let n = 0;
    if (typeof r.prompt === 'string' && existsSync(resolve(PACK_DIR, r.prompt))) n += readText(resolve(PACK_DIR, r.prompt)).length;
    if (typeof r.adapter === 'string' && existsSync(resolve(PACK_DIR, r.adapter))) n += readText(resolve(PACK_DIR, r.adapter)).length + 2;
    const bytes = Buffer.byteLength(JSON.stringify({ id, systemPrompt: 'x'.repeat(n) }), 'utf8');
    if (bytes >= MAX_BODY_BYTES) bad.push(`${id}(${bytes})`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});

// ===========================================================================
console.log('\n--- L 模型意图表 ---');
// ===========================================================================
const intents = (modelsMap && modelsMap.intents && typeof modelsMap.intents === 'object') ? modelsMap.intents : null;
check('L1 models.map.json 有 intents 对象且非空', () => (intents === null ? '缺少 intents' : (Object.keys(intents).length > 0 ? true : 'intents 为空')));
check('L2 每个意图都有非空 prefer 数组，每项都是 {provider,model} 两个非空字符串（结构非法 = 安装器第 1 步退出码 1）', () => {
  if (intents === null) return '缺少 intents';
  const bad = [];
  for (const [name, def] of Object.entries(intents)) {
    if (!def || !Array.isArray(def.prefer) || def.prefer.length === 0) { bad.push(`${name}:prefer`); continue; }
    def.prefer.forEach((p, i) => {
      if (!p || typeof p.provider !== 'string' || p.provider === '' || typeof p.model !== 'string' || p.model === '') bad.push(`${name}[${i}]`);
    });
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('L3 每个意图内部没有重复的 (provider,model) 项（重复 = prefer 顺序里有死项）', () => {
  if (intents === null) return '缺少 intents';
  const bad = [];
  for (const [name, def] of Object.entries(intents)) {
    const keys = (def && Array.isArray(def.prefer) ? def.prefer : []).map((p) => `${p && p.provider}/${p && p.model}`);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dup.length > 0) bad.push(`${name}:${[...new Set(dup)].join(',')}`);
  }
  return bad.length === 0 ? true : bad.join(' ; ');
});
check('L4 每个意图带 label（安装器打印解析结果时要显示给人看）', () => {
  if (intents === null) return '缺少 intents';
  const bad = Object.entries(intents).filter(([, d]) => !d || typeof d.label !== 'string' || d.label === '').map(([n]) => n);
  return bad.length === 0 ? true : bad.join(', ');
});
check('L5 每个角色声明的 modelIntent 都在 intents 里 —— 声明了一个表里没有的意图即红', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    if (r.modelIntent === null || r.modelIntent === undefined || r.modelIntent === '') continue;
    if (!intents || !Object.prototype.hasOwnProperty.call(intents, r.modelIntent)) bad.push(`${id}:${r.modelIntent}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('L6 每个意图都至少被一个角色使用（表里留着一个没人用的意图 = 死配置）', () => {
  if (intents === null) return '缺少 intents';
  const used = new Set();
  for (const r of roleById.values()) if (typeof r.modelIntent === 'string' && r.modelIntent !== '') used.add(r.modelIntent);
  const unused = Object.keys(intents).filter((n) => !used.has(n));
  return unused.length === 0 ? true : '未被任何角色使用：' + unused.join(', ');
});
check('L7 reasoningEffort.policy 是可识别的取值（本包只实现 never-declare；写成别的值则安装器会告警）', () => {
  const pol = modelsMap.reasoningEffort && modelsMap.reasoningEffort.policy;
  if (pol === 'never-declare') return true;
  if (pol === undefined || pol === null) return '缺少 reasoningEffort.policy（安装器会告警）';
  return `policy=${JSON.stringify(pol)}（安装器只实现 never-declare，会告警并一律不写 reasoningEffort）`;
});
check('L8 每个角色都显式声明了 modelIntent（不写 = 静默继承会话模型，与本包"可预期路由"的设计不符）', () => {
  const miss = [...roleById].filter(([, r]) => !Object.prototype.hasOwnProperty.call(r, 'modelIntent')).map(([id]) => id);
  return miss.length === 0 ? true : '缺少该键：' + miss.join(', ');
});
check('L9 角色的 toolsPreset / timeoutMs 若是数字或字符串则在合理范围（超上限时运行时只会收紧，这里只查类型）', () => {
  const bad = [];
  for (const [id, r] of roleById) {
    if (r.toolsPreset !== undefined && r.toolsPreset !== null && typeof r.toolsPreset !== 'string') bad.push(`${id}:toolsPreset`);
    if (r.timeoutMs !== undefined && r.timeoutMs !== null && (!Number.isInteger(r.timeoutMs) || r.timeoutMs <= 0)) bad.push(`${id}:timeoutMs=${JSON.stringify(r.timeoutMs)}`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});

// ===========================================================================
console.log('\n--- M pack.json 入口与能力声明 ---');
// ===========================================================================
check('M1 pack.json.entrypoints 点名的脚本都存在（install / uninstall / selftest）', () => {
  const ep = pack.entrypoints || {};
  const bad = [];
  for (const [k, v] of Object.entries(ep)) {
    const m = String(v).match(/([A-Za-z0-9_.-]+\.mjs)/);
    if (m === null) { bad.push(`${k}:无法从 "${String(v).slice(0, 40)}" 里认出脚本名`); continue; }
    if (!existsSync(join(PACK_DIR, m[1]))) bad.push(`${k}:${m[1]}(缺失)`);
  }
  return bad.length === 0 ? true : bad.join(', ');
});
check('M2 pack.json.requires.capabilities 声明了 haltOnFailure（分发出去的能力声明要能对得上代码）', () => {
  const caps = pack.requires && Array.isArray(pack.requires.capabilities) ? pack.requires.capabilities : [];
  const hit = caps.find((c) => c && c.id === 'haltOnFailure');
  if (!hit) return 'capabilities 里没有 haltOnFailure';
  return (typeof hit.why === 'string' && hit.why.length > 10) ? true : 'haltOnFailure 的 why 太短（要写清缺失时的后果）';
});
check('M3 caseDirContract 声明了 inputKey / inputsSubdir，且 inputKey 与 workflow 里用的一致',
  () => {
    const c = pack.caseDirContract || {};
    if (c.inputKey !== 'case_dir') return `inputKey=${JSON.stringify(c.inputKey)}`;
    if (typeof c.inputsSubdir !== 'string' || c.inputsSubdir === '') return 'inputsSubdir 缺失';
    return wfText.includes(`<case_dir>/${c.inputsSubdir}`) ? true : `workflow.json 里没有出现 <case_dir>/${c.inputsSubdir}`;
  });
check('M4 包内不含 node_modules / dist 之类的分发垃圾（归档时也会过滤，但包里不该有）', () => {
  const junk = ['node_modules', 'dist', '.git'].filter((d) => existsSync(join(PACK_DIR, d)));
  return junk.length === 0 ? true : junk.join(', ');
});
check('M5 包内文本文件里没有盘符绝对路径（分发到别人机器上会失效）', () => {
  const DRIVE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/;
  const hits = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(abs);
      if (st.isDirectory()) { if (name !== 'node_modules') walk(abs, r); continue; }
      if (!/\.(md|json|mjs|js|txt|ya?ml)$/i.test(name)) continue;
      let text = '';
      try { text = readText(abs); } catch { continue; }
      text.split('\n').forEach((line, i) => { if (DRIVE.test(line)) hits.push(`${r}:${i + 1}`); });
    }
  };
  walk(PACK_DIR, '');
  return hits.length === 0 ? true : hits.slice(0, 6).join(', ') + (hits.length > 6 ? ` 等 ${hits.length} 处` : '');
});

check('M6 pack.json.requires.capabilities 声明了 inheritContext，且 why 写清「缺失该字段 = 无害降级」（这是它与 haltOnFailure 的关键区别：那个缺了是真的不会硬停）', () => {
  const caps = pack.requires && Array.isArray(pack.requires.capabilities) ? pack.requires.capabilities : [];
  const hit = caps.find((c) => c && c.id === 'inheritContext');
  if (!hit) return 'capabilities 里没有 inheritContext';
  if (!(typeof hit.why === 'string' && hit.why.length > 10)) return 'inheritContext 的 why 太短';
  if (!hit.why.includes('无害降级')) return 'inheritContext 的 why 没有点明「缺失 = 无害降级」';
  return true;
});
check('M7 pack.json.contextPolicy.declared 与 workflow.json 的实际声明逐字对应（能力声明与数据不许各说各话）', () => {
  const cp = pack.contextPolicy;
  if (!cp || typeof cp !== 'object') return '缺少 contextPolicy';
  const want = `workflow.json 的 inheritContext = ${JSON.stringify(wfDoc.inheritContext)}（workflow 层）`;
  if (cp.declared !== want) return `contextPolicy.declared=${JSON.stringify(cp.declared)}，期望 ${JSON.stringify(want)}`;
  if (typeof cp.observationalEquivalence !== 'string' || cp.observationalEquivalence.length < 20) return 'contextPolicy.observationalEquivalence 缺失或太短（必须写清"不产生 context 记录"这一条）';
  return true;
});
check('M8 contextPolicy 如实写了 run 层仍然优先，以及本包不声明 inheritMaxEvents 的理由（不许把"钉住默认"写成"否决调用方"）', () => {
  const cp = pack.contextPolicy;
  if (!cp || typeof cp !== 'object') return '缺少 contextPolicy';
  const bad = [];
  if (!/run|运行级|运行层/i.test(String(cp.runLevelOutranks)) || !/优先/.test(String(cp.runLevelOutranks))) bad.push('runLevelOutranks 未写清 run 层仍然优先');
  if (!/inheritMaxEvents/.test(String(cp.budget))) bad.push('budget 未说明本包不声明 inheritMaxEvents');
  return bad.length === 0 ? true : bad.join('、');
});

// ===========================================================================
console.log('\n--- N SKILL.md frontmatter ---');
// ===========================================================================
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0].replace(/\r$/, '') !== '---') return { ok: false, reason: '缺少 YAML frontmatter' };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) if (lines[i].replace(/\r$/, '') === '---') { end = i; break; }
  if (end < 0) return { ok: false, reason: '缺少收尾的 ---' };
  const fields = {};
  for (let i = 1; i < end; i += 1) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { ok: true, fields, body: lines.slice(end + 1).join('\n') };
}
const skillText = existsSync(join(PACK_DIR, 'SKILL.md')) ? readText(join(PACK_DIR, 'SKILL.md')) : '';
const fm = skillText === '' ? { ok: false, reason: 'SKILL.md 缺失' } : parseFrontmatter(skillText);
check('N1 SKILL.md 有合法的 YAML frontmatter（不合规时宿主会**静默忽略**这个技能，等于装了个看不见的技能）', () => (fm.ok ? true : fm.reason));
check('N2 frontmatter 的 name 合规（小写字母数字与连字符）且等于 pack.targets.skillName', () => {
  if (!fm.ok) return 'frontmatter 不合法';
  const name = fm.fields.name;
  if (!SKILL_NAME_RE.test(String(name))) return `name=${JSON.stringify(name)} 不合规`;
  const want = pack.targets && pack.targets.skillName;
  return name === want ? true : `SKILL.md=${name} pack.json=${String(want)}`;
});
check('N3 frontmatter 的 description 非空且足够长（模型据此判断何时加载这个技能）', () => {
  if (!fm.ok) return 'frontmatter 不合法';
  const d = fm.fields.description;
  if (typeof d !== 'string' || d.length < 40) return `description 长度=${typeof d === 'string' ? d.length : 'n/a'}`;
  return true;
});
check('N4 正文非空且超过 500 字符（技能是要给人/模型看的操作说明，不是占位）', () => (skillText.length > 500 ? true : `SKILL.md 共 ${skillText.length} 字符`));
check('N5 技能正文点名了工作流 id 与 case_dir（技能里必须能查到"怎么发起一次评估"）', () => {
  if (skillText === '') return 'SKILL.md 缺失';
  const bad = [];
  if (!skillText.includes(String(pack.targets && pack.targets.workflowId))) bad.push('没有工作流 id');
  if (!skillText.includes('case_dir')) bad.push('没有 case_dir');
  return bad.length === 0 ? true : bad.join('、');
});
check('N6 技能正文如实写了能力边界（haltOnFailure 需要新版 team-flowise；解析不到模型时继承会话模型）', () => {
  if (skillText === '') return 'SKILL.md 缺失';
  const bad = [];
  if (!skillText.includes('haltOnFailure')) bad.push('未提 haltOnFailure');
  if (!/继承/.test(skillText)) bad.push('未提"继承会话模型"的降级');
  return bad.length === 0 ? true : bad.join('、');
});
check('N7 技能正文没有把 return_to_intake 写成"自动回退"（本包没有 DAG 回环原语）', () => {
  if (skillText === '') return 'SKILL.md 缺失';
  const bad = [];
  // 「自动回退 / 自动回环 / auto-rollback」只有在被否定地描述时才允许出现：
  // 本包的正确写法是「不会自动回环」「不要把它当成自动回退」。因此这里检查的是
  // 每处命中前 30 个字符里是否带有否定词，而不是简单地禁止这三个词。
  const NEG = /不|没|无|非|绝不|禁止|不要|不能/;
  const AFFIRMATIVE = /自动回退|auto[-\s]?rollback|自动回环|自动退回|自动回滚/gi;
  for (const m of skillText.matchAll(AFFIRMATIVE)) {
    const before = skillText.slice(Math.max(0, m.index - 30), m.index);
    if (!NEG.test(before)) bad.push(`第 ${skillText.slice(0, m.index).split('\n').length} 行把「${m[0]}」写成了肯定句`);
  }
  if (!/再次发起|发起新的一次运行|再发起|由人/.test(skillText)) bad.push('未写清"由人（或调用方）发起新的一次运行"');
  return bad.length === 0 ? true : bad.join('、');
});

check('N8 技能正文如实写了上下文继承策略（钉住 none、为什么不继承、旧版本丢弃该字段属于什么性质的降级）', () => {
  if (skillText === '') return 'SKILL.md 缺失';
  const bad = [];
  if (!skillText.includes('inheritContext')) bad.push('未提 inheritContext');
  if (!/不继承/.test(skillText)) bad.push('未写清"不继承会话上下文"');
  if (!/无害降级|行为不变/.test(skillText)) bad.push('未写清"旧版本丢弃该字段 = 无害降级/行为不变"');
  return bad.length === 0 ? true : bad.join('、');
});

// ===========================================================================
console.log('\n--- Z 可选：运行中的 dsh 已装载状态（只读；不可达则跳过） ---');
// ===========================================================================
async function getJson(path, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT + path, { signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  } finally { clearTimeout(timer); }
}

if (!RUNTIME) {
  check('Z0 已按要求跳过运行时组（--no-runtime）', () => SKIP, '未探测端点');
} else {
  let ping = null;
  try { ping = await getJson('/api/team-flowise/ping', 4000); } catch (e) { ping = { error: String(e && e.message ? e.message : e) }; }
  const reachable = ping !== null && ping.status === 200 && ping.json && ping.json.ok === true;
  if (!reachable) {
    check(`Z0 端点不可达/未装 team-flowise -> 跳过"已装载状态"检查（打不开的 dsh 不算包的问题）`,
      () => SKIP,
      `${ENDPOINT}${ping && ping.error ? '：' + ping.error : ping ? '：HTTP ' + String(ping.status) : ''}；离线部分 ${checks} 项已全部判定`);
  } else {
    console.log(`  （端点可达：${ENDPOINT}；以下检查在真实运行进程上读回，全部是 GET）`);
    let agents = null;
    let workflows = null;
    let models = null;
    try {
      const a = await getJson('/api/team-flowise/agents', 8000);
      agents = a.json && Array.isArray(a.json.agents) ? a.json.agents : null;
    } catch { agents = null; }
    try {
      const w = await getJson('/api/team-flowise/workflows', 8000);
      workflows = w.json && Array.isArray(w.json.workflows) ? w.json.workflows : null;
    } catch { workflows = null; }
    try {
      const m = await getJson('/api/team-flowise/models', 8000);
      models = m.json && Array.isArray(m.json.providers) ? m.json.providers : null;
    } catch { models = null; }

    check('Z1 GET /agents 可达且返回数组', () => (agents === null ? '读不到 agents 列表' : true));
    if (agents !== null) {
      const byId = new Map(agents.filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
      check(`Z2 ${targetIds.length} 个固定角色 id 都已装载（id 不在 = 本包还没装到这台 dsh 上）`, () => {
        const miss = targetIds.filter((id) => !byId.has(id));
        return miss.length === 0 ? true : '未装载：' + miss.join(', ');
      });
      check('Z3 已装载角色的 systemPrompt 与包内 人设(+适配) 正文一致（漂移检测）', () => {
        const bad = [];
        for (const id of targetIds) {
          const r = roleById.get(id);
          const rec = byId.get(id);
          if (!r || !rec) continue;
          const parts = [readText(resolve(PACK_DIR, r.prompt))];
          if (typeof r.adapter === 'string' && existsSync(resolve(PACK_DIR, r.adapter))) parts.push(readText(resolve(PACK_DIR, r.adapter)));
          const want = parts.join('\n\n');
          if ((rec.systemPrompt || '') !== want) bad.push(`${id}(装载 ${(rec.systemPrompt || '').length} 字符 / 包内 ${want.length} 字符)`);
        }
        return bad.length === 0 ? true : bad.join(', ');
      });
      check('Z4 已装载角色没有重名两份（同名不同 id = 安装器/有人重复建过）', () => {
        const byName = new Map();
        const dup = [];
        for (const a of agents) {
          if (!a || typeof a.name !== 'string' || a.name === '') continue;
          if (!targetIds.includes(a.id)) continue;
          if (byName.has(a.name)) dup.push(a.name);
          else byName.set(a.name, a.id);
        }
        return dup.length === 0 ? true : dup.join(', ');
      });
      check('Z5 已装载角色的 model 字段（若有）落在 models.map.json 的 prefer 列表内 —— 出现过表外的 (provider,model) 即红', () => {
        if (intents === null) return '缺少 intents';
        const allowed = new Set();
        for (const def of Object.values(intents)) for (const p of (def && def.prefer) || []) allowed.add(`${p.provider}/${p.model}`);
        const bad = [];
        for (const id of targetIds) {
          const rec = byId.get(id);
          if (!rec || !rec.model || typeof rec.model.provider !== 'string') continue;
          const key = `${rec.model.provider}/${rec.model.model}`;
          if (!allowed.has(key)) bad.push(`${id}:${key}`);
        }
        return bad.length === 0 ? true : bad.join(', ');
      });
    }
    check('Z6 GET /workflows 可达且返回数组', () => (workflows === null ? '读不到 workflows 列表' : true));
    if (workflows !== null) {
      const rec = workflows.find((w) => w && w.id === pack.targets.workflowId) || null;
      check(`Z7 工作流 ${pack.targets.workflowId} 已装载`, () => (rec === null ? '未装载' : true));
      if (rec !== null) {
        check('Z8 装载记录的 haltOnFailure === true（false/缺失 = 该版本丢弃了该字段，只剩产物级阻断）',
          () => (rec.haltOnFailure === true ? true : `haltOnFailure=${JSON.stringify(rec.haltOnFailure)}（能力降级，不是包的错误）`));
        check('Z9 装载记录的节点数与本包 workflow.json 一致，且节点 id 集合相同', () => {
          const n = rec.nodes ? Object.keys(rec.nodes).length : 0;
          if (n !== nodeIds.length) return `装载 ${n} / 包内 ${nodeIds.length}`;
          const a = Object.keys(rec.nodes).sort();
          const b = [...nodeIds].sort();
          return eq(a, b) ? true : '节点 id 不一致';
        });
        check('Z10 装载记录的 review.maxRework 与本包声明一致（存不住时会退回插件默认 2）',
          () => (rec.review && rec.review.maxRework === (wfDoc.review && wfDoc.review.maxRework)) ? true : `装载=${JSON.stringify(rec.review && rec.review.maxRework)} 包内=${JSON.stringify(wfDoc.review && wfDoc.review.maxRework)}`);
        check('Z14 装载记录的 inheritContext 生效值是不继承（字段缺失按默认 none 计——旧版本丢弃它属无害降级，本项不判红）', () => {
          const v = rec.inheritContext;
          if (v === undefined || v === null) return true;
          return (v === 'none' || v === false) ? true : `inheritContext=${JSON.stringify(v)}（生效值是继承，与本包声明不符）`;
        });
      }
      const dupWf = workflows.filter((w) => w && w.id === pack.targets.workflowId);
      check('Z11 工作流 id 在目标上唯一（两条同 id 记录 = upsert 失效）', () => (dupWf.length <= 1 ? true : `出现 ${dupWf.length} 条`));
    }
    check('Z12 GET /models 可达（安装时模型意图解析要用它）', () => (models === null ? '读不到 models 目录' : true));
    if (models !== null && intents !== null) {
      const index = new Map(models.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, new Set((Array.isArray(p.models) ? p.models : []).map((m) => m && m.id))]));
      const lines = [];
      for (const [name, def] of Object.entries(intents)) {
        const hit = ((def && def.prefer) || []).find((p) => index.has(p.provider) && index.get(p.provider).has(p.model));
        lines.push(`${name}->${hit ? hit.provider + '/' + hit.model : '(本部署解析不到)'}`);
      }
      check('Z13 约定：至少给出本部署上的模型意图解析结果（解析不到是如实降级，不判红）', () => true);
      console.log('       解析结果：' + lines.join('  '));
      const unresolvable = lines.filter((l) => l.includes('解析不到'));
      if (unresolvable.length > 0) {
        console.log(`  info 本部署有 ${unresolvable.length}/${lines.length} 个意图解析不到：这些角色的 model 字段不会被写入，改为继承会话模型（P13-PLAN 第 6 节的如实边界）。`);
      }
    }
  }
}

// ===========================================================================
console.log('\n=== SUMMARY ===');
console.log(`checks=${checks}  failures=${failures}  skipped=${skipped}`);
console.log('包目录：' + PACK_DIR);
if (failedLabels.length > 0) {
  console.log('失败的检查：');
  for (const l of failedLabels) console.log('  - ' + l);
}
console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL');
// 用 exitCode 而不是 process.exit()：第 Z 组发过 fetch 请求，直接强退会在
// Windows 上与 libuv 的句柄清理竞争（实测触发 uv 的 async handle 断言崩溃，
// 那会让"退出码"变成崩溃码而不是 0/1）。设置 exitCode 后自然退出即可。
process.exitCode = failures === 0 ? 0 : 1;
