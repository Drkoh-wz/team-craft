# Deploy wiring — the part of the "working version" that lives outside this repo

`@local/team-flowise` is not installed from a registry. It is mounted by a
**host-composition row** in a dsh profile, and that profile lives outside this
repository. This directory snapshots that wiring so the working version is
reproducible from a fresh clone.

## Where the plugin is wired

The profile lives outside this repository, under a **dsh home** directory:
`<dsh-home>/profiles/web`. `<dsh-home>` defaults to `~/.dsh`
(`%USERPROFILE%\.dsh` on Windows) and can be overridden with the `DSH_HOME`
environment variable — so nothing here depends on one machine's layout.

| File | Role |
|---|---|
| `cordis.patch.yml` | the profile's own patch layer — **empty (`[]`)** here; the `flowise-team` row is declared by the bundle, not by the profile |
| `cordis.yml` | the profile's base composition |
| `package.json` | profile dependencies (declares `@local/team-flowise` as a local `file:` dependency) plus the `dsh.profile.bundles` list |
| `pnpm-workspace.yaml`, `.npmrc` | profile package-manager config |

Portable templates of all of these are snapshotted beside this file under
`web-profile/`. Do not copy them into a profile by hand — the dependency path
must match the real locations of the profile and the package, and
`scripts/install.mjs` writes exactly that (see the next section).

## Why the row lives in the bundle, not in the profile

The `flowise-team` row is declared by the bundle that owns it —
`packages/team-flowise/cordis.patch.yml`:

```yaml
- insert:
    - id: flowise-team
      name: '@local/team-flowise'
      disabled: false
```

This is the only arrangement in which **installing the package is enough**. The
official install route, `dsh plugin --profile <name> add <spec>`, only adds the
package to `dsh.profile.bundles` and composes that bundle's patch layer; it never
writes into the profile's own patch file. A row declared in the profile instead
would therefore leave the bundle mounted and contributing nothing — no tools, no
service, no UI.

It was established by measurement, not by reading: two throwaway profiles were
composed with `dsh --profile <p> --dump-config`, differing only in this file. With
`[]` the composed tree contained no `flowise-team` row; with the `- insert:`
above it did. The reference community plugin `dshmarket` ships its row the same
way.

A profile patch that *also* declares the row is not a harmless duplicate: the id
would be composed twice and dsh fails at boot with `duplicate loader entry id`.
`scripts/install.mjs` therefore **removes** a legacy profile-level row (older
versions of this repository wrote one), and its `--check` reports exit 3 until
that migration has run.

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

Two things must exist, and `scripts/install.mjs` creates both — idempotently,
without any hard-coded path:

1. a link at `<profile>/node_modules/@local/team-flowise` pointing at this
   repository's `packages/team-flowise`. On Windows the script creates a
   **directory junction**, which needs neither administrator rights nor Developer
   Mode. If linking is refused it **fails loudly instead of silently copying** —
   a copy would stop tracking source edits, which is a worse failure than an
   error;
2. the dependency entry in `<profile>/package.json`.

From the repository root (no machine-specific argument required):

```sh
node scripts/install.mjs                  # target: <dsh-home>/profiles/web
node scripts/install.mjs --profile <dir>  # target an explicit profile directory
node scripts/install.mjs --check          # verify only: exit 0 = installed+consistent, exit 3 = drifted
node scripts/install.mjs --dry-run        # print every planned change (line diff), write nothing
node scripts/uninstall.mjs --profile <dir>  # exact inverse; backups are kept
```

Both scripts take `--help`. `--check` against a profile that is not wired yet is
the fastest way to answer "why is the plugin not loading?".

### Dependency-spec forms

| Spec | Meaning | Portable? |
|---|---|---|
| `file:../../packages/team-flowise` | path **relative to the profile directory** | yes, but only while the profile keeps that exact distance from the package — true for this snapshot, not for a profile copied to `~/.dsh` |
| `file:<absolute path>` | absolute path, forward slashes | no — this machine only |
| `link:<absolute path>` | pnpm's `link:` protocol (what `pnpm add link:...` records) | no — this machine only; pnpm materialises it as a symlink |

`install.mjs` defaults to `--dep-spec auto`: `file:<relative>` when the profile
and the package sit on the same drive, otherwise `file:<absolute>`. It also
leaves an existing value untouched when that value already resolves to this
package — so the `link:` value a live profile was hand-written with is preserved
rather than rewritten. Force a specific form with `--dep-spec relative|absolute|link`.

### The skill

If the repository ships a skill (`skills/team-flowise/`), the installer also
copies it into a skill root, defaulting to `<dsh-home>/skills`
(`--skill-root dsh|agents|project|none`, or `--skill-dir <dir>`). Overwriting an
existing, different skill requires `--force`; the previous copy is moved **out**
of the skill root (a copy merely renamed inside the root would still be
discovered, because a skill's registered name comes from its frontmatter).

## Restart semantics

The profile composition is read at **host startup**. Host-side changes to
`packages/team-flowise/src/index.js` therefore require a **dsh host restart**.

The client half is subject to a second, independent constraint: the host
snapshots every `dsh.client` bundle at activation and serves the snapshot
immutably (`@deepseek-ai/dsh-client-modules`). Edits to
`packages/team-flowise/src/client/index.js` reach the browser only through an
HMR `rebuilt()` push, which needs a build watcher — so **without a watcher, a
client change also requires a restart**.
