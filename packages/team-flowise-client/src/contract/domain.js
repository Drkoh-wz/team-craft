// Record shapes and their display vocabularies.
//
// These mirror the zod schemas the host half validates with
// (`agentDefSchema`, `workflowSchema`, `taskSchema`, `runSchema`). A shape
// change on the host is a shape change here — nothing is inferred at runtime,
// because these records arrive as plain JSON and are never live objects.

/** Task ledger lifecycle, as ordered board columns. */
export const TASK_COLUMNS = [
  { key: 'queued', label: '已排队', tone: 'neutral' },
  { key: 'submitted', label: '已提交', tone: 'warn' },
  { key: 'working', label: '进行中', tone: 'business' },
  { key: 'completed', label: '已完成', tone: 'success' },
  { key: 'reworked', label: '需返工', tone: 'error' },
  { key: 'settle', label: '已结算', tone: 'dimmed' },
]

/** Run lifecycle. `interrupted` is what the host's startup reap writes. */
export const RUN_STATUSES = [
  { key: 'running', label: '运行中', tone: 'business' },
  { key: 'completed', label: '已完成', tone: 'success' },
  { key: 'failed', label: '失败', tone: 'error' },
  { key: 'cancelled', label: '已取消', tone: 'dimmed' },
  { key: 'interrupted', label: '已中断', tone: 'warn' },
]

/** Per-node run state. The host writes exactly these two. */
export const NODE_STATUSES = [
  { key: 'pending', label: '待执行', tone: 'neutral' },
  { key: 'completed', label: '成功', tone: 'success' },
  { key: 'failed', label: '失败', tone: 'error' },
]

/** Tone → CSS custom property suffix used by the stylesheet. */
export const TONE_VARS = {
  neutral: 'label-tertiary',
  dimmed: 'label-dimmed',
  business: 'state-business-primary',
  warn: 'state-warn-primary',
  error: 'state-error-primary',
  success: 'state-success-primary',
}

/** The five tabs of the Settings section page, in display order. */
export const SECTION_TABS = [
  { key: 'overview', label: '总览' },
  { key: 'agents', label: 'Agents' },
  { key: 'workflows', label: '工作流' },
  { key: 'dag', label: 'DAG 画布' },
  { key: 'tasks', label: '任务' },
  { key: 'runs', label: '运行' },
]

/**
 * Find the display entry for a status key.
 *
 * @param table - one of {@link TASK_COLUMNS}, {@link RUN_STATUSES}, {@link NODE_STATUSES}.
 * @param key - status key as stored by the host.
 * @returns the entry, or a synthesised fallback so an unknown status still renders.
 */
export function statusEntry(table, key) {
  for (const entry of table) if (entry.key === key) return entry
  const text = key === undefined || key === null || key === '' ? '未知' : String(key)
  return { key: text, label: text, tone: 'neutral' }
}

/**
 * Pick the leaf fields of an Agent definition that the UI actually renders.
 *
 * Live host records are never forwarded whole: a definition is reduced to the
 * scalars this package draws, so nothing host-owned leaks into React state.
 *
 * @param raw - one record from `GET /agents`.
 * @returns a plain display object, or `null` when the input is not an object.
 */
export function pickAgent(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const model = raw.model !== null && typeof raw.model === 'object' ? raw.model : {}
  const tools = raw.tools !== null && typeof raw.tools === 'object' ? raw.tools : {}
  const allow = Array.isArray(tools.allow) ? tools.allow.map(String) : []
  const deny = Array.isArray(tools.deny) ? tools.deny.map(String) : []
  const skills = Array.isArray(raw.skills) ? raw.skills.map(String) : []
  return {
    id: String(raw.id === undefined ? '' : raw.id),
    name: String(raw.name === undefined || raw.name === '' ? raw.id === undefined ? '' : raw.id : raw.name),
    role: String(raw.role === undefined ? '' : raw.role),
    systemPrompt: String(raw.systemPrompt === undefined ? '' : raw.systemPrompt),
    provider: String(model.provider === undefined ? '' : model.provider),
    model: String(model.model === undefined ? '' : model.model),
    skills,
    allow,
    deny,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/**
 * Reduce one workflow record to the fields the list, canvas, and editor use.
 *
 * @param raw - one record from `GET /workflows`.
 * @returns a plain display object, or `null` when the input is not an object.
 */
export function pickWorkflow(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const rawNodes = raw.nodes !== null && typeof raw.nodes === 'object' ? raw.nodes : {}
  const nodes = []
  for (const key of Object.keys(rawNodes)) {
    const node = rawNodes[key]
    if (node === null || typeof node !== 'object') continue
    const template = node.taskTemplate !== null && typeof node.taskTemplate === 'object' ? node.taskTemplate : {}
    nodes.push({
      id: String(node.id === undefined || node.id === '' ? key : node.id),
      agent: String(node.agent === undefined ? '' : node.agent),
      reviewer: String(node.reviewer === undefined ? '' : node.reviewer),
      mode: String(node.mode === undefined ? 'once' : node.mode),
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(String) : [],
      requirement: String(template.requirement === undefined ? '' : template.requirement),
      acceptanceCriteria: String(template.acceptanceCriteria === undefined ? '' : template.acceptanceCriteria),
    })
  }
  return {
    id: String(raw.id === undefined ? '' : raw.id),
    name: String(raw.name === undefined || raw.name === '' ? raw.id === undefined ? '' : raw.id : raw.name),
    description: String(raw.description === undefined ? '' : raw.description),
    nodes,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/**
 * Reduce one ledger task, decoding the iteration history into scalars only.
 *
 * @param raw - one record from `GET /tasks`.
 * @returns a plain display object, or `null` when the input is not an object.
 */
export function pickTask(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const history = Array.isArray(raw.history) ? raw.history : []
  return {
    id: String(raw.id === undefined ? '' : raw.id),
    workflowId: String(raw.workflowId === undefined ? '' : raw.workflowId),
    nodeId: String(raw.nodeId === undefined ? '' : raw.nodeId),
    assignee: String(raw.assignee === undefined ? '' : raw.assignee),
    reviewer: String(raw.reviewer === undefined ? '' : raw.reviewer),
    requirement: String(raw.requirement === undefined ? '' : raw.requirement),
    acceptanceCriteria: String(raw.acceptanceCriteria === undefined ? '' : raw.acceptanceCriteria),
    status: String(raw.status === undefined ? 'queued' : raw.status),
    iteration: typeof raw.iteration === 'number' ? raw.iteration : 0,
    output: typeof raw.output === 'string' ? raw.output : '',
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
    steps: history.map((step) => ({
      iteration: typeof step.iteration === 'number' ? step.iteration : 0,
      status: String(step.status === undefined ? '' : step.status),
      at: typeof step.at === 'number' ? step.at : 0,
      feedback: typeof step.feedback === 'string' ? step.feedback : '',
    })),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

/**
 * Reduce one run, keeping only per-node scalars.
 *
 * The host stores a node's `output` and `tools` note alongside its status; only
 * short scalar forms are kept so a large node payload never lands in React state.
 *
 * @param raw - one record from `GET /runs` or `GET /run?id=`.
 * @returns a plain display object, or `null` when the input is not an object.
 */
export function pickRun(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const states = raw.nodeStates !== null && typeof raw.nodeStates === 'object' ? raw.nodeStates : {}
  const nodes = []
  for (const key of Object.keys(states)) {
    const state = states[key]
    if (state === null || typeof state !== 'object') continue
    nodes.push({
      id: String(key),
      status: String(state.status === undefined ? 'pending' : state.status),
      assignee: String(state.assignee === undefined ? '' : state.assignee),
      output: typeof state.output === 'string' ? state.output.slice(0, 400) : '',
      error: typeof state.error === 'string' ? state.error.slice(0, 400) : '',
      tools: typeof state.tools === 'string' ? state.tools : '',
    })
  }
  const result = raw.result !== null && typeof raw.result === 'object' ? raw.result : {}
  return {
    id: String(raw.id === undefined ? '' : raw.id),
    workflowId: String(raw.workflowId === undefined ? '' : raw.workflowId),
    status: String(raw.status === undefined ? 'running' : raw.status),
    nodes,
    summary: typeof result.summary === 'string' ? result.summary : '',
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : 0,
  }
}

/**
 * Percentage of a run's nodes that reached a terminal success state.
 *
 * @param run - a value from {@link pickRun}.
 * @returns an integer 0–100; 0 when the run has no nodes yet.
 */
export function runProgress(run) {
  if (run === null || run === undefined || !Array.isArray(run.nodes) || run.nodes.length === 0) return 0
  let done = 0
  for (const node of run.nodes) if (node.status === 'completed') done += 1
  return Math.round((done / run.nodes.length) * 100)
}
