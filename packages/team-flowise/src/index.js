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

// P11: a route must be able to say "nothing was declared". With
// `.default('deepseek')` / `.default('deepseek-chat')` an EMPTY model object was
// rewritten into a route no author ever wrote -- and `deepseek` has no registered
// adapter in this deployment, so the persisted record claimed a model that cannot
// resolve and the whole "who declared what" question lost its input. `{}` now
// stays `{}`. This is a LOOSENING only: every already-stored record carries
// explicit strings (all six in ~/.dsh/storages/team_agent_defs.json do), and a
// string is still a string, so domain open-time validation is unaffected.
export const modelSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  // Adapter-owned reasoning strength id. Validity depends on the exact model and
  // is NOT checked here: pickRoute must stay a pure function (see verifyRoute).
  reasoningEffort: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});

// The same shape under the name the route contract uses for it. One definition,
// two names ON PURPOSE (they must never drift): a "model route" IS the model
// field of a role, and the same four optional keys are what run / node /
// workflow layers declare.
export const modelRouteSchema = modelSchema;

export const agentDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  role: z.string().optional(),
  systemPrompt: z.string().optional(),
  // Optional on purpose. `model` is a route DESCRIPTION, and "this role declares
  // no route at all" has to be expressible: while it was required, parsing a raw
  // record that simply has no model key failed outright. Every record written by
  // upsertAgent carries at least `{}`, so making this optional can only accept
  // MORE shapes -- it can never make an existing record fail to open.
  model: modelSchema.optional(),
  skills: z.array(z.string()).default([]),
  // `preset` is a DISCIPLINE preset, expanded into a deny-list at dispatch time
  // (TOOL_PRESETS). It is NOT a sandbox: it removes the most obvious write/exec
  // tools BY NAME and cannot stop an allowed tool from writing indirectly.
  tools: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional(), preset: z.enum(['full', 'no-write', 'no-shell', 'read-only']).optional() }).optional(),
  permissionPolicy: z.string().optional(),
  // P11: per-role timeout. Only ever TIGHTENS a bound: timeoutFor() clamps it
  // against the worker / reviewer ceiling, so it can never raise one.
  timeoutMs: z.number().int().positive().optional(),
  updatedAt: z.number().int().nonnegative(),
});

export const workflowNodeSchema = z.object({
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
  // P11 node-level route: this step runs on a different model. OPTIONAL, and so
  // is every field inside it -- adding a required key here would make every
  // stored workflow record fail validation the moment a domain opens.
  route: modelSchema.optional(),
  // P11 node-level persona ADDON: text appended after the workflow's and the
  // role's persona segments (role -> workflow -> node).
  promptAddon: z.string().optional(),
  // P11: accepted and stored, but deliberately NOT read yet. The timeout is
  // resolved from the ROLE definition alone (timeoutFor(def, ceiling)): letting a
  // node re-declare the timeout would give "which layer wins" a second answer.
  // (Same explicit gap as P11-PLAN section 2.4.)
  timeoutMs: z.number().int().positive().optional(),
});

export const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  nodes: z.record(workflowNodeSchema).default({}),
  // P11 workflow-level route / persona: every step of this flow shares them,
  // unless a node declares its own route (node wins) or the run overrides it
  // (run wins). Purely additive: an old record simply has neither key.
  route: modelSchema.optional(),
  prompt: z.string().optional(),
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
  // P13: opt-in fail-fast, OFF unless declared `true`. Without it the scheduler
  // behaves exactly as it did before P13 -- a failed node still counts as
  // `completed` for its dependents, so the rest of the pipeline runs on an empty
  // artifact. With it, the FIRST node that fails, or that ends with an
  // unresolved BLOCKING review finding, stops the run: every node that has not
  // started yet is recorded `skipped` instead of being dispatched, and the run
  // ends as `halted`. Halt is whole-run, not just the causal chain: "stop the
  // flow" has to mean the flow stopped, not "that one branch stopped".
  // Optional like every other workflow field, so old records still validate.
  haltOnFailure: z.boolean().optional(),
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
  // P13 adds `halted`. It is NOT a synonym for `failed`: `failed` means every
  // node ran and at least one of them failed, while `halted` means the run was
  // stopped ON PURPOSE and some nodes therefore never ran at all. Collapsing the
  // two would hide the only thing a fail-fast run needs to say. It is also not
  // `interrupted`, which already means "the process restarted mid-run".
  // Adding an enum VALUE is a loosening: every stored record still validates, so
  // the domain still opens on a storage file written by an older version.
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted', 'halted']).default('running'),
  nodeStates: z.record(z.any()).default({}),
  result: z.any().optional(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  // P12 run ATTRIBUTION. Both keys are OPTIONAL with NO default, on purpose:
  // every run record already on disk (`~/.dsh/storages/team_runs.json`) has
  // neither key, and the file backend validates on open/put -- a required key
  // would make the domain fail to open and take the whole plugin row down.
  // A default would be worse than useless: it would rewrite the in-memory view
  // of historical records into an attribution nobody ever declared.
  // `sessionId` is the live session that STARTED the run (agent.session.id on
  // the tool path, the request body on the HTTP path). It is absent -- never
  // guessed -- when no session could be resolved, because "we do not know"
  // and "session X" must stay distinguishable in the stored record.
  sessionId: z.string().optional(),
  // The working directory of that session. Advisory only: it is shown for
  // diagnostics and weak grouping and NEVER takes part in attribution.
  workspace: z.string().optional(),
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
// the top-level coding agent.
//
// `cordis_inspect_list/query/self` are deliberately NOT denied. They are
// read-only, and a role that cannot inspect host services, events and tools
// cannot gather the evidence its own report is supposed to cite -- a P12 worker
// given an Inspect-based brief correctly answered "cannot verify" for every item
// because this list denied them outright, while the runtime filter then dropped
// the same names as UNKNOWN in the child's scope (so the deny achieved nothing
// except blocking legitimate reads). The one genuinely dangerous call,
// `cordis_inspect_query({platform:'client'})`, waits for a live browser page and
// is refused at DISPATCH by workerToolGuard below -- which is where that policy
// belongs, because it can inspect the arguments. Installing or removing dynamic
// plugins stays denied: a worker must not mutate the harness it runs in.
const WORKER_DENY_TOOLS = [
  'ask_user_question', 'exit_plan_mode',
  'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
  'create_goal', 'update_goal', 'get_goal',
  'ralph', 'workflow', 'subagent', 'subagent_fork',
  'interrupt_agent', 'send_message', 'list_agents',
  'team_create_agent', 'team_create_task', 'team_create_workflow',
  'team_delegate_agent', 'team_list_agents', 'team_run_workflow', 'team_task_status',
];

// ---- P12 run attribution (pure functions: no ctx, no IO) ----
// A run record may carry `sessionId` (see runSchema). Read paths use these two
// helpers to answer "which run is THIS viewer asking about", which is the fix
// for the P12 defect: `latestRun()` picked the process-wide newest run, so an
// unrelated session's progress page showed somebody else's run as its own.

// Newest run by `startedAt`, ties broken by the LARGER id so the answer is
// TOTAL and DETERMINISTIC -- "whichever the store happened to enumerate first"
// is not a decision. A missing / non-numeric `startedAt` counts as 0 and a
// record without a string `id` is not a run at all.
const newestRunOf = (list) => {
  let best = null;
  for (const r of list) {
    if (!r || typeof r.id !== 'string') continue;
    if (best === null) { best = r; continue; }
    const a = typeof r.startedAt === 'number' ? r.startedAt : 0;
    const b = typeof best.startedAt === 'number' ? best.startedAt : 0;
    if (a > b || (a === b && r.id > best.id)) best = r;
  }
  return best;
};

// Per-call scope evidence for the /progress envelope. Same selection rule as
// selectRun, but it ALSO reports why the run was chosen and how many runs the
// caller's own session has, so a client can tell "nothing of mine ran" from
// "nothing ran at all" without inferring either from a timestamp.
//  * `run`         the selected run IN SCOPE (null when this session has none);
//                  equals selectRun(runs, sessionId) by construction.
//  * `fallback`    what the selection actually used: 'latest-in-session',
//                  'latest-global', or null when NOTHING was selected -- it never
//                  claims a fallback that did not happen;
//  * `hasAnyGlobal` whether any run exists at all, which is what separates
//                  "this session is idle while others are busy" from "the store
//                  is empty". Kept separate from `fallback` so each field means
//                  exactly one thing.
export const runScope = (runs, sessionId) => {
  const list = Array.isArray(runs) ? runs.filter((r) => r && typeof r.id === 'string') : [];
  const globalNewest = newestRunOf(list);
  const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
  if (sid === null) {
    return { mode: 'global', sessionId: null, run: globalNewest, runCountInScope: list.length, fallback: globalNewest === null ? null : 'latest-global', hasAnyGlobal: globalNewest !== null };
  }
  const scoped = list.filter((r) => r.sessionId === sid);
  if (scoped.length === 0) {
    // Deliberately NOT the global newest: handing another session's run to this
    // caller is the exact defect P12 exists to fix. The caller learns that others
    // are running from `hasAnyGlobal`, i.e. as a LABELLED fact, not as its own run.
    return { mode: 'session', sessionId: sid, run: null, runCountInScope: 0, fallback: null, hasAnyGlobal: globalNewest !== null };
  }
  return { mode: 'session', sessionId: sid, run: newestRunOf(scoped), runCountInScope: scoped.length, fallback: 'latest-in-session', hasAnyGlobal: globalNewest !== null };
};

/**
 * Pick the run a viewer is asking about. PURE: never touches ctx, IO or its
 * arguments. Exported so the attribution rule can be asserted without booting
 * the host.
 *
 * @param {Array<object>|null|undefined} runs  every run record, unordered; legacy
 *   records (written before this field existed) simply have no `sessionId`.
 * @param {string|null|undefined} sessionId  the viewer's session, or nothing.
 * @returns {object|null} the selected run record, or null when there is none.
 *
 * Rule, in this strict order (R0 normalises; records without a string `id` are
 * not runs):
 *   R2. `sessionId` is empty / undefined / '' -> the global newest, i.e. EXACTLY
 *       the behaviour of the pre-P12 `latestRun()`. Legacy records stay
 *       reachable here and only here.
 *   R1. `sessionId` is a non-empty string -> the newest record whose OWN
 *       `sessionId` equals it. A legacy record (no `sessionId` key) never
 *       matches, because "we do not know who started it" is not a match.
 *       If this session has NO run at all, the answer is `null` -- deliberately
 *       NOT the global newest. Falling back here would recreate the exact defect
 *       this function exists to fix (showing another session's run as yours);
 *       a caller that WANTS the "somebody else is running" information must ask
 *       `runScope()` for it and label it as such.
 */
export function selectRun(runs, sessionId) {
  const list = Array.isArray(runs) ? runs : [];
  const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null;
  if (sid === null) return newestRunOf(list);
  const scoped = list.filter((r) => r && typeof r.id === 'string' && r.sessionId === sid);
  return scoped.length === 0 ? null : newestRunOf(scoped);
}

// The session that STARTED a run, taken from the live Agent driving it. The tool
// path has one; an agentless HTTP route does not (see resolveParentAgent above),
// which is why the HTTP route passes a session through the request body instead
// of letting this guess. Never throws: attribution must not be able to break a
// run, so every failure degrades to "no session" (absent keys, not empty ones).
export const resolveRunOrigin = (c) => {
  try {
    if (c === undefined || c === null || typeof c.get !== 'function') return {};
    const svc = c.get('agents');
    if (svc === undefined || svc === null || typeof svc.currentInitiator !== 'function') return {};
    const init = svc.currentInitiator();
    if (init === undefined || init === null) return {};
    const session = init.session;
    if (session === undefined || session === null) return {};
    const sid = typeof session.id === 'string' && session.id !== '' ? session.id : undefined;
    const cwd = typeof session.cwd === 'string' && session.cwd !== '' ? session.cwd : undefined;
    const out = {};
    if (sid !== undefined) out.sessionId = sid;
    if (cwd !== undefined) out.workspace = cwd;
    return out;
  } catch (e) { return {}; }
};

// One normaliser for the whole `opts.session` surface, so the HTTP body, the
// HTTP query string and an in-process caller cannot drift into three dialects.
// Accepts either the session id alone ('abc') or { sessionId, workspace }.
// A missing / blank / unknown-shaped value is "no session": the recorded run then
// carries NEITHER key, and `clean()` keeps the write byte-identical to pre-P12.
export const readSessionOption = (session) => {
  if (typeof session === 'string') return session === '' ? {} : { sessionId: session };
  if (session !== null && typeof session === 'object' && !Array.isArray(session)) {
    const sid = typeof session.sessionId === 'string' && session.sessionId !== '' ? session.sessionId : undefined;
    const ws = typeof session.workspace === 'string' && session.workspace !== '' ? session.workspace : undefined;
    const out = {};
    if (sid !== undefined) out.sessionId = sid;
    if (ws !== undefined) out.workspace = ws;
    return out;
  }
  return {};
};

// ---- P11 role-level configuration: route layering, tool presets, persona ----
// Everything in this section is a PURE function of its arguments (no ctx, no IO),
// so each decision can be pinned down without booting the host. The single
// exception is verifyRoute(), which takes the `llm` service as an explicit
// argument so a stub can be injected.
//
// ROUTE_SOURCES is the ONE source of truth for the layer names and their
// precedence: run > node > workflow > role > inherited.
export const ROUTE_SOURCES = ['run', 'node', 'workflow', 'role', 'inherited'];
const ROUTE_LAYER_ORDER = ['run', 'node', 'workflow', 'role'];
const ROUTE_KEYS = ['provider', 'model', 'reasoningEffort', 'maxTokens'];

// "Declared" is NOT the same as "present": a whitespace-only string and a
// zero/negative/non-finite maxTokens are not declarations. Without this a layer
// holding {provider:'', model:'   '} would beat a layer that really configured a
// model, and the node would run on a route nobody wrote.
const routeFieldValue = (key, value) => {
  if (value === undefined || value === null) return undefined;
  if (key === 'maxTokens') return (typeof value === 'number' && isFinite(value) && value > 0) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
};

// One layer, reduced to the fields it actually declares; null when it declares
// none (an empty object, only blanks, only an invalid maxTokens...).
export function normalizeRouteLayer(layer) {
  if (layer === null || layer === undefined || typeof layer !== 'object' || Array.isArray(layer)) return null;
  const out = {};
  for (const key of ROUTE_KEYS) {
    const v = routeFieldValue(key, layer[key]);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

// The whole layer wins, or nothing does. There is deliberately NO cross-layer
// field merging: `run = {model:'m1'}` + `role = {provider:'deepseek-official'}`
// must never compose `deepseek-official/m1`, because that route has no author --
// it would fail with NO_ADAPTER (or run on a combination nobody chose) and the
// blame would point at a layer that never participated in the decision.
export function pickRoute(layers) {
  const l = layers === null || layers === undefined || typeof layers !== 'object' ? {} : layers;
  for (const name of ROUTE_LAYER_ORDER) {
    const norm = normalizeRouteLayer(l[name]);
    if (norm !== null) return { route: norm, source: name };
  }
  return { route: {}, source: 'inherited' };
}

// Messages only -- no IO, no ctx. `picked` is { route } (or the route itself),
// `parentRoute` is the route the parent agent is actually running, if known.
export function routeWarnings(picked, parentRoute) {
  const out = [];
  const src = picked && typeof picked === 'object' && picked.route !== undefined ? picked.route : picked;
  const route = src && typeof src === 'object' ? src : {};
  const parent = parentRoute && typeof parentRoute === 'object' ? parentRoute : null;
  const provider = routeFieldValue('provider', route.provider);
  const model = routeFieldValue('model', route.model);
  const effort = routeFieldValue('reasoningEffort', route.reasoningEffort);
  // (a) the pair rule. Keeping the surviving half would merge it with the
  // parent's other half, producing a route NOBODY wrote.
  if (provider !== undefined && model === undefined) {
    out.push('provider/model 必须成对声明：本层只声明了 provider（' + provider + '）、没有 model，因此 provider/model 成对作废，provider 被忽略（保留它会与父级的 model 拼装出没有任何作者声明过的混合路由）；该层其余字段仍单独生效。');
  } else if (model !== undefined && provider === undefined) {
    out.push('provider/model 必须成对声明：本层只声明了 model（' + model + '）、没有 provider，因此 provider/model 成对作废，model 被忽略（保留它会与父级的 provider 拼装出没有任何作者声明过的混合路由）；该层其余字段仍单独生效。');
  }
  // (b) the runtime's own rule: resolveChildAgentOptions() deletes an inherited
  // reasoningEffort when the route changed and the request did not name one, so
  // the parent's effort is dropped and the model default takes over. Not a bug --
  // but it MUST be said out loud, or "I only changed the model" silently changes
  // the reasoning strength as well.
  if (provider !== undefined && model !== undefined && effort === undefined) {
    const parentProvider = parent === null ? undefined : routeFieldValue('provider', parent.provider);
    const parentModel = parent === null ? undefined : routeFieldValue('model', parent.model);
    const parentKnown = parentProvider !== undefined && parentModel !== undefined;
    if (!parentKnown || provider !== parentProvider || model !== parentModel) {
      out.push('route 已变更（provider/model ' + (parentKnown ? '与父级 ' + parentProvider + '/' + parentModel + ' 不同' : '父级未知') + '）但未声明 reasoningEffort：父级 effort 会被清除，改由该模型默认值决定。');
    }
  }
  // (c) an unusable maxTokens is dropped, never silently.
  if (route.maxTokens !== undefined && routeFieldValue('maxTokens', route.maxTokens) === undefined) {
    out.push('maxTokens 非法（' + JSON.stringify(route.maxTokens) + '）：已忽略该字段（必须是正有限数）。');
  }
  return out;
}

// A canonical, comparable string for logs / dedup. Empty fields do not take part,
// and field order is fixed so two equal routes always produce one string.
export function routeSignature(route) {
  const r = route && typeof route === 'object' ? route : {};
  const parts = [];
  const provider = routeFieldValue('provider', r.provider);
  if (provider !== undefined) parts.push('provider=' + provider);
  const model = routeFieldValue('model', r.model);
  if (model !== undefined) parts.push('model=' + model);
  const effort = routeFieldValue('reasoningEffort', r.reasoningEffort);
  if (effort !== undefined) parts.push('effort=' + effort);
  const maxTokens = routeFieldValue('maxTokens', r.maxTokens);
  if (maxTokens !== undefined) parts.push('maxTokens=' + String(maxTokens));
  return parts.join(';');
}

// The persona is built from three text layers, in this fixed order:
//   role     -> agentDef.systemPrompt        (the role definition)
//   workflow -> workflowSchema.prompt        (this flow)
//   node     -> workflowNodeSchema.promptAddon (this step)
// Joined with a blank line so two sentences can never be glued into one. Blank
// layers do not participate, and `layers` names only the ones that really
// contributed, so "no persona at all" stays distinguishable from "an empty one".
// No semantic rewriting happens here: what the author wrote is what is sent.
export function mergePersona(layers) {
  const l = layers === null || layers === undefined || typeof layers !== 'object' ? {} : layers;
  const texts = [];
  const used = [];
  for (const name of ['role', 'workflow', 'node']) {
    const v = l[name];
    if (typeof v !== 'string' || v.trim() === '') continue;
    texts.push(v);
    used.push(name);
  }
  const text = texts.join('\n\n');
  return { text, layers: used, chars: text.length };
}

// A role may only ever TIGHTEN its own timeout: the result is clamped into
// [1000, ceiling], and a missing / zero / nonsensical declaration means "use the
// ceiling". (0 and negatives are NOT "instant timeout" -- they are typos.)
export function timeoutFor(def, ceiling) {
  const limit = typeof ceiling === 'number' && isFinite(ceiling) && ceiling > 0 ? ceiling : 600000;
  const raw = def ? def.timeoutMs : undefined;
  // A missing, zero, negative or non-finite declaration is a typo, not an
  // instruction, so it means "use the ceiling". The earlier `raw || limit`
  // handled 0 but NOT negatives: -5 survived as a value and was then clamped UP
  // to the 1000ms floor, i.e. one stray minus sign would have timed every node
  // out after a second -- the opposite of the documented intent.
  const declared = typeof raw === 'number' && isFinite(raw) && raw > 0;
  const n = declared ? raw : limit;
  return Math.min(limit, Math.max(1000, n));
}

// The four DISCIPLINE presets, as deny-lists. `full` means "add nothing" (the
// plugin's own WORKER_DENY_TOOLS still applies -- a worker never gets the
// client-Inspect / human-prompt tools). Names come from the tool registry this
// deployment actually ships: dsh-tool-fs registers read/write/edit/read_image,
// dsh-tool-str-replace-editor registers str_replace_editor, dsh-tool-pwsh and
// dsh-tool-bash register pwsh/bash. `read-only` is BY CONSTRUCTION the union of
// `no-write` and `no-shell` (asserted, so one cannot drift from the other).
export const TOOL_PRESETS = {
  full: [],
  'no-write': ['write', 'edit', 'str_replace_editor'],
  'no-shell': ['pwsh', 'bash'],
  'read-only': ['write', 'edit', 'str_replace_editor', 'pwsh', 'bash'],
};

// Expand one preset against the tool names THIS deployment exposes.
//  * `known` is a Set (from tools.schemas(parent)) -> only names the runtime
//    really has go into `deny`; the rest come back in `unknown` so the caller can
//    RECORD them instead of dropping them silently.
//  * `known` undefined (no `tools` service, or schemas() threw) -> pass every
//    name through and let the runtime validate: startWorker() then narrows the
//    filter to exactly the names the runtime reported as unknown.
export function expandToolPreset(preset, known) {
  const list = TOOL_PRESETS[preset];
  if (!Array.isArray(list) || list.length === 0) return { deny: [], unknown: [] };
  if (known === undefined || known === null || typeof known.has !== 'function') return { deny: list.slice(), unknown: [] };
  const deny = [];
  const unknown = [];
  for (const name of list) {
    if (known.has(name)) { if (deny.indexOf(name) === -1) deny.push(name); }
    else if (unknown.indexOf(name) === -1) unknown.push(name);
  }
  return { deny, unknown };
}

// Can this route actually run? Four outcomes, and NONE of them fails the node:
//   1. llm unavailable            -> ok:true,  verified:false, note (pass through)
//   2. provider has no adapter    -> ok:false, warning (the caller falls back to
//   3. model does not resolve        inheriting the parent route and records it)
//   4. model rejects the effort   -> ok:false, warning
//   5. verified                   -> ok:true,  verified:true, resolved summary
// ok:false means "do not set agentOptions at all": a route that cannot run is the
// ONLY thing worse than no route, because the child's first request dies with
// NO_ADAPTER and the node looks failed for a reason nobody declared.
export async function verifyRoute(llm, picked, parentRoute) {
  void parentRoute; // the parent comparison belongs to routeWarnings(); kept in the signature for symmetry
  const src = picked && typeof picked === 'object' && picked.route !== undefined ? picked.route : picked;
  const route = src && typeof src === 'object' ? src : {};
  const provider = routeFieldValue('provider', route.provider);
  const model = routeFieldValue('model', route.model);
  const effort = routeFieldValue('reasoningEffort', route.reasoningEffort);
  if (llm === undefined || llm === null || typeof llm.resolveModelInfo !== 'function') {
    return { ok: true, verified: false, resolved: null, warning: null, note: 'llm 服务不可用，route 未经校验直接透传' };
  }
  if (provider === undefined || model === undefined) {
    // Nothing to resolve -- but say WHICH kind of nothing: "no route declared at
    // all" (inherit the parent) is a different fact from "half a pair declared"
    // (the pair rule voided it), and both must be readable on the node.
    const declaredNothing = Object.keys(route).length === 0;
    const source = picked && typeof picked === 'object' && typeof picked.source === 'string' ? '（source=' + picked.source + '）' : '';
    return {
      ok: true, verified: false, resolved: null, warning: null,
      note: declaredNothing
        ? '该层未声明任何 route 字段' + source + '，子代理继承父级 route，无需校验'
        : 'route 未同时声明 provider 与 model（成对规则），provider/model 对作废，无可校验的目标；该层其余字段仍然生效',
    };
  }
  let listed = null;
  if (typeof llm.listProviders === 'function') {
    try { const l = llm.listProviders(); listed = Array.isArray(l) ? l : null; } catch (e) { listed = null; }
  }
  if (listed !== null) {
    const has = listed.some((p) => p && p.id === provider);
    if (!has) {
      const registered = listed.map((p) => (p && p.id) || '?').join(', ');
      return {
        ok: false, verified: false, resolved: null, note: null,
        warning: '没有注册名为 ' + provider + ' 的 provider 适配器（已注册：' + (registered === '' ? '（无）' : registered) + '）；本节点回退继承父级 route',
      };
    }
  }
  let resolved = null;
  try { resolved = await llm.resolveModelInfo(provider, model); }
  catch (e) {
    return { ok: false, verified: false, resolved: null, note: null, warning: 'model 无法解析：' + String(e && e.message ? e.message : e) };
  }
  const reasoning = resolved && resolved.reasoning && typeof resolved.reasoning === 'object' ? resolved.reasoning : null;
  const efforts = reasoning && Array.isArray(reasoning.efforts)
    ? reasoning.efforts.map((x) => (x && typeof x.id === 'string' ? x.id : null)).filter((x) => x !== null && x !== '')
    : [];
  const summary = {
    contextWindow: resolved && resolved.context && typeof resolved.context.contextWindow === 'number' ? resolved.context.contextWindow : null,
    defaultMaxTokens: resolved && typeof resolved.defaultMaxTokens === 'number' ? resolved.defaultMaxTokens : null,
    efforts,
    defaultEffort: reasoning && typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : null,
  };
  if (effort !== undefined && efforts.indexOf(effort) === -1) {
    return {
      ok: false, verified: false, resolved: summary, note: null,
      warning: 'model ' + model + ' 不接受 effort ' + effort + '（可选：' + (efforts.length ? efforts.join(', ') : '该模型未声明任何 reasoning effort') + '）',
    };
  }
  return { ok: true, verified: true, resolved: summary, warning: null, note: null };
}

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

// Given the reason the FIRST verdict failed to parse, ask the reviewer once more
// for a machine-readable answer. Real models write near-JSON -- the live P12 run
// lost one review of six to an unescaped double quote inside a string value --
// and discarding the review entirely throws away the judgement along with it.
// Every rule below targets a specific failure mode of LLM-produced JSON.
export function buildReviewRepairPrompt(spec) {
  const s = spec || {};
  const reason = s.reason === undefined || s.reason === null || String(s.reason) === '' ? '未知（原文不是合法 JSON）' : String(s.reason);
  const lines = [];
  lines.push('你上一次的评审结论无法被解析（原因：' + reason + '）。请重新给出同一份结论，并严格遵守下面的输出规则：');
  lines.push('1. 只输出一个 JSON 对象，不要写任何解释、开场白、结束语或 Markdown 代码块标记。');
  lines.push('2. 字符串值内部绝对不要出现未转义的双引号：需要引用原文时，请改用中文引号「」。这是上一次失败的最常见原因。');
  lines.push('3. 每个字符串值必须写在同一行内，不要在其中换行；不要把换行写成真实换行，需要时写 \\n。');
  lines.push('4. 字段保持不变：verdict（"pass" 或 "rework"）、score、summary、findings、resolved、uncertainties。');
  lines.push('5. 判定纪律不变：没有 blocking 条目时 verdict 必须是 "pass"；每条 blocking 必须给出 criterion 与 evidence。');
  if (Array.isArray(s.knownBlocking) && s.knownBlocking.length) {
    lines.push('6. 这是返工后的复审：只能核对上一轮这些阻塞项是否解决，不得提出新的 blocking。上一轮的阻塞项：');
    for (let i = 0; i < s.knownBlocking.length; i++) lines.push('   - ' + String(s.knownBlocking[i]));
  }
  lines.push('');
  lines.push('结构示例（仅示意字段，不要照抄内容）：{"verdict":"pass","score":90,"summary":"一句话结论","findings":[],"resolved":[],"uncertainties":[]}');
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
    blockingCount: 0, advisoryCount: 0, carriedCount: 0, notes, parseError: o.parseError === undefined ? null : o.parseError,
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
  // R7 -- a re-review that EXPLICITLY reports a previous blocking item as still
  // unresolved must keep blocking, even when it restates the problem in fresh
  // words. Live evidence (P12 run, node impl-client): round 2 answered
  // `resolved: [..., resolved: false]` for the round-1 criterion while wording
  // its finding differently, so R4 downgraded that finding and R6 then forced
  // `pass` -- the node shipped an acknowledged-but-unfixed blocker as a pass.
  // R4's purpose (no NEW blockers on a re-review) is untouched: this only
  // reinstates criteria the reviewer itself listed as unresolved. The carried
  // entries go to the FRONT so R5 truncation cannot drop them.
  const rawResolvedList = Array.isArray(raw.resolved) ? raw.resolved : [];
  const carried = [];
  if (round >= 2 && known.length > 0) {
    for (const r of rawResolvedList) {
      const src = (r !== null && typeof r === 'object' && !Array.isArray(r)) ? r : {};
      if (src.resolved === true) continue;
      const label = src.finding !== undefined && src.finding !== null ? String(src.finding)
        : (src.criterion !== undefined && src.criterion !== null ? String(src.criterion) : '');
      const key = canonCriterion(label);
      if (key === '' || known.indexOf(key) === -1) continue;
      const ev = src.evidence === undefined || src.evidence === null ? '' : String(src.evidence).trim();
      carried.push({
        severity: 'blocking', downgraded: false, downgradeReason: null,
        dimension: '复审', carried: true,
        criterion: label,
        evidence: ev === '' ? '评审者报告：上一轮阻塞项仍未解决（未附证据）' : ev,
        impact: '上一轮判定必须返工的问题在本轮复审中仍未解决',
        suggestion: null,
      });
    }
    if (carried.length) notes.push('R7：评审者把上一轮 ' + carried.length + ' 条阻塞项标为仍未解决，按阻塞处理（复审不得靠改写措辞绕过已判定的阻塞项）');
  }
  const allFindings = carried.length ? carried.concat(findings) : findings;
  // R5 -- bound the payload: a reviewer that emits 200 findings must not turn
  // /progress into a heavy response.
  let kept = allFindings;
  if (allFindings.length > REVIEW_LIMITS.maxFindings) {
    kept = allFindings.slice(0, REVIEW_LIMITS.maxFindings);
    notes.push('R5：findings 共 ' + allFindings.length + ' 条，超过上限 ' + REVIEW_LIMITS.maxFindings + ' 条，已截断为前 ' + REVIEW_LIMITS.maxFindings + ' 条');
  }
  for (const f of kept) if (f.downgraded && f.downgradeReason) notes.push(f.downgradeReason);
  result.findings = kept;
  result.carriedCount = carried.length;
  result.blockingCount = kept.filter((f) => f.severity === 'blocking').length;
  result.advisoryCount = kept.filter((f) => f.severity !== 'blocking').length;
  const rawScore = typeof raw.score === 'number' && isFinite(raw.score) ? Math.round(raw.score) : null;
  result.score = rawScore === null ? null : Math.max(0, Math.min(100, rawScore));
  const rawSummary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  const wantsRework = raw.verdict === 'rework';
  // R6 -- "rework" with nothing blocking is self-contradictory; without this the
  // verdict string alone could stretch a task with no stated reason. A carried
  // (R7) entry is a blocking reason the reviewer itself stated, so an explicit
  // "not resolved" forces rework even when the verdict string says otherwise.
  let verdict = (wantsRework || carried.length > 0) ? 'rework' : 'pass';
  if (verdict === 'rework' && result.blockingCount === 0) {
    verdict = 'pass';
    notes.push('R6：结论自相矛盾：rework 但无阻塞项，按不阻塞处理，verdict 改为 pass');
  }
  result.verdict = verdict;
  result.summary = rawSummary !== '' ? rawSummary : (verdict === 'pass' ? '评审通过（评审者未提供摘要）' : '评审要求返工（评审者未提供摘要）');
  result.resolved = rawResolvedList.map((r) => {
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
  // The route the caller is ACTUALLY running on, as the runtime recorded it on
  // its own request header. Used for the effort-clearing warning and for the
  // "what does the child inherit" projection. Unreadable => null (unknown), never
  // guessed.
  const routeConfigOf = (agent) => {
    try {
      const cfg = agent && agent.session && typeof agent.session.requestHeader === 'function'
        ? ((agent.session.requestHeader() || {}).config || null)
        : null;
      if (cfg === null || typeof cfg !== 'object') return null;
      return {
        provider: cfg.provider === undefined ? null : cfg.provider,
        model: cfg.model === undefined ? null : cfg.model,
        reasoningEffort: cfg.reasoningEffort === undefined ? null : cfg.reasoningEffort,
        maxTokens: cfg.maxTokens === undefined ? null : cfg.maxTokens,
      };
    } catch (e) { return null; }
  };
  // The child's REAL route. `started.run` is the SubagentRun; its `localAgent` is
  // the live child Agent. This is the only authoritative source ("what did it run
  // on"), so a read failure is reported as null => measured:false, and the
  // requested values are never dressed up as measured ones.
  const measureChildRoute = (started) => {
    try {
      const child = started && started.run ? started.run.localAgent : undefined;
      return routeConfigOf(child);
    } catch (e) { return null; }
  };
  // The child's request header only exists once it has issued its first request,
  // so a read taken immediately after `start()` may legitimately be empty. Re-read
  // after the child settles and keep the LAST non-null read: this can add a real
  // measurement, but it can never turn an absent header into an invented route
  // (measured stays false until a header was really read).
  const refreshMeasured = (started, prev) => {
    const m = measureChildRoute(started);
    return m !== null ? m : prev;
  };
  // Pick the layer that wins, verify it against the real model catalog, and decide
  // what (if anything) is handed to the runtime. Pure decisions live in the
  // module-level functions above; this wrapper only adds ctx + the llm service.
  //
  // A note on maxTokens: the runtime MERGES child options over the parent's
  // (`...parentMaxTokens` in resolveChildAgentOptions), so a child that declares
  // no maxTokens INHERITS the parent's cap. P11 does not change that; `measured`
  // (the child's own request header) is what makes it visible.
  const decideRoute = async (def, parent, opts) => {
    const o = opts || {};
    const picked = pickRoute({
      run: o.runRoute,
      node: o.node ? o.node.route : undefined,
      workflow: o.workflow ? o.workflow.route : undefined,
      role: def ? def.model : undefined,
    });
    const parentRoute = o.parentRoute === undefined ? routeConfigOf(parent) : o.parentRoute;
    const verify = await verifyRoute(ctx.get('llm'), picked, parentRoute);
    const applied = {};
    if (verify.ok) {
      // provider/model only EVER travel together: either both or neither. A lone
      // provider would be merged with the parent's model by the runtime.
      if (picked.route.provider !== undefined && picked.route.model !== undefined) {
        applied.provider = picked.route.provider;
        applied.model = picked.route.model;
      }
      // These two are independent of the pair: they do not select an adapter, so
      // they can be attached on their own (and declaring them does NOT trigger the
      // runtime's effort-clearing branch unless the provider/model pair moved).
      if (picked.route.reasoningEffort !== undefined) applied.reasoningEffort = picked.route.reasoningEffort;
      if (picked.route.maxTokens !== undefined) applied.maxTokens = picked.route.maxTokens;
    }
    // ok:false => agentOptions is not set AT ALL: the child inherits the parent
    // route, exactly the effect the code had before P11. The only safe direction
    // for a route that cannot run.
    const pairApplied = applied.provider !== undefined && applied.model !== undefined;
    const parentProvider = parentRoute ? parentRoute.provider : null;
    const parentModel = parentRoute ? parentRoute.model : null;
    const parentEffort = parentRoute ? (parentRoute.reasoningEffort === undefined ? null : parentRoute.reasoningEffort) : null;
    const parentMaxTokens = parentRoute ? (parentRoute.maxTokens === undefined ? null : parentRoute.maxTokens) : null;
    const resolved = verify.resolved;
    let effective;
    if (!verify.ok) {
      effective = { provider: parentProvider, model: parentModel, reasoningEffort: parentEffort, maxTokens: parentMaxTokens };
    } else {
      const pairChanged = pairApplied && (applied.provider !== parentProvider || applied.model !== parentModel);
      const defaultEffort = resolved ? resolved.defaultEffort : null;
      const defaultMaxTokens = resolved ? resolved.defaultMaxTokens : null;
      effective = {
        provider: pairApplied ? applied.provider : parentProvider,
        model: pairApplied ? applied.model : parentModel,
        // A changed route with no declared effort means the parent's effort is
        // cleared and the model default takes over (resolveChildAgentOptions).
        reasoningEffort: applied.reasoningEffort !== undefined
          ? applied.reasoningEffort
          : (pairChanged ? defaultEffort : (parentEffort !== null ? parentEffort : defaultEffort)),
        // An undeclared maxTokens inherits the parent's cap before the adapter default.
        maxTokens: applied.maxTokens !== undefined ? applied.maxTokens : (parentMaxTokens !== null ? parentMaxTokens : defaultMaxTokens),
      };
    }
    const warns = routeWarnings(picked, parentRoute);
    const warning = verify.warning !== null && verify.warning !== undefined
      ? verify.warning
      : (warns.length ? warns.join(' ') : null);
    return {
      picked, verify, applied, effective, warning,
      note: verify.note === undefined ? null : verify.note,
      efforts: resolved ? resolved.efforts : null,
      defaultEffort: resolved ? resolved.defaultEffort : null,
    };
  };
  // The evidence record written onto the node. `measured` says whether the child's
  // own request header was really read; when it was, that value IS the effective
  // route (and the projection above is not used at all).
  const routeRecordOf = (decision, measured, timeoutMs) => clean({
    requested: Object.keys(decision.picked.route).length ? decision.picked.route : null,
    source: decision.picked.source,
    effective: measured !== null ? measured : decision.effective,
    measured: measured !== null,
    verified: decision.verify.verified === true,
    warning: decision.warning === null || decision.warning === undefined ? null : decision.warning,
    note: decision.note,
    efforts: decision.efforts,
    defaultEffort: decision.defaultEffort,
    timeoutMs,
  });
  const spawnSpecFor = (def, parent, opts) => {
    const o = opts || {};
    const defTools = (def && def.tools) || {};
    const applied = o.decision ? o.decision.applied : {};
    // Pass EVERY name: the runtime validates a filter against the CHILD's own
    // scope and rejects the whole filter on one unknown name. Pre-filtering
    // against a locally computed view silently produced an EMPTY deny-list --
    // i.e. a worker holding the full 41-tool coding surface, including the very
    // client-Inspect tool this policy exists to withhold.
    const deny = [];
    for (const name of WORKER_DENY_TOOLS) if (deny.indexOf(name) === -1) deny.push(name);
    // P11 tool preset -> deny-list. Expanded against the names this deployment
    // really exposes; a preset name that is NOT visible here (e.g.
    // str_replace_editor in a deployment that ships dsh-tool-fs only) is recorded
    // in the node's toolNote, never dropped in silence.
    const known = knownToolNames(parent);
    const preset = defTools.preset;
    const expanded = expandToolPreset(preset, known);
    let presetNote = null;
    if (typeof preset === 'string' && preset !== '' && TOOL_PRESETS[preset] === undefined) {
      presetNote = '未知工具预设 "' + preset + '"（可选：full, no-write, no-shell, read-only），未展开任何 deny';
    } else if (expanded.unknown.length) {
      presetNote = 'preset "' + preset + '" 中的 ' + expanded.unknown.map((n) => '"' + n + '"').join(', ') + ' 在本部署不可见，未加入 deny';
    }
    for (const name of expanded.deny) if (deny.indexOf(name) === -1) deny.push(name);
    for (const name of defTools.deny || []) if (deny.indexOf(name) === -1) deny.push(name);
    // An explicit allow-list wins over the role's OWN deny list, but never over a
    // POLICY: neither the plugin's always-blocked set nor a tool preset may be
    // re-admitted by naming it in `allow`. While only WORKER_DENY_TOOLS was
    // filtered here, `preset:'read-only'` + `allow:['write']` silently produced a
    // writer -- the exact opposite of what the preset promises.
    const policy = WORKER_DENY_TOOLS.concat(expanded.deny);
    const requestedAllow = defTools.allow || [];
    const allow = requestedAllow.filter((n) => policy.indexOf(n) === -1);
    const strippedAllow = requestedAllow.filter((n) => policy.indexOf(n) !== -1);
    if (strippedAllow.length) {
      presetNote = (presetNote === null ? '' : presetNote + ' | ') + 'allow 中的 ' + strippedAllow.join(', ') + ' 属于策略禁项，未被重新放行';
    }
    const spec = {};
    if (applied.provider !== undefined && applied.model !== undefined) {
      spec.agentOptions = { provider: applied.provider, model: applied.model };
    }
    if (applied.reasoningEffort !== undefined) spec.agentOptions = Object.assign(spec.agentOptions || {}, { reasoningEffort: applied.reasoningEffort });
    if (applied.maxTokens !== undefined) spec.agentOptions = Object.assign(spec.agentOptions || {}, { maxTokens: applied.maxTokens });
    // Persona: role -> workflow -> node. The reviewer's `node` layer is null on
    // purpose (see runReview): the reviewed node's promptAddon describes the
    // worker, not the judge.
    const persona = mergePersona({ role: def && def.systemPrompt, workflow: o.workflow ? o.workflow.prompt : undefined, node: o.node ? o.node.promptAddon : undefined });
    // The runtime renders a section through strict `{{variable}}` interpolation
    // and THROWS on a malformed or unknown reference (dsh-system-prompt:
    // "malformed prompt variable reference" / "unknown prompt variable"), which
    // would kill the child before it ever starts. A lone `{{` with no later `}}`
    // is documented as literal prose, but instead of reasoning about which groups
    // are inert we neutralise the sequence itself: the persona is KEPT in full and
    // only `{{` becomes `{ {`. The earlier behaviour dropped the entire persona --
    // throwing away a user's whole custom prompt over two characters.
    const safePersona = persona.text.split('{{').join('{ {');
    if (safePersona !== '') spec.persona = safePersona;
    if (allow.length) spec.toolFilter = { allow };
    else if (deny.length) spec.toolFilter = { deny };
    const personaState = persona.text === '' ? null : clean({
      chars: persona.chars,
      layers: persona.layers,
      warning: safePersona === persona.text ? null : '人设段含 {{，已替换为 { { 以避免被运行时当作插值引用（否则该子代理会因未知变量而启动失败）',
    });
    return { spec, persona: personaState, presetNote };
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

  // ---- P12 availability note in the host system prompt ----
  // Without this, nothing tells the model that a multi-role team exists in this
  // deployment, so `team_*` (and the skill that documents it) is discoverable
  // only by reading the tool list. Five lines, no `{{...}}` placeholders (this
  // service renders sections strictly and THROWS on an unknown variable).
  //
  // Deliberate properties, all of them load-bearing:
  //  * `ctx.get('systemPrompt')` instead of adding it to this plugin's `inject`:
  //    `inject` is an assembly precondition, so a deployment without the service
  //    would take the whole plugin row down. This way a missing service is a
  //    logged skip and the tools/HTTP bridge still mount.
  //  * registered inside `ctx.effect`, so the section is removed on unmount
  //    (systemPrompt.section() itself returns the Cordis effect disposer).
  //  * section name is namespaced (`team-flowise:`) and unique: a duplicate name
  //    in the same layer THROWS, which would break host composition.
  //  * order 2050 places it inside the tool-description band (TOOL_* 1000..2900)
  //    and after PLAN_POLICY/TEAM_POLICY (500/600), i.e. as capability
  //    documentation rather than policy. It is a literal, not a new
  //    SECTION_ORDERS entry (that table lives in dsh itself).
  //  * NEVER `complete: true`: a complete section replaces every other section,
  //    i.e. it would erase the rest of the prompt.
  //  * the whole registration is guarded: a failure here must never fail the mount.
  const SYSTEM_PROMPT_SECTION = 'team-flowise:availability';
  const SYSTEM_PROMPT_TEXT = [
    'Multi-agent team orchestration is available in this session.',
    '- Reach for the team_* tools when the user asks for several roles/agents to collaborate, or for an independent review of a deliverable; before designing or changing a pipeline, load the team-flowise skill.',
    '- Roles live in the team registry: team_list_agents lists them, team_create_agent creates one (passing an id MODIFIES that role).',
    '- team_create_task only records a task in the ledger and never runs it. team_delegate_agent and team_run_workflow BLOCK until their subagents finish (minutes), so build the roles and the workflow first, then start it.',
    '- Run progress is visible in the "多 Agent 团队进度" panel (sidebar icon / right pane) and at GET /api/team-flowise/progress; a run is attributed to the session that started it.',
  ].join('\n');
  try {
    const systemPromptSvc = ctx.get('systemPrompt');
    if (systemPromptSvc !== undefined && systemPromptSvc !== null && typeof systemPromptSvc.section === 'function') {
      ctx.effect(() => systemPromptSvc.section({ name: SYSTEM_PROMPT_SECTION, order: 2050, text: SYSTEM_PROMPT_TEXT }));
    } else {
      console.warn('team-flowise: systemPrompt service unavailable; the team_* tools are not announced in the system prompt (they remain registered and callable)');
    }
  } catch (e) {
    console.warn('team-flowise: could not announce the team tools in the system prompt: ' + String(e));
  }

  const withTable = async (domainName, tableName, fn) => { const d = await domainReady[domainName]; if (!d) throw new Error('team-flowise: domain not ready ' + domainName); return fn(d.table(tableName)); };
  const clean = (v) => { if (Array.isArray(v)) return v.map(clean); if (v === null || typeof v !== 'object') return v; const r = {}; for (const k in v) { const x = clean(v[k]); if (x !== undefined) r[k] = x; } return r; };

  // ---- catalog ----
  const upsertAgent = async (def) => {
    const rec = agentDefSchema.parse(clean({ id: (def && def.id) || makeId(), name: def && def.name, role: def && def.role, systemPrompt: def && def.systemPrompt, model: (def && def.model) || {}, skills: (def && def.skills) || [], tools: (def && def.tools) || {}, permissionPolicy: def && def.permissionPolicy, timeoutMs: def && def.timeoutMs, updatedAt: now() }));
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
    // P11 adds `route` / `prompt` to the same write path for the same reason:
    // declared-but-unstored is exactly the defect this comment was written about.
    // P13 adds `haltOnFailure` to the same write path for exactly the same
    // reason: a workflow that declares "stop when a step fails" and then stores
    // nothing would report a halt setting that can never take effect.
    const rec = workflowSchema.parse(clean({ id: (wf && wf.id) || makeId(), name: wf && wf.name, description: wf && wf.description, nodes: (wf && wf.nodes) || {}, route: wf && wf.route, prompt: wf && wf.prompt, review: wf && wf.review, haltOnFailure: wf && wf.haltOnFailure, updatedAt: now() }));
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
  // P11 light projections for the poll payload. Every field is defaulted (never
  // omitted) so the client can read the shape without existence checks, and a
  // missing record is `null` -- "no route was recorded" must stay distinguishable
  // from "a route record that happens to be empty".
  const lightRoute = (r) => {
    if (r === null || r === undefined || typeof r !== 'object') return null;
    const e = r.effective && typeof r.effective === 'object' ? r.effective : {};
    return {
      source: r.source === undefined ? null : r.source,
      effective: {
        provider: e.provider === undefined ? null : e.provider,
        model: e.model === undefined ? null : e.model,
        reasoningEffort: e.reasoningEffort === undefined ? null : e.reasoningEffort,
        maxTokens: e.maxTokens === undefined ? null : e.maxTokens,
      },
      measured: r.measured === true,
      warning: r.warning === undefined ? null : r.warning,
    };
  };
  const lightPersona = (p) => {
    if (p === null || p === undefined || typeof p !== 'object') return null;
    return {
      chars: typeof p.chars === 'number' ? p.chars : 0,
      layers: Array.isArray(p.layers) ? p.layers.slice() : [],
    };
  };
  // Node status -> the six totals buckets. `reviewing` and `rework` MUST be
  // explicit branches: the old `else pending += 1` swallowed every unknown
  // status, which would report a node that is being reviewed as "waiting"
  // (i.e. "not started yet") -- a directionally wrong statement, not a rounding
  // error. `percent` is deliberately NOT derived from these; it stays
  // completed/total so its meaning is unchanged.
  // P13: a `skipped` node (its run was halted before it started) deliberately
  // falls into the `pending` bucket. The roll-up key set is a stability contract
  // the client asserts against, and "not completed, not failed, not in flight"
  // is genuinely the same bucket. The distinction is NOT lost -- it stays on the
  // node itself (`status: 'skipped'` + `blockedBy`), which is what the UI reads
  // to render 「已跳过」 and to count them for the halt notice.
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

  // P12: the explicit-run lookup, fed by `selectRun` (pure, exported above) so the
  // attribution rule has exactly ONE implementation. `sessionId` semantics:
  // undefined/null/'' -> the pre-P12 global-newest behaviour; a real id -> THAT
  // session's newest run, or null when that session has no run (deliberately not
  // degraded into "some other session's run" -- see selectRun).
  const runForSession = async (sessionId) => {
    const runs = await listRuns();
    try { return { run: selectRun(runs, sessionId), scope: runScope(runs, sessionId) }; }
    catch (e) { console.warn('team-flowise: run attribution failed, falling back to the global newest: ' + String(e)); return { run: newestRunOf(Array.isArray(runs) ? runs : []), scope: null }; }
  };
  // Envelope projection for one run. Every key keeps its pre-P12 meaning; P12 adds
  // `sessionId` (null when the record predates attribution) so a client can tell
  // "this run is not mine" WITHOUT inferring it from a timestamp.
  const runEnvelopeOf = (run) => ({
    id: run.id,
    workflowId: run.workflowId === undefined ? null : run.workflowId,
    workflowName: null,
    status: run.status === undefined ? null : run.status,
    startedAt: typeof run.startedAt === 'number' ? run.startedAt : null,
    endedAt: typeof run.endedAt === 'number' ? run.endedAt : null,
    sessionId: typeof run.sessionId === 'string' && run.sessionId !== '' ? run.sessionId : null,
  });

  const progressSummary = async (runId, session, explicitRun) => {
    // `runId` (the caller's EXPLICIT choice) always outranks attribution: asking
    // for a specific run must never be filtered into a different one.
    const picked = explicitRun !== undefined
      ? { run: explicitRun, scope: null }
      : (runId ? { run: await getRun(runId), scope: null } : await runForSession(session));
    const run = picked.run;
    // `scope` is the honest account of WHAT was selected and WHY. A session-scoped
    // request whose own session has no run reports mode 'session' with
    // runCountInScope: 0 and fallback null -- "nothing of mine ran" is therefore
    // never presented as "this is my run", and `fallback` never claims a
    // substitution that did not happen. `hasAnyGlobal` then says whether anything
    // is running anywhere, so an idle session can still be told that others are
    // busy. It is an ADDITIONAL top-level key: `run`, `nodes`, `roles`,
    // `reviewers` and `totals` are untouched.
    const scope = {
      mode: picked.scope === null ? 'global' : picked.scope.mode,
      sessionId: picked.scope === null ? null : picked.scope.sessionId,
      runCountInScope: picked.scope === null ? 1 : picked.scope.runCountInScope,
      fallback: picked.scope === null ? (run === null ? null : 'explicit-runId') : picked.scope.fallback,
      // `false` for an explicit-runId request: that path never enumerates the
      // store, so claiming anything about other runs would be a guess.
      hasAnyGlobal: picked.scope === null ? false : picked.scope.hasAnyGlobal,
    };
    // Nothing to show. The shape is EXACTLY the pre-P12 empty response when no
    // session was involved (identical key set, no `scope`), because a caller that
    // passed nothing must not be able to tell P12 happened at all. When a session
    // WAS given, `scope` is still attached: it is the honest answer to "why is
    // there nothing" -- mode 'session' with runCountInScope 0 means this session
    // has no run, which is a different fact from an empty store.
    if (!run) {
      const empty = { ok: true, run: null, nodes: [], roles: [], reviewers: [], totals: { total: 0, completed: 0, failed: 0, working: 0, reviewing: 0, rework: 0, unresolved: 0, pending: 0, percent: 0 } };
      return session === undefined || session === null || session === '' ? empty : { ok: true, scope, run: null, nodes: [], roles: [], reviewers: [], totals: empty.totals };
    }
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
        // P13: which node's failure cut this step off. `clean` drops the
        // undefined, so this key exists ONLY on a skipped node and every other
        // node's projected key set is byte-for-byte what it was before P13.
        blockedBy: st.blockedBy,
        // P11: the route this node actually ran on, LIGHTLY. /progress is a
        // 3-second poll, so this carries only what the card needs to be honest
        // (which layer won, what it really ran, whether that was MEASURED, and
        // why not) -- never the efforts list. `null` for a run recorded before
        // P11 (no route key at all), so old records keep rendering as they did.
        route: lightRoute(st.route),
        // Persona SHAPE only (which layers contributed + how long). The text
        // itself can be thousands of characters and belongs to the role
        // definition, not to a poll payload.
        persona: lightPersona(st.persona),
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
    const envelope = runEnvelopeOf(run);
    envelope.workflowName = (wf && wf.name) || null;
    return clean({
      ok: true,
      scope,
      run: envelope,
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
  const roleDetail = async (runId, role, session, explicitRun) => {
    // Same run selection as /progress, in the same order: explicit run first, then
    // the runId, then the (session-scoped) newest. Without a `session` argument
    // this resolves exactly as it did before P12.
    const run = explicitRun !== undefined ? explicitRun : (runId ? await getRun(runId) : (await runForSession(session)).run);
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
          // P11: WHICH route judged this artifact, and whose persona the judge
          // used. A SIBLING of the verdict fields (namespace-consistent with the
          // node record), not a key inside `review`: the verdict is about the
          // artifact, the route is about the judge.
          reviewRoute: st.reviewRoute === undefined ? null : st.reviewRoute,
          reviewPersona: st.reviewPersona === undefined ? null : st.reviewPersona,
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
        // P11 (this entry is what NodeCard renders from): the FULL route record of
        // the worker -- requested / source / effective / measured / verified /
        // warning / note / efforts / defaultEffort / timeoutMs -- plus the persona
        // SHAPE (chars + which layers contributed + any discard warning). `null`
        // for a run recorded before P11, so an old run's card is unchanged.
        route: st.route === undefined ? null : st.route,
        persona: st.persona === undefined ? null : st.persona,
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
  // `opts.route` is the P11 RUN-level override: the operator's explicit choice
  // for this round. It is the highest-priority route layer and the only layer an
  // HTTP caller / tool caller can set. Omitted (or unusable) -> the layers below
  // decide, exactly as they did before P11.
  // `opts.session` is the P12 ATTRIBUTION input: the session that started this
  // run. Precedence is (a) what the caller explicitly passed (the HTTP body /
  // an in-process caller), else (b) the live Agent driving the call (the tool
  // path). Nothing is ever guessed: when neither yields a session the record is
  // written WITHOUT the attribution keys, i.e. byte-identical to pre-P12.
  const runWorkflow = async (workflowId, input, onCreated, opts) => {
    const runRoute = opts ? opts.route : undefined;
    const wf = await withTable('team_workflows', 'flows', (t) => t.get(workflowId));
    if (!wf) throw new Error('team-flowise: workflow not found ' + workflowId);
    const nodes = (wf.nodes || {});
    const nodeIds = Object.keys(nodes);
    // Attribution is best-effort and CANNOT fail the run: resolveRunOrigin never
    // throws, readSessionOption never throws, and a blank session simply drops out.
    let origin = {};
    try {
      const explicit = readSessionOption(opts ? opts.session : undefined);
      origin = explicit.sessionId !== undefined ? explicit : resolveRunOrigin(ctx);
    } catch (e) { console.warn('team-flowise: could not resolve the run session: ' + String(e)); origin = {}; }
    // `clean` drops the undefined keys, so an unattributed run is written with
    // exactly the key set it had before P12.
    const runRec = runSchema.parse(clean({ id: makeId(), workflowId, status: 'running', nodeStates: {}, startedAt: now(), sessionId: origin.sessionId, workspace: origin.workspace }));
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
      // P13 fail-fast, in `runWorkflow` scope. `haltedBy` names the ONE node
      // whose failure (or unresolved blocking review) stopped the run; `skipped`
      // lists the nodes the halt prevented from ever starting. Both are read at
      // the end to decide the run's status, which is why they cannot live inside
      // the wave loop.
      const haltOnFailure = wf.haltOnFailure === true;
      let haltedBy = null;
      // WHY the halt happened. The two triggers are not equivalent at the end of
      // the run: a crashed node already makes `allOk` false (so `failed` is
      // reachable without help), but an UNRESOLVED blocking finding leaves the
      // node `succeeded` -- so without distinguishing the reason, a run whose
      // last node could not be repaired would still report `completed`.
      let haltReason = null;
      const skipped = [];
      let runRework = 0;
      const subagents = ctx.get('subagents');
      const parent = resolveParentAgent(ctx);
      // The caller's own route, read ONCE from its request header. It is the
      // baseline every layer is compared against ("did the route really change?")
      // and the fallback a degraded node inherits. Unreadable => null, which is
      // reported as "parent unknown" rather than assumed.
      const parentRoute = routeConfigOf(parent);
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
        // P11: the reviewer's OWN route and persona, resolved from its own role
        // definition. `node` is deliberately null: the reviewed node's
        // promptAddon describes the worker being judged, not the judge, and its
        // node-level route belongs to that step's worker. `reviewRoute` is the
        // measured/derived evidence and is recorded as a SIBLING of `review`
        // (a reviewer's route is not part of the verdict about the artifact).
        let reviewRoute = null;
        let reviewPersona = null;
        // Hoisted OUT of the try on purpose: the R8 repair retry below runs after
        // the first attempt's try/catch, so it needs the reviewer's spec and
        // timeout to still be reachable there. Declaring them inside the try made
        // the retry die with "built is not defined" -- which the G3 test caught.
        let reviewSpec = null;
        let reviewTimeoutMs = REVIEW_LIMITS.timeoutMs;
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
            const reviewDef = def;
            const decision = await decideRoute(reviewDef, parent, { runRoute, node: null, workflow: wf, parentRoute });
            const built = spawnSpecFor(reviewDef, parent, { node: null, workflow: wf, decision });
            reviewSpec = built.spec;
            reviewTimeoutMs = timeoutFor(reviewDef, REVIEW_LIMITS.timeoutMs);
            // Recorded BEFORE the dispatch, so a reviewer that never starts still
            // leaves evidence of which route was asked for (measured:false).
            reviewRoute = routeRecordOf(decision, null, reviewTimeoutMs);
            reviewPersona = built.persona;
            if (reviewRoute.warning) console.warn('team-flowise: node ' + nid + ' review route: ' + reviewRoute.warning);
            const started = await startWorker(subagents, { label: nid + ':review', prompt: [{ type: 'text', text: prompt }], parent, signal: ctl.signal }, built.spec, parentToolNote(parent));
            toolNote = started.note + (built.presetNote ? ' | ' + built.presetNote : '');
            if (built.presetNote) console.warn('team-flowise: reviewer of node ' + nid + ' tools: ' + built.presetNote);
            let reviewMeasured = measureChildRoute(started);
            reviewRoute = routeRecordOf(decision, reviewMeasured, reviewTimeoutMs);
            const result = await withTimeout(started.run.result, reviewTimeoutMs, 'review of node ' + nid);
            reviewMeasured = refreshMeasured(started, reviewMeasured);
            reviewRoute = routeRecordOf(decision, reviewMeasured, reviewTimeoutMs);
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
        let parsed = error === null ? parseReviewVerdict(text) : { raw: text, parsed: null, parseError: error };
        // R8 -- ONE bounded repair attempt when the reviewer answered but wrote
        // unparseable JSON. See buildReviewRepairPrompt. Bounded by construction
        // (a single retry, its own abort controller, the same timeout) and it can
        // never block a node: if the retry also fails, R1 still stands and the
        // verdict stays 'error'.
        let repair = null;
        if (error === null && parsed.parsed === null && subagents && reviewSpec !== null) {
          const reason = parsed.parseError;
          try {
            const rCtl = new AbortController();
            const started2 = await startWorker(subagents, { label: nid + ':review-repair', prompt: [{ type: 'text', text: buildReviewRepairPrompt({ reason, knownBlocking }) }], parent, signal: rCtl.signal }, reviewSpec, parentToolNote(parent));
            const res2 = await withTimeout(started2.run.result, reviewTimeoutMs, 'review repair of node ' + nid);
            const t2 = (res2.output || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
            const p2 = res2.stopReason === 'completed'
              ? parseReviewVerdict(t2)
              : { parsed: null, parseError: 'reviewer ' + res2.stopReason + (res2.diagnostic ? ': ' + res2.diagnostic : '') };
            repair = { attempted: true, ok: p2.parsed !== null, parseError: p2.parseError === undefined ? null : p2.parseError };
            if (p2.parsed !== null) { parsed = p2; text = t2; }
          } catch (e) {
            repair = { attempted: true, ok: false, parseError: String(e && e.message ? e.message : e) };
          }
        }
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
          // R8: whether a second, repair-only reviewer call was made, and whether
          // it recovered a parseable verdict. Recorded so a review that had to be
          // rescued is visible rather than indistinguishable from a clean one.
          repair: repair === null ? null : clean(repair),
        };
        // `st` is the whole node-level review record; the caller keeps it for
        // every subsequent state write for this node. `route`/`persona` describe
        // the REVIEWER and are written as siblings of that record.
        return { st, route: reviewRoute, persona: reviewPersona };
      };
      for (let round = 0; round < 1000; round++) {
        // P13: the halt is re-checked at the TOP of every wave. Nodes in the wave
        // where the failure happened are already running and are allowed to
        // finish -- they cannot be un-run, and throwing their real work away
        // would make the run's records lie about what was actually computed.
        // What a halt guarantees is that NOTHING NEW starts.
        if (haltedBy !== null) break;
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
          // P11: the route THIS node's worker actually runs on, plus the shape of
          // the persona segment it was given. Same lifetime rule as `reviewState`:
          // every later write for this node re-sends them, or the next write would
          // erase the evidence.
          let routeState = null;
          let personaState = null;
          // The last REAL route measurement for this node's worker (null until a
          // child header was actually read). Kept across dispatches so a rework's
          // re-read can only replace it with another real measurement.
          let workerMeasured = null;
          // P11: the REVIEWER's route/persona from the last review round. Recorded
          // as a SIBLING of `review` (never inside it): `review` is the verdict
          // about the artifact, and "which model judged it" is not part of that
          // verdict. The /role review entry projects it.
          let reviewRouteState = null;
          let reviewerPersonaState = null;
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
              ...(routeState ? { route: routeState } : {}),
              ...(personaState ? { persona: personaState } : {}),
              ...(reviewRouteState ? { reviewRoute: reviewRouteState } : {}),
              ...(reviewerPersonaState ? { reviewPersona: reviewerPersonaState } : {}),
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
              // P11: run > node > workflow > role, then verify. A route that
              // cannot run is NOT applied (the child inherits the parent route --
              // the pre-P11 effect) but is recorded and warned about, never
              // silently dropped and never allowed to fail the node.
              const workerDecision = await decideRoute(def, parent, { runRoute, node, workflow: wf, parentRoute });
              const built = spawnSpecFor(def, parent, { node, workflow: wf, decision: workerDecision });
              const workerTimeoutMs = timeoutFor(def, NODE_TIMEOUT_MS);
              personaState = built.persona;
              routeState = routeRecordOf(workerDecision, null, workerTimeoutMs);
              if (routeState.warning) console.warn('team-flowise: node ' + nid + ' route: ' + routeState.warning);
              const started = await startWorker(subagents, { label: node.id, prompt: [{ type: 'text', text: prompt }], parent, signal: nodeCtl.signal }, built.spec, parentToolNote(parent));
              toolNote = started.note + (built.presetNote ? ' | ' + built.presetNote : '');
              if (built.presetNote) console.warn('team-flowise: worker of node ' + nid + ' tools: ' + built.presetNote);
              // The ONLY authoritative answer to "what did it run on": the child's
              // own request header. Reading it must never affect the dispatch, and
              // an unreadable one is recorded as measured:false, never invented.
              workerMeasured = measureChildRoute(started);
              routeState = routeRecordOf(workerDecision, workerMeasured, workerTimeoutMs);
              deny = (((def && def.tools) || {}).deny || []).slice();
              const result = await withTimeout(started.run.result, workerTimeoutMs, 'workflow node ' + nid);
              // Re-read now that the child has certainly issued its first request
              // (the header only exists from then on); the last real read wins.
              workerMeasured = refreshMeasured(started, workerMeasured);
              routeState = routeRecordOf(workerDecision, workerMeasured, workerTimeoutMs);
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
              // P11: the reviewer's own route/persona for THIS round (last round
              // wins -- the record answers "which route judged the final artifact").
              reviewRouteState = rv.route;
              reviewerPersonaState = rv.persona;
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
                // P13: an unresolved BLOCKING finding is the second halt trigger,
                // and the one this whole feature exists for in a risk pipeline:
                // the artifact was judged untrustworthy AND could not be repaired
                // inside the rework budget. The node still completes -- its
                // artifact exists and its verdict is recorded -- but nothing
                // downstream may build on it. Advisory findings and a rework that
                // was actually satisfied never reach here, so this cannot turn an
                // ordinary "passed with notes" into a halted run.
                if (haltOnFailure && haltedBy === null) { haltedBy = nid; haltReason = 'unresolved-blocking'; }
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
              // A rework re-dispatches the SAME role on the SAME layers: re-pick
              // (cheap, no IO beyond the llm check) so the rework prompt's tool
              // policy and the route evidence stay truthful for THIS dispatch too.
              const reworkDef = agentDefs.find((d) => d.id === node.agent || d.name === node.agent);
              const reworkDecision = await decideRoute(reworkDef, parent, { runRoute, node, workflow: wf, parentRoute });
              const reworkBuilt = spawnSpecFor(reworkDef, parent, { node, workflow: wf, decision: reworkDecision });
              const reworkTimeoutMs = timeoutFor(reworkDef, NODE_TIMEOUT_MS);
              if (reworkBuilt.persona) personaState = reworkBuilt.persona;
              const restarted = await startWorker(subagents, { label: node.id, prompt: [{ type: 'text', text: reworkPrompt }], parent, signal: nodeCtl.signal }, reworkBuilt.spec, parentToolNote(parent));
              toolNote = restarted.note + (reworkBuilt.presetNote ? ' | ' + reworkBuilt.presetNote : '');
              if (reworkBuilt.presetNote) console.warn('team-flowise: worker of node ' + nid + ' tools: ' + reworkBuilt.presetNote);
              workerMeasured = measureChildRoute(restarted);
              routeState = routeRecordOf(reworkDecision, workerMeasured, reworkTimeoutMs);
              const again = await withTimeout(restarted.run.result, reworkTimeoutMs, 'workflow node ' + nid + ' rework ' + rnd);
              workerMeasured = refreshMeasured(restarted, workerMeasured);
              routeState = routeRecordOf(reworkDecision, workerMeasured, reworkTimeoutMs);
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
            await setRunState({ nodeStates: { [nid]: { status: 'completed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), output: String(output).slice(0, 200), summary: firstLine(output, 140) || null, tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}), ...(reviewState ? { review: reviewState } : {}), ...(routeState ? { route: routeState } : {}), ...(personaState ? { persona: personaState } : {}), ...(reviewRouteState ? { reviewRoute: reviewRouteState } : {}), ...(reviewerPersonaState ? { reviewPersona: reviewerPersonaState } : {}) } } });
          } catch (e) {
            nodeCtl.abort();
            completed[nid] = true;
            // P13: this failure is the halt trigger. Only the FIRST one that
            // settles is recorded -- with a whole-run halt the skip set does not
            // depend on which node triggered it, so this field is evidence, not
            // control flow, and every failed node is still listed in nodeStates.
            if (haltOnFailure && haltedBy === null) { haltedBy = nid; haltReason = 'node-failed'; }
            // Never leave an abandoned task at `working`: nothing can advance it.
            if (taskId) await settleTask(taskId).catch(() => undefined);
            // A failed node keeps its route evidence too: "it died on THIS route"
            // is exactly what a diagnoser needs, and dropping it would hide it.
            await setRunState({ nodeStates: { [nid]: { status: 'failed', assignee: node.agent, startedAt: nodeStartedAt, endedAt: now(), error: String(e), summary: firstLine('失败：' + String(e), 140), tools: toolNote, taskId: taskId || null, ...(reasoning ? { reasoning: reasoning.slice(0, REASONING_MAX), reasoningLen: reasoning.length } : {}), ...(reviewState ? { review: reviewState } : {}), ...(routeState ? { route: routeState } : {}), ...(personaState ? { persona: personaState } : {}), ...(reviewRouteState ? { reviewRoute: reviewRouteState } : {}), ...(reviewerPersonaState ? { reviewPersona: reviewerPersonaState } : {}) } } });
          }
        }));
      }
      // P13: materialise the halt as records BEFORE the run's final status
      // write, so the board can tell "this step never ran because the run was
      // stopped" from "this step has not started yet". A skipped node keeps
      // `endedAt: null` deliberately: nothing happened to it, so inventing an
      // end time would be a fabricated event. `blockedBy` names the failure that
      // cut it off, which is the one thing a reader of a halted run wants.
      if (haltOnFailure && haltedBy !== null) {
        for (const nid of nodeIds) {
          if (completed[nid]) continue;
          skipped.push(nid);
          await setRunState({ nodeStates: { [nid]: { status: 'skipped', assignee: nodes[nid].agent, endedAt: null, summary: '未执行：运行在节点 ' + haltedBy + ' 失败后已停止', blockedBy: haltedBy } } });
        }
      }
      const allDone = nodeIds.every((nid) => completed[nid]);
      const allOk = nodeIds.every((nid) => succeeded[nid] === true);
      // P13: `halted` covers BOTH fail-fast outcomes that leave the run without a
      // trustworthy result: something was cut off before it could start, OR a node
      // ended with an unresolved blocking finding. The second case needs saying
      // explicitly because such a node still counts as `succeeded` (its artifact
      // exists and its verdict IS recorded) -- so a run whose LAST node could not
      // be repaired would otherwise report `completed`, i.e. exactly the silent
      // success fail-fast exists to prevent. A crash with nothing left to skip
      // stays `failed`: the new status must not swallow "it just failed".
      const halted = skipped.length > 0 || haltReason === 'unresolved-blocking';
      const status = halted ? 'halted' : (allOk ? 'completed' : (allDone ? 'failed' : 'interrupted'));
      const summary = halted
        ? 'workflow halted: ' + (haltReason === 'unresolved-blocking'
          ? 'node ' + haltedBy + ' ended with an UNRESOLVED blocking review finding'
          : 'node ' + haltedBy + ' failed') + (skipped.length > 0
          ? ', ' + skipped.length + ' node(s) skipped (' + skipped.join(', ') + ')'
          : ', nothing was left to skip')
        : (allOk ? 'workflow completed' : (allDone ? 'workflow finished with failed nodes' : 'workflow interrupted'));
      // `reviews` is the per-node LIGHT projection (same shape /progress serves),
      // so a finished run carries its review outcome without re-reading
      // nodeStates. An unreviewed run yields `{}`, i.e. no behaviour change.
      // `haltedBy`/`haltReason`/`skipped` appear ONLY on a halted run, so every
      // other run's result object keeps exactly the key set it had before P13.
      await withTable('team_runs', 'runs', (t) => t.update(runRec.id, (cur) => ({ ...cur, status, endedAt: now(), result: { outputs, summary, reviews, ...(halted ? { haltedBy: haltedBy, haltReason: haltReason, skipped: skipped.slice() } : {}) } })));
      return { id: runRec.id, status };
    } finally { liveRuns.delete(runRec.id); }
  };

  // ---- model tools via the real `tools` service (host-plane registry) ----
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    // Every tool carries its own description. It is the ONLY thing the model sees
    // about a tool before calling it (defineTool passes this string through
    // verbatim), so an identical one-liner on all of them made the whole family
    // unusable: the model could not tell `team_create_task` (which only records
    // work) from `team_run_workflow` (which blocks for minutes). Each description
    // therefore states what the tool does, when to reach for it, and its hard
    // limits -- and each parameter carries its own `description`.
    const mk = (t, description, parameters, props, render, execute) => tools.register(defineTool({ name: t, description, parameters, output: { schema: { type: 'object', additionalProperties: false, properties: props }, render }, isConcurrencySafe: () => true, execute }));
    const taskItem = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, status: { type: 'string' }, iteration: { type: 'number' }, assignee: { type: 'string' } } };
    disposers.push(mk('team_create_task', 'Register ONE unit of team work in the durable task ledger. Use it to plan a batch of work before anything executes it, or to hand a task to a later team_delegate_agent call, or to record work for a human. It returns the new task id and status `queued`. LIMITATION: this tool ONLY registers the task - it DOES NOT execute it and it does not dispatch it to any role: no worker agent is spawned, no model call is made, and the task stays queued until something else moves it. Do not call it expecting output. For one blocking role call use team_delegate_agent; for a reviewed multi-role pipeline use team_create_workflow + team_run_workflow.', { requirement: { type: 'string', required: true, description: 'What must be produced, stated as an outcome: the concrete deliverable plus any constraint the worker must obey (files it may touch, format, language). Name the artifact, not the activity.' }, acceptanceCriteria: { type: 'string', required: true, description: 'Checkable conditions under which this task counts as done. Write them so a reviewer can mark each one pass or fail from the artifact alone (e.g. "the reply contains X and Y"). A violated criterion is treated as blocking.' }, assignee: { type: 'string', required: true, description: 'Role that owns the task, by role name or id as registered via team_create_agent (use team_list_agents for the exact names). An unknown name is accepted but records a task nobody owns.' }, reviewer: { type: 'string', description: 'Optional independent reviewer role name or id, recorded on the ledger entry as supervision intent. Omit it when no independent check is wanted.' } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, status: { type: 'string', required: true } }, (_a, v) => [{ type: 'text', text: 'created task ' + v.id + ' [' + v.status + ']' }], async (args) => { const t = await createTask(args); return clean({ ok: true, id: t.id, status: t.status }); }));
    disposers.push(mk('team_task_status', 'Read the task ledger: how many tasks exist and, for each, its id, status, iteration and assignee. Use it to check whether registered work has actually progressed, to find a task stuck at queued or working, or to fetch the ids you need for later calls. Read-only, takes no arguments, and it returns the WHOLE ledger shared by every session in this process - not only the work you registered - so filter by the ids or assignees you care about. It reports tasks only, never runs: for run-level progress use the progress panel or GET /api/team-flowise/progress. `iteration` counts rework rounds, so a task with iteration above 1 has been sent back at least once.', {}, { ok: { type: 'boolean', required: true }, taskCount: { type: 'number', required: true }, tasks: { type: 'array', required: true, items: taskItem } }, (_a, v) => [{ type: 'text', text: 'tasks=' + v.taskCount }], async () => { const tasks = await listTasks(); return clean({ ok: true, taskCount: tasks.length, tasks: tasks.map((t) => clean({ id: t.id, status: t.status, iteration: t.iteration, assignee: t.assignee })) }); }));
    disposers.push(mk('team_run_workflow', 'Start a registered workflow and BLOCK until the entire run settles, then return its runId and final status. Use it after team_create_workflow when you want the full multi-role pipeline executed now - dependency waves, per-node workers, the review gate and bounded rework. IMPORTANT: it BLOCKS, and it may block for many minutes (each node has its own step timeout, default 30 minutes), so do not call it for a pipeline you are not ready to wait for and do not chain several of these in one call. The result is a summary only; per-node progress lives at GET /api/team-flowise/progress?runId=<id> and in the client progress panel. Run `input` seeds workflow variables and a run-level `route` outranks node, workflow and role routes. Build the roles and the workflow FIRST, then start it; for a single role step use team_delegate_agent instead.', { workflowId: { type: 'string', required: true, description: 'Id of the workflow to run, as returned by team_create_workflow. An unknown id fails the call immediately instead of producing a run that never publishes.' }, input: { type: 'object', additionalProperties: false, description: 'Free-form input for the run (a plain JSON object). Nodes read it as workflow variables; tasks that do not reference it are unaffected.' }, route: { type: 'object', additionalProperties: false, description: 'Run-level model route override. This is the highest-priority layer, so it beats node, workflow and role routes; provider and model must still be declared together or that half is ignored.', properties: { provider: { type: 'string', description: 'Provider id of the run-level route; ignored unless `model` is declared in the same call.' }, model: { type: 'string', description: 'Model id of the run-level route; ignored unless `provider` is declared in the same call.' }, reasoningEffort: { type: 'string', description: 'Reasoning effort id from that model\'s own efforts list. An effort the model does not accept makes this whole layer unusable, so it degrades to the next layer.' }, maxTokens: { type: 'number', description: 'Per-call output token cap for the run; must be a positive number and takes effect on its own.' } } } }, { ok: { type: 'boolean', required: true }, runId: { type: 'string', required: true }, status: { type: 'string', required: true } }, (_a, v) => [{ type: 'text', text: 'ran workflow -> ' + v.runId + ' [' + v.status + ']' }], async (args) => { const r = await runWorkflow(args.workflowId, args.input, undefined, { route: args.route }); return clean({ ok: true, runId: r.id, status: r.status }); }));
    disposers.push(mk('team_list_agents', 'List the registered team role definitions with their ids, names and roles. Use it FIRST whenever you need an exact role name or id: team_delegate_agent, team_create_task and workflow node `agent` fields all resolve against this registry, and a name that does not exist silently produces an unowned task or a node that cannot be dispatched. Read-only and takes no arguments. It returns only id / name / role; for a role\'s model route, persona and tool preset read the role in the settings UI or GET /api/team-flowise/agents. An empty list means no role exists yet - create one with team_create_agent before delegating.', {}, { ok: { type: 'boolean', required: true }, agents: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } }, (_a, v) => [{ type: 'text', text: 'agents=' + v.agents.length }], async () => { const a = await listAgents(); return clean({ ok: true, agents: a.map((x) => clean({ id: x.id, name: x.name, role: x.role })) }); }));
    // P11: `id` (modify an existing role instead of always creating a new one),
    // the reasoning / token / timeout knobs, and the tool preset. The old
    // `provider || 'deepseek'` / `model || 'deepseek-chat'` fallbacks are GONE:
    // when only one half is given the other is NOT invented -- the pair rule
    // handles it (that half is ignored, with an explicit warning).
    disposers.push(mk('team_create_agent', 'Create or modify ONE team role definition: a durable agent definition holding persona, model route, tool preset and timeout. Use it BEFORE any delegation or workflow that names the role - team_delegate_agent, team_create_task and workflow nodes all resolve roles by name from this registry. Upsert semantics: pass the `id` of an existing role to MODIFY it (fields you omit keep their stored value, nothing is wiped); omit `id` to CREATE a new role. When both `provider` and `model` are wanted they must be declared TOGETHER - a lone half is ignored and reported in `warning` rather than inventing a default. This tool only writes the definition: it never dispatches anything.', { id: { type: 'string', description: 'Existing role id to modify, as listed by team_list_agents. Omit it to create a new role (an id is generated). When given, every field you do not pass keeps its current stored value.' }, name: { type: 'string', description: 'Human-readable role name; it is also the value that assignee / node agent / reviewer fields match against, so keep it resolvable. Defaults to `role` when omitted on create.' }, role: { type: 'string', description: 'Short description of what this role does - its job title in the team, e.g. "Implements the change". Distinct from systemPrompt.' }, systemPrompt: { type: 'string', description: 'Persona text merged INTO the worker prompt below the workflow and node layers. Keep it about behaviour and standards, not about one task. The runtime treats {{name}} as a strict template reference and would refuse to start the child on an unknown one, so every `{{` is neutralised to `{ {` before dispatch: your text is KEPT (never discarded), and the rewrite is reported in the node\'s persona.warning.' }, provider: { type: 'string', description: 'Provider route for this role. Must be declared together with `model`; a lone provider is ignored and reported in `warning`.' }, model: { type: 'string', description: 'Model id for this role, valid for the `provider` above. Must be declared together with `provider`; a lone model is ignored and reported in `warning`.' }, reasoningEffort: { type: 'string', description: 'Reasoning effort id taken from that model\'s own reasoning.efforts list (GET /api/team-flowise/models). An effort the model does not accept makes the whole route layer unusable, so it falls back to the parent route.' }, maxTokens: { type: 'number', description: 'Per-call output token cap for this role; must be a positive integer. Independent of the provider/model pairing rule - it takes effect on its own.' }, timeoutMs: { type: 'number', description: 'Hard per-step timeout for this role\'s workers, in milliseconds. Values below 1 or non-finite count as "not declared" and are clamped into the allowed range. Bounds one delegated step, not a whole run.' }, toolsPreset: { type: 'string', description: 'Tool preset restricting what this role\'s workers may see or call: full, no-write, no-shell or read-only. A name this deployment does not know is recorded rather than silently accepted, so check the returned role if a restriction matters.' } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, name: { type: 'string', required: true }, provider: { type: 'string' }, model: { type: 'string' }, reasoningEffort: { type: 'string' }, maxTokens: { type: 'number' }, timeoutMs: { type: 'number' }, toolsPreset: { type: 'string' }, warning: { type: 'string' } }, (_a, v) => [{ type: 'text', text: 'upserted agent ' + v.name + ' -> ' + v.id + (v.warning ? ' [' + v.warning + ']' : '') }], async (args) => {
      // An id that is already stored means MODIFY: fields the caller did not
      // mention keep their current value instead of being wiped (that is what
      // "modify this role" has to mean).
      const existing = args.id ? (await listAgents()).find((x) => x.id === args.id) || null : null;
      const pick = (v, fallback) => (v === undefined || v === null ? fallback : v);
      const routeFields = (args.provider !== undefined || args.model !== undefined || args.reasoningEffort !== undefined || args.maxTokens !== undefined)
        ? clean({ provider: args.provider, model: args.model, reasoningEffort: args.reasoningEffort, maxTokens: args.maxTokens })
        : undefined;
      const modelField = routeFields !== undefined ? routeFields : (existing ? existing.model : undefined);
      // Warn at WRITE time about a half-declared pair (that half will never take
      // effect). The effort-clearing warning is a dispatch-time concern, so a
      // fully declared pair is compared against itself here (= no warning).
      const pairWarn = routeFields !== undefined && routeFields !== null
        ? routeWarnings({ route: routeFields }, (routeFields.provider !== undefined && routeFields.model !== undefined) ? routeFields : null)
        : [];
      const a = await upsertAgent({
        id: args.id,
        name: pick(args.name, existing ? existing.name : (args.role || undefined)),
        role: pick(args.role, existing ? existing.role : undefined),
        systemPrompt: pick(args.systemPrompt, existing ? existing.systemPrompt : undefined),
        model: modelField,
        skills: existing ? existing.skills : undefined,
        tools: args.toolsPreset !== undefined
          ? Object.assign({}, existing ? existing.tools : {}, { preset: args.toolsPreset })
          : (existing ? existing.tools : undefined),
        timeoutMs: pick(args.timeoutMs, existing ? existing.timeoutMs : undefined),
        permissionPolicy: existing ? existing.permissionPolicy : undefined,
      });
      const am = a.model || {};
      return clean({ ok: true, id: a.id, name: a.name || a.role || a.id, provider: am.provider, model: am.model, reasoningEffort: am.reasoningEffort, maxTokens: am.maxTokens, timeoutMs: a.timeoutMs, toolsPreset: a.tools && a.tools.preset, warning: pairWarn.length ? pairWarn.join(' ') : undefined });
    }));
    disposers.push(mk('team_create_workflow', 'Create or modify a durable multi-role workflow: a name plus a node map that the scheduler turns into dependency waves. Use it to define a repeatable pipeline ONCE - the nodes, who owns each one, what each must produce and who reviews it - and then start it with team_run_workflow. `nodes` is an object keyed by node id; each node declares at least its owning role (`agent`) and its dependency list (`dependsOn`), and may declare title, reviewer, taskTemplate and promptAddon. Order comes from dependsOn, never from key order, and independent nodes run concurrently. A workflow-level `review` block supplies the default reviewer. Set `haltOnFailure` to true when a step that fails must STOP the run instead of letting later steps build on an empty artifact. LIMITATION: declaring a workflow does NOT run it.', { name: { type: 'string', required: true, description: 'Workflow display name, shown in the run selector. Keep it unique enough that a human can tell two runs apart.' }, description: { type: 'string', description: 'One-paragraph explanation of what the pipeline produces and why the nodes are ordered that way; written for a human reading the run list.' }, nodes: { type: 'object', additionalProperties: true, description: 'Node map keyed by node id. Each value declares the owning role (`agent`, by name or id), its `dependsOn` array of node ids, and optionally title, reviewer, taskTemplate:{requirement,acceptanceCriteria} and promptAddon. An empty or missing map declares a workflow with zero nodes, which can be started but will do nothing.' }, route: { type: 'object', additionalProperties: false, description: 'Workflow-level model route layer, shared by every step unless a node declares its own (node wins) or the run overrides it (run wins).', properties: { provider: { type: 'string', description: 'Provider id of the workflow-level route; must be declared together with `model` or that half is ignored.' }, model: { type: 'string', description: 'Model id of the workflow-level route; must be declared together with `provider` or that half is ignored.' }, reasoningEffort: { type: 'string', description: 'Reasoning effort id from that model\'s own efforts list; an unsupported effort makes this whole layer unusable.' }, maxTokens: { type: 'number', description: 'Per-call output token cap for every step of this workflow; must be a positive number.' } } }, prompt: { type: 'string', description: 'Workflow-level persona text, merged above the role\'s own systemPrompt and below a node\'s promptAddon. Use it for pipeline-wide standards. An empty string counts as not declared.' }, haltOnFailure: { type: 'boolean', description: 'P13 opt-in fail-fast, default false. With false (the pre-P13 behaviour) a failed node still counts as done for its dependents, so the rest of the pipeline runs on an empty artifact. With true, the FIRST node that fails - or that ends with an UNRESOLVED blocking review finding - stops the run: every node that has not started yet is recorded `skipped` and the run ends as `halted`. The halt is whole-run, not just the branch that failed.' } }, { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, name: { type: 'string', required: true }, nodeCount: { type: 'number', required: true } }, (_a, v) => [{ type: 'text', text: 'created workflow ' + v.name + ' -> ' + v.id + ' (' + v.nodeCount + ' nodes)' }], async (args) => { const w = await upsertWorkflow({ name: args.name, description: args.description, nodes: args.nodes || {}, route: args.route, prompt: args.prompt, haltOnFailure: args.haltOnFailure }); return clean({ ok: true, id: w.id, name: w.name, nodeCount: Object.keys(w.nodes || {}).length }); }));
    disposers.push(mk('team_delegate_agent', 'Hand ONE task to ONE role and BLOCK until that worker agent finishes, then return its output. Use it for a single self-contained step whose result you want in this same turn: it creates a ledger task, moves it to working, spawns the worker through the subagent registry and completes the task. IMPORTANT: it BLOCKS, so the call returns only when the worker stops or its step timeout (default 30 minutes) fires - which means a long task holds this turn open, and do not chain several of these to build a pipeline by hand. A worker that fails is reported as the text `delegate failed: ...`. For anything multi-step or supervised prefer the workflow route: create the roles, then team_create_workflow, then team_run_workflow.', { agent: { type: 'string', required: true, description: 'Role to delegate to, by role name or id from team_list_agents. An unmatched name is used verbatim as the assignee: the work still runs, but no role configuration (model route, tool preset, persona, timeout) is applied.' }, task: { type: 'string', required: true, description: 'The complete task brief for the worker: what to produce, where, and under what constraints. The worker sees only this text plus the acceptance criteria, so it cannot infer context you do not state.' }, acceptanceCriteria: { type: 'string', description: 'Checkable conditions for this one delegation, appended to the worker prompt. Omit only when the task is trivially self-verifying.' }, reviewer: { type: 'string', description: 'Reviewer role recorded on the created ledger task. NOTE: this free-delegation path does not run a review pass - the value is recorded for the ledger and the UI only, and no reviewer agent is spawned.' } }, { ok: { type: 'boolean', required: true }, taskId: { type: 'string', required: true }, status: { type: 'string', required: true }, output: { type: 'string' } }, (_a, v) => [{ type: 'text', text: 'delegated -> task ' + v.taskId + ' [' + v.status + ']' }], async (args) => {
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
          // P11: a free delegation has no workflow / node / run layer, so the
          // ROLE definition is the only route layer -- exactly what this path
          // used before P11, plus the same verification and the same pair rule.
          const dDecision = await decideRoute(def, dParent, { parentRoute: routeConfigOf(dParent) });
          const dBuilt = spawnSpecFor(def, dParent, { decision: dDecision });
          const started = await startWorker(subagentsSvc, { label: 'team-delegate', prompt: [{ type: 'text', text: prompt }], parent: dParent, signal: dCtl.signal }, dBuilt.spec, parentToolNote(dParent) + (dBuilt.presetNote ? ' | ' + dBuilt.presetNote : ''));
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

    // P11 model catalog for the role form. NEVER 500s: every failure mode is
    // reported as data inside {ok:true, providers, errors} so the form can fall
    // back to manual entry while still telling the truth about what is missing.
    //  * llm missing          -> providers:[], errors explains why
    //  * listProviders throws -> providers:[], errors
    //  * one provider's listModels throws/times out -> THAT provider is skipped
    //    and named in errors; the others are still returned
    //  * one model's resolveModelInfo throws -> the model is still returned, with
    //    null context/defaults and empty reasoning, and errors names it
    // Providers are queried CONCURRENTLY: serial awaits would stack N timeouts.
    const MODELS_TIMEOUT_MS = 5000;
    const modelsCatalog = async () => {
      const llm = ctx.get('llm');
      if (llm === undefined || llm === null || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
        return { ok: true, providers: [], errors: ['llm 服务不可用（缺少 listProviders/listModels），无法列出模型目录'] };
      }
      let list = [];
      try { const l = llm.listProviders(); list = Array.isArray(l) ? l : []; }
      catch (e) { return { ok: true, providers: [], errors: ['listProviders 失败：' + String(e && e.message ? e.message : e)] }; }
      const errors = [];
      const settled = await Promise.allSettled(list.map(async (p) => {
        const id = p && typeof p.id === 'string' ? p.id : null;
        if (id === null) throw new Error('provider 条目缺少 id');
        const models = await withTimeout(Promise.resolve(llm.listModels(id)), MODELS_TIMEOUT_MS, 'listModels ' + id);
        const out = [];
        for (const m of (Array.isArray(models) ? models : [])) {
          const mid = m && typeof m.id === 'string' ? m.id : null;
          if (mid === null) continue;
          let resolved = null;
          try { resolved = await withTimeout(Promise.resolve(llm.resolveModelInfo(id, mid)), MODELS_TIMEOUT_MS, 'resolveModelInfo ' + id + '/' + mid); }
          catch (e) { errors.push('provider "' + id + '" model "' + mid + '": resolveModelInfo 失败：' + String(e && e.message ? e.message : e)); }
          const reasoning = resolved && resolved.reasoning && typeof resolved.reasoning === 'object' ? resolved.reasoning : null;
          const efforts = reasoning && Array.isArray(reasoning.efforts)
            ? reasoning.efforts.map((x) => ({ id: x && x.id !== undefined ? x.id : null, name: x && x.name !== undefined ? x.name : (x && x.id !== undefined ? x.id : null) })).filter((x) => x.id !== null)
            : [];
          out.push({
            id: mid,
            name: m && typeof m.name === 'string' && m.name !== '' ? m.name : mid,
            description: m && typeof m.description === 'string' ? m.description : null,
            contextWindow: resolved && resolved.context && typeof resolved.context.contextWindow === 'number' ? resolved.context.contextWindow : null,
            defaultMaxTokens: resolved && typeof resolved.defaultMaxTokens === 'number' ? resolved.defaultMaxTokens : null,
            reasoning: { efforts, defaultEffort: reasoning && typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : null },
          });
        }
        return { id, name: p && typeof p.name === 'string' && p.name !== '' ? p.name : id, models: out };
      }));
      const providers = [];
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        if (s.status === 'fulfilled') providers.push(s.value);
        else errors.push('provider "' + ((list[i] && list[i].id) || '?') + '": listModels 失败：' + String(s.reason && s.reason.message ? s.reason.message : s.reason));
      }
      return { ok: true, providers, errors };
    };

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
    // `?session=<id>` is OPTIONAL and defaults to "no session", which keeps this
    // endpoint byte-identical to pre-P12. When a session IS given, the runs are
    // narrowed with the same pure `selectRun` rule the /progress endpoint uses
    // (a legacy record with no sessionId is attributed to nobody, so it drops out
    // of a session-scoped view instead of being handed to the wrong session).
    route('exact', '/api/team-flowise/runs', wrap(async (req) => {
      const runs = await listRuns();
      const session = readSessionOption(query(req.url, 'session')).sessionId;
      return { ok: true, runs: session === undefined ? runs : runs.filter((r) => r && r.sessionId === session) };
    }));
    // Read-only progress summary of the latest run (or ?runId=<id>), aligned to
    // the workflow definition. GET + no body => directly consumable by
    // Invoke-RestMethod and by the client board's poll loop.
    // P12: `?session=<id>` narrows "the latest run" to that session. `runId`
    // stays explicit and therefore outranks it.
    route('exact', '/api/team-flowise/progress', wrap(async (req) => progressSummary(query(req.url, 'runId'), readSessionOption(query(req.url, 'session')).sessionId)));
    // Heavy per-role detail (the complete worker report + reasoning trace),
    // fetched only when a role is opened rather than on every poll.
    route('exact', '/api/team-flowise/role', wrap(async (req) => roleDetail(query(req.url, 'runId'), query(req.url, 'agent'), readSessionOption(query(req.url, 'session')).sessionId)));
    route('exact', '/api/team-flowise/run', wrap(async (req) => {
      const id = query(req.url, 'id');
      if (!id) return { ok: false, error: 'missing id' };
      return { ok: true, run: await getRun(id) };
    }));
    // P11: the model catalog (providers -> models -> efforts) that the role form
    // needs. Read-only, so no loopback guard -- same as /progress, /role, /agents.
    route('exact', '/api/team-flowise/models', wrap(async () => modelsCatalog()));

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
      // `body.route` is the P11 run-level override (highest-priority layer).
      // `body.session` (P12) is the session this run belongs to, as sent by the
      // client. OPTIONAL and never guessed: an HTTP route has no live initiator,
      // so without it the run is stored with no attribution at all.
      runWorkflow(body.workflowId, body.input || {}, publish, { route: body.route, session: typeof body.session === 'string' ? body.session : ((body.session && typeof body.session === 'object') ? body.session : undefined) }).catch(async (e) => {
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