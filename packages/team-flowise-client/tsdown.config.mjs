// tsdown build for @local/team-flowise-client.
//
// Two independent outputs, because the package has two very different halves:
//
//  1. `dist/index.js`  — the Node half. A plain ESM module with no external
//     imports at all (deps.neverBundle is empty and nothing is imported), so
//     `import('@local/team-flowise-client')` works in bare Node. It carries the
//      environment-independent contract: the API route table, the panel/tab
//     descriptors, and the DAG layout solver.
//
//  2. `dist/client.js` — the browser half. DSH's client module system installs
//     `window.__ModuleLoader__` as a lazy CJS table: a plugin bundle only
//     REGISTERS a factory, and materialization (`factory(require) -> exports`)
//     happens on first import. The bundle must therefore be a classic script of
//     the exact shape
//
//         window.__ModuleLoader__.load({ id, factory: (require) => { ...; return module.exports } })
//
//     which is what the `dshClientBundle` rolldown plugin below produces: it
//     wraps the CJS chunk rolldown already emits (so `require("react")` and
//     `module.exports` are real references) in that header, and declares
//     `module`/`exports` inside the factory.
//
// React and the shell's shared UI packages stay external: they are platform
// seeds (`staticModules`) that the shell injects into `require`, so bundling a
// second copy would split React's instance identity.
import { defineConfig } from 'tsdown'

const CLIENT_ID = '@local/team-flowise-client'

/** Seed modules the shell hands to every bundle through `require`. */
const PLATFORM_SEEDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Wrap rolldown's CJS output in the DSH client factory registration.
 *
 * The wrapper runs in `renderChunk`, so the bytes it returns are the bytes
 * rolldown writes — including into the source map — which keeps `dist/client.js`
 * a single self-contained script with no post-processing step.
 *
 * @param id - package name the shell will address this bundle by.
 * @returns a rolldown plugin.
 */
function dshClientBundle(id) {
  return {
    name: 'dsh-client-bundle',
    renderChunk(code) {
      const body = code
        .split('\n')
        .map((line) => (line === '' ? '' : `\t\t${line}`))
        .join('\n')
      const wrapped = [
        'window.__ModuleLoader__.load({',
        `\tid: ${JSON.stringify(id)},`,
        '\tfactory: (require) => {',
        '\t\tvar module = { exports: {} };',
        '\t\tvar exports = module.exports;',
        body,
        '\t\treturn module.exports;',
        '\t}',
        '});',
        '',
      ].join('\n')
      return { code: wrapped, map: null }
    },
  }
}

export default defineConfig([
  {
    name: 'team-flowise-client/node',
    entry: { index: 'src/node/index.js' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outExtensions: () => ({ js: '.js' }),
    sourcemap: true,
    clean: true,
    dts: false,
    deps: { neverBundle: [] },
  },
  {
    name: 'team-flowise-client/web',
    entry: { client: 'src/client/index.js' },
    outDir: 'dist',
    format: 'cjs',
    platform: 'browser',
    outExtensions: () => ({ js: '.js' }),
    clean: false,
    dts: false,
    // No source map for the browser half, on purpose. The wrapper adds lines
    // around rolldown's chunk, so the chunk's own map is off by a constant — and
    // `renderChunk` runs BEFORE that map's `//# sourceMappingURL` trailer is
    // appended, which is why an enabled map lands the trailer inside the factory
    // body. A wrong map is worse than none: it points the debugger at the wrong
    // lines. The chunk map tsdown builds is exact, but nothing would reference it
    // (the shell serves `client.js`), so it is not worth writing either.
    sourcemap: false,
    deps: { neverBundle: PLATFORM_SEEDS },
    plugins: [dshClientBundle(CLIENT_ID)],
  },
])
