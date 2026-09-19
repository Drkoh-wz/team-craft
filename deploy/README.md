# Deploy wiring — the part of the "working version" that lives outside this repo

`@local/team-flowise` is not installed from a registry. It is mounted by a
**host-composition row** in a dsh profile, and that profile lives outside this
repository. This directory snapshots that wiring so the working version is
reproducible from a fresh clone.

## Where the plugin is wired

Profile: `%USERPROFILE%\.dsh\profiles\web\`

| File | Role |
|---|---|
| `cordis.patch.yml` | the profile's own patch layer; adds the `flowise-team` row via `- insert:` |
| `cordis.yml` | the profile's base composition |
| `package.json` | profile dependencies (declares `@local/team-flowise` as a link dependency) |
| `pnpm-workspace.yaml`, `.npmrc` | profile package-manager config |

Copies of all of these are snapshotted beside this file under `web-profile/`.

## Why a `- insert:` row is required

A bundle patch layer (`packages/team-flowise/cordis.patch.yml`) can only
**override existing rows by id** — it cannot create a new row. So the package
ships an **empty** patch array and the *profile* patch layer adds the row:

```yaml
- insert:
    - id: flowise-team
      name: '@local/team-flowise'
      disabled: false
```

`flowise-team` must be a **host** composition row (not behind a preset
`isolate` realm): it publishes the `teamOrchestrator` service, registers the
`team_*` model tools, and owns four durable storage domains that are consumed
beyond a single session.

## Why no storage row is needed

`@deepseek-ai/dsh-storage-domain` is already composed by the `web-app` bundle
with `backend: json` rooted at `dshHomePath('storages')`. The team domains
(`team_agent_defs`, `team_ledger`, `team_workflows`, `team_runs`) therefore
auto-route to that file backend. Adding a second `storage-domain` row here would
collide with the already-mounted service.

## How the package reaches the profile

The profile resolves `@local/team-flowise` through a **symbolic link**:

```
%USERPROFILE%\.dsh\profiles\web\node_modules\@local\team-flowise
    -> D:\ai-workspace\dsh\packages\team-flowise
```

Recreate it (Windows, elevated or with developer mode) with:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\@local\team-flowise" `
  -Target "D:\ai-workspace\dsh\packages\team-flowise"
```

## Restart semantics

The profile composition is read at **host startup**. Host-side changes to
`packages/team-flowise/src/index.js` therefore require a **dsh host restart**.

The client half is subject to a second, independent constraint: the host
snapshots every `dsh.client` bundle at activation and serves the snapshot
immutably (`@deepseek-ai/dsh-client-modules`). Edits to
`packages/team-flowise/src/client/index.js` reach the browser only through an
HMR `rebuilt()` push, which needs a build watcher — so **without a watcher, a
client change also requires a restart**.
