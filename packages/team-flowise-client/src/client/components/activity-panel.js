// The session-header team activity panel.
//
// Registered into `conversation.session.header.actions` — a list slot beside the
// per-Session title. The shell lays entries out in a row, so the contribution is
// a single compact trigger button that opens its own popover on click; it never
// claims header width while idle.
import * as React from 'react'
import { RUN_STATUSES, TASK_COLUMNS } from '../../contract/domain.js'
import { usePolling, useStore, useTeamState, useTranslate } from '../context.js'
import { POLL_INTERVAL_MS } from '../store.js'
import { Button, Chip, Empty, ProgressBar, StatusBadge, formatTime } from '../ui.js'

/** A headline for the panel, derived only from counts. */
function summarize(t, live, open, blocked) {
  const parts = [t('activity.liveRuns', { count: live })]
  if (open > 0) parts.push(t('activity.openTasks', { count: open }))
  if (blocked > 0) parts.push(t('activity.blockedTasks', { count: blocked }))
  return parts.join(' · ')
}

/**
 * The header activity contribution.
 *
 * @param props - the slot's standard Session props; only `locale` is read, and
 *   it is optional (the store falls back to its default dictionary).
 * @returns the trigger element with its popover.
 */
export function TeamActivityAction(props) {
  const store = useStore()
  const state = useTeamState()
  const t = useTranslate(props === undefined ? undefined : props.locale)
  usePolling(POLL_INTERVAL_MS)
  const [open, setOpen] = React.useState(false)

  const rootRef = React.useRef(null)

  React.useEffect(() => {
    if (!open) return undefined
    if (typeof document === 'undefined') return undefined
    const onPointerDown = (event) => {
      const root = rootRef.current
      if (root === null || root === undefined) return
      if (typeof root.contains === 'function' && root.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (store === undefined || store === null) return null

  const live = store.liveRunCount()
  const openTasks = store.openTaskCount()
  let blocked = 0
  for (const task of state.tasks) if (task.status === 'reworked') blocked += 1
  const runs = store.newestRuns(6)
  const tasks = store
    .newestTasks(6)
    .filter((task) => task.status !== 'settle')

  const trigger = React.createElement(
    'button',
    {
      type: 'button',
      className: 'tfc-trigger' + (open || live > 0 ? ' tfc-trigger-on' : ''),
      title: summarize(t, live, openTasks, blocked),
      'aria-label': t('activity.aria'),
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
    React.createElement('span', { className: 'tfc-dot', style: { color: live > 0 ? 'var(--dsw-alias-state-business-primary, #175cd3)' : 'currentColor' } }),
    React.createElement('span', null, t('activity.trigger')),
    live > 0 || openTasks > 0 ? React.createElement('span', { className: 'tfc-chip' }, String(live + openTasks)) : null,
  )

  const panel = !open
    ? null
    : React.createElement(
        'div',
        { className: 'tfc-panel', role: 'dialog', 'aria-label': t('activity.title') },
        React.createElement(
          'div',
          { className: 'tfc-panel-head' },
          React.createElement('span', { className: 'tfc-item-title' }, t('activity.title')),
          React.createElement(Button, { variant: 'ghost', onClick: () => store.refresh() }, t('action.refresh')),
        ),
        React.createElement('div', { className: 'tfc-caption', style: { padding: '0 8px' } }, summarize(t, live, openTasks, blocked)),
        runs.length === 0 && tasks.length === 0
          ? React.createElement(Empty, { label: t('activity.empty') })
          : null,
        runs.map((run) =>
          React.createElement(
            'div',
            { key: 'run-' + run.id, className: 'tfc-panel-row' },
            React.createElement('div', { className: 'tfc-item-main' },
              React.createElement('span', { className: 'tfc-item-title' }, '#' + run.id.slice(-8) + ' · ' + (run.workflowId || '—')),
              React.createElement('span', { className: 'tfc-item-sub' }, formatTime(run.startedAt)),
            ),
            React.createElement('div', { style: { width: 56 } }, React.createElement(ProgressBar, { percent: store.runProgress(run) })),
            React.createElement(StatusBadge, { table: RUN_STATUSES, status: run.status }),
          ),
        ),
        tasks.length === 0
          ? null
          : React.createElement(
              'div',
              { className: 'tfc-col', style: { padding: '0 4px' } },
              tasks.map((task) =>
                React.createElement(
                  'div',
                  { key: 'task-' + task.id, className: 'tfc-panel-row' },
                  React.createElement('div', { className: 'tfc-item-main' },
                    React.createElement('span', { className: 'tfc-item-title' }, task.requirement === '' ? task.id : task.requirement),
                    React.createElement('span', { className: 'tfc-item-sub' }, (task.assignee || '—') + ' · ' + t('tasks.iteration', { n: task.iteration })),
                  ),
                  React.createElement(StatusBadge, { table: TASK_COLUMNS, status: task.status }),
                ),
              ),
            ),
        React.createElement(
          'div',
          { className: 'tfc-panel-head' },
          React.createElement('span', { className: 'tfc-caption' }, t('activity.openSettings')),
          React.createElement(Chip, null, 'settings.section: team-flowise'),
        ),
      )

  return React.createElement('div', { ref: rootRef, style: { position: 'relative' } }, trigger, panel)
}
