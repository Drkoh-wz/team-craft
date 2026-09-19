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
    const rec = workflowSchema.parse(clean({ id: (wf && wf.id) || makeId(), name: wf && wf.name, description: wf && wf.description, nodes: (wf && wf.nodes) || {}, updatedAt: now() }));
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

  const progressSummary = async (runId) => {
    const run = runId ? await getRun(runId) : await latestRun();
    if (!run) return { ok: true, run: null, nodes: [], roles: [], totals: { total: 0, completed: 0, failed: 0, working: 0, pending: 0, percent: 0 } };
    const wf = run.workflowId ? await withTable('team_workflows', 'flows', (t) => t.get(run.workflowId)) : null;
    const states = run.nodeStates && typeof run.nodeStates === 'object' ? run.nodeStates : {};
    const defs = wf && wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : null;
    // A deleted/renamed workflow must not blank the board: fall back to whatever
    // the run itself recorded.
    const ids = defs ? Object.keys(defs) : Object.keys(states);
    const nameOf = await roleNamer();
    const at = now();
    let completed = 0; let failed = 0; let working = 0; let pending = 0;
    const nodes = ids.map((nid, order) => {
      const def = (defs && defs[nid]) || {};
      const st = states[nid] && typeof states[nid] === 'object' ? states[nid] : {};
      const status = typeof st.status === 'string' ? st.status : 'pending';
      if (status === 'completed') completed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'working') working += 1;
      else pending += 1;
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
        dependsOn: Array.isArray(def.dependsOn) ? def.dependsOn.slice() : [],
        brief: brief(def.taskTemplate && def.taskTemplate.requirement, 110),
        title: nodeTitle(def, def.taskTemplate && def.taskTemplate.requirement) || null,
        summary: st.summary === undefined ? null : st.summary,
      });
    });
    const total = nodes.length;
    // Per-role roll-up, so the page can show a team summary without re-deriving
    // it and without a second request.
    const roles = [];
    for (const n of nodes) {
      const key = n.agentName === undefined || n.agentName === null ? '(未指派)' : n.agentName;
      let r = roles.find((x) => x.name === key);
      if (!r) { r = { name: key, total: 0, completed: 0, failed: 0, working: 0, pending: 0, elapsedMs: 0 }; roles.push(r); }
      r.total += 1;
      if (n.status === 'completed') r.completed += 1;
      else if (n.status === 'failed') r.failed += 1;
      else if (n.status === 'working') r.working += 1;
      else r.pending += 1;
      if (typeof n.elapsedMs === 'number') r.elapsedMs += n.elapsedMs;
    }
    // `clean` drops undefined, so normalise every envelope field to null: a run
    // that is still in flight must still expose `endedAt` as a key, otherwise a
    // client reading `run.endedAt` on a fixed shape breaks.
    const num = (v) => (typeof v === 'number' ? v : null);
    return clean({
      ok: true,
      run: { id: run.id, workflowId: run.workflowId === undefined ? null : run.workflowId, workflowName: (wf && wf.name) || null, status: run.status === undefined ? null : run.status, startedAt: num(run.startedAt), endedAt: num(run.endedAt) },
      nodes,
      roles,
      totals: { total, completed, failed, working, pending, percent: total === 0 ? 0 : Math.round((completed / total) * 100) },
    });
  };

  // Full detail for ONE role in one run. Deliberately split from `/progress`:
  // the page polls the light summary every few seconds, while a role's complete
  // report (thousands of characters) is fetched only when it is actually opened.
  const roleDetail = async (runId, role) => {
    const run = runId ? await getRun(runId) : await latestRun();
    if (!run) return { ok: true, run: null, role: role || null, nodes: [] };
    const wf = run.workflowId ? await withTable('team_workflows', 'flows', (t) => t.get(run.workflowId)) : null;
    const states = run.nodeStates && typeof run.nodeStates === 'object' ? run.nodeStates : {};
    const defs = wf && wf.nodes && typeof wf.nodes === 'object' ? wf.nodes : null;
    const ids = defs ? Object.keys(defs) : Object.keys(states);
    const nameOf = await roleNamer();
    const tasks = await listTasks();
    const at = now();
    const out = [];
    let budget = NODE_OUTPUT_MAX_TOTAL;
    for (let order = 0; order < ids.length; order++) {
      const nid = ids[order];
      const def = (defs && defs[nid]) || {};
      const st = states[nid] && typeof states[nid] === 'object' ? states[nid] : {};
      const agent = ownerOf(st, def);
      const agentName = nameOf(agent);
      if (role && agentName !== role) continue;
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
      // The ledger keeps the worker's COMPLETE report; the run record keeps a
      // 200-char slice of it, so prefer the ledger and fall back to the slice.
      const full = task && typeof task.output === 'string' ? task.output : (typeof st.output === 'string' ? st.output : '');
      const take = Math.max(0, Math.min(NODE_OUTPUT_MAX, budget));
      budget -= Math.min(full.length, take);
      const startedAt = typeof st.startedAt === 'number' ? st.startedAt : null;
      const endedAt = typeof st.endedAt === 'number' ? st.endedAt : null;
      out.push(clean({
        id: nid, order, agent, agentName,
        status: typeof st.status === 'string' ? st.status : 'pending',
        startedAt, endedAt,
        elapsedMs: startedAt === null ? null : (endedAt === null ? at - startedAt : endedAt - startedAt),
        title: nodeTitle(def, (def.taskTemplate && def.taskTemplate.requirement) || (task && task.requirement)) || null,
        summary: st.summary === undefined ? null : st.summary,
        requirement: (def.taskTemplate && def.taskTemplate.requirement) || (task && task.requirement) || null,
        acceptanceCriteria: (def.taskTemplate && def.taskTemplate.acceptanceCriteria) || (task && task.acceptanceCriteria) || null,
        reviewer: def.reviewer === undefined ? null : def.reviewer,
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
      const subagents = ctx.get('subagents');
      const parent = resolveParentAgent(ctx);
      const agentDefs = await listAgents();
      const setRunState = async (patch) => withTable('team_runs', 'runs', (t) => t.update(runRec.id, (cur) => ({ ...cur, ...patch, nodeStates: { ...(cur.nodeStates || {}), ...(patch.nodeStates || {}) } })));
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
          try {
            await setRunState({ nodeStates: { [nid]: { status: 'working', assignee: node.agent, startedAt: nodeStartedAt } } });
            const task = await createTask({ workflowId, nodeId: nid, assignee: node.agent, reviewer: node.reviewer, requirement: (node.taskTemplate && node.taskTemplate.requirement) || node.id, acceptanceCriteria: (node.taskTemplate && node.taskTemplate.acceptanceCriteria) || '' });
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
            await completeTask(taskId, output, null);
            outputs[nid] = output; completed[nid] = true; succeeded[nid] = true;
            await setRunState({ nodeStates: { [nid]: { status: 'completed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), output: String(output).slice(0, 200), summary: firstLine(output, 140) || null, tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}) } } });
          } catch (e) {
            nodeCtl.abort();
            completed[nid] = true;
            // Never leave an abandoned task at `working`: nothing can advance it.
            if (taskId) await settleTask(taskId).catch(() => undefined);
            await setRunState({ nodeStates: { [nid]: { status: 'failed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), error: String(e), summary: firstLine('失败：' + String(e), 140), tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}) } } });
          }
        }));
      }
      const allDone = nodeIds.every((nid) => completed[nid]);
      const allOk = nodeIds.every((nid) => succeeded[nid] === true);
      const status = allOk ? 'completed' : (allDone ? 'failed' : 'interrupted');
      const summary = allOk ? 'workflow completed' : (allDone ? 'workflow finished with failed nodes' : 'workflow interrupted');
      await withTable('team_runs', 'runs', (t) => t.update(runRec.id, (cur) => ({ ...cur, status, endedAt: now(), result: { outputs, summary } })));
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