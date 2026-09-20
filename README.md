# team-flowise — a multi-agent team orchestration plugin for dsh

`@local/team-flowise` turns "one agent does everything" into "a team of roles
does it and leaves evidence": a dependency-ordered node graph, per-role model
routes / personas / tool presets / timeouts, an independent review gate with
bounded rework, a durable run ledger, and a progress panel in the web UI.

- host half: `packages/team-flowise/src/index.js` (registers the `team_*` model
  tools, publishes the `teamOrchestrator` service, owns four storage domains,
  serves `/api/team-flowise/*`)
- client half: `packages/team-flowise/src/client/index.js` (settings section,
  sidebar entry, right-pane progress page)
- skill: `skills/team-flowise/SKILL.md` (tells an agent when and how to use it)
- wiring snapshot: `deploy/` (how the plugin is mounted into a dsh profile)

---

## Install

### Prerequisites

| Requirement | Why | How to check |
|---|---|---|
| Node.js ≥ 20 (built-in modules only, no npm install needed) | `scripts/install.mjs` / `uninstall.mjs` use `node:` builtins exclusively | `node --version` |
| A dsh profile directory (`package.json` + `cordis.yml` / `cordis.patch.yml`) | that is where the plugin row and the dependency live | `node scripts/install.mjs --check` |
| The plugin package checked out locally | it is mounted as a local `file:`/`link:` dependency, never published to a registry | `ls packages/team-flowise/package.json` |
| dsh itself installed and its profile able to resolve `@deepseek-ai/*` bundles | the profile already depends on them | you are running dsh |

A profile is recognized by **both**: a `package.json` and a `cordis.yml` (or
`cordis.patch.yml`). Anything else is rejected with a clear error, so the script
cannot be pointed at the wrong directory by accident. The default target is
`<dsh-home>/profiles/web` — `<dsh-home>` is `$DSH_HOME` when set, otherwise
`~/.dsh` (`%USERPROFILE%\.dsh` on Windows).

### One command

From the repository root:

```sh
node scripts/install.mjs
```

That is the whole install. It is **idempotent**: run it again and it reports
`已存在，跳过` for every step and writes nothing. Useful variants:

```sh
node scripts/install.mjs --help                  # all options
node scripts/install.mjs --profile <dir>         # install into another profile
node scripts/install.mjs --dry-run               # print the planned changes + line diff, write nothing
node scripts/install.mjs --check                 # verify only: exit 0 = installed & consistent, exit 3 = drifted
node scripts/install.mjs --json                  # machine-readable report on stdout
node scripts/install.mjs --dep-spec relative     # force "file:<relative>" instead of the "auto" choice
node scripts/install.mjs --skill-root none       # do not install the skill
```

What it does, in order:

1. **validates** the target profile (and that `--package` really is
   `@local/team-flowise`);
2. creates `<profile>/node_modules/@local/team-flowise` →
   `<repo>/packages/team-flowise`. On Windows this is a **directory junction**,
   so no administrator rights and no Developer Mode are required. An existing
   link that points somewhere else is a **hard error**, never a silent
   overwrite (`--force` is the explicit way to replace it). If linking is
   refused, the script fails with the remediation instead of quietly copying —
   a copy would stop tracking source edits;
3. adds `"@local/team-flowise"` to `<profile>/package.json` `dependencies` and to
   `dsh.profile.bundles` (deduplicated; existing order is never re-shuffled).
   The dependency value defaults to `file:<relative>` when the profile and the
   package are on the same drive, otherwise `file:<absolute>`. An existing value
   that already resolves to this package is left **untouched** — so a live
   profile's hand-written `link:...` is preserved;
4. appends the `- insert:` row for `flowise-team` to
   `<profile>/cordis.patch.yml` if it is not there yet. Every existing line,
   comment included, is kept byte-identical; a **duplicate** row id would make
   dsh fail at boot (`duplicate loader entry id`), so the row is counted, not
   guessed;
5. copies the skill into `<dsh-home>/skills` (override with
   `--skill-root agents|project|none` or `--skill-dir <dir>`), validating its
   frontmatter first;
6. prints what a restart is needed for, and how to verify afterwards.

Every file it rewrites is first backed up to `<file>.bak-<timestamp>` (the backup
is skipped when a backup of that same second already exists, so an older backup
is never destroyed). `--dry-run` writes nothing at all.

### Why a restart is required

Host code and the client bundle are both loaded, or snapshotted, **at startup**:

- the profile composition (bundles + `cordis.patch.yml` + `--patch` overlays) is
  parsed and mounted when the host boots, which is when `packages/team-flowise/src/index.js`
  is imported and the `flowise-team` row is instantiated. A new row cannot appear
  in a running host;
- the client half is read from the `dsh.client` bundle once, at activation, and
  the host then serves that snapshot immutably. Source edits reach the browser
  only through an HMR `rebuilt()` push, which needs a running build watcher (the
  dsh implementation checkout provides one via `pnpm run dev:web`). Without a
  watcher, **a client change also needs a restart**.

So: stop dsh, start it again. Edits to the two source files behave the same way.

### Verify after the restart

Do not trust the browser cache or the old process — check, in this order:

| # | Check | Expected |
|---|---|---|
| 1 | `node scripts/install.mjs --check` | exit 0, every step `已存在，跳过` |
| 2 | Host HTTP: `GET http://127.0.0.1:3080/api/team-flowise/ping` | `{"ok":true,"pong":true,"domains":[...4 domains...]}` — a 404 means the row did not mount |
| 3 | **Tools**: open a new agent session and look at its tool list | 7 tools, each with its own description: `team_create_task`, `team_task_status`, `team_create_agent`, `team_create_workflow`, `team_list_agents`, `team_delegate_agent`, `team_run_workflow` |
| 4 | **UI**: dsh Web GUI → Settings | a `team-flowise` section (roles / workflows / runs) |
| 5 | **UI**: right sidebar | a "多 Agent 进度" (multi-agent progress) tab |
| 6 | The skill | `node -e "console.log(require('fs').existsSync(require('path').join(require('os').homedir(),'.dsh','skills','team-flowise','SKILL.md')))"` → `true`, and the skill list of a new session contains `team-flowise` |

If 2 fails, the row is not mounted: re-run `--check`, then read the host log for
the boot error (a duplicate `flowise-team` row id, or a link that points at a
directory without `src/index.js`, are the two common causes). If 2 passes but 3
or 4 fails, the plugin mounted but contributed nothing — check the host log for
the row's own warnings.

### Uninstall

```sh
node scripts/uninstall.mjs            # default target: <dsh-home>/profiles/web
node scripts/uninstall.mjs --check    # exit 0 = nothing left installed, exit 3 = leftovers
node scripts/uninstall.mjs --remove-skill   # also unmount the skill (default: keep it)
```

It removes exactly what the installer added — the link, the `dependencies` entry,
the `dsh.profile.bundles` entry, and the whole `- insert:` block — and is
idempotent too (a second run reports `不存在，跳过` for everything). Comments and
all other lines of `cordis.patch.yml` stay byte-identical; if the patch layer is
left with no entries at all, the script re-adds a `[]` line, because dsh requires
that file to be a top-level YAML array (a comments-only file would make the host
throw at boot). Backups (`*.bak-<timestamp>`) are always kept. The skill is kept
by default: it is a user-level asset; `--remove-skill` moves it **out** of the
skill root (into `<dsh-home>/.team-flowise-removed-<timestamp>/`), so it cannot
be discovered any more but can still be restored by hand.

Restart dsh afterwards — for the same reason as above.

---

## Layout

| Path | What it is |
|---|---|
| `packages/team-flowise/` | the plugin package (host half, client half, `cordis.patch.yml`) |
| `scripts/install.mjs`, `scripts/uninstall.mjs` | the portable installer / uninstaller described above |
| `skills/team-flowise/SKILL.md` | the skill installed into a skill root |
| `deploy/` | how the plugin is wired into a dsh profile, plus a portable profile snapshot |
| `validation/` | the acceptance scripts (`p8`, `p10`, `p11`, `p12`) |
| `workflows/` | example workflow definitions |

## Notes for contributors

- The host half is ESM plain JavaScript (`src/index.js`); the client half uses
  `React.createElement` and must keep the
  `window.__ModuleLoader__.load({ id, factory })` structure. Neither half may
  add external dependencies.
- `deploy/web-profile/package.json` is a **portable template**: its
  `file:../../packages/team-flowise` is relative to `deploy/web-profile/`
  itself. Do not edit a live profile by hand — run `scripts/install.mjs`.
- Anything a client-plugin change requires (rebuild/refresh) is documented in
  `deploy/README.md`.
