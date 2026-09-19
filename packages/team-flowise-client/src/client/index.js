// Browser half of @local/team-flowise-client.
//
// The bundle is a factory registration, not an ES module: the client module
// system installs `window.__ModuleLoader__` as a lazy CJS table and materializes
// this factory on first import (see tsdown.config.mjs for the wrapper). What the
// factory must return is a cordis plugin face — `{ name, inject, apply }`.
//
// Optional services are read with `ctx.get(...)` and guarded; nothing here
// declares a hard `inject` on a service the settings section does not need, so a
// shell without the locale service still mounts the team surfaces.
import * as React from 'react'
import { LOCALE_NAMESPACE, SESSION_HEADER_ACTION, SETTINGS_SECTION } from '../contract/panels.js'
import { DICTIONARIES } from './locales.js'
import { createTeamStore } from './store.js'
import { injectStyles } from './styles.js'
import { TeamProvider } from './context.js'
import { TeamSettingsSection } from './components/settings-section.js'
import { TeamActivityAction } from './components/activity-panel.js'

/** Locale namespaces this package answers for. */
export const inject = ['slots']

// Re-exported for tests and for the Node half's inspection story: the store is the
// one piece of this package that can be driven without a browser (it takes an
// injected `fetch` and `api`), and it is what actually loads the host data. The
// browser bundle's factory face is unaffected — `apply` still creates its own
// store; this only makes the same constructor reachable from the built artifact.
export { createTeamStore } from './store.js'

/**
 * Wrap a surface so it renders inside the store provider.
 *
 * `React.createElement` and not JSX: the client half is delivered to the browser
 * verbatim, with no JSX or TypeScript transform in the pipeline.
 *
 * @param store - the store created by {@link apply}.
 * @param Surface - the component to wrap.
 * @returns a component with no required props of its own.
 */
function withStore(store, Surface) {
  return function TeamSurface(props) {
    return React.createElement(TeamProvider, { store }, React.createElement(Surface, props))
  }
}

/**
 * Register the package's three surfaces.
 *
 * Effects are declared with `ctx.effect(...)` and slot registrations happen
 * inside `slots.inject(...)`, so stopping or updating the plugin removes the
 * stylesheet, both slot entries, and the polling store together.
 *
 * @param ctx - the client root context.
 */
export function apply(ctx) {
  if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') return

  // Stylesheet first: `injectStyles` is a no-op when an earlier activation
  // already left the tag in place, so a re-apply cannot stack duplicate rules.
  ctx.effect(() => injectStyles(), 'team-flowise-client: stylesheet')

  const locale = ctx.get('locale')
  if (locale !== undefined && locale !== null && typeof locale.register === 'function') {
    try {
      ctx.effect(() => locale.register(LOCALE_NAMESPACE, DICTIONARIES), 'team-flowise-client: dictionaries')
    } catch (error) {
      // A locale service that rejects the namespace must not cost the user the
      // settings page; the dictionaries are only a translation nicety.
      if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') ctx.logger.warn(error)
    }
  }

  const slots = ctx.get('slots')
  if (slots === undefined || slots === null || typeof slots.register !== 'function') return

  const store = createTeamStore()

  slots.inject(SETTINGS_SECTION.slot, () =>
    slots.register(
      {
        name: SETTINGS_SECTION.slot,
        id: SETTINGS_SECTION.id,
        order: SETTINGS_SECTION.order,
        label: SETTINGS_SECTION.label,
      },
      withStore(store, TeamSettingsSection),
    ),
  )

  slots.inject(SESSION_HEADER_ACTION.slot, () =>
    slots.register(
      {
        name: SESSION_HEADER_ACTION.slot,
        id: SESSION_HEADER_ACTION.id,
        order: SESSION_HEADER_ACTION.order,
        label: SESSION_HEADER_ACTION.label,
      },
      withStore(store, TeamActivityAction),
    ),
  )
}
