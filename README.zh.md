# team-flowise

[English](README.md) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的多角色团队插件。定义角色、连成节点图、跑起来——然后看着它干活。当然，你也可以直接告诉agent用多agent团队去干点儿什么。

一个 agent 能搞定的事就别上团队。可活儿一旦需要分工，就需要一个出计划的、一个写代码的、一个审的，还得有人核对校验，ai时代，自然不同的人也可以是不同的模型。这个插件把这些交给你：让每个agent按依赖顺序跑，允许评审把活打回去，并且让你看见卡在哪一步。

- **角色就是记录。** 名字、人设、模型路由、工具预设、超时。在设置页里建，或者在对话里用 `team_create_agent` 建。
- **顺序由节点图决定。** 节点声明 `dependsOn`；同一波里就绪的一起并发跑。
- **评审是闸口，不是建议。** 节点可以指定自己的评审者，阻塞项**原文**退回给执行者；返工有上限——单节点两轮，整次运行三轮。
- **运行留得住。** 角色、工作流、任务台账、运行历史分别落在四个持久存储域里。被崩溃打断的运行回来时标记为「已中断」，不会被悄悄改写成「已完成」。
- **看得见。** 右侧栏有节点图、每个角色的进度，以及你选中那个节点**实际**用的模型、推理强度、输出上限和人设，外加评审结论。

七个 `team_*` 工具，在对话里就能驱动全部：`team_create_agent`、`team_create_workflow`、`team_create_task`、`team_run_workflow`、`team_delegate_agent`、`team_list_agents`、`team_task_status`。

## 截图

**角色。** 每个已存角色，连同它将要使用的模型路由。

![Agents 页：角色行，附 provider/model 与人设字数](packages/team-flowise/screenshots/roles.png)

**任务看板。** 运行的每个节点都会变成一条台账任务，所以看板**就是**这次运行的状态。`it1` 表示第一轮。

![任务看板：已排队 / 已提交 / 进行中三列，每张卡片有负责人与迭代轮次](packages/team-flowise/screenshots/task-board.png)

**运行进度。** 节点图与它逐波次的派发、各角色进度，以及选中节点实际跑在什么条件下。下面这次运行，是这个插件在给自己写界面。

![右侧栏进度页：节点图、各角色进度，以及所选节点的模型路由、人设与评审结论](packages/team-flowise/screenshots/run-progress.png)

## 安装

有两种客户端，装法不同。按你手上的那种来。

### PATH 上有 `dsh`（命令行，或 `dsh web`）

```sh
dsh plugin --profile web add "git+https://github.com/Drkoh-wz/team-craft.git#path:packages/team-flowise"
```

或者用现成的包，不需要 git——但要从**你下载到的路径**装，而不是从它的 URL：

```sh
dsh plugin --profile web add "/path/to/team-flowise.tgz"
```

这个区分不是吹毛求疵。在 pnpm 10 上，**tarball URL** 形式的依赖一旦 pnpm 的 store 里有了该 URL 的内容，就会**永久失败**：

```
ERR_PNPM_MISSING_TARBALL_INTEGRITY  its lockfile entry has no integrity field
```

它不是网络抖动：换第二个 profile、共用同一个 store 再装一次依然复现；`latest/` 这种不带版本号的 URL 和带版本号的 URL 都一样；**删 lockfile 也救不回来**（只有全新的 store 才行）。本地文件与 git 源不受影响。所以本页所有命令都走 git 源。

不用构建，也没有需要批准的步骤。请装进有 web app 的 profile，这样界面才会出现。（装进裸 profile 也挂得上，只是没有浏览器那一半。）然后重启 dsh——宿主代码和客户端 bundle 都是启动时读的，不重启就不生效。

### DSH Desktop（打包的桌面应用）

桌面端**没有 `dsh` 命令可敲**：harness 在应用内部，profile 也由应用自己托管，所以**它自己的「插件」面板就是安装入口**——本插件被目录收录后就会出现在那里。在收录之前，一个脚本就够。**先完全退出 Desktop**，然后：

```powershell
.\scripts\install-desktop.ps1
```

它会自己找到应用、在 Desktop 运行时**拒绝执行**（这正是防止它自己的 profile 维护把你的改动对账掉）、用应用自带的 pnpm、装上本项目的 Release 包，并列出重新启动后该看哪几处。其余选项是 `-Action uninstall`、`-Action check`、`-Spec <pnpm 能接受的任何东西>`、`-DryRun`、`-Force`；`Get-Help .\scripts\install-desktop.ps1 -Full` 会打印出来。它也放在 Release 归档里的 `scripts/` 下。

它**先用纯 HTTPS 把包下载下来，再从落地的那份文件安装**——正是上面实测出的那两个原因：tarball-URL 依赖在 pnpm store 变暖后会坏；而 git 源需要 git-over-HTTPS 到 github.com，在 HTTPS 被重置的网络里会回退到 ssh 并因 host key 失败。若下载连不上 GitHub，脚本会说明，并让你自己下载后传 `-Spec <路径>`——**本地文件这条路在任何情况下都能用**。

三件值得知道的事，都是手工操作容易踩的：

- `lib/bin.js` **在 `app.asar` 里面**，普通 `node` 打不开它。必须**走应用自己的二进制**、以 Node 模式驱动 harness——脚本做的就是这件事。
- pnpm 会打印一段 `missing peer`，点名 `@deepseek-ai/*` 那几个包。**这是预期的，不是失败**：那些包由 harness 在导入时自己供给，本包刻意不 vendor 任何一个。
- 如果 Windows 拒绝执行脚本——`running scripts is disabled` 或 `not digitally signed`——说明文件带着"已下载"标记。`Unblock-File .\scripts\install-desktop.ps1` 可以清掉，或者临时用 `powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1` 跑一次。

想直接看命令而不是跑脚本？就是应用自己的三个文件；`--dump-config` 是个只读的试探办法：

```powershell
$exe = (Get-Process 'DSH Desktop' | Select-Object -First 1).Path   # 退出前先把路径取出来
$Desktop = Split-Path $exe

$env:DSH_HOME = "$env:APPDATA\dsh-desktop\harness"
$env:ELECTRON_RUN_AS_NODE = '1'
& "$Desktop\DSH Desktop.exe" "$Desktop\resources\harness-node-entry.mjs" `
  "$Desktop\resources\app.asar\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  plugin --profile web add "git+https://github.com/Drkoh-wz/team-craft.git#path:packages/team-flowise"
```

装完重新启动 Desktop。

桌面版还会按插件声明的 `@deepseek-ai/dsh-*` peer 范围做门禁：范围不包含当前 harness 时，插件会装上但**启动被拒绝**，需要你为那几个确切版本授予豁免。本版本声明的是 `>=0.2.0-rc.2 <0.3.0-0`，匹配，不需要授予任何东西。

### 两种客户端都适用

已在 **DSH Desktop `0.2.0-rc.2`** 与 **`dsh` CLI `0.2.0-rc.2`** 上端到端验证（Node 24）。`packages/team-flowise/package.json` 里的 peer 范围写的是 `>=0.2.0-rc.2 <0.3.0-0`，而 harness 会在导入插件**之前**核对这个声明——所以版本过旧的 harness 会用**一行清晰的拒绝**说明不兼容，而不是稍后以一种令人困惑的方式失败。

有两件事值得知道，因为它们各自把这个插件弄挂过一次。

`@deepseek-ai/*` 由 harness 自己供给，而插件目录里若有一份副本，Node 会**先命中副本**。一个旧本地安装残留的 `dsh-tools@0.1.x` 因此遮住了 harness 的那份，import 时崩溃，把整个 Desktop 启动一起带下去了。这也正是下界取 `0.2.0-rc.2` 的原因：这套供给是 0.2 那条线才有的，在 `0.1.5` 上只声明 peer 的插件根本 import 不了。如果你从检出目录安装，请确认 `packages/team-flowise/node_modules` 里没有 `@deepseek-ai/*`——在该目录跑 `npm install --omit=peer` 就是把它保持正确的命令。

<details>
<summary>或者从克隆安装</summary>

仓库自带的安装器会额外把面向 agent 的技能装进技能根目录，而且完全不需要联网：

```sh
git clone https://github.com/Drkoh-wz/team-craft.git
cd team-craft
node scripts/install.mjs
```

它幂等，重写任何文件前都会备份，其余选项看 `--help`：

```sh
node scripts/install.mjs --check           # exit 0 = 已装且一致，3 = 有漂移
node scripts/install.mjs --dry-run         # 只打印将发生的改动，不写盘
node scripts/install.mjs --profile <dir>   # 装进另一个 profile
node scripts/install.mjs --link-mode copy  # 复制而非链接（先读下面这段）
node scripts/install.mjs --skill-root none # 不装技能
```

**Windows 上用默认链接模式前请先读这段。** 安装器会把你的检出目录链接进 profile——快，且两边保持同步——但对一个**内含该链接**的目录做递归删除时，删除会顺着链接走，把你的检出目录清空。这不是推测：

```
tree/node_modules/@local/team-flowise   ->  junction，指向本检出目录
rmSync(tree, { recursive: true })       ->  OK，而目标目录现在是空的
```

也就是说，任何删掉该 profile 目录的操作——DSH Desktop 重建 profile、包管理器修剪、手工删除——都可能顺手带走你的检出目录。`--link-mode copy` 完全没有这个风险；上面那条注册表安装命令（`dsh plugin ... add`）也从来不会遇到，因为 pnpm 是把包**复制**进 profile 的。

</details>

## 装好了吗？

按这个顺序查，别信浏览器缓存。

| # | 检查 | 期望 |
|---|---|---|
| 1 | 新开会话，看它的工具列表 | 那七个 `team_*` 工具 |
| 2 | 设置页 | 出现 **team-flowise** 分区：角色、工作流、运行 |
| 3 | 侧边栏 | 出现 **多 Agent 进度** 页签 |

命令行那条路还可以加一条：`curl -s http://127.0.0.1:<端口>/api/team-flowise/ping` 应返回 `{"ok":true,"pong":true,"domains":[…4 个…]}`（`<端口>` 就是 `dsh web` 打印的那个）。

**DSH Desktop 上请跳过这一条**：端口每次启动都可能不同，而且本地 HTTP 请求若不带应用打开界面时 URL 里的 boot token，会得到 **401**，所以上面三条才是能作准的。本该出现 ping 的位置返回 404，就是没挂上——宿主日志会说明原因，最常见的是 `flowise-team` 行重复。挂上了但 1 或 2 不通，说明挂上了却没贡献东西，日志同样会讲。

## 卸载

```sh
dsh plugin --profile web remove @local/team-flowise
```

DSH Desktop 上用同一条命令、把 `add` 换成 `remove`，同样走应用自己的二进制——拿上面 **DSH Desktop** 那段代码块改这一个词；或者直接在应用的插件面板里移除。

从克隆装的话用 `node scripts/uninstall.mjs`——加 `--remove-skill` 连技能一起收回，而且不碰任何不是它写的东西。

之后重启，理由同前。

## 它怎么工作

| | |
|---|---|
| **宿主半** —— `packages/team-flowise/src/index.js` | 注册 `team_*` 工具、发布 `teamOrchestrator` 服务、拥有四个存储域、提供 `/api/team-flowise/*`。 |
| **客户端半** —— `packages/team-flowise/src/client/index.js` | 设置页分区、侧栏入口、进度页。 |
| **技能** —— `skills/team-flowise/SKILL.md` | 告诉 agent 什么时候值得用它。 |

一个节点会以一个 worker 代理的形式派发出去，带着它角色声明的人设、模型路由和工具预设。它交回结果后，系统向该节点的评审者要一个结论；阻塞项成为下一轮的返工反馈。评审者给不出可读结论时记为 error——而 error 永远不算通过。

## 仓库结构

| 路径 | 是什么 |
|---|---|
| `packages/team-flowise/` | 插件本体：宿主半、客户端半、它自己的补丁层 |
| `skills/team-flowise/` | 技能 |
| `scripts/install.mjs`、`scripts/uninstall.mjs` | 克隆路径的安装器与卸载器 |
| `deploy/` | 插件是怎么接进 profile 的，外加一份可移植的 profile 快照 |
| `specializations/leasing-risk/` | 现成的十角色团队：融资租赁承租人还款风险评估 |
| `validation/` | 测试套件 |

## 参与开发

- 宿主半是纯 ESM JavaScript；客户端半用 `React.createElement`，必须保持 `window.__ModuleLoader__.load({ id, factory })` 这个形状。两边都不许引入运行时依赖。
- `deploy/web-profile/package.json` 是可移植模板，它的依赖路径是相对它自己算的。不要手改活动 profile，跑安装器。
- `node validation/preflight-install.mjs` 是发布闸门：把包按每一条发布路径装进一次性 profile，再启动其中一个、把它整套 HTTP 面跑一遍。它需要联网，并会临时起一个宿主。它会自己找到可测的 harness（用 `--dsh <bin>` 或 `--desktop <dir>` 指定），所以只有 DSH Desktop 的机器上也能跑。
- 离线套件（`p8` 与 `p10`–`p16`）直接 import 插件源码，而插件 import 的是 `@deepseek-ai/*` peer——测试进程没有这些。先跑一次 `node validation/dev-host-packages.mjs`，它们就会从 `.dev-host-packages/` 解析；那个目录刻意放在包目录**之外**，因为包目录里一旦有副本，就会抢在 harness 自己的供给之前被命中——那正是本次修复的那个事故。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
