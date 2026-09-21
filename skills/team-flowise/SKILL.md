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
| 3 | `team_create_workflow` | 声明一条多角色工作流（节点图） | `name` | `description`、`nodes`、`route`（`provider`/`model`/`reasoningEffort`/`maxTokens`）、`prompt` | `{ ok, id, name, nodeCount }` |
| 4 | `team_run_workflow` | 启动工作流，阻塞到整次运行结束 | `workflowId` | `input`、`route`（`provider`/`model`/`reasoningEffort`/`maxTokens`） | `{ ok, runId, status }` |
| 5 | `team_delegate_agent` | 把一件事交给一个角色，阻塞到该子代理结束 | `agent`、`task` | `acceptanceCriteria`、`reviewer` | `{ ok, taskId, status, output }` |
| 6 | `team_create_task` | **只登记**一条台账任务 | `requirement`、`acceptanceCriteria`、`assignee` | `reviewer` | `{ ok, id, status }`（`status` 恒为 `queued`） |
| 7 | `team_task_status` | 读台账（任务级） | 无（不接受任何参数） | — | `{ ok, taskCount, tasks:[{id,status,iteration,assignee}] }` |

节点（`nodes` 的值）字段：`title`、`agent`、`dependsOn`、`reviewer`、`taskTemplate`（`requirement` / `acceptanceCriteria`）、`promptAddon`、`route`、`maxRework`、`mode`、`gate`。
工作流级 `review` 字段：`reviewer`、`maxRework`、`enabled`。

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

### 5.3 「避免吹毛求疵」的机械兜底（R1–R6）

提示词纪律之外，宿主还做了六条**机械**降级，任何人（包括评审模型）都绕不过去：

| 规则 | 触发条件 | 结果 |
|---|---|---|
| **R1** | 评审者没有返回可解析的对象 | 这是**评审者**的问题、不是节点的错：`verdict = error`、零 findings、节点**仍然完成** |
| **R2** | `severity` 既不是 `blocking` 也不是 `advisory` | 一律按 `advisory` 处理——非法严重度不得阻塞（且只能降级、永不升级） |
| **R3** | 标了 `blocking` 但 `criterion` 为空白，或 `evidence` 去空白后不足 8 字符 | 降级为 `advisory`（缺「违反了哪条」和「证据在哪」就不能阻塞） |
| **R4** | `round >= 2` 的复审里提出**新的** blocking（`criterion` 不在上一轮阻塞项集合内） | 降级为 `advisory`——**复审不得新增阻塞项**，防止「永远差一条」 |
| **R5** | findings 超过 20 条 | 截断为前 20 条（并记一条 note），防止评审把进度接口撑爆 |
| **R6** | `verdict = "rework"` 但 `blockingCount = 0` | 结论自相矛盾，按不阻塞处理：`verdict` 改为 `pass` |

降级不是静默的：每次降级都会写进该节点的 `review.notes`，所以「为什么这条没阻塞」是可查的。

### 5.4 返工上限

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

### 7.1 provider 持续失败时的两层保护（P14）

1. **派发被真正限时**。spawn 有自己的上限 `SPAWN_TIMEOUT_MS`（2 分钟），并且**不超过该节点自己的预算**（角色 `timeoutMs` 或插件上限里更小的那个）。所以一个永不 resolve 的 spawn 只会让**那一个节点**失败，不会再冻住整轮。节点错误里会写 `spawn of <node> timed out after <N>ms`。
2. **持续失败的 provider 停止收到派发**（`PROVIDER_HEALTH.maxConsecutiveFailures = 2`，**每次运行独立计数**）：
   - 只统计**真的是 provider 侧**的失败：子代理以 `stopReason=error` 收场（含 `NO_ADAPTER`），或 spawn 超时。工具报错、提示词问题、插件自身的 bug **一律不算**，不会冤枉一个健康的 provider。
   - 连续失败达到 2 次后，该 provider 在本轮被判定为不健康：**声明**了该 provider 的节点不再把路由套用上去，而是**继承父级路由**（与「路由无法解析」同一个安全方向），并在该节点的 `route.health` 里留下 `{blocked:true, provider, failCount}`，`route.warning` 也会说明。
   - 如果**没有路可退**（连继承来的父级路由也是这个 provider），该节点**直接以明确原因失败、不再派发**——不再白等一个完整超时。错误文本形如 `provider "X" 已在本轮连续失败 2 次，且该角色没有其他可用路由；…本次不再派发`。
   - 成功一次就把该 provider 的计数清零（是「连续」而不是「累计」）；一旦被判为不健康，本轮不再恢复。
   - 运行结束时，只要有 provider 被判不健康，摘要里会追加 `; provider health: "X" 连续失败 N 次，本轮不再派发到它`，所以「快速失败」不会被误读成「卡住」或「就是失败了」。
   - 计数是**内存里的、每轮独立的**：不写存储、不跨轮共享——某个 provider 今天下午不稳，不该变成对它的永久判决。

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
