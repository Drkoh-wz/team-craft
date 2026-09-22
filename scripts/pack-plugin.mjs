#!/usr/bin/env node
/**
 * scripts/pack-plugin.mjs -- build the distributable install package for the
 * `@local/team-flowise` plugin itself.
 *
 * Why this exists next to scripts/pack-specialization.mjs:
 *
 *   The specialization packer ships a TEAM (roles + workflow + prompts) and
 *   deliberately refuses to include the plugin source. This packer ships the
 *   PLUGIN, and deliberately refuses to include any specialization. They are the
 *   two halves of "hand someone your setup": one is the engine, one is the team
 *   that runs on it. Neither archive contains the other.
 *
 * Archive layout -- and why it is the repo layout, not a flattened one:
 *
 *   INSTALL.md                      generated entry point (see below)
 *   packages/team-flowise/**        the plugin package (no node_modules)
 *   skills/team-flowise/SKILL.md    the agent-facing skill
 *   scripts/install.mjs             the installer, UNMODIFIED
 *   scripts/uninstall.mjs           its inverse, UNMODIFIED
 *
 *   `install.mjs` resolves the profile, the package and the skill relative to
 *   its own location (`<script>/..`), searching `<repo>/packages/team-flowise`
 *   and `<repo>/skills`. Mirroring the repo paths means the SAME installer runs
 *   from inside the extracted archive with no edits and no extra flags -- which
 *   is the only way the thing you test is the thing you ship. Flattening the
 *   layout would require a second, divergent installer.
 *
 * Format: .tar.gz, hand-written ustar headers + node:zlib gzipSync. Zero new
 *   dependencies (same reasoning as the specialization packer: Node has no zip
 *   writer, and .tar.gz is readable by Windows' bundled bsdtar, macOS and Linux).
 *
 * The packer verifies its own output before declaring success:
 *   R  round trip    gunzip + untar the bytes it just wrote and compare the
 *                    entry list, sizes and per-file sha256 with the source
 *   F  forbidden     no node_modules/dist/archives, no drive-absolute path
 *                    anywhere in the text files that leave this machine
 *   I  install       extract to a temp dir and run the REAL installer against a
 *                    REAL (temporary) profile, then assert the EFFECTS on disk
 *   K  check         the installer's own --check says "installed and consistent"
 *   N  idempotent    a second install writes nothing (no new backups, no change)
 *   U  uninstall     the inverse really reverses it, and --check then says so
 *   V  untouched     the repo's installer files and package.json are byte-identical
 *                    before and after (a packer that mutates its inputs is a bug)
 *
 * Repository files are never written. Only --out (default <repo>/dist) and the
 * system temp dir are touched.
 *
 * Usage:
 *   node scripts/pack-plugin.mjs [options]
 *     --out <dir>          archive output directory (default <repo>/dist)
 *     --version <v>        archive version label (default: the package's version)
 *     --package-dir <dir>  pack this directory instead of <repo>/packages/team-flowise
 *                          (for layout self-tests; the archive paths are unchanged)
 *     --list               print the entries that would be packed; write nothing
 *     --dry-run            print the plan (path, entry count, bytes); write nothing
 *     --no-verify          skip the install/idempotency/uninstall round (R/F still run)
 *     --keep-temp          keep the temp extraction for inspection
 *     --help, -h           this text
 *
 * Exit codes: 0 = ok, 1 = a precondition or self-verification failed, 2 = usage.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
	rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

/* ------------------------------------------------------------------ constants */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(SCRIPT_DIR, '..');
const DEFAULT_PLUGIN_DIR = join(REPO_ROOT, 'packages', 'team-flowise');
const DEFAULT_SKILL_DIR = join(REPO_ROOT, 'skills', 'team-flowise');
const INSTALLER = join(REPO_ROOT, 'scripts', 'install.mjs');
const UNINSTALLER = join(REPO_ROOT, 'scripts', 'uninstall.mjs');

const PACKAGE_REL = 'packages/team-flowise';
const SKILL_REL = 'skills/team-flowise';
const ENTRY_DOC = 'INSTALL.md';
const PLUGIN_NAME = '@local/team-flowise';
const ROW_ID = 'flowise-team';

/** A missing one of these is a broken package, not a smaller one. */
const REQUIRED_FILES = [
	`${PACKAGE_REL}/package.json`,
	`${PACKAGE_REL}/cordis.patch.yml`,
	`${PACKAGE_REL}/src/index.js`,
	`${PACKAGE_REL}/src/client/index.js`,
	`${SKILL_REL}/SKILL.md`,
	'scripts/install.mjs',
	'scripts/uninstall.mjs',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.turbo']);
/** Lockfiles are excluded on purpose: the profile owns dependency resolution,
 *  and a nested lockfile pinning an old tree inside a distributable is the exact
 *  "stale binary that no longer matches the tree" trap P12 cleaned up. */
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml']);
const SKIP_FILE_RE = /\.(zip|tar|tgz|tar\.gz|7z)$/i;
const BACKUP_RE = /\.bak-\d+$/;

/** A drive-absolute path (X:\ or X:/). Guarded against URLs, whose scheme is
 *  followed by two slashes rather than a path separator. */
const DRIVE_PATH_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/;

const BLOCK = 512;
const GZIP_LEVEL = 9;
const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `team-flowise plugin packer -- build a distributable install package

Usage:
  node scripts/pack-plugin.mjs [options]

Options:
  --out <dir>          archive output directory (default <repo>/dist)
  --version <v>        archive version label (default: the package's version)
  --package-dir <dir>  pack this directory instead of ${PACKAGE_REL}
  --list               list the entries that would be packed; write nothing
  --dry-run            print the plan; write nothing
  --no-verify          skip the install / idempotency / uninstall round
  --keep-temp          keep the temp extraction directory
  --help, -h           this text

Artifact:  <out>/team-flowise-plugin-<version>.tar.gz
Contents:  ${ENTRY_DOC}
           ${PACKAGE_REL}/**
           ${SKILL_REL}/SKILL.md
           scripts/install.mjs, scripts/uninstall.mjs

Not packed: node_modules, dist, existing archives, *.bak-<ts> backups, lockfiles,
            and every file under specializations/ (that is the OTHER package).
`;

/* ------------------------------------------------------------------ plumbing */

class Fail extends Error {
	constructor(message, exitCode = EXIT_FAIL) {
		super(message);
		this.exitCode = exitCode;
	}
}
class UsageError extends Fail {
	constructor(message) { super(message, EXIT_USAGE); }
}

const buf = (s) => Buffer.from(s, 'utf8');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const toPosix = (p) => p.split(sep).join('/');
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readText = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

const checks = { total: 0, failed: 0 };
function check(label, ok, detail) {
	checks.total += 1;
	if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true; }
	checks.failed += 1;
	console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''));
	return false;
}
function checksSummary() {
	console.log('\n=== SELF-VERIFICATION ===');
	console.log(`checks=${checks.total}  failures=${checks.failed}`);
	console.log(checks.failed === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
}

/* ------------------------------------------------------------------ ustar write */

function writeOctal(h, offset, fieldLen, value) {
	const s = Math.max(0, Math.floor(value)).toString(8);
	if (s.length > fieldLen - 1) throw new Fail(`tar field overflow: ${fieldLen} bytes cannot hold ${value}`);
	h.write(s.padStart(fieldLen - 1, '0') + '\0', offset, fieldLen, 'ascii');
}

/** One 512-byte ustar header. Paths over 100 bytes are split on the prefix field. */
function tarHeader(name, size, mode, mtimeSec) {
	const h = Buffer.alloc(BLOCK, 0);
	let nameBytes = buf(name);
	let prefixBytes = Buffer.alloc(0);
	if (nameBytes.length > 100) {
		const slash = name.lastIndexOf('/');
		if (slash <= 0) throw new Fail(`archive path too long with no / to split on: ${name}`);
		prefixBytes = buf(name.slice(0, slash));
		nameBytes = buf(name.slice(slash + 1));
		if (nameBytes.length > 100 || prefixBytes.length > 155) {
			throw new Fail(`archive path exceeds the ustar limit (no PAX support): ${name}`);
		}
	}
	nameBytes.copy(h, 0);
	writeOctal(h, 100, 8, mode);
	writeOctal(h, 108, 8, 0);
	writeOctal(h, 116, 8, 0);
	writeOctal(h, 124, 12, size);
	writeOctal(h, 136, 12, mtimeSec);
	h.write('        ', 148, 8, 'ascii');
	h.write('0', 156, 1, 'ascii');
	Buffer.from('ustar\0', 'latin1').copy(h, 257);
	h.write('00', 263, 2, 'ascii');
	h.write('pack-plugin', 265, 32, 'ascii');
	h.write('pack', 297, 32, 'ascii');
	writeOctal(h, 329, 8, 0);
	writeOctal(h, 337, 8, 0);
	if (prefixBytes.length) prefixBytes.copy(h, 345);
	let sum = 0;
	for (let i = 0; i < BLOCK; i += 1) sum += h[i];
	h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
	return h;
}

function buildTar(entries) {
	const parts = [];
	for (const e of entries) {
		parts.push(tarHeader(e.name, e.data.length, e.mode, e.mtimeSec));
		parts.push(e.data);
		const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
		if (pad) parts.push(Buffer.alloc(pad, 0));
	}
	parts.push(Buffer.alloc(BLOCK * 2, 0));
	return Buffer.concat(parts);
}

/* ------------------------------------------------------------------ ustar read */

function readCStr(h, offset, len) {
	const raw = h.subarray(offset, offset + len);
	const z = raw.indexOf(0);
	return (z === -1 ? raw : raw.subarray(0, z)).toString('utf8');
}
function readOctalField(h, offset, len) {
	const s = readCStr(h, offset, len).replace(/\0/g, '').trim();
	if (s === '') return 0;
	const n = parseInt(s, 8);
	if (!Number.isFinite(n)) throw new Fail(`unparsable octal field in tar header: ${JSON.stringify(s)}`);
	return n;
}
function untar(tarbuf) {
	const files = [];
	let off = 0;
	while (off + BLOCK <= tarbuf.length) {
		const h = tarbuf.subarray(off, off + BLOCK);
		let allZero = true;
		for (let i = 0; i < BLOCK; i += 1) { if (h[i] !== 0) { allZero = false; break; } }
		if (allZero) break;
		const name = readCStr(h, 0, 100);
		const prefix = readCStr(h, 345, 155);
		const full = prefix ? `${prefix}/${name}` : name;
		const size = readOctalField(h, 124, 12);
		const type = String.fromCharCode(h[156]);
		off += BLOCK;
		if (off + size > tarbuf.length) throw new Fail(`tar data block out of range: ${full}`);
		const data = tarbuf.subarray(off, off + size);
		if (type === '0' || type === '\0') files.push({ name: full, size, data });
		off += Math.ceil(size / BLOCK) * BLOCK;
	}
	return files;
}

/* ------------------------------------------------------------------ collecting */

function collectTree(absDir, relPrefix, out, skipped) {
	for (const name of readdirSync(absDir).sort()) {
		const abs = join(absDir, name);
		const rel = `${relPrefix}/${name}`;
		const st = lstatSync(abs);
		if (st.isSymbolicLink()) { skipped.push(`${rel} (symlink, skipped)`); continue; }
		if (st.isDirectory()) {
			if (SKIP_DIRS.has(name)) { skipped.push(`${rel}/ (directory rule)`, ); continue; }
			collectTree(abs, rel, out, skipped);
			continue;
		}
		if (!st.isFile()) { skipped.push(`${rel} (not a regular file)`); continue; }
		if (SKIP_FILES.has(name)) { skipped.push(`${rel} (lockfile rule)`); continue; }
		if (SKIP_FILE_RE.test(name)) { skipped.push(`${rel} (archive rule)`); continue; }
		if (BACKUP_RE.test(name)) { skipped.push(`${rel} (backup rule)`); continue; }
		out.push({ name: rel, abs, data: readFileSync(abs), mode: 0o644, mtimeSec: Math.floor(st.mtimeMs / 1000) });
	}
}

function collectEntries(pluginDir, skillDir) {
	const entries = [];
	const skipped = [];
	collectTree(pluginDir, PACKAGE_REL, entries, skipped);
	if (isDir(skillDir)) collectTree(skillDir, SKILL_REL, entries, skipped);
	else skipped.push(`${SKILL_REL}/ (skill directory not found)`);
	for (const rel of ['scripts/install.mjs', 'scripts/uninstall.mjs']) {
		const abs = join(REPO_ROOT, rel);
		if (!isFile(abs)) throw new Fail(`installer missing from the repository: ${abs}`);
		entries.push({ name: rel, abs, data: readFileSync(abs), mode: 0o644, mtimeSec: Math.floor(statSync(abs).mtimeMs / 1000) });
	}
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return { entries, skipped };
}

/* ------------------------------------------------------------------ INSTALL.md */

function buildInstallMd({ version, entryCount, sourceBytes, gitDescribe }) {
	return `# ${PLUGIN_NAME} ${version} -- installation

This archive is a self-contained install package for the \`team-flowise\` plugin
(a multi-agent team orchestration capability for DeepSeek Harness). It contains
the plugin package, its agent-facing skill, and the real installer -- unmodified.

    git describe at pack time : ${gitDescribe}
    entries in this archive   : ${entryCount}
    source data (excl. this)  : ${sourceBytes} bytes

## 1. Extract

    tar -xzf team-flowise-plugin-${version}.tar.gz -C <somewhere>

Windows 10+ ships \`tar\` (bsdtar) and can read this archive; \`Expand-Archive\`
cannot, because it only handles \`.zip\`.

## 2. Install into a dsh profile

    node scripts/install.mjs --profile <dsh-profile-dir>

\`<dsh-profile-dir>\` defaults to \`$DSH_HOME/profiles/web\` (\`~/.dsh/profiles/web\`).
The path to the plugin package and to the skill is derived from this script's own
location, so no \`--package\` or \`--skill-source\` is needed.

What the installer does, all of it idempotent:

1. links \`<profile>/node_modules/@local/team-flowise\` to \`${PACKAGE_REL}\`;
2. adds the dependency to \`<profile>/package.json\` and its bundle to
   \`dsh.profile.bundles\`;
3. retires a LEGACY host-composition row (id \`${ROW_ID}\`) from
   \`<profile>/cordis.patch.yml\` if an older installer left one there. The row
   itself is declared by the bundle (\`${PACKAGE_REL}/cordis.patch.yml\`), so this
   step only ever removes; a profile that never had one keeps its file byte-identical;
4. copies the skill into a skill root.

Every file it rewrites is first backed up to \`<file>.bak-<timestamp>\`.

Useful flags:

    --dry-run        print every planned change and write nothing
    --check          verify only; exit 0 = installed and consistent, 3 = not
    --skill-dir <d>  install the skill somewhere specific
    --skill-root none  do not install a skill at all
    --force          replace a link/entry that exists but points elsewhere

## 3. Restart dsh, then verify

Host code and the client bundle are loaded/snapshotted at startup, so the plugin
is not live until dsh is restarted. Afterwards:

    node scripts/install.mjs --profile <dsh-profile-dir> --check     # exit 0
    curl http://127.0.0.1:3080/api/team-flowise/agents              # JSON

The plugin contributes eight \`team_*\` tools plus a sidebar progress panel
(\u300c\u591a Agent \u56e2\u961f\u8fdb\u5ea6\u300d) and a right-pane tab.

## 4. Uninstall

    node scripts/uninstall.mjs --profile <dsh-profile-dir>

It reverses all four steps, keeps every other line of \`cordis.patch.yml\`
byte-identical, and is equally idempotent. Step 3 is a no-op on a profile wired
by this version, because there is no legacy row to retire.

## What is NOT in this archive

- \`node_modules\` (dependencies come from the profile) and lockfiles;
- any specialization / team pack -- those are separate archives. The leasing
  risk team ships as \`leasing-risk-team-<version>.tar.gz\` from
  \`scripts/pack-specialization.mjs\`, and its installer targets a plugin
  installed with THIS package.
`;
}

/* ------------------------------------------------------------------ verification */

function runNode(args, cwd) {
	try {
		const stdout = execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		return { code: 0, stdout, stderr: '' };
	} catch (e) {
		return {
			code: e.status === undefined || e.status === null ? -1 : e.status,
			stdout: String(e.stdout || ''),
			stderr: String(e.stderr || ''),
		};
	}
}

/**
 * A profile shaped like a real one: another plugin's `- insert:` row is already
 * present, so the uninstaller has to remove one row without touching the other,
 * AND a LEGACY `flowise-team` row is present, because a profile wired by an older
 * version of this repository still carries one. That is the interesting case: the
 * installer must retire it (the row is declared by the bundle now, and two rows
 * with one id stop dsh from booting) while leaving the neighbouring row and the
 * header byte-identical. A comment-only fixture would exercise none of this.
 */
const FIXTURE_PATCH = [
	'# fixture profile written by scripts/pack-plugin.mjs',
	'- insert:',
	'    - id: unrelated-plugin',
	"      name: 'someone/else'",
	'      disabled: false',
	'',
	'# legacy row, as written by an older team-flowise installer',
	'- insert:',
	`    - id: ${ROW_ID}`,
	`      name: '${PLUGIN_NAME}'`,
	'      disabled: false',
	'',
].join('\n');

function writeFixtureProfile(dir) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify({
		name: 'pack-plugin-fixture-profile',
		private: true,
		dsh: { profile: { bundles: [] } },
	}, null, 2) + '\n', 'utf8');
	writeFileSync(join(dir, 'cordis.patch.yml'), FIXTURE_PATCH, 'utf8');
}

/** How many rows of any kind the patch file declares. */
const insertRowCount = (text) => (text.match(/^\s+- id:/gm) || []).length;

function extractArchive(tarGz, destDir) {
	const files = untar(gunzipSync(tarGz));
	for (const f of files) {
		const out = join(destDir, f.name);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, f.data);
	}
	return files;
}

/* ------------------------------------------------------------------ main */

function parseArgs(argv) {
	const opts = { out: join(REPO_ROOT, 'dist'), version: null, pluginDir: DEFAULT_PLUGIN_DIR, list: false, dryRun: false, verify: true, keepTemp: false };
	const takesValue = { '--out': 'out', '--version': 'version', '--package-dir': 'pluginDir' };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		const eq = a.indexOf('=');
		const key = eq > 0 ? a.slice(0, eq) : a;
		const inline = eq > 0 ? a.slice(eq + 1) : null;
		if (key === '--help' || key === '-h') { process.stdout.write(USAGE); throw new Fail('', EXIT_OK); }
		if (key === '--list') { opts.list = true; continue; }
		if (key === '--dry-run') { opts.dryRun = true; continue; }
		if (key === '--no-verify') { opts.verify = false; continue; }
		if (key === '--keep-temp') { opts.keepTemp = true; continue; }
		if (Object.prototype.hasOwnProperty.call(takesValue, key)) {
			const v = inline !== null ? inline : argv[++i];
			if (typeof v !== 'string' || v.trim() === '') throw new UsageError(`${key} needs a value`);
			opts[takesValue[key]] = key === '--out' || key === '--package-dir' ? pathResolve(v.trim()) : v.trim();
			continue;
		}
		throw new UsageError(`unknown option: ${a}\n\n${USAGE}`);
	}
	return opts;
}

function gitDescribe() {
	try {
		return execFileSync('git', ['describe', '--always', '--dirty'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
	} catch {
		return '(not a git checkout)';
	}
}

function main(argv) {
	const opts = parseArgs(argv);

	if (!isDir(opts.pluginDir)) throw new Fail(`plugin directory does not exist: ${opts.pluginDir}`);
	const pkgJsonPath = join(opts.pluginDir, 'package.json');
	if (!isFile(pkgJsonPath)) throw new Fail(`no package.json under --package-dir: ${pkgJsonPath}`);
	let meta;
	try { meta = JSON.parse(readText(pkgJsonPath)); } catch (e) { throw new Fail(`package.json is not valid JSON: ${e.message}`); }
	if (meta.name !== PLUGIN_NAME) throw new Fail(`package.json name is "${meta.name}", expected "${PLUGIN_NAME}"`);
	const version = opts.version !== null ? opts.version : String(meta.version || '0.0.0');
	if (/[\\/]/.test(version)) throw new UsageError(`--version must not contain a path separator: ${version}`);

	console.log(`plugin package : ${opts.pluginDir}`);
	console.log(`version        : ${version}`);
	console.log(`skill          : ${DEFAULT_SKILL_DIR}`);

	/* ---- collect + required-file gate (a missing file must fail the PACK, not
	   silently produce a smaller archive) ---- */
	const { entries, skipped } = collectEntries(opts.pluginDir, DEFAULT_SKILL_DIR);
	const names = new Set(entries.map((e) => e.name));
	const missing = REQUIRED_FILES.filter((r) => !names.has(r));
	if (missing.length > 0) throw new Fail(`package is incomplete, refusing to pack. missing: ${missing.join(', ')}`);

	// INSTALL.md is generated and packed as the entry point. It is added AFTER the
	// required-file gate on purpose: that gate must judge the SOURCE tree, never a
	// document the packer itself just wrote.
	//
	// Its mtime is the newest SOURCE mtime, never "now": a tar header carries an
	// mtime, so stamping the generated file with the wall clock would make two
	// builds of identical inputs differ byte for byte -- and then no one could tell
	// a rebuilt archive from a changed one. SOURCE_DATE_EPOCH pins every entry, for
	// a fully reproducible archive (same convention as pack-specialization.mjs).
	const sourceBytes = entries.reduce((n, e) => n + e.data.length, 0);
	const maxMtime = entries.reduce((n, e) => Math.max(n, e.mtimeSec), 0);
	entries.push({
		name: ENTRY_DOC,
		data: buf(buildInstallMd({ version, entryCount: entries.length + 1, sourceBytes, gitDescribe: gitDescribe() })),
		mode: 0o644,
		mtimeSec: maxMtime,
	});
	const sourceEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH || '', 10);
	if (Number.isFinite(sourceEpoch) && sourceEpoch > 0) {
		for (const e of entries) e.mtimeSec = sourceEpoch;
		console.log(`SOURCE_DATE_EPOCH=${sourceEpoch} -> every entry's mtime is pinned`);
	}
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

	const tarBuf = buildTar(entries);
	const gzBuf = gzipSync(tarBuf, { level: GZIP_LEVEL });
	const outDir = opts.out;
	const outFile = join(outDir, `team-flowise-plugin-${version}.tar.gz`);
	const totalBytes = entries.reduce((n, e) => n + e.data.length, 0);

	console.log(`entries        : ${entries.length} (tar ${kib(tarBuf.length)} -> gz ${kib(gzBuf.length)})`);
	if (skipped.length > 0) console.log(`skipped        : ${skipped.length} item(s), e.g. ${skipped.slice(0, 3).join('; ')}`);

	if (opts.list) {
		console.log('\nentries:');
		for (const e of entries) console.log(`  ${String(e.data.length).padStart(9)}  ${e.name}`);
		console.log(`\n${entries.length} entries, ${kib(totalBytes)} of source data. Nothing written (--list).`);
		return EXIT_OK;
	}
	if (opts.dryRun) {
		console.log(`\nwould write    : ${outFile}`);
		console.log(`archive bytes  : ${gzBuf.length}`);
		console.log('Nothing written (--dry-run).');
		return EXIT_OK;
	}

	mkdirSync(outDir, { recursive: true });
	writeFileSync(outFile, gzBuf);
	console.log(`\narchive        : ${outFile}`);
	console.log(`archive bytes  : ${gzBuf.length}`);

	/* ---- R: round trip ---- */
	console.log('\n--- R: archive round trip (the bytes on disk are the bytes we meant) ---');
	const onDisk = readFileSync(outFile);
	const back = untar(gunzipSync(onDisk));
	check('R1.1 rewritten archive gunzips and untars', back.length === entries.length, `entries=${back.length} expected=${entries.length}`);
	const mismatches = [];
	for (let i = 0; i < Math.min(back.length, entries.length); i += 1) {
		if (back[i].name !== entries[i].name) mismatches.push(`name ${back[i].name} != ${entries[i].name}`);
		else if (sha256(back[i].data) !== sha256(entries[i].data)) mismatches.push(`content differs: ${entries[i].name}`);
	}
	check('R1.2 every entry keeps its name, size and sha256', mismatches.length === 0, mismatches.slice(0, 3).join(' | ') || 'all match');
	const namesBack = new Set(back.map((f) => f.name));
	check('R1.3 the required files are all present after the round trip', REQUIRED_FILES.every((r) => namesBack.has(r)), `required=${REQUIRED_FILES.length}`);

	/* ---- F: forbidden content ---- */
	console.log('\n--- F: nothing in the archive should not be there ---');
	const forbidden = back.filter((f) => /(^|\/)(node_modules|dist|\.git)\//.test(f.name) || SKIP_FILE_RE.test(f.name) || BACKUP_RE.test(f.name));
	check('F1.1 no node_modules / dist / archive / backup entries', forbidden.length === 0, forbidden.slice(0, 3).map((f) => f.name).join(', ') || 'clean');
	check('F1.2 no specialization files leaked in (this archive is the engine, not a team)',
		back.every((f) => !f.name.startsWith('specializations/')), 'entries=' + back.length);
	const absoluteHits = [];
	for (const f of back) {
		if (!/\.(md|mjs|js|json|yml|yaml|txt)$/i.test(f.name)) continue;
		const text = f.data.toString('utf8');
		const m = DRIVE_PATH_RE.exec(text);
		if (m) absoluteHits.push(`${f.name}: ${JSON.stringify(text.slice(Math.max(0, m.index - 20), m.index + 24))}`);
	}
	check('F1.3 no drive-absolute path in any text file (the archive must be location-independent)',
		absoluteHits.length === 0, absoluteHits.slice(0, 2).join(' | ') || 'clean');
	const installEntry = back.find((f) => f.name === 'scripts/install.mjs');
	check('F1.4 the installer inside the archive is byte-identical to the repository copy',
		installEntry !== undefined && sha256(installEntry.data) === sha256(readFileSync(INSTALLER)),
		installEntry === undefined ? 'missing' : sha256(installEntry.data).slice(0, 16));

	/* ---- I/K/N/U/V: extract and really install it ---- */
	if (!opts.verify) {
		console.log('\n--- I/K/N/U/V: skipped (--no-verify) ---');
		checksSummary();
		return checks.failed === 0 ? EXIT_OK : EXIT_FAIL;
	}

	console.log('\n--- I/K/N/U/V: cold extract, then install it for real ---');
	const tmpRoot = mkdtempSync(join(tmpdir(), 'tf-plugin-pack-'));
	const extractDir = join(tmpRoot, 'extracted');
	const profileDir = join(tmpRoot, 'profile');
	const skillDir = join(tmpRoot, 'skills');
	const before = {
		installer: sha256(readFileSync(INSTALLER)),
		uninstaller: sha256(readFileSync(UNINSTALLER)),
		pkg: sha256(readFileSync(pkgJsonPath)),
		index: sha256(readFileSync(join(opts.pluginDir, 'src', 'index.js'))),
	};
	try {
		mkdirSync(extractDir, { recursive: true });
		extractArchive(onDisk, extractDir);
		writeFixtureProfile(profileDir);
		mkdirSync(skillDir, { recursive: true });

		// A file written by the archive must be where the installer expects it.
		check('I1.1 the extract puts install.mjs and the package where the installer looks',
			isFile(join(extractDir, 'scripts', 'install.mjs')) && isFile(join(extractDir, PACKAGE_REL, 'src', 'index.js')),
			extractDir + ' (temp)');

		const first = runNode([join(extractDir, 'scripts', 'install.mjs'), '--profile', profileDir, '--skill-dir', skillDir], extractDir);
		check('I2.1 the real installer runs from inside the extracted archive and exits 0',
			first.code === 0, `exit=${first.code}` + (first.code === 0 ? '' : ' :: ' + (first.stderr || first.stdout).split('\n').slice(-3).join(' / ')));

		// Assert the EFFECTS on disk. Parsing the installer's own report would only
		// prove that it can talk about itself.
		const profilePkg = JSON.parse(readText(join(profileDir, 'package.json')));
		check('I2.2 the dependency was added to the profile package.json',
			typeof profilePkg.dependencies === 'object' && typeof profilePkg.dependencies[PLUGIN_NAME] === 'string',
			JSON.stringify(profilePkg.dependencies && profilePkg.dependencies[PLUGIN_NAME]));
		check('I2.3 the bundle was added to dsh.profile.bundles exactly once',
			Array.isArray(profilePkg.dsh?.profile?.bundles) && profilePkg.dsh.profile.bundles.filter((b) => b === PLUGIN_NAME).length === 1,
			JSON.stringify(profilePkg.dsh?.profile?.bundles));
		const patch = readText(join(profileDir, 'cordis.patch.yml'));
		check('I2.4 the host-composition row is NOT in the profile patch any more — it is declared by the bundle, and a copy here would compose the same id twice',
			(patch.match(new RegExp(`id:\\s*${ROW_ID}`, 'g')) || []).length === 0,
			patch.split('\n').filter((l) => l.includes(ROW_ID) || l.includes('insert')).join(' / '));
		const bundledPatch = readText(join(extractDir, PACKAGE_REL, 'cordis.patch.yml'));
		check('I2.5 the unrelated plugin\'s row and the fixture header survived the install untouched (only our legacy block was retired)',
			patch.includes('id: unrelated-plugin') && patch.includes('name: \'someone/else\'')
			&& patch.startsWith('# fixture profile written by scripts/pack-plugin.mjs\n')
			&& insertRowCount(patch) === 1,
			'rows=' + insertRowCount(patch));
		check('I2.6 the bundle\'s own cordis.patch.yml declares the row (this is what makes "installing the package" equal "mounting it")',
			(bundledPatch.match(new RegExp(`id:\\s*${ROW_ID}`, 'g')) || []).length === 1
			&& bundledPatch.includes('- insert:')
			&& bundledPatch.includes(`name: '${PLUGIN_NAME}'`),
			bundledPatch.split('\n').filter((l) => l.includes(ROW_ID) || l.includes('insert') || l.includes('name:')).join(' / '));
		let linkOk = false;
		let linkDetail = '';
		try {
			const linkPath = join(profileDir, 'node_modules', '@local', 'team-flowise');
			const st = lstatSync(linkPath);
			const real = st.isSymbolicLink() || st.isDirectory() ? statSync(linkPath) : null;
			linkOk = real !== null && isFile(join(linkPath, 'package.json'));
			linkDetail = linkPath;
		} catch (e) { linkDetail = 'lstat failed: ' + e.message; }
		check('I2.7 node_modules/@local/team-flowise resolves to a real package (not a dangling link)', linkOk, linkDetail);
		const installedSkill = join(skillDir, 'team-flowise', 'SKILL.md');
		const skillCopied = isFile(installedSkill);
		const skillText = skillCopied ? readText(installedSkill) : '';
		const skillFm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillText);
		check('I2.8 the skill was copied with its YAML frontmatter intact (name + description present)',
			skillFm !== null && /(^|\n)name:\s*\S/.test(skillFm[1]) && /(^|\n)description:\s*\S/.test(skillFm[1]),
			skillCopied ? `${skillText.length} chars, frontmatter=${skillFm !== null}` : 'not installed');
		check('I2.9 the installed skill is byte-identical to the archive copy (nothing rewrites it on the way in)',
			skillCopied && sha256(readFileSync(installedSkill)) === sha256(readFileSync(join(DEFAULT_SKILL_DIR, 'SKILL.md'))),
			skillCopied ? sha256(readFileSync(installedSkill)).slice(0, 16) : 'not installed');

		const chk = runNode([join(extractDir, 'scripts', 'install.mjs'), '--profile', profileDir, '--skill-dir', skillDir, '--check'], extractDir);
		check('K1.1 the installer\'s own --check agrees: installed and consistent (exit 0)', chk.code === 0, 'exit=' + chk.code);

		// Idempotency: snapshot, install again, compare. Nothing may change and no
		// backup may appear, because a no-op must not rewrite a single byte.
		const pkgHash1 = sha256(readFileSync(join(profileDir, 'package.json')));
		const patchHash1 = sha256(readFileSync(join(profileDir, 'cordis.patch.yml')));
		const skillHash1 = sha256(readFileSync(join(skillDir, 'team-flowise', 'SKILL.md')));
		const backupsBefore = readdirSync(profileDir).filter((n) => BACKUP_RE.test(n)).length;
		const second = runNode([join(extractDir, 'scripts', 'install.mjs'), '--profile', profileDir, '--skill-dir', skillDir], extractDir);
		const backupsAfter = readdirSync(profileDir).filter((n) => BACKUP_RE.test(n)).length;
		check('N1.1 a second install is a no-op: exits 0, rewrites nothing, creates no backup',
			second.code === 0
			&& sha256(readFileSync(join(profileDir, 'package.json'))) === pkgHash1
			&& sha256(readFileSync(join(profileDir, 'cordis.patch.yml'))) === patchHash1
			&& sha256(readFileSync(join(skillDir, 'team-flowise', 'SKILL.md'))) === skillHash1
			&& backupsAfter === backupsBefore,
			`exit=${second.code} backups ${backupsBefore}->${backupsAfter}`);
		check('N1.2 after two installs there is still exactly one bundle entry and NO team-flowise row left in the profile patch',
			(readText(join(profileDir, 'cordis.patch.yml')).match(new RegExp(`id:\\s*${ROW_ID}`, 'g')) || []).length === 0
			&& JSON.parse(readText(join(profileDir, 'package.json'))).dsh.profile.bundles.filter((b) => b === PLUGIN_NAME).length === 1);

		const un = runNode([join(extractDir, 'scripts', 'uninstall.mjs'), '--profile', profileDir, '--remove-skill', '--skill-dir', skillDir], extractDir);
		check('U1.1 the inverse script removes it from the extracted copy and exits 0', un.code === 0,
			`exit=${un.code}` + (un.code === 0 ? '' : ' :: ' + (un.stderr || un.stdout).split('\n').slice(-3).join(' / ')));
		const patchAfter = readText(join(profileDir, 'cordis.patch.yml'));
		const pkgAfter = JSON.parse(readText(join(profileDir, 'package.json')));
		check('U1.2 our row is gone while the unrelated plugin\'s row is still there',
			!patchAfter.includes(ROW_ID) && patchAfter.includes('id: unrelated-plugin') && insertRowCount(patchAfter) === 1,
			'rows=' + insertRowCount(patchAfter) + ' :: ' + patchAfter.trim().split('\n').slice(-1)[0]);
		check('U1.3 the dependency and the bundle entry are gone',
			!(pkgAfter.dependencies || {})[PLUGIN_NAME] && !(pkgAfter.dsh.profile.bundles || []).includes(PLUGIN_NAME));
		const chkAfter = runNode([join(extractDir, 'scripts', 'install.mjs'), '--profile', profileDir, '--skill-dir', skillDir, '--check'], extractDir);
		check('U1.4 --check now reports it is NOT installed (exit 3)', chkAfter.code === 3, 'exit=' + chkAfter.code);
	} finally {
		if (opts.keepTemp) console.log(`  ...  temp kept: ${tmpRoot}`);
		else rmSync(tmpRoot, { recursive: true, force: true });
	}

	const after = {
		installer: sha256(readFileSync(INSTALLER)),
		uninstaller: sha256(readFileSync(UNINSTALLER)),
		pkg: sha256(readFileSync(pkgJsonPath)),
		index: sha256(readFileSync(join(opts.pluginDir, 'src', 'index.js'))),
	};
	check('V1.1 the packer did not modify the repository\'s installers or package.json',
		before.installer === after.installer && before.uninstaller === after.uninstaller && before.pkg === after.pkg,
		'installer=' + after.installer.slice(0, 12) + ' uninstaller=' + after.uninstaller.slice(0, 12));

	/* ---- M: prove the completeness gate can actually fail -------------------
	   A gate that has never been seen to reject anything is decoration. This
	   packs a COPY of the package with one required file deleted and asserts the
	   packer refuses it BY NAME and writes no archive. The copy and its output
	   live in the temp dir; the repository is not touched. */
	console.log('\n--- M: the completeness gate really rejects an incomplete package ---');
	const mutRoot = mkdtempSync(join(tmpdir(), 'tf-plugin-pack-mut-'));
	try {
		const stripped = join(mutRoot, 'stripped');
		cpSync(opts.pluginDir, stripped, {
			recursive: true,
			filter: (src) => !SKIP_DIRS.has(src.split(sep).pop()) && !src.endsWith(join('src', 'client', 'index.js')),
		});
		const mutOut = join(mutRoot, 'out');
		const mutRes = runNode([
			fileURLToPath(import.meta.url), '--package-dir', stripped, '--out', mutOut, '--no-verify',
		], REPO_ROOT);
		check('M1.1 an incomplete package is refused (exit 1), not packed into a smaller archive',
			mutRes.code === 1, 'exit=' + mutRes.code);
		check('M1.2 the refusal names the missing file (a bare "failed" is not a diagnosis)',
			/stripped/.test(mutRes.stderr) || /src[\\/]client[\\/]index\.js/.test(mutRes.stderr),
			(mutRes.stderr || mutRes.stdout).trim().split('\n').slice(-1)[0]);
		check('M1.3 the refused run wrote no archive at all',
			!existsSync(mutOut) || readdirSync(mutOut).length === 0,
			existsSync(mutOut) ? readdirSync(mutOut).join(',') : '(no output directory)');
	} finally {
		rmSync(mutRoot, { recursive: true, force: true });
	}

	checksSummary();
	return checks.failed === 0 ? EXIT_OK : EXIT_FAIL;
}

/* ------------------------------------------------------------------ entry */

try {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		process.stdout.write(USAGE);
		process.exit(0);
	}
	process.exit(main(process.argv.slice(2)));
} catch (e) {
	if (e instanceof Fail && e.exitCode === EXIT_OK) process.exit(0);
	if (e instanceof UsageError) {
		process.stderr.write(String(e.message) + '\n');
		process.exit(EXIT_USAGE);
	}
	if (e instanceof Fail) {
		process.stderr.write('pack-plugin: ' + e.message + '\n');
		process.exit(e.exitCode);
	}
	process.stderr.write('pack-plugin: unexpected error: ' + (e && e.stack ? e.stack : String(e)) + '\n');
	process.exit(EXIT_FAIL);
}
