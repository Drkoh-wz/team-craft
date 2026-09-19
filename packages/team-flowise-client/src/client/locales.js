// Localisation.
//
// Dictionary keys are the Chinese strings used as the source of truth in the
// shipped packages: the key set is identical across languages, and `t()` falls
// back to the key itself, so a missing translation degrades to readable text
// rather than an identifier.

export const ZH = {
  'section.label': '多 Agent 团队',
  'action.refresh': '刷新',
  'action.refreshing': '刷新中…',
  'action.create': '新建',
  'action.save': '保存',
  'action.cancel': '取消',
  'action.close': '关闭',
  'action.delete': '删除',
  'action.edit': '编辑',
  'action.run': '运行',
  'action.running': '启动中…',
  'action.detail': '详情',
  'action.back': '返回',
  'action.rework': '提交返工',
  'action.retry': '重试',
  'action.viewDag': '查看 DAG',
  'state.loading': '加载中…',
  'state.empty': '暂无数据',
  'state.error': '错误',
  'state.notSelected': '未选择',
  'state.unknown': '未知',

  'tab.overview': '总览',
  'tab.agents': 'Agents',
  'tab.workflows': '工作流',
  'tab.dag': 'DAG 画布',
  'tab.tasks': '任务',
  'tab.runs': '运行',

  'overview.title': '多 Agent 团队',
  'overview.subtitle': '读取宿主 @local/team-flowise 的 storageDomain 数据（Agent 定义 / 任务账本 / 工作流 / 运行）。',
  'overview.stat.agents': 'Agents',
  'overview.stat.workflows': '工作流',
  'overview.stat.tasksOpen': '未结算任务',
  'overview.stat.runsLive': '运行中',
  'overview.health': '宿主连通性',
  'overview.healthOk': '已连通',
  'overview.healthFail': '不可达',
  'overview.domains': '存储域',
  'overview.recentRuns': '最近运行',
  'overview.openTasks': '待处理任务',

  'agents.title': 'Agent 定义',
  'agents.empty': '暂无 Agent，点击「新建 Agent」创建第一个角色。',
  'agents.new': '新建 Agent',
  'agents.edit': '编辑 Agent',
  'agents.field.name': '名称',
  'agents.field.role': '角色',
  'agents.field.systemPrompt': '系统提示',
  'agents.field.provider': 'Provider',
  'agents.field.model': '模型',
  'agents.field.skills': '技能（逗号分隔）',
  'agents.field.toolsAllow': '允许工具（逗号分隔）',
  'agents.field.toolsDeny': '禁止工具（逗号分隔）',
  'agents.detail.title': 'Agent 详情',
  'agents.confirmDelete': '确认删除该 Agent？',
  'agents.needName': '名称必填',

  'workflows.title': '工作流',
  'workflows.empty': '暂无工作流，点击「新建工作流」，或用节点编辑器从零搭一个 DAG。',
  'workflows.new': '新建工作流',
  'workflows.edit': '编辑工作流',
  'workflows.field.name': '名称',
  'workflows.field.description': '描述',
  'workflows.field.nodes': '节点（JSON 对象：{ "<节点 id>": { "agent": "...", "dependsOn": ["..."], "taskTemplate": { "requirement": "..." } } }）',
  'workflows.nodeCount': '{count} 个节点',
  'workflows.nodesInvalid': 'nodes 必须是 JSON 对象',
  'workflows.confirmDelete': '确认删除该工作流？',
  'workflows.needName': '名称必填',
  'workflows.started': '已启动运行 {id}',

  'dag.title': '工作流 DAG',
  'dag.empty': '暂无工作流可绘制。',
  'dag.pick': '选择工作流',
  'dag.nodes': '节点',
  'dag.edges': '依赖边',
  'dag.waves': '层数',
  'dag.cycle': '检测到环依赖，环上的节点画在最后一层：{ids}',
  'dag.missingDeps': '引用了不存在的依赖：{ids}',
  'dag.noDep': '无依赖',
  'dag.legend.pending': '未执行',
  'dag.legend.completed': '成功',
  'dag.legend.failed': '失败',
  'dag.legend.edge': '依赖',
  'dag.runState': '叠加最近一次运行状态',
  'dag.canvasLabel': '工作流有向无环图',

  'tasks.title': '任务账本',
  'tasks.empty': '暂无任务。',
  'tasks.new': '新建任务',
  'tasks.field.assignee': '指派 Agent',
  'tasks.field.requirement': '需求',
  'tasks.field.acceptance': '验收标准',
  'tasks.field.reviewer': '评审人',
  'tasks.field.feedback': '返工反馈',
  'tasks.field.unassigned': '(未指派)',
  'tasks.field.none': '(无)',
  'tasks.iteration': '第 {n} 轮',
  'tasks.steps': '{count} 步',
  'tasks.needRequirement': '需求必填',

  'runs.title': '运行记录',
  'runs.empty': '暂无运行记录，可在工作流页触发一次。',
  'runs.progress': '节点进度',
  'runs.summary': '结果摘要',
  'runs.nodes': '节点状态',
  'runs.field.workflow': '工作流',
  'runs.field.started': '开始时间',
  'runs.field.ended': '结束时间',
  'runs.field.duration': '耗时',
  'runs.field.tools': '工具可见性',
  'runs.field.output': '节点输出',
  'runs.field.error': '节点错误',
  'runs.live': '运行中',

  'activity.trigger': '团队活动',
  'activity.title': '多 Agent 团队活动',
  'activity.liveRuns': '{count} 个运行进行中',
  'activity.idleRuns': '{count} 个运行记录',
  'activity.openTasks': '{count} 个任务未结算',
  'activity.blockedTasks': '{count} 个任务需返工',
  'activity.empty': '暂无团队活动。',
  'activity.openSettings': '打开设置页',
  'activity.aria': '团队活动',
}

export const EN = {
  'section.label': 'Multi-agent team',
  'action.refresh': 'Refresh',
  'action.refreshing': 'Refreshing…',
  'action.create': 'Create',
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.run': 'Run',
  'action.running': 'Starting…',
  'action.detail': 'Details',
  'action.back': 'Back',
  'action.rework': 'Send back',
  'action.retry': 'Retry',
  'action.viewDag': 'View DAG',
  'state.loading': 'Loading…',
  'state.empty': 'Nothing here yet',
  'state.error': 'Error',
  'state.notSelected': 'Not selected',
  'state.unknown': 'unknown',

  'tab.overview': 'Overview',
  'tab.agents': 'Agents',
  'tab.workflows': 'Workflows',
  'tab.dag': 'DAG canvas',
  'tab.tasks': 'Tasks',
  'tab.runs': 'Runs',

  'overview.title': 'Multi-agent team',
  'overview.subtitle': 'Reads the storageDomain data of the host plugin @local/team-flowise (agent definitions, task ledger, workflows, runs).',
  'overview.stat.agents': 'Agents',
  'overview.stat.workflows': 'Workflows',
  'overview.stat.tasksOpen': 'Open tasks',
  'overview.stat.runsLive': 'Running',
  'overview.health': 'Host connectivity',
  'overview.healthOk': 'reachable',
  'overview.healthFail': 'unreachable',
  'overview.domains': 'Storage domains',
  'overview.recentRuns': 'Recent runs',
  'overview.openTasks': 'Open tasks',

  'agents.title': 'Agent definitions',
  'agents.empty': 'No agents yet — use “New agent” to create the first role.',
  'agents.new': 'New agent',
  'agents.edit': 'Edit agent',
  'agents.field.name': 'Name',
  'agents.field.role': 'Role',
  'agents.field.systemPrompt': 'System prompt',
  'agents.field.provider': 'Provider',
  'agents.field.model': 'Model',
  'agents.field.skills': 'Skills (comma separated)',
  'agents.field.toolsAllow': 'Allowed tools (comma separated)',
  'agents.field.toolsDeny': 'Denied tools (comma separated)',
  'agents.detail.title': 'Agent details',
  'agents.confirmDelete': 'Delete this agent?',
  'agents.needName': 'A name is required',

  'workflows.title': 'Workflows',
  'workflows.empty': 'No workflows yet — use “New workflow”, or build a DAG with the node editor.',
  'workflows.new': 'New workflow',
  'workflows.edit': 'Edit workflow',
  'workflows.field.name': 'Name',
  'workflows.field.description': 'Description',
  'workflows.field.nodes': 'Nodes (JSON object: { "<node id>": { "agent": "...", "dependsOn": ["..."], "taskTemplate": { "requirement": "..." } } })',
  'workflows.nodeCount': '{count} nodes',
  'workflows.nodesInvalid': 'nodes must be a JSON object',
  'workflows.confirmDelete': 'Delete this workflow?',
  'workflows.needName': 'A name is required',
  'workflows.started': 'Started run {id}',

  'dag.title': 'Workflow DAG',
  'dag.empty': 'No workflow to draw.',
  'dag.pick': 'Workflow',
  'dag.nodes': 'Nodes',
  'dag.edges': 'Edges',
  'dag.waves': 'Waves',
  'dag.cycle': 'Cyclic dependency detected; nodes on the cycle are drawn in the last wave: {ids}',
  'dag.missingDeps': 'Depends on nodes that do not exist: {ids}',
  'dag.noDep': 'no dependencies',
  'dag.legend.pending': 'not run',
  'dag.legend.completed': 'succeeded',
  'dag.legend.failed': 'failed',
  'dag.legend.edge': 'dependency',
  'dag.runState': 'Overlay the latest run state',
  'dag.canvasLabel': 'Workflow directed acyclic graph',

  'tasks.title': 'Task ledger',
  'tasks.empty': 'No tasks yet.',
  'tasks.new': 'New task',
  'tasks.field.assignee': 'Assignee',
  'tasks.field.requirement': 'Requirement',
  'tasks.field.acceptance': 'Acceptance criteria',
  'tasks.field.reviewer': 'Reviewer',
  'tasks.field.feedback': 'Rework feedback',
  'tasks.field.unassigned': '(unassigned)',
  'tasks.field.none': '(none)',
  'tasks.iteration': 'iteration {n}',
  'tasks.steps': '{count} steps',
  'tasks.needRequirement': 'A requirement is required',

  'runs.title': 'Runs',
  'runs.empty': 'No runs recorded yet — start one from the Workflows tab.',
  'runs.progress': 'Node progress',
  'runs.summary': 'Result summary',
  'runs.nodes': 'Node states',
  'runs.field.workflow': 'Workflow',
  'runs.field.started': 'Started',
  'runs.field.ended': 'Ended',
  'runs.field.duration': 'Duration',
  'runs.field.tools': 'Tool visibility',
  'runs.field.output': 'Node output',
  'runs.field.error': 'Node error',
  'runs.live': 'running',

  'activity.trigger': 'Team activity',
  'activity.title': 'Multi-agent team activity',
  'activity.liveRuns': '{count} run(s) in flight',
  'activity.idleRuns': '{count} run record(s)',
  'activity.openTasks': '{count} task(s) still open',
  'activity.blockedTasks': '{count} task(s) need rework',
  'activity.empty': 'No team activity yet.',
  'activity.openSettings': 'Open the settings page',
  'activity.aria': 'Team activity',
}

export const DICTIONARIES = { zh: ZH, en: EN }

/** Locale namespaces this package answers for, in preference order. */
export const LOCALE_FALLBACKS = ['zh', 'en']

/**
 * Interpolate `{name}` placeholders.
 *
 * @param template - dictionary value.
 * @param params - replacement map; missing keys leave the placeholder intact.
 * @returns the rendered string.
 */
export function format(template, params) {
  if (params === undefined || params === null) return template
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key]
    return value === undefined || value === null ? match : String(value)
  })
}

/**
 * Build a translator over a dictionary table.
 *
 * @param table - `{ zh, en }` dictionary map.
 * @param locale - requested locale; the first {@link LOCALE_FALLBACKS} entry whose
 *   dictionary contains the key wins, then the key itself.
 * @returns `(key, params?) => string`.
 */
export function createTranslator(table, locale) {
  const dictionaries = table === undefined || table === null ? DICTIONARIES : table
  const preferred = []
  if (typeof locale === 'string' && locale !== '') preferred.push(locale)
  for (const fallback of LOCALE_FALLBACKS) if (preferred.indexOf(fallback) === -1) preferred.push(fallback)
  for (const key of Object.keys(dictionaries)) if (preferred.indexOf(key) === -1) preferred.push(key)
  return (key, params) => {
    for (const name of preferred) {
      const dictionary = dictionaries[name]
      if (dictionary !== undefined && typeof dictionary[key] === 'string') return format(dictionary[key], params)
    }
    return format(String(key), params)
  }
}
