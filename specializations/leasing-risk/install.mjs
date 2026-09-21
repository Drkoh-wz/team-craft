#!/usr/bin/env node
/**
 * 融资租赁客户还款风险评估专用团队 —— 移植包安装器
 *
 * 契约来源：P13-PLAN.md 第 3.2 节（参数、六步流程、退出码语义）。
 *
 * 六步流程（每步幂等，重复执行输出「已存在，跳过」）：
 *   1. 前置校验（只读）  2. 探测运行时  3. 解析模型意图
 *   4. 导入角色          5. 导入工作流并读回校验  6. 安装技能
 *
 * 退出码：0 成功 / 1 参数或前置校验失败（含写入失败）/ 2 运行时不可达 / 3 --check 不一致
 *
 * 安全性质（硬要求）：
 *  * 任何写操作之前先打印目标路径；一次写操作失败立即停止，不做后续写入。
 *  * --check 与 --dry-run 绝不落盘（连目录都不创建）。
 *  * 只写 upsertAgent / upsertWorkflow 真正支持的字段（见 P13-PLAN 1.2），
 *    多写的字段会被 zod 静默丢弃，因此本安装器不写 model.reasoningEffort。
 *  * 只用 Node 内置能力（node:http / node:https / node:fs / node:crypto），零依赖。
 *
 * 重启结论（P13-PLAN 3.2 第 7 条）：技能由技能目录在读取时发现，不需要重启；
 * 角色与工作流是经 HTTP 写进运行中进程的注册表，立即生效，也不需要重启。
 */

import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const PACK_DIR = dirname(fileURLToPath(import.meta.url));
const API = '/api/team-flowise';

// P13-PLAN 1.2：readJsonBody(req, maxBytes=65536)
const MAX_BODY_BYTES = 65536;
// P13-PLAN 1.3：worker 30 分钟上限，reviewer 600000ms 上限（timeoutFor 只收紧）
const WORKER_TIMEOUT_CEILING = 30 * 60 * 1000;
const REVIEWER_TIMEOUT_CEILING = 600000;

const EXIT_OK = 0;
const EXIT_FAIL = 1;      // 参数/前置校验失败，以及写入失败
const EXIT_RUNTIME = 2;   // 运行时不可达
const EXIT_CHECK = 3;     // --check 发现缺失/不一致

class Fail extends Error {
  constructor(message, code = EXIT_FAIL) { super(message); this.exitCode = code; }
}

const USAGE = `融资租赁客户还款风险评估专用团队 —— 移植包安装器

用法：
  node install.mjs [选项]

选项：
  --profile <dir>    DSH profile 目录，用于解析技能根目录（customSkillDirs）
                     默认：<DSH_HOME>\\profiles\\web
  --endpoint <url>   运行中的 DSH 地址，默认 http://127.0.0.1:3080
                     （写接口要求 loopback：非 127.0.0.1 一律 403）
  --dry-run          只打印将要做什么，不写任何东西
  --check            只校验目标状态（角色/工作流/技能是否已就位且一致），不写任何东西
  --force            忽略「已存在且一致」，强制重写角色、工作流与技能
  --skip-skill       跳过第 6 步（技能安装/校验）
  --json             进度打到 stderr，最终结果以一个 JSON 对象打到 stdout
  --help, -h         显示本帮助

退出码：
  0  成功（包括「读回校验发现 haltOnFailure 没存住」这类能力降级——那是告警，不是失败）
  1  参数错误 / 前置校验失败 / 写入失败
  2  运行时不可达（未启动 dsh，或 team-flowise 未安装）
  3  --check 发现缺失或不一致

六步：
  1 前置校验（只读）  2 探测运行时  3 解析模型意图  4 导入角色
  5 导入工作流并读回校验  6 安装技能（SKILL.md -> 技能根目录）

需要重启 dsh 吗？
  不需要。技能由技能目录在读取时发现（热加载）；角色与工作流是通过 HTTP
  写进运行中进程的注册表，立即生效。本安装器不要求也不建议重启 dsh。

写入的安全性：
  写入前会打印目标路径。角色与工作流写入运行中进程的注册表，并持久化到
  <DSH_HOME>\\storages\\team_agent_defs.json 与 team_workflows.json；
  技能写入解析出的技能根目录。--check / --dry-run 不写任何东西。
`;

// ---------------------------------------------------------------- 小工具

let JSON_MODE = false;
let MODE = 'install';
let SUMMARY = null;
const emit = (line) => { (JSON_MODE ? process.stderr : process.stdout).write(line + '\n'); };

const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const num = (v) => (v === undefined || v === null ? null : v);

function dshHome() {
  const env = process.env.DSH_HOME;
  return (typeof env === 'string' && env.trim() !== '') ? pathResolve(env) : join(homedir(), '.dsh');
}

function readTextFile(p) {
  if (!existsSync(p)) throw new Fail(`缺少必需文件：${p}`);
  try { return stripBom(readFileSync(p, 'utf8')); }
  catch (e) { throw new Fail(`读取失败：${p}：${e && e.message ? e.message : e}`); }
}

function readJsonFile(p) {
  const text = readTextFile(p);
  try { return JSON.parse(text); }
  catch (e) { throw new Fail(`${p} 不是合法 JSON：${e && e.message ? e.message : e}`); }
}

function walkMarkdown(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isFile() && /\.md$/i.test(name)) out.push(p);
  }
  return out.sort();
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 宿主自己的 frontmatter 规则（dsh-skill parseSkillFile）；不合规的技能会被宿主静默忽略。 */
function parseSkillFrontmatter(text) {
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0].replace(/\r$/, '') !== '---') return { ok: false, reason: '缺少 YAML frontmatter' };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '---') { end = i; break; }
  }
  if (end < 0) return { ok: false, reason: '缺少 YAML frontmatter（没有收尾的 ---）' };
  const fields = {};
  for (let i = 1; i < end; i += 1) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const name = fields.name;
  const description = fields.description;
  if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string' || description.length === 0) {
    return { ok: false, reason: 'frontmatter 需要非空的 name 与 description' };
  }
  if (!SKILL_NAME_RE.test(name)) return { ok: false, reason: `技能名不合规："${name}"` };
  return { ok: true, name, description };
}

function request(method, url, { body = null, timeoutMs = 10000 } = {}) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolvePromise, reject) => {
    const req = mod.request({
      method,
      hostname: u.hostname,
      port: u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : u.port,
      path: u.pathname + u.search,
      headers: payload === null ? {} : { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        resolvePromise({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text, json });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const base = (endpoint) => String(endpoint).replace(/\/+$/, '');
const api = (endpoint, path) => base(endpoint) + API + path;

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const o = {
    profile: null, endpoint: null, dryRun: false, check: false,
    force: false, skipSkill: false, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Fail(`参数 ${name} 需要一个值`);
      return v;
    };
    switch (a) {
      case '--profile': o.profile = value('--profile'); break;
      case '--endpoint': o.endpoint = value('--endpoint'); break;
      case '--dry-run': o.dryRun = true; break;
      case '--check': o.check = true; break;
      case '--force': o.force = true; break;
      case '--skip-skill': o.skipSkill = true; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Fail(`未知参数：${a}（用 --help 看用法）`);
    }
  }
  if (o.check && o.dryRun) throw new Fail('--check 与 --dry-run 不能同时使用（两者都是只读模式）');
  o.profile = pathResolve(o.profile === null ? join(dshHome(), 'profiles', 'web') : o.profile);
  o.endpoint = o.endpoint === null ? 'http://127.0.0.1:3080' : o.endpoint;
  try { new URL(o.endpoint); } catch { throw new Fail(`--endpoint 不是合法 URL：${o.endpoint}`); }
  return o;
}

// ---------------------------------------------------------------- 技能根目录

/**
 * 技能根目录候选，按 P13-PLAN 3.2 第 6 条：优先 profile 里声明的 customSkillDirs，
 * 其次 <DSH_HOME>/skills。customSkillDirs 的取值从 profile 的 preset 配置里读
 * （P12 实测：`- !!js "…fileURLToPath(new URL('skills/', baseUrl))"`
 *   → 相对该 yml 所在目录的 skills/）。只读，不修改任何 profile 文件。
 */
function skillRootCandidates(profileDir) {
  const found = [];
  const push = (p, why) => {
    const abs = pathResolve(p);
    if (!found.some((x) => x.path.toLowerCase() === abs.toLowerCase())) found.push({ path: abs, why });
  };
  const ymls = [
    join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'cordis', 'agent.cordis.yml'),
    join(profileDir, 'cordis.yml'),
    join(profileDir, 'cordis.patch.yml'),
  ];
  for (const y of ymls) {
    if (!existsSync(y)) continue;
    let lines;
    try { lines = readFileSync(y, 'utf8').split(/\r?\n/); } catch { continue; }
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*customSkillDirs\s*:/.test(lines[i])) continue;
      const indent = lines[i].match(/^\s*/)[0].length;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === '') continue;
        const ind = line.match(/^\s*/)[0].length;
        if (ind <= indent || !/^\s*-\s/.test(line)) break;
        const body = line.replace(/^\s*-\s*/, '').trim();
        if (body.includes("new URL('skills/'") || body.includes('new URL("skills/"')) {
          push(join(dirname(y), 'skills'), `customSkillDirs（${relative(profileDir, y) || y}）`);
        } else {
          const m = body.match(/^(?:!!js\s+)?["']?([A-Za-z]:[\\/][^"']+|\/[^"']+)["']?$/);
          if (m) push(m[1].replace(/\\/g, '/'), `customSkillDirs（${relative(profileDir, y) || y}）`);
        }
      }
    }
  }
  push(join(dshHome(), 'skills'), 'DSH_HOME 兜底根目录（P13-PLAN 3.2 第 6 条）');
  return found;
}

// ---------------------------------------------------------------- 第 1 步：前置校验

function precheck() {
  const paths = {
    pack: join(PACK_DIR, 'pack.json'),
    roles: join(PACK_DIR, 'roles.json'),
    workflow: join(PACK_DIR, 'workflow.json'),
    models: join(PACK_DIR, 'models.map.json'),
    provenance: join(PACK_DIR, 'PROVENANCE.json'),
  };
  const pack = readJsonFile(paths.pack);
  const roleDoc = readJsonFile(paths.roles);
  const wfDoc = readJsonFile(paths.workflow);
  const modelsMap = readJsonFile(paths.models);
  const provenance = readJsonFile(paths.provenance);
  const warnings = [];
  const notes = [];

  // ---- pack.targets
  const targets = pack.targets;
  if (!targets || typeof targets !== 'object') throw new Fail('pack.json 缺少 targets');
  const workflowId = targets.workflowId;
  const roleIds = targets.roleIds;
  const skillName = targets.skillName;
  if (typeof workflowId !== 'string' || workflowId === '') throw new Fail('pack.json 的 targets.workflowId 缺失或不是字符串');
  if (!Array.isArray(roleIds) || roleIds.length === 0) throw new Fail('pack.json 的 targets.roleIds 缺失或为空');
  if (new Set(roleIds).size !== roleIds.length) throw new Fail('pack.json 的 targets.roleIds 有重复 id');
  if (typeof skillName !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) throw new Fail(`pack.json 的 targets.skillName 不合规：${String(skillName)}`);

  // ---- roles.json
  if (!Array.isArray(roleDoc.roles) || roleDoc.roles.length === 0) throw new Fail('roles.json 缺少 roles 数组');
  const roleById = new Map();
  const roleByName = new Map();
  for (const r of roleDoc.roles) {
    if (!r || typeof r.id !== 'string' || r.id === '') throw new Fail('roles.json 有角色缺少 id');
    if (roleById.has(r.id)) throw new Fail(`roles.json 有重复角色 id：${r.id}`);
    if (typeof r.prompt !== 'string' || r.prompt === '') throw new Fail(`角色 ${r.id} 缺少 prompt 路径`);
    roleById.set(r.id, r);
    if (typeof r.name === 'string' && r.name !== '' && !roleByName.has(r.name)) roleByName.set(r.name, r);
  }
  for (const id of roleIds) if (!roleById.has(id)) throw new Fail(`pack.targets.roleIds 里的 ${id} 在 roles.json 中不存在`);
  for (const id of roleById.keys()) if (!roleIds.includes(id)) throw new Fail(`roles.json 的角色 ${id} 不在 pack.targets.roleIds 中（清单与元数据不一致）`);

  // ---- 人设 / 适配文件存在，且全部文本不含 {{（P13-PLAN 1.4：运行时会把 {{ 改写成 { {）
  const personaFiles = new Map();
  for (const id of roleIds) {
    const r = roleById.get(id);
    const promptPath = join(PACK_DIR, r.prompt);
    const entry = { promptPath, promptText: readTextFile(promptPath), adapterPath: null, adapterText: null };
    if (r.adapter !== null && r.adapter !== undefined) {
      if (typeof r.adapter !== 'string' || r.adapter === '') throw new Fail(`角色 ${id} 的 adapter 不是合法路径`);
      entry.adapterPath = join(PACK_DIR, r.adapter);
      entry.adapterText = readTextFile(entry.adapterPath);
    }
    personaFiles.set(id, entry);
  }
  const braceFiles = [
    ...walkMarkdown(join(PACK_DIR, 'prompts')),
    ...walkMarkdown(join(PACK_DIR, 'adapters')),
    paths.workflow,
  ];
  const braceHits = [];
  for (const f of braceFiles) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const idx = text.indexOf('{{');
    if (idx >= 0) braceHits.push(`${relative(PACK_DIR, f)}:${text.slice(0, idx).split(/\r?\n/).length}`);
  }
  if (braceHits.length > 0) throw new Fail(`人设/适配文本里出现了 "{{"（运行时会被改写成 "{ {"，必须修掉）：${braceHits.join(', ')}`);

  // ---- workflow.json 字节数必须小于请求体上限
  const wfBytes = statSync(paths.workflow).size;
  if (!(wfBytes > 0 && wfBytes < MAX_BODY_BYTES)) {
    throw new Fail(`workflow.json 有 ${wfBytes} 字节，必须 > 0 且 < ${MAX_BODY_BYTES}（readJsonBody 的请求体上限）`);
  }

  // ---- DAG：无悬空 dependsOn、无环、agent/reviewer 可解析
  if (!wfDoc.nodes || typeof wfDoc.nodes !== 'object') throw new Fail('workflow.json 缺少 nodes');
  const nodeIds = Object.keys(wfDoc.nodes);
  if (nodeIds.length === 0) throw new Fail('workflow.json 的 nodes 为空');
  if (wfDoc.id !== workflowId) throw new Fail(`workflow.json 的 id (${String(wfDoc.id)}) 与 pack.targets.workflowId (${workflowId}) 不一致`);
  const resolveRole = (ref) => (typeof ref === 'string' && ref !== '' ? (roleById.get(ref) || roleByName.get(ref) || null) : null);
  for (const [key, node] of Object.entries(wfDoc.nodes)) {
    if (!node || typeof node !== 'object') throw new Fail(`节点 ${key} 不是对象`);
    if (node.id !== key) throw new Fail(`节点 ${key} 的 id 字段是 ${String(node.id)}（必须与键一致，否则调度器与 UI 会看到两个不同的 id）`);
    if (!Array.isArray(node.dependsOn)) throw new Fail(`节点 ${key} 缺少 dependsOn 数组`);
    for (const dep of node.dependsOn) {
      if (!Object.prototype.hasOwnProperty.call(wfDoc.nodes, dep)) throw new Fail(`节点 ${key} 的 dependsOn 里有悬空依赖：${dep}`);
      if (dep === key) throw new Fail(`节点 ${key} 依赖自己`);
    }
    if (!resolveRole(node.agent)) throw new Fail(`节点 ${key} 的 agent "${String(node.agent)}" 无法解析到 roles.json 里的角色`);
    if (node.reviewer !== undefined && node.reviewer !== null && node.reviewer !== '') {
      if (!resolveRole(node.reviewer)) throw new Fail(`节点 ${key} 的 reviewer "${String(node.reviewer)}" 无法解析到 roles.json 里的角色`);
    }
  }
  // 环检测（Kahn）
  const indeg = new Map(nodeIds.map((id) => [id, 0]));
  for (const id of nodeIds) for (const dep of wfDoc.nodes[id].dependsOn) indeg.set(id, indeg.get(id) + 1);
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    seen++;
    for (const other of nodeIds) {
      if (!wfDoc.nodes[other].dependsOn.includes(id)) continue;
      indeg.set(other, indeg.get(other) - 1);
      if (indeg.get(other) === 0) queue.push(other);
    }
  }
  if (seen !== nodeIds.length) throw new Fail(`DAG 存在环，涉及节点：${nodeIds.filter((id) => indeg.get(id) > 0).join(' -> ')}`);

  // ---- 产物文件名与 pack.caseDirContract.artifacts 一致（P13-PLAN 3.1）
  const artifactFiles = Array.isArray(pack.caseDirContract && pack.caseDirContract.artifacts)
    ? pack.caseDirContract.artifacts.map((a) => a && a.file).filter((x) => typeof x === 'string')
    : [];
  if (artifactFiles.length === 0) throw new Fail('pack.json 的 caseDirContract.artifacts 为空');
  const wfText = readFileSync(paths.workflow, 'utf8');
  for (const f of artifactFiles) {
    if (!wfText.includes(f)) throw new Fail(`pack.caseDirContract.artifacts 里的 ${f} 在 workflow.json 中完全没有出现（清单与流水线不一致）`);
  }
  const mentioned = new Set();
  for (const m of wfText.matchAll(/<case_dir>[\\/]([0-9]{2}-[A-Za-z0-9._-]+\.(?:json|md))/g)) mentioned.add(m[1]);
  for (const f of mentioned) {
    if (!artifactFiles.includes(f)) throw new Fail(`workflow.json 引用了产物文件名 ${f}，但它不在 pack.caseDirContract.artifacts 里`);
  }

  // ---- models.map.json 结构
  const intents = modelsMap.intents;
  if (!intents || typeof intents !== 'object') throw new Fail('models.map.json 缺少 intents');
  for (const [name, intent] of Object.entries(intents)) {
    if (!intent || !Array.isArray(intent.prefer) || intent.prefer.length === 0) throw new Fail(`models.map.json 的意图 ${name} 缺少非空 prefer 数组`);
    for (const p of intent.prefer) {
      if (!p || typeof p.provider !== 'string' || p.provider === '' || typeof p.model !== 'string' || p.model === '') {
        throw new Fail(`models.map.json 的意图 ${name} 有不合法的 prefer 项（需要 provider 与 model 两个非空字符串）`);
      }
    }
  }
  for (const id of roleIds) {
    const intent = roleById.get(id).modelIntent;
    if (intent === null || intent === undefined || intent === '') continue;
    if (!Object.prototype.hasOwnProperty.call(intents, intent)) {
      warnings.push(`角色 ${id} 声明了模型意图 "${intent}"，但 models.map.json 里没有这个意图 → 该角色不写 model 字段（继承会话模型）`);
    }
  }
  const effortPolicy = modelsMap.reasoningEffort && modelsMap.reasoningEffort.policy;
  if (effortPolicy !== 'never-declare') {
    warnings.push(`models.map.json 的 reasoningEffort.policy = ${JSON.stringify(effortPolicy)}，本安装器只实现 never-declare：一律不写 model.reasoningEffort`);
  }

  // ---- PROVENANCE.json（sha256 与 prompts/ 实际内容一致；不一致只告警，因为用户可以有意改人设）
  const provFiles = provenance && provenance.files;
  if (!provFiles || typeof provFiles !== 'object') throw new Fail('PROVENANCE.json 缺少 files');
  for (const id of roleIds) {
    const r = roleById.get(id);
    const entry = provFiles[r.prompt.replace(/^prompts[\\/]/, '')];
    if (!entry || typeof entry.sha256 !== 'string') { warnings.push(`PROVENANCE.json 里没有 ${r.prompt} 的记录`); continue; }
    const actual = sha256(personaFiles.get(id).promptText);
    if (actual !== entry.sha256) {
      warnings.push(`PROVENANCE.json 记录 ${r.prompt} 的 sha256=${entry.sha256.slice(0, 12)}…，实际=${actual.slice(0, 12)}…（人设已被改动，安装器按实际内容安装，selftest 会报红）`);
    }
  }

  // ---- SKILL.md（若随包携带）：frontmatter 必须合规，否则宿主会静默忽略这个技能
  const skillFile = join(PACK_DIR, 'SKILL.md');
  let skillMeta = null;
  if (existsSync(skillFile)) {
    const meta = parseSkillFrontmatter(readTextFile(skillFile));
    if (!meta.ok) throw new Fail(`SKILL.md 的 frontmatter 不合规（宿主会静默忽略这样的技能，等于装了个看不见的技能）：${meta.reason}`);
    if (meta.name !== skillName) throw new Fail(`SKILL.md 的 frontmatter name (${meta.name}) 与 pack.targets.skillName (${skillName}) 不一致`);
    skillMeta = meta;
  }

  // ---- 信息性提示
  const desiredHalt = wfDoc.haltOnFailure === true;
  if (!desiredHalt) warnings.push('workflow.json 没有声明 haltOnFailure: true —— 本次安装出来的流水线不会硬停');
  const maxRework = wfDoc.review && wfDoc.review.maxRework;
  if (maxRework === undefined || maxRework === null) warnings.push('workflow.json 没有声明 review.maxRework');
  else if (!(Number.isInteger(maxRework) && maxRework >= 0 && maxRework <= 2)) warnings.push(`workflow.json 的 review.maxRework=${maxRework} 超出 schema 上限 2，写入会被拒绝`);
  for (const id of roleIds) {
    const r = roleById.get(id);
    const isReviewer = Object.values(wfDoc.nodes).some((n) => n.reviewer === id || n.reviewer === r.name);
    if (isReviewer && typeof r.timeoutMs === 'number' && r.timeoutMs > REVIEWER_TIMEOUT_CEILING) {
      notes.push(`角色 ${id}（担任评审者）声明 timeoutMs=${r.timeoutMs} > 评审者上限 ${REVIEWER_TIMEOUT_CEILING}，运行时 timeoutFor 会收紧，实际按 ${REVIEWER_TIMEOUT_CEILING} 走`);
    } else if (typeof r.timeoutMs === 'number' && r.timeoutMs > WORKER_TIMEOUT_CEILING) {
      notes.push(`角色 ${id} 声明 timeoutMs=${r.timeoutMs} > worker 上限 ${WORKER_TIMEOUT_CEILING}，运行时会被收紧`);
    }
  }

  return {
    pack, packPaths: paths, roleDoc, roleById, roleByName, roleIds, workflowId, skillName,
    wfDoc, wfBytes, modelsMap, provenance, personaFiles, artifactFiles, warnings, notes,
    desiredHalt, desiredMaxRework: maxRework, skillMeta,
  };
}

// ---------------------------------------------------------------- 期望值组装

function desiredModel(role, modelPlan) {
  const plan = modelPlan.get(role.id);
  if (!plan || !plan.resolved) return null;
  // 只写 upsertAgent 真正支持的字段；按 models.map.json 的 never-declare 策略不写 reasoningEffort。
  return { provider: plan.resolved.provider, model: plan.resolved.model };
}

function desiredSystemPrompt(role, personas) {
  const p = personas.get(role.id);
  const parts = [p.promptText];
  if (typeof p.adapterText === 'string') parts.push(p.adapterText);
  return parts.join('\n\n');
}

function desiredAgentBody(ctx, role, modelPlan) {
  const body = {
    id: ctx.roleTargetId.get(role.id),
    name: role.name,
    role: role.role,
    systemPrompt: desiredSystemPrompt(role, ctx.personaFiles),
  };
  const model = desiredModel(role, modelPlan);
  if (model !== null) body.model = model;
  if (typeof role.toolsPreset === 'string' && role.toolsPreset !== '') body.tools = { preset: role.toolsPreset };
  if (typeof role.timeoutMs === 'number') body.timeoutMs = role.timeoutMs;
  return body;
}

function desiredWorkflowBody(ctx) {
  const wf = ctx.wfDoc;
  const body = {
    id: ctx.workflowId,
    name: wf.name,
    description: wf.description,
    nodes: wf.nodes,
    haltOnFailure: wf.haltOnFailure === true,
    prompt: readTextFile(join(PACK_DIR, 'adapters', '00-workflow-contract.md')),
  };
  if (wf.review && typeof wf.review === 'object') body.review = wf.review;
  return body;
}

// 「已存在」判定：只比较本安装器声明/管理的字段，不动目标上多出来的其它设置。
function agentMatches(existing, desired) {
  if (!existing) return false;
  if ((existing.name || '') !== (desired.name || '')) return false;
  if ((existing.role || '') !== (desired.role || '')) return false;
  if ((existing.systemPrompt || '') !== desired.systemPrompt) return false;
  if (num(existing.timeoutMs) !== num(desired.timeoutMs)) return false;
  if (((existing.tools && existing.tools.preset) || null) !== ((desired.tools && desired.tools.preset) || null)) return false;
  const em = existing.model || {};
  const dm = desired.model || {};
  if ((em.provider || null) !== (dm.provider || null)) return false;
  if ((em.model || null) !== (dm.model || null)) return false;
  return true;
}

function workflowMatches(existing, desired) {
  if (!existing) return false;
  if (JSON.stringify(existing.nodes) !== JSON.stringify(desired.nodes)) return false;
  if ((existing.name || '') !== (desired.name || '')) return false;
  if ((existing.description || '') !== (desired.description || '')) return false;
  if ((existing.prompt || '') !== (desired.prompt || '')) return false;
  if ((existing.haltOnFailure === true) !== (desired.haltOnFailure === true)) return false;
  const er = existing.review || {};
  const dr = desired.review || {};
  if (num(er.maxRework) !== num(dr.maxRework)) return false;
  if (num(er.enabled) !== num(dr.enabled)) return false;
  return true;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  MODE = opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'install';
  if (opts.help) {
    let version = '?';
    try { version = JSON.parse(readFileSync(join(PACK_DIR, 'pack.json'), 'utf8')).version || '?'; } catch { version = '?'; }
    process.stdout.write(`移植包版本：${version}\n\n` + USAGE);
    return EXIT_OK;
  }
  JSON_MODE = opts.json;

  const ctx = precheck();
  const readOnly = opts.check || opts.dryRun;
  const modeLabel = opts.check ? '--check（只读，不落盘）' : opts.dryRun ? '--dry-run（不落盘）' : 'install（写入）';
  const summary = {
    pack: 'leasing-risk', version: (ctx.pack && ctx.pack.version) || null, mode: MODE,
    endpoint: base(opts.endpoint), profile: opts.profile, packDir: PACK_DIR,
    steps: [], warnings: [], issues: [], writes: 0, exitCode: EXIT_OK,
  };
  SUMMARY = summary;
  const issues = summary.issues;
  const warnings = summary.warnings;

  emit(`融资租赁客户还款风险评估专用团队 —— 移植包安装器（pack v${summary.version}）`);
  emit(`包目录   : ${PACK_DIR}`);
  emit(`端点     : ${base(opts.endpoint)}`);
  emit(`profile  : ${opts.profile}`);
  emit(`模式     : ${modeLabel}${opts.force ? ' + --force（强制重写）' : ''}`);
  emit(`写入目标 :`);
  emit(`  角色   -> POST ${api(opts.endpoint, '/agent')}  （运行中进程的注册表；持久化到 ${join(dshHome(), 'storages', 'team_agent_defs.json')}）`);
  emit(`  工作流 -> POST ${api(opts.endpoint, '/workflow')}  （运行中进程的注册表；持久化到 ${join(dshHome(), 'storages', 'team_workflows.json')}）`);
  emit(`  技能   -> ${join(skillRootCandidates(opts.profile)[0].path, ctx.skillName, 'SKILL.md')}`);
  emit('');

  // ---- 第 1 步
  emit('[1/6] 前置校验（只读，不写任何东西）');
  emit('  [校验] pack.json / roles.json / workflow.json / models.map.json / PROVENANCE.json 全部存在且是合法 JSON');
  emit(`  [校验] ${ctx.roleIds.length} 个角色与 pack.targets.roleIds 一一对应；人设与适配文本无 "{{"`);
  emit(`  [校验] workflow.json = ${ctx.wfBytes} 字节 < 请求体上限 ${MAX_BODY_BYTES}`);
  emit(`  [校验] DAG：${Object.keys(ctx.wfDoc.nodes).length} 个节点，无环、无悬空 dependsOn，agent/reviewer 全部解析到 roles.json`);
  emit(`  [校验] 产物文件名与 pack.caseDirContract.artifacts 一致（${ctx.artifactFiles.length} 个）`);
  emit(`  [校验] 模型意图表：${Object.keys(ctx.modelsMap.intents).length} 个意图；reasoningEffort 策略 = ${JSON.stringify(ctx.modelsMap.reasoningEffort && ctx.modelsMap.reasoningEffort.policy)}`);
  if (ctx.skillMeta) emit(`  [校验] SKILL.md frontmatter 合规：name=${ctx.skillMeta.name}（与 pack.targets.skillName 一致），description ${ctx.skillMeta.description.length} 字符`);
  else emit('  [提示] 本包未携带 SKILL.md，第 6 步会跳过技能安装');
  for (const n of ctx.notes) emit(`  [提示] ${n}`);
  for (const w of ctx.warnings) { emit(`  [告警] ${w}`); warnings.push(w); }
  summary.steps.push({ step: 1, name: 'precheck', status: 'ok', warnings: ctx.warnings.slice() });

  // ---- 第 2 步
  emit(`[2/6] 探测运行时：GET ${api(opts.endpoint, '/ping')}`);
  let ping;
  try {
    ping = await request('GET', api(opts.endpoint, '/ping'), { timeoutMs: 5000 });
  } catch (e) {
    emit(`  [错误] 无法连接运行中的 DSH：${e && e.message ? e.message : e}`);
    emit('  请先启动 dsh，或先安装 team-flowise：');
    emit(`    node <repo>/scripts/install.mjs --profile "${opts.profile}"`);
    emit('  （运行时不可达时本安装器不会尝试任何写入）');
    throw new Fail('运行时不可达', EXIT_RUNTIME);
  }
  if (!ping.ok || !ping.json || ping.json.ok !== true) {
    emit(`  [错误] ${api(opts.endpoint, '/ping')} 返回 HTTP ${ping.status}：${ping.text.slice(0, 200)}`);
    emit(`  该端点由 team-flowise 提供；若返回 404，说明这一行没装：node <repo>/scripts/install.mjs --profile "${opts.profile}"`);
    throw new Fail('运行时不可达（team-flowise 未安装）', EXIT_RUNTIME);
  }
  emit(`  [校验] 运行时可达：pong=${ping.json.pong === true} domains=${JSON.stringify(ping.json.domains || [])}`);

  const modelsRes = await request('GET', api(opts.endpoint, '/models'), { timeoutMs: 15000 });
  if (!modelsRes.ok || !modelsRes.json) throw new Fail(`GET /models 失败：HTTP ${modelsRes.status} ${modelsRes.text.slice(0, 200)}`);
  const agentsRes = await request('GET', api(opts.endpoint, '/agents'), { timeoutMs: 15000 });
  if (!agentsRes.ok || !agentsRes.json) throw new Fail(`GET /agents 失败：HTTP ${agentsRes.status} ${agentsRes.text.slice(0, 200)}`);
  const wfsRes = await request('GET', api(opts.endpoint, '/workflows'), { timeoutMs: 15000 });
  if (!wfsRes.ok || !wfsRes.json) throw new Fail(`GET /workflows 失败：HTTP ${wfsRes.status} ${wfsRes.text.slice(0, 200)}`);
  const modelCatalog = Array.isArray(modelsRes.json.providers) ? modelsRes.json.providers : [];
  let agents = Array.isArray(agentsRes.json.agents) ? agentsRes.json.agents.slice() : [];
  let workflows = Array.isArray(wfsRes.json.workflows) ? wfsRes.json.workflows.slice() : [];
  emit(`  [校验] 目标现状：角色 ${agents.length} 个，工作流 ${workflows.length} 个，provider ${modelCatalog.length} 个`);
  if (Array.isArray(modelsRes.json.errors) && modelsRes.json.errors.length > 0) {
    for (const e of modelsRes.json.errors) { emit(`  [告警] 模型目录：${e}`); warnings.push('模型目录：' + e); }
  }
  summary.steps.push({ step: 2, name: 'probe', status: 'ok', agents: agents.length, workflows: workflows.length, providers: modelCatalog.length });

  // ---- 第 3 步
  emit('[3/6] 解析模型意图（models.map.json；按 prefer 顺序取第一个在目标部署上存在的 provider/model）');
  const providerIndex = new Map(modelCatalog.map((p) => [p && p.id, new Set((p && Array.isArray(p.models) ? p.models : []).map((m) => m && m.id))]));
  const modelPlan = new Map();
  for (const id of ctx.roleIds) {
    const role = ctx.roleById.get(id);
    const intent = role.modelIntent;
    if (intent === null || intent === undefined || intent === '') {
      emit(`  [提示] ${id}：未声明模型意图 → 不写 model 字段（继承会话模型）`);
      modelPlan.set(id, { intent: null, resolved: null });
      continue;
    }
    const def = ctx.modelsMap.intents[intent];
    if (!def) {
      const w = `${id}：意图 "${intent}" 不在 models.map.json 中 → 不写 model 字段（继承会话模型）`;
      emit(`  [告警] ${w}`); warnings.push(w);
      modelPlan.set(id, { intent, resolved: null });
      continue;
    }
    let hit = null;
    for (const p of def.prefer) if (providerIndex.get(p.provider) && providerIndex.get(p.provider).has(p.model)) { hit = p; break; }
    if (hit) {
      emit(`  [校验] ${id}：意图 ${intent}（${def.label || ''}）-> ${hit.provider}/${hit.model}`);
      modelPlan.set(id, { intent, resolved: hit });
    } else {
      const tried = def.prefer.map((p) => `${p.provider}/${p.model}`).join(', ');
      const w = `${id}：意图 ${intent}（${def.label || ''}）在目标部署上解析不到（按 prefer 依次尝试：${tried}）→ 不写 model 字段，该角色继承会话模型（如实降级，不是安装失败）`;
      emit(`  [告警] ${w}`); warnings.push(w);
      modelPlan.set(id, { intent, resolved: null });
    }
  }
  summary.steps.push({ step: 3, name: 'resolve-models', status: 'ok', plan: [...modelPlan].map(([id, p]) => ({ id, intent: p.intent, resolved: p.resolved })) });

  // ---- 第 4 步
  emit(`[4/6] 导入角色（${ctx.roleIds.length} 个；id 用 roles.json 里的固定 id）`);
  const byId = new Map(agents.map((a) => [a && a.id, a]));
  const byName = new Map();
  for (const a of agents) if (a && typeof a.name === 'string' && a.name !== '' && !byName.has(a.name)) byName.set(a.name, a);
  ctx.roleTargetId = new Map();
  const rolePlan = [];
  for (const id of ctx.roleIds) {
    const role = ctx.roleById.get(id);
    let targetId = id;
    const existingSameId = byId.get(id) || null;
    const existingSameName = byName.get(role.name) || null;
    if (!existingSameId && existingSameName && existingSameName.id !== id) {
      targetId = existingSameName.id;
      const w = `目标上已存在同名角色「${role.name}」(id=${targetId})，但 id 与本包的固定 id (${id}) 不同；本次用已存在的 id 去改，不新建第二份重名角色`;
      emit(`  [告警] ${w}`); warnings.push(w);
    }
    ctx.roleTargetId.set(id, targetId);
    const body = desiredAgentBody(ctx, role, modelPlan);
    const existing = byId.get(targetId) || null;
    const persona = desiredSystemPrompt(role, ctx.personaFiles);
    const item = { roleId: id, targetId, body, action: null };
    rolePlan.push(item);

    const intentLabel = body.model ? `${body.model.provider}/${body.model.model}` : '(无 model 字段，继承会话模型)';
    emit(`  · 角色 ${role.name}（id=${targetId}）意图=${role.modelIntent || '无'} -> ${intentLabel}；systemPrompt=${persona.length} 字符（人设 ${ctx.personaFiles.get(id).promptText.length}${ctx.personaFiles.get(id).adapterText ? ' + 适配 ' + ctx.personaFiles.get(id).adapterText.length : ''}）；tools.preset=${(body.tools && body.tools.preset) || '未声明'}；timeoutMs=${body.timeoutMs === undefined ? '未声明' : body.timeoutMs}；请求体 ${Buffer.byteLength(JSON.stringify(body), 'utf8')} 字节`);

    const matched = agentMatches(existing, body);
    if (matched && !opts.force) {
      emit(`  [跳过] 已存在，跳过：角色 ${role.name}（id=${targetId}）`);
      item.action = 'skipped-exists';
      continue;
    }
    if (existing && existing.model && typeof existing.model.reasoningEffort === 'string' && !body.model) {
      const w = `角色 ${targetId} 的目标记录里有 model.reasoningEffort=${existing.model.reasoningEffort}，本包策略是 never-declare；安装器不覆盖为「未声明」（要清除请用 --force）`;
      emit(`  [告警] ${w}`); warnings.push(w);
    }
    if (opts.force && matched) emit(`  [提示] --force：即使内容一致也重写角色 ${targetId}`);
    emit(`  [写入] 目标：POST ${api(opts.endpoint, '/agent')}（记录 id=${targetId}；宿主 storages/team_agent_defs.json）${existing ? '，将覆盖现有记录' : '，将新建记录'}`);
    if (opts.check) {
      emit(`  [不一致] --check：该角色需要写入，但 --check 不落盘（目标 id=${targetId}）`);
      item.action = 'needs-write';
      continue;
    }
    if (opts.dryRun) {
      emit(`  [跳过] --dry-run：不落盘（本应写入角色 ${targetId}）`);
      item.action = 'dry-run';
      continue;
    }
    const res = await request('POST', api(opts.endpoint, '/agent'), { body });
    if (!res.ok || !res.json || res.json.ok !== true) {
      emit(`  [错误] 写入角色 ${targetId} 失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
      throw new Fail(`写入角色 ${targetId} 失败`);
    }
    item.action = existing ? 'updated' : 'created';
    summary.writes++;
    emit(`  [写入] 完成：角色 ${targetId}（宿主返回 updatedAt=${res.json.agent && res.json.agent.updatedAt}）`);
    if (res.json.agent) byId.set(targetId, res.json.agent);
  }
  summary.steps.push({ step: 4, name: 'import-roles', status: 'ok', plan: rolePlan.map((r) => ({ roleId: r.roleId, targetId: r.targetId, action: r.action })) });

  if (!readOnly) {
    const back = await request('GET', api(opts.endpoint, '/agents'), { timeoutMs: 15000 });
    agents = back.ok && back.json && Array.isArray(back.json.agents) ? back.json.agents : agents;
    const backById = new Map(agents.map((a) => [a && a.id, a]));
    emit('  [校验] 读回校验角色（GET /agents）：');
    for (const r of rolePlan) {
      const rec = backById.get(r.targetId);
      if (!rec) { const w = `读回校验：角色 ${r.targetId} 写入后读不到`; emit(`  [告警] ${w}`); warnings.push(w); continue; }
      const samePrompt = (rec.systemPrompt || '') === r.body.systemPrompt;
      const sameModel = ((rec.model && rec.model.provider) || null) === ((r.body.model && r.body.model.provider) || null)
        && ((rec.model && rec.model.model) || null) === ((r.body.model && r.body.model.model) || null);
      const sameTools = ((rec.tools && rec.tools.preset) || null) === ((r.body.tools && r.body.tools.preset) || null);
      if (!samePrompt) { const w = `读回校验：角色 ${r.targetId} 的 systemPrompt 与写入内容不一致（目标记录 ${(rec.systemPrompt || '').length} 字符）`; emit(`  [告警] ${w}`); warnings.push(w); }
      else if (!sameModel) { const w = `读回校验：角色 ${r.targetId} 的 model 没存住或与解析结果不一致（目标记录 ${JSON.stringify(rec.model || null)}）`; emit(`  [告警] ${w}`); warnings.push(w); }
      else if (!sameTools) { const w = `读回校验：角色 ${r.targetId} 的 tools.preset 没存住（目标记录 ${JSON.stringify(rec.tools || null)}）`; emit(`  [告警] ${w}`); warnings.push(w); }
      else emit(`  [校验] ${r.targetId}：systemPrompt / model / tools.preset 读回一致`);
    }
  }

  // ---- 第 5 步
  emit('[5/6] 导入工作流并读回校验');
  const wfBody = desiredWorkflowBody(ctx);
  const wfBodyBytes = Buffer.byteLength(JSON.stringify(wfBody), 'utf8');
  if (wfBodyBytes >= MAX_BODY_BYTES) throw new Fail(`组装出的工作流请求体有 ${wfBodyBytes} 字节，超过上限 ${MAX_BODY_BYTES}：workflow.prompt 太长`);
  const wfExisting = workflows.find((w) => w && w.id === ctx.workflowId) || null;
  emit(`  · 工作流 ${wfBody.name}（id=${ctx.workflowId}）：${Object.keys(wfBody.nodes).length} 个节点；haltOnFailure=${wfBody.haltOnFailure}；review.maxRework=${wfBody.review && wfBody.review.maxRework}；prompt=工作流契约 ${wfBody.prompt.length} 字符；请求体 ${wfBodyBytes} 字节`);
  let wfAction = 'skipped';
  if (workflowMatches(wfExisting, wfBody) && !opts.force) {
    emit(`  [跳过] 已存在，跳过：工作流 ${ctx.workflowId}`);
  } else {
    emit(`  [写入] 目标：POST ${api(opts.endpoint, '/workflow')}（记录 id=${ctx.workflowId}；宿主 storages/team_workflows.json）${wfExisting ? '，将覆盖现有记录' : '，将新建记录'}`);
    if (opts.check) {
      emit(`  [不一致] --check：该工作流需要写入，但 --check 不落盘（目标 id=${ctx.workflowId}）`);
      wfAction = 'needs-write';
    } else if (opts.dryRun) {
      emit(`  [跳过] --dry-run：不落盘（本应写入工作流 ${ctx.workflowId}）`);
      wfAction = 'dry-run';
    } else {
      const res = await request('POST', api(opts.endpoint, '/workflow'), { body: wfBody });
      if (!res.ok || !res.json || res.json.ok !== true) {
        emit(`  [错误] 写入工作流失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
        throw new Fail('写入工作流失败');
      }
      summary.writes++;
      wfAction = wfExisting ? 'updated' : 'created';
      emit(`  [写入] 完成：工作流 ${ctx.workflowId}（宿主返回 updatedAt=${res.json.workflow && res.json.workflow.updatedAt}）`);
    }
  }
  summary.steps.push({ step: 5, name: 'import-workflow', status: 'ok', action: wfAction, bodyBytes: wfBodyBytes });

  if (!readOnly) {
    const back = await request('GET', api(opts.endpoint, '/workflows'), { timeoutMs: 15000 });
    const list = back.ok && back.json && Array.isArray(back.json.workflows) ? back.json.workflows : workflows;
    const rec = list.find((w) => w && w.id === ctx.workflowId) || null;
    emit(`  [校验] 读回校验工作流（GET /workflows，按 id=${ctx.workflowId}）：`);
    if (!rec) {
      const w = `读回校验：工作流 ${ctx.workflowId} 写入后读不到`;
      emit(`  [告警] ${w}`); warnings.push(w);
    } else {
      if (rec.haltOnFailure === true) {
        emit('  [校验] haltOnFailure = true（存住了：任一步骤失败、或其阻塞项在返工上限内未解决时，运行停止且未开始的节点记为 skipped）');
      } else {
        const w = '读回校验失败：工作流记录里没有 haltOnFailure=true。本 team-flowise 版本会丢弃该字段，本次流水线不会硬停，只靠产物级阻断（每个节点自检上游产物，缺失/为空/blocked/FAIL/return_to_intake/stop_for_human 时写阻断产物并停止，不产出风险结论）。这是能力降级，不是安装失败（退出码仍为 0）。';
        emit(`  [告警] ${w}`); warnings.push(w);
      }
      const mr = rec.review && rec.review.maxRework;
      if (num(mr) === num(ctx.desiredMaxRework)) emit(`  [校验] review.maxRework = ${num(mr)}（存住了）`);
      else {
        const w = `读回校验失败：工作流记录里 review.maxRework = ${JSON.stringify(num(mr))}，声明的是 ${JSON.stringify(num(ctx.desiredMaxRework))}（返工上限会退回插件默认值 maxReworkPerNode=2）`;
        emit(`  [告警] ${w}`); warnings.push(w);
      }
      const nodeCount = rec.nodes ? Object.keys(rec.nodes).length : 0;
      if (nodeCount === Object.keys(wfBody.nodes).length) emit(`  [校验] 节点数 = ${nodeCount}（读回一致）`);
      else { const w = `读回校验失败：工作流节点数读回是 ${nodeCount}，写入的是 ${Object.keys(wfBody.nodes).length}`; emit(`  [告警] ${w}`); warnings.push(w); }
      if ((rec.prompt || '') === wfBody.prompt) emit('  [校验] 工作流 prompt（契约正文）读回一致');
      else { const w = '读回校验失败：工作流 prompt（契约正文）读回不一致'; emit(`  [告警] ${w}`); warnings.push(w); }
    }
  }

  // ---- 第 6 步
  emit('[6/6] 安装技能');
  const roots = skillRootCandidates(opts.profile);
  const skillSrc = join(PACK_DIR, 'SKILL.md');
  const skillState = { carried: existsSync(skillSrc), action: 'skipped', roots: roots.map((r) => ({ path: r.path, why: r.why, exists: existsSync(r.path) })) };
  const targetRoot = roots[0];
  const skillDir = join(targetRoot.path, ctx.skillName);
  const skillTarget = join(skillDir, 'SKILL.md');
  const skillStep = { step: 6, name: 'install-skill', status: 'ok', state: skillState, detail: null };
  summary.steps.push(skillStep);
  for (const r of roots) emit(`  [提示] 技能根目录候选：${r.path}（${r.why}；${r.exists ? '存在' : '不存在'}）`);
  if (opts.skipSkill) {
    emit(`  [跳过] 已指定 --skip-skill，跳过技能安装与校验（目标本应是 ${skillTarget}）`);
    skillState.action = 'skipped-by-flag';
    skillStep.detail = 'skipped-by-flag';
  } else if (!skillState.carried) {
    emit(`  [告警] 本包当前未携带 SKILL.md（${skillSrc} 不存在），跳过技能安装。补上 SKILL.md 后重跑本安装器即可；不影响角色与工作流。`);
    skillState.action = 'not-carried';
    skillStep.detail = 'not-carried';
  } else {
    const srcText = readTextFile(skillSrc);
    const targetExists = existsSync(skillTarget);
    const sameContent = targetExists && stripBom(readFileSync(skillTarget, 'utf8')) === srcText;
    if (targetExists && sameContent && !opts.force) {
      emit(`  [跳过] 已存在，跳过：技能 ${ctx.skillName}（${skillTarget}，内容逐字节一致）`);
      skillState.action = 'skipped';
      skillStep.detail = 'exists-identical';
    } else if (targetExists && !sameContent && !opts.force) {
      // 内容不同又没给 --force：只提示，绝不覆盖别人的技能文件（P13-PLAN 3.2 第 6 条）
      const w = `技能 ${ctx.skillName} 已存在但内容不同（${skillTarget}）：本次不覆盖，请加 --force 覆盖；会话里以已装的旧版本为准`;
      emit(`  [告警] ${w}`); warnings.push(w);
      emit(`  [跳过] 已存在但内容不同，未覆盖：技能 ${ctx.skillName}（${skillTarget}）`);
      skillState.action = 'conflict';
      skillStep.detail = 'conflict';
    } else {
      emit(`  [写入] 目标：${skillTarget}${targetExists ? '（将覆盖现有内容）' : '（将新建目录与文件）'}`);
      if (opts.check) {
        emit(`  [不一致] --check：技能需要写入，但 --check 不落盘（目标 ${skillTarget}）`);
        skillState.action = 'needs-write';
        skillStep.detail = 'needs-write';
      } else if (opts.dryRun) {
        emit(`  [跳过] --dry-run：不落盘（本应写入技能 ${ctx.skillName}）`);
        skillState.action = 'dry-run';
        skillStep.detail = 'dry-run';
      } else {
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(skillTarget, srcText, 'utf8');
        summary.writes++;
        skillState.action = targetExists ? 'updated' : 'created';
        skillStep.detail = skillState.action;
        emit(`  [写入] 完成：技能 ${ctx.skillName} -> ${skillTarget}（${Buffer.byteLength(srcText, 'utf8')} 字节）`);
      }
    }
  }
  const otherAgentsSkills = join(homedir(), '.agents', 'skills', ctx.skillName);
  if (!opts.skipSkill && skillState.carried && existsSync(otherAgentsSkills)) {
    emit(`  [提示] 本部署还存在技能根 ${join(homedir(), '.agents', 'skills')}，其中已有同名技能目录；不同根之间的优先级由宿主决定（本安装器只写上面解析出的根）`);
  }

  // ---- --check 判定
  if (opts.check) {
    emit('');
    emit('[校验] --check：与目标状态逐项比对（不落盘）');
    for (const r of rolePlan) {
      const rec = byId.get(r.targetId) || agents.find((a) => a && a.id === r.targetId) || null;
      if (!rec) { const s = `角色 ${r.targetId}（${ctx.roleById.get(r.roleId).name}）未安装`; emit(`  [缺失] ${s}`); issues.push(s); continue; }
      if (agentMatches(rec, r.body)) emit(`  [校验] 角色 ${r.targetId}：已就位且一致`);
      else { const s = `角色 ${r.targetId} 已存在但与本包声明不一致（名称/角色说明/systemPrompt/model/tools.preset/timeoutMs 之一不同）`; emit(`  [不一致] ${s}`); issues.push(s); }
    }
    const rec = workflows.find((w) => w && w.id === ctx.workflowId) || null;
    if (!rec) { const s = `工作流 ${ctx.workflowId} 未安装`; emit(`  [缺失] ${s}`); issues.push(s); }
    else if (workflowMatches(rec, wfBody)) {
      emit(`  [校验] 工作流 ${ctx.workflowId}：已就位且一致（haltOnFailure=${rec.haltOnFailure === true}, review.maxRework=${num(rec.review && rec.review.maxRework)}）`);
    } else {
      if (rec.haltOnFailure !== true) { const s = `工作流 ${ctx.workflowId} 的 haltOnFailure 不是 true（该版本不会硬停）`; emit(`  [不一致] ${s}`); issues.push(s); }
      if (num(rec.review && rec.review.maxRework) !== num(ctx.desiredMaxRework)) { const s = `工作流 ${ctx.workflowId} 的 review.maxRework 是 ${JSON.stringify(num(rec.review && rec.review.maxRework))}，声明的是 ${JSON.stringify(num(ctx.desiredMaxRework))}`; emit(`  [不一致] ${s}`); issues.push(s); }
      if (JSON.stringify(rec.nodes) !== JSON.stringify(wfBody.nodes)) { const s = `工作流 ${ctx.workflowId} 的 nodes 与 workflow.json 不一致`; emit(`  [不一致] ${s}`); issues.push(s); }
      if ((rec.prompt || '') !== wfBody.prompt) { const s = `工作流 ${ctx.workflowId} 的 prompt（契约正文）与 adapters/00-workflow-contract.md 不一致`; emit(`  [不一致] ${s}`); issues.push(s); }
    }
    if (opts.skipSkill) {
      emit('  [跳过] 已指定 --skip-skill，不校验技能');
    } else if (!skillState.carried) {
      emit('  [跳过] 本包未携带 SKILL.md，不校验技能');
    } else if (!existsSync(skillTarget)) {
      const s = `技能 ${ctx.skillName} 未安装（期望 ${skillTarget}）`; emit(`  [缺失] ${s}`); issues.push(s);
    } else if (stripBom(readFileSync(skillTarget, 'utf8')) !== readTextFile(skillSrc)) {
      const s = `技能 ${ctx.skillName} 已存在但内容与 SKILL.md 不一致（${skillTarget}）`; emit(`  [不一致] ${s}`); issues.push(s);
    } else emit(`  [校验] 技能 ${ctx.skillName}：已就位且一致（${skillTarget}）`);
  }

  // ---- 收尾
  emit('');
  emit('是否需要重启 dsh：不需要。技能由技能目录在读取时发现（热加载）；角色与工作流是通过 HTTP 写进运行中进程的注册表，已经立即生效。');
  if (warnings.length > 0) {
    emit(`本次共有 ${warnings.length} 条告警（逐条见上；其中「haltOnFailure 没存住」意味着流水线不会硬停，只靠产物级阻断）：`);
    for (const w of warnings) emit(`  [告警] ${w}`);
  }
  if (opts.check) {
    if (issues.length === 0) emit('--check 结果：全部就位且一致（退出码 0）');
    else { emit(`--check 结果：${issues.length} 项缺失/不一致（退出码 3）`); for (const s of issues) emit(`  - ${s}`); }
    summary.exitCode = issues.length === 0 ? EXIT_OK : EXIT_CHECK;
  } else {
    const skillLabel = opts.skipSkill
      ? '已跳过'
      : (!skillState.carried ? '未随包携带' : (skillState.action === 'conflict' ? '内容冲突未覆盖' : skillState.action));
    emit(`${opts.dryRun ? '--dry-run 完成（未落盘）' : '安装完成'}：写入 ${summary.writes} 次（角色 ${ctx.roleIds.length} 个、工作流 1 个、技能 ${skillLabel}）；告警 ${warnings.length} 条；退出码 0`);
    summary.exitCode = EXIT_OK;
  }
  return summary.exitCode;
}

// ---------------------------------------------------------------- 入口

let exitCode = EXIT_OK;
try {
  exitCode = await main();
} catch (e) {
  exitCode = e instanceof Fail ? e.exitCode : EXIT_FAIL;
  if (e instanceof Fail) emit(`[错误] ${e.message}（退出码 ${exitCode}）`);
  else emit(`[错误] 未预期的异常：${e && e.stack ? e.stack : String(e)}`);
  if (SUMMARY) {
    SUMMARY.exitCode = exitCode;
    SUMMARY.error = e && e.message ? e.message : String(e);
  }
}
if (JSON_MODE) {
  process.stdout.write(JSON.stringify(Object.assign({ ok: exitCode === EXIT_OK, exitCode, mode: MODE }, SUMMARY || {}), null, 2) + '\n');
}
process.exitCode = exitCode;
