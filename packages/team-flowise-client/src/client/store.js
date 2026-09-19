// Shared, module-scoped team data store.
//
// Two surfaces in different corners of the React tree need the same data: the
// Settings section page and the session-header activity panel. The client module
// system materializes a package's factory once per page, so a module-level store
// is genuinely shared by both — which is why the polling lives here and not in a
// component. A snapshot is cached and only replaced when something actually
// changed, so `useSyncExternalStore` never sees a spurious new reference.
import { SECTION_TABS } from '../contract/domain.js'
import { DOMAINS } from '../contract/routes.js'
import { createTeamApi, describeError } from './api.js'
import { createTranslator, DICTIONARIES } from './locales.js'
import { pickAgent, pickRun, pickTask, pickWorkflow, runProgress } from '../contract/domain.js'

/** In-flight ceiling. The host answers quickly; a long poll interval is enough. */
export const POLL_INTERVAL_MS = 6000

/** The four slices, in load order. */
export const SLICE_NAMES = ['agents', 'workflows', 'tasks', 'runs']

/** Initial state: no data, no error, not loading. */
export function emptyState() {
  return {
    agents: [],
    workflows: [],
    tasks: [],
    runs: [],
    loading: false,
    refreshing: false,
    errors: {},
    health: 'unknown',
    domains: [],
    lastLoadedAt: 0,
    revision: 0,
  }
}

/**
 * Reduce a raw payload list to display records.
 *
 * @param list - raw array from the API.
 * @param pick - one of the `pick*` reducers.
 * @returns display records; entries that are not objects are dropped.
 */
export function reduceList(list, pick) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const picked = pick(item)
    if (picked !== null) out.push(picked)
  }
  return out
}

/** Count the tasks the host still considers open (everything before `settle`). */
export function openTaskCount(tasks) {
  let count = 0
  for (const task of tasks) if (task.status !== 'settle') count += 1
  return count
}

/** Count the runs the host is still driving. */
export function liveRunCount(runs) {
  let count = 0
  for (const run of runs) if (run.status === 'running') count += 1
  return count
}

/** Newest-first copy, by `startedAt`/`createdAt`, without mutating the input. */
export function newestFirst(list, field) {
  return list.slice().sort((a, b) => (b[field] || 0) - (a[field] || 0))
}

/**
 * Create a store. One instance is created per module materialization.
 *
 * @param options - `{ api, fetch }`; `api` defaults to a real HTTP client and
 *   `fetch` is forwarded to it (injected in tests).
 * @returns the store handle.
 */
export function createTeamStore(options) {
  const config = options === undefined || options === null ? {} : options
  const api = config.api !== undefined ? config.api : createTeamApi({ fetch: config.fetch })
  let state = emptyState()
  const listeners = new Set()
  const t = createTranslator(DICTIONARIES, 'zh')

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // A surface that throws while re-rendering must not break the others.
      }
    }
  }

  /** Replace state and notify, but only when `next` is a different object. */
  const commit = (next) => {
    if (next === state) return
    state = next
    notify()
  }

  /** Patch one slice of state. */
  const patch = (partial) => {
    commit(Object.assign({}, state, partial, { revision: state.revision + 1 }))
  }

  const recordError = (key, error) => {
    const errors = Object.assign({}, state.errors)
    errors[key] = describeError(error)
    return errors
  }

  /**
   * Reload every slice. Concurrent calls collapse onto the first one, so a poll
   * tick and a user click cannot double-fetch.
   *
   * @returns a promise settling when the refresh finished.
   */
  let inFlight = null
  const refresh = () => {
    if (inFlight !== null) return inFlight
    patch({ loading: state.lastLoadedAt === 0, refreshing: state.lastLoadedAt !== 0 })
    inFlight = Promise.all([
      api.listAgents(),
      api.listWorkflows(),
      api.listTasks(),
      api.listRuns(),
    ])
      .then(([agents, workflows, tasks, runs]) =>
        patch({
          agents: reduceList(agents, pickAgent),
          workflows: reduceList(workflows, pickWorkflow),
          tasks: reduceList(tasks, pickTask),
          runs: reduceList(runs, pickRun),
          errors: {},
          health: 'ok',
          domains: DOMAINS.slice(),
          lastLoadedAt: Date.now(),
          loading: false,
          refreshing: false,
        }),
      )
      .catch((error) => {
        patch({
          errors: recordError('all', error),
          health: 'down',
          loading: false,
          refreshing: false,
        })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  /**
   * Run one write, then reload. The error is returned instead of thrown so a
   * component can render it without its own try/catch.
   *
   * @param key - slice name used as the error key.
   * @param action - the write to perform.
   * @returns `{ ok, error? }`.
   */
  const mutate = async (key, action) => {
    patch({ loading: true })
    try {
      const value = await action()
      await refresh()
      return { ok: true, value }
    } catch (error) {
      patch({ errors: recordError(key, error), loading: false, refreshing: false })
      return { ok: false, error: describeError(error) }
    }
  }

  /** Find a record by id in one slice. */
  const find = (slice, id) => {
    for (const item of state[slice]) if (item.id === id) return item
    return undefined
  }

  /** A static DAG view of one workflow, for the canvas. */
  const workflowById = (id) => find('workflows', id)

  return {
    api,
    t,
    /** A translator for another locale, sharing this store's dictionary table. */
    translatorFor: (locale) => createTranslator(DICTIONARIES, locale),
    tabs: SECTION_TABS,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => state,
    refresh,
    mutate,
    find,
    workflowById,
    runProgress,
    liveRunCount: () => liveRunCount(state.runs),
    openTaskCount: () => openTaskCount(state.tasks),
    newestRuns: (limit) => newestFirst(state.runs, 'startedAt').slice(0, limit === undefined ? 5 : limit),
    newestTasks: (limit) => newestFirst(state.tasks, 'updatedAt').slice(0, limit === undefined ? 5 : limit),
    actions: {
      saveAgent: (definition) => mutate('agent', () => api.upsertAgent(definition)),
      deleteAgent: (id) => mutate('agent', () => api.deleteAgent(id)),
      saveWorkflow: (definition) => mutate('workflow', () => api.upsertWorkflow(definition)),
      deleteWorkflow: (id) => mutate('workflow', () => api.deleteWorkflow(id)),
      createTask: (spec) => mutate('task', () => api.createTask(spec)),
      reworkTask: (id, feedback) => mutate('task', () => api.reworkTask(id, feedback)),
      startRun: (workflowId, input) => mutate('run', () => api.startRun(workflowId, input)),
    },
  }
}
