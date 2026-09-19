// Node half of @local/team-flowise-client.
//
// What this is for: the browser half is a factory-registration script that only
// runs inside the DSH web shell, so nothing about it can be imported, type
// checked, or asserted in Node. This entry re-exports the parts that are
// genuinely environment-independent — the frozen HTTP route table, the record
// reducers, the DAG layout solver, and the slot contribution descriptors — so an
// operator (or a test) can load the package in bare Node and inspect the
// client contract without a browser.
//
// It imports nothing, so `import('@local/team-flowise-client')` cannot fail on a
// missing peer.

export { API_BASE, DOMAINS, ROUTES, ROUTE_NOT_FOUND, matchRoute, routeUrl } from '../contract/routes.js'
export {
  TASK_COLUMNS,
  RUN_STATUSES,
  NODE_STATUSES,
  TONE_VARS,
  SECTION_TABS,
  statusEntry,
  pickAgent,
  pickWorkflow,
  pickTask,
  pickRun,
  runProgress,
} from '../contract/domain.js'
export { LAYOUT, topologicalOrder, layoutDag, decorateDag } from '../contract/layout.js'
export {
  SLOT_KINDS,
  SETTINGS_SECTION,
  SESSION_HEADER_ACTION,
  CONTRIBUTIONS,
  LOCALE_NAMESPACE,
} from '../contract/panels.js'

import { ROUTES } from '../contract/routes.js'
import { SECTION_TABS } from '../contract/domain.js'
import { CONTRIBUTIONS, LOCALE_NAMESPACE } from '../contract/panels.js'

/**
 * A JSON-safe snapshot of everything this package contributes.
 *
 * Deliberately built by hand rather than by spreading its sources: the result is
 * written to logs and asserted in tests, so it must never carry a live object.
 *
 * @returns `{ name, clientId, localeNamespace, apiBase, routes, tabs, contributions }`
 *   where every value is a string, number, or array of those.
 */
export function describeClient() {
  return {
    name: '@local/team-flowise-client',
    clientId: '@local/team-flowise-client',
    localeNamespace: LOCALE_NAMESPACE,
    apiBase: '/api/team-flowise',
    routes: ROUTES.map((route) => ({ id: route.id, method: route.method, path: route.path })),
    tabs: SECTION_TABS.map((tab) => ({ key: tab.key, label: tab.label })),
    contributions: CONTRIBUTIONS.map((entry) => ({
      slot: entry.slot,
      kind: entry.kind,
      id: entry.id,
      order: entry.order,
      label: entry.label,
    })),
  }
}
