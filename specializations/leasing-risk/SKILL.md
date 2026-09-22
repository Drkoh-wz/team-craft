---
name: leasing-risk-assessment
description: 融资租赁承租人还款风险评估专用团队（10 个角色 / 11 步固定流水线）。当你要对某个承租人的还款能力给出一份可追溯的风险定级与评估报告，并且需要多角色分工与独立复核时使用：数据标准化、公开渠道（中登网/工商/司法）收集、财务与信用法律与租赁物三路分析、独立数值复核、冲突仲裁、风控定级、报告撰写、事后反馈。也用于排查这条流水线本身的问题：跑不动、节点一直 pending、下游拿不到上游产物、中登网查不到、评审 JSON 解析失败、角色建了却没有评审、角色模型没生效。不适用：与被评估承租人无关的一般代码/文档任务、单文件小改动、只需要一个融资租赁概念性答案的问答。
---

# 融资租赁客户还款风险评估团队（leasing-risk）

本技能对应一个**移植包**：它把一支专用团队（10 个角色定义 + 1 条 11 节点工作流 + 10 份角色人设 + 2 份评审职责适配）装进宿主里的 team-flowise 插件。包内文件：`pack.json`（清单与产物契约）、`roles.json`、`workflow.json`、`models.map.json`、`prompts/`、`adapters/`、`PROVENANCE.json`、`install.mjs` / `uninstall.mjs` / `selftest.mjs`、`README.md`（面向接收方）。安装与卸载看 `README.md`，本技能只讲**怎么用**。

> 注意：被装到技能根目录的通常**只有这份 `SKILL.md`**；`README.md` 与安装器在**包目录**里。所以本节凡是需要「查包内某文件」的地方，路径都相对包目录。

## 一、这个团队做什么

给定一个承租人（融资租赁的承租企业）与一批原始材料，产出一份**每个数字都能回溯到上游产物**的风险评估报告与风险等级。它的设计要点：

- **顺序是确定的**：节点顺序只由 `dependsOn` 决定（不来自书写顺序），同一波内并行。共 11 个节点。
- **产物走文件系统**：team-flowise 的节点之间**不传递上游输出**（运行级 `input` 是共享的），所以本流水线用 `case_dir` 当产物总线——调用方传入一个案子目录，每个节点读上游的固定文件名、写自己那一个文件。
- **每步都有独立评审**：评审者不是执行者（除 `feedback` 节点外，见下表）。评审按五个维度（需求符合性、正确性、完整性、风险、优化空间）给结论，只有**有证据**的缺陷才算阻塞项。
- **数据不可信就不定级**：中登网查不到、上游产物缺失、复核 FAIL、仲裁判 `return_to_intake`/`stop_for_human` 时，下游只能写阻断产物，不得输出风险等级或报告结论。

## 二、11 步流程与产物文件名

产物文件名与 `pack.json.caseDirContract.artifacts` **逐字一致**，全部落在 `<case_dir>/` 下；原始材料由调用方放在 `<case_dir>/inputs/`（`pack.json.caseDirContract.inputsSubdir` = `inputs`）。

| # | 节点 id | 承担角色 | 产物文件（`<case_dir>/` 下） | 上游依赖 | 独立评审者 |
|---|---|---|---|---|---|
| 0 | `coord-open` | 调度协调员 | `00-plan.json` | — | 数据复核师 |
| 1 | `intake` | 数据整理员 | `01-data.json` | `coord-open` | 数据复核师 |
| 2 | `collect` | 网络资料收集员 | `02-web.json` | `coord-open` | 数据复核师 |
| 3 | `finance` | 财务分析师 | `03-finance.json` | `intake`、`collect` | 数据复核师 |
| 4 | `credit` | 信用与法律分析师 | `04-credit-legal.json` | `intake`、`collect` | 数据复核师 |
| 5 | `asset` | 租赁物与中登网核查分析师 | `05-asset-registry.json` | `intake`、`collect` | 数据复核师 |
| 6 | `verify` | 数据复核师 | `06-verify.json` | `finance`、`credit`、`asset`、`collect` | 风控评审员 |
| 7 | `arbitrate` | 调度协调员 | `07-arbitration.json` | `verify` | 数据复核师 |
| 8 | `review` | 风控评审员 | `08-risk-review.json` | `arbitrate` | 数据复核师 |
| 9 | `report` | 报告撰写 | `09-report.md` | `review` | 风控评审员 |
| 10 | `feedback` | 反馈优化Agent | `10-feedback.json` | `report` | （无） |

波次：`{coord-open}` → `{intake, collect}` → `{finance, credit, asset}` → `{verify}` → `{arbitrate}` → `{review}` → `{report}` → `{feedback}`。

两点容易误读：

- **`feedback` 节点没有被评审**。它的节点定义里没有 `reviewer`，工作流级 `review` 块也只写了 `maxRework` / `enabled`、没写 `reviewer`。评审者的解析规则是「节点自己的 `reviewer` 优先，否则用工作流级 `review.reviewer`（`review.enabled === false` 时关闭这个默认值）」——两处都没给名字，就没有评审步骤。这不是故障，但别以为每一步都有人审。
- **`arbitrate` 的 `return_to_intake` 不会自动回环**。当前插件没有 loop / 回退原语：`07-arbitration.json` 的 `decision = return_to_intake` 只给出一份可执行的 `intake_recheck_items` 清单，需要由人（或调用方）据此**发起新的一次运行**；同时下游节点被要求在读到该 decision 时写阻断产物、不定级。不要把它写成「自动退回重跑」。

## 三、怎么发起一次评估

### 3.1 准备案子目录

```
<你的case目录>/
  inputs/                     # 原始材料（调用方准备，节点只读）
    财务报表.csv
    银行流水.xlsx
    征信报告.pdf
    诉讼记录.json
    中登网登记数据.json
  00-plan.json                # 以下 11 个产物由流水线自己写入
  01-data.json
  02-web.json
  03-finance.json
  04-credit-legal.json
  05-asset-registry.json
  06-verify.json
  07-arbitration.json
  08-risk-review.json
  09-report.md
  10-feedback.json
```

`case_dir` 建议用**绝对路径**，并且一次运行用一个独立目录：同一目录并发跑两个案子会互相覆盖产物。

### 3.2 启动运行

**方式 A：在 DSH 会话里用工具（阻塞）**

```
team_run_workflow({
  workflowId: "leasing-risk-assessment",
  input: { "case_dir": "<你的case目录>", "tenant": "某某机械制造有限公司" }
})
```

`team_run_workflow` 的注册参数（实测抽取自宿主源码，见第八节）是 `workflowId`（必填）、`input`、`route`、`inheritContext`。它**阻塞到整次运行结束**才返回，每个节点还有自己的单步超时，真实案子可能阻塞很久；返回只有摘要 `{ ok, runId, status }`，细粒度进度去进度面板或 `/progress` 看。不要在一次调用里连着起好几个。

**方式 B：HTTP 启动（后台跑，立刻拿到 runId）**

```
POST http://127.0.0.1:3080/api/team-flowise/run/start
Content-Type: application/json

{
  "workflowId": "leasing-risk-assessment",
  "input": { "case_dir": "<你的case目录>", "tenant": "某某机械制造有限公司" },
  "route": { "provider": "<provider id>", "model": "<model id>" },
  "session": "<会话 id，可选>"
}
```

`/run/start` 的真实参数（实测抽取自宿主源码第 2697–2721 行）：`workflowId`（必填，未知 id 直接返回 `{ok:false,error:'unknown workflow <id>'}`）、`input`（对象）、`route`（对象，运行级路由覆盖，优先级最高）、`session`（可选；HTTP 没有活的发起者，**不传就不会有会话归属**，界面上不会算进「本会话」）。返回 `{ ok: true, run: { id, workflowId, status: 'running' } }`，运行在后台继续。

写接口只在 loopback 可用（非 127.0.0.1 一律 403）；读取端点不需要。

### 3.3 看进度与评审结论

- 界面：**设置 → 多 Agent 团队**（看板 / Agents / 工作流 / 任务 / 运行）、左侧边栏的「多 Agent 团队进度」、会话右栏的「多 Agent 进度」页签。
- HTTP：`GET /api/team-flowise/progress?runId=<runId>`（节点状态、`dependsOn`、`route`、`persona`、`totals`）；`GET /api/team-flowise/role?runId=<runId>&agent=<角色名>`（该角色的节点产出与它作为评审者的评审判据）。
- 每个节点的 `status` 取值含 `pending / working / reviewing / rework / completed / failed`，P13 起还有 `skipped`（引擎硬停时未执行的节点）。

## 四、怎么改某个角色用的模型

### 4.1 意图层：`models.map.json`

角色定义里写的是**模型意图名**，不是具体模型：`flash`（DeepSeek V4.1 Flash）、`terra`（GPT Terra）、`astra`（GPT Astra）。`models.map.json` 把意图按 `prefer` 顺序翻译成具体路由，安装时解析一次：

| 意图 | 谁在用 | `prefer` 顺序（节选，全文见 `models.map.json`） |
|---|---|---|
| `flash` | 调度协调员、数据整理员、网络资料收集员、信用与法律分析师、租赁物与中登网核查分析师、数据复核师 | `amd/DeepSeek-V4.1-Flash` → `kuafu/deepseek-v4.1-flash` → `deepseek-official/deepseek-flash` → `deepseek-official/deepseek-v4-flash` |
| `terra` | 财务分析师、报告撰写 | `hub16/gpt-5.6-terra` → `hub16/gpt-5.6-sol` → `deepseek-official/deepseek-v4-pro` |
| `astra` | 风控评审员、反馈优化Agent | `hub16/gpt-6-astra` → `hub16/gpt-5.6-sol` → `deepseek-official/deepseek-v4-pro` |

**prefer 里一个都解析不到时，该角色不写 `model` 字段，直接继承会话模型**，安装器如实告警——这是降级，不是失败。所以在别的部署上「模型没按意图生效」最常见的原因就是目标部署根本没有这些 provider。

### 4.2 角色层：改某个角色实际用的 provider/model

角色级路由字段就是角色定义里的 `provider` / `model`（必须**成对**声明）。用 `team_create_agent` 改（带 `id` 是改，不带 `id` 是建；没传的字段保持原值）：

```
team_create_agent({
  id: "lease-risk-reviewer",
  provider: "<provider id>",
  model: "<model id>"
})
```

10 个角色的固定 id（`pack.json.targets.roleIds`，也是安装器钉住的 id）：`lease-coordinator`、`lease-data-organizer`、`lease-web-collector`、`lease-financial-analyst`、`lease-credit-legal-analyst`、`lease-asset-registry-analyst`、`lease-data-verifier`、`lease-risk-reviewer`、`lease-report-writer`、`lease-feedback-optimizer`。

也可以直接在**设置 → 多 Agent 团队 → Agents** 里改（下拉框里是这个部署真实注册过的 provider / model，比手写安全）。改完立即生效，不需要重启 dsh；但**只能影响之后新起的运行**。

`GET /api/team-flowise/models` 是查真实可选值的权威来源（只读）。

### 4.3 为什么本包一律不声明 `reasoningEffort`

`reasoningEffort` 必须是**该模型自己 efforts 列表里的 id**。开发机上用 `GET /api/team-flowise/models` 实测，几个目标模型的 `reasoning.efforts` 都是空数组：

```
amd/DeepSeek-V4.1-Flash   -> {"reasoning":{"efforts":[],"defaultEffort":null}}
kuafu/deepseek-v4.1-flash -> {"reasoning":{"efforts":[],"defaultEffort":null}}
hub16/gpt-5.6-terra       -> {"reasoning":{"efforts":[],"defaultEffort":null}}
hub16/gpt-6-astra         -> {"reasoning":{"efforts":[],"defaultEffort":null}}
```

给 efforts 为空的模型声明 `reasoningEffort`，会让**整层路由作废并回退到父级**——也就是「配了等于没配，还不告诉你」。所以本包的策略是**不声明**，用模型自身的默认推理强度；确实需要固定强度时，先查 `GET /api/team-flowise/models` 拿到该模型真实的 efforts 列表，再显式加。

另外两条与「模型没生效」直接相关的规则：

- **成对规则**：只给 `provider` 或只给 `model`，那一半会被忽略（不会自动补默认值），`team_create_agent` 的返回值里 `warning` 会说。
- **`maxTokens` 独立生效**，不参与成对规则。

## 五、硬停的两种机制

### 5.1 引擎级硬停：`workflow.haltOnFailure = true`

本工作流声明了 `haltOnFailure: true`。语义（宿主半实现的语义，本包按它声明）：

- 任一节点**失败**（worker 报错 / 超时 / 返工 worker 失败），或任一节点的评审**在返工上限内仍有阻塞项未解决**，即触发停止。
- 触发后**尚未开始**的节点（整次运行级，不只是失败节点的下游）记为 `status: 'skipped'`，带 `blockedBy: <触发节点>`；运行最终状态为 `halted`（界面显示「已停止（未跑完）」）。
- **同波不杀**：触发所在那一波里已经在跑的节点允许跑完并保留产物（扔掉真实工作会让记录说谎）。
- 仅 `advisory`、或返工后已通过，**不**触发停止。
- 没有可 skip 的节点时：因**失败**触发仍是 `failed`，因**未解决的阻塞项**触发仍是 `halted`（这一条正是为了防止「不可修复的节点恰好是最后一个节点」时静默报 completed）。

**这条能力需要支持 `haltOnFailure` 的 team-flowise 版本。** 装到旧版本上，字段可能在写入时被丢弃：此时流水线仍能跑，但**没有引擎级停止**，只剩下面那层产物级阻断。自己探测（只读）：读回工作流记录 `GET /api/team-flowise/workflows`，看该工作流的记录里有没有 `"haltOnFailure": true`——没有这个键就是没存住。详细步骤与补救见 `README.md` 的「能力探测」。

### 5.2 产物级阻断：每个节点自检上游产物

不依赖引擎版本，任何情况下都有效：每个节点的任务书都要求先检查上游产物，命中下列任一情况时**写阻断产物并停止，不产出风险结论**：

- 上游产物文件不存在、为空、或不是合法 JSON/Markdown；
- 上游产物写了 `BLOCKED`、`overall_verdict: "FAIL"`、或 `decision: "return_to_intake"` / `"stop_for_human"`；
- 本步骤所需数据在原始材料中不存在（例如中登网数据未提供）。

阻断产物的形状（Markdown 产物则写一节 `## 阻断`）：

```json
{ "blocked": true, "blocked_reason": "<具体原因>", "missing": ["<缺什么>"], "needed_from": "<哪个角色/哪份材料>" }
```

完整规则见包内 `adapters/00-workflow-contract.md`（它被装成**工作流级人设层**，每个节点都能看到）。

**两层叠加的意义**：支持 `haltOnFailure` 的版本立刻停、不浪费后续模型调用；不支持的版本下游也不会凭着空产物编出风险结论。

## 六、上下文继承：本包在 workflow 层钉住 `inheritContext: "none"`

本工作流声明了 `"inheritContext": "none"`（workflow 层）。含义是：**这条流水线的节点不继承主会话的对话历史**，worker 从一个干净的上下文开始，案情材料全部通过 `case_dir` 下的文件传递。

### 6.1 为什么不继承

产物总线是文件系统：调用方在运行 input 里给 `case_dir`，每个节点按固定文件名读写。节点需要的是案情材料，不是"我们刚才聊了什么"。而继承的代价是**实测**出来的（同一条工作流、两个只回一个词的节点，三臂对照）：

| 臂 | input | cacheRead | 两节点墙钟 |
|---|---|---|---|
| 开继承 | 326 | 1,297,664 | 16.5 s |
| 关继承 | 324 | 15,104 | 4.4 s |

即使前缀缓存命中率 100%，每节点仍要把 60 万 token 量级的前缀过一遍，墙钟约 4~9 倍。对一条逐个案子跑的流水线，这是纯成本；而且主会话里与本承租人无关的内容会进入案情分析。**收益为零，成本与污染都是真的。**

### 6.2 它防什么、不防什么

解析顺序是 `run > node > workflow > role`（整层胜出）。本包只声明 workflow 层，所以它是这条流水线所有节点的默认值。

- **防的是**：后来有人给某个 `node` 或 `role` 单点开了 `session`。那种情况下会被 workflow 层的 `none` 压住，并在该节点的 `context` 记录里留下 `overridden`（点名是哪一层开的）。
- **不防的是**：调用方在**运行级**显式传 `inheritContext: "session"`。run 层优先——那是调用方的显式指令，本包不打算也无法否决它。
- **评审者任何时候都不继承**，没有开关。

### 6.3 旧版本丢弃这个字段：无害降级

**这条能力需要支持 `inheritContext` 的 team-flowise 版本。** 装到旧版本上，字段可能在写入时被丢弃。与 `haltOnFailure` 不同的是，**这里的降级不改变任何行为**：不声明该字段时的默认就是不继承，与本包钉的 `none` 生效值相同。实际丢掉的只有两样东西——这条显式策略声明，以及 6.2 里"压住单点继承并留痕"的能力。安装器会在读回校验里如实告警，退出码仍是 0；`--check` 也不会因此报不一致（它按生效值比，缺失按默认 `none` 计）。

还有一条**可观察的等价性**：在没有任何下层声明 `session` 时，workflow 层的 `none` **不产生任何 `context` 记录**——节点记录与完全不声明该字段时逐键相同。所以"旧版本丢弃它"和"新版本存住它"在运行记录上观察不出差别。

自己验证（只读）：读回工作流记录 `GET /api/team-flowise/workflows`，看该工作流有没有 `"inheritContext": "none"`；再跑一次案子，看节点的 `context` 键——**没有这个键就说明继承没有被介入**，这正是本包想要的状态。

### 6.4 为什么本包不声明 `inheritMaxEvents`

`inheritMaxEvents` 是继承的**预算**（父级日志已完成事件数的上限）。它只在继承开启时才有意义——超出上限时插件**拒绝继承、退回干净派发**，不是截断前缀（它做不到截断：种子长度由驱动层决定，插件只能预测与拒绝）。本包的继承已关，声明预算没有意义。

## 七、常见故障

| 症状 | 最可能的原因 | 怎么查 / 怎么办 |
|---|---|---|
| **引擎不硬停**：上游失败了，下游照样在跑 | 目标 team-flowise 版本不支持 `haltOnFailure`（字段被丢弃），或工作流定义里没声明它 | 读回工作流：`GET /api/team-flowise/workflows` 里该工作流的记录应带 `"haltOnFailure": true`；记录里没有这个键 = 没存住。此时**只能靠产物级阻断**——检查下游是否真写了阻断产物，而不是接受了空输入 |
| **上游产物缺失**：下游报 BLOCKED 或写出空的结论 | `case_dir` 写错 / 传了相对路径、上游节点失败或超时、文件名拼错或被并发覆盖 | 看该节点回复里的 `BLOCKED: <原因>` 与阻断产物里的 `missing`；`06-verify.json` 之前的问题看 `03/04/05` 是否存在且非空；确认一次运行独占一个 `case_dir` |
| **中登网查不到** | 没有查询渠道，或本次材料里根本没给中登网数据 | 这是**正常且必须如实记录**的状态：`02-web.json` 要写「未查询到中登网登记记录」，`05-asset-registry.json` 要写「中登网数据缺失」并**不做推测**；绝不允许用记忆中的数据顶替，也不允许把缺失填成 0 |
| **评审 JSON 解析失败** | 评审者没按契约输出那一个 JSON 对象（夹了散文、或分了多段） | 机械规则 R1：无法解析 → `verdict = error`、零 findings、**该节点仍然完成**——这是评审者的问题，不是节点的错，节点不会因此失败。查该节点的 `review.notes` / `review.verdict`；确认评审者收到的是插件自己构造的评审提示词，且约束在输出契约那一段 |
| **角色建了却没有评审** | 节点没写 `reviewer`，工作流级 `review` 也没写 `reviewer`（或写了 `review.enabled: false`）；或者用的是 `team_delegate_agent`，那里的 `reviewer` **只登记在台账上、不派发评审者** | 只有节点级 `reviewer`（或工作流级默认值）才会跑评审。本工作流里 `feedback` 节点就是「无评审」的示例；`team_list_agents()` / `GET /api/team-flowise/agents` 核对角色名，评审者名解析不到不会报错，只会悄悄没有评审 |
| **模型没生效** | 只声明了 `provider` 或只声明了 `model`（成对规则作废该半）；provider 未注册 / model 不存在 / `reasoningEffort` 不被接受 → 整层回退继承父级；或 `models.map.json` 的意图在目标部署上一个都解析不到 | 看节点的 `route.warning` 与 `route.source`（`inherited` 就是回退了）、`team_create_agent` 返回值里的 `warning`；用 `GET /api/team-flowise/models` 核对真实可选值；本包的默认策略是**不声明** `reasoningEffort` |
| **不确定流水线有没有把主会话上下文拖进案情分析** | 本包在 workflow 层钉了 `inheritContext: "none"`，节点不该继承 | 看节点记录里的 `context` 键：**没有这个键 = 继承没有被介入**（这是本包的正常状态，见第六节）。出现 `context.effective === "session"` 说明有人在下层单点开了继承、或调用方在 **run 层**显式传了 `session`（run 层优先级最高，本包压不住，这是设计如此）；出现 `context.effective === "none"` 且 `reason` 里提到"杀开关"说明它被 workflow 层的声明压住了，同一节点的 `overridden` 会点名是哪一层开的 |

其他两条常见现象：节点一直 `pending` → 十有八九是 `dependsOn` 写了一个不存在的节点 id（悬空依赖永远不会完成）；API 返回 401 → 多半是宿主半没加载或 dsh 还没重启（先 `GET /api/team-flowise/ping`）。

## 八、这条流水线用到的 team_* 工具（实测抽取的参数清单）

下面 7 个工具名与参数名是**从宿主源码 `packages/team-flowise/src/index.js` 的 `defineTool` 注册处逐字抽取**出来的（抽取用的是一次性只读脚本，没有凭记忆写）；这也是宿主当前真正注册的工具面——不多不少 7 个。带 `*` 的是必填：

> **这张表过期过一次，如实说明**：P16 给 `team_create_workflow` 与 `team_run_workflow` 各加了一个 `inheritContext`，这张表当时没跟上，而且**当时没有任何检查会发现它**——宿主的文档校验只查「文档里写的参数名是不是真的存在」，不查「真的参数是不是都写进文档了」。本包 1.1.0 已把这两个补上；核对的权威来源是运行时注册的工具 schema（读回 `parameters.properties` 的键），不是这段文字。这张表目前仍**没有**机械校验钉住，改动它时请自己对着 schema 核一遍。

| 工具 | 参数 |
|---|---|
| `team_list_agents` | （不接受任何参数） |
| `team_create_agent` | `id`、`name`、`role`、`systemPrompt`、`provider`、`model`、`reasoningEffort`、`maxTokens`、`timeoutMs`、`toolsPreset`（schema 未标任何必填；但 `name` 缺省取 `role`，两个都不给会建出一条没有可引用名字的角色） |
| `team_create_workflow` | `name*`、`description`、`nodes`、`route`、`prompt`、`haltOnFailure`、`inheritContext` |
| `team_run_workflow` | `workflowId*`、`input`、`route`、`inheritContext` |
| `team_delegate_agent` | `agent*`、`task*`、`acceptanceCriteria`、`reviewer` |
| `team_create_task` | `requirement*`、`acceptanceCriteria*`、`assignee*`、`reviewer` |
| `team_task_status` | （不接受任何参数） |

`route` 的子键是 `provider` / `model` / `reasoningEffort` / `maxTokens`（`team_run_workflow` 与 `team_create_workflow` 的 `route` 均如此）。

与使用相关的两条边界：

- **工作流级 `review` 块不在 `team_create_workflow` 的注册参数里**（实测参数清单如上，只有 `name`、`description`、`nodes`、`route`、`prompt`、`haltOnFailure`、`inheritContext`）。本包的 `review: {maxRework: 1, enabled: true}` 与 `inheritContext: "none"` 由安装器通过 `POST /api/team-flowise/workflow` 写入；要自己改这个默认评审者/返工上限/继承策略，也走同一个接口。
- **worker（节点执行者）看不到任何 `team_*` 工具**，也看不到 `subagent` / `workflow` / `ask_user_question` 等：任务书必须自包含，节点之间只能通过 `case_dir` 的文件交换信息。

## 九、本包的已知限制（不要读成能力）

- 引擎级硬停需要支持 `haltOnFailure` 的 team-flowise；旧版本上只有产物级阻断。
- **上下文继承策略需要支持 `inheritContext` 的 team-flowise**；旧版本丢弃该字段是**无害降级**（生效值仍是不继承、运行记录观察不出差别），丢的只是那条显式声明与"压住单点继承并留痕"的能力。**这条声明钉的是默认值，不是否决权**：调用方在 run 层传 `session` 仍然优先（见第六节）。
- `arbitrate` 判 `return_to_intake` **不会自动回环**（插件没有 loop 原语），只能由人据此发起新的一次运行。
- 模型意图解析不到就继承会话模型，这是如实降级；目标部署上可能一个意图都解析不到。
- `route.measured` **已被真实观测到为 `true`，但它仍是尽力而为，不要当保证**：P13 期间 run `9x2tro7rmubbgzqs` 的 `design-audit` 节点记录为 `measured: true`，其 `effective`（amd/DeepSeek-V4.1-Flash）与 `requested`（amd/DeepSeek-V4-Flash，一个不可解析的名字）不同，即 `effective` 取自子代理自身的 request header —— 这正是它的定义。读不到时记 `false`，绝不拿请求值冒充实测值；判断路由是否真的生效仍应结合 `route.source` 与 `route.warning`。
- 本包**不含** team-flowise 源码（避免版本漂移）：需要先按 `README.md` 第二步把 team-flowise 装好。
