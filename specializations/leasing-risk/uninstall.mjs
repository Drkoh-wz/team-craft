#!/usr/bin/env node
/**
 * 融资租赁客户还款风险评估专用团队 —— 移植包卸载器
 *
 * 契约来源：P13-PLAN.md 第 3.3 节。
 *   * DELETE /api/team-flowise/agent?id=  逐个删除 pack.targets.roleIds
 *   * DELETE /api/team-flowise/workflow?id= 删除 pack.targets.workflowId
 *   * 技能目录按 --keep-skill 决定是否删除
 *   * 幂等：不存在时输出「不存在，跳过」
 *   * 默认不删除「同名但 id 不同」的角色（避免误删别人的东西），只警告
 *
 * 退出码：0 成功 / 1 参数或前置校验失败（含删除失败）/ 2 运行时不可达
 *
 * 安全性质：写（删除）之前先打印目标路径；--dry-run 不动任何东西；
 * 只用 Node 内置能力，零依赖；不修改 profile / settings.yaml。
 */

import { existsSync, statSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import http from 'node:http';
import https from 'node:https';

const PACK_DIR = dirname(fileURLToPath(import.meta.url));
const API = '/api/team-flowise';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_RUNTIME = 2;

class Fail extends Error {
  constructor(message, code = EXIT_FAIL) { super(message); this.exitCode = code; }
}

const USAGE = `融资租赁客户还款风险评估专用团队 —— 移植包卸载器

用法：
  node uninstall.mjs [选项]

选项：
  --profile <dir>    DSH profile 目录，用于解析技能根目录（customSkillDirs）
                     默认：<DSH_HOME>\\profiles\\web
  --endpoint <url>   运行中的 DSH 地址，默认 http://127.0.0.1:3080
  --dry-run          只打印将要删除什么，不删任何东西
  --keep-skill       保留已安装的技能（只删角色与工作流）
  --json             进度打到 stderr，最终结果以一个 JSON 对象打到 stdout
  --help, -h         显示本帮助

删除范围：
  * pack.targets.roleIds 里的全部角色（按 id 精确删除，逐个打印）
  * pack.targets.workflowId 这一个工作流（按 id 精确删除）
  * 技能目录 <技能根>/<skillName>/（除非 --keep-skill）

不会删除的东西：
  * 同名但 id 不同的角色：默认只警告（避免误删别人的东西）

退出码：
  0  成功（含「不存在，跳过」的幂等路径）
  1  参数错误 / 前置校验失败 / 删除失败
  2  运行时不可达

需要重启 dsh 吗？
  不需要。删除是经 HTTP 作用在运行中进程的注册表上，立即生效；
  技能目录的增删由技能目录在读取时发现。
`;

let JSON_MODE = false;
let SUMMARY = null;
const emit = (line) => { (JSON_MODE ? process.stderr : process.stdout).write(line + '\n'); };
const num = (v) => (v === undefined || v === null ? null : v);

function dshHome() {
  const env = process.env.DSH_HOME;
  return (typeof env === 'string' && env.trim() !== '') ? pathResolve(env) : join(homedir(), '.dsh');
}

function readTextFile(p) {
  if (!existsSync(p)) throw new Fail(`缺少必需文件：${p}`);
  try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
  catch (e) { throw new Fail(`读取失败：${p}：${e && e.message ? e.message : e}`); }
}

function readJsonFile(p) {
  const text = readTextFile(p);
  try { return JSON.parse(text); }
  catch (e) { throw new Fail(`${p} 不是合法 JSON：${e && e.message ? e.message : e}`); }
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

function parseArgs(argv) {
  const o = { profile: null, endpoint: null, dryRun: false, keepSkill: false, json: false, help: false };
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
      case '--keep-skill': o.keepSkill = true; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default: throw new Fail(`未知参数：${a}（用 --help 看用法）`);
    }
  }
  o.profile = pathResolve(o.profile === null ? join(dshHome(), 'profiles', 'web') : o.profile);
  o.endpoint = o.endpoint === null ? 'http://127.0.0.1:3080' : o.endpoint;
  try { new URL(o.endpoint); } catch { throw new Fail(`--endpoint 不是合法 URL：${o.endpoint}`); }
  return o;
}

// 与 install.mjs 相同的技能根目录解析规则（P13-PLAN 3.2 第 6 条）。只读。
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
  // 卸载时也要覆盖 DSH_HOME 兜底根与 <home>/.agents/skills（安装器可能写在其中之一）
  push(join(dshHome(), 'skills'), 'DSH_HOME 兜底根目录（P13-PLAN 3.2 第 6 条）');
  push(join(homedir(), '.agents', 'skills'), '本部署的可见技能根（P12 实测 USER_AGENTS）');
  return found;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    let version = '?';
    try { version = JSON.parse(readFileSync(join(PACK_DIR, 'pack.json'), 'utf8')).version || '?'; } catch { version = '?'; }
    process.stdout.write(`移植包版本：${version}\n\n` + USAGE);
    return EXIT_OK;
  }
  JSON_MODE = opts.json;

  // ---- 前置校验（只读）
  const packPath = join(PACK_DIR, 'pack.json');
  const pack = readJsonFile(packPath);
  const targets = pack.targets;
  if (!targets || typeof targets !== 'object') throw new Fail('pack.json 缺少 targets');
  const roleIds = targets.roleIds;
  const workflowId = targets.workflowId;
  const skillName = targets.skillName;
  if (!Array.isArray(roleIds) || roleIds.length === 0) throw new Fail('pack.json 的 targets.roleIds 缺失或为空');
  if (typeof workflowId !== 'string' || workflowId === '') throw new Fail('pack.json 的 targets.workflowId 缺失');
  if (typeof skillName !== 'string' || skillName === '') throw new Fail('pack.json 的 targets.skillName 缺失');

  const warnings = [];
  const nameById = new Map();
  const rolesPath = join(PACK_DIR, 'roles.json');
  if (existsSync(rolesPath)) {
    try {
      const roleDoc = JSON.parse(readTextFile(rolesPath));
      for (const r of (Array.isArray(roleDoc.roles) ? roleDoc.roles : [])) {
        if (r && typeof r.id === 'string') nameById.set(r.id, typeof r.name === 'string' ? r.name : null);
      }
    } catch (e) { warnings.push(`roles.json 读取失败（只影响同名角色的提示，不影响删除）：${e && e.message ? e.message : e}`); }
  } else {
    warnings.push('roles.json 不存在：无法给出「同名不同 id」角色的提示（不影响按 id 删除）');
  }

  const summary = {
    pack: 'leasing-risk', version: pack.version || null, mode: opts.dryRun ? 'dry-run' : 'uninstall',
    endpoint: base(opts.endpoint), profile: opts.profile, packDir: PACK_DIR,
    deleted: { agents: [], workflows: [], skills: [] }, skipped: { agents: [], workflows: [], skills: [] },
    warnings: [], writes: 0, exitCode: EXIT_OK,
  };
  SUMMARY = summary;

  emit(`融资租赁客户还款风险评估专用团队 —— 移植包卸载器（pack v${summary.version}）`);
  emit(`包目录   : ${PACK_DIR}`);
  emit(`端点     : ${base(opts.endpoint)}`);
  emit(`profile  : ${opts.profile}`);
  emit(`模式     : ${opts.dryRun ? '--dry-run（不删除任何东西）' : 'uninstall（删除）'}${opts.keepSkill ? ' + --keep-skill' : ''}`);
  emit('删除目标 :');
  emit(`  角色   -> DELETE ${api(opts.endpoint, '/agent?id=<id>')}  共 ${roleIds.length} 个固定 id`);
  emit(`  工作流 -> DELETE ${api(opts.endpoint, '/workflow?id=' + workflowId)}`);
  if (opts.keepSkill) emit('  技能   -> 已指定 --keep-skill：保留');
  else for (const r of skillRootCandidates(opts.profile)) emit(`  技能   -> ${join(r.path, skillName)}（${r.why}；${existsSync(r.path) ? '根目录存在' : '根目录不存在'}）`);
  emit('');
  for (const w of warnings) emit(`  [告警] ${w}`);
  summary.warnings.push(...warnings);

  // ---- 探测运行时
  emit(`[1/4] 探测运行时：GET ${api(opts.endpoint, '/ping')}`);
  let ping;
  try {
    ping = await request('GET', api(opts.endpoint, '/ping'), { timeoutMs: 5000 });
  } catch (e) {
    emit(`  [错误] 无法连接运行中的 DSH：${e && e.message ? e.message : e}`);
    emit('  请先启动 dsh，或先安装 team-flowise：node <repo>/scripts/install.mjs');
    emit('  （运行时不可达时本卸载器不会尝试任何删除；技能目录也一并不动）');
    throw new Fail('运行时不可达', EXIT_RUNTIME);
  }
  if (!ping.ok || !ping.json || ping.json.ok !== true) {
    emit(`  [错误] ${api(opts.endpoint, '/ping')} 返回 HTTP ${ping.status}：${ping.text.slice(0, 200)}`);
    throw new Fail('运行时不可达（team-flowise 未安装）', EXIT_RUNTIME);
  }
  emit(`  [校验] 运行时可达：pong=${ping.json.pong === true}`);

  const agentsRes = await request('GET', api(opts.endpoint, '/agents'), { timeoutMs: 15000 });
  if (!agentsRes.ok || !agentsRes.json) throw new Fail(`GET /agents 失败：HTTP ${agentsRes.status} ${agentsRes.text.slice(0, 200)}`);
  const wfsRes = await request('GET', api(opts.endpoint, '/workflows'), { timeoutMs: 15000 });
  if (!wfsRes.ok || !wfsRes.json) throw new Fail(`GET /workflows 失败：HTTP ${wfsRes.status} ${wfsRes.text.slice(0, 200)}`);
  const agents = Array.isArray(agentsRes.json.agents) ? agentsRes.json.agents : [];
  const workflows = Array.isArray(wfsRes.json.workflows) ? wfsRes.json.workflows : [];
  emit(`  [校验] 目标现状：角色 ${agents.length} 个，工作流 ${workflows.length} 个`);

  // ---- 删除角色
  emit(`[2/4] 删除角色（${roleIds.length} 个固定 id）`);
  const agentIds = new Set(agents.map((a) => a && a.id));
  for (const id of roleIds) {
    const name = nameById.get(id) || '';
    if (!agentIds.has(id)) {
      emit(`  [跳过] 不存在，跳过：角色 ${id}${name ? `（${name}）` : ''}`);
      summary.skipped.agents.push(id);
      continue;
    }
    emit(`  [删除] 目标：DELETE ${api(opts.endpoint, '/agent')}?id=${encodeURIComponent(id)}（宿主 storages/team_agent_defs.json，记录 id=${id}${name ? `，${name}` : ''}）`);
    if (opts.dryRun) {
      emit(`  [跳过] --dry-run：不删除（本应删除角色 ${id}）`);
      summary.skipped.agents.push(id);
      continue;
    }
    const res = await request('DELETE', api(opts.endpoint, '/agent?id=' + encodeURIComponent(id)), { timeoutMs: 15000 });
    if (!res.ok || !res.json || res.json.ok !== true) {
      emit(`  [错误] 删除角色 ${id} 失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
      throw new Fail(`删除角色 ${id} 失败`);
    }
    summary.writes++;
    summary.deleted.agents.push(id);
    emit(`  [删除] 完成：角色 ${id}`);
  }
  // 同名但 id 不同：默认不删
  const wantedNames = new Map();
  for (const id of roleIds) { const n = nameById.get(id); if (n) wantedNames.set(n, id); }
  for (const a of agents) {
    if (!a || typeof a.name !== 'string' || a.name === '') continue;
    const wantedId = wantedNames.get(a.name);
    if (wantedId === undefined || a.id === wantedId) continue;
    const w = `目标上存在同名角色「${a.name}」(id=${a.id})，其 id 不在本包清单里（本包固定 id 是 ${wantedId}）：默认不删除，避免误删别人的东西。确认要删请手工执行 DELETE ${api(opts.endpoint, '/agent')}?id=${encodeURIComponent(a.id)}`;
    emit(`  [告警] ${w}`); summary.warnings.push(w);
  }

  // ---- 删除工作流
  emit('[3/4] 删除工作流');
  if (!workflows.some((w) => w && w.id === workflowId)) {
    emit(`  [跳过] 不存在，跳过：工作流 ${workflowId}`);
    summary.skipped.workflows.push(workflowId);
  } else {
    emit(`  [删除] 目标：DELETE ${api(opts.endpoint, '/workflow')}?id=${encodeURIComponent(workflowId)}（宿主 storages/team_workflows.json，记录 id=${workflowId}）`);
    if (opts.dryRun) {
      emit(`  [跳过] --dry-run：不删除（本应删除工作流 ${workflowId}）`);
      summary.skipped.workflows.push(workflowId);
    } else {
      const res = await request('DELETE', api(opts.endpoint, '/workflow?id=' + encodeURIComponent(workflowId)), { timeoutMs: 15000 });
      if (!res.ok || !res.json || res.json.ok !== true) {
        emit(`  [错误] 删除工作流 ${workflowId} 失败：HTTP ${res.status} ${res.text.slice(0, 300)}`);
        throw new Fail(`删除工作流 ${workflowId} 失败`);
      }
      summary.writes++;
      summary.deleted.workflows.push(workflowId);
      emit(`  [删除] 完成：工作流 ${workflowId}`);
    }
  }

  // ---- 删除技能
  emit('[4/4] 技能目录');
  if (opts.keepSkill) {
    emit(`  [跳过] 已指定 --keep-skill：保留技能 ${skillName}`);
    summary.skipped.skills.push(skillName);
  } else {
    let removedAny = false;
    for (const r of skillRootCandidates(opts.profile)) {
      const dirTarget = join(r.path, skillName);
      const fileTarget = join(r.path, skillName + '.md');
      const hasDir = existsSync(dirTarget) && statSync(dirTarget).isDirectory();
      const hasFile = existsSync(fileTarget);
      if (!hasDir && !hasFile) {
        emit(`  [跳过] 不存在，跳过：技能 ${skillName}（${r.path}）`);
        continue;
      }
      for (const t of [hasDir ? dirTarget : null, hasFile ? fileTarget : null]) {
        if (t === null) continue;
        removedAny = true;
        emit(`  [删除] 目标：${t}${hasDir && t === dirTarget ? '（整个目录）' : ''}（${r.why}）`);
        if (opts.dryRun) {
          emit(`  [跳过] --dry-run：不删除（本应删除 ${t}）`);
          continue;
        }
        try { rmSync(t, { recursive: true, force: true }); }
        catch (e) {
          emit(`  [错误] 删除 ${t} 失败：${e && e.message ? e.message : e}`);
          throw new Fail(`删除技能 ${t} 失败`);
        }
        summary.writes++;
        summary.deleted.skills.push(t);
        emit(`  [删除] 完成：${t}`);
      }
    }
    if (!removedAny) summary.skipped.skills.push(skillName);
  }

  // ---- 收尾
  emit('');
  emit('是否需要重启 dsh：不需要。角色与工作流的删除是通过 HTTP 作用在运行中进程的注册表上，立即生效；技能目录的增删由技能目录在读取时被发现。');
  const d = summary.deleted;
  emit(`${opts.dryRun ? '--dry-run 完成（未删除任何东西）' : '卸载完成'}：角色 ${d.agents.length} 个、工作流 ${d.workflows.length} 个、技能 ${d.skills.length} 处；跳过（不存在/保留）角色 ${summary.skipped.agents.length} 个、工作流 ${summary.skipped.workflows.length} 个、技能 ${summary.skipped.skills.length} 处；告警 ${summary.warnings.length} 条；退出码 0`);
  if (summary.warnings.length > 0) {
    emit(`本次共有 ${summary.warnings.length} 条告警：`);
    for (const w of summary.warnings) emit(`  [告警] ${w}`);
  }
  summary.exitCode = EXIT_OK;
  return EXIT_OK;
}

let exitCode = EXIT_OK;
try {
  exitCode = await main();
} catch (e) {
  exitCode = e instanceof Fail ? e.exitCode : EXIT_FAIL;
  if (e instanceof Fail) emit(`[错误] ${e.message}（退出码 ${exitCode}）`);
  else emit(`[错误] 未预期的异常：${e && e.stack ? e.stack : String(e)}`);
  if (SUMMARY) { SUMMARY.exitCode = exitCode; SUMMARY.error = e && e.message ? e.message : String(e); }
}
if (JSON_MODE) {
  process.stdout.write(JSON.stringify(Object.assign({ ok: exitCode === EXIT_OK, exitCode }, SUMMARY || {}), null, 2) + '\n');
}
process.exitCode = exitCode;
