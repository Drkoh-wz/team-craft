#!/usr/bin/env node
/**
 * scripts/uninstall.mjs — inverse of scripts/install.mjs, equally idempotent.
 *
 * Removes, in reverse order of what install.mjs did:
 *   1. <profile>/node_modules/@local/team-flowise (the link itself only — never
 *      the directory it points at);
 *   2. the `@local/team-flowise` entry from <profile>/package.json dependencies;
 *   3. the `@local/team-flowise` entry from dsh.profile.bundles;
 *   4. any LEGACY `- insert:` row (whole block) for `flowise-team` from
 *      <profile>/cordis.patch.yml — a profile wired by an older version of
 *      install.mjs still carries one. The row is normally declared by the bundle
 *      itself, so a current profile has nothing here and this step is a no-op;
 *      every other line, comment included, is kept byte-identical;
 *   5. (opt-in, --remove-skill) the installed skill directory/file.
 *
 * Backups are always kept: each rewritten file becomes `<file>.bak-<timestamp>`.
 * Running it twice changes nothing the second time.
 *
 * Usage: node scripts/uninstall.mjs [options]   (see --help)
 */

import { existsSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ constants */

const PLUGIN_NAME = '@local/team-flowise';
const ROW_ID = 'flowise-team';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'team-flowise');

const DSH_HOME = (() => {
	const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
	return raw.length > 0 ? resolve(raw) : join(homedir(), '.dsh');
})();
const DEFAULT_PROFILE_DIR = join(DSH_HOME, 'profiles', 'web');
const DEFAULT_SKILL_DIR = join(DSH_HOME, 'skills');

const USAGE = `team-flowise uninstaller — unmount @local/team-flowise from a dsh profile

Usage:
  node scripts/uninstall.mjs [options]

Options:
  --profile <dir>      target dsh profile directory
                       (default: <DSH_HOME>/profiles/web, DSH_HOME defaults to ~/.dsh)
  --package <dir>      the plugin package directory the link is expected to point at
                       (default: <repo>/packages/team-flowise, i.e. beside this script)
  --remove-skill       also unmount the installed skill (default: leave it in place,
                       because a skill is a user-level asset shared by other tools)
  --dry-run            print every planned change (with a line diff) and write nothing
  --check              verify the current state only; exit 0 = nothing left installed,
                       exit 3 = something is still installed (nothing is written)
  --force              remove a link/entry that does not match the expected package,
                       and remove a real directory where a link was expected
  --skill-root <root>  dsh (default: <DSH_HOME>/skills) | agents (<home>/.agents/skills)
                       | project (<repo>/.dsh/skills) | none
  --skill-dir <dir>    explicit skill root, overrides --skill-root
  --json               machine-readable report on stdout (human log goes to stderr)
  --help, -h           this text

Exit codes: 0 = ok, 1 = error, 3 = --check found something still installed.

Backups are always kept (<file>.bak-<timestamp>). Restart dsh afterwards: the
profile composition and the client bundle snapshot are both taken at startup.
`;

/* ------------------------------------------------------------------ plumbing */

class UsageError extends Error {}
class FatalError extends Error {}

let JSON_MODE = false;
const STEPS = [];
const CHANGES = [];
const REMOVED = { link: 0, dep: 0, bundles: 0, insertRows: 0, skill: 0 };

function log(msg = '') {
	if (JSON_MODE) process.stderr.write(`${msg}\n`);
	else process.stdout.write(`${msg}\n`);
}

const TAG = {
	removed: '[移除]',
	changed: '[更新]',
	unchanged: '[跳过]',
	skipped: '[不适用]',
	present: '[残留]',
	conflict: '[冲突]',
	error: '[错误]',
	info: '[信息]',
};

function record(step, status, detail, extra) {
	const item = { step, status, detail, ...(extra || {}) };
	STEPS.push(item);
	const key = { '1-link': 'link', '2-dependency': 'dep', '3-bundles': 'bundles', '4-patch-row': 'insertRows', '5-skill': 'skill' }[step];
	if (key !== undefined && status === 'removed') REMOVED[key] += 1;
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

function isPlainObject(v) {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
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
			/* unreadable link */
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
		for (let j = ln + 1; j < lines.length; j += 1) {
			if (lines[j].trim() === '') continue;
			const ind = lines[j].length - lines[j].trimStart().length;
			if (ind <= rowIndent) break;
			const nm = /^\s*name\s*:\s*(.*?)\s*$/.exec(lines[j]);
			if (nm && name === null) name = unquoteScalar(nm[1]);
		}
		return { line: ln, block, name };
	});

	const emptyArrayLines = [];
	const entryLines = [];
	for (let i = 0; i < lines.length; i += 1) {
		if (/^\s*\[\s*\]\s*$/.test(lines[i])) emptyArrayLines.push(i);
		else if (/^\s*-\s/.test(lines[i])) entryLines.push(i);
	}
	return { lines, rows, inserts, emptyArrayLines, entryLines };
}

/** Remove whole `- insert:` blocks (list of {start,end}) from the line array. */
function removeBlocks(lines, blocks) {
	const drop = new Set();
	for (const b of blocks) for (let i = b.start; i <= b.end; i += 1) drop.add(i);
	const out = [];
	for (let i = 0; i < lines.length; i += 1) if (!drop.has(i)) out.push(lines[i]);
	// collapse blank runs left behind at the splice points, keep it minimal: at most one blank in a row
	const collapsed = [];
	for (const line of out) {
		if (line.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
		collapsed.push(line);
	}
	while (collapsed.length > 0 && collapsed[0].trim() === '') collapsed.shift();
	let text = collapsed.join('\n');
	if (!text.endsWith('\n')) text += '\n';
	return text;
}

/** Ensure the patch file stays a top-level YAML array: dsh fails loud on a non-array. */
function ensureValidEmptyArray(text) {
	const scan = scanPatchLayer(text);
	if (scan.entryLines.length > 0) {
		if (scan.emptyArrayLines.length === 0) return { text, appended: false };
		// stray `[]` next to real entries would be a second YAML node: drop it
		const lines = scan.lines.filter((_, i) => !scan.emptyArrayLines.includes(i));
		let out = lines.join('\n');
		while (out.includes('\n\n\n')) out = out.replace('\n\n\n', '\n\n');
		if (!out.endsWith('\n')) out += '\n';
		return { text: out, appended: false, dropped: true };
	}
	if (scan.emptyArrayLines.length === 1) return { text, appended: false };
	const lines = scan.lines.filter((_, i) => !scan.emptyArrayLines.includes(i));
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	// No blank separator here: this reproduces the profile template (`…comment\n[]\n`)
	// byte for byte, so install -> uninstall round-trips exactly.
	lines.push('[]');
	return { text: `${lines.join('\n')}\n`, appended: true };
}

/* ------------------------------------------------------------------ skill helpers */

function parseSkillFrontmatter(text) {
	const lines = text.split('\n');
	if (lines.length === 0 || lines[0].replace(/\r$/, '') !== '---') return { ok: false };
	let end = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].replace(/\r$/, '') === '---') {
			end = i;
			break;
		}
	}
	if (end < 0) return { ok: false };
	for (let i = 1; i < end; i += 1) {
		const m = /^name\s*:\s*(.*)$/.exec(lines[i]);
		if (m) return { ok: true, name: unquoteScalar(m[1]) };
	}
	return { ok: false };
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
		removeSkill: false,
		skillRoot: 'dsh',
		skillDir: null,
	};
	const withValue = new Map([
		['--profile', 'profile'],
		['--package', 'pkg'],
		['--skill-root', 'skillRoot'],
		['--skill-dir', 'skillDir'],
	]);
	const booleans = new Map([
		['--dry-run', 'dryRun'],
		['--check', 'check'],
		['--force', 'force'],
		['--json', 'json'],
		['--help', 'help'],
		['-h', 'help'],
		['--remove-skill', 'removeSkill'],
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
	if (!['dsh', 'agents', 'project', 'none'].includes(opts.skillRoot)) throw new UsageError(`未知 --skill-root：${opts.skillRoot}（可选 dsh | agents | project | none）`);
	return opts;
}

/* ------------------------------------------------------------------ steps */

function validateProfile(ctx) {
	const dir = ctx.profile;
	if (!existsSync(dir)) throw new FatalError(`profile 目录不存在：${dir}`);
	if (!isDir(dir)) throw new FatalError(`--profile 不是目录：${dir}`);
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
	if (!existsSync(join(dir, 'cordis.yml')) && !existsSync(join(dir, 'cordis.patch.yml'))) {
		throw new FatalError(`不是 dsh profile：${dir} 下既没有 cordis.yml 也没有 cordis.patch.yml`);
	}
	return { pkgJsonPath, text, obj, patchPath: join(dir, 'cordis.patch.yml'), patchExists: existsSync(join(dir, 'cordis.patch.yml')) };
}

function stepLink(ctx) {
	const linkPath = join(ctx.profile, 'node_modules', PLUGIN_NAME);
	const info = inspectPath(linkPath);
	const parent = dirname(linkPath);

	if (info.kind === 'missing') {
		return record('1-link', 'unchanged', `不存在，跳过：${linkPath}`);
	}

	if (info.kind === 'link' && info.abs !== null && ctx.pkg !== null && !sameRealPath(info.abs, ctx.pkg) && !ctx.force) {
		const detail = `链接指向 ${info.abs}，不是本包 ${ctx.pkg}`;
		if (ctx.check) return record('1-link', 'conflict', `${detail}（不是本包的安装痕迹，未处理）`);
		throw new FatalError(`${detail}\n  脚本不会删除别人的链接；确认后加 --force，或手工处理。`);
	}

	if (info.kind === 'dir' && !ctx.force) {
		const detail = `该路径是真实目录，不是链接：${linkPath}`;
		if (ctx.check) return record('1-link', 'conflict', `${detail}（未处理）`);
		throw new FatalError(`${detail}\n  安装脚本只会创建链接；目录可能是手工复制或 --link-mode copy 的产物。\n  确认后加 --force（会改名为 .bak-<时间戳>，不删除）。`);
	}

	if (ctx.check) return record('1-link', 'present', `仍处于安装状态：${linkPath}${info.abs ? ` → ${info.abs}` : ''}`);

	if (ctx.dryRun) {
		return record('1-link', 'removed', `将删除链接本身（不动目标 ${info.abs ?? '(未知)'}）：${linkPath}`);
	}

	if (info.kind === 'dir') {
		const backup = uniquePath(`${linkPath}.bak-${ctx.ts}`);
		renameSync(linkPath, backup);
		ctx.undo.push({ kind: 'moved', from: linkPath, to: backup });
		CHANGES.push({ file: linkPath, backup });
	} else {
		// remove the link ONLY: recursive:false never follows it into the package
		rmSync(linkPath, { recursive: false, force: true });
		ctx.undo.push({ kind: 'link', path: linkPath, target: info.abs });
	}

	let note = '';
	if (isDir(parent)) {
		try {
			if (readdirSync(parent).length === 0) {
				rmdirSync(parent); // rmSync() refuses directories without recursive:true
				ctx.undo.push({ kind: 'mkdir', path: parent });
				note = `（顺带删除空的 ${parent}）`;
			}
		} catch {
			/* leaving an empty scope dir behind is harmless */
		}
	}
	return record('1-link', 'removed', `已删除链接：${linkPath}${info.abs ? `（原指向 ${info.abs}；目标目录未受影响）` : ''}${note}`);
}

function stepManifest(ctx, profile) {
	const file = profile.pkgJsonPath;
	const obj = profile.obj;
	const style = jsonStyle(profile.text);

	const deps = isPlainObject(obj.dependencies) ? obj.dependencies : null;
	const depPresent = deps !== null && Object.prototype.hasOwnProperty.call(deps, PLUGIN_NAME);
	const depOld = depPresent ? deps[PLUGIN_NAME] : null;
	const bundles = isPlainObject(obj.dsh) && isPlainObject(obj.dsh.profile) && Array.isArray(obj.dsh.profile.bundles) ? obj.dsh.profile.bundles : null;
	const bundleHits = bundles === null ? 0 : bundles.filter((b) => b === PLUGIN_NAME).length;

	if (!depPresent && bundleHits === 0) {
		record('2-dependency', 'unchanged', `不存在，跳过：dependencies["${PLUGIN_NAME}"]`);
		record('3-bundles', 'unchanged', `不存在，跳过：dsh.profile.bundles 里的 "${PLUGIN_NAME}"`);
		return;
	}

	const depDetail = `dependencies["${PLUGIN_NAME}"] = "${depOld}"`;
	const bundleDetail = `dsh.profile.bundles 里的 "${PLUGIN_NAME}"（${bundleHits} 项）`;

	if (ctx.check) {
		if (depPresent) record('2-dependency', 'present', `仍处于安装状态：${depDetail}`);
		else record('2-dependency', 'unchanged', `不存在，跳过：dependencies["${PLUGIN_NAME}"]`);
		if (bundleHits > 0) record('3-bundles', 'present', `仍处于安装状态：${bundleDetail}`);
		else record('3-bundles', 'unchanged', `不存在，跳过：dsh.profile.bundles 里的 "${PLUGIN_NAME}"`);
		return;
	}

	if (depPresent) delete deps[PLUGIN_NAME];
	if (bundleHits > 0) obj.dsh.profile.bundles = bundles.filter((b) => b !== PLUGIN_NAME);
	const after = stringifyJson(obj, style);

	if (ctx.dryRun) {
		log(`[dry-run] ${file} 的逐行 diff：`);
		for (const line of lineDiff(profile.text, after)) log(`    ${line}`);
		if (depPresent) record('2-dependency', 'removed', `将删除 ${depDetail}`);
		else record('2-dependency', 'unchanged', `不存在，跳过：dependencies["${PLUGIN_NAME}"]`);
		if (bundleHits > 0) record('3-bundles', 'removed', `将删除 ${bundleDetail}`);
		else record('3-bundles', 'unchanged', `不存在，跳过：dsh.profile.bundles 里的 "${PLUGIN_NAME}"`);
		return;
	}

	const backup = `${file}.bak-${ctx.ts}`;
	if (!existsSync(backup)) copyFileSync(file, backup);
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, after, 'utf8');
	renameSync(tmp, file);
	ctx.undo.push({ kind: 'file', file, backup });
	CHANGES.push({ file, backup });

	if (depPresent) record('2-dependency', 'removed', `已删除 ${depDetail}`);
	else record('2-dependency', 'unchanged', `不存在，跳过：dependencies["${PLUGIN_NAME}"]`);
	if (bundleHits > 0) record('3-bundles', 'removed', `已删除 ${bundleDetail}`);
	else record('3-bundles', 'unchanged', `不存在，跳过：dsh.profile.bundles 里的 "${PLUGIN_NAME}"`);
}

function stepPatchRow(ctx, profile) {
	const file = profile.patchPath;
	if (!profile.patchExists) return record('4-patch-row', 'unchanged', `不存在，跳过：${file}`);

	const text = readText(file);
	const scan = scanPatchLayer(text);
	if (scan.rows.length === 0) return record('4-patch-row', 'unchanged', `不存在，跳过：${file} 里没有 id: ${ROW_ID}`);

	const nonInsert = scan.rows.filter((r) => r.block === null);
	if (nonInsert.length > 0) {
		const detail = `${file} 第 ${nonInsert.map((r) => r.line + 1).join(', ')} 行的 id: ${ROW_ID} 不在 insert 块内（像是人工写的覆盖行）`;
		if (ctx.check) return record('4-patch-row', 'conflict', `${detail}（未处理）`);
		throw new FatalError(`${detail}\n  脚本只删除自己插入的 insert 块；请人工确认后再处理。`);
	}

	const blocks = [...new Set(scan.rows.map((r) => `${r.block.start}:${r.block.end}`))].map((k) => {
		const [start, end] = k.split(':').map(Number);
		return { start, end };
	});
	const withoutRows = removeBlocks(scan.lines, blocks);
	const fixed = ensureValidEmptyArray(withoutRows);
	const after = fixed.text;
	const verify = scanPatchLayer(after);
	if (verify.rows.length !== 0) throw new FatalError(`内部校验失败：删除后 id: ${ROW_ID} 仍出现 ${verify.rows.length} 次，已放弃写入 ${file}`);

	if (ctx.check) return record('4-patch-row', 'present', `仍处于安装状态：${file} 里有 ${blocks.length} 个含 id: ${ROW_ID} 的 insert 块`);

	if (ctx.dryRun) {
		log(`[dry-run] ${file} 的逐行 diff：`);
		for (const line of lineDiff(text, after)) log(`    ${line}`);
		return record('4-patch-row', 'removed', `将删除 ${blocks.length} 个 insert 块${fixed.appended ? '，并补一行 [] 保持补丁层是合法数组' : ''}`);
	}

	const backup = `${file}.bak-${ctx.ts}`;
	if (!existsSync(backup)) copyFileSync(file, backup);
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, after, 'utf8');
	renameSync(tmp, file);
	ctx.undo.push({ kind: 'file', file, backup });
	CHANGES.push({ file, backup });
	return record(
		'4-patch-row',
		'removed',
		`已删除 ${blocks.length} 个 insert 块（第 ${blocks.map((b) => b.start + 1).join(', ')} 行起；其余行逐字未动）` +
			`${fixed.appended ? '，并补一行 []（dsh 要求该文件是顶层 YAML 数组，仅剩注释会让宿主启动即报错）' : ''}（原文件备份为 ${backup}）`,
	);
}

function stepSkill(ctx) {
	if (ctx.skillDir === null) return record('5-skill', 'skipped', '已指定 --skill-root none，跳过技能处理');
	if (!isDir(ctx.skillDir)) return record('5-skill', 'unchanged', `不存在，跳过：技能根目录 ${ctx.skillDir}`);

	const entries = readdirSync(ctx.skillDir, { withFileTypes: true })
		.filter((e) => /^team-flowise(-|$)/.test(e.name) && (e.isDirectory() || (e.isFile() && e.name.endsWith('.md'))))
		.map((e) => ({ name: e.name, path: join(ctx.skillDir, e.name), isDir: e.isDirectory() }));

	if (entries.length === 0) return record('5-skill', 'unchanged', `不存在，跳过：${ctx.skillDir} 下没有 team-flowise* 技能`);

	if (!ctx.removeSkill) {
		if (ctx.check) return record('5-skill', 'skipped', `保留技能（未指定 --remove-skill）：${entries.map((e) => e.path).join(', ')}`);
		return record('5-skill', 'skipped', `保留技能（默认行为；要删除请加 --remove-skill）：${entries.map((e) => e.path).join(', ')}`);
	}

	const names = entries
		.map((e) => (e.isDir ? (isFile(join(e.path, 'SKILL.md')) ? parseSkillFrontmatter(readText(join(e.path, 'SKILL.md'))) : { ok: false }) : parseSkillFrontmatter(readText(e.path))))
		.map((fm, i) => (fm.ok && fm.name ? fm.name : entries[i].name.replace(/\.md$/, '')));

	if (ctx.check) return record('5-skill', 'present', `仍处于安装状态：${entries.map((e) => e.path).join(', ')}`);

	if (ctx.dryRun) {
		return record('5-skill', 'removed', `将把技能移出技能根目录（移到 ${join(ctx.skillDir, '..', `.team-flowise-removed-${ctx.ts}`)}）：${entries.map((e) => e.path).join(', ')}`);
	}

	// Moving it OUT of the skill root matters: a renamed dir inside the root would still be
	// discovered (the skill name comes from frontmatter, not from the directory name).
	const holding = join(ctx.skillDir, '..', `.team-flowise-removed-${ctx.ts}`);
	mkdirSync(holding, { recursive: true });
	const moved = [];
	for (let i = 0; i < entries.length; i += 1) {
		const dest = uniquePath(join(holding, names[i] ?? entries[i].name));
		renameSync(entries[i].path, dest);
		ctx.undo.push({ kind: 'moved', from: entries[i].path, to: dest });
		CHANGES.push({ file: entries[i].path, backup: dest });
		moved.push(`${entries[i].path} → ${dest}`);
	}
	return record('5-skill', 'removed', `已移出技能根目录（可手工恢复）：${moved.join(', ')}`);
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
				if (!existsSync(action.path) && action.target) {
					// restore the removed link (junction works for both link kinds on Windows)
					symlinkSync(action.target, action.path, process.platform === 'win32' ? 'junction' : 'dir');
				}
			} else if (action.kind === 'moved') {
				if (existsSync(action.to)) renameSync(action.to, action.from);
			} else if (action.kind === 'mkdir') {
				if (!existsSync(action.path)) mkdirSync(action.path, { recursive: true });
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
	const c = { removed: 0, changed: 0, unchanged: 0, skipped: 0, present: 0, conflict: 0, error: 0 };
	for (const s of STEPS) if (c[s.status] !== undefined) c[s.status] += 1;
	return c;
}

function emitReport(ctx, exitCode, extra) {
	const report = {
		tool: 'uninstall',
		version: 1,
		mode: ctx.mode,
		ok: exitCode === 0,
		exitCode,
		profile: ctx.profile,
		package: ctx.pkg,
		skillDir: ctx.skillDir,
		counts: counts(),
		removed: { ...REMOVED },
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
		mode: opts.check ? 'check' : opts.dryRun ? 'dry-run' : 'uninstall',
		dryRun: opts.dryRun,
		check: opts.check,
		force: opts.force,
		removeSkill: opts.removeSkill,
		profile: resolve(opts.profile !== null ? opts.profile : DEFAULT_PROFILE_DIR),
		pkg: resolve(opts.pkg !== null ? opts.pkg : DEFAULT_PACKAGE_DIR),
		skillRoot: opts.skillRoot,
		skillDir,
		ts: timestamp(),
		undo: [],
	};

	log('== team-flowise uninstaller ==');
	log(`mode    : ${ctx.mode}`);
	log(`profile : ${ctx.profile}`);
	log(`package : ${ctx.pkg} (用于确认链接身份)`);
	log(`skills  : ${skillDir ?? '(disabled)'}${opts.removeSkill ? ' (--remove-skill)' : ' (默认保留)'}`);
	if (ctx.dryRun) log('注意：--dry-run —— 只打印将要发生的改动，不写盘。');
	if (ctx.check) log('注意：--check —— 只校验；exit 0 = 已彻底卸载，exit 3 = 仍有残留。');
	if (samePath(ctx.profile, DEFAULT_PROFILE_DIR)) log(`注意：目标是本机默认 profile（${DEFAULT_PROFILE_DIR}）。`);
	log('');

	const finish = (code, extra) => {
		log('');
		log('----------------------------------------------------------------');
		log(`结果：${STEPS.filter((s) => s.status === 'removed').length} 项移除 / ${STEPS.filter((s) => s.status === 'unchanged').length} 项本就不存在 / ${STEPS.filter((s) => s.status === 'present').length} 项残留`);
		emitReport(ctx, code, extra);
		return code;
	};

	try {
		const profile = validateProfile(ctx);
		log('[信息] profile 校验通过');
		log('');

		stepLink(ctx);
		stepManifest(ctx, profile);
		stepPatchRow(ctx, profile);
		stepSkill(ctx);

		if (ctx.check) {
			const bad = STEPS.filter((s) => s.status === 'present' || s.status === 'conflict' || s.status === 'error');
			if (bad.length > 0) return finish(3, { checkFailures: bad.map((b) => ({ step: b.step, status: b.status, detail: b.detail })) });
			log('');
			log('校验通过：没有发现本插件的安装痕迹（技能按 --remove-skill 的口径忽略）。');
			return finish(0);
		}

		log('');
		log('----------------------------------------------------------------');
		log('改动会在下次启动时生效：需要重启 dsh（宿主装配与客户端 bundle 快照都发生在启动时）。');
		log('重启后确认已卸载：新会话里不应再出现 team_* 工具，设置页不应再出现 team-flowise 分区；');
		log(`  或 GET /api/team-flowise/ping 应返回 404。备份文件（*.bak-<时间戳>）默认保留，可手工删除。`);
		log('----------------------------------------------------------------');
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
				log('[回滚失败] 回滚未能完全成功，请人工检查上面的路径。');
				return finish(1, { rolledBack: done.length, rollbackFailures: failed.length });
			}
		}
		return finish(1, { rolledBack: 0, error: fatal ? error.message : String(error) });
	}
}

process.exitCode = main(process.argv.slice(2));
