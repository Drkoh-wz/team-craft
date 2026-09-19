// The Settings section page.
//
// Registered into `settings.section` (a list slot the settings shell projects
// into its navigation and renders one entry at a time). The page owns its own
// tabs, fetching, and forms; the shell passes exactly one prop, `close`.
import * as React from 'react'
import { NODE_STATUSES, RUN_STATUSES, SECTION_TABS, TASK_COLUMNS } from '../../contract/domain.js'
import { layoutDag } from '../../contract/layout.js'
import { usePolling, useStore, useTeamState, useTranslate } from '../context.js'
import { POLL_INTERVAL_MS } from '../store.js'
import { DagCanvas } from './dag-canvas.js'
import {
  Button,
  Chip,
  Empty,
  ErrorBanner,
  Field,
  Loading,
  Modal,
  ProgressBar,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  formatDuration,
  formatTime,
  toneColor,
} from '../ui.js'

/** The empty create-task draft. */
function emptyTaskDraft() {
  return { kind: 'task', id: '', assignee: '', reviewer: '', requirement: '', acceptanceCriteria: '', feedback: '', steps: [] }
}

/** Split a comma-separated field into trimmed, non-empty entries. */
function splitList(value) {
  return String(value === undefined || value === null ? '' : value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/** Join list entries for a comma-separated field. */
function joinList(list) {
  return Array.isArray(list) ? list.join(', ') : ''
}

/**
 * The workflow to show when the DAG tab opens without one explicitly picked.
 *
 * The default is not "the first record": an empty workflow (one saved before its
 * nodes were filled in) would open the tab on a blank canvas, which reads as a
 * broken page. A workflow with nodes wins; insertion order breaks the tie, and
 * an all-empty store still resolves to a real record so the picker stays honest.
 *
 * @param workflows - the workflow slice of the store.
 * @returns the workflow to lay out, or `undefined` for an empty store.
 */
function defaultDagWorkflow(workflows) {
  if (!Array.isArray(workflows) || workflows.length === 0) return undefined
  let best
  for (const workflow of workflows) {
    if (best === undefined) {
      best = workflow
      continue
    }
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.length : 0
    const bestNodes = Array.isArray(best.nodes) ? best.nodes.length : 0
    if (nodes > bestNodes) best = workflow
  }
  return best
}

/** A key/value grid. */
function KeyValues(props) {
  return React.createElement(
    'div',
    { className: 'tfc-kv' },
    props.rows.map((row) => React.createElement('span', { key: 'k-' + row.label, className: 'tfc-kv-key' }, row.label)),
    props.rows.map((row) =>
      React.createElement('span', { key: 'v-' + row.label, className: 'tfc-kv-val' }, row.value === undefined || row.value === '' ? '—' : row.value),
    ),
  )
}

/** The tab strip. */
function Tabs(props) {
  return React.createElement(
    'div',
    { className: 'tfc-tabs' },
    props.tabs.map((tab) =>
      React.createElement(
        'button',
        {
          key: tab.key,
          type: 'button',
          className: 'tfc-tab' + (props.active === tab.key ? ' tfc-tab-active' : ''),
          onClick: () => props.onSelect(tab.key),
        },
        props.t('tab.' + tab.key),
      ),
    ),
  )
}

/** Overview tab: counts, host health, and the newest records. */
function OverviewTab(props) {
  const t = props.t
  const state = props.state
  const store = props.store
  const open = store.openTaskCount()
  const live = store.liveRunCount()
  const stats = [
    { label: t('overview.stat.agents'), value: state.agents.length },
    { label: t('overview.stat.workflows'), value: state.workflows.length },
    { label: t('overview.stat.tasksOpen'), value: open },
    { label: t('overview.stat.runsLive'), value: live },
  ]
  return React.createElement(
    'div',
    { className: 'tfc-col' },
    React.createElement(
      'div',
      { className: 'tfc-stats' },
      stats.map((stat) =>
        React.createElement(
          'div',
          { key: stat.label, className: 'tfc-stat' },
          React.createElement('span', { className: 'tfc-stat-value' }, String(stat.value)),
          React.createElement('span', { className: 'tfc-stat-label' }, stat.label),
        ),
      ),
    ),
    React.createElement(
      'div',
      { className: 'tfc-card tfc-card-l2' },
      React.createElement('div', { className: 'tfc-label' }, t('overview.health')),
      React.createElement(
        'div',
        { className: 'tfc-row' },
        React.createElement(Chip, null, state.health === 'ok' ? t('overview.healthOk') : state.health === 'down' ? t('overview.healthFail') : t('state.unknown')),
        state.domains.map((domain) => React.createElement(Chip, { key: domain }, domain)),
      ),
      React.createElement('div', { className: 'tfc-caption', style: { marginTop: 4 } }, formatTime(state.lastLoadedAt)),
    ),
    React.createElement(
      'div',
      { className: 'tfc-card' },
      React.createElement('div', { className: 'tfc-label' }, t('overview.recentRuns')),
      state.runs.length === 0
        ? React.createElement(Empty, { label: t('runs.empty') })
        : React.createElement(
            'div',
            { className: 'tfc-list' },
            store.newestRuns(5).map((run) =>
              React.createElement(
                'div',
                { key: run.id, className: 'tfc-item tfc-item-selectable', onClick: () => props.onOpenRun(run.id) },
                React.createElement(
                  'div',
                  { className: 'tfc-item-main' },
                  React.createElement('span', { className: 'tfc-item-title' }, '#' + run.id.slice(-8)),
                  React.createElement('span', { className: 'tfc-item-sub' }, (run.workflowId || '—') + ' · ' + formatTime(run.startedAt)),
                ),
                React.createElement('div', { style: { width: 72 } }, React.createElement(ProgressBar, { percent: store.runProgress(run) })),
                React.createElement(StatusBadge, { table: RUN_STATUSES, status: run.status }),
              ),
            ),
          ),
    ),
    React.createElement(
      'div',
      { className: 'tfc-card' },
      React.createElement('div', { className: 'tfc-label' }, t('overview.openTasks')),
      state.tasks.length === 0
        ? React.createElement(Empty, { label: t('tasks.empty') })
        : React.createElement(
            'div',
            { className: 'tfc-list' },
            store
              .newestTasks(5)
              .filter((task) => task.status !== 'settle')
              .map((task) =>
                React.createElement(
                  'div',
                  { key: task.id, className: 'tfc-item' },
                  React.createElement(
                    'div',
                    { className: 'tfc-item-main' },
                    React.createElement('span', { className: 'tfc-item-title' }, task.requirement === '' ? task.id : task.requirement),
                    React.createElement('span', { className: 'tfc-item-sub' }, (task.assignee || '—') + ' · ' + t('tasks.iteration', { n: task.iteration })),
                  ),
                  React.createElement(StatusBadge, { table: TASK_COLUMNS, status: task.status }),
                ),
              ),
          ),
    ),
  )
}

/** Agents tab: list, create, edit, delete. */
function AgentsTab(props) {
  const t = props.t
  const state = props.state
  const draft = props.draft
  const setDraft = props.setDraft
  if (state.agents.length === 0) return React.createElement(Empty, { label: t('agents.empty') })
  return React.createElement(
    'div',
    { className: 'tfc-list' },
    state.agents.map((agent) =>
      React.createElement(
        'div',
        { key: agent.id, className: 'tfc-item' },
        React.createElement(
          'div',
          { className: 'tfc-item-main' },
          React.createElement('span', { className: 'tfc-item-title' }, agent.name),
          React.createElement('span', { className: 'tfc-item-sub' }, (agent.role || '—') + (agent.model === '' ? '' : ' · ' + agent.provider + '/' + agent.model)),
        ),
        React.createElement(Chip, null, String(agent.allow.length + agent.deny.length) + ' tools'),
        React.createElement(Chip, null, 'it ' + formatTime(agent.updatedAt)),
        React.createElement(
          Button,
          {
            variant: 'ghost',
            onClick: () => {
              setDraft({
                kind: 'agent',
                id: agent.id,
                name: agent.name,
                role: agent.role,
                systemPrompt: agent.systemPrompt,
                provider: agent.provider,
                model: agent.model,
                skills: joinList(agent.skills),
                allow: joinList(agent.allow),
                deny: joinList(agent.deny),
              })
            },
          },
          t('action.edit'),
        ),
        React.createElement(
          Button,
          {
            variant: 'danger',
            onClick: () => {
              if (typeof props.onDelete === 'function' && props.confirmDelete(t('agents.confirmDelete'))) props.onDelete(agent.id)
            },
          },
          t('action.delete'),
        ),
      ),
    ),
    draft.kind === 'agent'
      ? React.createElement(
          Modal,
          { open: true, title: t('agents.edit'), onClose: () => setDraft(null) },
          React.createElement(Field, { label: t('agents.field.name') }, React.createElement(TextInput, { value: draft.name, onChange: (value) => setDraft(Object.assign({}, draft, { name: value })) })),
          React.createElement(Field, { label: t('agents.field.role') }, React.createElement(TextInput, { value: draft.role, onChange: (value) => setDraft(Object.assign({}, draft, { role: value })) })),
          React.createElement(Field, { label: t('agents.field.systemPrompt') }, React.createElement(TextArea, { value: draft.systemPrompt, onChange: (value) => setDraft(Object.assign({}, draft, { systemPrompt: value })) })),
          React.createElement(
            'div',
            { className: 'tfc-row' },
            React.createElement(Field, { label: t('agents.field.provider') }, React.createElement(TextInput, { value: draft.provider, onChange: (value) => setDraft(Object.assign({}, draft, { provider: value })) })),
            React.createElement(Field, { label: t('agents.field.model') }, React.createElement(TextInput, { value: draft.model, onChange: (value) => setDraft(Object.assign({}, draft, { model: value })) })),
          ),
          React.createElement(Field, { label: t('agents.field.skills') }, React.createElement(TextInput, { value: draft.skills, onChange: (value) => setDraft(Object.assign({}, draft, { skills: value })) })),
          React.createElement(Field, { label: t('agents.field.toolsAllow') }, React.createElement(TextInput, { value: draft.allow, onChange: (value) => setDraft(Object.assign({}, draft, { allow: value })) })),
          React.createElement(Field, { label: t('agents.field.toolsDeny') }, React.createElement(TextInput, { value: draft.deny, onChange: (value) => setDraft(Object.assign({}, draft, { deny: value })) })),
          React.createElement(
            'div',
            { className: 'tfc-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: () => setDraft(null) }, t('action.cancel')),
            React.createElement(Button, { variant: 'primary', disabled: draft.name.trim() === '', onClick: props.onSave }, t('action.save')),
          ),
        )
      : null,
  )
}

/** Workflows tab: list, run, edit, delete. */
function WorkflowsTab(props) {
  const t = props.t
  const state = props.state
  const draft = props.draft
  const setDraft = props.setDraft
  const editDraft = draft.kind === 'workflow' ? draft : null
  const rows =
    state.workflows.length === 0
      ? [React.createElement(Empty, { key: 'empty', label: t('workflows.empty') })]
      : state.workflows.map((workflow) =>
          React.createElement(
            'div',
            { key: workflow.id, className: 'tfc-item' },
            React.createElement(
              'div',
              { className: 'tfc-item-main' },
              React.createElement('span', { className: 'tfc-item-title' }, workflow.name),
              React.createElement('span', { className: 'tfc-item-sub' }, (workflow.description || '—') + ' · ' + t('workflows.nodeCount', { count: workflow.nodes.length })),
            ),
            React.createElement(Chip, null, formatTime(workflow.updatedAt)),
            React.createElement(
              Button,
              { variant: 'ghost', onClick: () => props.onShowDag(workflow.id) },
              t('action.viewDag'),
            ),
            React.createElement(
              Button,
              { variant: 'primary', disabled: props.busy, onClick: () => props.onRun(workflow.id) },
              props.busy ? t('action.running') : t('action.run'),
            ),
            React.createElement(
              Button,
              {
                variant: 'ghost',
                onClick: () =>
                  setDraft({
                    kind: 'workflow',
                    id: workflow.id,
                    name: workflow.name,
                    description: workflow.description,
                    nodesText: JSON.stringify(
                      workflow.nodes.reduce((accumulator, node) => {
                        accumulator[node.id] = {
                          agent: node.agent,
                          dependsOn: node.dependsOn,
                          reviewer: node.reviewer,
                          taskTemplate: { requirement: node.requirement, acceptanceCriteria: node.acceptanceCriteria },
                        }
                        return accumulator
                      }, {}),
                      null,
                      2,
                    ),
                  }),
              },
              t('action.edit'),
            ),
            React.createElement(
              Button,
              {
                variant: 'danger',
                onClick: () => {
                  if (typeof props.onDelete === 'function' && props.confirmDelete(t('workflows.confirmDelete'))) props.onDelete(workflow.id)
                },
              },
              t('action.delete'),
            ),
          ),
        )
  return React.createElement(
    'div',
    { className: 'tfc-col' },
    React.createElement('div', { className: 'tfc-list' }, rows),
    editDraft === null
      ? null
      : React.createElement(
          Modal,
          { open: true, title: t('workflows.edit'), onClose: () => setDraft(null) },
          React.createElement(Field, { label: t('workflows.field.name') }, React.createElement(TextInput, { value: editDraft.name, onChange: (value) => setDraft(Object.assign({}, editDraft, { name: value })) })),
          React.createElement(Field, { label: t('workflows.field.description') }, React.createElement(TextInput, { value: editDraft.description, onChange: (value) => setDraft(Object.assign({}, editDraft, { description: value })) })),
          React.createElement(
            Field,
            { label: t('workflows.field.nodes'), hint: props.nodesError === '' ? undefined : props.nodesError },
            React.createElement(TextArea, { rows: 12, value: editDraft.nodesText, onChange: (value) => setDraft(Object.assign({}, editDraft, { nodesText: value })) }),
          ),
          React.createElement(
            'div',
            { className: 'tfc-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: () => setDraft(null) }, t('action.cancel')),
            React.createElement(Button, { variant: 'primary', disabled: editDraft.name.trim() === '' || props.nodesError !== '', onClick: props.onSave }, t('action.save')),
          ),
        ),
  )
}

/** DAG tab: pick a workflow, lay it out, paint it, optionally overlay a run. */
function DagTab(props) {
  const t = props.t
  const state = props.state
  const [workflowId, setWorkflowId] = React.useState(props.initialWorkflowId === undefined ? '' : props.initialWorkflowId)
  const [overlay, setOverlay] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState(null)
  const workflow = state.workflows.filter((item) => item.id === workflowId)[0]
  const active = workflow === undefined ? defaultDagWorkflow(state.workflows) : workflow
  const layout = React.useMemo(
    () => (active === undefined ? null : layoutDag(active.nodes.map((node) => ({ id: node.id, dependsOn: node.dependsOn })))),
    [active],
  )
  const latestRun = React.useMemo(() => {
    if (active === undefined) return undefined
    const matches = state.runs.filter((run) => run.workflowId === active.id)
    matches.sort((a, b) => b.startedAt - a.startedAt)
    return matches[0]
  }, [active, state.runs])
  const nodeStates = overlay && latestRun !== undefined ? latestRun.nodes : undefined

  if (state.workflows.length === 0) return React.createElement(Empty, { label: t('dag.empty') })
  const missing = []
  for (const node of layout === null ? [] : layout.nodes) {
    for (const dep of node.missingDeps) if (missing.indexOf(node.id + ' → ' + dep) === -1) missing.push(node.id + ' → ' + dep)
  }
  return React.createElement(
    'div',
    { className: 'tfc-col' },
    React.createElement(
      'div',
      { className: 'tfc-row-between' },
      React.createElement(
        'div',
        { className: 'tfc-row' },
        React.createElement('span', { className: 'tfc-label' }, t('dag.pick')),
        React.createElement(Select, {
          value: active === undefined ? '' : active.id,
          onChange: (value) => {
            setWorkflowId(value)
            setSelectedId(null)
          },
          options: state.workflows.map((item) => ({ value: item.id, label: item.name })),
        }),
        React.createElement(Chip, null, t('dag.nodes') + ': ' + String(layout === null ? 0 : layout.nodes.length)),
        React.createElement(Chip, null, t('dag.edges') + ': ' + String(layout === null ? 0 : layout.edges.length)),
        React.createElement(Chip, null, t('dag.waves') + ': ' + String(layout === null ? 0 : layout.layers.length)),
      ),
      latestRun === undefined
        ? null
        : React.createElement(
            'label',
            { className: 'tfc-row', style: { gap: 6, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: overlay, onChange: (event) => setOverlay(event.target.checked) }),
            React.createElement('span', { className: 'tfc-caption' }, t('dag.runState') + ' · #' + latestRun.id.slice(-8)),
          ),
    ),
    layout !== null && layout.cyclic.length > 0 ? React.createElement('div', { className: 'tfc-warn' }, t('dag.cycle', { ids: layout.cyclic.join(', ') })) : null,
    missing.length > 0 ? React.createElement('div', { className: 'tfc-warn' }, t('dag.missingDeps', { ids: missing.join('; ') })) : null,
    layout === null
      ? React.createElement(Empty, { label: t('dag.empty') })
      : React.createElement(DagCanvas, { layout, nodeStates, t, selectedId, onSelect: setSelectedId }),
    active === undefined
      ? null
      : React.createElement(
          'div',
          { className: 'tfc-card tfc-card-l2' },
          React.createElement('div', { className: 'tfc-label' }, active.name),
          React.createElement(KeyValues, {
            rows: [
              { label: t('workflows.field.description'), value: active.description },
              {
                label: t('dag.nodes'),
                value: active.nodes
                  .map((node) => node.id + (node.agent === '' ? '' : '(' + node.agent + ')') + (node.dependsOn.length === 0 ? ' [' + t('dag.noDep') + ']' : ' ← ' + node.dependsOn.join(',')))
                  .join('  |  '),
              },
            ],
          }),
        ),
  )
}

/** Tasks tab: kanban board plus a create/rework form. */
function TasksTab(props) {
  const t = props.t
  const state = props.state
  const draft = props.draft
  const setDraft = props.setDraft
  const byStatus = {}
  for (const task of state.tasks) {
    if (byStatus[task.status] === undefined) byStatus[task.status] = []
    byStatus[task.status].push(task)
  }
  const columns = TASK_COLUMNS.map((column) => {
    const items = byStatus[column.key] === undefined ? [] : byStatus[column.key]
    return React.createElement(
      'div',
      { key: column.key, className: 'tfc-col-item' },
      React.createElement(
        'div',
        { className: 'tfc-col-head' },
        React.createElement('span', { className: 'tfc-col-title', style: { color: toneColor(column.tone) } }, column.label),
        React.createElement('span', { className: 'tfc-count tfc-chip' }, String(items.length)),
      ),
      items.length === 0
        ? React.createElement('span', { className: 'tfc-caption' }, t('state.empty'))
        : items.map((task) =>
            React.createElement(
              'div',
              { key: task.id, className: 'tfc-mini', onClick: () => props.onOpenTask(task.id) },
              React.createElement('span', { className: 'tfc-item-title', style: { whiteSpace: 'normal' } }, task.requirement === '' ? task.id : task.requirement),
              React.createElement(
                'div',
                { className: 'tfc-row', style: { gap: 4 } },
                React.createElement(Chip, null, task.assignee === '' ? '—' : task.assignee),
                task.reviewer === '' ? null : React.createElement(Chip, null, 'rev:' + task.reviewer),
                React.createElement(Chip, null, t('tasks.iteration', { n: task.iteration })),
                task.steps.length === 0 ? null : React.createElement(Chip, null, t('tasks.steps', { count: task.steps.length })),
              ),
            ),
          ),
    )
  })
  const detail = draft.kind === 'task' ? draft : null
  const agents = state.agents.map((agent) => ({ value: agent.name === '' ? agent.id : agent.name, label: agent.name === '' ? agent.id : agent.name }))
  return React.createElement(
    'div',
    { className: 'tfc-col' },
    state.tasks.length === 0 ? React.createElement(Empty, { label: t('tasks.empty') }) : null,
    React.createElement('div', { className: 'tfc-board' }, columns),
    detail === null
      ? null
      : React.createElement(
          Modal,
          { open: true, title: detail.id === '' ? t('tasks.new') : t('action.detail'), onClose: () => setDraft(null) },
          React.createElement(
            Field,
            { label: t('tasks.field.assignee') },
            React.createElement(Select, {
              value: detail.assignee,
              onChange: (value) => setDraft(Object.assign({}, detail, { assignee: value })),
              placeholder: t('tasks.field.unassigned'),
              options: agents,
            }),
          ),
          React.createElement(Field, { label: t('tasks.field.requirement') }, React.createElement(TextArea, { rows: 3, value: detail.requirement, onChange: (value) => setDraft(Object.assign({}, detail, { requirement: value })) })),
          React.createElement(Field, { label: t('tasks.field.acceptance') }, React.createElement(TextArea, { rows: 3, value: detail.acceptanceCriteria, onChange: (value) => setDraft(Object.assign({}, detail, { acceptanceCriteria: value })) })),
          React.createElement(
            Field,
            { label: t('tasks.field.reviewer') },
            React.createElement(Select, {
              value: detail.reviewer,
              onChange: (value) => setDraft(Object.assign({}, detail, { reviewer: value })),
              placeholder: t('tasks.field.none'),
              options: agents,
            }),
          ),
          detail.id === '' ? null : React.createElement(Field, { label: t('tasks.field.feedback') }, React.createElement(TextArea, { rows: 2, value: detail.feedback, onChange: (value) => setDraft(Object.assign({}, detail, { feedback: value })) })),
          detail.id === '' || detail.steps.length === 0
            ? null
            : React.createElement(
                'div',
                { className: 'tfc-card tfc-card-l2' },
                React.createElement('div', { className: 'tfc-label' }, t('runs.nodes')),
                detail.steps.map((step, index) =>
                  React.createElement(
                    'div',
                    { key: String(index), className: 'tfc-row' },
                    React.createElement(Chip, null, 'it' + String(step.iteration)),
                    React.createElement(Chip, null, step.status),
                    React.createElement('span', { className: 'tfc-caption' }, formatTime(step.at)),
                    React.createElement('span', { className: 'tfc-grow tfc-caption' }, step.feedback),
                  ),
                ),
              ),
          React.createElement(
            'div',
            { className: 'tfc-modal-actions' },
            React.createElement(Button, { variant: 'ghost', onClick: () => setDraft(null) }, t('action.cancel')),
            detail.id === ''
              ? React.createElement(Button, { variant: 'primary', disabled: detail.requirement.trim() === '', onClick: props.onCreate }, t('action.create'))
              : React.createElement(Button, { variant: 'primary', disabled: detail.feedback.trim() === '', onClick: props.onRework }, t('action.rework')),
          ),
        ),
  )
}

/** Runs tab: list with an expandable node-level detail. */
function RunsTab(props) {
  const t = props.t
  const state = props.state
  const store = props.store
  const [expanded, setExpanded] = React.useState(null)
  if (state.runs.length === 0) return React.createElement(Empty, { label: t('runs.empty') })
  const runs = store.newestRuns(50)
  return React.createElement(
    'div',
    { className: 'tfc-col' },
    runs.map((run) => {
      const isOpen = expanded === run.id
      return React.createElement(
        'div',
        { key: run.id, className: 'tfc-card' },
        React.createElement(
          'div',
          { className: 'tfc-row-between' },
          React.createElement(
            'div',
            { className: 'tfc-item-main', style: { cursor: 'pointer' }, onClick: () => setExpanded(isOpen ? null : run.id) },
            React.createElement('span', { className: 'tfc-item-title' }, '#' + run.id.slice(-8) + '  ' + (run.workflowId || '—')),
            React.createElement('span', { className: 'tfc-item-sub' }, formatTime(run.startedAt) + ' · ' + formatDuration(run.startedAt, run.endedAt)),
          ),
          React.createElement('div', { style: { width: 90 } }, React.createElement(ProgressBar, { percent: store.runProgress(run) })),
          React.createElement(StatusBadge, { table: RUN_STATUSES, status: run.status }),
          React.createElement(Button, { variant: 'ghost', onClick: () => setExpanded(isOpen ? null : run.id) }, isOpen ? t('action.close') : t('action.detail')),
        ),
        isOpen
          ? React.createElement(
              'div',
              { className: 'tfc-col', style: { marginTop: 8 } },
              React.createElement(KeyValues, {
                rows: [
                  { label: t('runs.field.workflow'), value: run.workflowId },
                  { label: t('runs.field.started'), value: formatTime(run.startedAt) },
                  { label: t('runs.field.ended'), value: run.endedAt === 0 ? t('runs.live') : formatTime(run.endedAt) },
                  { label: t('runs.field.duration'), value: formatDuration(run.startedAt, run.endedAt) },
                  { label: t('runs.summary'), value: run.summary },
                ],
              }),
              React.createElement(
                'div',
                { className: 'tfc-node-list' },
                run.nodes.length === 0
                  ? React.createElement(Empty, { label: t('state.empty') })
                  : run.nodes.map((node) =>
                      React.createElement(
                        'div',
                        { key: node.id, className: 'tfc-card tfc-card-l2' },
                        React.createElement(
                          'div',
                          { className: 'tfc-row-between' },
                          React.createElement('span', { className: 'tfc-item-title' }, node.id),
                          React.createElement(StatusBadge, { table: NODE_STATUSES, status: node.status }),
                        ),
                        React.createElement(
                          'div',
                          { className: 'tfc-row', style: { marginTop: 4 } },
                          React.createElement(Chip, { title: 'agent' }, node.assignee === '' ? '—' : node.assignee),
                          node.tools === '' ? null : React.createElement(Chip, { title: t('runs.field.tools') }, node.tools),
                        ),
                        node.output === '' ? null : React.createElement('pre', { className: 'tfc-pre', style: { marginTop: 6 } }, node.output),
                        node.error === '' ? null : React.createElement('div', { className: 'tfc-error', style: { marginTop: 6 } }, node.error),
                      ),
                    ),
              ),
            )
          : null,
      )
    }),
  )
}

/**
 * The Settings section page.
 *
 * @param props - the slot's owner props (`{ close }`); nothing else is required.
 * @returns the page element.
 */
export function TeamSettingsSection(props) {
  const store = useStore()
  const state = useTeamState()
  const t = useTranslate(props.locale)
  const refresh = usePolling(POLL_INTERVAL_MS)
  const [tab, setTab] = React.useState('overview')
  const [draft, setDraft] = React.useState(null)
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [dagWorkflowId, setDagWorkflowId] = React.useState('')

  const confirmDelete = (message) => {
    if (typeof globalThis.confirm !== 'function') return true
    return globalThis.confirm(message)
  }

  /** Parse the workflow editor's JSON node text; `''` means valid. */
  const nodesError = React.useMemo(() => {
    if (draft === null || draft.kind !== 'workflow') return ''
    const text = draft.nodesText.trim()
    if (text === '') return ''
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return t('workflows.nodesInvalid')
      return ''
    } catch (error) {
      return String(error.message)
    }
  }, [draft, t])

  /**
   * Build a task draft. With an id, the live record is copied in (and the
   * mutable `feedback` field starts empty); without one, an empty create draft.
   */
  const taskDraft = (id) => {
    if (typeof id !== 'string' || id === '') return emptyTaskDraft()
    const found = state.tasks.filter((task) => task.id === id)[0]
    if (found === undefined) return emptyTaskDraft()
    return {
      kind: 'task',
      id: found.id,
      assignee: found.assignee,
      reviewer: found.reviewer,
      requirement: found.requirement,
      acceptanceCriteria: found.acceptanceCriteria,
      feedback: '',
      steps: found.steps,
    }
  }

  const saveAgent = async () => {
    const definition = {
      id: draft.id,
      name: draft.name.trim(),
      role: draft.role.trim(),
      systemPrompt: draft.systemPrompt,
      skills: splitList(draft.skills),
      tools: { allow: splitList(draft.allow), deny: splitList(draft.deny) },
    }
    if (draft.provider.trim() !== '' || draft.model.trim() !== '') {
      definition.model = { provider: draft.provider.trim() === '' ? 'deepseek' : draft.provider.trim(), model: draft.model.trim() === '' ? 'deepseek-chat' : draft.model.trim() }
    }
    const result = await store.actions.saveAgent(definition)
    if (result.ok) {
      setDraft(null)
      setNotice('')
    }
  }

  const saveWorkflow = async () => {
    if (nodesError !== '') return
    const text = draft.nodesText.trim()
    const result = await store.actions.saveWorkflow({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description,
      nodes: text === '' ? {} : JSON.parse(text),
    })
    if (result.ok) setDraft(null)
  }

  const createTask = async () => {
    const result = await store.actions.createTask({
      assignee: draft.assignee,
      reviewer: draft.reviewer,
      requirement: draft.requirement,
      acceptanceCriteria: draft.acceptanceCriteria,
    })
    if (result.ok) setDraft(null)
  }

  const reworkTask = async () => {
    const result = await store.actions.reworkTask(draft.id, draft.feedback)
    if (result.ok) setDraft(null)
  }

  const runWorkflow = async (workflowId) => {
    setBusy(true)
    setNotice('')
    const result = await store.actions.startRun(workflowId)
    setBusy(false)
    setTab('runs')
    if (result.ok) {
      const started = result.value
      setNotice(t('workflows.started', { id: started === undefined || started === null || started.id === undefined ? '' : String(started.id).slice(-8) }))
    }
  }

  if (store === undefined || store === null) {
    return React.createElement('div', { className: 'tfc-root' }, React.createElement(Empty, { label: t('state.error') }))
  }

  const errorKey = Object.keys(state.errors)[0]
  const toolbar = React.createElement(
    'div',
    { className: 'tfc-row' },
    React.createElement(Button, { onClick: refresh, disabled: state.refreshing }, state.refreshing ? t('action.refreshing') : t('action.refresh')),
    React.createElement(
      Button,
      {
        variant: 'primary',
        onClick: () =>
          setDraft({
            kind: 'agent',
            id: '',
            name: '',
            role: '',
            systemPrompt: '',
            provider: '',
            model: '',
            skills: '',
            allow: '',
            deny: '',
          }),
      },
      '+ ' + t('agents.new'),
    ),
    React.createElement(
      Button,
      {
        onClick: () =>
          setDraft({
            kind: 'workflow',
            id: '',
            name: '',
            description: '',
            nodesText: '{\n  "plan": { "agent": "", "dependsOn": [], "taskTemplate": { "requirement": "" } },\n  "build": { "agent": "", "dependsOn": ["plan"], "taskTemplate": { "requirement": "" } }\n}',
          }),
      },
      '+ ' + t('workflows.new'),
    ),
    React.createElement(
      Button,
      { onClick: () => setDraft(emptyTaskDraft()) },
      '+ ' + t('tasks.new'),
    ),
  )

  let body
  if (state.loading && state.lastLoadedAt === 0) body = React.createElement(Loading, { label: t('state.loading') })
  else if (tab === 'overview') body = React.createElement(OverviewTab, { t, state, store, onOpenRun: () => setTab('runs') })
  else if (tab === 'agents') body = React.createElement(AgentsTab, { t, state, draft: draft === null ? {} : draft, setDraft, confirmDelete, onDelete: (id) => store.actions.deleteAgent(id), onSave: saveAgent })
  else if (tab === 'workflows')
    body = React.createElement(WorkflowsTab, {
      t,
      state,
      draft: draft === null ? {} : draft,
      setDraft,
      nodesError,
      busy,
      confirmDelete,
      onDelete: (id) => store.actions.deleteWorkflow(id),
      onSave: saveWorkflow,
      onRun: runWorkflow,
      onShowDag: (id) => {
        setDagWorkflowId(id)
        setTab('dag')
      },
    })
  else if (tab === 'dag') body = React.createElement(DagTab, { t, state, initialWorkflowId: dagWorkflowId })
  else if (tab === 'tasks')
    body = React.createElement(TasksTab, {
      t,
      state,
      draft: draft === null ? {} : draft,
      setDraft,
      onOpenTask: (id) => setDraft(taskDraft(id)),
      onCreate: createTask,
      onRework: reworkTask,
    })
  else body = React.createElement(RunsTab, { t, state, store })

  return React.createElement(
    'div',
    { className: 'tfc-root' },
    React.createElement(
      'div',
      { className: 'tfc-row-between' },
      React.createElement(
        'div',
        { className: 'tfc-col' },
        React.createElement('h3', { className: 'tfc-title' }, t('overview.title')),
        React.createElement('p', { className: 'tfc-subtitle' }, t('overview.subtitle')),
      ),
      toolbar,
    ),
    React.createElement(Tabs, { tabs: SECTION_TABS, active: tab, onSelect: setTab, t }),
    notice === '' ? null : React.createElement('div', { className: 'tfc-notice' }, notice),
    errorKey === undefined ? null : React.createElement(ErrorBanner, { label: t('state.error'), message: state.errors[errorKey], onRetry: refresh, retryLabel: t('action.retry') }),
    body,
  )
}
