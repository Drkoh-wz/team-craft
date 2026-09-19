// HTTP client for the host half.
//
// The host is a COMPOSED cordis bundle, so there is no `harness.handle` /
// `host.call` private channel: data crosses as JSON over the WebServer routes
// registered under `/api/team-flowise`. This module is the only place that knows
// that, and the only place that touches `fetch`.
import { API_BASE, routeUrl, ROUTES } from '../contract/routes.js'

/** Default per-request ceiling. A hung request must surface as an error, not a spinner. */
export const REQUEST_TIMEOUT_MS = 15000

/** Build a `{ status, code }` error with a message the UI can show verbatim. */
function apiError(message, extra) {
  const error = new Error(message)
  error.name = 'TeamApiError'
  if (extra !== undefined) {
    if (extra.status !== undefined) error.status = extra.status
    if (extra.code !== undefined) error.code = extra.code
  }
  return error
}

/** Human-readable text for any thrown value. */
export function describeError(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message !== '') return error.message
  return String(error)
}

/**
 * Create a host API client.
 *
 * @param options - optional overrides:
 *   `base` (default {@link API_BASE}), `timeoutMs`, and `fetch` (injected for tests).
 * @returns `{ request, getJson, ping, listAgents, upsertAgent, deleteAgent, ... }`.
 * @throws when no fetch implementation is reachable.
 */
export function createTeamApi(options) {
  const config = options === undefined || options === null ? {} : options
  const base = typeof config.base === 'string' && config.base !== '' ? config.base : API_BASE
  const timeoutMs = typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs : REQUEST_TIMEOUT_MS
  const fetchImpl = config.fetch !== undefined ? config.fetch : globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw apiError('team-flowise: no fetch implementation available in this environment')
  }

  /** Absolute URL from a route id and query, honouring a non-default base. */
  const url = (id, query) => {
    const path = routeUrl(id, query)
    if (path === undefined) throw apiError('team-flowise: unknown route id "' + String(id) + '"')
    return base === API_BASE ? path : base + path.slice(API_BASE.length)
  }

  /**
   * One request. The response body is parsed as JSON; the `{ ok, error }`
   * envelope the host writes for failures is unwrapped into a thrown error so
   * callers never branch on a payload shape.
   *
   * @param routeId - id from {@link ROUTES}.
   * @param init - optional `method` and `body` (JSON-serialised here).
   * @param query - optional query pairs.
   * @returns the parsed payload.
   */
  const request = async (routeId, init, query) => {
    const method = init !== undefined && typeof init.method === 'string' ? init.method : 'GET'
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined
    let timer
    if (controller !== undefined) timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(url(routeId, query), {
        method,
        headers: init !== undefined && init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: init !== undefined && init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller === undefined ? undefined : controller.signal,
      })
    } catch (error) {
      if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
        throw apiError('team-flowise: request timed out after ' + timeoutMs + 'ms (' + routeId + ')', { code: 'timeout' })
      }
      throw apiError('team-flowise: request failed (' + routeId + '): ' + describeError(error), { code: 'network' })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    let payload
    const text = await response.text()
    if (text !== '') {
      try {
        payload = JSON.parse(text)
      } catch {
        throw apiError('team-flowise: ' + routeId + ' returned a non-JSON body', { status: response.status, code: 'bad-json' })
      }
    }
    if (!response.ok) {
      const detail = payload !== null && typeof payload === 'object' && typeof payload.error === 'string' ? ': ' + payload.error : ''
      throw apiError('team-flowise: ' + routeId + ' failed with HTTP ' + String(response.status) + detail, {
        status: response.status,
        code: 'http',
      })
    }
    if (payload !== null && typeof payload === 'object' && payload.ok === false) {
      throw apiError('team-flowise: ' + routeId + ' refused: ' + String(payload.error === undefined ? 'unknown' : payload.error), { code: 'refused' })
    }
    return payload
  }

  /** First array found under `key`, else an empty array. Keeps a bad payload from crashing a tab. */
  const arrayAt = (payload, key) => (payload !== null && typeof payload === 'object' && Array.isArray(payload[key]) ? payload[key] : [])

  return {
    base,
    timeoutMs,
    request,
    url,
    routes: ROUTES,
    ping: () => request('ping'),
    listAgents: async () => arrayAt(await request('agents.list'), 'agents'),
    upsertAgent: async (definition) => {
      const payload = await request('agents.upsert', { method: 'POST', body: definition })
      return payload !== null && typeof payload === 'object' ? payload.agent : undefined
    },
    deleteAgent: (id) => request('agents.delete', { method: 'DELETE' }, { id }),
    listWorkflows: async () => arrayAt(await request('workflows.list'), 'workflows'),
    upsertWorkflow: async (definition) => {
      const payload = await request('workflows.upsert', { method: 'POST', body: definition })
      return payload !== null && typeof payload === 'object' ? payload.workflow : undefined
    },
    deleteWorkflow: (id) => request('workflows.delete', { method: 'DELETE' }, { id }),
    listTasks: async () => arrayAt(await request('tasks.list'), 'tasks'),
    createTask: async (spec) => {
      const payload = await request('tasks.create', { method: 'POST', body: spec })
      return payload !== null && typeof payload === 'object' ? payload.task : undefined
    },
    reworkTask: async (id, feedback) => {
      const payload = await request('tasks.rework', { method: 'POST', body: { id, feedback } })
      return payload !== null && typeof payload === 'object' ? payload.task : undefined
    },
    listRuns: async () => arrayAt(await request('runs.list'), 'runs'),
    getRun: async (id) => {
      const payload = await request('runs.get', undefined, { id })
      return payload !== null && typeof payload === 'object' ? payload.run : undefined
    },
    startRun: async (workflowId, input) => {
      const payload = await request('runs.start', { method: 'POST', body: { workflowId, input: input === undefined ? {} : input } })
      return payload !== null && typeof payload === 'object' ? payload.run : undefined
    },
  }
}
