#!/usr/bin/env node
/**
 * scripts/pack-specialization.mjs —— P13-F 打包脚本
 *
 * 契约来源：P13-PLAN.md 第 3.5 节（生成可分发的移植包归档；不引入新依赖；
 * 打印归档绝对路径与字节数；解包到临时目录后跑一次 selftest.mjs 证明可用）。
 *
 * 归档格式：**.tar.gz**，由本脚本手写 ustar 头（每文件 512 字节头 + 512 对齐的数据块 +
 * 两个 512 字节零块结束）+ node:zlib 的 gzipSync 压缩。零新增依赖。
 *   为什么不用 zip：Node 内置没有 zip 写入器，一个正确的 zip 需要本地文件头 + 中央目录 +
 *   EOCD + 自实现的 CRC32 表（CRC32 也得自己写）；而 tar 只需要一个 512 字节的头结构，
 *   压缩由 gzipSync 免费提供。.tar.gz 能被 Windows 自带的 bsdtar（tar -tzf / tar -xzf，本机实测）
 *   与 macOS/Linux 的标准 tar 列出与解开。7-Zip 未实测（本机未安装）；Expand-Archive 只支持
 *   .zip（本机 PowerShell 5.1 实测报 ".gz is not a supported archive file format"，PS 7 未实测）。
 *
 * 归档布局（归档内路径一律是相对路径，且一律以 / 分隔）：
 *   INSTALL.md                        ← 本脚本生成：指向包内 README，并写清「第二步」
 *   specializations/<packId>/**       ← 整个移植包（prompts/、adapters/、安装器、自检……）
 *
 * 参数：
 *   --out <dir>        归档输出目录，默认 <repo>/dist
 *   --version <v>      归档版本号，默认读 <包>/pack.json 的 version
 *   --list             只列出将被打进归档的条目（不写文件、不校验）
 *   --dry-run          只打印计划（不写文件、不校验）
 *   --pack <id>        移植包 id，默认 leasing-risk
 *   --pack-dir <dir>   移植包目录覆盖（默认 <repo>/specializations/<pack>）；
 *                      仅用于打包机制自测 / 非标准布局。归档内路径仍固定为
 *                      specializations/<pack>/**，不会因为用了它而改变布局。
 *   --help, -h         显示帮助
 *
 * 退出码：0 成功 / 1 前置校验或打包自证失败 / 2 参数错误
 *
 * 硬性约束（自带断言，违反即非零退出）：
 *  * 只写 --out 目录（默认 <repo>/dist）与系统临时目录，不碰仓库里任何其它文件。
 *  * 归档条目必须落在 specializations/<packId>/ 之内；不得含 node_modules、
 *    不得含 team-flowise 源码（packages/ 前缀）、不得含 dist/ 自身与已存在的归档产物。
 *  * 不得出现任何盘符绝对路径（脚本自身、生成的 INSTALL.md、以及归档里的每个文本文件
 *    都会被扫一遍；`http://127.0.0.1:3080` 这类 URL 不算）。
 *  * 打包后自证：把写出的字节 gunzip + untar 回内存比对条目清单 → 解到系统临时目录 →
 *    扫盘符绝对路径 → 在解出的目录里跑 node selftest.mjs。全部通过才算成功。
 */

import {
  existsSync, lstatSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve as pathResolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------- 常量

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(SCRIPT_DIR, '..');
const SPEC_ROOT = join(REPO_ROOT, 'specializations');
const DEFAULT_PACK_ID = 'leasing-risk';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const BLOCK = 512;
const GZIP_LEVEL = 9;

/** 归档根部的入口文件（由本脚本生成）。 */
const ENTRY_DOC = 'INSTALL.md';

/** 包内必须存在的相对文件：缺一即失败，绝不静默产出不完整归档。 */
const REQUIRED_FILES = [
  'pack.json', 'roles.json', 'workflow.json', 'models.map.json', 'PROVENANCE.json',
  'README.md', 'SKILL.md',
  'install.mjs', 'uninstall.mjs', 'selftest.mjs',
];
/** 必须非空的目录（相对包根）。 */
const REQUIRED_DIRS = ['prompts', 'adapters'];

/** 打包时跳过的目录名（P13-PLAN 3.5：不要把 node_modules、dist 自身打进去）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.turbo']);

/** 打包时跳过的文件名（已存在的归档产物）。 */
const SKIP_FILE_RE = /\.(zip|tar|tgz|tar\.gz|7z)$/i;

/** team-flowise 源码所在目录（不得进包：会造成版本漂移，P13-PLAN 3.5）。 */
const FORBIDDEN_PREFIXES = ['packages/', 'apps/', 'scripts/', 'validation/'];

/**
 * 盘符绝对路径探测（如某盘符 + 冒号 + 反斜杠或正斜杠开头）。
 * 前瞻/后顾用来排除 URL：URL 里的协议名后面跟的是两个斜杠，不是路径分隔符，因此不匹配。
 */
const DRIVE_PATH_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/;

const USAGE = `移植包打包脚本 —— 把 specializations/<id>/ 打成可分发的 .tar.gz

用法：
  node scripts/pack-specialization.mjs [选项]

选项：
  --out <dir>        归档输出目录，默认 <repo>/dist
  --version <v>      归档版本号，默认读 <包>/pack.json 的 version
                     版本号里不允许出现路径分隔符
  --list             只列出将被打进归档的条目（含大小、来源），不写任何文件
  --dry-run          只打印计划（输出路径、条目数、总字节数），不写任何文件
  --pack <id>        移植包 id（specializations/<id>），默认 ${DEFAULT_PACK_ID}
  --pack-dir <dir>   移植包目录覆盖（仅用于打包机制自测 / 非标准布局）
  --help, -h         显示本帮助

产物：
  <out>/<packId>-team-<version>.tar.gz

归档内容：
  ${ENTRY_DOC}                       由本脚本生成，指向包内 README 并写清第二步
  specializations/<packId>/**        整个移植包（不含 node_modules / dist / 其它归档产物）

不打包的东西：
  team-flowise 源码（packages/）、node_modules、dist 自身、任何盘符绝对路径。

格式与自证：
  格式 .tar.gz（手写 ustar 头 + node:zlib gzipSync），零新增依赖，可用
  tar -tzf / tar -xzf 列出与解开。写盘后脚本会自己解回内存比对条目、解到系统临时目录、
  扫描盘符绝对路径，并在解出的目录里执行 node selftest.mjs；任一步失败即非零退出。

退出码：
  0  成功（含 --list / --dry-run）
  1  前置校验失败、写盘失败或打包自证失败（selftest 不通过）
  2  参数错误
`;

class Fail extends Error {
  constructor(message, code = EXIT_FAIL) { super(message); this.exitCode = code; }
}

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const o = {
    out: null, version: null, list: false, dryRun: false, help: false,
    packId: DEFAULT_PACK_ID, packDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || (v.length > 1 && v.startsWith('--'))) throw new Fail(`选项缺少取值：${a}`, EXIT_USAGE);
      i += 1;
      return v;
    };
    if (a === '--out') o.out = value();
    else if (a === '--version') o.version = value();
    else if (a === '--pack') o.packId = value();
    else if (a === '--pack-dir') o.packDir = value();
    else if (a === '--list') o.list = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Fail(`未知选项：${a}（用 --help 看用法）`, EXIT_USAGE);
  }
  return o;
}

// ---------------------------------------------------------------- 小工具

const out = (s) => process.stdout.write(s + '\n');
const buf = (s) => Buffer.from(s, 'utf8');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const toPosix = (p) => p.split(sep).join('/');
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const readText = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

/** 归档内路径的安全校验：相对、/ 分隔、不越界。 */
function assertSafeArcName(name) {
  if (typeof name !== 'string' || name === '') throw new Fail(`归档条目名为空`);
  if (name.startsWith('/') || name.startsWith('\\')) throw new Fail(`归档条目名是绝对路径：${name}`);
  if (name.includes('\\')) throw new Fail(`归档条目名含反斜杠（必须是 / 分隔）：${name}`);
  const segs = name.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) throw new Fail(`归档条目名含空段或 ..：${name}`);
  return name;
}

// ---------------------------------------------------------------- ustar 写入

/** 把十进制数写成八进制字段（fieldLen 含结尾的 NUL）。 */
function writeOctal(h, offset, fieldLen, value) {
  const s = Math.max(0, Math.floor(value)).toString(8);
  if (s.length > fieldLen - 1) throw new Fail(`tar 字段溢出：${fieldLen} 字节装不下 ${value}`);
  h.write(s.padStart(fieldLen - 1, '0') + '\0', offset, fieldLen, 'ascii');
}

/** 一个 ustar 头（512 字节）。路径超过 100 字节时按 ustar 的 prefix 字段切分。 */
function tarHeader(name, size, mode, mtimeSec) {
  const h = Buffer.alloc(BLOCK, 0);
  let nameBytes = buf(name);
  let prefixBytes = Buffer.alloc(0);
  if (nameBytes.length > 100) {
    const slash = name.lastIndexOf('/');
    if (slash <= 0) throw new Fail(`归档内路径过长且无 / 可切分：${name}`);
    prefixBytes = buf(name.slice(0, slash));
    nameBytes = buf(name.slice(slash + 1));
    if (nameBytes.length > 100 || prefixBytes.length > 155) {
      throw new Fail(`归档内路径超过 ustar 上限（未实现 PAX 扩展头）：${name}`);
    }
  }
  nameBytes.copy(h, 0);
  writeOctal(h, 100, 8, mode);            // mode
  writeOctal(h, 108, 8, 0);               // uid
  writeOctal(h, 116, 8, 0);               // gid
  writeOctal(h, 124, 12, size);           // size
  writeOctal(h, 136, 12, mtimeSec);       // mtime
  h.write('        ', 148, 8, 'ascii');   // chksum 先当 8 个空格
  h.write('0', 156, 1, 'ascii');          // typeflag：普通文件
  Buffer.from('ustar\0', 'latin1').copy(h, 257); // magic
  h.write('00', 263, 2, 'ascii');         // version
  h.write('pack-specialization', 265, 32, 'ascii'); // uname
  h.write('pack', 297, 32, 'ascii');      // gname
  writeOctal(h, 329, 8, 0);               // devmajor
  writeOctal(h, 337, 8, 0);               // devminor
  if (prefixBytes.length) prefixBytes.copy(h, 345);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

/** entries: [{ name, data: Buffer, mode, mtimeSec }] -> tar Buffer（含两个零块结束标记）。 */
function buildTar(entries) {
  const parts = [];
  for (const e of entries) {
    assertSafeArcName(e.name);
    parts.push(tarHeader(e.name, e.data.length, e.mode, e.mtimeSec));
    parts.push(e.data);
    const pad = (BLOCK - (e.data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- ustar 读取（仅用于自证）

function readCStr(h, offset, len) {
  const raw = h.subarray(offset, offset + len);
  const z = raw.indexOf(0);
  return (z === -1 ? raw : raw.subarray(0, z)).toString('utf8');
}

function readOctalField(h, offset, len) {
  const s = readCStr(h, offset, len).replace(/\0/g, '').trim();
  if (s === '') return 0;
  const n = parseInt(s, 8);
  if (!Number.isFinite(n)) throw new Fail(`tar 头里的八进制字段无法解析：${JSON.stringify(s)}`);
  return n;
}

/** 把 tar Buffer 解成条目列表（只取普通文件）。 */
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
    const mtimeSec = readOctalField(h, 136, 12);
    const type = String.fromCharCode(h[156]);
    off += BLOCK;
    if (off + size > tarbuf.length) throw new Fail(`tar 数据块越界：${full}`);
    const data = tarbuf.subarray(off, off + size);
    if (type === '0' || type === '\0') files.push({ name: full, size, mtimeSec, data });
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

// ---------------------------------------------------------------- 收集包内文件

function collectPackFiles(packDir, packId) {
  const prefix = `specializations/${packId}`;
  const files = [];
  const skipped = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) { skipped.push(`${childRel}（符号链接，跳过）`); continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) { skipped.push(`${childRel}/（目录，按规则跳过）`); continue; }
        walk(abs, childRel);
      } else if (st.isFile()) {
        if (SKIP_FILE_RE.test(name)) { skipped.push(`${childRel}（归档产物，按规则跳过）`); continue; }
        files.push({
          arcname: assertSafeArcName(`${prefix}/${toPosix(childRel)}`),
          abs,
          size: st.size,
          mtimeSec: Math.floor(st.mtimeMs / 1000),
        });
      }
    }
  };
  walk(packDir, '');
  return { files, skipped };
}

// ---------------------------------------------------------------- 生成 INSTALL.md

function buildInstallMd({ packId, version, packName }) {
  const pkg = `specializations/${packId}`;
  return `# ${packName} —— 移植包安装说明

- 移植包 id：\`${packId}\`
- 归档版本：\`${version}\`
- 归档形式：\`.tar.gz\`（解包后全部是相对路径）

解包后归档根目录下有两样东西：

- \`${ENTRY_DOC}\`（本文件）
- \`${pkg}/\`（移植包本体：README、SKILL、安装器、卸载器、自检、角色/工作流/模型数据）

## 包内文档（先读这个）

- 面向接收方的完整说明：\`${pkg}/README.md\`
- 使用技能（装到技能目录后由 DSH 技能加载器发现）：\`${pkg}/SKILL.md\`
- 随包自检：\`${pkg}/selftest.mjs\`

## 第一步：解包

    tar -xzf ${packId}-team-${version}.tar.gz

先看一眼里面有什么（可选）：

    tar -tzf ${packId}-team-${version}.tar.gz

归档是 \`.tar.gz\`。本机**实测**可用的通用工具：Windows 10 / 11 自带的 \`tar.exe\`
（bsdtar 3.8.8，位于 system32）—— \`tar -tzf\` 列出全部 25 个条目、\`tar -xzf\` 完整解开；
macOS / Linux 的标准 \`tar\` 同理。
7-Zip 一类图形解压器通常也能读 \`.tar.gz\`，但本机没装、**未实测**，不作保证。
**不要用 \`Expand-Archive\`**：它只支持 \`.zip\`；在 Windows PowerShell 5.1 上对本归档实测报
\`.gz is not a supported archive file format\`（PowerShell 7 上未实测，不作保证）。
解包后在归档根目录下操作，归档内全部是相对路径。

## 第二步：如果目标机器还没有 team-flowise，先按它的 README 安装

**本归档不含 team-flowise 的源码。** team-flowise 是宿主插件（角色注册表、工作流调度、
评审闸门、进度面板都由它提供），它随版本演进；把它冻进移植包会造成版本漂移，
所以本包只带「数据 + 安装器」，运行时按目标机器上已有的那份。

因此第二步是：**确认目标 DSH 上已经装好 team-flowise；如果没有，先按 team-flowise
自己的 README 完成安装，再回来做第三步。**

判断它是否已就位，任选一种：

- DSH 的宿主组合里存在 \`flowise-team\` 这一行；
- 或对运行中的 DSH 发一个只读探测：\`GET http://127.0.0.1:3080/api/team-flowise/ping\`
  返回 \`{"ok":true,"pong":true,...}\`。

## 第三步：安装本移植包

    cd ${pkg}
    node install.mjs --dry-run     # 先看它打算做什么（不写任何东西）
    node install.mjs               # 真正安装：角色 -> 工作流（读回校验）-> 技能

常用参数：\`--profile <dir>\`（默认 \`<DSH_HOME>/profiles/web\`）、\`--endpoint <url>\`
（默认 \`http://127.0.0.1:3080\`，写接口要求 loopback）、\`--check\`（只校验）、
\`--force\`（强制重写）、\`--skip-skill\`。

装完不需要重启 dsh：技能由技能目录热发现；角色与工作流是通过 HTTP 写进运行中进程的注册表。

## 第四步：自检

    node ${pkg}/selftest.mjs

退出码 0 = 全部通过。自检不依赖运行中的 dsh 也能跑大部分检查
（JSON 解析、DAG 无环/无悬空、产物文件名一致、PROVENANCE 的 sha256、
人设与适配文本里没有会被运行时改写的双花括号）。

## 跑一个案子

运行 input 里用 \`case_dir\` 指定产物总线目录（绝对路径，由调用方给）：

    POST http://127.0.0.1:3080/api/team-flowise/run/start
    { "workflowId": "${packId}-assessment", "input": { "case_dir": "<案件产物目录>" } }

节点之间不传递上游输出，产物按固定文件名写在 \`case_dir\` 下；
完整文件名清单见 \`${pkg}/pack.json\` 的 \`caseDirContract.artifacts\`，
以及 \`${pkg}/README.md\` 的流程表。

## 卸载

    node ${pkg}/uninstall.mjs --dry-run
    node ${pkg}/uninstall.mjs

## 能力边界（如实说明）

- **引擎级硬停**（\`haltOnFailure\`）需要带该能力的 team-flowise；装载到旧版本时安装器会告警，
  此时只有产物级阻断生效（旧版本会丢弃该字段）。
- **模型意图**在本机可解析到具体 provider/model；在别的部署上可能一个都解析不到，
  届时全部角色继承会话模型 —— 这是如实降级，不是失败。
- 本包没有 DAG 回环/回退原语：仲裁节点只能给出「退回数据整理员」的 decision 与可执行清单，
  由人（或调用方）据此**再发起一次运行**，不是自动回退。

（本文件由打包脚本 \`scripts/pack-specialization.mjs\` 生成；更详细的内容以
\`${pkg}/README.md\` 为准。）
`;
}

// ---------------------------------------------------------------- 自证

function scanDrivePaths(entries) {
  const hits = [];
  for (const e of entries) {
    if (!/\.(md|json|mjs|js|txt|ya?ml)$/i.test(e.name)) continue;
    const text = e.data.toString('utf8');
    if (text.includes('\u0000')) continue;
    text.split('\n').forEach((line, i) => {
      if (DRIVE_PATH_RE.test(line)) hits.push(`${e.name}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  return hits;
}

function scanForbidden(entries) {
  return entries.filter((e) => FORBIDDEN_PREFIXES.some((p) => e.name.startsWith(p)));
}

function runSelfTest(packDirAbs) {
  const args = ['selftest.mjs'];
  let res = spawnSync(process.execPath, args, { cwd: packDirAbs, encoding: 'utf8' });
  if (res.error) {
    // 受限沙箱下子进程管道 stdio 可能 EPERM；退化成直接继承终端输出。
    res = spawnSync(process.execPath, args, { cwd: packDirAbs, stdio: 'inherit' });
    return { status: res.status, stdout: null, stderr: null, inherited: true, error: res.error };
  }
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', inherited: false, error: null };
}

// ---------------------------------------------------------------- 主流程

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(USAGE); return EXIT_OK; }

  const packId = opts.packId;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(packId)) throw new Fail(`--pack 非法：${packId}`, EXIT_USAGE);

  const packDir = opts.packDir ? pathResolve(opts.packDir) : join(SPEC_ROOT, packId);
  if (!existsSync(packDir)) throw new Fail(`找不到移植包目录：${packDir}`);

  // ---- 包清单（pack.json）：读一次，供默认版本号与标题使用
  const packJsonPath = join(packDir, 'pack.json');
  let packMeta = null;
  if (existsSync(packJsonPath)) {
    const text = readText(packJsonPath);
    try { packMeta = JSON.parse(text); }
    catch (e) { throw new Fail(`pack.json 不是合法 JSON：${e && e.message ? e.message : e}`); }
  }

  // ---- 版本号
  let version = opts.version;
  let versionSource = '--version';
  if (!version) {
    if (!packMeta) throw new Fail(`缺少 pack.json，无法确定默认版本：请用 --version 指定`);
    version = packMeta.version;
    versionSource = 'pack.json.version';
    if (!version) throw new Fail(`pack.json 里没有 version 字段：请用 --version 指定`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(String(version))) {
    throw new Fail(`版本号非法（不允许路径分隔符）：${version}`, EXIT_USAGE);
  }
  version = String(version);

  const outDir = pathResolve(opts.out || join(REPO_ROOT, 'dist'));
  const archiveName = `${packId}-team-${version}.tar.gz`;
  const archivePath = join(outDir, archiveName);

  // ---- 收集文件
  const { files, skipped } = collectPackFiles(packDir, packId);

  const have = new Set(files.map((f) => f.arcname.slice(`specializations/${packId}/`.length)));
  const missing = REQUIRED_FILES.filter((f) => !have.has(f));
  for (const d of REQUIRED_DIRS) {
    if (![...have].some((f) => f.startsWith(`${d}/`))) missing.push(`${d}/（目录内至少一个文件）`);
  }
  if (missing.length > 0) {
    throw new Fail(`包内缺少必需内容，拒绝产出不完整归档：\n  - ${missing.join('\n  - ')}`);
  }

  // INSTALL.md 的 mtime 取包内最新 mtime（而不是「现在」），这样同样的输入产出同样的字节；
  // 需要完全可复现时可用 SOURCE_DATE_EPOCH 覆盖全部条目的 mtime。
  const sourceEpoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH || '', 10);
  const stamp = Number.isFinite(sourceEpoch) && sourceEpoch > 0 ? sourceEpoch : null;
  const maxMtime = stamp !== null ? stamp : files.reduce((n, f) => Math.max(n, f.mtimeSec), 0);
  const packName = (packMeta && packMeta.name) || packId;
  const installMd = buildInstallMd({ packId, version, packName });

  const entries = [
    { name: ENTRY_DOC, data: buf(installMd), mode: 0o644, mtimeSec: maxMtime, from: '(脚本生成)' },
    ...files.map((f) => ({
      name: f.arcname, data: readFileSync(f.abs), mode: 0o644,
      mtimeSec: stamp !== null ? stamp : f.mtimeSec,
      from: f.abs,
    })),
  ];

  const totalBytes = entries.reduce((n, e) => n + e.data.length, 0);

  // ---- 前置结构断言（不写盘也能查）
  const forbidden = scanForbidden(entries);
  if (forbidden.length > 0) throw new Fail(`归档里出现了不该打包的内容：${forbidden.map((e) => e.name).join(', ')}`);
  const localHits = scanDrivePaths(entries);
  if (localHits.length > 0) {
    throw new Fail(`源文件里出现了盘符绝对路径（归档内不得含绝对路径）：\n  ${localHits.join('\n  ')}`);
  }

  out('=== 计划 ===');
  out(`仓库根：${REPO_ROOT}`);
  out(`移植包：${packDir}`);
  out(`版本：${version}（来源：${versionSource}）`);
  out(`输出：${archivePath}`);
  out(`条目：${entries.length}（${ENTRY_DOC} + specializations/${packId}/** ${files.length} 个文件）`);
  out(`原始内容总计：${totalBytes} 字节（${kib(totalBytes)}）`);
  if (skipped.length > 0) out(`跳过：${skipped.join('；')}`);

  if (opts.list) {
    out('');
    out(`=== 归档条目（${entries.length}）===`);
    for (const e of entries) {
      out(`${String(e.data.length).padStart(8)}  ${new Date(e.mtimeSec * 1000).toISOString().replace('T', ' ').slice(0, 19)}  ${e.name}`);
    }
    out('');
    out('（--list：未写任何文件）');
    return EXIT_OK;
  }

  if (opts.dryRun) {
    out('');
    out('（--dry-run：未写任何文件、未执行自证）');
    return EXIT_OK;
  }

  // ---- 写盘
  mkdirSync(outDir, { recursive: true });
  const tarBuf = buildTar(entries);
  const gzBuf = gzipSync(tarBuf, { level: GZIP_LEVEL });
  writeFileSync(archivePath, gzBuf);

  const archiveAbs = pathResolve(archivePath);
  out('');
  out('=== 归档 ===');
  out(`绝对路径：${archiveAbs}`);
  out(`字节数：${gzBuf.length}`);
  out(`sha256：${sha256(gzBuf)}`);

  // ---- 自证 1：写出的字节解回内存并比对条目
  const backRaw = gunzipSync(readFileSync(archiveAbs));
  const back = untar(backRaw);
  const wantNames = entries.map((e) => e.name);
  const gotNames = back.map((e) => e.name);
  if (wantNames.length !== gotNames.length || wantNames.some((n, i) => n !== gotNames[i])) {
    throw new Fail(`回读条目与计划不一致：\n  计划 ${wantNames.length}：${wantNames.join(', ')}\n  回读 ${gotNames.length}：${gotNames.join(', ')}`);
  }
  for (let i = 0; i < entries.length; i += 1) {
    if (back[i].size !== entries[i].data.length || !back[i].data.equals(entries[i].data)) {
      throw new Fail(`回读内容与源不一致：${back[i].name}`);
    }
  }
  out(`回读：${back.length} 个条目、内容与源逐字节一致`);

  // ---- 自证 2：解到系统临时目录
  const tmpRoot = mkdtempSync(join(tmpdir(), `${packId}-pack-`));
  let keepTmp = false;
  try {
    for (const e of back) {
      assertSafeArcName(e.name);
      const dest = join(tmpRoot, ...e.name.split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, e.data);
    }
    out(`解包到：${tmpRoot}（${back.length} 个文件）`);

    // 自证 3：解出的内容里不得有盘符绝对路径
    const driveHits = scanDrivePaths(back);
    if (driveHits.length > 0) {
      keepTmp = true;
      throw new Fail(`解出的归档里含盘符绝对路径：\n  ${driveHits.join('\n  ')}`);
    }
    out('路径检查：归档内无盘符绝对路径、无 node_modules、无 team-flowise 源码');

    // 自证 4：在解出的包里跑 selftest.mjs
    const packDirAbs = join(tmpRoot, 'specializations', packId);
    if (!existsSync(join(packDirAbs, 'selftest.mjs'))) throw new Fail(`解包后找不到 selftest.mjs：${packDirAbs}`);
    const st = runSelfTest(packDirAbs);
    out('');
    out(`=== selftest（cwd=${packDirAbs}）===`);
    if (st.inherited) {
      out('（子进程直接继承终端输出）');
    } else {
      if (st.stdout) process.stdout.write(st.stdout);
      if (st.stderr) process.stderr.write(st.stderr);
    }
    out(`selftest 退出码：${st.status}`);
    if (st.status !== 0) {
      keepTmp = true;
      throw new Fail(`归档自证失败：selftest.mjs 退出码 ${st.status}`);
    }
    out('');
    out('=== 结果 ===');
    out('PASS：归档已生成并自证可用（条目回读一致 + 解包成功 + 无绝对路径 + selftest 通过）');
    return EXIT_OK;
  } finally {
    if (keepTmp) out(`（自证失败，临时目录保留以便排查：${tmpRoot}）`);
    else { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 清理失败不改变结论 */ } }
  }
}

// ---------------------------------------------------------------- 入口

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  const code = (e && e.exitCode) ? e.exitCode : EXIT_FAIL;
  process.stderr.write(`打包失败：${e && e.message ? e.message : e}\n`);
  process.exitCode = code;
}
