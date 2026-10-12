# @local/team-flowise

Flowise 式的**多角色（multi-agent）团队编排**插件，作为 DSH 的可组合 bundle 打包：宿主半提供模型工具、持久存储、DAG 调度与 REST 接口；客户端半提供设置页看板、侧栏常驻状态入口与进度视图。

它把「一个 agent 干完」变成「一组有角色、有依赖、有独立评审、有返工上限的 agent 干完」，并且把过程与产出留在可查的记录里。

- 版本：`0.1.0`（`private`，`type: "module"`）
- 入口：`main` = `src/index.js`；客户端出口 = `./client` → `src/client/index.js`
- bundle patch：`cordis.patch.yml`（**声明 `flowise-team` 这一行**——行由拥有它的 bundle 自己声明，这样「装上这个包」就等于「挂上这行」。`dsh plugin --profile <名> add <spec>` 只把包加入 `dsh.profile.bundles` 并组合它的 patch 层，从不改写 profile 自己的 patch 文件；若把行写在 profile 里，装完就是「bundle 挂上了、什么都不注册」）

---

## 一、宿主半做什么（`src/index.js`）

- **注册 7 个模型工具**（会话内由 agent 直接调用）：

  `team_create_agent`、`team_create_task`、`team_create_workflow`、`team_delegate_agent`、`team_list_agents`、`team_run_workflow`、`team_task_status`

- **打开四个持久存储域**（见第二节），并把 domain 的生命周期绑到插件 effect 上（stop/update 自动 close，无句柄泄漏）。
- **提供 `teamOrchestrator` 服务**（服务名固定；`upsertAgent` / `upsertWorkflow` / `runWorkflow` 等接口供工具与 REST 复用）。
- **DAG 调度器**：解析 `nodes` + `dependsOn` → 就绪波次（同波次并发）→ 每节点建台账任务 → 派发 worker 子代理 → 回收产出 → 写运行快照；默认单步超时 600000ms。
- **评审与返工**：节点 `reviewer`（或工作流级 `review.reviewer` 默认值）触发独立评审者；阻塞项原文交回 worker 返工；上限单节点 2 轮、整次运行 3 轮；R1–R6 六条机械降级（非法严重度/证据不足/复审新增阻塞项等一律降级为 advisory，`rework` 但零阻塞项改判 `pass`）。
- **模型路由解析**：五档优先级 `run > node > workflow > role > inherited`，层内整层胜出、不做跨层拼接；`provider`/`model` 必须成对；不可用的路由回退继承父级并把原因写进节点 `route.warning`。
- **人设拼接**：`role.systemPrompt -> workflow.prompt -> node.promptAddon`，产物落在子代理的 persona 段（遮蔽 deployment persona 段）。
- **REST 接口**（第三节），读接口无守卫，写接口仅回环地址可用。
- **worker 工具拒绝清单**：角色子代理拿不到会挂起或无限委派的工具（`ask_user_question`、`exit_plan_mode`、`cordis_*`、`goal` 系、`ralph`、`workflow`、`subagent`、`interrupt_agent`、`send_message`、`list_agents`，以及全部 7 个团队工具自身）。

## 二、客户端半做什么（`src/client/index.js`）

用 `window.__ModuleLoader__.load({ id, factory })` 形态发布，`React.createElement` 编写，注册 **5 个槽位**：

| 槽位 | id / key | 作用 |
|---|---|---|
| `settings.section` | `team` | 设置页「多 Agent 团队」看板：`看板` / `Agents` / `工作流` / `任务` / `运行` 五个标签；角色的新建/编辑表单（人设、模型路由、工具预设、超时） |
| `sidebar.panellist` | `team-progress` | 左栏面板图标「多 Agent 团队进度」，打开中央整页视图 |
| `main` | `team-progress` | 中央进度页：角色交互时序（UML 风格 SVG）+ 角色卡片 + 产出/推理下钻 |
| `sidebar.right.pane.tab`（+ `.title`） | `team-flowise-progress` | 会话右侧停靠的「多 Agent 进度」页签 |
| `sidebar.footer.action` | `team-flowise-progress` | 侧栏底部**常驻状态入口**（团队运行中/空闲/其他会话运行中）；点击优先打开右栏页签，服务缺失时逐级降级 |

进度页只读 `/progress`（轻量轮询）与 `/role`（按需下钻）。**会话归属**：默认按当前会话过滤，界面如实区分三种状态——本会话有运行 / 本会话暂无运行（会写明下面这条属于其他会话，或归属未知）/ 完全没有运行；并带「本会话 ↔ 全部运行」开关。请求失败（401/404/500）显示**错误态**，绝不伪装成空态。

注：`src/client/index.legacy-settings-only.js.txt` 是 P5 之前的「只有设置页」客户端快照，**仅作历史参考**，不参与构建，运行时不会加载 `.txt`。

## 三、四个存储域（唯一持久真相源）

| domain | table | 内容 |
|---|---|---|
| `team_agent_defs` | `defs` | 角色定义：`name` / `role` / `systemPrompt` / `model`(路由) / `tools`(含 `preset`) / `timeoutMs` |
| `team_ledger` | `tasks` | 任务台账：`status`（`queued`→`submitted`→`working`→`completed`/`reworked`→`settle`）、`iteration` 返工轮次、`history`、产出 |
| `team_workflows` | `flows` | 工作流定义：`nodes`（`agent`/`dependsOn`/`reviewer`/`taskTemplate`/`promptAddon`/`route`）、工作流级 `route`/`prompt`/`review` |
| `team_runs` | `runs` | 运行记录：`status`、`nodeStates`（每节点产出/路由/人设/评审）、`sessionId`、`result` |

落盘位置（file 后端）：`~/.dsh/storages/<domain>.json`，例如 `~/.dsh/storages/team_runs.json`。

约束：**新增字段一律 optional 且不加 default**——domain 打开时会用 schema 校验已存记录，收紧 schema 会让插件启动即打不开域。`settings` 命名空间只承载设置表单的瞬时 UI 状态，不持久化角色与工作流。

## 四、REST 端点清单

基址 `/api/team-flowise`。

**读（GET，无守卫）**

| 端点 | 查询参数 | 返回 |
|---|---|---|
| `/ping` | — | `{ ok, pong, domains:[四个域] }` |
| `/agents` | — | `{ ok, agents:[角色定义全量] }` |
| `/workflows` | — | `{ ok, workflows }` |
| `/tasks` | — | `{ ok, tasks }` |
| `/runs` | `session`（可选；不传与改动前一致） | `{ ok, runs }` |
| `/progress` | `runId`（可选，最高优先）、`session`（可选） | 运行摘要 + `scope` + `nodes[]` + `roles[]` + `reviewers[]` + `totals` |
| `/role` | `runId`、`agent`、`session` | 某角色的 `nodes[]`（含产出/推理/评审）与 `reviews[]`（它作为评审者的复核记录） |
| `/run` | `id` | `{ ok, run }` |
| `/models` | — | provider → model → efforts 目录（设置页表单用） |

**写（POST/DELETE，仅回环地址；非回环一律被守卫拒绝）**

| 端点 | 方法 | 请求体 / 参数 |
|---|---|---|
| `/agent` | POST / DELETE | POST：角色定义；DELETE：`?id=<角色 id>` |
| `/workflow` | POST / DELETE | POST：工作流定义；DELETE：`?id=<工作流 id>` |
| `/task/create` | POST | 任务台账条目 |
| `/task/rework` | POST | `{ id, feedback }` |
| `/run/start` | POST | `{ workflowId, input, route, session }`（`session` 可选，不猜） |

## 五、目录结构

```
packages/team-flowise/
├── package.json                   # @local/team-flowise；dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml               # 空数组 []（插件行加在 profile 的 patch 里）
├── README.md                      # 本文件
└── src/
    ├── index.js                   # 宿主半：工具 / 存储域 / 调度器 / 评审 / REST
    └── client/
        ├── index.js               # 客户端半：5 个槽位注册
        └── index.legacy-settings-only.js.txt   # P5 前快照，仅供参考

（仓库根，不在包内）
├── skills/team-flowise/SKILL.md   # 技能文件：什么时候用、怎么用（见第六节）
├── scripts/install.mjs            # 一键安装（幂等）
├── scripts/uninstall.mjs          # 卸载（幂等）
└── README.md                      # 安装 / 验证 / 卸载章节
```

## 六、技能文件

技能在 **`skills/team-flowise/SKILL.md`**（仓库根下的目录束，相对本包为 `../skills/team-flowise/`；目录名与 frontmatter 的 `name` 一致，都是 `team-flowise`）。

它的职责是让任何 agent 在**需要多角色协作时**知道该用这套工具、以及怎么用：触发场景、七步完整流程（建角色 → 建工作流 → 启动 → 看进度 → 看评审结论 → 返工）、7 个工具逐个说明与坑、模型路由/人设/工具预设/超时的语义、审核纪律与返工上限、界面入口、常见故障、安装与可移植。

安装脚本会把它复制/链接到技能根目录（默认用户级 `~/.dsh/skills/team-flowise/`，也支持 `.agents` 兼容根）。

## 七、安装 / 卸载

以**仓库根 `README.md` 的「安装」章节**为准（含前置条件、一条命令安装、验证、卸载与「为什么必须重启」）。脚本接口：

```sh
node scripts/install.mjs   [--profile <dir>] [--package <dir>] [--dry-run] [--check] [--help]
node scripts/uninstall.mjs [--profile <dir>] [--dry-run] [--check] [--help]
```

- 默认 profile 为用户目录下的 `web` profile（`~/.dsh/profiles/web`），**脚本不写死机器专属绝对路径**。
- **打包的 DSH Desktop 上没有 `dsh` 命令可敲**：harness 在应用内部、profile 由应用托管，所以安装入口是应用自己的「插件」面板。收录前的直连做法——走应用自己的二进制，因为 `lib/bin.js` 位于 `app.asar` 内、普通 `node` 打不开——以及桌面端那条 peer 兼容门禁（声明的 `@deepseek-ai/dsh-*` 范围不含当前 harness 时，装上也会被启动拒绝，直到为那几个确切版本授予豁免），都写在仓库根 `README.md` 的「DSH Desktop」小节。
- 脚本做的事：把本包链接进 profile 的 `node_modules`；在 profile 的 `package.json` 里补依赖与 `dsh.profile.bundles` 项；**删除** profile 的 `cordis.patch.yml` 里历史遗留的 `flowise-team` `- insert:` 行（本仓库早期版本写过它；宿主行现在由本包自己的 `cordis.patch.yml` 声明，profile 里留着会让同一个 id 被装配两次、宿主启动即抛 `duplicate loader entry id`）；安装技能文件。
- 全部幂等：重复执行不产生重复链接 / 重复依赖 / 重复 bundles 项，也不会重复删行。`--check` 用退出码区分「已装且一致」与「未安装/不一致」——一个仍带着历史行的 profile 会报 3（需要迁移），这是刻意的。
- **装完必须重启 dsh**：宿主代码与客户端 bundle 在启动时加载/快照。重启前访问新路径会得到 401（本部署的网关把未注册的 `/api` 路径伪装成 401），界面入口也不会出现。
