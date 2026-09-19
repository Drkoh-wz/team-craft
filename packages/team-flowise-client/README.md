# `@local/team-flowise-client`

Browser half of the Flowise-like multi-agent team plugin. It contributes three
surfaces to the DSH web shell and reads its data from the host half
(`@local/team-flowise`) over JSON HTTP routes.

| Surface | Slot | Registration |
| --- | --- | --- |
| Settings page (Overview / Agents / Workflows / DAG canvas / Tasks / Runs) | `settings.section` | `id: team-flowise`, `order: 500` |
| Session-header team activity panel | `conversation.session.header.actions` | `id: team-flowise-activity`, `order: 60` |
| Workflow DAG canvas | — (rendered inside the settings page's DAG tab) | — |

## Build

```powershell
npm install          # only tsdown is needed
npm run build        # tsdown -> dist/index.js (ESM, Node) + dist/client.js (DSH client bundle)
npm run verify       # executes both artifacts and asserts the contract
```

`npm run verify` is the acceptance check: it parses both artifacts, imports the
Node half, asserts the route table / record reducers / DAG geometry, then
**executes the browser bundle** against a stub `window.__ModuleLoader__` and a
stub `require` to prove the factory face is reachable and that `apply` registers
both slot cells.

## Why two outputs

The package has two halves that cannot share one module format.

- `dist/index.js` — plain ESM for Node. Imports nothing, so
  `import('@local/team-flowise-client')` cannot fail on a missing peer. It
  re-exports the environment-independent contract: the frozen route table
  (`ROUTES`, `matchRoute`, `routeUrl`), the record reducers (`pickAgent`,
  `pickWorkflow`, `pickTask`, `pickRun`), the DAG solver (`layoutDag`,
  `decorateDag`), the slot descriptors (`SETTINGS_SECTION`,
  `SESSION_HEADER_ACTION`), and `describeClient()` for an inspectable summary.
- `dist/client.js` — the DSH browser bundle. The client module system installs
  `window.__ModuleLoader__` as a **lazy CJS table**: a bundle only registers a
  factory, and materialization (`factory(require) -> exports`) happens on first
  import. The emitted script is therefore a classic script of exactly this shape:

  ```js
  window.__ModuleLoader__.load({
    id: "@local/team-flowise-client",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      /* rolldown's CJS chunk */
      return module.exports;
    },
  });
  ```

  `tsdown.config.mjs` produces that with a rolldown `renderChunk` plugin, so the
  wrapper is part of the chunk bytes rolldown writes and there is no
  post-processing step that could drift from the build.

  The browser half ships **without a source map**, deliberately. `renderChunk`
  runs before rolldown appends its `//# sourceMappingURL` trailer, so an enabled
  map ends up with the trailer inside the factory body, and the wrapper also
  shifts every line of the chunk map by a constant. A map that points at the
  wrong lines is worse than no map, so `sourcemap: false` and the bundle ends
  cleanly at the factory's closing `});`.

React and the shell's shared packages (`react-dom`, `@deepseek-ai/dsh-client-ui-slots`,
`@deepseek-ai/dsh-client-ui-primitives`, …) stay **external**: they are platform
seeds the shell injects into `require`, so bundling a second copy would split
React's instance identity. `dsh.client.external` is intentionally empty — every
needed name is in the seed table, and naming a package that is not in the graph
only makes graph ordering harder to reason about.

## Data flow

There is no `harness.handle` / `host.call` bridge here: the host is a **composed
cordis bundle**, not a dynamic package sandbox, so no such channel exists. Data
crosses as JSON over the WebServer routes the host registers under
`/api/team-flowise` (`@deepseek-ai/dsh-host-webserver`, injected as `webServer`).

The route table is frozen in `src/contract/routes.js` and mirrors the host's
registrations one-for-one. All writes are loopback-fenced on the host side.

## Layout

```
src/
  contract/            environment-free: shared verbatim by both halves
    routes.js          the frozen HTTP route table
    domain.js          record reducers + status vocabularies
    layout.js          deterministic DAG layout (waves + barycenter pass)
    panels.js          slot contribution descriptors
  node/index.js        Node entry (imports nothing)
  client/
    index.js           plugin face: apply() registers both slot cells
    api.js             the only module that touches fetch
    store.js           shared module-level store (both surfaces read it)
    context.js         React context + useSyncExternalStore / polling hooks
    styles.js          one CSS string, injected as a tagged <style>
    palette.js         canvas colours resolved from live theme tokens
    locales.js         zh/en dictionaries
    ui.js              presentational primitives
    components/
      settings-section.js
      activity-panel.js
      dag-canvas.js
scripts/verify.mjs     build + load verification
```

The store is module-scoped on purpose: the client module system materializes a
package's factory once per page, so the settings page and the header panel — two
different branches of the React tree — genuinely share one store, and polling
lives in the store rather than in either component.

## Conventions this package follows

- **No JSX, no TypeScript, no bundler magic.** `React.createElement` only, so
  what tsdown emits is what the browser runs. React is imported as a namespace
  (`import * as React from 'react'`), not as named imports: the platform seed is
  a CJS module object, and a named import would not survive the interop.
- **Every side effect is owned by the fiber.** The stylesheet, both slot
  registrations, and the locale dictionaries are declared through `ctx.effect(...)`
  / `slots.inject(...)`, so stopping or updating the plugin removes all of them.
- **Live host records never reach React state.** Each `pick*` reducer copies only
  the scalars the UI draws, so a large node payload cannot land in a component.
- **All colour comes from `--dsw-alias-*` theme tokens** with light-theme
  fallbacks, so the surfaces stay readable under the dark theme. The canvas
  resolves those tokens at paint time (`palette.js`) because a `<canvas>` cannot
  inherit CSS custom properties.

## Linking it into a profile

See [`SETUP.md`](./SETUP.md). The short version: the profile must depend on this
package so the host loader can resolve it, and a **restart** is required —
`dsh.client` package metadata is cached per package name and never re-read.
