// Flowise-like multi-agent team orchestration plugin — HOST half.
// Production port of the P1–P5 dynamic prototype into a composed host plugin
// that auto-starts on every host boot.
//
// IMPORTANT: `harness.*` is ONLY available to DYNAMIC package sandboxes
// (cf. cordis-host-runner HOST_BUILTIN_INSPECTION). A COMPOSED host-composition
// row gets real Cordis services instead. So this port uses real services only:
//   - ctx.tools.register(defineTool(...))  for the team_* model tools
//   - ctx.provide('teamOrchestrator', ...) for the host service
//   - ctx.storageDomain.open(...)          for durable domains
// Browser RPC (harness.handle/host.call) is deferred with the client UI.

import { defineTool } from '@deepseek-ai/dsh-tools';
import z from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';

export const name = 'team-flowise';

export const inject = ['storageDomain', 'agents', 'subagents', 'webServer'];

// ---- real zod record schemas (file backend validates on open/put) ----
const now = () => Date.now();
const makeId = () => (Math.random().toString(36).slice(2, 10) + now().toString(36));

const modelSchema = z.object({
  provider: z.string().default('deepseek'),
  model: z.string().default('deepseek-chat'),
  maxTokens: z.number().int().positive().optional(),
});

const agentDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  role: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: modelSchema,
  skills: z.array(z.string()).default([]),
  tools: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
  permissionPolicy: z.string().optional(),
  updatedAt: z.number().int().nonnegative(),
});

const workflowNodeSchema = z.object({
  id: z.string().min(1),
  // A human-readable name for this step. Without one the UI can only show the id
  // ("fix-tabs"), which says nothing about what the work actually was.
  title: z.string().optional(),
  agent: z.string().optional(),
  taskTemplate: z.object({ requirement: z.string().optional(), acceptanceCriteria: z.string().optional() }).optional(),
  dependsOn: z.array(z.string()).default([]),
  reviewer: z.string().optional(),
  mode: z.enum(['once', 'loop']).optional(),
  gate: z.object({ expr: z.string().optional(), condition: z.any().optional() }).optional(),
  maxRework: z.number().int().positive().optional(),
});

const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  nodes: z.record(workflowNodeSchema).default({}),
  // P10: workflow-level review settings. OPTIONAL end to end, and every field
  // inside is optional too -- adding a required key here would make every
  // already-stored workflow record fail validation the moment a domain opens.
  // `maxRework` is additionally clamped to REVIEW_LIMITS.maxReworkPerNode at
  // use time, so this field can only ever TIGHTEN the bound, never raise it.
  review: z.object({
    reviewer: z.string().optional(),
    maxRework: z.number().int().min(0).max(2).optional(),
    enabled: z.boolean().optional(),
  }).optional(),
  updatedAt: z.number().int().nonnegative(),
});

const taskIterationSchema = z.object({
  iteration: z.number().int().nonnegative(),
  status: z.string(),
  subagentId: z.string().optional(),
  outputRef: z.string().optional(),
  feedback: z.string().optional(),
  at: z.number().int().nonnegative(),
});

const taskSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().optional(),
  nodeId: z.string().optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  requirement: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  status: z.enum(['queued', 'submitted', 'working', 'completed', 'reworked', 'settle']).default('queued'),
  iteration: z.number().int().nonnegative().default(0),
  history: z.array(taskIterationSchema).default([]),
  output: z.any().optional(),
  outputRef: z.string().optional(),
  reportRef: z.string().optional(),
  review: z.any().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const runSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']).default('running'),
  nodeStates: z.record(z.any()).default({}),
  result: z.any().optional(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
});

// ---- typed domains (underscore names satisfy UNIT_NAME_RE) ----
export const agentDefsDomain = defineDomain({ name: 'team_agent_defs', version: 1, tables: { defs: domainTable(agentDefSchema) } });
export const taskLedgerDomain = defineDomain({ name: 'team_ledger', version: 1, tables: { tasks: domainTable(taskSchema) } });
export const workflowsDomain = defineDomain({ name: 'team_workflows', version: 1, tables: { flows: domainTable(workflowSchema) } });
export const runsDomain = defineDomain({ name: 'team_runs', version: 1, tables: { runs: domainTable(runSchema) } });

export const DOMAINS = ['team_agent_defs', 'team_ledger', 'team_workflows', 'team_runs'];

const TASK_TRANSITIONS = {
  queued: ['submitted'], submitted: ['working'],
  working: ['completed', 'reworked', 'settle'], reworked: ['working', 'settle'],
  completed: ['settle', 'reworked'], settle: [],
};

// Opened domain handles persist at module scope so a re-apply (double mount)
// reuses the same handle instead of re-opening (which throws `already-open`).
const domainHandles = {};

// Runs this process is actually driving. A live run must never be reaped by a
// re-apply, so any run still marked `running` that is absent here was orphaned
// when a previous process exited (its child agents died with that process).
const liveRuns = new Set();
let startupReapDone = false;

// Resolve a live parent Agent for in-process subagent spawns. The spawn driver
// (`startInProcessRun`) reads `request.signal.aborted` and calls
// `parent.ctx.agents.create(...)`, so both a real AbortSignal and a real live
// Agent are required. Prefer the process-local initiator (the tool path); an
// agentless HTTP route has none, so fall back to the newest top-level live root
// -- `roots()` is oldest-first, so the last entry is the most recently created
// agent and therefore the likeliest live GUI session.
const resolveParentAgent = (c) => {
  const svc = c.get('agents');
  if (svc === undefined) return undefined;
  const init = svc.currentInitiator();
  if (init !== undefined) return init;
  const roots = typeof svc.roots === 'function' ? svc.roots() : [];
  return roots.length ? roots[roots.length - 1] : undefined;
};

// Team workers are autonomous role agents. They must never inherit tools that
// can block indefinitely -- a human prompt, or a browser page that may not be
// connected -- nor the harness/orchestration tooling that only makes sense for
// the top-level coding agent. Without this deny-list a worker can call e.g.
// `cordis_inspect_query` with platform:'client', which by design waits for a
// live page response and never returns; that hangs `run.result`, pins the node
// task at `working`, and leaves the whole run `running` forever.
const WORKER_DENY_TOOLS = [
  'ask_user_question', 'exit_plan_mode',
  'cordis_define', 'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
  'cordis_run', 'cordis_stop', 'cordis_undefine',
  'create_goal', 'update_goal', 'get_goal',
  'ralph', 'workflow', 'subagent', 'subagent_fork',
  'interrupt_agent', 'send_message', 'list_agents',
  'team_create_agent', 'team_create_task', 'team_create_workflow',
  'team_delegate_agent', 'team_list_agents', 'team_run_workflow', 'team_task_status',
];

// ---- P10 review engine: hard limits (pure data, no ctx, unit-testable) ----
// The ONE placeholder literal for a node nobody owns. /progress's role roll-up and
// /role must agree on it: a role with two names is a role whose detail is
// unreachable, because the UI's chip comes from the roll-up while the lookup comes
// from /role. (The client is a separate bundle and cannot import this, so
// validation/p8-acceptance.mjs asserts the two agree at runtime.)
const UNASSIGNED_ROLE = '(未指派)';
// Every one of these is a MECHANICAL bound on how long an added review step can
// stretch a run. `maxReworkPerRun` is the master gate: even if every node in a
// workflow asks for a rework, the whole run may not re-dispatch a worker more
// than 3 extra times, so the total work is bounded by construction rather than
// by trusting the reviewer's judgement.
export const REVIEW_LIMITS = {
  timeoutMs: 600000,
  maxFindings: 20,
  maxReworkPerNode: 2,
  maxReworkPerRun: 3,
  artifactMax: 20000,
};

// The five dimensions every review must answer. Fixed on purpose: a free-form
// dimension list makes reviewers invent axes ("code smell", "naming") and turn
// advisory taste into blocking findings.
const REVIEW_DIMENSIONS = [
  ['需求符合性', '产物是否覆盖了任务要求与验收标准的每一条？有没有漏项、或有自行改需求？'],
  ['正确性', '事实、代码、路径、命令、接口签名是否准确？有没有错误断言或与既有事实矛盾之处？'],
  ['完整性', '交付物是否自洽可执行（能跑、能验收）？边界情况与失败路径是否交代？'],
  ['风险', '有没有会导致失败、数据丢失、安全或不可逆后果的隐含假设与缺口？'],
  ['优化空间', '是否有更简单、更省时、更易维护的做法？不得为风格而提。'],
];

// The judgement discipline is written into the prompt VERBATIM in intent: the
// whole point of P10 is that a reviewer cannot block on taste, and cannot block
// without a citation, no matter how the model feels about the deliverable.
const REVIEW_DISCIPLINE = [
  '判定纪律（必须严格遵守）：',
  '1. blocking 只有在以下三种情况才允许：明确违反某条验收标准；存在会让交付物失败或错误的具体缺陷；存在数据丢失/安全/不可逆风险。',
  '2. 每条 blocking 必须给出 criterion（违反了哪条验收标准，或写“缺陷”“风险”）、evidence（交付物原文引用，或可复现命令与输出）、impact（不修会怎样）。证据不足的一律不得标为 blocking。',
  '3. 风格、命名、可读性、补充测试、更优方案一律 advisory，永不阻塞。',
  '4. 没有 blocking 条目时 verdict 必须为 "pass"，即使存在 advisory；禁止为了显得尽责而制造 blocking；不要评审与本任务无关的既有代码。',
  '5. 无法判断的写进 uncertainties，不得当作 blocking。',
  '6. round >= 2（返工复审）时：只允许核对上一轮列出的阻塞项是否解决，禁止提出新的 blocking，新发现一律 advisory；每条上一轮的阻塞项都要出现在 resolved 数组里并给出 resolved 与 evidence。',
];

const REVIEW_JSON_CONTRACT = '{"verdict":"pass"|"rework","score":0-100,"summary":"一句话结论","findings":[{"severity":"blocking"|"advisory","dimension":"需求符合性"|"正确性"|"完整性"|"风险"|"优化空间","criterion":"...","evidence":"...","impact":"...","suggestion":"..."}],"resolved":[{"finding":"...","resolved":true,"evidence":"..."}],"uncertainties":["..."]}';

// A reviewer may only cite an artifact slice of this size; the truncation is
// STATED in the prompt rather than silently applied, so a reviewer never marks
// a node blocking over content it was not shown.
export function buildReviewPrompt(spec) {
  const s = spec || {};
  const round = typeof s.round === 'number' && s.round > 0 ? s.round : 1;
  const lines = [];
  lines.push('你是本工作流的独立评审者。你的职责是复核下面这个已交付节点的产物，并给出可机械执行的结构化结论。');
  lines.push('这是第 ' + round + ' 轮评审（round=' + round + '）。' + (round >= 2 ? '这是返工之后的复审：你只能核对上一轮列出的阻塞项是否已解决，禁止提出新的 blocking。' : '这是首轮评审。'));
  lines.push('');
  lines.push('## 被审节点');
  lines.push('- 节点标题：' + (s.title === undefined || s.title === null || s.title === '' ? '（未命名）' : String(s.title)));
  lines.push('- 节点 id：' + (s.nodeId === undefined || s.nodeId === null ? '' : String(s.nodeId)));
  lines.push('- 承担角色：' + (s.agentName === undefined || s.agentName === null ? '（未指派）' : String(s.agentName)));
  lines.push('');
  lines.push('## 任务要求');
  lines.push(s.requirement === undefined || s.requirement === null || s.requirement === '' ? '（未提供）' : String(s.requirement));
  lines.push('');
  lines.push('## 验收标准');
  lines.push(s.acceptanceCriteria === undefined || s.acceptanceCriteria === null || s.acceptanceCriteria === '' ? '（未提供）' : String(s.acceptanceCriteria));
  lines.push('');
  if (Array.isArray(s.knownBlocking) && s.knownBlocking.length) {
    lines.push('## 上一轮列出的阻塞项（本轮必须逐条在 resolved 里回应）');
    for (let i = 0; i < s.knownBlocking.length; i++) lines.push('- ' + String(s.knownBlocking[i]));
    lines.push('');
  }
  lines.push('## 交付物全文');
  if (s.artifactTruncated === true) lines.push('（注意：交付物超出 ' + REVIEW_LIMITS.artifactMax + ' 字符已截断，仅评审前 ' + REVIEW_LIMITS.artifactMax + ' 字符；未展示的部分不得作为 blocking 依据。）');
  lines.push(s.artifact === undefined || s.artifact === null || s.artifact === '' ? '（交付物为空）' : String(s.artifact));
  lines.push('');
  lines.push('## 五个固定评审维度（findings[].dimension 只能取这五个之一）');
  for (const d of REVIEW_DIMENSIONS) lines.push('- ' + d[0] + '：' + d[1]);
  lines.push('');
  for (const d of REVIEW_DISCIPLINE) lines.push(d);
  lines.push('');
  lines.push('## 输出契约');
  lines.push('只输出这一个 JSON 对象（可以放在 ```json 代码块里），不要输出任何其它内容、解释或前后缀：');
  lines.push(REVIEW_JSON_CONTRACT);
  lines.push('字段含义：verdict 为 "pass" 表示通过（没有 blocking 时必须为 "pass"），"rework" 表示必须返工（必须至少有一条合格 blocking）；score 为 0-100 的整数；findings 为全部发现（含 advisory）；resolved 为对上一轮阻塞项的逐条回应；uncertainties 为你无法判断的点。');
  return lines.join('\n');
}

// The rework prompt carries the blocking findings VERBATIM. A re-dispatch is a
// second full worker call, so its input has to be exactly "these defects, fix
// them" -- no new scope, no refactor, or the rework costs more than the node.
export function buildReworkPrompt(spec) {
  const s = spec || {};
  const round = typeof s.round === 'number' && s.round > 0 ? s.round : 1;
  const items = Array.isArray(s.blocking) ? s.blocking : [];
  const lines = [];
  lines.push('你是 ' + (s.who === undefined || s.who === null || s.who === '' ? '本节点' : String(s.who)) + '，这是对你上一次交付物的第 ' + round + ' 轮返工要求。评审者判定必须返工，下面列出全部阻塞项，请逐条修复。');
  lines.push('');
  lines.push('## 原任务要求');
  lines.push(s.requirement === undefined || s.requirement === null || s.requirement === '' ? '（未提供）' : String(s.requirement));
  lines.push('');
  lines.push('## 验收标准');
  lines.push(s.acceptanceCriteria === undefined || s.acceptanceCriteria === null || s.acceptanceCriteria === '' ? '（未提供）' : String(s.acceptanceCriteria));
  lines.push('');
  lines.push('## 必须逐条修复的阻塞项（共 ' + items.length + ' 条，原文照录）');
  if (items.length === 0) lines.push('（无）');
  for (let i = 0; i < items.length; i++) {
    const f = items[i] || {};
    lines.push('### 阻塞项 ' + (i + 1));
    lines.push('- criterion（违反了哪条验收标准）：' + (f.criterion === undefined || f.criterion === null ? '' : String(f.criterion)));
    lines.push('- evidence（证据）：' + (f.evidence === undefined || f.evidence === null ? '' : String(f.evidence)));
    lines.push('- impact（不修会怎样）：' + (f.impact === undefined || f.impact === null ? '' : String(f.impact)));
    lines.push('- suggestion（建议）：' + (f.suggestion === undefined || f.suggestion === null ? '' : String(f.suggestion)));
  }
  lines.push('');
  lines.push('## 返工要求');
  lines.push('1. 逐条修复上面每一个阻塞项，并在回复中逐条说明你改了什么（对应哪条阻塞项、改了哪里、怎么验证）。');
  lines.push('2. 不得扩大改动范围：只修上面列出的阻塞项，不得做与本任务无关的重构、改名、清理或新增功能。');
  lines.push('3. 不要重新设计已经满足要求的部分；除非阻塞项本身要求，否则保持原有结构与结论不变。');
  lines.push('4. 交付物仍须满足上面的任务要求与验收标准。');
  return lines.join('\n');
}

// Text -> verdict object. Two extraction strategies, both bounded:
//   1. the LAST ```json fenced block (a reviewer that narrates before its JSON
//      would otherwise be parsed against a stale earlier object),
//   2. otherwise a brace-matching scan that is string/escape aware, so a JSON
//      excerpt INSIDE the artifact (or a quoted "}") cannot truncate the parse.
// Never throws: a reviewer that produced garbage must not fail the node, so the
// failure is reported as data (`parsed: null` + a reason) not as an exception.
export function parseReviewVerdict(text) {
  const raw = typeof text === 'string' ? text : (text === undefined || text === null ? '' : String(text));
  const out = { raw, parsed: null, parseError: null };
  if (typeof text !== 'string' || text.trim() === '') {
    out.parseError = '评审者输出为空或不是字符串';
    return out;
  }
  const adopt = (candidate, source) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    out.parsed = candidate;
    out.parseError = null;
    out.source = source;
    return true;
  };
  // 1) the LAST ```json ... ``` fence.
  const fences = [];
  const fenceRe = /```json([\s\S]*?)```/gi;
  let m;
  while ((m = fenceRe.exec(raw)) !== null) fences.push(m[1]);
  if (fences.length === 0) {
    const anyFence = /```([\s\S]*?)```/g;
    while ((m = anyFence.exec(raw)) !== null) fences.push(m[1]);
  }
  if (fences.length > 0) {
    const lastFence = fences[fences.length - 1];
    try { if (adopt(JSON.parse(lastFence.trim()), 'fence')) return out; }
    catch (e) { out.parseError = '```json 围栏内不是合法 JSON：' + String(e && e.message ? e.message : e); }
    // The fence may itself contain the object with the braces; fall through to
    // the brace scan on that fence's text before giving up.
    const inner = lastBraceObject(lastFence);
    if (inner !== null) {
      try { if (adopt(JSON.parse(inner), 'fence-scan')) return out; }
      catch (e) { out.parseError = '```json 围栏内括号配对结果不是合法 JSON：' + String(e && e.message ? e.message : e); }
    }
    // The fence parsed but its top level was not an object (an array or a scalar):
    // JSON.parse succeeded, so no catch above ran, and without this the caller got
    // parsed:null with parseError:null -- i.e. the reviewer's failure had no
    // recorded reason at all.
    if (out.parseError === null) {
      out.parseError = '```json 围栏内容不是对象（围栏顶层是数组或标量），无法作为评审结论';
    }
    return out;
  }
  // 2) brace matching: last complete top-level {...}, string- and escape-aware.
  const scanned = lastBraceObject(raw);
  if (scanned === null) {
    out.parseError = '未找到 ```json 围栏，也未找到成对的 {...} 对象';
    return out;
  }
  try { if (adopt(JSON.parse(scanned), 'scan')) return out; }
  catch (e) { out.parseError = '括号配对取出的对象不是合法 JSON：' + String(e && e.message ? e.message : e); }
  return out;
}

// The last balanced top-level {...} in `s`, or null. Braces inside JSON strings
// are skipped, and a backslash escapes the next character, so `{"a":"}"}` and
// `{"a":"\\"}"}` both scan correctly. Nested objects are handled by depth, and
// the LAST top-level object wins (reviewers that echo an example first).
function lastBraceObject(s) {
  const text = typeof s === 'string' ? s : '';
  const spans = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth += 1; continue; }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) { spans.push(text.slice(start, i + 1)); start = -1; }
      }
      continue;
    }
  }
  return spans.length ? spans[spans.length - 1] : null;
}

// Canonical form of a criterion used ONLY for matching "same blocking item as
// last round": trim, drop ALL whitespace, lowercase, drop common CN/EN
// punctuation. Implemented by hand (no deps) and deliberately aggressive --
// a reviewer that re-words punctuation must not thereby create a "new" blocker.
function canonCriterion(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[，。、；：！？“”‘’（）《》【】·…—～,.;:!?"'()<>[\]{}\-_/\\|`~@#$%^&*+=]/g, '');
}

// The mechanical fallback layer. Every rule below is a pure function of the
// raw payload, so the same reviewer output always normalises to the same
// verdict -- no "judgement calls" anywhere. Each intervention appends one
// Chinese note naming the rule that fired, so a surprising result is auditable.
export function normalizeReview(raw, opts) {
  const o = opts || {};
  const round = typeof o.round === 'number' && o.round > 0 ? Math.floor(o.round) : 1;
  const knownBlocking = Array.isArray(o.knownBlocking) ? o.knownBlocking : [];
  const known = [];
  for (const k of knownBlocking) { const c = canonCriterion(k); if (c !== '') known.push(c); }
  const notes = [];
  const result = {
    verdict: 'error', score: null, summary: '', findings: [], resolved: [], uncertainties: [],
    blockingCount: 0, advisoryCount: 0, notes, parseError: o.parseError === undefined ? null : o.parseError,
  };
  // R1 -- a missing/broken payload is the REVIEWER's problem, never the node's:
  // it must never block, so it settles as 'error' with zero findings.
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('R1：评审者未返回可解析的对象（parseError=' + String(result.parseError) + '），按不阻塞处理，verdict=error');
    result.summary = '评审未生效：评审者未返回可解析的结论，本节点未经实质评审。';
    return result;
  }
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : [];
  const findings = [];
  for (let i = 0; i < rawFindings.length; i++) {
    const f = rawFindings[i];
    const src = (f !== null && typeof f === 'object' && !Array.isArray(f)) ? f : {};
    const criterion = src.criterion === undefined || src.criterion === null ? '' : String(src.criterion);
    const evidence = src.evidence === undefined || src.evidence === null ? '' : String(src.evidence);
    const impact = src.impact === undefined || src.impact === null ? '' : String(src.impact);
    const suggestion = src.suggestion === undefined || src.suggestion === null ? '' : String(src.suggestion);
    const rawSeverity = src.severity;
    let severity;
    let downgraded = false;
    let downgradeReason = null;
    // R2 -- anything that is not literally a known severity is advisory. The
    // invariant is one-way: a non-blocking input can NEVER be upgraded, so a
    // reviewer using a wrong enum name costs at most a note, never a rework.
    if (rawSeverity === 'blocking') severity = 'blocking';
    else {
      severity = 'advisory';
      if (rawSeverity !== 'advisory') {
        downgraded = true;
        downgradeReason = 'R2：severity 不是 "blocking" 也不是 "advisory"（实际为 ' + JSON.stringify(rawSeverity === undefined ? null : rawSeverity) + '），按 advisory 处理，非法严重度不得阻塞';
      }
    }
    // R3 -- a blocking item must be doubly verifiable (which clause + where).
    // Emotion without a citation cannot structurally trigger a rework.
    if (severity === 'blocking') {
      if (criterion.trim() === '') {
        severity = 'advisory'; downgraded = true;
        downgradeReason = 'R3：标为 blocking 但 criterion 为空白，缺少"违反了哪条"的依据，降级为 advisory';
      } else if (evidence.trim().length < 8) {
        severity = 'advisory'; downgraded = true;
        downgradeReason = 'R3：标为 blocking 但 evidence 去空白后只有 ' + evidence.trim().length + ' 字符（< 8），证据不足，降级为 advisory';
      }
    }
    // R4 -- in a rework re-review (round >= 2) only the PREVIOUS round's
    // blocking items may block. Otherwise every round can invent one more
    // blocker and the task never converges ("永远差一条").
    if (severity === 'blocking' && round >= 2) {
      const c = canonCriterion(criterion);
      if (c === '' || known.indexOf(c) === -1) {
        severity = 'advisory'; downgraded = true;
        downgradeReason = 'R4：复审不得新增阻塞项（防止无限拉长任务）：该 criterion 不在上一轮阻塞项集合内，降级为 advisory';
      }
    }
    const dimension = typeof src.dimension === 'string' && src.dimension.trim() !== '' ? src.dimension : null;
    findings.push({
      severity, downgraded, downgradeReason,
      dimension,
      criterion: criterion.trim() === '' ? null : criterion,
      evidence: evidence.trim() === '' ? null : evidence,
      impact: impact.trim() === '' ? null : impact,
      suggestion: suggestion.trim() === '' ? null : suggestion,
    });
  }
  // R5 -- bound the payload: a reviewer that emits 200 findings must not turn
  // /progress into a heavy response.
  let kept = findings;
  if (findings.length > REVIEW_LIMITS.maxFindings) {
    kept = findings.slice(0, REVIEW_LIMITS.maxFindings);
    notes.push('R5：findings 共 ' + findings.length + ' 条，超过上限 ' + REVIEW_LIMITS.maxFindings + ' 条，已截断为前 ' + REVIEW_LIMITS.maxFindings + ' 条');
  }
  for (const f of kept) if (f.downgraded && f.downgradeReason) notes.push(f.downgradeReason);
  result.findings = kept;
  result.blockingCount = kept.filter((f) => f.severity === 'blocking').length;
  result.advisoryCount = kept.filter((f) => f.severity !== 'blocking').length;
  const rawScore = typeof raw.score === 'number' && isFinite(raw.score) ? Math.round(raw.score) : null;
  result.score = rawScore === null ? null : Math.max(0, Math.min(100, rawScore));
  const rawSummary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  const wantsRework = raw.verdict === 'rework';
  // R6 -- "rework" with nothing blocking is self-contradictory; without this the
  // verdict string alone could stretch a task with no stated reason.
  let verdict = wantsRework ? 'rework' : 'pass';
  if (verdict === 'rework' && result.blockingCount === 0) {
    verdict = 'pass';
    notes.push('R6：结论自相矛盾：rework 但无阻塞项，按不阻塞处理，verdict 改为 pass');
  }
  result.verdict = verdict;
  result.summary = rawSummary !== '' ? rawSummary : (verdict === 'pass' ? '评审通过（评审者未提供摘要）' : '评审要求返工（评审者未提供摘要）');
  const rawResolved = Array.isArray(raw.resolved) ? raw.resolved : [];
  result.resolved = rawResolved.map((r) => {
    const src = (r !== null && typeof r === 'object' && !Array.isArray(r)) ? r : {};
    return {
      finding: src.finding === undefined || src.finding === null ? (src.criterion === undefined || src.criterion === null ? null : String(src.criterion)) : String(src.finding),
      resolved: src.resolved === true,
      evidence: src.evidence === undefined || src.evidence === null ? null : String(src.evidence),
    };
  });
  const rawUnc = Array.isArray(raw.uncertainties) ? raw.uncertainties : [];
  result.uncertainties = rawUnc.map((u) => (typeof u === 'string' ? u : (u === null || u === undefined ? '' : String(u)))).filter((u) => u !== '');
  return result;
}

// A child that never settles must not pin the run forever. This is a backstop,
// not the anti-hang mechanism: the dispatch guard below already refuses the
// calls that can block indefinitely, so what remains here is a legitimately slow
// role. Ten minutes cut a real Tester off mid-verification (observed node
// runtimes: plan 2m, code 9m, review 3m, test >10m), so the bound is set well
// above them.
const NODE_TIMEOUT_MS = 30 * 60 * 1000;
// The role view shows the worker's COMPLETE report. The task ledger already
// stores it verbatim, so this cap bounds only what one HTTP response carries.
const NODE_OUTPUT_MAX = 60000;
// ...and bound the whole /role response too, not just each node: a role with
// many nodes is otherwise re-sent in full on every 5s poll.
const NODE_OUTPUT_MAX_TOTAL = 120000;
// A reasoning block can be very large at high effort. Keep a bounded trace and
// report its true length, so a capped trace is never mistaken for a short one.
const REASONING_MAX = 12000;
const withTimeout = (p, ms, label) => {
  let timer;
  const guard = new Promise((_res, rej) => {
    timer = setTimeout(() => rej(new Error('team-flowise: ' + label + ' timed out after ' + ms + 'ms')), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
};

// Apply the stored agent definition (model route, persona, tool policy) to a
// spawned child, and start it. The workflow runner previously ignored all of
// these, so every child ran the caller's default route and the full
// coding-agent toolset instead of its configured role.
export function apply(ctx) {
  const disposers = [];
  const domainReady = {};
  const openedByThis = [];
  const openDomain = (spec) => {
    if (domainHandles[spec.name] !== undefined) { domainReady[spec.name] = Promise.resolve(domainHandles[spec.name]); return; }
    domainReady[spec.name] = ctx.storageDomain.open(spec).then((d) => { domainHandles[spec.name] = d; openedByThis.push(d); return d; });
    domainReady[spec.name].catch((e) => console.error('team-flowise: open domain failed', spec.name, String(e)));
  };
  openDomain(agentDefsDomain); openDomain(taskLedgerDomain); openDomain(workflowsDomain); openDomain(runsDomain);
  ctx.effect(() => () => { for (const d of openedByThis) d.close(); });
  ctx.effect(() => () => { for (const d of disposers) d(); });

  // Tool names visible to the worker's scope, used to validate the deny-list.
  // `tools.restrict()` rejects any name it does not know, and most tools live on
  // the agent plane rather than the global layer, so the scope matters: pass the
  // parent agent (the child composes from it). Without a parent, fall back to the
  // global view, which is the safe subset every agent inherits.
  const knownToolNames = (parent) => {
    const toolsSvc = ctx.get('tools');
    if (toolsSvc === undefined || typeof toolsSvc.schemas !== 'function') return undefined;
    try {
      const names = new Set();
      for (const s of toolsSvc.schemas(parent)) if (s && typeof s.name === 'string') names.add(s.name);
      return names;
    } catch (e) { return undefined; }
  };
  // A stored model route is only usable when its provider has a registered
  // adapter; otherwise the child's very first request dies with NO_ADAPTER.
  const providerRegistered = (provider) => {
    const llm = ctx.get('llm');
    if (llm === undefined || typeof llm.listProviders !== 'function') return true;
    try {
      const list = llm.listProviders() || [];
      return list.some((p) => p && p.id === provider);
    } catch (e) { return true; }
  };
  const spawnSpecFor = (def, parent) => {
    const model = (def && def.model) || {};
    const defTools = (def && def.tools) || {};
    // Pass EVERY name: the runtime validates a filter against the CHILD's own
    // scope and rejects the whole filter on one unknown name. Pre-filtering
    // against a locally computed view silently produced an EMPTY deny-list --
    // i.e. a worker holding the full 41-tool coding surface, including the very
    // client-Inspect tool this policy exists to withhold.
    const deny = [];
    for (const name of WORKER_DENY_TOOLS) if (deny.indexOf(name) === -1) deny.push(name);
    for (const name of defTools.deny || []) if (deny.indexOf(name) === -1) deny.push(name);
    // An explicit allow-list wins, but a blocking tool is never re-admitted.
    const allow = (defTools.allow || []).filter((n) => WORKER_DENY_TOOLS.indexOf(n) === -1);
    const spec = {};
    if (model.provider && model.model) {
      if (providerRegistered(model.provider)) spec.agentOptions = { provider: model.provider, model: model.model };
      else console.warn('team-flowise: no adapter registered for provider "' + model.provider + '"; worker inherits the caller route');
    }
    if (def && def.systemPrompt) spec.persona = def.systemPrompt;
    if (allow.length) spec.toolFilter = { allow };
    else if (deny.length) spec.toolFilter = { deny };
    return spec;
  };
  // Reported per node purely as evidence of what the runtime saw: an empty or
  // missing view here is what used to collapse the deny-list to nothing.
  const parentToolNote = (parent) => {
    const names = knownToolNames(parent);
    return names === undefined ? 'visible=unavailable' : 'visible=' + names.size;
  };
  // The names a rejected filter reported (`... unknown global tool "a", "b";
  // known global tools: ...`): only the offending names are quoted.
  const rejectedNames = (msg) => {
    const out = [];
    const re = /"([^"]*)"/g;
    let m;
    while ((m = re.exec(msg)) !== null) if (m[1]) out.push(m[1]);
    return out;
  };
  const shrinkFilter = (filter, bad) => {
    const next = {};
    if (filter.allow !== undefined) { const a = filter.allow.filter((n) => bad.indexOf(n) === -1); if (a.length) next.allow = a; }
    if (filter.deny !== undefined) { const d = filter.deny.filter((n) => bad.indexOf(n) === -1); if (d.length) next.deny = d; }
    return next.allow === undefined && next.deny === undefined ? undefined : next;
  };
  // Start one worker under the configured tool policy and report what policy
  // actually took effect. A filter the runtime rejects is narrowed to exactly the
  // names it reported and retried; dropping the filter outright -- the previous
  // fallback -- is what left workers fully unrestricted.
  const startWorker = async (subagentsSvc, base, spec, note0) => {
    let filter = spec.toolFilter;
    let note = (note0 ? note0 + ' ' : '') + (filter === undefined ? 'no tool filter' : 'filter=' + JSON.stringify(filter));
    for (let attempt = 0; ; attempt++) {
      const merged = Object.assign({}, base, spec);
      if (filter === undefined) delete merged.toolFilter; else merged.toolFilter = filter;
      try {
        return { run: await subagentsSvc.start('spawn', merged), note };
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (filter === undefined || attempt >= 8 || !/unknown global tool/i.test(msg)) throw e;
        const bad = rejectedNames(msg);
        const next = bad.length === 0 ? undefined : shrinkFilter(filter, bad);
        note = next === undefined
          ? (note0 ? note0 + ' ' : '') + 'no tool filter: ' + msg
          : (note0 ? note0 + ' ' : '') + 'filter=' + JSON.stringify(next) + ' (dropped unknown: ' + bad.join(', ') + ')';
        console.warn('team-flowise: worker ' + note);
        filter = next;
      }
    }
  };

  // A worker can never answer a human prompt or wait for a browser page, and
  // `cordis_inspect_query({platform:'client'})` blocks until a live page replies.
  // That is enforced here, at dispatch, so it holds even if a tool filter was
  // rejected or silently not applied: without it one such call pins the child --
  // and therefore the node, the task, and the whole run -- indefinitely.
  const WORKER_BLOCKED_AT_DISPATCH = ['ask_user_question', 'exit_plan_mode'];
  const workerDepth = (agent) => {
    if (agent === undefined || agent === null) return 0;
    const header = agent.session && agent.session.header;
    const runtime = agent.options && agent.options.subagentDepth;
    const a = header && typeof header.delegationDepth === 'number' ? header.delegationDepth : 0;
    const b = typeof runtime === 'number' ? runtime : 0;
    return Math.max(a, b);
  };
  const workerToolGuard = (exec) => {
    if (exec === undefined || exec === null) return undefined;
    if (workerDepth(exec.agent) < 1) return undefined;
    const name = exec.name;
    if (WORKER_BLOCKED_AT_DISPATCH.indexOf(name) !== -1) return 'team-flowise: "' + name + '" is not available to a delegated worker (no human is attached to this session); report the need in your reply instead';
    if (name === 'cordis_inspect_query') {
      const args = exec.arguments || {};
      if (args.platform === 'client') return 'team-flowise: client-platform Cordis inspection is not available to a delegated worker (it waits for a live browser page); query the host platform instead';
    }
    return undefined;
  };
  const guardTools = ctx.get('tools');
  if (guardTools !== undefined && typeof guardTools.guard === 'function') {
    try { ctx.effect(() => guardTools.guard(workerToolGuard)); }
    catch (e) { console.warn('team-flowise: could not install the worker dispatch guard: ' + String(e)); }
  } else {
    console.warn('team-flowise: tools.guard() unavailable; workers are only bounded by the tool filter and the per-node timeout');
  }

  const withTable = async (domainName, tableName, fn) => { const d = await domainReady[domainName]; if (!d) throw new Error('team-flowise: domain not ready ' + domainName); return fn(d.table(tableName)); };
  const clean = (v) => { if (Array.isArray(v)) return v.map(clean); if (v === null || typeof v !== 'object') return v; const r = {}; for (const k in v) { const x = clean(v[k]); if (x !== undefined) r[k] = x; } return r; };

  // ---- catalog ----
  const upsertAgent = async (def) => {
    const rec = agentDefSchema.parse(clean({ id: (def && def.id) || makeId(), name: def && def.name, role: def && def.role, systemPrompt: def && def.systemPrompt, model: (def && def.model) || {}, skills: (def && def.skills) || [], tools: (def && def.tools) || {}, permissionPolicy: def && def.permissionPolicy, updatedAt: now() }));
    await withTable('team_agent_defs', 'defs', (t) => t.put(rec.id, rec)); return rec;
  };
  const listAgents = async () => withTable('team_agent_defs', 'defs', (t) => [...t.entries()].map(([, v]) => v));
  const deleteAgent = async (id) => withTable('team_agent_defs', 'defs', (t) => t.delete(id));
  const upsertWorkflow = async (wf) => {
    // The workflow-level review defaults (default reviewer + rework cap) are part
    // of the schema, so they MUST survive the write path. Building the record
    // field-by-field silently dropped them, which made every workflow-level
    // `review` setting unreachable through the real API and through the
    // team_create_workflow tool: a workflow could declare "the Reviewer reviews
    // every node" and nothing would ever be reviewed.
    const rec = workflowSchema.parse(clean({ id: (wf && wf.id) || makeId(), name: wf && wf.name, description: wf && wf.description, nodes: (wf && wf.nodes) || {}, review: wf && wf.review, updatedAt: now() }));
    await withTable('team_workflows', 'flows', (t) => t.put(rec.id, rec)); return rec;
  };
  const listWorkflows = async () => withTable('team_workflows', 'flows', (t) => [...t.entries()].map(([, v]) => v));
  const deleteWorkflow = async (id) => withTable('team_workflows', 'flows', (t) => t.delete(id));
  const listRuns = async () => withTable('team_runs', 'runs', (t) => [...t.entries()].map(([, v]) => v));
  const getRun = async (id) => withTable('team_runs', 'runs', (t) => t.get(id) || null);

  // ---- progress data plane (read-only) ----
  // The board needs one self-contained payload: which nodes exist, who owns each
  // one, and where each one stands. Node ids come from the WORKFLOW DEFINITION,
  // not from `run.nodeStates`, so a node that has not started yet still appears
  // (as `pending`) instead of silently vanishing from the picture.
  const latestRun = async () => {
    let best = null;
    for (const r of await listRuns()) {
      if (!r || typeof r.id !== 'string') continue;
      if (best === null) { best = r; continue; }
      const a = typeof r.startedAt === 'number' ? r.startedAt : 0;
      const b = typeof best.startedAt === 'number' ? best.startedAt : 0;
      if (a > b) best = r;
    }
    return best;
  };
  // A node's `agent` may be a definition id or a name -- workflows written at
  // different times use either -- so the UI must group by ONE canonical role
  // name, or a single role shows up as two separate columns.
  const roleNamer = async () => {
    const defs = await listAgents();
    return (ref) => {
      if (ref === undefined || ref === null || ref === '') return null;
      const d = defs.find((x) => x.id === ref || x.name === ref);
      return (d && (d.name || d.role)) || String(ref);
    };
  };
  const brief = (s, n) => { const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''; return t.length > n ? t.slice(0, n) + '…' : t; };
  // A readable name for one node, so the UI never has to lead with a raw id.
  // Preference: an explicit node title, then the 【…】/[…] tag a requirement
  // conventionally opens with, then the requirement's own opening words.
  const nodeTitle = (def, requirement) => {
    if (def && typeof def.title === 'string' && def.title.trim() !== '') return def.title.trim();
    const req = typeof requirement === 'string' ? requirement : '';
    const tag = req.match(/[【\[]([^】\]]{2,40})[】\]]/);
    if (tag) return tag[1].trim();
    return brief(req, 40);
  };
  // The worker's own opening line is the most honest one-line summary of what it
  // produced, and cheap enough to keep on every node for the light payload.
  const firstLine = (s, n) => {
    const line = String(s === undefined || s === null ? '' : s).split('\n').map((x) => x.trim()).filter((x) => x !== '')[0] || '';
    const plain = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    return plain.length > n ? plain.slice(0, n) + '…' : plain;
  };
  const ownerOf = (st, def) => (st.assignee !== undefined ? st.assignee : (def.agent !== undefined ? def.agent : null));

  // ---- P10 review read model ----
  // The full `review` object on a node state carries the reviewer's complete
  // findings, which is far too heavy for a 3-second poll. /progress gets this
  // light projection instead; the full record is served by /role on demand.
  const lightReview = (rv) => {
    if (rv === null || rv === undefined || typeof rv !== 'object') return null;
    return {
      verdict: rv.verdict === undefined ? null : rv.verdict,
      blocking: typeof rv.blockingCount === 'number' ? rv.blockingCount : 0,
      advisory: typeof rv.advisoryCount === 'number' ? rv.advisoryCount : 0,
      unresolved: rv.unresolved === true,
      rounds: typeof rv.rounds === 'number' ? rv.rounds : 0,
      reviewerName: rv.reviewerName === undefined ? null : rv.reviewerName,
      elapsedMs: typeof rv.elapsedMs === 'number' ? rv.elapsedMs : null,
      summary: rv.summary === undefined ? null : rv.summary,
    };
  };
  // Node status -> the six totals buckets. `reviewing` and `rework` MUST be
  // explicit branches: the old `else pending += 1` swallowed every unknown
  // status, which would report a node that is being reviewed as "waiting"
  // (i.e. "not started yet") -- a directionally wrong statement, not a rounding
  // error. `percent` is deliberately NOT derived from these; it stays
  // completed/total so its meaning is unchanged.
  const bucketOf = (status) => {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'working') return 'working';
    if (status === 'reviewing') return 'reviewing';
    if (status === 'rework') return 'rework';
    return 'pending';
  };
  // A reviewer's track record across the run, keyed by the SAME normalised role
  // name the role roll-up uses, so the UI can cross-reference the two.
  const reviewerRollup = (nodes) => {
    const list = [];
    for (const n of nodes) {
      const rv = n.review && typeof n.review === 'object' ? n.review : null;
      const name = (rv && rv.reviewerName) || n.reviewer;
      if (name === undefined || name === null || name === '') continue;
      let r = list.find((x) => x.name === name);
      if (!r) { r = { name, reviewed: 0, pass: 0, rework: 0, error: 0, blocking: 0, advisory: 0, unresolved: 0, elapsedMs: 0 }; list.push(r); }
      if (rv !== null) {
        r.reviewed += 1;
        if (rv.verdict === 'pass') r.pass += 1;
        else if (rv.verdict === 'rework') r.rework += 1;
        else r.error += 1;
        r.blocking += typeof rv.blocking === 'number' ? rv.blocking : 0;
        r.advisory += typeof rv.advisory === 'number' ? rv.advisory : 0;
        if (rv.unresolved === true) r.unresolved += 1;
        if (typeof rv.elapsedMs === 'number') r.elapsedMs += rv.elapsedMs;
      }
    }
    return list;
  };

  const progressSummary = async (runId) => {
    const run = runId ? await getRun(runId) : await latestRun();
    if (!run) return { ok: true, run: null, nodes: [], roles: [], reviewers: [], totals: { total: 0, completed: 0, failed: 0, working: 0, reviewing: 0, rework: 0, unresolved: 0, pending: 0, percent: 0 } };
    const wf = run.workflowId ? await withTable('team_workflows', 'flows', (t) => t.get(run.workflowId)) : null;
    const states = run.nodeStates && typeof run.nodeStates === 'object' ? run.nodeStates : {};
    const defs = wf && wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : null;
    // A deleted/renamed workflow must not blank the board: fall back to whatever
    // the run itself recorded.
    const ids = defs ? Object.keys(defs) : Object.keys(states);
    const nameOf = await roleNamer();
    const at = now();
    let completed = 0; let failed = 0; let working = 0; let pending = 0; let reviewing = 0; let rework = 0; let unresolved = 0;
    const nodes = ids.map((nid, order) => {
      const def = (defs && defs[nid]) || {};
      const st = states[nid] && typeof states[nid] === 'object' ? states[nid] : {};
      const status = typeof st.status === 'string' ? st.status : 'pending';
      const bucket = bucketOf(status);
      if (bucket === 'completed') completed += 1;
      else if (bucket === 'failed') failed += 1;
      else if (bucket === 'working') working += 1;
      else if (bucket === 'reviewing') reviewing += 1;
      else if (bucket === 'rework') rework += 1;
      else pending += 1;
      // Old run records have no `review` key at all: the light projection is
      // null then, and every consumer must treat null as "no review happened".
      const lr = lightReview(st.review);
      if (lr !== null && lr.unresolved) unresolved += 1;
      const startedAt = typeof st.startedAt === 'number' ? st.startedAt : null;
      const endedAt = typeof st.endedAt === 'number' ? st.endedAt : null;
      // Live elapsed for a node still in flight; null until it has started.
      const elapsedMs = startedAt === null ? null : (endedAt === null ? at - startedAt : endedAt - startedAt);
      const agent = ownerOf(st, def);
      return clean({
        id: nid, order, agent, agentName: nameOf(agent), status, startedAt, endedAt, elapsedMs,
        output: st.output === undefined ? null : st.output, error: st.error,
        // Enough of the DAG to draw the interaction diagram, and a short brief
        // for its edge labels -- the full text is fetched by /role on demand.
        reviewer: def.reviewer === undefined ? null : def.reviewer,
        // Light review projection (null when this node was never reviewed).
        review: lr,
        dependsOn: Array.isArray(def.dependsOn) ? def.dependsOn.slice() : [],
        brief: brief(def.taskTemplate && def.taskTemplate.requirement, 110),
        title: nodeTitle(def, def.taskTemplate && def.taskTemplate.requirement) || null,
        summary: st.summary === undefined ? null : st.summary,
      });
    });
    const total = nodes.length;
    // Per-role roll-up, so the page can show a team summary without re-deriving
    // it and without a second request. The role NAME SET is unchanged: it is
    // exactly the node owners, never the reviewers (the client asserts equality
    // between the two, and the sequence diagram's swimlane count depends on it).
    const roles = [];
    for (const n of nodes) {
      const key = n.agentName === undefined || n.agentName === null ? UNASSIGNED_ROLE : n.agentName;
      let r = roles.find((x) => x.name === key);
      if (!r) { r = { name: key, total: 0, completed: 0, failed: 0, working: 0, reviewing: 0, rework: 0, pending: 0, elapsedMs: 0 }; roles.push(r); }
      r.total += 1;
      const bucket = bucketOf(n.status);
      if (bucket === 'completed') r.completed += 1;
      else if (bucket === 'failed') r.failed += 1;
      else if (bucket === 'working') r.working += 1;
      else if (bucket === 'reviewing') r.reviewing += 1;
      else if (bucket === 'rework') r.rework += 1;
      else r.pending += 1;
      if (typeof n.elapsedMs === 'number') r.elapsedMs += n.elapsedMs;
    }
    // Reviewers are a SEPARATE roll-up (supervision), never merged into `roles`:
    // a reviewer owns no node, so `roles`' total/completed would be meaningless
    // for it. Names use the same roleNamer() so both arrays are comparable.
    const reviewers = reviewerRollup(nodes);
    // `clean` drops undefined, so normalise every envelope field to null: a run
    // that is still in flight must still expose `endedAt` as a key, otherwise a
    // client reading `run.endedAt` on a fixed shape breaks.
    const num = (v) => (typeof v === 'number' ? v : null);
    return clean({
      ok: true,
      run: { id: run.id, workflowId: run.workflowId === undefined ? null : run.workflowId, workflowName: (wf && wf.name) || null, status: run.status === undefined ? null : run.status, startedAt: num(run.startedAt), endedAt: num(run.endedAt) },
      nodes,
      roles,
      reviewers,
      totals: { total, completed, failed, working, reviewing, rework, unresolved, pending, percent: total === 0 ? 0 : Math.round((completed / total) * 100) },
    });
  };

  // Full detail for ONE role in one run. Deliberately split from `/progress`:
  // the page polls the light summary every few seconds, while a role's complete
  // report (thousands of characters) is fetched only when it is actually opened.
  // One fixed projection of a node's review record, shared by the supervisor view
  // (`reviews`) and the owner view (`nodes[].review`) on purpose. The node card is
  // rendered from /role's OWNER entry, so a projection that only ever appeared in
  // the supervisor list left the verdict unreachable exactly where the UI promises
  // to show it -- and the card then contradicted the supervisor view on the same
  // screen. Every key is defaulted rather than omitted so the client can read the
  // shape without existence checks, and an old record (no review at all) is
  // represented by `null` at the call site instead of an all-null object.
  const reviewView = (rv, fb) => clean({
    reviewer: rv && rv.reviewer !== undefined ? rv.reviewer : fb.reviewer,
    reviewerName: rv && rv.reviewerName !== undefined ? rv.reviewerName : null,
    verdict: rv && rv.verdict !== undefined ? rv.verdict : null,
    score: rv && rv.score !== undefined ? rv.score : null,
    summary: rv && rv.summary !== undefined ? rv.summary : null,
    findings: rv && Array.isArray(rv.findings) ? rv.findings : [],
    resolved: rv && Array.isArray(rv.resolved) ? rv.resolved : [],
    uncertainties: rv && Array.isArray(rv.uncertainties) ? rv.uncertainties : [],
    blockingCount: rv && typeof rv.blockingCount === 'number' ? rv.blockingCount : 0,
    advisoryCount: rv && typeof rv.advisoryCount === 'number' ? rv.advisoryCount : 0,
    unresolved: rv ? rv.unresolved === true : false,
    unresolvedReason: rv && rv.unresolvedReason !== undefined ? rv.unresolvedReason : null,
    rounds: rv && typeof rv.rounds === 'number' ? rv.rounds : 0,
    startedAt: rv && typeof rv.startedAt === 'number' ? rv.startedAt : fb.startedAt,
    endedAt: rv && typeof rv.endedAt === 'number' ? rv.endedAt : fb.endedAt,
    elapsedMs: rv && typeof rv.elapsedMs === 'number' ? rv.elapsedMs : fb.elapsedMs,
    reasoning: rv && typeof rv.reasoning === 'string' && rv.reasoning !== '' ? rv.reasoning : null,
    reasoningLen: rv && typeof rv.reasoningLen === 'number' ? rv.reasoningLen : null,
    notes: rv && Array.isArray(rv.notes) ? rv.notes : [],
    error: rv && rv.error !== undefined ? rv.error : null,
    parseError: rv && rv.parseError !== undefined ? rv.parseError : null,
    toolNote: rv && rv.toolNote !== undefined ? rv.toolNote : null,
  });
  const roleDetail = async (runId, role) => {
    const run = runId ? await getRun(runId) : await latestRun();
    if (!run) return { ok: true, run: null, role: role || null, nodes: [], reviews: [] };
    const wf = run.workflowId ? await withTable('team_workflows', 'flows', (t) => t.get(run.workflowId)) : null;
    const states = run.nodeStates && typeof run.nodeStates === 'object' ? run.nodeStates : {};
    const defs = wf && wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : null;
    const ids = defs ? Object.keys(defs) : Object.keys(states);
    const nameOf = await roleNamer();
    const tasks = await listTasks();
    const at = now();
    const out = [];
    const reviews = [];
    let budget = NODE_OUTPUT_MAX_TOTAL;
    for (let order = 0; order < ids.length; order++) {
      const nid = ids[order];
      const def = (defs && defs[nid]) || {};
      const st = states[nid] && typeof states[nid] === 'object' ? states[nid] : {};
      const agent = ownerOf(st, def);
      // The client builds its role chips from /progress's roll-up, which presents a
      // node with no owner as '(未指派)'. Matching the RAW null here meant /role
      // could not be queried for that chip at all: it existed, and clicking it
      // reported "this role has no nodes in this run". Both read paths must use the
      // one placeholder literal. (Same defect family as the role-literal mismatch
      // fixed in P8 -- one role must never have two names.)
      const rawName = nameOf(agent);
      const agentName = rawName === null || rawName === undefined ? UNASSIGNED_ROLE : rawName;
      const isOwner = !role || agentName === role;
      // `review` is a free-form object on the node state; project EVERY key onto
      // one fixed shape with null defaults so the client can read it without
      // existence checks, and so an old record (no review at all) looks the same
      // as a node that was never reviewed.
      const rv = st.review !== null && typeof st.review === 'object' ? st.review : null;
      const reviewerName = rv && rv.reviewerName !== undefined && rv.reviewerName !== null ? rv.reviewerName : null;
      const isReviewer = role && reviewerName === role;
      if (!isOwner && !isReviewer) continue;
      // Tasks carry (workflowId, nodeId) but NO run id, and every run creates a
      // FRESH task per node -- so "the newest task for this node" can belong to a
      // different run of the same workflow, which would present another run's
      // deliverable as this one's. Prefer the task id this run actually recorded;
      // only fall back to a ledger scan bounded by the run's own time window, for
      // runs recorded before that id existed.
      let task = null;
      if (typeof st.taskId === 'string' && st.taskId !== '') task = await getTask(st.taskId);
      if (!task) {
        const owned = tasks.filter((t) => t && t.workflowId === run.workflowId && t.nodeId === nid);
        owned.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        task = owned.filter((t) => typeof t.createdAt === 'number' && t.createdAt >= run.startedAt && (typeof run.endedAt !== 'number' || t.createdAt <= run.endedAt))[0] || null;
      }
      const startedAt = typeof st.startedAt === 'number' ? st.startedAt : null;
      const endedAt = typeof st.endedAt === 'number' ? st.endedAt : null;
      const elapsedMs = startedAt === null ? null : (endedAt === null ? at - startedAt : endedAt - startedAt);
      const status = typeof st.status === 'string' ? st.status : 'pending';
      const title = nodeTitle(def, (def.taskTemplate && def.taskTemplate.requirement) || (task && task.requirement)) || null;
      const summary = st.summary === undefined ? null : st.summary;
      // A node can legitimately appear in BOTH lists: once as the node its owner
      // is responsible for, once as a node its reviewer supervised. Reviewer
      // entries must never leak into `nodes` -- the client asserts that /role's
      // `nodes` contain only the queried agent's own nodes.
      if (isReviewer) {
        reviews.push(clean({
          kind: 'review',
          id: nid, order,
          nodeTitle: title,
          reviewedAgentName: agentName,
          reviewedStatus: status,
          reviewedSummary: summary,
          taskId: task ? task.id : (st.taskId === undefined ? null : st.taskId),
          ...reviewView(rv, { reviewer: def.reviewer === undefined ? null : def.reviewer, startedAt, endedAt, elapsedMs }),
        }));
      }
      if (!isOwner) continue;
      // The ledger keeps the worker's COMPLETE report; the run record keeps a
      // 200-char slice of it, so prefer the ledger and fall back to the slice.
      const full = task && typeof task.output === 'string' ? task.output : (typeof st.output === 'string' ? st.output : '');
      const take = Math.max(0, Math.min(NODE_OUTPUT_MAX, budget));
      budget -= Math.min(full.length, take);
      out.push(clean({
        id: nid, order, agent, agentName,
        status,
        startedAt, endedAt, elapsedMs,
        title,
        summary,
        requirement: (def.taskTemplate && def.taskTemplate.requirement) || (task && task.requirement) || null,
        acceptanceCriteria: (def.taskTemplate && def.taskTemplate.acceptanceCriteria) || (task && task.acceptanceCriteria) || null,
        reviewer: def.reviewer === undefined ? null : def.reviewer,
        // The owner entry must carry the review too: NodeCard is rendered from
        // THIS entry, so without it the verdict was unreachable on the node card
        // while /progress and the supervisor view both already had it. `null`
        // (not an all-null object) is the "never reviewed" case, so the client
        // can tell "no record" from "a record with no verdict".
        review: rv === null ? null : reviewView(rv, { reviewer: def.reviewer === undefined ? null : def.reviewer, startedAt, endedAt, elapsedMs }),
        dependsOn: Array.isArray(def.dependsOn) ? def.dependsOn.slice() : [],
        output: full === '' ? null : full.slice(0, take),
        outputLen: full.length,
        outputTruncated: full.length > take,
        reasoning: typeof st.reasoning === 'string' && st.reasoning !== '' ? st.reasoning : null,
        reasoningLen: typeof st.reasoningLen === 'number' ? st.reasoningLen : null,
        tools: st.tools === undefined ? null : st.tools,
        error: st.error === undefined ? null : st.error,
        taskId: task ? task.id : (st.taskId === undefined ? null : st.taskId),
        taskStatus: task ? task.status : null,
        iteration: task ? task.iteration : null,
      }));
    }
    return clean({
      ok: true,
      run: { id: run.id, workflowId: run.workflowId === undefined ? null : run.workflowId, workflowName: (wf && wf.name) || null, status: run.status === undefined ? null : run.status, startedAt: typeof run.startedAt === 'number' ? run.startedAt : null, endedAt: typeof run.endedAt === 'number' ? run.endedAt : null },
      role: role || null,
      nodes: out,
      reviews,
    });
  };

  // ---- task ledger ----
  const agentsSvc = ctx.get('agents');
  const spill = ctx.get('spillStore');
  const taskTable = async () => withTable('team_ledger', 'tasks', (t) => t);
  const transition = async (id, next, patch) => {
    const t = await taskTable();
    return t.update(id, (cur) => {
      if (!cur) throw new Error('team-flowise: task not found ' + id);
      const allowed = TASK_TRANSITIONS[cur.status] || [];
      if (!allowed.includes(next)) throw new Error('team-flowise: invalid transition ' + cur.status + ' -> ' + next + ' for task ' + id);
      const base = { ...cur, ...patch, status: next, updatedAt: now() };
      if (next === 'reworked') { const it = (cur.iteration || 0) + 1; base.iteration = it; base.history = [...(cur.history || []), { iteration: it, status: 'reworked', feedback: patch && patch.feedback ? patch.feedback : null, at: now() }]; }
      return taskSchema.parse(clean(base));
    });
  };
  const createTask = async (spec) => {
    const rec = taskSchema.parse(clean({ id: (spec && spec.id) || makeId(), workflowId: spec && spec.workflowId, nodeId: spec && spec.nodeId, assignee: spec && spec.assignee, reviewer: spec && spec.reviewer, requirement: spec && spec.requirement, acceptanceCriteria: spec && spec.acceptanceCriteria, status: 'queued', iteration: 0, history: [], createdAt: now(), updatedAt: now() }));
    await withTable('team_ledger', 'tasks', (t) => t.put(rec.id, rec)); return rec;
  };
  const getTask = async (id) => withTable('team_ledger', 'tasks', (t) => t.get(id) || null);
  const listTasks = async () => withTable('team_ledger', 'tasks', (t) => [...t.entries()].map(([, v]) => v));
  const submitTask = (id) => transition(id, 'submitted', {});
  const startTask = (id) => transition(id, 'working', {});
  const completeTask = (id, output, outputRef) => transition(id, 'completed', clean({ output: output || null, outputRef: outputRef || undefined }));
  const reworkTask = (id, feedback) => transition(id, 'reworked', clean({ feedback: feedback || null }));
  const resumeTask = (id) => transition(id, 'working', {});
  const settleTask = (id) => transition(id, 'settle', {});
  const reportTask = async (id, content) => {
    let ref = null; let inline = content;
    const owner = agentsSvc && agentsSvc.currentInitiator();
    if (spill && owner && typeof content === 'string' && content.length > 4096) { try { ref = await spill.saveText({ owner: owner.session, suggestedName: 'task-' + id + '-report', content }); inline = null; } catch (e) { ref = null; } }
    return transition(id, 'completed', clean({ reportRef: ref || undefined, outputRef: ref || undefined, output: inline }));
  };

  // ---- startup reap: close work orphaned by a previous process ----
  // Composed host code does not survive a restart, so a run left `running` has no
  // live child agents left to advance it. Close it and settle the tasks it
  // abandoned; otherwise every restart leaves a run "running" forever and its
  // task stuck at `working`, which is exactly what happened to the first
  // multi-role run. Once per process: a later re-apply must not touch live work.
  const reapStale = async () => {
    if (startupReapDone) return;
    startupReapDone = true;
    try {
      let nRuns = 0;
      for (const r of await listRuns()) {
        if (r.status !== 'running' || liveRuns.has(r.id)) continue;
        await withTable('team_runs', 'runs', (t) => t.update(r.id, (cur) => runSchema.parse(clean({ ...cur, status: 'interrupted', endedAt: cur.endedAt || now(), result: cur.result || { outputs: {}, summary: 'interrupted: the process restarted while this run was in flight' } }))));
        nRuns += 1;
      }
      let nTasks = 0;
      for (const tk of await listTasks()) {
        // `working`/`submitted` can only be advanced by a live child, and none
        // survives a restart. `queued` is an untouched backlog entry: leave it.
        if (tk.status !== 'working' && tk.status !== 'submitted') continue;
        if (tk.workflowId && liveRuns.has(tk.workflowId)) continue;
        await withTable('team_ledger', 'tasks', (t) => t.update(tk.id, (cur) => taskSchema.parse(clean({ ...cur, status: 'settle', updatedAt: now() }))));
        nTasks += 1;
      }
      if (nRuns > 0 || nTasks > 0) console.log('team-flowise: startup reap closed ' + nRuns + ' stale run(s) and ' + nTasks + ' orphaned task(s)');
    } catch (e) {
      console.error('team-flowise: startup reap failed', String(e));
    }
  };
  reapStale();

  // ---- DAG workflow scheduler (real: topology waves, delegate via subagents) ----
  const runWorkflow = async (workflowId, input, onCreated) => {
    const wf = await withTable('team_workflows', 'flows', (t) => t.get(workflowId));
    if (!wf) throw new Error('team-flowise: workflow not found ' + workflowId);
    const nodes = (wf.nodes || {});
    const nodeIds = Object.keys(nodes);
    const runRec = runSchema.parse(clean({ id: makeId(), workflowId, status: 'running', nodeStates: {}, startedAt: now() }));
    await withTable('team_runs', 'runs', (t) => t.put(runRec.id, runRec));
    // Publish the run id before any delegation happens, so an HTTP caller can
    // answer immediately and the board can follow the run by polling instead of
    // holding one request open for the whole (multi-minute) workflow.
    if (typeof onCreated === 'function') {
      try { onCreated(runRec); } catch (e) { console.error('team-flowise: run publish failed', String(e)); }
    }
    try {
      liveRuns.add(runRec.id);
      const completed = {};
      const succeeded = {};
      const outputs = {};
      // P10 review ledgers, in `runWorkflow` scope so ONE run shares them.
      // `reworkByNode` / `runRework` are the anti-stretch budget: they bound how
      // many extra worker dispatches a whole run can produce, regardless of what
      // any reviewer decides. Both are only ever touched in the same synchronous
      // block as their check (see the rework decision below) -- an `await`
      // between checking and incrementing would let a concurrent wave overspend.
      const reviews = {};
      const reworkByNode = {};
      let runRework = 0;
      const subagents = ctx.get('subagents');
      const parent = resolveParentAgent(ctx);
      const agentDefs = await listAgents();
      // Reviewer and title names must use the SAME canonical role name the board
      // already groups by (`roleNamer`), otherwise one reviewer shows up twice.
      const nameOf = await roleNamer();
      const titleOf = (node) => nodeTitle(node, node && node.taskTemplate && node.taskTemplate.requirement) || node.id;
      const setRunState = async (patch) => withTable('team_runs', 'runs', (t) => t.update(runRec.id, (cur) => ({ ...cur, ...patch, nodeStates: { ...(cur.nodeStates || {}), ...(patch.nodeStates || {}) } })));
      // ---- P10 review phase helpers ----
      // The reviewer actually in effect: the node's own first, then the
      // workflow-level one. Empty/blank strings count as "not configured", so a
      // workflow that never declared a reviewer dispatches exactly the calls it
      // did before P10 -- no extra state write, no extra child, no extra field.
      const reviewerRefFor = (node) => {
        const own = node && typeof node.reviewer === 'string' ? node.reviewer.trim() : '';
        if (own !== '') return own;
        const rv = wf.review && typeof wf.review === 'object' ? wf.review : null;
        if (rv === null) return '';
        // `review.enabled === false` switches the WORKFLOW-LEVEL default off. A
        // node that names its own reviewer still wins (checked above), because the
        // more specific declaration is the one the author wrote for that step.
        if (rv.enabled === false) return '';
        return typeof rv.reviewer === 'string' ? rv.reviewer.trim() : '';
      };
      // One review of one artifact. Never throws and never blocks: a reviewer
      // that dies, times out, stops early, or returns unparseable text yields
      // verdict 'error' and the node still completes.
      const runReview = async (nid, node, output, rnd, knownBlocking, task) => {
        const ref = reviewerRefFor(node);
        if (ref === '') return null;
        const named = nameOf(ref) || ref;
        const def = agentDefs.find((d) => d.id === ref || d.name === ref) || null;
        const startedAt = now();
        let text = ''; let reasoning = ''; let toolNote = ''; let error = null;
        const artifact = String(output === undefined || output === null ? '' : output);
        const truncated = artifact.length > REVIEW_LIMITS.artifactMax;
        const prompt = buildReviewPrompt({
          round: rnd, nodeId: nid, title: titleOf(node),
          agentName: nameOf(node && node.agent) || (node && node.agent) || null,
          requirement: task.requirement, acceptanceCriteria: task.acceptanceCriteria,
          artifact: truncated ? artifact.slice(0, REVIEW_LIMITS.artifactMax) : artifact,
          artifactTruncated: truncated, knownBlocking,
        });
        if (subagents) {
          const ctl = new AbortController();
          try {
            // The REVIEWER derives its own model/persona from its own definition.
            // The reviewed node's deny-list or persona must never be applied to
            // it: those describe the worker being judged, not the judge.
            const started = await startWorker(subagents, { label: nid + ':review', prompt: [{ type: 'text', text: prompt }], parent, signal: ctl.signal }, spawnSpecFor(def, parent), parentToolNote(parent));
            toolNote = started.note;
            const result = await withTimeout(started.run.result, REVIEW_LIMITS.timeoutMs, 'review of node ' + nid);
            const blocks = result.output || [];
            text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
            // The reviewer's thinking is part of the audit trail, same as a
            // worker's: collect reasoning blocks as well as text.
            reasoning = blocks.filter((b) => b.type === 'reasoning' && typeof b.text === 'string').map((b) => b.text).join('\n');
            if (result.stopReason !== 'completed') error = 'reviewer ' + result.stopReason + (result.diagnostic ? ': ' + result.diagnostic : '');
          } catch (e) {
            ctl.abort();
            error = String(e && e.message ? e.message : e);
          }
        } else {
          error = 'subagents service unavailable';
        }
        const parsed = error === null ? parseReviewVerdict(text) : { raw: text, parsed: null, parseError: error };
        const norm = normalizeReview(parsed.parsed, { round: rnd, knownBlocking, parseError: parsed.parseError });
        const endedAt = now();
        const st = {
          reviewer: ref, reviewerName: named,
          verdict: error === null ? norm.verdict : 'error',
          score: norm.score, summary: norm.summary,
          blockingCount: norm.blockingCount, advisoryCount: norm.advisoryCount,
          findings: norm.findings, resolved: norm.resolved, uncertainties: norm.uncertainties,
          rounds: rnd, unresolved: false, unresolvedReason: null, notes: norm.notes,
          startedAt, endedAt, elapsedMs: endedAt - startedAt,
          // Bounded exactly like a worker's reasoning trace, with its true
          // length kept alongside so a capped trace is never read as a short one.
          reasoning: typeof reasoning === 'string' && reasoning !== '' ? reasoning.slice(0, REASONING_MAX) : null,
          reasoningLen: typeof reasoning === 'string' && reasoning !== '' ? reasoning.length : null,
          error, parseError: norm.parseError, toolNote: toolNote === '' ? null : toolNote,
        };
        // `st` is the whole node-level review record; the caller keeps it for
        // every subsequent state write for this node.
        return { st };
      };
      for (let round = 0; round < 1000; round++) {
        const ready = nodeIds.filter((nid) => {
          if (completed[nid]) return false;
          return (nodes[nid].dependsOn || []).every((d) => completed[d]);
        });
        if (ready.length === 0) break;
        await Promise.all(ready.map(async (nid) => {
          const node = nodes[nid];
          // Each node owns its cancellation so a timeout can abort just this child.
          const nodeCtl = new AbortController();
          let taskId;
          // What tool policy the worker actually started under; recorded on the
          // node so a silently-unfiltered worker is visible instead of inferred.
          let toolNote = '';
          // Declared OUTSIDE the try so the catch below can persist it too: a node
          // that fails after emitting reasoning DID produce a trace, and the role
          // view would otherwise state that it produced none.
          let reasoning = '';
          // This node's own lifetime. `startedAt` is captured ONCE, here, and then
          // re-sent with every later write for this node: setRunState merges
          // `nodeStates` one level deep (`{...cur.nodeStates, ...patch.nodeStates}`),
          // so a second write for the same id REPLACES the whole entry -- a
          // completed/failed patch that omitted startedAt would erase it.
          const nodeStartedAt = now();
          // The review record produced by this node, if it was reviewed at all.
          // Held here so EVERY later write for this node can carry it: a
          // reviewing/rework/completed patch that omitted `review` would erase
          // the verdict the moment the next state write landed.
          let reviewState = null;
          // Tools the WORKER could not use. Collected only to describe the
          // WORKER in a rework prompt; it is never applied to the reviewer.
          let deny = [];
          // Effective rework cap for this node, clamped to the plugin hard limit
          // so neither the node nor the workflow can raise it. Defaults to the
          // plugin bound when the declaration is absent or nonsensical.
          const effMaxRework = () => {
            const candidates = [];
            if (node.maxRework !== undefined && node.maxRework !== null) candidates.push(node.maxRework);
            if (wf.review && typeof wf.review === 'object' && wf.review.maxRework !== undefined && wf.review.maxRework !== null) candidates.push(wf.review.maxRework);
            let n = REVIEW_LIMITS.maxReworkPerNode;
            for (const c of candidates) if (typeof c === 'number' && isFinite(c)) n = Math.min(n, Math.max(0, Math.floor(c)));
            return n;
          };
          // A node's terminal status is only known when the node finishes, so the
          // intermediate writes (reviewing / rework / working) deliberately leave
          // `endedAt` null and `summary` null rather than freezing a value that
          // the completion write would then contradict.
          const persistReview = async (next, errText) => {
            await setRunState({ nodeStates: { [nid]: {
              status: next, assignee: node.agent, startedAt: nodeStartedAt,
              endedAt: null, summary: null, tools: toolNote,
              taskId: taskId || null, error: errText,
              ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}),
              ...(reviewState ? { review: reviewState } : {}),
            } } });
          };
          try {
            await setRunState({ nodeStates: { [nid]: { status: 'working', assignee: node.agent, startedAt: nodeStartedAt } } });
            const task = await createTask({ workflowId, nodeId: nid, assignee: node.agent, reviewer: reviewerRefFor(node), requirement: (node.taskTemplate && node.taskTemplate.requirement) || node.id, acceptanceCriteria: (node.taskTemplate && node.taskTemplate.acceptanceCriteria) || '' });
            taskId = task.id;
            await submitTask(task.id); await startTask(task.id);
            let output = 'no delegate';
            if (subagents && node.agent) {
              const def = agentDefs.find((d) => d.id === node.agent || d.name === node.agent);
              const who = (def && (def.name || def.role)) || node.agent || 'team';
              const prompt = 'You are the ' + who + ' agent. Task: ' + (task.requirement || '') + (task.acceptanceCriteria ? '\nAcceptance criteria: ' + task.acceptanceCriteria : '') + (input && Object.keys(input).length ? '\nInput: ' + JSON.stringify(input) : '');
              nodeCtl.signal.throwIfAborted();
              const started = await startWorker(subagents, { label: node.id, prompt: [{ type: 'text', text: prompt }], parent, signal: nodeCtl.signal }, spawnSpecFor(def, parent), parentToolNote(parent));
              toolNote = started.note;
              deny = (((def && def.tools) || {}).deny || []).slice();
              const result = await withTimeout(started.run.result, NODE_TIMEOUT_MS, 'workflow node ' + nid);
              const blocks = result.output || [];
              output = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
              // Reasoning blocks were already produced by the adapter and simply
              // thrown away here, which is why a role's "thinking" was invisible.
              reasoning = blocks.filter((b) => b.type === 'reasoning' && typeof b.text === 'string').map((b) => b.text).join('\n');
              // A worker that did not finish cleanly must not be reported as a
              // successful node: without this an instantly-failing child (e.g.
              // NO_ADAPTER) looked like a completed node with empty output.
              if (result.stopReason !== 'completed') {
                throw new Error('worker ' + result.stopReason + (result.diagnostic ? ': ' + result.diagnostic : '') + (output ? ' | partial: ' + output.slice(0, 200) : ''));
              }
            }
            // ==== P10 review phase (inserted between the dispatch above and the
            // `completeTask` below). The REVIEWER itself can never fail the node:
            // runReview contains every reviewer-side failure (spawn error,
            // timeout, early stop, unparseable text) and turns it into
            // verdict 'error', so a broken judge is not a broken deliverable.
            // This phase does live inside the node's single try/catch, which is
            // deliberate: a REWORK worker that fails to run is treated exactly
            // like an initial worker that fails to run -- the node has no
            // acceptable artifact either way, so it is reported `failed` rather
            // than quietly passing on the artifact the reviewer just rejected.
            let rnd = 1;
            let knownBlocking = [];
            let worst = null;
            for (;;) {
              const rv = await runReview(nid, node, output, rnd, knownBlocking, task);
              if (rv === null) break; // no reviewer in effect: behave exactly as before P10
              reviewState = rv.st;
              reviews[nid] = lightReview(reviewState);
              // Publish "being reviewed" with the verdict already attached, then
              // immediately overwrite with the outcome: a poll landing during the
              // review sees `reviewing`, and one landing after it sees the verdict
              // ON the node -- never a gap where the verdict is lost.
              await persistReview('reviewing', null);
              if (reviewState.verdict !== 'rework') { await persistReview('completed', null); break; }
              worst = reviewState;
              const cap = effMaxRework();
              const nodeUsed = typeof reworkByNode[nid] === 'number' ? reworkByNode[nid] : 0;
              // Budget check + consume in ONE synchronous block: no `await`
              // between reading runRework and incrementing it, so two nodes in the
              // same wave cannot both pass the gate and overspend the run budget.
              if (nodeUsed >= cap || runRework >= REVIEW_LIMITS.maxReworkPerRun) {
                const which = nodeUsed >= cap
                  ? '单节点返工上限（maxReworkPerNode=' + cap + ' 轮，已用 ' + nodeUsed + ' 轮）'
                  : '整次运行返工总上限（maxReworkPerRun=' + REVIEW_LIMITS.maxReworkPerRun + ' 轮，已用 ' + runRework + ' 轮）';
                reviewState.unresolved = true;
                reviewState.unresolvedReason = '已达' + which + '，不再返工；该节点的阻塞项未解决，需人工介入。';
                reviews[nid] = lightReview(reviewState);
                await persistReview('completed', null);
                break;
              }
              reworkByNode[nid] = nodeUsed + 1;
              runRework += 1;
              await persistReview('rework', null);
              // The rework reuses the ledger's EXISTING state machine
              // (completed -> reworked -> working) and the SAME task id: one node
              // is one task for its whole life, never a fresh task per attempt.
              await reworkTask(taskId, reviewState.summary + ' | ' + reviewState.findings.filter((f) => f.severity === 'blocking').map((f) => f.criterion).join(' ; '));
              await resumeTask(taskId);
              await persistReview('working', null);
              rnd += 1;
              nodeCtl.signal.throwIfAborted();
              const reworkPrompt = buildReworkPrompt({
                who: (agentDefs.find((d) => d.id === node.agent || d.name === node.agent) || {}).name || node.agent || 'team',
                requirement: task.requirement, acceptanceCriteria: task.acceptanceCriteria,
                blocking: reviewState.findings.filter((f) => f.severity === 'blocking'),
                round: rnd - 1,
              }) + (deny.length ? '\n\n注意：以下工具对本次派发不可用，不要尝试调用它们：' + deny.join(', ') : '');
              const restarted = await startWorker(subagents, { label: node.id, prompt: [{ type: 'text', text: reworkPrompt }], parent, signal: nodeCtl.signal }, spawnSpecFor(agentDefs.find((d) => d.id === node.agent || d.name === node.agent), parent), parentToolNote(parent));
              toolNote = restarted.note;
              const again = await withTimeout(restarted.run.result, NODE_TIMEOUT_MS, 'workflow node ' + nid + ' rework ' + rnd);
              const blocks2 = again.output || [];
              output = blocks2.filter((b) => b.type === 'text').map((b) => b.text).join('');
              reasoning = blocks2.filter((b) => b.type === 'reasoning' && typeof b.text === 'string').map((b) => b.text).join('\n');
              if (again.stopReason !== 'completed') throw new Error('worker(rework) ' + again.stopReason + (again.diagnostic ? ': ' + again.diagnostic : '') + (output ? ' | partial: ' + output.slice(0, 200) : ''));
              // A re-review may only re-check the PREVIOUS round's blocking items;
              // normalizeReview's R4 enforces that mechanically.
              knownBlocking = worst.findings.filter((f) => f.severity === 'blocking').map((f) => f.criterion).filter((c) => typeof c === 'string' && c !== '');
            }
            await completeTask(taskId, output, null);
            outputs[nid] = output; completed[nid] = true; succeeded[nid] = true;
            // The single completion write. With no reviewer in effect it carries
            // exactly the keys it always did (`reviewState` stays null, so the
            // spread contributes nothing) -- unchanged field set, unchanged shape.
            await setRunState({ nodeStates: { [nid]: { status: 'completed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), output: String(output).slice(0, 200), summary: firstLine(output, 140) || null, tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}), ...(reviewState ? { review: reviewState } : {}) } } });
          } catch (e) {
            nodeCtl.abort();
            completed[nid] = true;
            // Never leave an abandoned task at `working`: nothing can advance it.
            if (taskId) await settleTask(taskId).catch(() => undefined);
            await setRunState({ nodeStates: { [nid]: { status: 'failed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), error: String(e), summary: firstLine('失败：' + String(e), 140), tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}), ...(reviewState ? { review: reviewState } : {}) } } });
          }
        }));
      }
      const allDone = nodeIds.every((nid) => completed[nid]);
      const allOk = nodeIds.every((nid) => succeeded[nid] === true);
      const status = allOk ? 'completed' : (allDone ? 'failed' : 'interrupted');
      const summary = allOk ? 'workflow completed' : (allDone ? 'workflow finished with failed nodes' : 'workflow interrupted');
      // `reviews` is the per-node LIGHT projection (same shape /progress serves),
      // so a finished run carries its review outcome without re-reading
      // nodeStates. An unreviewed run yields `{}`, i.e. no behaviour change.
      await withTable('team_runs', 'runs', (t) => t.update(runRec.id, (cur) => ({ ...cur, status, endedAt: now(), result: { outputs, summary, reviews } })));
      return { id: runRec.id, status };
    } finally { liveRuns.delete(runRec.id); }
  };

  // ---- model tools via the real `tools` service (host-plane registry) ----
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    const mk = (t, parameters, props, render, execute) => tools.register(defineTool({ name: t, description: 'Multi-agent team orchestration.', parameters, output: { schema: { type: 'object', additionalProperties: false, properties: props }, render }, isConcurrencySafe: () => true, execute }));
    const taskItem = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, status: { type: 'string' }, iteration: { type: 'number' }, assignee: { type: 'string' } } };
    disposers.push(mk('team_create_task', { requirement: { type: 'string', required: true }, acceptanceCriteria: { type: 'string', required: true }, assignee: { type: 'string', required: true }, reviewer: { type: 'string' } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, status: { type: 'string', required: true } }, (_a, v) => [{ type: 'text', text: 'created task ' + v.id + ' [' + v.status + ']' }], async (args) => { const t = await createTask(args); return clean({ ok: true, id: t.id, status: t.status }); }));
    disposers.push(mk('team_task_status', {}, { ok: { type: 'boolean', required: true }, taskCount: { type: 'number', required: true }, tasks: { type: 'array', required: true, items: taskItem } }, (_a, v) => [{ type: 'text', text: 'tasks=' + v.taskCount }], async () => { const tasks = await listTasks(); return clean({ ok: true, taskCount: tasks.length, tasks: tasks.map((t) => clean({ id: t.id, status: t.status, iteration: t.iteration, assignee: t.assignee })) }); }));
    disposers.push(mk('team_run_workflow', { workflowId: { type: 'string', required: true }, input: { type: 'object', additionalProperties: false } }, { ok: { type: 'boolean', required: true }, runId: { type: 'string', required: true }, status: { type: 'string', required: true } }, (_a, v) => [{ type: 'text', text: 'ran workflow -> ' + v.runId + ' [' + v.status + ']' }], async (args) => { const r = await runWorkflow(args.workflowId, args.input); return clean({ ok: true, runId: r.id, status: r.status }); }));
    disposers.push(mk('team_list_agents', {}, { ok: { type: 'boolean', required: true }, agents: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } }, (_a, v) => [{ type: 'text', text: 'agents=' + v.agents.length }], async () => { const a = await listAgents(); return clean({ ok: true, agents: a.map((x) => clean({ id: x.id, name: x.name, role: x.role })) }); }));
    disposers.push(mk('team_create_agent', { name: { type: 'string', required: true }, role: { type: 'string' }, systemPrompt: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, name: { type: 'string', required: true } }, (_a, v) => [{ type: 'text', text: 'created agent ' + v.name + ' -> ' + v.id }], async (args) => { const a = await upsertAgent({ name: args.name, role: args.role, systemPrompt: args.systemPrompt, model: (args.provider || args.model) ? { provider: args.provider || 'deepseek', model: args.model || 'deepseek-chat' } : undefined }); return clean({ ok: true, id: a.id, name: a.name }); }));
    disposers.push(mk('team_create_workflow', { name: { type: 'string', required: true }, description: { type: 'string' }, nodes: { type: 'object', additionalProperties: true } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, name: { type: 'string', required: true }, nodeCount: { type: 'number', required: true } }, (_a, v) => [{ type: 'text', text: 'created workflow ' + v.name + ' -> ' + v.id + ' (' + v.nodeCount + ' nodes)' }], async (args) => { const w = await upsertWorkflow({ name: args.name, description: args.description, nodes: args.nodes || {} }); return clean({ ok: true, id: w.id, name: w.name, nodeCount: Object.keys(w.nodes || {}).length }); }));
    disposers.push(mk('team_delegate_agent', { agent: { type: 'string', required: true }, task: { type: 'string', required: true }, acceptanceCriteria: { type: 'string' }, reviewer: { type: 'string' } }, { ok: { type: 'boolean', required: true }, taskId: { type: 'string', required: true }, status: { type: 'string', required: true }, output: { type: 'string' } }, (_a, v) => [{ type: 'text', text: 'delegated -> task ' + v.taskId + ' [' + v.status + ']' }], async (args) => {
      const agentsList = await listAgents();
      const def = agentsList.find((a) => a.id === args.agent || a.name === args.agent);
      const assignee = (def && def.name) || args.agent;
      const t = await createTask({ workflowId: undefined, nodeId: 'delegate-' + makeId(), assignee, reviewer: args.reviewer, requirement: args.task, acceptanceCriteria: args.acceptanceCriteria || '' });
      await submitTask(t.id); await startTask(t.id);
      let output = 'no delegate';
      const subagentsSvc = ctx.get('subagents');
      const dParent = resolveParentAgent(ctx);
      const dCtl = new AbortController();
      if (subagentsSvc) {
        try {
          const who = (def && (def.name || def.role)) || assignee;
          const prompt = 'You are the ' + who + ' agent. Task: ' + (t.requirement || '') + (t.acceptanceCriteria ? '\nAcceptance criteria: ' + t.acceptanceCriteria : '');
          const started = await startWorker(subagentsSvc, { label: 'team-delegate', prompt: [{ type: 'text', text: prompt }], parent: dParent, signal: dCtl.signal }, spawnSpecFor(def, dParent), parentToolNote(dParent));
          const result = await withTimeout(started.run.result, NODE_TIMEOUT_MS, 'delegated task ' + t.id);
          output = (result.output || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          if (result.stopReason !== 'completed') throw new Error('worker ' + result.stopReason + (result.diagnostic ? ': ' + result.diagnostic : '') + ' [' + started.note + ']');
        } catch (e) { dCtl.abort(); output = 'delegate failed: ' + String(e); }
      }
      await completeTask(t.id, output, null);
      return clean({ ok: true, taskId: t.id, status: 'completed', output: String(output).slice(0, 500) });
    }));
  }

  // ---- service (host-plane singleton, shared across sessions) ----
  const svc = {
    ping: async () => ({ pong: true }),
    domainNames: () => DOMAINS.slice(),
    listAgents, upsertAgent, deleteAgent,
    listWorkflows, upsertWorkflow, deleteWorkflow,
    listRuns, getRun,
    createTask, getTask, listTasks, submitTask, startTask, completeTask, reworkTask, resumeTask, settleTask, reportTask,
    runWorkflow,
  };
  ctx.provide('teamOrchestrator', svc);

  // ---- browser HTTP bridge (composed host plane has no `harness`; client
  // reaches the service through WebRoutes, mirroring @linxin666/dsh-usage) ----
  const web = ctx.get('webServer');
  if (web !== undefined) {
    const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' };
    const readJsonBody = async (req, maxBytes = 65536) => {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const buf = chunk;
        size += buf.length;
        if (size > maxBytes) { req.destroy(); return null; }
        chunks.push(buf);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (text === '') return null;
      try { return JSON.parse(text); } catch { return null; }
    };
    const writeJson = (res, status, body, headers = {}) => {
      res.writeHead(status, { ...JSON_HEADERS, ...headers });
      res.end(JSON.stringify(body));
    };
    const isLoopback = (req) => {
      const remote = req.socket && req.socket.remoteAddress;
      if (typeof remote !== 'string') return false;
      const norm = remote.toLowerCase();
      if (norm === '::1') return true;
      if (norm.startsWith('::ffff:')) { const v4 = norm.slice('::ffff:'.length); return v4.split('.').length === 4 && v4.split('.')[0] === '127'; }
      const parts = norm.split('.'); return parts.length === 4 && parts[0] === '127';
    };
    const ok = (res, body) => writeJson(res, 200, body);
    const fail = (res, e) => writeJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
    const guard = (req, res) => {
      if (!isLoopback(req)) { res.writeHead(403, JSON_HEADERS); res.end(JSON.stringify({ ok: false, error: 'forbidden' })); return false; }
      return true;
    };
    const query = (url, key) => { try { return new URL(url, 'http://localhost').searchParams.get(key); } catch { return null; } };

    const route = (kind, path, handler) => {
      const dispose = web.register({ kind, path, handler });
      disposers.push(dispose);
    };

    const wrap = (fn) => async (req, res) => {
      try {
        const out = await fn(req, res);
        if (out !== undefined && out !== null && !res.writableEnded) ok(res, out);
      } catch (e) { if (!res.writableEnded) fail(res, e); }
    };

    // GET read endpoints
    route('exact', '/api/team-flowise/ping', wrap(async () => ({ ok: true, pong: true, domains: DOMAINS.slice() })));
    route('exact', '/api/team-flowise/agents', wrap(async () => ({ ok: true, agents: await listAgents() })));
    route('exact', '/api/team-flowise/workflows', wrap(async () => ({ ok: true, workflows: await listWorkflows() })));
    route('exact', '/api/team-flowise/tasks', wrap(async () => ({ ok: true, tasks: await listTasks() })));
    route('exact', '/api/team-flowise/runs', wrap(async () => ({ ok: true, runs: await listRuns() })));
    // Read-only progress summary of the latest run (or ?runId=<id>), aligned to
    // the workflow definition. GET + no body => directly consumable by
    // Invoke-RestMethod and by the client board's poll loop.
    route('exact', '/api/team-flowise/progress', wrap(async (req) => progressSummary(query(req.url, 'runId'))));
    // Heavy per-role detail (the complete worker report + reasoning trace),
    // fetched only when a role is opened rather than on every poll.
    route('exact', '/api/team-flowise/role', wrap(async (req) => roleDetail(query(req.url, 'runId'), query(req.url, 'agent'))));
    route('exact', '/api/team-flowise/run', wrap(async (req) => {
      const id = query(req.url, 'id');
      if (!id) return { ok: false, error: 'missing id' };
      return { ok: true, run: await getRun(id) };
    }));

    // write endpoints (loopback-fenced)
    route('exact', '/api/team-flowise/agent', wrap(async (req, res) => {
      if (!guard(req, res)) return;
      if (req.method === 'DELETE') { const id = query(req.url, 'id'); await deleteAgent(id); return { ok: true, id }; }
      const body = await readJsonBody(req); if (!body) return { ok: false, error: 'bad body' };
      const def = await upsertAgent(body);
      return { ok: true, agent: def };
    }));
    route('exact', '/api/team-flowise/workflow', wrap(async (req, res) => {
      if (!guard(req, res)) return;
      if (req.method === 'DELETE') { const id = query(req.url, 'id'); await deleteWorkflow(id); return { ok: true, id }; }
      const body = await readJsonBody(req); if (!body) return { ok: false, error: 'bad body' };
      const wf = await upsertWorkflow(body);
      return { ok: true, workflow: wf };
    }));
    route('exact', '/api/team-flowise/task/create', wrap(async (req, res) => {
      if (!guard(req, res)) return;
      const body = await readJsonBody(req); if (!body) return { ok: false, error: 'bad body' };
      const t = await createTask(body);
      return { ok: true, task: t };
    }));
    route('exact', '/api/team-flowise/task/rework', wrap(async (req, res) => {
      if (!guard(req, res)) return;
      const body = await readJsonBody(req); if (!body) return { ok: false, error: 'bad body' };
      const t = await reworkTask(body.id, body.feedback);
      return { ok: true, task: t };
    }));
    route('exact', '/api/team-flowise/run/start', wrap(async (req, res) => {
      if (!guard(req, res)) return;
      const body = await readJsonBody(req); if (!body) return { ok: false, error: 'bad body' };
      // Validate up front so an unknown workflow is a synchronous error rather
      // than a run that never publishes an id.
      const wf = await withTable('team_workflows', 'flows', (t) => t.get(body.workflowId));
      if (!wf) return { ok: false, error: 'unknown workflow ' + String(body.workflowId) };
      let rec = null;
      let publish = () => undefined;
      const published = new Promise((resolve) => { publish = (r) => { rec = r; resolve(r); }; });
      // Runs in the background: the scheduler owns the run record from here, so
      // the response reports the id and the board follows it through `/runs`.
      runWorkflow(body.workflowId, body.input || {}, publish).catch(async (e) => {
        console.error('team-flowise: run failed', String(e));
        if (!rec) return;
        try {
          await withTable('team_runs', 'runs', (t) => t.update(rec.id, (cur) => ({ ...cur, status: 'failed', endedAt: now(), result: { outputs: {}, summary: 'run failed: ' + String(e) } })));
        } catch (e2) { console.error('team-flowise: could not mark run failed', String(e2)); }
      });
      const created = await published;
      return { ok: true, run: { id: created.id, workflowId: created.workflowId, status: 'running' } };
    }));
  }
}