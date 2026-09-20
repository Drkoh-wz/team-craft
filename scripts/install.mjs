#!/usr/bin/env node
/**
 * scripts/install.mjs — portable, idempotent installer for the
 * `@local/team-flowise` plugin into a dsh profile.
 *
 * What it does (all steps idempotent — running it twice changes nothing):
 *   1. validates that `--profile` really is a dsh profile;
 *   2. links/creates <profile>/node_modules/@local/team-flowise -> <package>;
 *   3. adds the dependency entry to <profile>/package.json (portable `file:` spec
 *      by default) and appends the bundle name to `dsh.profile.bundles`;
 *   4. appends the `- insert:` host-composition row to <profile>/cordis.patch.yml
 *      when it is not there yet (never rewrites the user's existing lines);
 *   5. copies the plugin's skill (when the package ships one) into a skill root;
 *   6. prints what a restart is needed for and how to verify afterwards.
 *
 * Safety rules enforced by this script:
 *   - a link/entry that exists but points somewhere else is a hard error, never a
 *     silent overwrite (`--force` is the explicit escape hatch);
 *   - files are changed by parsing + targeted edit, then written atomically, and
 *     every overwritten file is backed up to `<file>.bak-<timestamp>` first;
 *   - the only Node dependencies are `node:` builtins — no external packages.
 *
 * Usage: node scripts/install.mjs [options]   (see --help)
 */

import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ constants */

const PLUGIN_NAME = '@local/team-flowise';
const ROW_ID = 'flowise-team';
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'team-flowise');

const DSH_HOME = (() => {
	const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
	return raw.length > 0 ? resolve(raw) : join(homedir(), '.dsh');
})();
const DEFAULT_PROFILE_DIR = join(DSH_HOME, 'profiles', 'web');
const DEFAULT_SKILL_DIR = join(DSH_HOME, 'skills');

/** The row appended to cordis.patch.yml — identical in shape to the hand-written one. */
const INSERT_BLOCK = [
	'- insert:',
	`    - id: ${ROW_ID}`,
	`      name: '${PLUGIN_NAME}'`,
	'      disabled: false',
];

const USAGE = `team-flowise installer — mount @local/team-flowise into a dsh profile

Usage:
  node scripts/install.mjs [options]

Options:
  --profile <dir>      target dsh profile directory
                       (default: <DSH_HOME>/profiles/web, DSH_HOME defaults to ~/.dsh)
  --package <dir>      the plugin package directory
                       (default: <repo>/packages/team-flowise, i.e. beside this script)
  --dry-run            print every planned change (with a line diff) and write nothing
  --check              verify the current state only; exit 0 = installed and consistent,
                       exit 3 = missing or inconsistent (nothing is written)
  --force              replace a link/entry/skill that exists but differs
                       (default: report the conflict and exit 1)
  --link-mode <mode>   junction (default on Windows; no admin needed) | symlink | copy
  --dep-spec <spec>    dependency value written to package.json:
                       auto (default)  -> "file:<relative>" when a relative path exists,
                                          otherwise "file:<absolute>"
                       relative        -> "file:<relative to the profile>"
                       absolute        -> "file:<absolute>"
                       link            -> "link:<absolute>" (legacy pnpm form, machine-specific)
                       <raw>           -> used verbatim (e.g. file:../../packages/team-flowise)
  --skill-root <root>  where to install the skill: dsh (default: <DSH_HOME>/skills)
                       | agents (<home>/.agents/skills) | project (<repo>/.dsh/skills)
                       | none (do not install a skill)
  --skill-dir <dir>    explicit skill root, overrides --skill-root
  --skill-source <dir> explicit skill source (a directory with SKILL.md, or a single .md file)
  --json               machine-readable report on stdout (human log goes to stderr)
  --help, -h           this text

Exit codes: 0 = ok, 1 = error/conflict, 3 = --check found missing or inconsistent state.

Everything this script does is idempotent: running it again reports
"已存在，跳过" for every step and writes nothing. Files it rewrites are first
backed up to <file>.bak-<timestamp>. Restart dsh afterwards (host code and the
client bundle are loaded/snapshotted at startup).
`;

/* ------------------------------------------------------------------ plumbing */

class UsageError extends Error {}
class FatalError extends Error {}

let JSON_MODE = false;
const STEPS = [];
const CHANGES = [];
const ADDED = { link: 0, dep: 0, bundles: 0, insertRows: 0, skill: 0 };

function log(msg = '') {
	if (JSON_MODE) process.stderr.write(`${msg}\n`);
	else process.stdout.write(`${msg}\n`);
}

const TAG = {
	added: '[新增]',
	changed: '[更新]',
	unchanged: '[跳过]',
	skipped: '[不适用]',
	missing: '[缺失]',
	conflict: '[冲突]',
	error: '[错误]',
	info: '[信息]',
};

function record(step, status, detail, extra) {
	const item = { step, status, detail, ...(extra || {}) };
	STEPS.push(item);
	const key = { '1-link': 'link', '2-dependency': 'dep', '3-bundles': 'bundles', '4-patch-row': 'insertRows', '5-skill': 'skill' }[step];
	if (key !== undefined && (status === 'added' || status === 'changed')) ADDED[key] += 1;
	log(`${TAG[status] || TAG.info} ${step}：${detail}`);
	return item;
}

/* ------------------------------------------------------------------ fs helpers */

function isDir(p) {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

function readText(p) {
	return readFileSync(p, 'utf8');
}

function toPosix(p) {
	return p.split(sep).join('/');
}

function normKey(p) {
	const r = resolve(p);
	return process.platform === 'win32' ? r.toLowerCase() : r;
}

function samePath(a, b) {
	return normKey(a) === normKey(b);
}

function sameRealPath(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string') return false;
	let ra = resolve(a);
	let rb = resolve(b);
	try {
		ra = realpathSync.native(resolve(a));
	} catch {
		/* keep the un-resolved path */
	}
	try {
		rb = realpathSync.native(resolve(b));
	} catch {
		/* keep the un-resolved path */
	}
	return normKey(ra) === normKey(rb);
}

function timestamp(d = new Date()) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sha256Text(text) {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256File(p) {
	return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function isPlainObject(v) {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON formatting of a file, so a rewrite keeps its indentation/EOL/trailing newline. */
function jsonStyle(text) {
	const m = /^([ \t]+)"/m.exec(text);
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	return { indent: m ? m[1] : '  ', eol, trailingNewline: text.length === 0 ? true : text.endsWith('\n') };
}

function stringifyJson(obj, style) {
	const body = JSON.stringify(obj, null, style.indent);
	const withEol = style.eol === '\n' ? body : body.split('\n').join(style.eol);
	return style.trailingNewline ? `${withEol}${style.eol}` : withEol;
}

/** Minimal LCS line diff, for --dry-run output. */
function lineDiff(oldText, newText) {
	const a = oldText === null ? [] : oldText.split('\n');
	const b = newText.split('\n');
	const m = a.length;
	const n = b.length;
	const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
	for (let i = m - 1; i >= 0; i -= 1) {
		for (let j = n - 1; j >= 0; j -= 1) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const out = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			out.push(`  ${a[i]}`);
			i += 1;
			j += 1;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push(`- ${a[i]}`);
			i += 1;
		} else {
			out.push(`+ ${b[j]}`);
			j += 1;
		}
	}
	while (i < m) {
		out.push(`- ${a[i]}`);
		i += 1;
	}
	while (j < n) {
		out.push(`+ ${b[j]}`);
		j += 1;
	}
	return out;
}

/** sha256 map of a directory tree: relative posix path -> hash (or `link:<target>`). */
function hashTree(root) {
	const map = new Map();
	const walk = (dir, rel) => {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
		for (const e of entries) {
			const abs = join(dir, e.name);
			const relPath = rel === '' ? e.name : `${rel}/${e.name}`;
			if (e.isDirectory()) walk(abs, relPath);
			else if (e.isSymbolicLink()) map.set(relPath, `link:${readlinkSync(abs)}`);
			else if (e.isFile()) map.set(relPath, sha256File(abs));
		}
	};
	walk(root, '');
	return map;
}

function mapsEqual(a, b) {
	if (a.size !== b.size) return false;
	for (const [k, v] of a) if (b.get(k) !== v) return false;
	return true;
}

/** First free path based on `p` (appends -1, -2, … when a backup of that name exists). */
function uniquePath(p) {
	if (!existsSync(p)) return p;
	for (let i = 1; i < 1000; i += 1) {
		const candidate = `${p}-${i}`;
		if (!existsSync(candidate)) return candidate;
	}
	return `${p}-${Date.now()}`;
}

function copyTree(src, dst, exclude = []) {
	mkdirSync(dst, { recursive: true });
	for (const e of readdirSync(src, { withFileTypes: true })) {
		if (exclude.includes(e.name)) continue;
		const s = join(src, e.name);
		const d = join(dst, e.name);
		if (e.isDirectory()) copyTree(s, d, exclude);
		else if (e.isFile()) copyFileSync(s, d);
	}
}

/** Inspect a path without following the final link. */
function inspectPath(p) {
	let st;
	try {
		st = lstatSync(p);
	} catch (error) {
		if (error && error.code === 'ENOENT') return { kind: 'missing' };
		throw error;
	}
	if (st.isSymbolicLink()) {
		let target = null;
		try {
			target = readlinkSync(p);
		} catch {
			/* unreadable link: report it as a link with an unknown target */
		}
		const abs = target === null ? null : isAbsolute(target) ? target : resolve(dirname(p), target);
		return { kind: 'link', target, abs };
	}
	if (st.isDirectory()) return { kind: 'dir' };
	return { kind: 'file' };
}

/* ------------------------------------------------------------------ patch layer */

function unquoteScalar(v) {
	const t = String(v).trim();
	if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) return t.slice(1, -1);
	return t;
}

/**
 * Line-based scan of a cordis.patch.yml. Intentional: rewriting the whole file
 * through a YAML emitter would destroy the user's comments (the real profile's
 * patch file is hand-edited), and a duplicate row id makes dsh fail to boot
 * (`duplicate loader entry id`), so the row must be found and counted exactly.
 */
function scanPatchLayer(text) {
	const lines = text.split('\n');
	const idRe = new RegExp(`^\\s*-\\s*id\\s*:\\s*${ROW_ID}\\s*$`);
	const idLines = [];
	for (let i = 0; i < lines.length; i += 1) if (idRe.test(lines[i])) idLines.push(i);

	const inserts = [];
	for (let i = 0; i < lines.length; i += 1) {
		const m = /^(\s*)-\s*insert\s*:\s*$/.exec(lines[i]);
		if (!m) continue;
		const indent = m[1].length;
		let end = i;
		for (let j = i + 1; j < lines.length; j += 1) {
			if (lines[j].trim() === '') continue;
			const ind = lines[j].length - lines[j].trimStart().length;
			if (ind > indent) {
				end = j;
				continue;
			}
			break;
		}
		inserts.push({ start: i, end, indent });
	}

	const rows = idLines.map((ln) => {
		const block = inserts.find((b) => b.start < ln && ln <= b.end) || null;
		const rowIndent = lines[ln].length - lines[ln].trimStart().length;
		let name = null;
		let disabled = null;
		for (let j = ln + 1; j < lines.length; j += 1) {
			if (lines[j].trim() === '') continue;
			const ind = lines[j].length - lines[j].trimStart().length;
			if (ind <= rowIndent) break;
			const nm = /^\s*name\s*:\s*(.*?)\s*$/.exec(lines[j]);
			if (nm && name === null) name = unquoteScalar(nm[1]);
			const dm = /^\s*disabled\s*:\s*(\S+)\s*$/.exec(lines[j]);
			if (dm && disabled === null) disabled = dm[1];
		}
		return { line: ln, block, name, disabled };
	});

	const emptyArrayLines = [];
	const entryLines = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (/^\s*\[\s*\]\s*$/.test(lines[i])) emptyArrayLines.push(i);
		else if (/^\s*-\s/.test(lines[i])) entryLines.push(i);
	}
	return { lines, rows, inserts, emptyArrayLines, entryLines };
}

/** Append the insert block, keeping every existing line byte-identical. */
function appendInsertBlock(text, blockLines) {
	const src = text.endsWith('\n') ? text.slice(0, -1) : text;
	const lines = src === '' ? [] : src.split('\n');
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	if (lines.length > 0) lines.push('');
	lines.push(...blockLines);
	return `${lines.join('\n')}\n`;
}

/** Replace the `[]` placeholders line (a valid empty patch array) with the block. */
function replaceEmptyArrayLine(lines, index, blockLines) {
	const out = lines.slice();
	out.splice(index, 1, ...blockLines);
	const joined = out.join('\n');
	return joined.endsWith('\n') ? joined : `${joined}\n`;
}

/* ------------------------------------------------------------------ skill helpers */

/** Inlined copy of the host's own frontmatter rules (dsh-skill parseSkillFile). */
function parseSkillFrontmatter(text) {
	const lines = text.split('\n');
	if (lines.length === 0 || lines[0].replace(/\r$/, '') !== '---') return { ok: false, reason: 'missing YAML frontmatter' };
	let end = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].replace(/\r$/, '') === '---') {
			end = i;
			break;
		}
	}
	if (end < 0) return { ok: false, reason: 'missing YAML frontmatter' };
	const fields = {};
	for (let i = 1; i < end; i += 1) {
		const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
		if (m) fields[m[1]] = unquoteScalar(m[2]);
	}
	const name = fields.name;
	const description = fields.description;
	if (typeof name !== 'string' || name.length === 0 || typeof description !== 'string' || description.length === 0) {
		return { ok: false, reason: 'frontmatter requires name and description' };
	}
	if (!SKILL_NAME_RE.test(name)) return { ok: false, reason: `invalid skill name "${name}"` };
	return { ok: true, name, description };
}

function resolveSkillSource(opts, pkgDir) {
	const candidates = [];
	if (opts.skillSource) candidates.push(resolve(opts.skillSource));
	const roots = [join(pkgDir, 'skills'), join(REPO_ROOT, 'skills'), join(pkgDir, '..', 'skills')];
	const searched = [];
	for (const root of roots) {
		searched.push(root);
		if (!isDir(root)) continue;
		const hits = readdirSync(root, { withFileTypes: true })
			.filter((e) => /^team-flowise(-|$)/.test(e.name) && (e.isDirectory() || (e.isFile() && e.name.endsWith('.md'))))
			.map((e) => join(root, e.name))
			.sort();
		for (const hit of hits) candidates.push(hit);
	}
	for (const c of candidates) {
		if (!existsSync(c)) continue;
		const isDirSrc = isDir(c);
		const skillFile = isDirSrc ? join(c, 'SKILL.md') : c;
		if (!isFile(skillFile)) continue;
		return { src: c, isDir: isDirSrc, skillFile, searched };
	}
	return { src: null, isDir: false, skillFile: null, searched: opts.skillSource ? [resolve(opts.skillSource)] : searched };
}

/* ------------------------------------------------------------------ dep spec */

function specPathFrom(spec, baseDir) {
	if (typeof spec !== 'string') return null;
	const m = /^(link|file|portal):(.*)$/.exec(spec);
	const rest = (m ? m[2] : spec).trim();
	if (rest === '') return null;
	if (/^[a-zA-Z]:[\\/]/.test(rest) || rest.startsWith('/') || rest.startsWith('\\\\')) return resolve(rest);
	if (rest.startsWith('./') || rest.startsWith('../')) return resolve(baseDir, rest);
	return null;
}

function specPointsAt(spec, baseDir, target) {
	const p = specPathFrom(spec, baseDir);
	return p !== null && sameRealPath(p, target);
}

function desiredDepSpec(ctx) {
	const mode = ctx.depSpec;
	const abs = toPosix(resolve(ctx.pkg));
	if (mode === 'absolute') return `file:${abs}`;
	if (mode === 'link') return `link:${abs}`;
	const rel = relative(ctx.profile, ctx.pkg);
	const relOk = rel !== '' && !isAbsolute(rel);
	if (mode === 'relative') {
		if (!relOk) throw new FatalError(`--dep-spec relative 无法表达：${ctx.profile} 与 ${ctx.pkg} 不在同一盘符/根下`);
		return `file:${toPosix(rel)}`;
	}
	if (mode === 'auto') return relOk ? `file:${toPosix(rel)}` : `file:${abs}`;
	return mode; // verbatim
}

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
	const opts = {
		profile: null,
		pkg: null,
		dryRun: false,
		check: false,
		force: false,
		json: false,
		help: false,
		linkMode: process.platform === 'win32' ? 'junction' : 'symlink',
		depSpec: 'auto',
		skillRoot: 'dsh',
		skillDir: null,
		skillSource: null,
	};
	const withValue = new Map([
		['--profile', 'profile'],
		['--package', 'pkg'],
		['--link-mode', 'linkMode'],
		['--dep-spec', 'depSpec'],
		['--skill-root', 'skillRoot'],
		['--skill-dir', 'skillDir'],
		['--skill-source', 'skillSource'],
	]);
	const booleans = new Map([
		['--dry-run', 'dryRun'],
		['--check', 'check'],
		['--force', 'force'],
		['--json', 'json'],
		['--help', 'help'],
		['-h', 'help'],
	]);
	for (let i = 0; i < argv.length; i += 1) {
		let arg = argv[i];
		let inline = null;
		const eq = arg.indexOf('=');
		if (arg.startsWith('--') && eq > 0) {
			inline = arg.slice(eq + 1);
			arg = arg.slice(0, eq);
		}
		if (booleans.has(arg)) {
			opts[booleans.get(arg)] = true;
			continue;
		}
		if (withValue.has(arg)) {
			const value = inline !== null ? inline : argv[i + 1];
			if (inline === null) i += 1;
			if (value === undefined) throw new UsageError(`缺少 ${arg} 的值`);
			opts[withValue.get(arg)] = value;
			continue;
		}
		throw new UsageError(`未知参数：${arg}`);
	}
	if (opts.dryRun && opts.check) throw new UsageError('--dry-run 与 --check 互斥');
	if (!['junction', 'symlink', 'copy'].includes(opts.linkMode)) throw new UsageError(`未知 --link-mode：${opts.linkMode}（可选 junction | symlink | copy）`);
	if (!['auto', 'relative', 'absolute', 'link'].includes(opts.depSpec) && opts.depSpec.trim() === '') throw new UsageError('--dep-spec 不能为空');
	if (!['dsh', 'agents', 'project', 'none'].includes(opts.skillRoot)) throw new UsageError(`未知 --skill-root：${opts.skillRoot}（可选 dsh | agents | project | none）`);
	return opts;
}

/* ------------------------------------------------------------------ steps */

function validateProfile(ctx) {
	const dir = ctx.profile;
	if (!existsSync(dir)) throw new FatalError(`profile 目录不存在：${dir}`);
	if (!isDir(dir)) throw new FatalError(`--profile 不是目录：${dir}`);
	if (samePath(dir, ctx.pkg)) throw new FatalError('--profile 与 --package 指向同一个目录，拒绝执行');
	const pkgJsonPath = join(dir, 'package.json');
	if (!isFile(pkgJsonPath)) throw new FatalError(`不是 dsh profile：缺少 ${pkgJsonPath}`);
	const text = readText(pkgJsonPath);
	let obj;
	try {
		obj = JSON.parse(text);
	} catch (error) {
		throw new FatalError(`profile 的 package.json 不是合法 JSON：${error.message}`);
	}
	if (!isPlainObject(obj)) throw new FatalError(`profile 的 package.json 顶层不是对象：${pkgJsonPath}`);
	const cordisYml = join(dir, 'cordis.yml');
	const patchYml = join(dir, 'cordis.patch.yml');
	if (!existsSync(cordisYml) && !existsSync(patchYml)) {
		throw new FatalError(`不是 dsh profile：${dir} 下既没有 cordis.yml 也没有 cordis.patch.yml`);
	}
	return { pkgJsonPath, text, obj, hasCordisYml: existsSync(cordisYml), patchPath: patchYml, patchExists: existsSync(patchYml) };
}

function validatePackage(ctx) {
	const dir = ctx.pkg;
	if (!isDir(dir)) throw new FatalError(`--package 不是目录：${dir}`);
	const pj = join(dir, 'package.json');
	if (!isFile(pj)) throw new FatalError(`--package 下没有 package.json：${pj}`);
	let parsed;
	try {
		parsed = JSON.parse(readText(pj));
	} catch (error) {
		throw new FatalError(`--package 的 package.json 不是合法 JSON：${error.message}`);
	}
	if (parsed.name !== PLUGIN_NAME) {
		throw new FatalError(`--package 的 package.json name 是 "${parsed.name}"，期望 "${PLUGIN_NAME}"：装了错的包`);
	}
	if (!isFile(join(dir, 'src', 'index.js'))) log(`[警告] 缺少宿主半入口 ${join(dir, 'src', 'index.js')}：安装后宿主可能加载失败`);
	if (!isFile(join(dir, 'src', 'client', 'index.js'))) log(`[警告] 缺少客户端半 ${join(dir, 'src', 'client', 'index.js')}：设置页与进度面板不会出现`);
	return parsed;
}

function createLink(ctx, linkPath) {
	mkdirSync(dirname(linkPath), { recursive: true });
	try {
		if (ctx.linkMode === 'copy') copyTree(ctx.pkg, linkPath, ['node_modules']);
		else symlinkSync(ctx.pkg, linkPath, ctx.linkMode === 'junction' ? 'junction' : 'dir');
	} catch (error) {
		if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
			throw new FatalError(
				`创建 ${ctx.linkMode} 链接被系统拒绝（${error.code}）：${linkPath}\n` +
					'  Windows 上 junction 不需要管理员权限；symlink 需要开发者模式或管理员。\n' +
					'  补救：使用默认 --link-mode junction，或在无权限环境下显式改用 --link-mode copy\n' +
					'  （复制模式不会跟随源码改动，改完源码必须重跑安装）。',
			);
		}
		throw error;
	}
	ctx.undo.push({ kind: 'link', path: linkPath, mode: ctx.linkMode });
}

function stepLink(ctx) {
	const linkPath = join(ctx.profile, 'node_modules', PLUGIN_NAME);
	const info = inspectPath(linkPath);

	if (info.kind === 'missing') {
		if (ctx.check) return record('1-link', 'missing', `node_modules 链接缺失：${linkPath}`);
		if (ctx.dryRun) return record('1-link', 'added', `将创建 ${ctx.linkMode} 链接：${linkPath} → ${ctx.pkg}`);
		createLink(ctx, linkPath);
		return record('1-link', 'added', `已创建 ${ctx.linkMode} 链接：${linkPath} → ${ctx.pkg}`);
	}

	if (info.kind === 'link') {
		if (sameRealPath(info.abs, ctx.pkg)) {
			return record('1-link', 'unchanged', `已存在，跳过：链接已指向 ${ctx.pkg}`);
		}
		const detail = `链接指向 ${info.abs ?? '(未知目标)'}，不是 ${ctx.pkg}`;
		if (!ctx.force) {
			if (ctx.check) return record('1-link', 'conflict', detail);
			throw new FatalError(`node_modules 链接冲突：${detail}\n  脚本不会悄悄覆盖；确认后加 --force 重建，或先跑 uninstall.mjs。`);
		}
		if (ctx.dryRun) return record('1-link', 'changed', `将删除旧链接（${info.abs ?? '(未知目标)'}）并重建 → ${ctx.pkg}`);
		rmSync(linkPath, { recursive: false, force: true });
		createLink(ctx, linkPath);
		return record('1-link', 'changed', `已重建链接：${linkPath} → ${ctx.pkg}（旧目标 ${info.abs ?? '(未知目标)'}）`);
	}

	if (info.kind === 'dir') {
		const identical = mapsEqual(hashTree(linkPath), hashTree(ctx.pkg));
		if (ctx.linkMode === 'copy' && identical) {
			return record('1-link', 'unchanged', '已存在，跳过：目录副本内容与包一致（copy 模式）');
		}
		const detail = `该路径是真实目录（不是链接）${identical ? '，内容与包一致' : '，内容与包不同'}：${linkPath}`;
		if (!ctx.force) {
			if (ctx.check) return record('1-link', 'conflict', detail);
			throw new FatalError(`${detail}\n  脚本不会删除真实目录；确认后加 --force（会先改名为 .bak-<时间戳> 再建链接），或先跑 uninstall.mjs。`);
		}
		if (ctx.dryRun) return record('1-link', 'changed', `将把真实目录改名为 ${linkPath}.bak-<ts> 并创建链接 → ${ctx.pkg}`);
		const backup = uniquePath(`${linkPath}.bak-${ctx.ts}`);
		renameSync(linkPath, backup);
		ctx.undo.push({ kind: 'moved', from: linkPath, to: backup });
		CHANGES.push({ file: linkPath, backup });
		createLink(ctx, linkPath);
		return record('1-link', 'changed', `真实目录已改名为 ${backup}，并创建链接 → ${ctx.pkg}`);
	}

	const detail = `该路径已存在但不是目录/链接（${info.kind}）：${linkPath}`;
	if (ctx.check) return record('1-link', 'conflict', detail);
	throw new FatalError(`${detail}\n  请人工处理后再运行。`);
}

function stepManifest(ctx, profile) {
	const file = profile.pkgJsonPath;
	const obj = profile.obj;
	const style = jsonStyle(profile.text);
	const desired = desiredDepSpec(ctx);
	ctx.depSpecResolved = desired;

	if (!isPlainObject(obj.dependencies)) obj.dependencies = {};
	const deps = obj.dependencies;
	const current = deps[PLUGIN_NAME];
	let depStatus;
	let depDetail;
	if (current === undefined) {
		depStatus = 'add';
		depDetail = `dependencies 缺失，将写入 "${PLUGIN_NAME}": "${desired}"`;
	} else if (specPointsAt(current, ctx.profile, ctx.pkg)) {
		depStatus = 'keep';
		depDetail = `已存在，跳过：dependencies["${PLUGIN_NAME}"] = "${current}"（已指向 ${ctx.pkg}）`;
	} else {
		depStatus = 'conflict';
		depDetail = `dependencies["${PLUGIN_NAME}"] = "${current}"，与目标包不一致（期望指向 ${ctx.pkg}）`;
	}

	if (!isPlainObject(obj.dsh)) obj.dsh = {};
	if (!isPlainObject(obj.dsh.profile)) obj.dsh.profile = {};
	if (!Array.isArray(obj.dsh.profile.bundles)) obj.dsh.profile.bundles = [];
	const bundles = obj.dsh.profile.bundles;
	const hits = bundles.filter((b) => b === PLUGIN_NAME).length;
	let bundleStatus;
	let bundleDetail;
	if (hits === 0) {
		bundleStatus = 'add';
		bundleDetail = `dsh.profile.bundles 缺失，将追加 "${PLUGIN_NAME}"`;
	} else if (hits === 1) {
		bundleStatus = 'keep';
		bundleDetail = `已存在，跳过：dsh.profile.bundles 已有 "${PLUGIN_NAME}"（1 项）`;
	} else {
		bundleStatus = 'dedupe';
		bundleDetail = `dsh.profile.bundles 里 "${PLUGIN_NAME}" 重复 ${hits} 次，将去重为 1 项`;
	}

	const depRecordStatus = depStatus === 'keep' ? 'unchanged' : depStatus === 'add' ? 'missing' : 'conflict';
	const bundleRecordStatus = bundleStatus === 'keep' ? 'unchanged' : bundleStatus === 'add' ? 'missing' : 'conflict';

	if (depStatus === 'conflict' && !ctx.force) {
		if (ctx.check) {
			record('2-dependency', depRecordStatus, depDetail);
			record('3-bundles', bundleRecordStatus, bundleDetail);
			return;
		}
		throw new FatalError(`${depDetail}\n  脚本不会悄悄改依赖值；确认后加 --force（会先备份 package.json），或手工修正。`);
	}
	if (depStatus === 'conflict') {
		depStatus = 'set';
		depDetail = `dependencies["${PLUGIN_NAME}"]: "${current}" → "${desired}"（--force）`;
	}

	const willChange = depStatus !== 'keep' || bundleStatus !== 'keep';
	if (!willChange) {
		record('2-dependency', 'unchanged', depDetail);
		record('3-bundles', 'unchanged', bundleDetail);
		return;
	}

	if (depStatus === 'add' || depStatus === 'set') deps[PLUGIN_NAME] = desired;
	if (bundleStatus === 'add') bundles.push(PLUGIN_NAME);
	if (bundleStatus === 'dedupe') {
		let seen = false;
		obj.dsh.profile.bundles = bundles.filter((b) => {
			if (b !== PLUGIN_NAME) return true;
			if (seen) return false;
			seen = true;
			return true;
		});
	}

	// Past-tense wording for the branch that really writes; the planned wording stays for --dry-run.
	const depDoneDetail =
		depStatus === 'add'
			? `已写入 dependencies["${PLUGIN_NAME}"] = "${desired}"`
			: depStatus === 'set'
				? `已更新 dependencies["${PLUGIN_NAME}"]: "${current}" → "${desired}"（--force）`
				: depDetail;
	const bundleDoneDetail =
		bundleStatus === 'add'
			? `已在 dsh.profile.bundles 末尾追加 "${PLUGIN_NAME}"`
			: bundleStatus === 'dedupe'
				? `已把 dsh.profile.bundles 里的 "${PLUGIN_NAME}" 去重为 1 项`
				: bundleDetail;

	const after = stringifyJson(obj, style);
	if (ctx.check) {
		record('2-dependency', depRecordStatus, depDetail);
		record('3-bundles', bundleRecordStatus, bundleDetail);
		return;
	}
	if (ctx.dryRun) {
		log(`[dry-run] ${file} 的逐行 diff：`);
		for (const line of lineDiff(profile.text, after)) log(`    ${line}`);
		if (depStatus !== 'keep') record('2-dependency', depStatus === 'add' ? 'added' : 'changed', depDetail);
		else record('2-dependency', 'unchanged', depDetail);
		if (bundleStatus !== 'keep') record('3-bundles', bundleStatus === 'add' ? 'added' : 'changed', bundleDetail);
		else record('3-bundles', 'unchanged', bundleDetail);
		return;
	}

	const backup = `${file}.bak-${ctx.ts}`;
	if (!existsSync(backup)) copyFileSync(file, backup);
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, after, 'utf8');
	renameSync(tmp, file);
	ctx.undo.push({ kind: 'file', file, backup });
	CHANGES.push({ file, backup });

	if (depStatus !== 'keep') record('2-dependency', depStatus === 'add' ? 'added' : 'changed', depDoneDetail);
	else record('2-dependency', 'unchanged', depDetail);
	if (bundleStatus !== 'keep') record('3-bundles', bundleStatus === 'add' ? 'added' : 'changed', bundleDoneDetail);
	else record('3-bundles', 'unchanged', bundleDetail);
}

function stepPatchRow(ctx, profile) {
	const file = profile.patchPath;
	const existed = profile.patchExists;
	const text = existed ? readText(file) : '';

	if (!existed) {
		const body = `# dsh profile patch layer (top-level YAML array of loader patch entries).\n${INSERT_BLOCK.join('\n')}\n`;
		if (ctx.check) return record('4-patch-row', 'missing', `缺少 cordis.patch.yml（应包含 ${ROW_ID} 的 insert 行）：${file}`);
		if (ctx.dryRun) return record('4-patch-row', 'added', `将创建 ${file} 并写入 ${ROW_ID} 的 insert 行`);
		writeFileSync(file, body, 'utf8');
		ctx.undo.push({ kind: 'file', file, backup: null });
		CHANGES.push({ file, backup: null });
		return record('4-patch-row', 'added', `已创建 ${file} 并写入 ${ROW_ID} 的 insert 行`);
	}

	const scan = scanPatchLayer(text);
	ctx.patchScan = scan;

	if (scan.rows.length === 1) {
		const row = scan.rows[0];
		const insideInsert = row.block !== null;
		const nameOk = row.name === PLUGIN_NAME;
		const enabledOk = row.disabled === 'false';
		if (insideInsert && nameOk && enabledOk) {
			return record('4-patch-row', 'unchanged', `已存在，跳过：${file} 第 ${row.line + 1} 行的 insert 行（id: ${ROW_ID} / name: '${PLUGIN_NAME}' / disabled: false）`);
		}
		const detail =
			`${file} 第 ${row.line + 1} 行的 id: ${ROW_ID} 已存在但形态不同` +
			`（${insideInsert ? '在 insert 块内' : '不在 insert 块内'}，name=${row.name ?? '(缺失)'}，disabled=${row.disabled ?? '(缺失)'}）`;
		if (ctx.check) return record('4-patch-row', 'conflict', detail);
		throw new FatalError(`${detail}\n  --force 不会改写用户已有的行；请人工确认该行（它决定插件是否被装配）。`);
	}

	if (scan.rows.length > 1) {
		const detail = `${file} 里有 ${scan.rows.length} 条 id: ${ROW_ID}（第 ${scan.rows.map((r) => r.line + 1).join(', ')} 行）——重复 id 会让 dsh 启动直接抛 TypeError: duplicate loader entry id`;
		if (ctx.check) return record('4-patch-row', 'conflict', detail);
		throw new FatalError(`${detail}\n  请人工删除多余的行；脚本不会猜哪一条该留。`);
	}

	// No row yet: append (or fill the `[]` placeholder).
	const canFillPlaceholder = scan.emptyArrayLines.length === 1 && scan.entryLines.length === 0;
	const after = canFillPlaceholder ? replaceEmptyArrayLine(scan.lines, scan.emptyArrayLines[0], INSERT_BLOCK) : appendInsertBlock(text, INSERT_BLOCK);
	const how = canFillPlaceholder ? `把第 ${scan.emptyArrayLines[0] + 1} 行的空数组 [] 替换为 insert 块` : '在文件末尾追加 insert 块';

	if (ctx.check) return record('4-patch-row', 'missing', `${file} 里没有 id: ${ROW_ID} 的 insert 行（安装时会${how}）`);
	if (ctx.dryRun) {
		log(`[dry-run] ${file} 的逐行 diff：`);
		for (const line of lineDiff(text, after)) log(`    ${line}`);
		return record('4-patch-row', 'added', `将${how}`);
	}

	const verify = scanPatchLayer(after);
	if (verify.rows.length !== 1) throw new FatalError(`内部校验失败：写入后 id: ${ROW_ID} 出现 ${verify.rows.length} 次，已放弃写入 ${file}`);

	const backup = `${file}.bak-${ctx.ts}`;
	if (!existsSync(backup)) copyFileSync(file, backup);
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, after, 'utf8');
	renameSync(tmp, file);
	ctx.undo.push({ kind: 'file', file, backup });
	CHANGES.push({ file, backup });
	return record('4-patch-row', 'added', `已${how}（原文件备份为 ${backup}）`);
}

function stepSkill(ctx) {
	if (ctx.skillRoot === 'none' && ctx.skillDir === null) {
		return record('5-skill', 'skipped', '已指定 --skill-root none，跳过技能安装');
	}
	const found = resolveSkillSource(ctx.opts, ctx.pkg);
	if (found.src === null) {
		if (ctx.opts.skillSource) throw new FatalError(`--skill-source 下没有可用的技能（需要目录内含 SKILL.md，或单个 .md 文件）：${ctx.opts.skillSource}`);
		return record('5-skill', 'skipped', `插件包当前不携带技能文件，跳过（已查找：${found.searched.join(' , ')}）`);
	}

	const meta = parseSkillFrontmatter(readText(found.skillFile));
	if (!meta.ok) {
		throw new FatalError(`技能源 ${found.skillFile} 的 frontmatter 不合规（宿主会静默忽略它）：${meta.reason}`);
	}

	const srcName = found.isDir ? found.src.split(/[\\/]/).pop() : found.src.split(/[\\/]/).pop().replace(/\.md$/, '');
	const targetName = SKILL_NAME_RE.test(srcName) ? srcName : meta.name;
	const target = found.isDir ? join(ctx.skillDir, targetName) : join(ctx.skillDir, `${targetName}.md`);
	ctx.skillTarget = target;

	const exists = existsSync(target);
	const same = exists && (found.isDir ? mapsEqual(hashTree(found.src), hashTree(target)) : sha256File(found.src) === sha256File(target));

	if (same) return record('5-skill', 'unchanged', `已存在，跳过：技能内容逐字节一致（${target}，name: ${meta.name}）`);

	if (exists && !ctx.force) {
		const detail = `技能已存在于 ${target} 但内容与 ${found.src} 不一致`;
		if (ctx.check) return record('5-skill', 'conflict', detail);
		throw new FatalError(`${detail}\n  脚本不会覆盖它；确认后加 --force（旧内容会被移出技能根目录保留），或手工合并。`);
	}

	if (!exists && ctx.check) return record('5-skill', 'missing', `技能未安装：${target}`);

	if (ctx.dryRun) {
		return record('5-skill', exists ? 'changed' : 'added', `${exists ? '将覆盖' : '将安装'}技能：${found.src} → ${target}`);
	}

	mkdirSync(ctx.skillDir, { recursive: true });
	let backup = null;
	if (exists) {
		// Move the old copy OUT of the skill root: a copy merely renamed inside the root
		// would still be discovered (the skill name comes from frontmatter, not from the
		// directory name), so "renamed in place" is not an uninstall.
		backup = uniquePath(join(ctx.skillDir, '..', `.team-flowise-removed-${ctx.ts}`, target.split(/[\\/]/).pop()));
		mkdirSync(dirname(backup), { recursive: true });
		renameSync(target, backup);
		ctx.undo.push({ kind: 'moved', from: target, to: backup });
		CHANGES.push({ file: target, backup });
	} else {
		ctx.undo.push({ kind: 'removePath', path: target });
	}
	if (found.isDir) copyTree(found.src, target);
	else copyFileSync(found.src, target);
	return record('5-skill', exists ? 'changed' : 'added', `${exists ? '已覆盖' : '已安装'}技能：${target}${backup ? `（旧内容已移出技能根目录保留在 ${backup}）` : ''}`);
}

/* ------------------------------------------------------------------ rollback */

function rollback(ctx) {
	const done = [];
	const failed = [];
	for (const action of ctx.undo.slice().reverse()) {
		try {
			if (action.kind === 'file') {
				if (action.backup && existsSync(action.backup)) copyFileSync(action.backup, action.file);
				else if (existsSync(action.file)) rmSync(action.file, { force: true });
			} else if (action.kind === 'link') {
				if (existsSync(action.path)) rmSync(action.path, { recursive: action.mode === 'copy', force: true });
			} else if (action.kind === 'moved') {
				if (existsSync(action.to)) renameSync(action.to, action.from);
			} else if (action.kind === 'removePath') {
				if (existsSync(action.path)) rmSync(action.path, { recursive: true, force: true });
			}
			done.push(action);
		} catch (error) {
			failed.push({ action, error: String(error && error.message ? error.message : error) });
		}
	}
	return { done, failed };
}

/* ------------------------------------------------------------------ report */

function counts() {
	const c = { added: 0, changed: 0, unchanged: 0, skipped: 0, missing: 0, conflict: 0, error: 0 };
	for (const s of STEPS) if (c[s.status] !== undefined) c[s.status] += 1;
	return c;
}

function restartNotice(ctx) {
	log('');
	log('----------------------------------------------------------------');
	log('需要重启 dsh 才生效 —— 宿主代码与客户端 bundle 都在启动时加载/快照：');
	log('  * 宿主半（packages/team-flowise/src/index.js）由 profile 的 patch 层在启动时装配；');
	log('  * 客户端半由宿主在激活时快照并不可变地提供给浏览器，改完要重新加载才会推送。');
	log('重启后这样验证「工具在」：新会话里工具面应出现 7 个 team_* 工具');
	log('  （team_create_task / team_task_status / team_create_agent / team_create_workflow /');
	log('    team_list_agents / team_delegate_agent / team_run_workflow）。');
	log('重启后这样验证「界面在」：设置页出现 team-flowise 分区，右侧栏出现「多 Agent 进度」页签；');
	log('  或直接 GET /api/team-flowise/ping （期望 {"ok":true,"pong":true,...}）。');
	log('排查「为什么没生效」：node scripts/install.mjs --check --profile <profile>（exit 0 = 已装且一致，exit 3 = 缺失/不一致）');
	log(`卸载：node scripts/uninstall.mjs --profile "${ctx.profile}"`);
	log('----------------------------------------------------------------');
}

function emitReport(ctx, exitCode, extra) {
	const report = {
		tool: 'install',
		version: 1,
		mode: ctx.mode,
		ok: exitCode === 0,
		exitCode,
		profile: ctx.profile,
		package: ctx.pkg,
		linkPath: join(ctx.profile, 'node_modules', PLUGIN_NAME),
		linkMode: ctx.linkMode,
		depSpec: ctx.depSpecResolved ?? null,
		skillDir: ctx.skillDir,
		skillTarget: ctx.skillTarget ?? null,
		counts: counts(),
		added: { ...ADDED },
		steps: STEPS,
		changes: CHANGES,
		...(extra || {}),
	};
	if (JSON_MODE) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	return report;
}

/* ------------------------------------------------------------------ main */

function main(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (error) {
		if (error instanceof UsageError) {
			process.stderr.write(`错误：${error.message}\n\n${USAGE}`);
			return 1;
		}
		throw error;
	}
	if (opts.help) {
		process.stdout.write(USAGE);
		return 0;
	}
	JSON_MODE = opts.json;

	const skillDir =
		opts.skillDir !== null
			? resolve(opts.skillDir)
			: opts.skillRoot === 'agents'
				? join(homedir(), '.agents', 'skills')
				: opts.skillRoot === 'project'
					? join(REPO_ROOT, '.dsh', 'skills')
					: opts.skillRoot === 'none'
						? null
						: DEFAULT_SKILL_DIR;

	const ctx = {
		opts,
		mode: opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'install',
		dryRun: opts.dryRun,
		check: opts.check,
		force: opts.force,
		profile: resolve(opts.profile !== null ? opts.profile : DEFAULT_PROFILE_DIR),
		pkg: resolve(opts.pkg !== null ? opts.pkg : DEFAULT_PACKAGE_DIR),
		linkMode: opts.linkMode,
		depSpec: opts.depSpec,
		skillRoot: opts.skillRoot,
		skillDir,
		ts: timestamp(),
		undo: [],
		depSpecResolved: null,
		skillTarget: null,
	};

	log('== team-flowise installer ==');
	log(`mode    : ${ctx.mode}`);
	log(`profile : ${ctx.profile}`);
	log(`package : ${ctx.pkg}`);
	log(`link    : ${ctx.linkMode}`);
	log(`skills  : ${skillDir ?? '(disabled)'}`);
	if (ctx.dryRun) log('注意：--dry-run —— 只打印将要发生的改动，不写盘。');
	if (ctx.check) log('注意：--check —— 只校验，不写盘；exit 0 = 已装且一致，exit 3 = 缺失/不一致。');
	if (samePath(ctx.profile, DEFAULT_PROFILE_DIR)) log(`注意：目标是本机默认 profile（${DEFAULT_PROFILE_DIR}）。`);
	log('');

	const finish = (code, extra) => {
		log('');
		log('----------------------------------------------------------------');
		log(`结果：${STEPS.filter((s) => s.status === 'added' || s.status === 'changed').length} 项改动 / ${STEPS.filter((s) => s.status === 'unchanged').length} 项已存在跳过 / ${STEPS.filter((s) => s.status === 'skipped').length} 项不适用`);
		if (code !== 0) log('');
		emitReport(ctx, code, extra);
		return code;
	};

	try {
		const profile = validateProfile(ctx);
		validatePackage(ctx);
		log(`[信息] profile 校验通过（package.json + ${profile.hasCordisYml ? 'cordis.yml' : 'cordis.patch.yml'}）`);
		log('');

		stepLink(ctx);
		stepManifest(ctx, profile);
		stepPatchRow(ctx, profile);
		stepSkill(ctx);

		if (ctx.check) {
			const bad = STEPS.filter((s) => s.status === 'missing' || s.status === 'conflict' || s.status === 'error');
			if (bad.length > 0) {
				const code = finish(3, { checkFailures: bad.map((b) => ({ step: b.step, status: b.status, detail: b.detail })) });
				return code;
			}
			log('');
			log('校验通过：插件已安装且与磁盘状态一致。（注意：是否已在运行中的 dsh 里生效，需重启后确认。）');
			return finish(0);
		}

		restartNotice(ctx);
		return finish(0);
	} catch (error) {
		const fatal = error instanceof FatalError;
		record('error', 'error', fatal ? error.message : `未预期的错误：${error && error.stack ? error.stack : String(error)}`);
		if (ctx.undo.length > 0 && !ctx.dryRun) {
			log('');
			log('[回滚] 正在撤销本次已完成的改动…');
			const { done, failed } = rollback(ctx);
			for (const a of done) log(`[回滚] 已撤销：${a.kind} ${a.file ?? a.path ?? `${a.from} <- ${a.to}`}`);
			for (const f of failed) log(`[回滚失败] ${JSON.stringify(f.action)} -> ${f.error}`);
			if (failed.length > 0) {
				log('[回滚失败] 回滚未能完全成功，请人工检查上面的路径（回滚失败比原错误更严重）。');
				return finish(1, { rolledBack: done.length, rollbackFailures: failed.length });
			}
		}
		return finish(1, { rolledBack: 0, error: fatal ? error.message : String(error) });
	}
}

process.exitCode = main(process.argv.slice(2));
