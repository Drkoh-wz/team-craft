# team-flowise — DSH 的多角色团队编排插件

[English](README.md) | 中文

`@local/team-flowise` 把「一个 agent 干完」变成「一组有角色分工的 agent 干完，并且留下证据」：按依赖排序的节点图、角色级模型路由 / 人设 / 工具预设 / 超时、带返工上限的独立评审闸口、可追溯的运行台账，以及 Web 界面里的进度面板。

- **宿主半**：`packages/team-flowise/src/index.js` —— 注册 `team_*` 模型工具、发布 `teamOrchestrator` 服务、拥有四个持久存储域、提供 `/api/team-flowise/*`
- **客户端半**：`packages/team-flowise/src/client/index.js` —— 设置页分区、侧栏入口、右侧栏进度页
- **技能**：`skills/team-flowise/SKILL.md` —— 告诉 agent 什么时候用、怎么用
- **接线快照**：`deploy/` —— 插件是怎么被装进 dsh profile 的

## 截图

**角色。** Agents 页把每个已存角色连同它将要使用的模型路由、以及人设的一句话摘要列出来。在这里建一个角色只是写一条记录；运行时某个节点点名它，才会读它。

![Agents 页：角色行，附 provider/model 与人设字数](packages/team-flowise/screenshots/roles.png)

**任务看板。** 运行的每个节点都会变成一条台账任务，所以看板就是这次运行自己的状态——列是生命周期，卡片带着负责人与迭代轮次。`it1` 表示第一轮；被退回过的卡片会写出来。

![任务看板：已排队 / 已提交 / 进行中三列，每张卡片有负责人与迭代轮次](packages/team-flowise/screenshots/task-board.png)

**运行进度。** 右侧栏承载这次运行的实时视图：节点图与它逐波次的派发、每个角色各自的进度，以及你选中的那个节点的实际执行条件——provider 与 model、reasoning effort、输出上限、它拿到的人设，以及评审结论。下面这次运行，是这个插件在**给自己**写界面。

![右侧栏进度页：节点图、各角色进度，以及所选节点的模型路由、人设与评审结论](packages/team-flowise/screenshots/run-progress.png)

---

## 安装

### 从 GitHub 装（官方方式）

插件就是这个仓库里的一个普通包，所以 dsh 自己的 plugin 命令可以直接从 GitHub 装，不用 clone、不用 registry：

```sh
dsh plugin --profile web add "git+https://github.com/Drkoh-wz/team-craft.git#path:packages/team-flowise"
```

这条命令是 pnpm 的一层薄转发：把包装进 profile 的 `node_modules`、写进 `dsh.profile.bundles`、并组合那一层补丁。因为 `packages/team-flowise/package.json` 声明了 `dsh.bundle.patch`，这个 bundle 会被认作一个 profile 层；又因为这个 bundle **自己的** `cordis.patch.yml` 声明了 `flowise-team` 行，所以**装上这个包就等于挂上它**。

两个细节是承重的，不是附带的：

- `#path:packages/team-flowise` 这一截是必需的。本仓库根目录**没有** `package.json`（它是个多包仓库：插件、一个客户端包、专用团队、技能、验收工装），指向仓库根的安装解析不出可用的东西。选子目录靠的就是 pnpm 的 `#path:` 片段——写这一行之前，我拿一个本地 bare 仓库实测过。
- 包内**没有** `prepare` 脚本，所以安装时不需要构建，也不需要授予 pnpm 构建权限。

装完重启 dsh；然后按下面「重启后如何确认」那张表逐条核对。

### 从克隆装

下面全部是本地克隆这条路：它额外会把面向 agent 的技能装上，而且完全不需要联网。

### 前置条件

| 要求 | 为什么 | 怎么查 |
|---|---|---|
| Node.js ≥ 20（只用内置模块，不需要 npm install） | `scripts/install.mjs` / `uninstall.mjs` 只用 `node:` 内置模块 | `node --version` |
| 一个 dsh profile 目录（`package.json` + `cordis.yml` / `cordis.patch.yml`） | 插件行与依赖就住在这里 | `node scripts/install.mjs --check` |
| 本地已检出插件包 | 它以本地 `file:`/`link:` 依赖的方式挂载，从不发布到 registry | `ls packages/team-flowise/package.json` |
| 已装 dsh，且其 profile 能解析 `@deepseek-ai/*` bundle | profile 本来就依赖它们 | 你正在运行 dsh |

一个目录必须**同时**具备 `package.json` 与 `cordis.yml`（或 `cordis.patch.yml`）才会被当作 profile；其它情况会带着明确错误被拒，脚本不会因为手滑指错目录而乱写。默认目标是 `<dsh-home>/profiles/web`，其中 `<dsh-home>` 取 `$DSH_HOME`，没设就是 `~/.dsh`（Windows 上是 `%USERPROFILE%\.dsh`）。

### 一条命令

在仓库根目录：

```sh
node scripts/install.mjs
```

安装就是这一条。它是**幂等**的：再跑一次，每一步都报 `已存在，跳过`，一个字都不写。常用变体：

```sh
node scripts/install.mjs --help                  # 全部选项
node scripts/install.mjs --profile <dir>         # 装进另一个 profile
node scripts/install.mjs --dry-run               # 打印将发生的改动 + 逐行 diff，不写盘
node scripts/install.mjs --check                 # 只校验：exit 0 = 已装且一致，exit 3 = 有漂移
node scripts/install.mjs --json                  # 机器可读报告打到 stdout
node scripts/install.mjs --dep-spec relative     # 强制用 "file:<相对>"，不用 "auto" 的判断
node scripts/install.mjs --skill-root none       # 不安装技能
```

它按顺序做的事：

1. **校验**目标 profile（并校验 `--package` 真的是 `@local/team-flowise`）；
2. 建立 `<profile>/node_modules/@local/team-flowise` → `<repo>/packages/team-flowise`。Windows 上这是**目录联接（junction）**，不需要管理员权限，也不需要开发者模式。已存在的链接若指向别处，是**硬错误**而不是静默覆盖（`--force` 是显式替换的唯一途径）。链接被拒绝时脚本带着补救办法失败，绝不偷偷改成复制——复制会让源码改动不再生效，比报错更糟；
3. 把 `"@local/team-flowise"` 写进 `<profile>/package.json` 的 `dependencies` 与 `dsh.profile.bundles`（去重；已有顺序永不重排）。依赖值默认在 profile 与包同盘时用 `file:<相对>`，否则 `file:<绝对>`。已经指向本包的既有值**原样保留**——所以活动 profile 里手写的 `link:...` 不会被改写；
4. **退掉** `<profile>/cordis.patch.yml` 里历史遗留的 `flowise-team` `- insert:` 行。这一行现在由拥有它的 bundle（`packages/team-flowise/cordis.patch.yml`）声明，这也正是「装上包就够了」的原因；profile 里再留一份会让同一个 id 被装配两次，宿主启动时抛 `duplicate loader entry id` 直接起不来。用早期版本接过线的 profile 里还留着它，所以脚本只**删**、从不**加**。其余每一行（含注释）逐字不动，文件仍是合法的顶层 YAML 数组（`[]`）；
5. 把技能复制进 `<dsh-home>/skills`（用 `--skill-root agents|project|none` 或 `--skill-dir <dir>` 改），复制前先校验 frontmatter；
6. 打印哪些改动需要重启、以及重启后怎么确认。

它重写的每个文件都会先备份成 `<file>.bak-<时间戳>`（同一秒内已有备份就跳过，绝不覆盖更早的备份）。`--dry-run` 完全不写盘。

### 为什么必须重启

宿主代码与客户端 bundle 都是**启动时**加载或快照的：

- profile 组合（bundles + `cordis.patch.yml` + `--patch` 叠加层）在宿主启动时被解析并挂载，`packages/team-flowise/src/index.js` 就是那一刻被 import、`flowise-team` 行就是那一刻被实例化的。**运行中的宿主里不会凭空多出一个新行**；
- 客户端半在激活时从 `dsh.client` bundle 读一次，之后宿主把这份快照不可变地发给浏览器。源码改动只能通过 HMR 的 `rebuilt()` 推送到达浏览器，而那需要有构建 watcher 在跑（dsh 实现 checkout 用 `pnpm run dev:web` 提供）。没有 watcher 时，**改客户端也要重启**。

所以：停掉 dsh，再启动。改那两个源文件同理。

有一个例外，值得知道，因为它恰好在 `scripts/install.mjs` 做迁移时咬人：profile 自己的补丁文件（`cordis.patch.yml`）**在宿主运行期间是被监听的**。dsh 从 profile manifest 读 `dsh.profile.patchReload`，没写时默认 `live`。所以从那个文件里删掉一行**不用等重启**——宿主当场重新组合，插件当场被卸载（实测：`/api/team-flowise/*` 变 401，工具列表里的 `team_*` 消失，而那时还没重启过）。

这是把双刃剑。它意味着删掉历史 profile 行会立刻生效，并让插件一直处于未挂载状态，直到下一次重启读到 bundle 自己的补丁——所以**迁移和重启要在同一次坐下来做完**，下面那张确认表就是这么假设的。它同时也就是插件市场做「热禁用/启用」用的同一个机制：往那个文件里写 `- id: …` + `disabled:`，就是一个不用重启的开关。

### 重启后如何确认

别信浏览器缓存，也别信旧进程——按这个顺序查：

| # | 检查 | 期望 |
|---|---|---|
| 1 | `node scripts/install.mjs --check` | exit 0，每一步都是 `已存在，跳过` |
| 2 | 宿主 HTTP：`GET http://127.0.0.1:3080/api/team-flowise/ping` | `{"ok":true,"pong":true,"domains":[…4 个域…]}` —— 404 说明行没挂上 |
| 3 | **工具**：开一个新会话，看它的工具列表 | 7 个工具，各有自己的描述：`team_create_task`、`team_task_status`、`team_create_agent`、`team_create_workflow`、`team_list_agents`、`team_delegate_agent`、`team_run_workflow` |
| 4 | **界面**：dsh Web GUI → 设置 | 出现 `team-flowise` 分区（角色 / 工作流 / 运行） |
| 5 | **界面**：右侧栏 | 出现「多 Agent 进度」页签 |
| 6 | 技能 | `node -e "console.log(require('fs').existsSync(require('path').join(require('os').homedir(),'.dsh','skills','team-flowise','SKILL.md')))"` → `true`，且新会话的技能列表里有 `team-flowise` |

第 2 条失败，就是行没挂上：重跑 `--check`，再到宿主日志里找启动错误（两个常见原因：`flowise-team` 行 id 重复；链接指向的目录里没有 `src/index.js`）。第 2 条过了但第 3 或 4 条失败，说明插件挂上了却没贡献任何东西——去看宿主日志里这一行自己打的警告。

### 卸载

```sh
node scripts/uninstall.mjs            # 默认目标：<dsh-home>/profiles/web
node scripts/uninstall.mjs --check    # exit 0 = 已彻底卸载，exit 3 = 仍有残留
node scripts/uninstall.mjs --remove-skill   # 连技能一起卸（默认保留）
```

它移除的正好是安装器加的东西——链接、`dependencies` 项、`dsh.profile.bundles` 项，以及任何历史遗留的 `- insert:` 块——同样幂等（第二次跑每项都报 `不存在，跳过`）。`cordis.patch.yml` 的注释与所有其它行逐字不变；如果补丁层被清空到一条 entry 都不剩，脚本会补回一行 `[]`，因为 dsh 要求那个文件是顶层 YAML 数组（只剩注释会让宿主启动即报错）。备份（`*.bak-<时间戳>`）一律保留。技能默认保留：它是用户级资产；`--remove-skill` 把它**移出**技能根目录（移到 `<dsh-home>/.team-flowise-removed-<时间戳>/`），这样它不会再被发现，但仍可手工恢复。

之后重启 dsh——理由同上。

---

## 目录结构

| 路径 | 是什么 |
|---|---|
| `packages/team-flowise/` | 插件包（宿主半、客户端半、`cordis.patch.yml`） |
| `scripts/install.mjs`、`scripts/uninstall.mjs` | 上面讲的便携安装器 / 卸载器 |
| `skills/team-flowise/SKILL.md` | 会被装进技能根目录的技能 |
| `deploy/` | 插件是怎么接进 dsh profile 的，外加一份可移植的 profile 快照 |
| `validation/` | 验收脚本（`p8`、`p10`、`p11`、`p12`、`p13`、`p15`、`p16`） |
| `workflows/` | 示例工作流定义 |
| `packages/team-flowise/screenshots/` | 上面的截图（同时就是市场声明的那些文件） |

## 贡献者须知

- 宿主半是 ESM 纯 JavaScript（`src/index.js`）；客户端半用 `React.createElement`，并且必须保持 `window.__ModuleLoader__.load({ id, factory })` 这个结构。两边都不许引入外部依赖。
- `deploy/web-profile/package.json` 是一份**可移植模板**：它的 `file:../../packages/team-flowise` 是相对 `deploy/web-profile/` 自己算的。不要手改活动 profile——跑 `scripts/install.mjs`。
- 客户端插件改动需要什么（重建 / 刷新）写在 `deploy/README.md`。
- `packages/team-flowise-client/` 是 P5 的独立客户端原型，**没有**挂进任何 profile——真正发布的客户端半是 `packages/team-flowise/src/client/index.js`。`validation/` 下有几个脚本 import 它的构建产物，所以它还在这里。
- 仓库根目录的 `P*.md` 是各开发阶段当时的计划 / 评审 / 验收记录，原样保留。它们描述的是那个阶段的代码，所以是历史，不是现行文档——与代码或与本 README 冲突时，以代码为准。具体到其中好几份都写着「bundle patch 层不能新增行」，那是错的，`deploy/README.md` 记下了推翻它的那次实测。

## 发布这个插件

社区目录是 [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，dsh-market 插件读的就是它。一条条目需要：

| 要求 | 现状 |
|---|---|
| `package.json` 里声明 `dsh.bundle` | `packages/team-flowise/package.json` |
| 旁边有 `cordis.patch.yml` | `packages/team-flowise/cordis.patch.yml` |
| 根包 **或** `packages/` / `plugins/` / `apps/` 子包 | 本仓库是 `packages/` 子包 |
| 官方 `@deepseek-ai/*` 用 `peerDependencies` 声明 | 宿主提供的那些是 peer；本包**自己 import** 的两个放进 `dependencies`，理由与实测见下 |
| 仓库打好 `dsh-plugin` topic | 仓库设置，不是文件 |
| 仓库创建满一天 | 自己会到 |
| 描述属实、不带营销词 | 本 README 第一段 |

monorepo 子包的条目要指向子目录、并把子包写进名字里——见 registry 的 `contributing.md`。本仓库上面那条安装命令里的路径片段，正是市场要用的那个。

### 官方包各自该放哪一格

registry 建议把官方 `@deepseek-ai/*` 声明为 `peerDependencies`。那条建议的前提是**宿主让它们可解析**，而 stock profile 并不：dsh 的 profile 模板同时设了 `nodeLinker: hoisted` **和 `autoInstallPeers: false`**，peer 永远不会被安装。于是一个**静态 import** 这类包的插件，在干净机器上会在 `import` 阶段就失败——这是量出来的，不是推的：

```text
fresh `dsh plugin add`，stock profile：
  @deepseek-ai/dsh-tools          -> MODULE_NOT_FOUND
  @deepseek-ai/dsh-storage-domain -> MODULE_NOT_FOUND
  zod                             -> resolved
```

所以「bundle 运行时真正 import 的包」放进 `dependencies`，只有宿主确实提供的才留作 peer。其它已收录的宿主面插件用的是同一种切法（`dsh-heartbeat` 把它 import 的包放在 `dependencies` 里）。按这个切法，在 stock profile 上：

```text
  @deepseek-ai/dsh-tools          -> <profile>/node_modules/@deepseek-ai/dsh-tools/lib/index.js
  @deepseek-ai/dsh-storage-domain -> <profile>/node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js
```

剩下的 `peerDependencies` 是本插件 `inject` 的、由宿主 bundle 提供的 Cordis 服务；它们**故意**不被安装，pnpm 会对每一个宿主面插件都报 unmet peer。那个警告是预期的。

### 市场里的截图

dsh-market 会像 App Store 那样展示截图，仓库通过放在**包的 `package.json` 旁边**的 `screenshots.json` 来声明——monorepo 条目就是放在对应子目录里，且路径里不能有 `..`。它们现在就在那里：`packages/team-flowise/screenshots.json` 按展示顺序列出 `packages/team-flowise/screenshots/` 下的三张图。本 README 链的是同一批文件，所以改动文件名不可能只烂掉一边。

这些图**刻意不进任何分发包**：`scripts/pack-plugin.mjs` 跳过 `screenshots/`，`packages/team-flowise/package.json` 的 `files` 列表则让 `npm pack` 不把它们带进包管理器消费的那个 tarball。两者都是**被断言**的而不是被期望的——真有截图混进归档，打包器会红。

### Release tarball（可选）

市场更偏好预构建的 tarball 而不是源码构建。本仓库自己的 `scripts/pack-plugin.mjs` 产出的是**安装器**归档（包 + 技能 + 安装器），那是另一种东西；包管理器能直接吃的那份来自 `npm pack`：

```sh
npm pack ./packages/team-flowise --pack-destination dist
# 改成不带版本号的资产名，因为 `releases/latest/download/<名>`
# 只在请求时解析 `latest`、文件名是照字面取的
mv dist/local-team-flowise-0.1.0.tgz dist/team-flowise.tgz
```

把 `dist/team-flowise.tgz` 挂到以版本号命名的 GitHub Release 上，再让目录条目指向它。

### 目录条目

投稿就是在 `awesome-dsh-plugin/awesome-dsh-plugin` 里加一个文件，名为 `data/plugins/Drkoh-wz__team-craft--packages-team-flowise.yml`：

```yaml
url: https://github.com/Drkoh-wz/team-craft/tree/main/packages/team-flowise
name: Drkoh-wz/team-craft#team-flowise
category: workflow
tarball: https://github.com/Drkoh-wz/team-craft/releases/latest/download/team-flowise.tgz
description:
  en: 'Dependency-ordered multi-agent team runner for DeepSeek Harness: define roles, run a node graph with an independent review gate and bounded rework, and watch progress in the web UI.'
  zh: 'DSH 的多角色团队编排插件：定义角色、按依赖跑节点图，带独立评审与有上限的返工，并在界面里看进度。'
```

描述会被当作对代码的声明、并与代码核对，所以里面只写真实存在的东西。`category` 由维护者定——`workflow` 是最贴近的一格，选偏一点他们会直接改，不会因此打回。

## 许可证

MIT —— 见 [`LICENSE`](LICENSE)。
