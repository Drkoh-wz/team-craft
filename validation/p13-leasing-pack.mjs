// P13-E: 移植包（specializations/leasing-risk）的仓库级测试。
//
// 覆盖 P13-PLAN.md 第 4.2 节的每一条，并且**不碰真实 profile、不改 install.mjs**：
//
//   A  前置校验失败路径（7 条）+ 一条正向对照
//      每条都断言「退出码 1 + 磁盘快照逐字节不变」；构造方式是在**系统临时目录**
//      里对移植包副本做变异，绝不动仓库里的包。
//      A1 缺文件 / A2 有 {{ / A3 DAG 有环 / A4 agent 解析不到 / A5 reviewer 解析不到 /
//      A6 workflow 超 65536 / A8 悬空 dependsOn。A7 是正向对照。
//      注意 A8：它有**独立**于环检测的一条精确报错，必须断言文案才能钉住 —— 见 A8 处注释。
//   B  安装幂等（临时 DSH_HOME + 临时 profile 副本 + 自己写的桩 HTTP 端点）
//      连续两次 install：第二次全部跳过、角色按固定 id upsert（不产生重名两份）、
//      工作流唯一、技能只装一份；再用 --check 验证「已装 -> 0 / 未装 -> 3」。
//   C  模型意图解析：给定 4 套不同的 provider 集合断言解析结果；
//      解析不到时不写 model 字段且告警非空；一律不写 reasoningEffort。
//   D  PROVENANCE：篡改一个 prompt 字节 -> selftest 变红；恢复后变绿。
//      另外两条离线自检的「非空转」对照：清单漏记文件、workflow 超 65536。
//   E  变异测试：4 个变异（删 DAG 环检测 / 删 haltOnFailure 往返校验 /
//      让 install 第二次不跳过 / 删悬空 dependsOn 检查），每个都真的让对应检查由绿变红，
//      然后恢复。M4 的红只落在断言文案的两条上（原因见 M4 处注释）。
//   F  守卫：真实 profile 与真实 DSH_HOME 未被触碰、install.mjs 未被修改、
//      变异体只存在于系统临时目录。
//
// 用法：
//   node validation/p13-leasing-pack.mjs
//   node validation/p13-leasing-pack.mjs --only=A,B      # 只跑某些组
//   P13_PACK_SKIP_MUTATIONS=1 node validation/p13-leasing-pack.mjs
//   P13_PACK_TEST_PACK_SRC=<dir> P13_PACK_TEST_INSTALL_SRC=<file> node validation/p13-leasing-pack.mjs
//       （子进程/变异模式：被测对象不是仓库里的那份，见第 E 组）
//
// 退出码：0 = 全部检查通过；1 = 至少一项失败；2 = 连被测文件都找不到。
//
// 每条检查的标签里都写明「怎么让它变红」；第 E 组真的把四个变异跑起来并打印红输出。

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const PACK_SRC = process.env.P13_PACK_TEST_PACK_SRC && process.env.P13_PACK_TEST_PACK_SRC.trim() !== ''
  ? resolve(process.env.P13_PACK_TEST_PACK_SRC.trim())
  : join(REPO, 'specializations/leasing-risk');
const INSTALL_SRC = process.env.P13_PACK_TEST_INSTALL_SRC && process.env.P13_PACK_TEST_INSTALL_SRC.trim() !== ''
  ? resolve(process.env.P13_PACK_TEST_INSTALL_SRC.trim())
  : join(PACK_SRC, 'install.mjs');
const SELFTEST_SRC = join(PACK_SRC, 'selftest.mjs');
const REPO_SELFTEST = join(REPO, 'specializations/leasing-risk/selftest.mjs');
const REPO_INSTALL = join(REPO, 'specializations/leasing-risk/install.mjs');

const CHILD_MODE = Boolean(process.env.P13_PACK_TEST_PACK_SRC || process.env.P13_PACK_TEST_INSTALL_SRC);
const SKIP_MUTATIONS = process.env.P13_PACK_SKIP_MUTATIONS === '1';

const onlyArg = process.argv.slice(2).find((a) => a.startsWith('--only='));
const ONLY = onlyArg === undefined
  ? null
  : onlyArg.slice('--only='.length).split(',').map((s) => s.trim().toUpperCase()).filter((s) => s !== '');
const wants = (group) => ONLY === null || ONLY.includes(group);

// ---------------------------------------------------------------- 检查框架

let checks = 0;
let failures = 0;
const failedLabels = [];

function check(label, ok, detail) {
  checks += 1;
  if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true; }
  failures += 1;
  failedLabels.push(label);
  console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''));
  return false;
}
function blockFailure(label, e) {
  check(label + ' -- 整块检查（该场景抛出或超时则整块判负）', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
}
function summary() {
  console.log('\n=== SUMMARY ===');
  console.log('checks=' + checks + '  failures=' + failures);
  console.log('移植包 : ' + PACK_SRC);
  console.log('安装器 : ' + INSTALL_SRC);
  console.log('模式   : ' + (CHILD_MODE ? '变异/子进程模式（被测对象不是仓库里的那份）' : '仓库'));
  if (failedLabels.length > 0) {
    console.log('failed checks:');
    for (const l of failedLabels) console.log('  - ' + l);
  }
  console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  return failures;
}
process.on('uncaughtException', (e) => {
  blockFailure('未捕获异常：本次运行在此中断，后续检查未执行', e);
  summary();
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  blockFailure('未处理的 Promise 拒绝：本次运行在此中断，后续检查未执行', e);
  summary();
  process.exit(1);
});

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256Buf = (b) => createHash('sha256').update(b).digest('hex');
const readText = (p) => {
  const t = readFileSync(p, 'utf8');
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
};
const readJson = (p) => JSON.parse(readText(p));
const hashOfFile = (p) => {
  try { return sha256Buf(readFileSync(p)); } catch (e) { return 'UNREADABLE:' + String(e && e.message ? e.message : e); }
};

/** 一个目录的完整快照（相对路径 -> sha256），用于断言「什么都没写」。 */
function snapshotDir(root) {
  const out = {};
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile()) out[r] = hashOfFile(abs);
    }
  };
  walk(root, '');
  return out;
}
const diffSnapshot = (a, b) => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.filter((k) => a[k] !== b[k]).map((k) => k + (a[k] === undefined ? '(新增)' : b[k] === undefined ? '(删除)' : '(改动)'));
};

console.log('\n=== P13-E 移植包测试（validation/p13-leasing-pack.mjs） ===');
console.log('仓库根 : ' + REPO);
console.log('移植包 : ' + PACK_SRC);
console.log('安装器 : ' + INSTALL_SRC);
console.log('模式   : ' + (CHILD_MODE ? '变异/子进程模式' : '仓库'));
console.log('组     : ' + (ONLY === null ? 'A B C D E F' : ONLY.join(',')) + (SKIP_MUTATIONS ? '（E 组变异已跳过）' : ''));

if (!existsSync(INSTALL_SRC)) {
  console.log('FATAL：找不到被测安装器 ' + INSTALL_SRC);
  process.exit(2);
}
if (!existsSync(SELFTEST_SRC)) {
  console.log('FATAL：找不到被测随包自检 ' + SELFTEST_SRC + '（P13-E 的产物之一；缺失时无法验证 PROVENANCE 与离线自检）');
  process.exit(2);
}

// ---------------------------------------------------------------- 子进程工具

/**
 * 跑一个 node 脚本，返回 { code, stdout, stderr }。
 *
 * 这里**必须**用异步的 spawn 而不是 execFileSync：本套件自己就是一个桩 HTTP
 * 端点（第 A/B/C 组用 makeStubEndpoint 起了一个 node:http server），而被测的
 * install.mjs 要**连回那个端点**。execFileSync 会阻塞事件循环 —— 子进程连上来时
 * 父进程根本没法 accept，结果就是子进程报"运行时不可达"、而父进程的服务器从没
 * 收到过请求（实测：probe=200 但 popen 出去的 install 得到 ECONNREFUSED 行为）。
 * 用 spawn + await 让事件循环保持可服务状态。
 */
function runNode(script, args, opts) {
  const o = opts || {};
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script, ...(args || [])], {
      cwd: o.cwd || dirname(script),
      env: { ...process.env, ...(o.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, o.timeoutMs || 180000);
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, stdout, stderr: stderr + String(e && e.message), signal: null });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        code: timedOut ? -1 : (code === null ? -1 : code),
        stdout,
        stderr,
        signal: signal || null,
        timedOut,
      });
    });
  });
}
const bothText = (res) => res.stdout + '\n' + res.stderr;
const reportOf = (res) => {
  const at = res.stdout.indexOf('{');
  if (at === -1) return null;
  try { return JSON.parse(res.stdout.slice(at)); } catch { return null; }
};
const statsOf = (stdout) => {
  const m = /checks=(\d+)\s+failures=(\d+)/.exec(stdout);
  return m === null ? null : { checks: Number(m[1]), failures: Number(m[2]) };
};
// selftest.mjs 的 SUMMARY 用中文标签（"失败的检查："），p12/p13-halt 用英文
// （"failed checks:"）—— 两种都要认，否则断言永远拿到空数组、"红在哪"就查不出来。
const failedLabelsOf = (stdout) => {
  const en = stdout.indexOf('failed checks:');
  const zh = stdout.indexOf('失败的检查：');
  const at = zh !== -1 && (en === -1 || zh < en) ? zh : en;
  if (at === -1) return [];
  const rest = stdout.slice(at).split('\n').slice(1);
  const out = [];
  for (const l of rest) {
    if (/^\s{2}-\s/.test(l)) { out.push(l.replace(/^\s*-\s*/, '').trim()); continue; }
    if (out.length > 0) break; // 列表结束（或换成别的段落）
  }
  return out;
};

// ---------------------------------------------------------------- 桩 HTTP 端点

/**
 * team-flowise 的桩端点。只需要安装器实际用到的那几条路由，语义按 P13-PLAN 1.2：
 *  * POST /agent 与 POST /workflow 接受显式 id，返回 {ok,agent|workflow:{id,updatedAt}}
 *  * 每条记录的 updatedAt 都会变 -> 用它判定"到底有没有写"
 *  * 请求体超过 65536 字节直接 {ok:false,error:'bad body'}（宿主 readJsonBody 的上限）
 *  * 只监听 127.0.0.1（写接口要求 loopback）
 */
function makeStubEndpoint(opts) {
  const catalog = opts.catalog;
  const seed = opts.seed || {};
  const seedAgents = Array.isArray(seed.agents) ? seed.agents : [];
  const seedWorkflows = Array.isArray(seed.workflows) ? seed.workflows : [];
  /** true = 模拟"旧版本 upsertWorkflow 会丢弃 haltOnFailure"的缺陷类（declared-but-unstored）。 */
  const dropHaltOnFailure = opts.dropHaltOnFailure === true;
  const state = {
    agents: new Map(seedAgents.map((a) => [a.id, a])),
    workflows: new Map(seedWorkflows.map((w) => [w.id, w])),
    requests: [],
    posts: [],
    writes: 0,
    clock: 1700000000000,
  };
  const stamp = () => { state.clock += 1000; return state.clock; };
  const send = (res, status, obj) => {
    const text = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };
  const readBody = (req) => new Promise((resolvePromise) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      // P13-PLAN 1.2：readJsonBody(req, maxBytes=65536)
      if (raw.length > 65536) return resolvePromise({ tooLarge: true, raw });
      try { return resolvePromise({ body: JSON.parse(raw.toString('utf8')), raw }); } catch { return resolvePromise({ badJson: true, raw }); }
    });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;
    state.requests.push(req.method + ' ' + path + (url.search || ''));

    if (path === '/api/team-flowise/ping') return send(res, 200, { ok: true, pong: true, domains: ['team_agent_defs', 'team_workflows'] });
    if (path === '/api/team-flowise/models') return send(res, 200, { ok: true, providers: catalog.providers, errors: catalog.errors || [] });
    if (path === '/api/team-flowise/agents' && req.method === 'GET') return send(res, 200, { ok: true, agents: [...state.agents.values()] });
    if (path === '/api/team-flowise/workflows' && req.method === 'GET') return send(res, 200, { ok: true, workflows: [...state.workflows.values()] });
    if (path === '/api/team-flowise/agent' && req.method === 'POST') {
      const r = await readBody(req);
      if (r.tooLarge) { state.writes += 1; return send(res, 200, { ok: false, error: 'bad body' }); }
      if (r.badJson) { state.writes += 1; return send(res, 200, { ok: false, error: 'bad body' }); }
      const b = r.body || {};
      if (typeof b.id !== 'string' || b.id === '') return send(res, 400, { ok: false, error: 'agent id required' });
      state.posts.push({ kind: 'agent', body: b, bodyBytes: r.raw.length, at: stamp() });
      state.writes += 1;
      state.agents.set(b.id, { ...b, updatedAt: state.clock });
      return send(res, 200, { ok: true, agent: state.agents.get(b.id) });
    }
    if (path === '/api/team-flowise/workflow' && req.method === 'POST') {
      const r = await readBody(req);
      if (r.tooLarge) { state.writes += 1; return send(res, 200, { ok: false, error: 'bad body' }); }
      const b = r.body || {};
      if (typeof b.id !== 'string' || b.id === '') return send(res, 400, { ok: false, error: 'workflow id required' });
      state.posts.push({ kind: 'workflow', body: b, bodyBytes: r.raw.length, at: stamp() });
      state.writes += 1;
      const stored = { ...b, updatedAt: state.clock };
      if (dropHaltOnFailure) delete stored.haltOnFailure; // 旧版本：写入成功但字段没存住
      state.workflows.set(b.id, stored);
      return send(res, 200, { ok: true, workflow: state.workflows.get(b.id) });
    }
    return send(res, 404, { ok: false, error: 'no such route: ' + path });
  });

  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolvePromise({
        state,
        endpoint: 'http://127.0.0.1:' + port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const CATALOGS = {
  // 本机 P13-PLAN 1.1 的实测目录（efforts：deepseek-official 有，其它为空）
  live: {
    providers: [
      { id: 'deepseek-official', label: 'DeepSeek 官方', models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] },
      { id: 'amd', label: 'amd', models: [{ id: 'DeepSeek-V4.1-Flash' }, { id: 'Qwen3.8-Flash-Next' }] },
      { id: 'kuafu', label: 'kuafu', models: [{ id: 'deepseek-v4.1-flash' }] },
      { id: 'hub16', label: 'hub16', models: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-terra' }, { id: 'gpt-6-astra' }] },
    ],
  },
  // 只有 deepseek-official 一个提供方，且只有 deepseek-v4-pro 这一个模型
  officialProOnly: {
    providers: [{ id: 'deepseek-official', label: 'DeepSeek 官方', models: [{ id: 'deepseek-v4-pro' }] }],
  },
  // 一个意图都解析不到
  empty: { providers: [] },
  // 用户原始需求里点名的三个模型所在的提供方（验证 prefer 的"第二/第三选择"仍然有效）
  userNamed: {
    providers: [
      { id: 'amd', label: 'amd', models: [{ id: 'DeepSeek-V4.1-Flash' }] },
      { id: 'hub16', label: 'hub16', models: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-6-astra' }] },
    ],
  },
};

const TEMP_ROOT = join(tmpdir(), 'p13e-pack-' + randomUUID());
/** 把移植包复制到临时目录（绝不改仓库里的包）。extra 里的名字会被排除。 */
function copyPack(destName, mutate) {
  const dest = join(TEMP_ROOT, destName);
  mkdirSync(TEMP_ROOT, { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(PACK_SRC, dest, { recursive: true });
  if (mutate) mutate(dest);
  return dest;
}

// 真实 profile / 真实 DSH_HOME 的哈希守卫（F 组判定，这里先取基线）
const REAL_PROFILE = join(process.env.USERPROFILE || homedir(), '.dsh', 'profiles', 'web');
const REAL_DSH_HOME = join(process.env.USERPROFILE || homedir(), '.dsh');
const realProfileBefore = {
  pkg: hashOfFile(join(REAL_PROFILE, 'package.json')),
  patch: hashOfFile(join(REAL_PROFILE, 'cordis.patch.yml')),
  settings: hashOfFile(join(REAL_DSH_HOME, 'settings.yaml')),
  skills: snapshotDir(join(REAL_DSH_HOME, 'skills')),
};
const installSrcHashBefore = hashOfFile(REPO_INSTALL);
const selftestHashBefore = hashOfFile(REPO_SELFTEST);

// ===========================================================================
if (wants('A')) {
  console.log('\n--- GROUP A: 前置校验失败路径（每条都断言「退出码 1 且未写入」） ---');
  // ===========================================================================
  // 每条场景：在系统临时目录里复制一份包 -> 做一处变异 -> 用一份**独立的临时
  // DSH_HOME + 临时 profile** 跑 install.mjs（带一个桩端点，确保"没到写入"不是
  // 因为端点不可达），然后断言：
  //   (1) 退出码 === 1（前置校验失败，不是 2/3/0）
  //   (2) 输出里点名了正确的原因
  //   (3) 磁盘快照逐字节不变、桩端点一次 POST 都没收到
  // 让它变红的方式：把 install.mjs 里对应的校验删掉 —— 该场景会变成 exit 0 并写入。
  const scenarios = [
    {
      id: 'A1',
      what: '缺文件（删掉 pack.json）',
      mutate: (dir) => rmSync(join(dir, 'pack.json')),
      expect: /缺少必需文件|不是合法 JSON/,
      redBy: '把 precheck() 里的 readJsonFile(paths.pack) 改成容错跳过',
    },
    {
      id: 'A2',
      what: 'prompts/ 里塞进 "{{"',
      mutate: (dir) => {
        const p = join(dir, 'prompts', '01-coordinator.md');
        writeFileSync(p, readText(p) + '\n{{ leaked_interpolation }}\n', 'utf8');
      },
      expect: /出现了 "\{\{"|"\{\{"（运行时会被改写/,
      redBy: '删掉 precheck() 里的 braceHits 检查',
    },
    {
      id: 'A3',
      what: 'DAG 造环（coord-open <-> feedback 互相依赖）',
      mutate: (dir) => {
        const p = join(dir, 'workflow.json');
        const doc = readJson(p);
        doc.nodes['coord-open'].dependsOn = ['feedback'];
        writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      },
      expect: /DAG 存在环/,
      redBy: '删掉 precheck() 尾部的 Kahn 环检测（if (seen !== nodeIds.length) throw ...）',
    },
    {
      id: 'A4',
      what: 'agent 解析不到（把 coord-open 的 agent 改成不存在的角色）',
      mutate: (dir) => {
        const p = join(dir, 'workflow.json');
        const doc = readJson(p);
        doc.nodes['coord-open'].agent = 'no-such-role-xyz';
        writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      },
      expect: /无法解析到 roles\.json 里的角色/,
      redBy: '删掉 resolveRole(node.agent) 的断言',
    },
    {
      id: 'A5',
      what: 'reviewer 解析不到（把 coord-open 的 reviewer 改成不存在的角色）',
      mutate: (dir) => {
        const p = join(dir, 'workflow.json');
        const doc = readJson(p);
        doc.nodes['coord-open'].reviewer = 'no-such-reviewer-xyz';
        writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      },
      expect: /reviewer "no-such-reviewer-xyz" 无法解析到 roles\.json 里的角色/,
      redBy: '删掉 resolveRole(node.reviewer) 的断言',
    },
    {
      id: 'A6',
      what: 'workflow.json 超 65536 字节（description 填 70000 个 x）',
      mutate: (dir) => {
        const p = join(dir, 'workflow.json');
        const doc = readJson(p);
        doc.description = 'PAD'.repeat(17500); // 70000 字节
        writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      },
      expect: /必须 > 0 且 < 65536/,
      redBy: '删掉 precheck() 里的 wfBytes 上限检查',
    },
    {
      // A8 —— 造悬空依赖（P13-PLAN 3.2 第 1 条的「无悬空 dependsOn」）。
      //
      // 这一条与被点名的其它几条不同：install.mjs:346 抛出的精确报错是**独立**的，
      // 但它同时被 Kahn 环检测兜住（悬空依赖的入度永远不会被减到 0）。实测（系统临时目录探针）：
      //   未变异 + nodes['coord-open'].dependsOn=['no-such-node-xyz']
      //       -> exit 1，「节点 coord-open 的 dependsOn 里有悬空依赖：no-such-node-xyz」
      //   把 :346 的 throw 改成 no-op 后同一夹具
      //       -> 仍然 exit 1，但报的是「DAG 存在环，涉及节点：coord-open -> intake -> ... -> feedback」
      // 因此「非零退出 + 未写入」这两条**不足以**钉住这条校验：删掉 :346 后它们照样通过。
      // 唯一能区分两者的判据是**错误文案**，所以 A8.2 断言输出里出现「悬空依赖」并点名那个
      // 不存在的节点 id。让 A8 变红的方式：删掉 install.mjs:346 的 throw（见 E 组 M4）。
      id: 'A8',
      what: '造悬空依赖（coord-open 的 dependsOn 指向不存在的节点 no-such-node-xyz）',
      mutate: (dir) => {
        const p = join(dir, 'workflow.json');
        const doc = readJson(p);
        doc.nodes['coord-open'].dependsOn = ['no-such-node-xyz'];
        writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      },
      expect: /dependsOn 里有悬空依赖/,
      redBy: '删掉 install.mjs:346 的 `if (!hasOwnProperty(wfDoc.nodes, dep)) throw new Fail(...悬空依赖...)`'
        + ' —— 此后 Kahn 环检测仍会 exit 1（报「DAG 存在环」），所以只有断言文案的检查会变红（见 E 组 M4）',
      // 本场景由下面的专用块执行（额外多一条"与 A3 的环报错可区分"），这里不再走通用循环。
      dedicated: true,
    },
  ];

  const stub = await makeStubEndpoint({ catalog: CATALOGS.live });

  for (const sc of scenarios) {
    if (sc.dedicated === true) continue;
    try {
      const packCopy = copyPack(sc.id, sc.mutate);
      const scratch = join(TEMP_ROOT, sc.id + '-scratch');
      const dshHome = join(scratch, 'dsh-home');
      const profile = join(scratch, 'profile');
      mkdirSync(dshHome, { recursive: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'p13e-' + sc.id, private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
      writeFileSync(join(profile, 'cordis.yml'), '[]\n', 'utf8');
      writeFileSync(join(profile, 'cordis.patch.yml'), '# p13e fixture\n[]\n', 'utf8');

      const homeBefore = snapshotDir(dshHome);
      const profileBefore = snapshotDir(profile);
      const postsBefore = stub.state.posts.length;

      const res = await runNode(join(packCopy, 'install.mjs'), [
        '--profile', profile, '--endpoint', stub.endpoint, '--json',
      ], { env: { DSH_HOME: dshHome } });

      const homeAfter = snapshotDir(dshHome);
      const profileAfter = snapshotDir(profile);
      const said = bothText(res);

      console.log(`  · ${sc.id} ${sc.what}  ->  exit=${res.code}`);
      const hit = sc.expect.test(said);
      const line = said.split('\n').find((l) => sc.expect.test(l)) || '';
      check(`${sc.id}.1 [${sc.what}] 退出码 = 1（前置校验失败，不是 0/2/3）`, res.code === 1, 'exit=' + String(res.code) + ' | ' + said.trim().split('\n').slice(-2).join(' | ').slice(0, 200));
      check(`${sc.id}.2 [${sc.what}] 错误输出点名了正确的原因（${sc.expect}）`, hit, hit ? line.trim().slice(0, 160) : '没有匹配到；输出尾部：' + said.trim().split('\n').slice(-4).join(' | ').slice(0, 320));
      check(`${sc.id}.3 [${sc.what}] 未写入：临时 DSH_HOME 与临时 profile 的快照逐字节不变（${Object.keys(homeBefore).length} 个文件）`,
        eq(homeAfter, homeBefore) && eq(profileAfter, profileBefore),
        'home 差异=' + JSON.stringify(diffSnapshot(homeBefore, homeAfter)) + ' profile 差异=' + JSON.stringify(diffSnapshot(profileBefore, profileAfter)));
      check(`${sc.id}.4 [${sc.what}] 未写入：桩端点一次 POST 都没收到（前置校验失败发生在第 2 步探测之前）`,
        stub.state.posts.length === postsBefore, 'posts=' + String(stub.state.posts.length - postsBefore) + ' requests=' + JSON.stringify(stub.state.requests.slice(-3)));
      check(`${sc.id}.5 [${sc.what}] 变红方式已写明（${sc.redBy}）`, true, '');
    } catch (e) { blockFailure('A ' + sc.id + ' ' + sc.what, e); }
  }

  // ---- A8：造悬空依赖（P13-PLAN 3.2 第 1 条的「无悬空 dependsOn」）。
  // 构造与理由见上面 scenarios 里 A8 的注释；本块比通用循环多两条检查：
  // 一条"与 A3 的环报错可区分"，一条把"为什么必须断言文案"写成可见的检查记录。
  try {
    const sc = scenarios.find((s) => s.id === 'A8');
    if (sc === undefined) throw new Error('scenarios 里没有 A8（本块与场景表脱节了）');
    const packCopyA8 = copyPack('A8', sc.mutate);
    const scratchA8 = join(TEMP_ROOT, 'A8-scratch');
    const dshHomeA8 = join(scratchA8, 'dsh-home');
    const profileA8 = join(scratchA8, 'profile');
    mkdirSync(dshHomeA8, { recursive: true });
    mkdirSync(profileA8, { recursive: true });
    writeFileSync(join(profileA8, 'package.json'), JSON.stringify({ name: 'p13e-A8', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
    writeFileSync(join(profileA8, 'cordis.yml'), '[]\n', 'utf8');
    writeFileSync(join(profileA8, 'cordis.patch.yml'), '# p13e fixture\n[]\n', 'utf8');

    const homeBeforeA8 = snapshotDir(dshHomeA8);
    const profileBeforeA8 = snapshotDir(profileA8);
    const postsBeforeA8 = stub.state.posts.length;

    const resA8 = await runNode(join(packCopyA8, 'install.mjs'), [
      '--profile', profileA8, '--endpoint', stub.endpoint, '--json',
    ], { env: { DSH_HOME: dshHomeA8 } });
    const saidA8 = bothText(resA8);

    console.log(`  · ${sc.id} ${sc.what}  ->  exit=${resA8.code}`);
    check(`${sc.id}.1 [${sc.what}] 退出码 = 1（前置校验失败，不是 0/2/3）`,
      resA8.code === 1,
      'exit=' + String(resA8.code) + ' | ' + saidA8.trim().split('\n').slice(-2).join(' | ').slice(0, 240));
    // 主检查（也是 M4 唯一能让本组变红的地方）：只有文案能区分"悬空检查还在"与
    // "悬空检查被删、改由环检测兜住"。
    check(`${sc.id}.2 [${sc.what}] 错误输出含「dependsOn 里有悬空依赖」并点名 no-such-node-xyz`
      + '（而不是笼统的「DAG 存在环」；删掉 install.mjs:346 的 throw 后环检测仍会 exit 1，只有本项会变红）',
      /dependsOn 里有悬空依赖/.test(saidA8) && saidA8.includes('no-such-node-xyz'),
      '命中文案=' + ((saidA8.split('\n').find((l) => l.includes('悬空依赖')) || '(没有「悬空依赖」字样)').trim().slice(0, 200)));
    check(`${sc.id}.3 [${sc.what}] 报错点名了正确的节点（coord-open），且不是 A3 那条「DAG 存在环」`,
      saidA8.includes('coord-open') && /DAG 存在环/.test(saidA8) === false,
      (saidA8.split('\n').find((l) => l.includes('悬空依赖')) || '').trim().slice(0, 200));
    check(`${sc.id}.4 [${sc.what}] 未写入：临时 DSH_HOME 与临时 profile 的快照逐字节不变，且桩端点 0 次 POST`,
      eq(snapshotDir(dshHomeA8), homeBeforeA8) && eq(snapshotDir(profileA8), profileBeforeA8)
      && stub.state.posts.length === postsBeforeA8,
      'home 差异=' + JSON.stringify(diffSnapshot(homeBeforeA8, snapshotDir(dshHomeA8)))
      + ' profile 差异=' + JSON.stringify(diffSnapshot(profileBeforeA8, snapshotDir(profileA8)))
      + ' 新增 POST=' + String(stub.state.posts.length - postsBeforeA8));
    check(`${sc.id}.5 [${sc.what}] 变红方式已写明（${sc.redBy}）`, true, '');
    // 这一条是本组的存在理由：把「未写入」当判据是不够的，得如实说出来。
    // 它和 A8.2/A8.3 一样依赖"输出里有悬空依赖字样"，因此 M4 下也会一起红（已计进 M4 的靶点）。
    check(`${sc.id}.6 [${sc.what}] 反证已实测记录：删掉 install.mjs:346 的 throw 后 exit 仍是 1`
      + '（Kahn 环检测兜住），所以「非零退出 + 未写入」钉不住这条校验，必须断言文案',
      /dependsOn 里有悬空依赖/.test(saidA8) && resA8.code === 1,
      '本场景 exit=' + String(resA8.code) + ' 且命中文案；M4 变异体上 A8.1/A8.4 仍绿、只有断言文案的 A8.2/A8.3/A8.6 红（见 E 组 M4）');
  } catch (e) { blockFailure('A8 造悬空依赖', e); }

  // ---- 正向对照：干净副本必须真的能装上。没有这一条，上面 7 条可能只是"安装器什么都做不了"赚来的假绿。
  try {
    const clean = copyPack('A7-clean');
    const scratch = join(TEMP_ROOT, 'A7-scratch');
    const dshHome = join(scratch, 'dsh-home');
    const profile = join(scratch, 'profile');
    mkdirSync(dshHome, { recursive: true });
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'p13e-A7', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
    writeFileSync(join(profile, 'cordis.yml'), '[]\n', 'utf8');
    writeFileSync(join(profile, 'cordis.patch.yml'), '# p13e fixture\n[]\n', 'utf8');
    const res = await runNode(join(clean, 'install.mjs'), ['--profile', profile, '--endpoint', stub.endpoint, '--json'], { env: { DSH_HOME: dshHome } });
    const rep = reportOf(res);
    check('A7.1 [正向对照] 同一套夹具下、未做任何变异的包副本 -> exit 0（证明 A1..A6 的红来自变异而不是夹具本身坏掉）',
      res.code === 0, 'exit=' + String(res.code) + ' | ' + bothText(res).trim().split('\n').slice(-2).join(' | ').slice(0, 200));
    check('A7.2 [正向对照] 干净副本确实写了盘：10 个角色 + 1 条工作流 + 1 个技能 = 12 次写入',
      rep !== null && rep.writes === 12, JSON.stringify(rep && { writes: rep.writes, exitCode: rep.exitCode }));
    check('A7.3 [正向对照] 桩端点收到 11 次 POST（10 角色 + 1 工作流），且技能文件真的落在临时 DSH_HOME 下',
      stub.state.posts.length >= 11 && existsSync(join(dshHome, 'skills', 'leasing-risk-assessment', 'SKILL.md')),
      'posts=' + String(stub.state.posts.length) + ' skill=' + String(existsSync(join(dshHome, 'skills', 'leasing-risk-assessment', 'SKILL.md'))));
    check('A7.4 [正向对照] 该次运行的段快照确实变了（证明 A1..A6 的"快照不变"不是"快照功能本身坏了"）',
      !eq(snapshotDir(dshHome), {}), JSON.stringify(Object.keys(snapshotDir(dshHome)).slice(0, 6)));
  } catch (e) { blockFailure('A7 正向对照', e); }

  await stub.close();
}

// ===========================================================================
if (wants('B')) {
  console.log('\n--- GROUP B: 安装幂等（临时 DSH_HOME + 临时 profile 副本 + 桩端点） ---');
  // ===========================================================================
  // 照 p12-usability.mjs 的 D 组写法：每一跑都在临时目录里，"幂等"的判据是
  // 桩端点收到的 updatedAt 是否变化 + 磁盘快照是否逐字节相同，
  // 而不是只看安装器自己打印的"跳过"。
  try {
    const packJson = readJson(join(PACK_SRC, 'pack.json'));
    const targetIds = packJson.targets.roleIds.slice();
    const workflowId = packJson.targets.workflowId;
    const skillName = packJson.targets.skillName;

    const scratch = join(TEMP_ROOT, 'B-scratch');
    const dshHome = join(scratch, 'dsh-home');
    const profile = join(scratch, 'profile');
    mkdirSync(dshHome, { recursive: true });
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'p13e-profile-fixture', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }, null, 2) + '\n', 'utf8');
    writeFileSync(join(profile, 'cordis.yml'), '[]\n', 'utf8');
    writeFileSync(join(profile, 'cordis.patch.yml'), '# p13e B 组夹具\n[]\n', 'utf8');
    // 预置一个"同名但 id 不同"的角色：安装器必须用已有 id 去改，而不是再建一份重名的。
    const seedAgent = { id: 'pre-existing-coordinator-id', name: '调度协调员', role: '别的团队的调度者', systemPrompt: 'x', model: { provider: 'seed', model: 'seed' }, updatedAt: 1 };
    const stub = await makeStubEndpoint({ catalog: CATALOGS.live, seed: { agents: [seedAgent] } });

    const args = ['--profile', profile, '--endpoint', stub.endpoint, '--json'];
    const env = { DSH_HOME: dshHome };

    const run1 = await runNode(INSTALL_SRC, args, { env });
    const rep1 = reportOf(run1);
    const afterFirst = {
      home: snapshotDir(dshHome),
      profile: snapshotDir(profile),
      posts: stub.state.posts.length,
      writes: stub.state.writes,
      agents: new Map(stub.state.agents),
      workflows: new Map(stub.state.workflows),
    };
    check('B1.1 [第一跑] exit 0 且 --json 报告可解析（ok/mode=install/writes 都在）',
      run1.code === 0 && rep1 !== null && rep1.ok === true && rep1.mode === 'install' && typeof rep1.writes === 'number',
      'exit=' + String(run1.code) + ' report=' + (rep1 === null ? '不可解析' : JSON.stringify({ ok: rep1.ok, mode: rep1.mode, writes: rep1.writes })) + ' | ' + bothText(run1).trim().split('\n').slice(-2).join(' | ').slice(0, 220));
    check('B1.2 [第一跑] 写入次数 = 12（10 角色 + 1 工作流 + 1 技能）',
      rep1 !== null && rep1.writes === 12, 'writes=' + String(rep1 && rep1.writes));
    check('B1.3 [第一跑] 桩端点上得到 10 个角色：9 个固定 id + 1 个"同名不同 id 的预置记录"被复用（按 P13-PLAN 3.2 第 4 条）',
      eq([...stub.state.agents.keys()].filter((id) => targetIds.includes(id)).sort(),
        [...targetIds].filter((id) => id !== 'lease-coordinator').sort()) &&
      stub.state.agents.has('pre-existing-coordinator-id'),
      'ids=' + [...stub.state.agents.keys()].join(','));
    check('B1.4 [第一跑] 同名不同 id 的预置角色被"用已有 id 改"（预置 id 上的 systemPrompt 已变成本包的人设；没有出现第二份重名角色）',
      stub.state.agents.size === 10 &&
      !stub.state.agents.has('lease-coordinator') &&
      stub.state.agents.get('pre-existing-coordinator-id').name === '调度协调员' &&
      (stub.state.agents.get('pre-existing-coordinator-id').systemPrompt || '').length > 500,
      JSON.stringify({ size: stub.state.agents.size, hasLeaseCoordinator: stub.state.agents.has('lease-coordinator'), promptLen: (stub.state.agents.get('pre-existing-coordinator-id').systemPrompt || '').length }));
    check('B1.5 [第一跑] 工作流只有一条且 id 正确',
      stub.state.workflows.size === 1 && stub.state.workflows.has(workflowId),
      'workflows=' + [...stub.state.workflows.keys()].join(','));
    check('B1.6 [第一跑] 技能只装了一份（<DSH_HOME>/skills/<skillName>/SKILL.md）',
      existsSync(join(dshHome, 'skills', skillName, 'SKILL.md')),
      join(dshHome, 'skills', skillName, 'SKILL.md'));
    check('B1.7 [第一跑] 没有出现"技能文件被写了两遍"的旁证：技能目录下恰好 1 个文件',
      (() => {
        const dir = join(dshHome, 'skills', skillName);
        if (!existsSync(dir)) return false;
        return readdirSync(dir).length === 1;
      })(), String(existsSync(join(dshHome, 'skills', skillName)) ? readdirSync(join(dshHome, 'skills', skillName)).join(',') : '目录不存在'));
    check('B1.8 [第一跑] 角色请求体只写 upsertAgent 真正支持的字段（id/name/role/systemPrompt/model/tools/timeoutMs 之一），没有写 schema 外的键',
      (() => {
        const allowed = new Set(['id', 'name', 'role', 'systemPrompt', 'model', 'skills', 'tools', 'permissionPolicy', 'timeoutMs']);
        const bad = stub.state.posts.filter((p) => p.kind === 'agent').flatMap((p) => Object.keys(p.body).filter((k) => !allowed.has(k)));
        return bad.length === 0;
      })(), JSON.stringify([...new Set(stub.state.posts.filter((p) => p.kind === 'agent').flatMap((p) => Object.keys(p.body)))]));
    check('B1.9 [第一跑] 没有任何角色的 model 里带 reasoningEffort（models.map.json 的策略是 never-declare）',
      stub.state.posts.filter((p) => p.kind === 'agent').every((p) => !p.body.model || !('reasoningEffort' in p.body.model)),
      JSON.stringify(stub.state.posts.filter((p) => p.kind === 'agent' && p.body.model && 'reasoningEffort' in p.body.model).map((p) => p.body.id)));
    check('B1.10 [第一跑] systemPrompt = 人设正文（+ \\n\\n + 适配正文，若有），逐字节等于包内文件',
      (() => {
        const roles = readJson(join(PACK_SRC, 'roles.json')).roles;
        const byId = new Map(roles.map((r) => [r.id, r]));
        const bad = [];
        for (const p of stub.state.posts.filter((x) => x.kind === 'agent')) {
          const r = byId.get(p.body.id);
          if (!r) continue;
          const parts = [readText(join(PACK_SRC, r.prompt))];
          if (typeof r.adapter === 'string' && r.adapter !== '') parts.push(readText(join(PACK_SRC, r.adapter)));
          if (p.body.systemPrompt !== parts.join('\n\n')) bad.push(p.body.id);
        }
        return bad.length === 0;
      })(), '不一致：' + JSON.stringify(stub.state.posts.filter((x) => x.kind === 'agent').map((x) => ({ id: x.body.id, len: (x.body.systemPrompt || '').length }))));

    // ---- 第二跑：必须一个字节都不写
    const run2 = await runNode(INSTALL_SRC, args, { env });
    const rep2 = reportOf(run2);
    const afterSecond = {
      home: snapshotDir(dshHome),
      profile: snapshotDir(profile),
      posts: stub.state.posts.length,
      writes: stub.state.writes,
    };
    const skippedLines = bothText(run2).split('\n').filter((l) => l.includes('[跳过]') && l.includes('已存在'));
    check('B2.1 [第二跑·幂等核心] exit 0 且 writes = 0（第二次一个字节都不写）',
      run2.code === 0 && rep2 !== null && rep2.writes === 0,
      'exit=' + String(run2.code) + ' writes=' + String(rep2 && rep2.writes));
    check('B2.2 [第二跑·幂等核心] 桩端点没有收到任何新的 POST（写入次数与第一跑后完全一致）',
      afterSecond.posts === afterFirst.posts && afterSecond.writes === afterFirst.writes,
      'posts ' + String(afterFirst.posts) + ' -> ' + String(afterSecond.posts) + '；端点侧 writes ' + String(afterFirst.writes) + ' -> ' + String(afterSecond.writes));
    check('B2.3 [第二跑·幂等核心] 每一条角色的 updatedAt 都没变（逐 id 比较端点上的记录）',
      (() => {
        const bad = [];
        for (const [id, rec] of afterFirst.agents) {
          const now = stub.state.agents.get(id);
          if (!now || now.updatedAt !== rec.updatedAt) bad.push(id);
        }
        return bad.length === 0;
      })(), JSON.stringify([...afterFirst.agents].filter(([id, rec]) => stub.state.agents.get(id).updatedAt !== rec.updatedAt).map(([id]) => id)));
    check('B2.4 [第二跑·幂等核心] 工作流的 updatedAt 也没变（同一条记录，没有第二条）',
      stub.state.workflows.size === 1 && stub.state.workflows.get(workflowId).updatedAt === afterFirst.workflows.get(workflowId).updatedAt,
      'size=' + stub.state.workflows.size + ' updatedAt=' + String(stub.state.workflows.get(workflowId).updatedAt) + '（第一跑后 ' + String(afterFirst.workflows.get(workflowId).updatedAt) + '）');
    check('B2.5 [第二跑·幂等核心] 临时 DSH_HOME 与临时 profile 的快照逐字节不变（含技能文件）',
      eq(afterSecond.home, afterFirst.home) && eq(afterSecond.profile, afterFirst.profile),
      'home 差异=' + JSON.stringify(diffSnapshot(afterFirst.home, afterSecond.home)) + ' profile 差异=' + JSON.stringify(diffSnapshot(afterFirst.profile, afterSecond.profile)));
    check('B2.6 [第二跑·幂等核心] 安装器自己如实报告"跳过"：10 条角色「[跳过] 已存在」+ 1 条工作流 + 1 条技能',
      skippedLines.filter((l) => l.includes('角色')).length === 10 &&
      skippedLines.filter((l) => l.includes('工作流')).length === 1 &&
      skippedLines.filter((l) => l.includes('技能')).length === 1,
      'n=' + String(skippedLines.length) + ' | ' + skippedLines.slice(0, 3).map((l) => l.trim()).join(' ; ').slice(0, 200));
    check('B2.7 [第二跑] 角色仍然只有 10 个、工作流仍然只有 1 条（没有因为重复 upsert 产生第二份）',
      stub.state.agents.size === 10 && stub.state.workflows.size === 1,
      'agents=' + stub.state.agents.size + ' workflows=' + stub.state.workflows.size);
    check('B2.8 [第二跑] 角色名在目标上仍然唯一（同名两条 = upsert 失效）',
      (() => {
        const seen = new Map();
        const dup = [];
        for (const a of stub.state.agents.values()) {
          if (seen.has(a.name)) dup.push(a.name);
          else seen.set(a.name, a.id);
        }
        return dup.length === 0;
      })(), JSON.stringify([...stub.state.agents.values()].map((a) => a.name)));
    check('B2.9 [第二跑·幂等核心] 工作流记录本身（含 updatedAt / haltOnFailure / maxRework / 节点数）与第一跑后完全相同',
      eq(stub.state.workflows.get(workflowId), afterFirst.workflows.get(workflowId)),
      'before=' + JSON.stringify({ u: afterFirst.workflows.get(workflowId).updatedAt, h: afterFirst.workflows.get(workflowId).haltOnFailure }) +
      ' after=' + JSON.stringify({ u: stub.state.workflows.get(workflowId).updatedAt, h: stub.state.workflows.get(workflowId).haltOnFailure }));

    // ---- B1.11 / B4：工作流的"写入后读回校验"（declared-but-unstored 缺陷类）
    // 安装器必须在第 5 步之后 GET /workflows 读回，并断言 haltOnFailure === true。
    // 变红方式：把读回校验短路（见第 E 组 M2）—— 断言会变成"没读到警告"，本项即红。
    const step5Lines = bothText(run1).split('\n');
    const readBackLines = step5Lines.filter((l) => l.includes('读回校验') || l.includes('haltOnFailure = true') || l.includes('maxRework = 1'));
    check('B1.11 [读回校验] 第一跑对工作流做了读回校验，并明确报告 haltOnFailure = true 与 review.maxRework = 1 都存住了',
      readBackLines.some((l) => l.includes('haltOnFailure = true')) && readBackLines.some((l) => l.includes('maxRework = 1')),
      '相关行=' + JSON.stringify(readBackLines.map((l) => l.trim())).slice(0, 460));
    check('B1.12 [读回校验] 第一跑对 10 个角色也做了读回校验（systemPrompt / model / tools.preset 逐项一致）',
      bothText(run1).split('\n').filter((l) => l.includes('读回一致')).length >= 10,
      String(bothText(run1).split('\n').filter((l) => l.includes('读回一致')).length) + ' 条「读回一致」');

    // ---- B4：目标版本会丢弃 haltOnFailure —— 安装器必须告警（能力降级），但退出码仍是 0
    try {
      const noHaltStub = await makeStubEndpoint({ catalog: CATALOGS.live, dropHaltOnFailure: true });
      const packCopy4 = copyPack('B4-pack');
      const scratch4 = join(TEMP_ROOT, 'B4-scratch');
      const dshHome4 = join(scratch4, 'dsh-home');
      const profile4 = join(scratch4, 'profile');
      mkdirSync(dshHome4, { recursive: true });
      mkdirSync(profile4, { recursive: true });
      writeFileSync(join(profile4, 'package.json'), JSON.stringify({ name: 'p13e-B4', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
      writeFileSync(join(profile4, 'cordis.patch.yml'), '# p13e\n[]\n', 'utf8');
      const res4 = await runNode(join(packCopy4, 'install.mjs'), ['--profile', profile4, '--endpoint', noHaltStub.endpoint, '--json'], { env: { DSH_HOME: dshHome4 } });
      const said4 = bothText(res4);
      const rec4 = noHaltStub.state.workflows.get(workflowId);
      check('B4.1 [旧版本丢弃 haltOnFailure] 端点上的记录里确实没有 haltOnFailure（夹具真的丢掉了它）',
        rec4 !== undefined && rec4.haltOnFailure !== true, JSON.stringify(rec4 && rec4.haltOnFailure));
      check('B4.2 [旧版本丢弃 haltOnFailure] 安装器读回后告警非空，且点名了能力降级与"只靠产物级阻断"',
        said4.includes('没有 haltOnFailure=true') && said4.includes('产物级阻断'),
        said4.split('\n').filter((l) => l.includes('haltOnFailure'))[0]?.trim().slice(0, 200) || '(没有相关行)');
      check('B4.3 [旧版本丢弃 haltOnFailure] 退出码仍是 0（能力降级不是安装失败，P13-PLAN 3.2 第 5 条）',
        res4.code === 0, 'exit=' + String(res4.code));
      check('B4.4 [旧版本丢弃 haltOnFailure] --json 报告里这条告警也在（机器可读的告警清单非空）',
        (() => { const r = reportOf(res4); return r !== null && Array.isArray(r.warnings) && r.warnings.some((w) => String(w).includes('haltOnFailure')); })(),
        JSON.stringify(reportOf(res4) && reportOf(res4).warnings));
      await noHaltStub.close();
    } catch (e) { blockFailure('B4 旧版本丢弃 haltOnFailure', e); }

    // ---- --check：已装 -> 0；未装 -> 3（两条口径互补）
    const checkInstalled = await runNode(INSTALL_SRC, ['--profile', profile, '--endpoint', stub.endpoint, '--check', '--json'], { env });
    check('B3.1 [--check 已装] exit 0（约定：0 = 全部就位且一致）',
      checkInstalled.code === 0, 'exit=' + String(checkInstalled.code) + ' | ' + bothText(checkInstalled).trim().split('\n').slice(-2).join(' | ').slice(0, 200));
    const scratch2 = join(TEMP_ROOT, 'B3-scratch');
    const dshHome2 = join(scratch2, 'dsh-home');
    const profile2 = join(scratch2, 'profile');
    mkdirSync(dshHome2, { recursive: true });
    mkdirSync(profile2, { recursive: true });
    writeFileSync(join(profile2, 'package.json'), JSON.stringify({ name: 'p13e-B3', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
    writeFileSync(join(profile2, 'cordis.yml'), '[]\n', 'utf8');
    writeFileSync(join(profile2, 'cordis.patch.yml'), '# p13e\n[]\n', 'utf8');
    const stub2 = await makeStubEndpoint({ catalog: CATALOGS.live });
    const checkMissing = await runNode(INSTALL_SRC, ['--profile', profile2, '--endpoint', stub2.endpoint, '--check', '--json'], { env: { DSH_HOME: dshHome2 } });
    check('B3.2 [--check 未装] exit 3（约定：3 = 有缺失/不一致），且与已装状态的退出码明确不同',
      checkMissing.code === 3 && checkMissing.code !== checkInstalled.code,
      'installed=' + String(checkInstalled.code) + ' missing=' + String(checkMissing.code));
    check('B3.3 [--check 未装] --check 不落盘：临时 DSH_HOME 快照为空、桩端点 0 次写入',
      Object.keys(snapshotDir(dshHome2)).length === 0 && stub2.state.writes === 0,
      'home 文件=' + Object.keys(snapshotDir(dshHome2)).length + ' writes=' + stub2.state.writes);
    check('B3.4 [--check 未装] 报告点名缺失项（10 个角色 + 工作流 + 技能），而不是只给一个退出码',
      (() => {
        const said = bothText(checkMissing);
        const missing = (said.match(/\[缺失\]/g) || []).length;
        return missing >= 12;
      })(), String((bothText(checkMissing).match(/\[缺失\]/g) || []).length) + ' 条 [缺失]');
    // 未装状态下的 --check 之所以要 0 写入：确认 stub2 收到的只有 GET
    check('B3.5 [--check] 端点侧只收到 GET（--check 是只读模式）',
      stub2.state.posts.length === 0 && stub2.state.requests.every((r) => r.startsWith('GET')),
      JSON.stringify(stub2.state.requests.slice(0, 6)));

    await stub.close();
    await stub2.close();
  } catch (e) { blockFailure('B 组安装幂等', e); }
}

// ===========================================================================
if (wants('C')) {
  console.log('\n--- GROUP C: 模型意图解析（4 套 provider 集合 + 降级路径） ---');
  // ===========================================================================
  // 判据来自 models.map.json 的 prefer 顺序：解析不到就不写 model 字段并告警。
  // 变红方式：把 prefer 顺序改乱、或让安装器在解析不到时瞎猜一个模型。
  const scenarios = [
    {
      id: 'C1', catalog: CATALOGS.live, label: '本机实测目录（deepseek-official + amd + kuafu + hub16）',
      expect: target => ({
        'lease-coordinator': 'deepseek-official/deepseek-flash',
        'lease-data-organizer': 'deepseek-official/deepseek-flash',
        'lease-web-collector': 'deepseek-official/deepseek-flash',
        'lease-financial-analyst': 'deepseek-official/deepseek-v4-pro',
        'lease-credit-legal-analyst': 'deepseek-official/deepseek-flash',
        'lease-asset-registry-analyst': 'deepseek-official/deepseek-flash',
        'lease-data-verifier': 'deepseek-official/deepseek-flash',
        'lease-risk-reviewer': 'deepseek-official/deepseek-v4-pro',
        'lease-report-writer': 'deepseek-official/deepseek-v4-pro',
        'lease-feedback-optimizer': 'deepseek-official/deepseek-v4-pro',
      })[target],
      expectWarningsAtLeast: 0,
    },
    {
      id: 'C2', catalog: CATALOGS.userNamed, label: '只有 amd/hub16（用户原始需求点名的三个模型）',
      expect: target => ({
        'lease-coordinator': 'amd/DeepSeek-V4.1-Flash',
        'lease-data-organizer': 'amd/DeepSeek-V4.1-Flash',
        'lease-web-collector': 'amd/DeepSeek-V4.1-Flash',
        'lease-credit-legal-analyst': 'amd/DeepSeek-V4.1-Flash',
        'lease-asset-registry-analyst': 'amd/DeepSeek-V4.1-Flash',
        'lease-data-verifier': 'amd/DeepSeek-V4.1-Flash',
        'lease-financial-analyst': 'hub16/gpt-5.6-terra',
        'lease-report-writer': 'hub16/gpt-5.6-terra',
        // astra 的 prefer = [deepseek-official/deepseek-v4-pro, hub16/gpt-6-astra, hub16/gpt-5.6-sol]
        'lease-risk-reviewer': 'hub16/gpt-6-astra',
        'lease-feedback-optimizer': 'hub16/gpt-6-astra',
      })[target],
      expectWarningsAtLeast: 0,
    },
    {
      id: 'C3', catalog: CATALOGS.officialProOnly, label: '只有 deepseek-official/deepseek-v4-pro',
      expect: target => ({
        // terra / astra 的 prefer 首选就是 deepseek-v4-pro
        'lease-financial-analyst': 'deepseek-official/deepseek-v4-pro',
        'lease-risk-reviewer': 'deepseek-official/deepseek-v4-pro',
        'lease-report-writer': 'deepseek-official/deepseek-v4-pro',
        'lease-feedback-optimizer': 'deepseek-official/deepseek-v4-pro',
      })[target],
      // flash 的 prefer 里没有任何 deepseek-v4-pro（只有 deepseek-flash / deepseek-v4-flash / amd / kuafu）
      expectMissingFor: ['lease-coordinator', 'lease-data-organizer', 'lease-web-collector', 'lease-credit-legal-analyst', 'lease-asset-registry-analyst', 'lease-data-verifier'],
      expectWarningsAtLeast: 6,
    },
    {
      id: 'C4', catalog: CATALOGS.empty, label: '一个 provider 都没有（完全解析不到）',
      expect: () => undefined,
      expectAllMissing: true,
      expectWarningsAtLeast: 10,
    },
  ];

  for (const sc of scenarios) {
    try {
      const stub = await makeStubEndpoint({ catalog: sc.catalog });
      const packCopy = copyPack(sc.id + '-pack');
      const scratch = join(TEMP_ROOT, sc.id + '-scratch');
      const dshHome = join(scratch, 'dsh-home');
      const profile = join(scratch, 'profile');
      mkdirSync(dshHome, { recursive: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'p13e-' + sc.id, private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
      writeFileSync(join(profile, 'cordis.patch.yml'), '# p13e\n[]\n', 'utf8');
      const res = await runNode(join(packCopy, 'install.mjs'), ['--profile', profile, '--endpoint', stub.endpoint, '--json'], { env: { DSH_HOME: dshHome } });
      const rep = reportOf(res);
      const said = bothText(res);
      const agents = stub.state.posts.filter((p) => p.kind === 'agent').map((p) => p.body);
      const byId = new Map(agents.map((a) => [a.id, a]));
      const allIds = readJson(join(PACK_SRC, 'pack.json')).targets.roleIds;

      check(`${sc.id}.1 [${sc.label}] exit 0（解析不到是如实降级，不是安装失败）`,
        res.code === 0, 'exit=' + String(res.code) + ' | ' + said.trim().split('\n').slice(-2).join(' | ').slice(0, 200));

      if (sc.expectAllMissing) {
        check(`${sc.id}.2 [${sc.label}] 10 个角色全部不写 model 字段（一个都不许猜）`,
          agents.length === 10 && agents.every((a) => a.model === undefined),
          '带 model 的角色数=' + String(agents.filter((a) => a.model !== undefined).length));
      } else {
        const bad = [];
        for (const id of allIds) {
          const want = sc.expect(id);
          const got = byId.get(id);
          if (!got) { bad.push(id + ':未写入'); continue; }
          const wantS = want === undefined ? undefined : want;
          const gotS = got.model ? got.model.provider + '/' + got.model.model : undefined;
          if (sc.expectMissingFor && sc.expectMissingFor.includes(id)) {
            if (gotS !== undefined) bad.push(`${id}:期望不写 model，实际 ${gotS}`);
          } else if (wantS !== undefined && gotS !== wantS) bad.push(`${id}:期望 ${wantS}，实际 ${String(gotS)}`);
        }
        check(`${sc.id}.2 [${sc.label}] 每个角色的解析结果与 models.map.json 的 prefer 顺序一致`,
          bad.length === 0, bad.join(' ; ') || '10 个角色逐个核对通过');
      }
      const warnLines = said.split('\n').filter((l) => l.includes('[告警]'));
      // --json 模式下告警既出现在进度流里、也会在收尾时再列一遍（便于人读），
      // 所以这里按"去掉行首标记后的正文"去重再计数。
      const warnBodies = [...new Set(warnLines.map((l) => l.replace(/^.*\[告警\]\s*/, '').trim()).filter((x) => x !== ''))];
      check(`${sc.id}.3 [${sc.label}] 去重后的告警条数 >= ${sc.expectWarningsAtLeast}（解析不到时必须告警非空）`,
        warnBodies.length >= sc.expectWarningsAtLeast,
        'unique warnings=' + String(warnBodies.length) + ' | ' + warnBodies.slice(0, 2).map((l) => l.slice(0, 90)).join(' ; '));
      if (sc.expectAllMissing) {
        check(`${sc.id}.4 [${sc.label}] 10 个角色各自有一条"解析不到"的告警（不是一句笼统的"有些角色没解析到"）`,
          warnBodies.filter((l) => l.includes('解析不到')).length === 10,
          String(warnBodies.filter((l) => l.includes('解析不到')).length) + ' 条');
      }
      check(`${sc.id}.5 [${sc.label}] 解析结果写进了 --json 报告的 steps[3].plan（机器可读，便于接收方自查）`,
        rep !== null && Array.isArray(rep.steps) && (() => {
          const step = rep.steps.find((s) => s && s.name === 'resolve-models');
          return step !== undefined && Array.isArray(step.plan) && step.plan.length === 10;
        })(), JSON.stringify(rep && Array.isArray(rep.steps) ? rep.steps.map((s) => s.name) : rep));
      check(`${sc.id}.6 [${sc.label}] 所有角色的 model 里一律没有 reasoningEffort（never-declare 策略；含解析不到而不写 model 的那些）`,
        agents.every((a) => !a.model || !('reasoningEffort' in a.model)),
        JSON.stringify(agents.filter((a) => a.model && 'reasoningEffort' in a.model).map((a) => a.id)));

      await stub.close();
    } catch (e) { blockFailure('C ' + sc.id + ' ' + sc.label, e); }
  }

  // ---- C5：角色声明了 models.map.json 里没有的意图 -> 不写 model + 告警
  try {
    const packCopy = copyPack('C5-pack', (dir) => {
      const p = join(dir, 'roles.json');
      const doc = readJson(p);
      doc.roles.find((r) => r.id === 'lease-report-writer').modelIntent = 'no-such-intent';
      writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    });
    const stub = await makeStubEndpoint({ catalog: CATALOGS.live });
    const scratch = join(TEMP_ROOT, 'C5-scratch');
    const dshHome = join(scratch, 'dsh-home');
    const profile = join(scratch, 'profile');
    mkdirSync(dshHome, { recursive: true });
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'p13e-C5', private: true, dsh: { profile: { bundles: [] } } }, null, 2) + '\n', 'utf8');
    writeFileSync(join(profile, 'cordis.patch.yml'), '# p13e\n[]\n', 'utf8');
    const res = await runNode(join(packCopy, 'install.mjs'), ['--profile', profile, '--endpoint', stub.endpoint, '--json'], { env: { DSH_HOME: dshHome } });
    const said = bothText(res);
    const writer = stub.state.posts.filter((p) => p.kind === 'agent').map((p) => p.body).find((a) => a.id === 'lease-report-writer');
    check('C5.1 [意图不在表里] exit 0，且该角色不写 model 字段（继承会话模型）',
      res.code === 0 && writer !== undefined && writer.model === undefined,
      'exit=' + String(res.code) + ' model=' + JSON.stringify(writer && writer.model));
    check('C5.2 [意图不在表里] 告警非空且点名了那个意图与角色',
      said.includes('no-such-intent') && said.includes('lease-report-writer'),
      said.split('\n').filter((l) => l.includes('no-such-intent')).slice(0, 1).join('').trim().slice(0, 180));
    await stub.close();
  } catch (e) { blockFailure('C5 意图不在表里', e); }
}

// ===========================================================================
if (wants('D')) {
  console.log('\n--- GROUP D: PROVENANCE 篡改 / 离线自检的非空转对照 ---');
  // ===========================================================================
  // 主检查：篡改一个 prompt 的**一个字节** -> selftest 必须变红（退出码 1）；
  // 用未篡改的副本恢复 -> 必须变绿。全部在临时副本上做，仓库里的包不受影响。
  try {
    const clean = copyPack('D-clean');
    const tampered = copyPack('D-tampered', (dir) => {
      const p = join(dir, 'prompts', '04-financial-analyst.md');
      const text = readText(p);
      // 只改一个字符：把第一个"财务报表"里的"表"换成"标"（同长度、同字节数级别的单字节改动）
      const at = text.indexOf('表');
      if (at === -1) throw new Error('篡改靶点未找到：prompts/04-financial-analyst.md 里没有"表"字');
      const next = text.slice(0, at) + '标' + text.slice(at + 1);
      if (next === text) throw new Error('篡改没有生效');
      writeFileSync(p, next, 'utf8');
    });

    const beforeBytes = statSync(join(tampered, 'prompts', '04-financial-analyst.md')).size;
    const cleanBytes = statSync(join(clean, 'prompts', '04-financial-analyst.md')).size;
    check('D0.1 [夹具] 篡改只改了 1 个字符，文件字节数不变（证明红的来源是内容而不是长度）',
      beforeBytes === cleanBytes, '篡改后=' + beforeBytes + ' 干净=' + cleanBytes);

    const greenBefore = await runNode(join(clean, 'selftest.mjs'), ['--no-runtime'], { cwd: clean });
    const greenStats = statsOf(greenBefore.stdout);
    check('D1.1 [绿基线] 未篡改的副本上 selftest 退出码 0（离线模式 --no-runtime）',
      greenBefore.code === 0, 'exit=' + String(greenBefore.code) + ' ' + JSON.stringify(greenStats));
    check('D1.2 [绿基线] 绿基线的检查数 > 60（说明离线检查真的在跑，不是空套件）',
      greenStats !== null && greenStats.checks > 60 && greenStats.failures === 0, JSON.stringify(greenStats));

    const redRun = await runNode(join(tampered, 'selftest.mjs'), ['--no-runtime'], { cwd: tampered });
    const redStats = statsOf(redRun.stdout);
    const redLabels = failedLabelsOf(redRun.stdout);
    check('D2.1 [篡改一个字节 -> 红] selftest 退出码 1（不是崩溃码、也不是 0）',
      redRun.code === 1, 'exit=' + String(redRun.code) + ' ' + JSON.stringify(redStats));
    // 注意：这里只改了一个"同字节长度"的汉字（表 -> 标），所以 J5(bytes)/J6(chars)
    // 仍然相等 —— 能抓住它的只有 J4(sha256)。这正是"篡改一个字节"要证明的那条检查。
    check('D2.2 [篡改一个字节 -> 红] 变红的正是 PROVENANCE 的 sha256 检查（J4），且精确到只有这一条（不是整组崩）',
      redLabels.length === 1 && redLabels[0].startsWith('J4'),
      'failed=' + JSON.stringify(redLabels));
    check('D2.3 [篡改一个字节 -> 红] 输出里点名了被改的那个文件与两个 sha256 前缀（人不必猜）',
      redRun.stdout.includes('04-financial-analyst.md') && /清单=[0-9a-f]{12}/.test(redRun.stdout) && /实际=[0-9a-f]{12}/.test(redRun.stdout),
      (redRun.stdout.split('\n').find((l) => l.includes('04-financial-analyst.md') && l.includes('清单=')) || '').trim().slice(0, 180));
    check('D2.4 [篡改一个字节 -> 红] 红在"检查"上而不是套件崩溃：SUMMARY 打印了且没有未捕获异常',
      redRun.stdout.includes('=== SUMMARY ===') && redRun.stdout.includes('RESULT: FAIL') && bothText(redRun).includes('未捕获异常') === false,
      'summary=' + String(redRun.stdout.includes('=== SUMMARY ===')));

    // 恢复：把干净副本里那份人设覆盖回篡改后的副本（模拟"恢复原字节后必须变绿"）
    const restored = copyPack('D-restored', (dir) => {
      // 注意方向：这里是把**干净**内容复制到 restored 副本上，而不是反过来。
      cpSync(join(clean, 'prompts', '04-financial-analyst.md'), join(dir, 'prompts', '04-financial-analyst.md'));
    });
    const restoredHash = hashOfFile(join(restored, 'prompts', '04-financial-analyst.md'));
    const cleanHash = hashOfFile(join(clean, 'prompts', '04-financial-analyst.md'));
    const tamperedHash = hashOfFile(join(tampered, 'prompts', '04-financial-analyst.md'));
    check('D3.0 [恢复] 恢复后的文件 sha256 与干净副本一致，且与篡改后不同（恢复动作真的发生了）',
      restoredHash === cleanHash && restoredHash !== tamperedHash,
      'restored=' + restoredHash.slice(0, 12) + ' clean=' + cleanHash.slice(0, 12) + ' tampered=' + tamperedHash.slice(0, 12));
    const greenAfter = await runNode(join(restored, 'selftest.mjs'), ['--no-runtime'], { cwd: restored });
    const afterStats = statsOf(greenAfter.stdout);
    check('D3.1 [恢复后 -> 绿] 退出码回到 0',
      greenAfter.code === 0, 'exit=' + String(greenAfter.code) + ' ' + JSON.stringify(afterStats));
    check('D3.2 [恢复后 -> 绿] 失败的检查列表为空，且检查数与绿基线相同（同一套检查跑同一份内容）',
      failedLabelsOf(greenAfter.stdout).length === 0 && afterStats !== null && greenStats !== null && afterStats.checks === greenStats.checks,
      JSON.stringify({ before: greenStats, after: afterStats }));

    // ---- 非空转对照：清单漏记 / workflow 超限，两条离线检查都要能真的红
    const orphan = copyPack('D-orphan', (dir) => {
      writeFileSync(join(dir, 'prompts', '99-extra.md'), '# 没人引用的第 11 份人设\n', 'utf8');
    });
    const orphanRun = await runNode(join(orphan, 'selftest.mjs'), ['--no-runtime'], { cwd: orphan });
    check('D4.1 [非空转] 往 prompts/ 添一个未被清单记录的文件 -> selftest 变红（J3 覆盖检查真的在用）',
      orphanRun.code === 1 && failedLabelsOf(orphanRun.stdout).some((l) => l.startsWith('J3')),
      'exit=' + String(orphanRun.code) + ' failed=' + JSON.stringify(failedLabelsOf(orphanRun.stdout)));

    const oversized = copyPack('D-oversized', (dir) => {
      const p = join(dir, 'workflow.json');
      const doc = readJson(p);
      doc.description = 'PAD'.repeat(17500);
      writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    });
    const overRun = await runNode(join(oversized, 'selftest.mjs'), ['--no-runtime'], { cwd: oversized });
    check('D4.2 [非空转] workflow.json 超 65536 字节 -> selftest 变红（K1 上限检查真的在用）',
      overRun.code === 1 && failedLabelsOf(overRun.stdout).some((l) => l.startsWith('K1')),
      'exit=' + String(overRun.code) + ' failed=' + JSON.stringify(failedLabelsOf(overRun.stdout)));

    const braceCopy = copyPack('D-brace', (dir) => {
      const p = join(dir, 'adapters', '00-workflow-contract.md');
      writeFileSync(p, readText(p) + '\n{{ injected }}\n', 'utf8');
    });
    const braceRun = await runNode(join(braceCopy, 'selftest.mjs'), ['--no-runtime'], { cwd: braceCopy });
    check('D4.3 [非空转] adapters/ 里塞进 "{{" -> selftest 变红（I1 插值陷阱检查真的在用）',
      braceRun.code === 1 && failedLabelsOf(braceRun.stdout).some((l) => l.startsWith('I1')),
      'exit=' + String(braceRun.code) + ' failed=' + JSON.stringify(failedLabelsOf(braceRun.stdout)));

    // ---- D5：仓库里那份真的 selftest 必须绿（否则本包的"随包自检"是坏的）
    const repoRun = await runNode(REPO_SELFTEST, ['--no-runtime'], { cwd: dirname(REPO_SELFTEST) });
    check('D5.1 [仓库里的包] specializations/leasing-risk/selftest.mjs 离线跑退出码 0（这就是要发给别人的那份）',
      repoRun.code === 0, 'exit=' + String(repoRun.code) + ' ' + JSON.stringify(statsOf(repoRun.stdout)) + ' | ' + repoRun.stdout.trim().split('\n').slice(-1)[0]);
  } catch (e) { blockFailure('D 组 PROVENANCE / 离线自检', e); }
}

// ===========================================================================
if (wants('E')) {
  console.log('\n--- GROUP E: 变异测试（每个变异真的让对应检查由绿变红，然后恢复） ---');
  // ===========================================================================
  // 每个变异体都建在系统临时目录里（仓库零改动），用环境变量把本套件指过去：
  //   P13_PACK_TEST_PACK_SRC / P13_PACK_TEST_INSTALL_SRC + P13_PACK_SKIP_MUTATIONS=1
  if (SKIP_MUTATIONS) {
    console.log('  ...  P13_PACK_SKIP_MUTATIONS=1 -> 本组跳过（不计入检查数）');
  } else if (CHILD_MODE) {
    console.log('  ...  子进程/变异模式（P13_PACK_TEST_* 已设置）-> 不再递归跑变异');
  } else {
    const MUT_ROOT = join(TEMP_ROOT, 'mut');
    mkdirSync(MUT_ROOT, { recursive: true });
    const replaceOnce = (text, needle, replacement, label) => {
      const at = text.indexOf(needle);
      if (at === -1) throw new Error(`${label}：替换靶点不存在（测试自己过期了）：${needle.slice(0, 80)}`);
      return text.slice(0, at) + replacement + text.slice(at + needle.length);
    };

    const mutations = [];

    // ---- M1：删掉 install.mjs 的 DAG 环检测
    try {
      const readme = readText(INSTALL_SRC);
      const needle = "if (seen !== nodeIds.length) throw new Fail(`DAG 存在环，涉及节点：${nodeIds.filter((id) => indeg.get(id) > 0).join(' -> ')}`);";
      const mutated = replaceOnce(readme, needle, 'if (false) console.log(`MUTATED: 环检测已被删除（本行只在变异体里存在）`);', 'M1');
      const dir = copyPack('E-m1-pack', (d) => {
        writeFileSync(join(d, 'install.mjs'), mutated, 'utf8');
      });
      mutations.push({
        id: 'M1',
        what: '删掉安装器的 DAG 环检测（A3 的构造会变成"干净通过"并真的写入）',
        env: { P13_PACK_TEST_PACK_SRC: dir, P13_PACK_TEST_INSTALL_SRC: join(dir, 'install.mjs'), P13_PACK_SKIP_MUTATIONS: '1' },
        expectLabels: ['A3.1', 'A3.2', 'A3.3', 'A3.4', 'A7.2'],
        only: 'A',
      });
    } catch (e) { check('E0.1 [夹具] M1 变异体构造失败（夹具问题，不是被测代码问题）', false, String(e && e.message ? e.message : e)); }

    // ---- M2：把工作流读回校验里的 haltOnFailure 断言拿掉
    try {
      const text = readText(INSTALL_SRC);
      const needle = "      if (rec.haltOnFailure === true) {";
      const mutated = replaceOnce(text, needle, "      if (rec.haltOnFailure === true || true) { // MUTATED: 往返校验被短路", 'M2');
      const dir = copyPack('E-m2-pack', (d) => {
        writeFileSync(join(d, 'install.mjs'), mutated, 'utf8');
      });
      mutations.push({
        id: 'M2',
        what: '短路工作流的 haltOnFailure 往返校验（"读回发现没存住"这条路彻底不见了）',
        env: { P13_PACK_TEST_PACK_SRC: dir, P13_PACK_TEST_INSTALL_SRC: join(dir, 'install.mjs'), P13_PACK_SKIP_MUTATIONS: '1' },
        // 靶点是"没存住"那条分支，所以红的是 B4（用 dropHaltOnFailure=true 的桩端点模拟旧版本）
        expectLabels: ['B4.2', 'B4.4'],
        only: 'B',
      });
    } catch (e) { check('E0.2 [夹具] M2 变异体构造失败', false, String(e && e.message ? e.message : e)); }

    // ---- M3：让 install 第二次不跳过（agentMatches 永远返回 false）
    try {
      const text = readText(INSTALL_SRC);
      const needle = 'function agentMatches(existing, desired) {\n  if (!existing) return false;';
      const mutated = replaceOnce(text, needle, 'function agentMatches(existing, desired) {\n  if (true) return false; // MUTATED: 永远"不一致" -> 每次都重写，幂等没了\n  if (!existing) return false;', 'M3');
      const dir = copyPack('E-m3-pack', (d) => {
        writeFileSync(join(d, 'install.mjs'), mutated, 'utf8');
      });
      mutations.push({
        id: 'M3',
        what: '让安装器第二次不再"已存在即跳过"（agentMatches 永远判不一致）',
        env: { P13_PACK_TEST_PACK_SRC: dir, P13_PACK_TEST_INSTALL_SRC: join(dir, 'install.mjs'), P13_PACK_SKIP_MUTATIONS: '1' },
        expectLabels: ['B2.1', 'B2.2', 'B2.3', 'B2.6', 'B3.1', 'B3.2'],
        only: 'B',
      });
    } catch (e) { check('E0.3 [夹具] M3 变异体构造失败', false, String(e && e.message ? e.message : e)); }

    // ---- M4：删掉 install.mjs 的悬空依赖检查（install.mjs:346）
    // 这个变异的**预期结果与其它三个不同**，必须如实呈现：删掉 :346 之后安装器仍然
    // exit 1 —— Kahn 环检测把悬空依赖当成环兜住了（悬空节点的入度永远不会被减到 0）。
    // 所以变红的只有断言文案的 A8.2 / A8.3 / A8.6；A8.1（退出码）与 A8.4（未写入）照旧绿。
    // 这正好证明：**只断言"非零退出 + 未写入"钉不住这条校验**。
    try {
      const text = readText(INSTALL_SRC);
      const needle = 'if (!Object.prototype.hasOwnProperty.call(wfDoc.nodes, dep)) throw new Fail(`节点 ${key} 的 dependsOn 里有悬空依赖：${dep}`);';
      const mutated = replaceOnce(text, needle, '/* MUTATED: 悬空依赖检查已删除（本注释只在变异体里存在） */', 'M4');
      const dir = copyPack('E-m4-pack', (d) => {
        writeFileSync(join(d, 'install.mjs'), mutated, 'utf8');
      });
      mutations.push({
        id: 'M4',
        what: '删掉安装器的悬空 dependsOn 检查（A8 的构造改由 Kahn 环检测兜住，所以只有断言文案的 A8.2/A8.3/A8.6 变红，退出码与未写入两类照旧绿）',
        env: { P13_PACK_TEST_PACK_SRC: dir, P13_PACK_TEST_INSTALL_SRC: join(dir, 'install.mjs'), P13_PACK_SKIP_MUTATIONS: '1' },
        expectLabels: ['A8.2', 'A8.3', 'A8.6'],
        only: 'A',
      });
    } catch (e) { check('E0.4 [夹具] M4 变异体构造失败（夹具问题，不是被测代码问题）', false, String(e && e.message ? e.message : e)); }

    // ---- 先记录绿基线
    const baseline = await runNode(fileURLToPath(import.meta.url), ['--only=A'], { cwd: HERE });
    const baseStats = statsOf(baseline.stdout);
    check('E1.0 [绿基线] 变异前，A 组在仓库代码上全绿（exit 0）',
      baseline.code === 0, 'exit=' + String(baseline.code) + ' ' + JSON.stringify(baseStats));

    for (const m of mutations) {
      try {
        const args = ['--only=' + m.only];
        const res = await runNode(fileURLToPath(import.meta.url), args, { cwd: HERE, env: m.env });
        const stats = statsOf(res.stdout);
        const labels = failedLabelsOf(res.stdout);
        const hit = m.expectLabels.filter((want) => labels.some((l) => l.indexOf(want) === 0));
        check(`E.${m.id}.1 [${m.what}] 该变异真的让本套件变红（exit 1 且有失败检查），不是"看起来红"`,
          res.code === 1 && stats !== null && stats.failures > 0,
          'exit=' + String(res.code) + ' checks=' + String(stats && stats.checks) + ' failures=' + String(stats && stats.failures));
        check(`E.${m.id}.2 [${m.what}] 变红的正是被点名的检查（${m.expectLabels.join(' / ')}）`,
          hit.length === m.expectLabels.length,
          'hit=' + hit.join(',') + ' | allFailed=' + labels.slice(0, 8).join(' ; ').slice(0, 400));
        check(`E.${m.id}.3 [${m.what}] 红在"检查"上而不是套件崩溃：SUMMARY + RESULT: FAIL 都在，且没有 FATAL / 未捕获异常`,
          res.stdout.includes('=== SUMMARY ===') && res.stdout.includes('RESULT: FAIL') && res.stdout.includes('FATAL') === false && res.stdout.includes('未捕获异常') === false,
          'fatal=' + String(res.stdout.includes('FATAL')) + ' summary=' + String(res.stdout.includes('=== SUMMARY ===')));
        console.log(`       [变异 ${m.id} 原始输出] exit=${res.code} ${stats ? 'checks=' + stats.checks + ' failures=' + stats.failures : ''}`);
        for (const l of labels.slice(0, 6)) console.log('         FAILED>> ' + l);
        // 反证：同一个变异体上，除了这条变异的"影响面"之外的检查仍然是绿的
        // （说明是精确打击，而不是整套件崩掉）。
        const unrelated = labels.filter((l) => !m.expectLabels.some((w) => l.indexOf(w) === 0));
        check(`E.${m.id}.4 [${m.what}] 只红了这条变异的影响面（${m.expectLabels.join('/')}），影响面之外 ${unrelated.length} 条仍绿`,
          unrelated.length === 0,
          unrelated.slice(0, 6).join(' ; '));
      } catch (e) { blockFailure('E ' + m.id + ' 变异运行', e); }
    }

    // ---- 恢复：仓库代码上重跑 A/B 两组必须又是绿的
    try {
      const restored = await runNode(fileURLToPath(import.meta.url), ['--only=A,B'], { cwd: HERE });
      check('E9.1 [恢复] 变异体全部只存在于临时目录；仓库代码上重跑 A+B 组仍然 exit 0（绿 -> 红 -> 绿闭环）',
        restored.code === 0, 'exit=' + String(restored.code) + ' ' + JSON.stringify(statsOf(restored.stdout)));
    } catch (e) { blockFailure('E9 恢复后的绿基线', e); }
  }
}

// ===========================================================================
if (wants('F')) {
  console.log('\n--- GROUP F: 守卫（真实 profile / 真实安装器 / 变异体落点） ---');
  // ===========================================================================
  const realProfileAfter = {
    pkg: hashOfFile(join(REAL_PROFILE, 'package.json')),
    patch: hashOfFile(join(REAL_PROFILE, 'cordis.patch.yml')),
    settings: hashOfFile(join(REAL_DSH_HOME, 'settings.yaml')),
  };
  check('F1.1 [真实 profile 未被触碰] %USERPROFILE%\\.dsh\\profiles\\web 的 package.json 与 cordis.patch.yml 哈希与开跑前一致',
    realProfileAfter.pkg === realProfileBefore.pkg && realProfileAfter.patch === realProfileBefore.patch,
    'pkgSame=' + String(realProfileAfter.pkg === realProfileBefore.pkg) + ' patchSame=' + String(realProfileAfter.patch === realProfileBefore.patch));
  check('F1.2 [真实 DSH_HOME 未被触碰] %USERPROFILE%\\.dsh\\settings.yaml 哈希不变（本套件只读它）',
    realProfileAfter.settings === realProfileBefore.settings, 'same=' + String(realProfileAfter.settings === realProfileBefore.settings));
  check('F1.3 [真实技能目录未被写入] %USERPROFILE%\\.dsh\\skills 的快照与开跑前一致（本包的技能只装到临时 DSH_HOME）',
    eq(snapshotDir(join(REAL_DSH_HOME, 'skills')), realProfileBefore.skills),
    '差异=' + JSON.stringify(diffSnapshot(realProfileBefore.skills, snapshotDir(join(REAL_DSH_HOME, 'skills')))));
  check('F2.1 [install.mjs 未被修改] specializations/leasing-risk/install.mjs 的 sha256 与开跑前一致',
    hashOfFile(REPO_INSTALL) === installSrcHashBefore, hashOfFile(REPO_INSTALL).slice(0, 16) + ' vs ' + installSrcHashBefore.slice(0, 16));
  check('F2.2 [本套件自己的产物未被修改] specializations/leasing-risk/selftest.mjs 的 sha256 与开跑前一致（测试没偷改被测文件）',
    hashOfFile(REPO_SELFTEST) === selftestHashBefore, hashOfFile(REPO_SELFTEST).slice(0, 16) + ' vs ' + selftestHashBefore.slice(0, 16));
  check('F3.1 临时工作区建在系统临时目录里（不是仓库、也不是用户 profile 目录）',
    TEMP_ROOT.indexOf(tmpdir()) === 0 && TEMP_ROOT.indexOf(REAL_PROFILE) === -1, TEMP_ROOT);
  check('F3.2 仓库的包目录与 validation/ 目录里没有留下任何变异副本（E-m1/E-m2/E-m3/E-m4 只在系统临时目录）',
    !existsSync(join(PACK_SRC, 'E-m1-pack')) && !existsSync(join(HERE, 'E-m1-pack')) && !existsSync(join(PACK_SRC, 'install.mjs.bak')),
    'checked ' + PACK_SRC + ' and ' + HERE);
}

// ---------------------------------------------------------------- 收尾
try { rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch { /* 清理失败不改变结论 */ }

summary();
process.exitCode = failures === 0 ? 0 : 1;
