# Integration: mounting `@local/team-flowise-client` into the `web` profile

The package is complete and verified in isolation (`npm run verify` in
`packages/team-flowise-client`). This file records the two steps that make the
running GUI serve it, and why they are **not** done automatically.

## Why it is not automatic

`dsh-client-modules` finds a browser half by:

1. taking each **host loader row's** module specifier (for the team plugin:
   `@local/team-flowise`, from the `flowise-team` patch row) and resolving it
   through the same Loader resolution that imported the row's host half;
2. reading the **nearest package.json** to that resolved module that declares the
   matching name;
3. reading its `dsh.client` block and `exports["./client"]`, then serving that
   file at `/plugins/<id>/client.js`.

So the *host row* is the address, and the client package has to be reachable from
it. `@local/team-flowise-client` is a sibling directory, not a dependency of
`@local/team-flowise`, so step 2 currently stops at the host package. Adding the
dependency to `packages/team-flowise/package.json` is **not enough on its own**:
the profile lists the host as `link:D:/ai-workspace/dsh/packages/team-flowise`,
and pnpm does not traverse into a `link:` directory's own dependencies
(`pnpm install` in the profile reports "Already up to date").

Two ways forward — pick one.

### Option A — make the profile depend on the client package (recommended)

The profile can register two client rows side by side, so the client package can
be a first-class profile dependency instead of a transitive one.

```powershell
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm add "@local/team-flowise-client@file:D:/ai-workspace/dsh/packages/team-flowise-client"
```

Then add the package to `dsh.profile.bundles` **and** give it a loader row, in
`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: flowise-team-client
      name: '@local/team-flowise-client'
      disabled: false
```

`@local/team-flowise` (host) keeps its `flowise-team` row; this adds a second row
whose only job is to be the addressable entry for the browser half.

### Option B — keep the host package as the address

Declare the client as a dependency of the host package *and* materialize it where
the loader can see it:

```powershell
# 1. declare it (edit packages/team-flowise/package.json)
#    "dependencies": { "@local/team-flowise-client": "link:../team-flowise-client", ... }

# 2. link it into the host package's own node_modules
New-Item -ItemType Junction `
  -Path   "D:\ai-workspace\dsh\packages\team-flowise\node_modules\@local\team-flowise-client" `
  -Target "D:\ai-workspace\dsh\packages\team-flowise-client"
```

The loader's package lookup falls back to tree-anchored resolution, so a link in
the host package's `node_modules` is enough for it to find the client's
`package.json`.

## Restart is mandatory

`dsh.client` package metadata is cached per package name and **never expires**
(the source comment in `dsh-client-modules` says plugin-set changes take effect
on restart). A running `dsh web` process therefore cannot pick up a new client
row by reloading the page. Stop and restart the process, then reload the GUI.

## Verify it took

1. **Static** — the row resolved:
   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\web"
   node -e "console.log(require.resolve('@local/team-flowise-client/package.json'))"
   ```
2. **Bundle is served** — in the browser, `window.__DSH_BOOT__.modules` contains
   a row with `id: "@local/team-flowise-client"`, and its `url` returns 200 with a
   body containing `__ModuleLoader__.load({ id: "@local/team-flowise-client"`.
3. **Surfaces are mounted** — Settings shows the "多 Agent 团队" entry, and a
   session header shows the "团队活动" control.
4. **Data is real** — the tabs match `GET /api/team-flowise/*` exactly.

## Failure modes and what they mean

| Symptom | Cause |
| --- | --- |
| `client-modules: … client bundles not found; run \`pnpm run build\` before launch` | `dist/client.js` is missing — run `npm run build` in the client package. |
| `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` | `exports["./client"]` was dropped or renamed in `package.json`. |
| Startup fails with a slot-ownership error for `settings.section` | Two halves register the same cell. `packages/team-flowise/src/client/index.js` is a re-export shim for exactly this reason — do not restore the legacy implementation (kept as `index.legacy-settings-only.js.txt`) alongside the client package. |
| Settings entry appears but the page is blank | The settings cell registered but the component threw. Check the browser console; `apply` guards every optional service with `ctx.get(...)`, so a missing `locale` is not the cause. |
| Entry appears, page renders, every tab is empty, an error banner shows | The host routes are not reachable. Check `GET /api/team-flowise/ping` directly; that path is a host-half problem, not a client one. |
