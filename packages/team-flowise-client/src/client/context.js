// React wiring shared by every surface in this package.
//
// The store is reached through React context rather than a module import inside
// each component: the entry point owns the store's lifetime (it is created in
// `apply` and disposed with the fiber), and a component only ever reads it.
import * as React from 'react'

const TeamContext = React.createContext(null)

/**
 * Provide the store and translator to a surface's subtree.
 *
 * @param props - `{ store, children }`.
 * @returns the provider element.
 */
export function TeamProvider(props) {
  const store = props === undefined || props === null ? undefined : props.store
  const value = React.useMemo(() => ({ store, t: store === undefined || store === null ? undefined : store.t }), [store])
  const children = props === undefined || props === null ? undefined : props.children
  // `children` is the THIRD argument. Passing the whole `props` object here made
  // every surface render nothing: `TeamProvider` wrapped the page in a provider
  // whose child was a props bag, which is not a valid element.
  return React.createElement(TeamContext.Provider, { value }, children)
}

/**
 * Read the nearest store.
 *
 * The context value is `{ store, t }` — the provider carries the translator
 * alongside the store so a surface never has to build one. Every caller here
 * wants the STORE (it calls `getState`, `subscribe`, `refresh`), so this hook
 * unwraps it: returning the whole context value made `store.getState` a property
 * of a plain object, and the settings page threw on its first render.
 *
 * @returns the store, or `undefined` when rendered outside a provider.
 */
export function useStore() {
  const value = React.useContext(TeamContext)
  return value === undefined || value === null ? undefined : value.store
}

/**
 * Subscribe to the store snapshot.
 *
 * @returns the current team state, or `undefined` outside a provider.
 */
export function useTeamState() {
  const store = useStore()
  const subscribe = React.useCallback(
    (listener) => (store === undefined || store === null ? () => {} : store.subscribe(listener)),
    [store],
  )
  const getSnapshot = React.useCallback(
    () => (store === undefined || store === null ? EMPTY_SNAPSHOT : store.getState()),
    [store],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Stable fallback snapshot, so `useSyncExternalStore` never returns a new object. */
const EMPTY_SNAPSHOT = {
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

/**
 * Translator bound to the active locale.
 *
 * @param locale - an optional locale observed from the shell; when absent, the
 *   store's default (Simplified Chinese) dictionary is used.
 * @returns `(key, params?) => string`.
 */
export function useTranslate(locale) {
  const store = useStore()
  return React.useMemo(() => {
    if (store === undefined || store === null) return (key) => String(key)
    if (typeof locale !== 'string' || locale === '' || locale.indexOf('zh') === 0) return store.t
    return store.translatorFor(locale)
  }, [store, locale])
}

/**
 * Load on mount, then poll while the surface is mounted.
 *
 * The returned `refresh` is the shared store refresh, so a manual click and a
 * poll tick cannot fetch twice.
 *
 * @param intervalMs - poll period; `0` disables polling.
 * @returns the shared `refresh` function.
 */
export function usePolling(intervalMs) {
  const store = useStore()
  const refresh = React.useCallback(
    () => (store === undefined || store === null ? Promise.resolve() : store.refresh()),
    [store],
  )
  React.useEffect(() => {
    if (store === undefined || store === null) return undefined
    refresh()
    if (intervalMs === undefined || intervalMs === null || intervalMs <= 0) return undefined
    if (typeof setInterval !== 'function') return undefined
    const id = setInterval(refresh, intervalMs)
    return () => {
      if (typeof clearInterval === 'function') clearInterval(id)
    }
  }, [store, refresh, intervalMs])
  return refresh
}
