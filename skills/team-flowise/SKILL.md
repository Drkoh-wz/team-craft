---
name: team-flowise
description: 当任务需要多角色/多 agent 协作时使用——把工作拆成有依赖的多个步骤、由不同角色分工完成、需要独立角色评审与验收、需要可追溯的返工记录（谁做了什么、依据是什么、返工了几轮）。也用于排查团队运行没有产出、节点一直 pending、角色建了却没有评审、角色模型没有生效、进度面板看不到本会话运行、API 返回 401 等问题。
---

# team-flowise：把「一个 agent 干完」变成「一组角色干完并留下证据」

team-flowise 是这套宿主里的多角色编排插件。它把一次开发拆成**有先后依赖的节点**，每个节点由一个**角色定义**（人设 + 模型路由 + 工具预设 + 超时）承担，独立评审者复核产出，返工有机械上限，全过程落在运行记录里，并在界面上有一个进度面板。

本技能正文里出现的工具名**恰好是宿主实际注册的 7 个**（清单见 §3；文档别处若写「八个工具」以本清单为准，工具面就是 7 个）。

- 宿主半：`src/index.js`（注册模型工具、打开存储域、跑调度器、提供 REST 接口）
- 客户端半：`src/client/index.js`（设置页看板、侧栏图标与常驻状态入口、右栏进度页签）

---

## 1. 触发场景：什么时候该用 / 不该用

### 1.1 该用

| 请求的样子 | 为什么用这套工具 |
|---|---|
| **多角色分工**：一件事要「先设计、再实现、再验证」 | 节点 + `dependsOn` 表达真实依赖，独立节点并发跑 |
| **需要独立评审与验收**：审的人不能是做的人 | 节点 `reviewer` 触发独立评审者，产出结构化结论（阻塞/建议/证据） |
| **长时间、多步骤开发**：一次回复里干不完 | 工作流把多步串起来跑成一次运行，中途状态可查 |
| **需要留下角色级证据**：谁做了什么、依据是什么、返工几轮 | 运行记录里有每节点的产出、路由、人设来源、评审结论与返工轮次 |
| 用户明确说「让几个 agent 一起做」「要有评审」「分工协作」 | 这就是这套工具存在的场景 |

### 1.2 不该用

- **单文件小改动**：直接改，多角色是纯开销（每个节点一次模型调用 + 一次评审 + 可能的返工）。
- **一次性问答 / 探索**：用 `subagent` 更轻；不需要角色定义与评审闸门。
- **中途要问人的步骤**：worker（角色子代理）看不到 `ask_user_question`（见 §1.3），任务书必须自包含。
- **为了「显得正式」而套一层团队**：明确禁止。多角色有真实成本。

### 1.3 写任务书之前必须知道：worker 的工具边界

角色子代理（worker）**看不到**这些工具：`ask_user_question`、`exit_plan_mode`、`cordis_*`、`goal` 系、`ralph`、`workflow`、`subagent`、`interrupt_agent`、`send_message`、`list_agents`，以及全部 7 个团队工具本身。原因是这些工具会让 worker 卡住或无限委派。

推论：**角色的任务书必须自包含**——不能要求 worker 去问用户、去查别的会话、或去调用另一个团队工具来继续协作。它只看得到「任务要求 + 验收标准 + 自己的角色人设」。

---

## 2. 完整流程（从零到看到进度）

一句话顺序：**先建/改角色 → 再建工作流 → 启动 → 看进度 → 看评审结论 → 有阻塞项就返工**。

### 步骤 0：确认插件在这个宿主里（可选，30 秒）

```powershell
Invoke-RestMethod http://127.0.0.1:3080/api/team-flowise/ping
# 期望：{"ok":true,"pong":true,"domains":[四个存储域]}  —— 四个域都列出来就说明插件已加载、存储已打开
```

返回 `401` 说明宿主还没重启（见 §7）。

### 步骤 1：看现有角色（别重复建）

```
team_list_agents()
```

返回 `{ ok, agents: [{ id, name, role }] }`。**先看再建**：角色是按 `name` 被引用的，重名会让 `assignee` / 节点 `agent` / `reviewer` 解析到别人。

### 步骤 2：建或改角色（`team_create_agent`）

**不带 `id` 是新建，带 `id` 是修改既有角色**（upsert：没传的字段保持原值，不会被清空）。

```
team_create_agent({
  name: "Reviewer",
  role: "独立评审：只提有证据的阻塞项",
  systemPrompt: "你是独立评审者。只依据交付物本身判断，不猜测作者意图；没有证据的担心写进 uncertainties，不要标成阻塞项。",
  provider: "你的 provider id",
  model: "你的 model id",
  reasoningEffort: "high",
  maxTokens: 8192,
  timeoutMs: 600000,
  toolsPreset: "read-only"
})
```

- `provider` / `model` 必须**成对**，且必须是这个部署真实注册过的值——先看 `GET /api/team-flowise/models` 或设置页「多 Agent 团队 → Agents」里的下拉框，不要照抄示例里的占位值。
- 返回值里带 `warning`：只要它不是 `null`，就说明你声明的东西被规则作废了一半（最常见的：只给了 `provider` 或只给了 `model`）。**读它**。
- 典型团队：`Planner`（规划）、`Coder`（实现）、`Validator`（独立验收）、`Reviewer`（评审）。评审者建议 `toolsPreset: "read-only"`。
- 修改既有角色：

```
team_create_agent({ id: "上一步返回的 id", timeoutMs: 1200000 })
```

### 步骤 3：声明工作流（`team_create_workflow`）

节点是一个**以节点 id 为键的对象**；顺序只由 `dependsOn` 决定，与键的书写顺序无关；没有未满足依赖的节点会并发跑。

```
team_create_workflow({
  name: "P13 改造：实现 + 独立验收",
  description: "先由一个角色实现，再由另一个角色独立验收；两步都由 Reviewer 评审。",
  nodes: {
    implement: {
      title: "实现改动",
      agent: "Coder",
      dependsOn: [],
      reviewer: "Reviewer",
      taskTemplate: {
        requirement: "改 packages/demo/src/a.js，让 foo() 在空输入时返回 null 而不是抛异常。只允许改这一个文件。",
        acceptanceCriteria: "- a.js 里 foo() 对空输入返回 null\n- 原有测试仍能通过\n- 回复里贴出改动后的函数全文"
      },
      promptAddon: "本节点只处理空输入这一条路径，不要顺手重构。"
    },
    verify: {
      title: "独立验收",
      agent: "Validator",
      dependsOn: ["implement"],
      reviewer: "Reviewer",
      taskTemplate: {
        requirement: "独立验证 implement 节点的产出：自己执行一遍，不要相信它的结论。",
        acceptanceCriteria: "- 给出可复现的命令与原始输出\n- 明确写出「已证 / 未证」以及未证的原因"
      }
    }
  },
  review: { reviewer: "Reviewer", maxRework: 1 },
  route: { provider: "你的 provider id", model: "你的 model id" },
  prompt: "本工作流的全部产物用中文书写。"
})
```

返回 `{ ok, id, name, nodeCount }`。**`id` 就是下一步要用的 `workflowId`。**

坑：
- **声明不等于运行**。这个工具只写定义。
- 节点没写 `reviewer`、工作流级 `review` 也没写 → **不会发生任何评审**（§7 有专门条目）。
- `dependsOn` 里写了不存在的节点 id → 该依赖永远不会完成，节点会一直 `pending`。
- `nodes` 为空/缺省 → 能启动，但什么都不做。

### 步骤 4：启动（`team_run_workflow`）

```
team_run_workflow({
  workflowId: "步骤 3 返回的 id",
  input: { target: "packages/demo/src/a.js" },
  route: { provider: "你的 provider id", model: "你的 model id", reasoningEffort: "high", maxTokens: 8192 }
})
```

- **这个调用会阻塞**，直到整次运行结束；每个节点有自己的单步超时（默认 30 分钟），所以真实流水线可能阻塞很久。不要在没准备好等的时候调用它，也不要连着调好几个。
- 返回只有摘要：`{ ok, runId, status }`。细粒度进度去 `/progress` 或界面看。
- `route` 是运行级覆盖，优先级最高（§4.1），可以不传。
- 只想让一个角色干一件事、马上要结果 → 用 `team_delegate_agent`（同样阻塞到子代理结束）。

### 步骤 5：看进度

```
GET /api/team-flowise/progress?runId=<runId>&session=<会话 id>
```

返回里值得先看的三处：

- `scope`：`mode`（`session` / `global`）、`runCountInScope`、`fallback`、`hasAnyGlobal` —— 这条运行到底是不是「本会话的」。
- `nodes[]`：每个节点的 `status`（`pending` / `working` / `reviewing` / `rework` / `completed` / `failed`）、`assignee`、`dependsOn`、`review`、`route`、`persona`。
- `totals`：`total / completed / failed / working / reviewing / rework / unresolved / pending / percent`。

不带 `session` 时与改动前完全一致（取全局最新一次运行）。界面入口见 §6。

### 步骤 6：看评审结论

```
GET /api/team-flowise/role?runId=<runId>&agent=<角色名>&session=<会话 id>
```

返回 `{ ok, run, role, nodes, reviews }`：

- `nodes[]`：该角色**自己承担**的节点，每个节点带 `review`（`verdict` / `score` / `summary` / `findings` / `resolved` / `uncertainties` / `blockingCount` / `advisoryCount` / `unresolved` / `unresolvedReason` / `rounds` / `notes`）以及它自己的 `route`、`persona`。
- `reviews[]`：该角色**作为评审者**复核过的节点（`kind: "review"`，带 `nodeTitle`、`reviewedAgentName`、`reviewedStatus`，以及它自己评审时用的 `reviewRoute`、`reviewPersona`）。

**评审者不拥有节点**，所以只看 `nodes` 会漏掉「谁审了谁」；`reviews` 才是评审判据。

### 步骤 7：有阻塞项就返工

- **自动返工**：调度器在评审判定 `rework` 时，会把阻塞项**原文**交回同一个角色再跑一轮（只修这些缺陷，不扩大范围），并受机械上限约束（见 §5.3）。
- **手动返工**：把任务退回台账（写接口只在回环地址可用）：

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3080/api/team-flowise/task/rework `
  -ContentType 'application/json' `
  -Body '{"id":"<taskId>","feedback":"阻塞项：…（原文）"}'
```

拿到 `taskId` 的途径：`team_task_status()`，或 `/role` 里节点的 `taskId`。
- **改完定义重跑**：需求本身写错了，就改工作流/角色定义，再 `team_run_workflow` 一次，而不是在下游硬撑。

---

## 3. 七个工具逐个说明（宿主实测注册清单）

| # | 工具名 | 用途 | 必填 | 可选 | 返回 |
|---|---|---|---|---|---|
| 1 | `team_list_agents` | 列出角色定义 | 无（不接受任何参数） | — | `{ ok, agents:[{id,name,role}] }` |
| 2 | `team_create_agent` | 新建/修改一个角色定义 | 无（但至少给 `name` 或 `role`） | `id`、`name`、`role`、`systemPrompt`、`provider`、`model`、`reasoningEffort`、`maxTokens`、`timeoutMs`、`toolsPreset` | `{ ok, id, name, provider, model, reasoningEffort, maxTokens, timeoutMs, toolsPreset, warning }` |
| 3 | `team_create_workflow` | 声明一条多角色工作流（节点图） | `name` | `description`、`nodes`、`route`（`provider`/`model`/`reasoningEffort`/`maxTokens`）、`prompt`、`haltOnFailure`、`inheritContext` | `{ ok, id, name, nodeCount }` |
| 4 | `team_run_workflow` | 启动工作流，阻塞到整次运行结束 | `workflowId` | `input`、`route`（`provider`/`model`/`reasoningEffort`/`maxTokens`）、`inheritContext` | `{ ok, runId, status }` |
| 5 | `team_delegate_agent` | 把一件事交给一个角色，阻塞到该子代理结束 | `agent`、`task` | `acceptanceCriteria`、`reviewer` | `{ ok, taskId, status, output }` |
| 6 | `team_create_task` | **只登记**一条台账任务 | `requirement`、`acceptanceCriteria`、`assignee` | `reviewer` | `{ ok, id, status }`（`status` 恒为 `queued`） |
| 7 | `team_task_status` | 读台账（任务级） | 无（不接受任何参数） | — | `{ ok, taskCount, tasks:[{id,status,iteration,assignee}] }` |

节点（`nodes` 的值）字段：`title`、`agent`、`dependsOn`、`reviewer`、`taskTemplate`（`requirement` / `acceptanceCriteria`）、`promptAddon`、`route`、`maxRework`、`mode`、`gate`、`timeoutMs`、`inheritContext`、`inheritMaxEvents`。
工作流级 `review` 字段：`reviewer`、`maxRework`、`enabled`。
工作流级其余字段：`name`、`description`、`nodes`、`route`、`prompt`、`haltOnFailure`、`inheritContext`、`inheritMaxEvents`；运行级另有 `route`、`input`（`inheritContext` / `inheritMaxEvents` 也可在运行级声明）。

上表「可选」列是**工具参数**；schema 字段比工具参数多：`inheritMaxEvents`（节点 / 工作流 / 运行级）与 `timeoutMs`（节点级）**不在任何工具的注册参数里**，只能通过 `POST /api/team-flowise/workflow`、`POST /api/team-flowise/run/start` 或界面写入。二者的区别值得记一句：**工具面**就是上表那 7 个（宿主工具注册处注册的），**schema** 是记录真正能存下的字段；只写工具面就会漏掉一半旋钮。这张表确实漏过一次——`haltOnFailure`（P13 加的）与 `inheritContext`（P16 加的）都没跟上，而当时没有任何检查会发现（宿主侧的文档校验只查「文档写的参数名是不是真的」，不查「真的参数有没有都写进文档」）。现在补上了反方向：对着**编译后的工具 schema** 逐工具核对该表，漏一个即红。

### 3.1 坑（按踩到概率排序）

1. **`team_create_task` 只登记，不执行。** 不派发 worker、不产生任何模型调用，任务停在 `queued` 直到别的东西推动它。指望它有产出是最常见的错用。要一次阻塞的角色调用用 `team_delegate_agent`；要带评审的流水线用 `team_create_workflow` + `team_run_workflow`。
2. **`team_run_workflow` 与 `team_delegate_agent` 会阻塞到子代理结束。** 单步默认 30 分钟超时；不要用一串阻塞调用手工拼流水线，也不要同时发起好几个。
3. **`team_create_agent`：带 `id` 是改，不带 `id` 是建。** 改的时候没传的字段保留原值（不会被清空）；`name` 缺省取 `role`，所以两个都不给会建出一条没有可引用名字的角色。
4. **只有节点级 `reviewer` 才会触发评审；工作流级 `review.reviewer` 只是默认值。** 节点自己的 `reviewer` 优先；工作流级 `review.enabled: false` 关掉这个默认值；两处都没有 → 该节点根本没有评审步骤。`team_delegate_agent` 的 `reviewer` **只登记在台账上，不跑评审**（不派发评审者）——别以为写了就有人审。
5. **返工上限是机械的**：单节点最多 2 轮、整次运行最多 3 轮（`maxRework` 只能把节点上限收紧到 0–2）。达到上限就停，未闭合的评审项如实标记为未闭合，而不是失败。**复审（第 2 轮起）不得新增阻塞项**——只能核对上一轮列出的阻塞项是否解决（§5.3）。
6. **声明不等于运行**：`team_create_agent` 与 `team_create_workflow` 都只写定义，不产生任何运行。
7. **`team_list_agents` 只返回 `id` / `name` / `role`**；要看某角色的模型路由、人设、工具预设，去设置页看板或 `GET /api/team-flowise/agents`。
8. **`team_task_status` 读的是全进程共享的台账**（不只你登记的任务），而且**只报任务、不报运行**；运行级状态去 `/progress` 或界面。
9. **角色名解析失败不会报错**：`assignee` / 节点 `agent` / `reviewer` 用了不存在的名字，任务照样建/照跑，但**不会应用任何角色配置**（模型路由、人设、工具预设、超时全都没有）。写完定义先用 `team_list_agents` 核对名字。

---

## 4. 角色配置：模型路由、人设、工具、超时

### 4.1 模型路由：五档、层内整层胜出

一句话：**run > node > workflow > role > 继承**（层名逐字是 `run` / `node` / `workflow` / `role` / `inherited`）。展开成表：

| 层 | 在哪里声明 |
|---|---|
| `run`（最高） | `team_run_workflow` 的 `route`；`POST /api/team-flowise/run/start` 的 `body.route` |
| `node` | 节点里的 `route` |
| `workflow` | `team_create_workflow` 的 `route` |
| `role` | 角色定义里的 `provider` / `model` / `reasoningEffort` / `maxTokens` |
| `inherited`（最低） | 都没声明 → 继承父级（发起这次运行的 agent）的路由 |

规则是**层内整层胜出，不做跨层字段拼接**：高优先层的 `route` 一旦有任一字段生效，就用它整层，不会「高层的 provider + 低层的 model」拼出一个没人写过的路由。节点记录里的 `route.source` 会明确告诉你实际用的是哪一层（`run` / `node` / `workflow` / `role` / `inherited`）。

- **`provider` 与 `model` 必须成对**：只给一半 → 该半被忽略（成对作废），其余字段仍然生效，并在 `warning` 里说明。保留半条会被拼成混合路由，所以宁可作废。
- **`reasoningEffort`** 决定思考强度，必须是该模型自己 `efforts` 列表里的 id；不被接受时整层路由作废、回退父级。另外：用了新 `provider`/`model` 却没写 `reasoningEffort` 时，父级 effort 会被清除、改用该模型默认值——想保持强度就显式写上。
- **`maxTokens`** 是输出上限，独立生效（不参与成对规则）；非法值被丢弃并记入 `warning`；未声明时先继承父级上限，再退到模型默认值。
- **路由不可用不失败节点**：provider 未注册 / model 不存在 / effort 不被接受 → 回退继承父级，并把原因写进节点 `route.warning`。所以「模型没生效」永远先看那个 `warning`。

### 4.2 人设：三层拼接 + persona 的真实语义

人设文本按固定顺序拼接，用一个空行连接，空层不参与：

```
role（角色 systemPrompt） -> workflow（工作流 prompt） -> node（节点 promptAddon）
```

节点记录里的 `persona.layers` 会列出真正贡献了文本的层，`persona.chars` 是字数——「完全没人设」和「有但为空」是两件不同的事。

**`persona` 的真实语义**：它落在子代理的 **deployment persona 段（`deployment:persona-prefix`）**上，会**遮蔽该子代理的 deployment persona 段**；它**不是**「替换整段系统提示词」，也不会移除一等公民指引。所以写人设时管的是「行为标准与角色口吻」，不要指望它去改工具协议或系统级规则。

两个实践约束：

- **不要在人设里写 `{{...}}`**：运行时会把它当作插值引用，未知变量会出问题（当前实现会把 `{{` 替换成 `{ {` 并记 `warning`，早期版本是整段丢弃）。
- 人设要写成「跨任务都成立」的行为准则；一次性要求写进节点任务书。

### 4.3 工具预设与超时

`toolsPreset` 是**拒绝清单**（不是沙箱）：

| 预设 | 效果 |
|---|---|
| `full` | 不加任何额外拒绝项（插件的 worker 拒绝清单仍然生效，见 §1.3） |
| `no-write` | 拿不到 `write` / `edit` / `str_replace_editor` |
| `no-shell` | 拿不到 `pwsh` / `bash` |
| `read-only` | 上面两者的并集 |

`timeoutMs`（角色级）是**单步上限**，只能收紧、不能抬高：会被夹进 `[1000, 上限]`。上限分两种：**worker 步与返工步是 30 分钟**（1800000ms），**评审步是 10 分钟**（600000ms）——同一份角色超时声明在两个位置各自夹紧，写一个很大的值是抬不高上限的。缺省 / `0` / 负数 / 非法值一律视为「用上限」——负数不是「立刻超时」，是笔误。

评审者**有自己的**路由、人设与超时（从评审者自己的角色定义解析），**不继承被审节点的** `promptAddon` / 节点级 `route`。这是设计，不是缺陷。

### 4.4 上下文继承（`inheritContext`，P16 起）

让一个 worker **从当前会话已完成的轮次开始**，而不是从零开始——底层用的是宿主的 fork 后端（`@deepseek-ai/dsh-subagent-fork-in-process`）：它把父级日志里**到最后一个 `turn/end` 为止**的完整轮次切片，作为子会话的种子。正在进行的这一轮（也就是发起本次运行的那次调用）**按设计被排除**，因为未闭合的轮次不能重放成一个合法子会话。

**声明位置**（与路由同一套口径：`run > node > workflow > role`，整层胜出）：

| 层 | 位置 | 说明 |
|---|---|---|
| run | `team_run_workflow` 的 `inheritContext` / `POST /run/start` 的 `inheritContext` | 最高优先级，也是**杀开关**：写 `none` 就压过下面所有层的 `session` |
| node | 节点里的 `inheritContext` | 单步覆盖 |
| workflow | 工作流的 `inheritContext` | 这条流水线的默认值 |
| role | `team_create_agent` 的 `inheritContext` | 该角色所有 worker 的默认值（`team_delegate_agent` 只有这一层） |

取值：`session`（继承）/ `none`（不继承）/ 布尔 `true`/`false`（等价）。无法识别的取值**不会**打开它，只会记一条 `source: "node:invalid"`。

**两条硬规则**：

1. **评审者永远不继承，没有开关。** 评审契约是「只依据交付物判断」，把产生这份产物的对话喂给评审者，正是这条纪律要防的偏见。所以工作流/角色声明了 `session`，评审派发仍然是 `spawn`。
2. **能力靠发现，不靠名字。** 插件在 `ctx.subagents` 上找**声明了 inheritsParentContext=true** 的 provider（优先叫 `fork` 的那个），而不是硬写 `fork`。本部署没装配这类后端时，节点**照常派发**（退回 `spawn`），并在记录里写明原因——要了却做不到的事会被如实记下来，不会被假装做到。

**记录在节点上的证据**（只有请求过继承的节点才有这个 `context` 键，键集契约不变）：

```json
"context": {
  "requested": "session", "source": "role", "declared": "session",
  "provider": "fork", "effective": "session", "reason": "provider \"fork\" 声明了 inheritsParentContext=true",
  "qualified": ["fork"], "dispatches": 1, "seeded": 12, "routeChanged": false,
  "usage": { "requests": 1, "inputTokens": 100, "outputTokens": 20, "cacheReadTokens": 900, "cacheWriteTokens": 0, "cacheHitRate": 0.9 }
}
```

- `effective: "none"` 而 `requested: "session"` = **降级**，`reason` 说明为什么。
- `seeded` = 子代理真的继承了**多少个日志事件**（来自它自己的 `session/end-seed` 标记）。**这个字段是关键**：`seeded: 0` 意味着父级当时还没有任何已完成轮次，此时"没有缓存收益"说的是夹具，不是这个功能。
- `usage` 是**实测**的（子代理自己 `assistant/message` 上的 usage），读不到时是 `null`（未知），**不是 0**。它**只算子代理自己发出的请求**：fork 出来的子会话日志会**重放**继承来的事件，而那些事件带的是父级的用量——把整份日志求和，量到的是父级的账单。P16 第一次活体 A/B 就踩了这一点：一条"回答一个字"的探针节点被测成 1634 次请求 / 337 万 input / 3.89 亿 cacheRead。现在以子代理自己的 `session/end-seed` 为界只统计它自己的请求，边界不可计算时给 `null` 而不是把整份算进去。
- `routeChanged: true` 表示该节点的路由与父级不同 —— 按 fork 后端的文档，继承的前缀只有在 provider/model/人设/工具过滤**都没变**的前提下才可能命中 KV 缓存，所以这是"缓存可能没命中"的先验提示，不是结论。
- `prefixEvents` = **派发前预测**的前缀大小（父级日志里到最后一个 `turn/end` 为止的事件数，与 fork provider 的规则同源）。它先于派发存在，所以上限可以在**花钱之前**执行，而不是在账单上才发现。
- `budget` / `budgetSource` = 本次生效的上限与它是哪一层声明的（没声明就没有这两个键）。

**代价与收益（实测数字，不是估计）**：同一条工作流、同样的两个"回答一个字"的节点：

| 臂 | 每节点 input | 每节点 cacheRead | 命中率 | 两节点墙钟 |
|---|---|---|---|---|
| 继承（缓存冷） | 29,163 | 573,312 | 95.2% | 14.6 s |
| 继承（缓存热，同前缀再跑一次） | **235** | 602,240 | **100%** | 18.1 s |
| 不继承 | 162 | 7,552 | 97.9% | **2.0 s** |

读法：**缓存确实接住了继承的前缀**（95–100% 命中，热的时候只要 235 个新 input token），所以"省 token"是真的；但**这不等于更高效** —— 模型仍然要处理那 60 万 token 的提示词，墙钟慢了约 9 倍；而且 cacheRead 也不是白送的（按缓存价计费）。所以：

- 默认**不开**（`inheritContext` 缺省 = 不继承），要用就逐层显式声明；
- 打开后每个节点都记 `usage.cacheReadTokens` / `cacheHitRate`，**用数字判断**，别因为它叫"继承"就默认它划算；
- `validation/p16-live-context.mjs` 就是为此存在的 A/B：同一条工作流跑三次（继承 / 杀开关 / 超上限），把三臂的实测 token 并排打出来。

**成本上限（`inheritMaxEvents`）**：继承会把父级**全部**已完成历史拖进提示词，而种子窗口**没法截断**——`ctx.subagents.start(name, request)` 的 `SubagentStartRequest` 里没有 seed 字段，种子是 driver 层 `startInProcessRun(request, {seed})` 的参数，只有 fork provider 自己会调。所以本插件能做的同类事情是**先预测、再拒绝**：声明 `inheritMaxEvents`（正整数的**日志事件数**，四层可声明，run 层只能经 HTTP body 传，缺省不设上限），派发前用 `prefixEvents` 核对；超了就**不继承**（退回干净子代理）并在 `context.reason` 里同时写出实际大小、上限与是哪一层声明的。

两条 fail-closed（宁可不继承，也不无界继承）：`inheritMaxEvents` 不是正数；或声明了上限但**读不到**父级日志（无法核对）。两者都会记进 `reason`，不会静默放行。注意这是**策略**不是硬界：预测发生在派发时，provider 切片发生在紧随其后的 start，中间父级日志若有变化，实际种子可能略大于预测值。

**当前不支持**：下游节点继承**上游节点**（或某个角色上一轮）的上下文。那需要把 worker 做成**可续期子代理**（宿主 subagents 服务上的 startContinuable + sendMessage）并管理其生命周期；现在 worker 是一次性的，跑完即释放，它的会话不能再被 fork。这条不是"没做"，是"要做得先把 worker 的生命周期换掉"。

---

## 5. 审核纪律：什么才算阻塞项

### 5.1 只有三种情况允许标 `blocking`

1. 明确**违反某条验收标准**；
2. 存在会让**交付物失败或错误**的具体缺陷；
3. 存在**数据丢失 / 安全 / 不可逆**风险。

每条 `blocking` 必须同时给出：

- `criterion`：违反了哪条验收标准（或写「缺陷」「风险」）；
- `evidence`：交付物原文引用，或可复现的命令与输出；
- `impact`：不修会怎样。

**证据不足的一律不得作为阻塞项。** 风格、命名、可读性、补测试、更优方案一律 `advisory`，永不阻塞。无法判断的写进 `uncertainties`，不得当作阻塞项。

评审维度固定为五个：需求符合性、正确性、完整性、风险、优化空间。评审者只能引用的交付物前 20000 字符（截断会在提示里写明，未展示的部分不得作为阻塞依据）；findings 最多保留 20 条。

### 5.2 没有阻塞项时必须通过

因为 verdict 与阻塞项是**绑定**的：`rework` 至少要有一条合格阻塞项，没有阻塞项就必须是 `pass`（哪怕有一堆 advisory）。这条纪律的理由是：多角色流水线的成本是「每节点一次模型调用 + 评审 + 返工」，如果主观偏好也能卡住节点，任务会永远「差一条」，收敛不了；而且返工成本会超过节点本身。

这条纪律说的是**契约内**的结论。如果评审者用的是别人的词汇（例如专用团队包的 `overall_verdict: "FAIL"`），或者结论根本读不出来，那既不是 `pass` 也不是 `rework`，而是 §5.4 的 `error`：不阻塞节点，但也不假装评审发生过。

### 5.3 机械兜底（R1–R9）

提示词纪律之外，宿主还有九条**机械**规则，任何人（包括评审模型）都绕不过去。它们不全都是「降级」：R7/R9 可以**改判为返工**，R9 也可以把一份读不出结论的评审如实记为 `error`。

| 规则 | 触发条件 | 结果 |
|---|---|---|
| **R1** | 评审者没有返回可解析的对象 | 这是**评审者**的问题、不是节点的错：`verdict = error`、零 findings、节点**仍然完成** |
| **R2** | `severity` 既不是 `blocking` 也不是 `advisory` | 一律按 `advisory` 处理——非法严重度不得阻塞（且只能降级、永不升级） |
| **R3** | 标了 `blocking` 但 `criterion` 为空白，或 `evidence` 去空白后不足 8 字符 | 降级为 `advisory`（缺「违反了哪条」和「证据在哪」就不能阻塞） |
| **R4** | `round >= 2` 的复审里提出**新的** blocking（`criterion` 不在上一轮阻塞项集合内） | 降级为 `advisory`——**复审不得新增阻塞项**，防止「永远差一条」 |
| **R5** | findings 超过 20 条 | 截断为前 20 条（并记一条 note），防止评审把进度接口撑爆 |
| **R6** | `verdict = "rework"` 但 `blockingCount = 0` | 结论自相矛盾，按不阻塞处理：`verdict` 改为 `pass` |
| **R7** | 复审（`round >= 2`）里评审者自己把上一轮某条阻塞项标为 `resolved: false` | 该条按阻塞处理并排到最前（R5 截断不许把它挤掉）——复审不得靠改写措辞绕过已判定的阻塞项 |
| **R8** | 评审者的 JSON 第一次没解析出来 | 发起**一次**修复调用（提示里带上原始解析失败原因）；再次失败**不阻塞**节点：`verdict = error`，并在 `review.repair` 里记下 `{attempted, ok, parseError}` |
| **R9** | 结论字段/词汇不在契约里（见 §5.4） | 读得懂就按本意处理并留 note；读不懂（否定结论但无可返工的阻塞项、非法 token）→ `verdict = error` + note，**绝不静默按通过** |

降级与改判都不是静默的：每次都会写进该节点的 `review.notes`，所以「为什么这条没阻塞 / 为什么这次没有通过」是可查的。

### 5.4 结论必须被「读出来」，不能靠猜（R9，P15 起）

R9 之前，结论只从**一个字段**（`verdict`）里、只认**一个词**（`rework`）读取，其余一律落到 `pass` 且**不写任何 note**。实测（修复前）：

| 评审者实际返回 | 修复前的记录 |
|---|---|
| `{"overall_verdict": "FAIL", "required_corrections": [...]}` | `pass`，`notes=[]` |
| `{"findings": [{"severity": "blocking", "criterion": ..., "evidence": ...}]}`（没写 verdict） | `pass` 且 `blockingCount: 1` —— 账本自相矛盾，且无任何 note |
| `{"verdict": "FAIL"}` / `{"verdict": "驳回"}` / `{"verdict": "maybe"}` | `pass`，`notes=[]` |

`overall_verdict` 正是**专用团队移植包**的原生词汇（融资租赁包就写 `overall_verdict` / `required_corrections`），所以这是一条真实可达的静默通过路径，不是理论问题。

R9 的做法：

- **从这些字段里找结论**（按序取第一个可识别的）：`verdict`、`overall_verdict`、`final_verdict`、`review_verdict`、`conclusion`、`decision`。
- **词汇归一化**后判定：`pass/passed/ok/approved/lgtm/通过/合格/批准` 算通过；`rework/fail/failed/rejected/驳回/不通过/返工` 算否定；`conditional_pass/有条件通过` 算通过并留 note；其它非空 token 视为**读不懂**。
- **通过 R2/R3/R4 的阻塞项优先于结论字符串**：一份写着 `pass`、却带着一条合格 blocking 的评审，按 `rework` 处理，并把矛盾写进 note。R6 的理由是「结论字符串**单独**不许拉长任务」，而这里有一份可验证的理由，所以不适用。
- **读不懂的结论 = 没评审，不是通过**：`verdict = error` + 指名道姓的 note。`error` 按 R1 的原则**不阻塞**节点，但它也不会让运行假装评审发生过。注意 `error` 与「可解析」是两件事：`parseError: null` 只说明 JSON 合法。
- **契约 token 的例外保持不变**：只有 `verdict: "rework"` 这个**契约组合**仍走 R6（`rework` + 无阻塞项 → `pass`）。别人的 `FAIL` 不是我们的 `rework`——R6 的前提是「评审者在说我们的语言但自相矛盾」。
- **嵌套对象不算结论**：`{"verdict": {"a": 1}}` 按「没有结论字段」处理，而不是「读不懂」，否则这种载荷会全部变成 `error`。
- 一个 payload 里两个结论字段互相矛盾时，以第一个可识别字段为准，并把两边都记进 note。

### 5.5 返工上限

- 单节点上限 `maxReworkPerNode = 2` 轮；节点级 `maxRework` / 工作流 `review.maxRework` 只能把它**收紧**到 0–2。
- 整次运行总上限 `maxReworkPerRun = 3` 轮（总闸）：即使每个节点都要求返工，一次运行最多再多派发 3 次 worker。
- 达到上限即停，未闭合的评审项标记为**未闭合**（`unresolved` + `unresolvedReason`），而不是失败。
- 返工提示只带**阻塞项原文**，要求逐条修复，不扩大范围。

---

## 6. 界面在哪

| 入口 | 位置 | 看什么 |
|---|---|---|
| **看板** | **设置 → 多 Agent 团队** | 五个标签：`看板` / `Agents` / `工作流` / `任务` / `运行`；角色表单可配人设、路由、工具预设、超时；工作流可点「运行」 |
| **左栏面板图标** | 左侧边栏面板列表里的「多 Agent 团队进度」 | 打开中央整页进度视图 |
| **侧栏底部状态入口** | 侧栏 `footer` 区的常驻状态芯片 | 一眼看「团队：N 运行中 / 空闲 / 其他会话 N 运行中」；点开优先打开**右栏**进度页签（服务缺失时降级到中央面板，再不行只显示状态） |
| **右栏页签** | 会话右侧停靠区的「多 Agent 进度」 | 贴着当前会话看时序图 + 角色卡片 + 「审核（监督）」区块 |

进度页给的是：哪个工作流、几个节点、何时开始、**角色交互时序**（按 `dependsOn` 波次线性化，同波次为并发）、每个角色的节点卡片（任务要求 / 验收标准 / 工具策略 / 思考过程 / 完整产出 / 评审结论），点角色名可以下钻它的完整产出与推理。

### 「本会话」与「全部运行」

- 默认按**本会话**过滤（客户端把会话 id 作为 `session` 传给接口；宿主用同一套规则选 run）。
- 面板上有显式开关：本会话没有运行时它是「看全部运行」；切到全部后可以「只看本会话」。
- 拿不到会话 id 时**如实**标注「全部运行（拿不到当前会话）」，绝不假装是本会话的进度。
- 别的会话的运行、以及没有 `sessionId` 的旧记录（归属未知），都不会被当成本会话的进度。
- **升级后的第一眼**：`sessionId` 是本轮（P12）才加的字段，升级前产生的运行记录**全都没有归属**。所以重启 dsh 后第一次看到的「本会话暂无运行」通常正是这个迁移状态，不是故障——只有 P12 之后新起的运行才会出现在「本会话」下。

---

## 7. 常见故障

| 症状 | 最可能的原因 | 怎么查 |
|---|---|---|
| 面板显示「**本会话暂无运行**」 | 这不是错误，是本会话名下确实没有运行。可能是别的会话发起的，也可能是旧记录（没有 `sessionId`，归属未知） | 看 `scope`：`mode: "session"` + `runCountInScope: 0`，`hasAnyGlobal` 说明进程里别处有运行；点「看全部运行」 |
| **角色建了，却没有评审** | 节点没写 `reviewer`，工作流级 `review` 也没写 reviewer（或写了 `enabled: false`） | 只有节点级 `reviewer`（或工作流级默认值）才会派发评审者；检查定义，`team_create_workflow` 重新声明后重跑 |
| **评审者明明写了 FAIL/驳回，节点却显示通过** | P15/R9 之前：结论只从 `verdict` 一个字段、只认 `rework` 一个词读，其它一律**静默**落到 `pass`（`notes=[]`）。`parseError: null` 只说明 JSON 合法，不说明结论被读懂了 | R9 起读 6 个字段 + 词汇表；读不出来 → `review.verdict = error` 并在 `review.notes` 写明原因（见 §5.4）。看节点的 `review.notes` 与 `review.verdict` |
| **声明了 `inheritContext: "session"`，节点却没有继承** | 三种可能：本部署没有声明 inheritsParentContext 的 provider；父级当时还没有**已完成**的轮次（种子为空）；或者更高层写了 `none`；或者父级历史超过了 `inheritMaxEvents` | 看节点的 `context`：`effective`（`none` = 没生效）、`reason`、`qualified`（哪些 provider 合格）、`prefixEvents`（预测的前缀大小）、`budget`/`budgetSource`（生效的上限与来源层）、`seeded`（0 = 父级还没有已完成轮次，详见 §4.4）、`overridden`（被哪一层压掉了） |
| **节点一直 pending** | `dependsOn` 里的前置节点没完成，或写了**不存在的节点 id**（悬空依赖永远不会完成） | `/progress` 里看该节点的 `dependsOn` 与各前置节点 `status`；核对节点 id 拼写 |
| **模型没生效** | 只声明了 `provider` 或只声明了 `model`（成对规则作废该半），或 provider 未注册 / model 不存在 / effort 不被接受 → **回退继承父级** | 看节点的 `route.warning` 与 `route.source`（`inherited` 就是回退了）、`route.effective` / `route.measured`；`GET /api/team-flowise/models` 或设置页看真实可选值；`team_create_agent` 返回的 `warning` |
| **API 返回 401** | 本部署的网关把**未注册**的 `/api` 路径伪装成 401：宿主半没加载，或 **dsh 还没重启** | 先 `GET /api/team-flowise/ping`；确认插件行已插入并在 profile 里、然后重启 dsh（宿主代码与客户端 bundle 在启动时加载/快照） |
| 任务一直是 `queued` | 只调了 `team_create_task`（它不执行） | `team_task_status()`；台账 `iteration` 不变 |
| 工作流启动即失败 | `workflowId` 不存在 | `team_create_workflow` 的返回值 / `GET /api/team-flowise/workflows` |
| 重启后某次运行永远 `running` | 上个进程被杀，run 没来得及收尾 | 启动时会自动 reap 并标为 `interrupted` |
| 子代理挂死不返回 | worker 拿到了会等浏览器的工具（例如客户端平台的 Inspect） | 已由 worker 拒绝清单拦下（§1.3）；若仍出现，查该节点的 `tools` 记录 |
| **某个 provider 一直不响应/极慢**（例如实测中的 `amd`：单次调用 1000 秒后才以 `stopReason=error` 收场） | 该 provider 的适配器本身有问题。P14 起有两层保护，见 §7.1 | 看节点 `route.health`（`blocked: true` 表示派发被守卫拦下）、运行摘要里的 `provider health:` 段 |
| **整次运行卡住不动、某个节点永远 `working`** | P14 之前 `subagents.start('spawn')` **没有超时**，而它又是被 `Promise.all` 等待的一环：一个永不 resolve 的 spawn 会把整轮连同其他角色一起冻住 | 旧版本会这样；P14 起 spawn 有独立限时，节点会以 `spawn of <node> timed out after Nms` 失败 |
| 面板显示错误态而不是空态 | 请求失败（401 / 404 / 500）与「真的没有运行」是两件事 | 面板会写明状态码含义，别把 401 读成「没有运行」 |
| **`/runs` 与 `/progress` 一起变成 500，而 `/agents`、`/workflows` 正常** | 正在跑的插件版本**比存储文件旧**：记录在读取时要过 schema，而存储里有这个版本不认识的取值（实测：P13 写入的 `status: "halted"` 被只带 P14 的版本拒收）。存储没坏，是代码旧 | 见 §7.2。升级（或把分支合并进来）后**重启**即恢复，存储不需要修 |

### 7.1 provider 持续失败时的两层保护（P14）

1. **派发被真正限时**。spawn 有自己的上限 `SPAWN_TIMEOUT_MS`（2 分钟），并且**不超过该节点自己的预算**（角色 `timeoutMs` 或插件上限里更小的那个）。所以一个永不 resolve 的 spawn 只会让**那一个节点**失败，不会再冻住整轮。节点错误里会写 `spawn of <node> timed out after <N>ms`。
2. **持续失败的 provider 停止收到派发**（`PROVIDER_HEALTH.maxConsecutiveFailures = 2`，**每次运行独立计数**）：
   - 只统计**真的是 provider 侧**的失败：子代理以 `stopReason=error` 收场（含 `NO_ADAPTER`），或 spawn 超时。工具报错、提示词问题、插件自身的 bug **一律不算**，不会冤枉一个健康的 provider。
   - 连续失败达到 2 次后，该 provider 在本轮被判定为不健康：**声明**了该 provider 的节点不再把路由套用上去，而是**继承父级路由**（与「路由无法解析」同一个安全方向），并在该节点的 `route.health` 里留下 `{blocked:true, provider, failCount}`，`route.warning` 也会说明。
   - 如果**没有路可退**（连继承来的父级路由也是这个 provider），该节点**直接以明确原因失败、不再派发**——不再白等一个完整超时。错误文本形如 `provider "X" 已在本轮连续失败 2 次，且该角色没有其他可用路由；…本次不再派发`。
   - 成功一次就把该 provider 的计数清零（是「连续」而不是「累计」）；一旦被判为不健康，本轮不再恢复。
   - 运行结束时，只要有 provider 被判不健康，摘要里会追加 `; provider health: "X" 连续失败 N 次，本轮不再派发到它`，所以「快速失败」不会被误读成「卡住」或「就是失败了」。
   - 计数是**内存里的、每轮独立的**：不写存储、不跨轮共享——某个 provider 今天下午不稳，不该变成对它的永久判决。

### 7.2 代码版本与存储的关系：只允许「新代码读旧存储」

`runSchema` / `workflowSchema` 通过 `domainTable(schema)` 挂在存储域上，**每一次读记录都会跑一遍 schema**（`dsh-storage-domain/lib/index.js` 的 `parseRecord(name, table, key, () => tableSpec.valueSchema.parse(raw))`）。由此有两条**不对称**的规则：

- **加字段、加枚举值 = 放宽**：老记录仍然合法，新代码能读老存储。这是安全的——也正因如此，「加一个枚举值」看起来毫无风险。
- **反过来不成立**：老代码读不了新存储。实测：P13 给运行状态加了 `halted`；一个只带 P14 的 `main` 去读那条 `halted` 记录时 schema 直接抛 `Invalid option: expected one of "running"|"completed"|"failed"|"cancelled"|"interrupted"`，于是 `GET /api/team-flowise/runs` 和 `/progress` 一起 **500**，而 `/agents`、`/workflows` 完全正常（它们读的是别的表）。

所以：

1. **重启前先确认代码版本**。分支未合并时，`haltOnFailure` 这类字段还会被旧版 schema **静默丢弃**（zod 默认 strip），并在下一次 upsert 时按丢过的样子落盘——安装器会如实告警「该版本丢弃了该字段」。
2. 遇到「同一张表的接口 500、别的表正常」，先怀疑**代码与存储的记录形状不匹配**，而不是存储损坏。修法是让代码追上存储（升级/合并后重启），**不要手工去改存储文件**。
3. `validation/p15-merge.mjs` 把这条规律做成了差分测试：取本机真实存储里的 `halted` 记录，用**合并前**的 schema 解析必须被拒（复现那次 500），用**合并后**的 schema 解析必须通过，并检查放宽是**单调**的——旧版接受的每一条，新版都必须接受（`regressions=0`）。

---

## 8. 安装与可移植

- **本技能的文件位置**：仓库根 `skills/team-flowise/SKILL.md`（目录束形式：一个目录 + 同名 `SKILL.md`；`name` 与目录名一致）。
- **安装/卸载命令以仓库根 `README.md` 的「安装」章节为准**（由打包步骤编写）。接口约定：
  - `node scripts/install.mjs [--profile <dir>] [--package <dir>] [--dry-run] [--check] [--help]`
  - `node scripts/uninstall.mjs [--profile <dir>] [--dry-run] [--check] [--help]`
  - `--dry-run` 只打印将要发生的每一处改动；`--check` 只校验现状并用退出码区分「已装/未装」。
  - 默认 profile 是用户目录下的 `web` profile（`~/.dsh/profiles/web`）；**不要手写某个人的绝对路径**。
- 脚本会做的事：把包链接进 profile 的 `node_modules`，在 profile 的 `package.json` 里补依赖与 `dsh.profile.bundles` 项，在 `cordis.patch.yml` 里补 `flowise-team` 的 `- insert:` 行（已存在就跳过，重复 insert 会让 profile 启动直接抛错），并把本技能复制/链接到技能根目录（默认用户级 `~/.dsh/skills/team-flowise/`）。全部步骤幂等，重复执行不产生重复项。
- **装完必须重启 dsh**：宿主代码与客户端 bundle 在启动时加载/快照。重启前可能出现的现象就是 §7 里的「401（路径未注册）」或界面入口缺失。
- 重启后如何确认：`GET /api/team-flowise/ping` 返回 200 与四个存储域；左栏出现「多 Agent 团队进度」图标、侧栏底部出现状态芯片；设置页出现「多 Agent 团队」一节；技能生效则本目录束出现在技能列表里。
