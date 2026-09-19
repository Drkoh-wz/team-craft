// The frozen HTTP contract between this client half and the `@local/team-flowise`
// host half. Kept dependency-free and environment-free so the Node build, the
// browser build, and tests all read the same table.
//
// The host half is a COMPOSED cordis bundle, not a dynamic package sandbox, so
// there is no `harness`/`host.call` bridge available. Data crosses the boundary
// as JSON over the WebServer routes the host registers under `/api/team-flowise`
// (`@deepseek-ai/dsh-host-webserver`, injected as `webServer`).
//
// Every write route is loopback-fenced on the host side.

/** Route prefix owned by the host half. */
export const API_BASE = '/api/team-flowise'

/** The four durable storage domains the host opens. */
export const DOMAINS = ['team_agent_defs', 'team_ledger', 'team_workflows', 'team_runs']

/**
 * Full route table. `id` is the stable key the client calls by, so a path change
 * on the host is a one-line edit here instead of a hunt through components.
 */
export const ROUTES = [
  { id: 'ping', method: 'GET', path: '/ping', summary: 'Connectivity and the composed domain list.' },
  { id: 'agents.list', method: 'GET', path: '/agents', summary: 'Every stored Agent definition.' },
  { id: 'agents.upsert', method: 'POST', path: '/agent', summary: 'Create or update an Agent definition (body = definition).' },
  { id: 'agents.delete', method: 'DELETE', path: '/agent', summary: 'Delete an Agent definition (query: id).' },
  { id: 'workflows.list', method: 'GET', path: '/workflows', summary: 'Every stored workflow.' },
  { id: 'workflows.upsert', method: 'POST', path: '/workflow', summary: 'Create or update a workflow (body = definition).' },
  { id: 'workflows.delete', method: 'DELETE', path: '/workflow', summary: 'Delete a workflow (query: id).' },
  { id: 'tasks.list', method: 'GET', path: '/tasks', summary: 'Every task on the ledger.' },
  { id: 'tasks.create', method: 'POST', path: '/task/create', summary: 'Create a task by hand.' },
  { id: 'tasks.rework', method: 'POST', path: '/task/rework', summary: 'Send a task back for rework (body: { id, feedback }).' },
  { id: 'runs.list', method: 'GET', path: '/runs', summary: 'Every recorded run.' },
  { id: 'runs.get', method: 'GET', path: '/run', summary: 'One run, including per-node state (query: id).' },
  { id: 'runs.start', method: 'POST', path: '/run/start', summary: 'Start a run (body: { workflowId, input }). Answers as soon as the id exists.' },
]

/** Ambiguous or unknown: resolved by `matchRoute` when nothing matches. */
export const ROUTE_NOT_FOUND = { id: 'none', method: 'GET', path: '/', summary: 'No matching host route.' }

/**
 * Resolve the route a request uses.
 *
 * Exact (method, path) wins. A `HEAD` request resolves to the `GET` route for
 * the same path, mirroring what the host's WebServer route kinds accept.
 *
 * @param method - upper-case HTTP method.
 * @param path - path without the `/api/team-flowise` prefix.
 * @returns the matching route, or `ROUTE_NOT_FOUND`.
 */
export function matchRoute(method, path) {
  const want = typeof method === 'string' ? method.toUpperCase() : ''
  const effective = want === 'HEAD' ? 'GET' : want
  for (const route of ROUTES) {
    if (route.path === path && route.method === effective) return route
  }
  return ROUTE_NOT_FOUND
}

/**
 * Build the concrete request path for a route id, appending encoded query values.
 *
 * @param id - route id from {@link ROUTES}.
 * @param query - optional query pairs; `undefined`/`null` values are dropped.
 * @returns the path including {@link API_BASE}, or `undefined` for an unknown id.
 */
export function routeUrl(id, query) {
  let found
  for (const route of ROUTES) {
    if (route.id === id) {
      found = route
      break
    }
  }
  if (found === undefined) return undefined
  let url = API_BASE + found.path
  if (query !== undefined && query !== null) {
    const parts = []
    for (const key of Object.keys(query)) {
      const value = query[key]
      if (value === undefined || value === null || value === '') continue
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    }
    if (parts.length > 0) url += '?' + parts.join('&')
  }
  return url
}
