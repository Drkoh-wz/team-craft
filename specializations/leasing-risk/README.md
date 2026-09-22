# 融资租赁客户还款风险评估团队（移植包）

这是一支**专用多角色团队**的移植包：把它装到你的 DSH 上，你就得到一条固定 11 步的融资租赁还款风险评估流水线——10 个角色（数据整理员、网络资料收集员、财务分析师、信用与法律分析师、租赁物与中登网核查分析师、数据复核师、调度协调员、风控评审员、报告撰写、反馈优化Agent）按依赖关系协作，每一步（除最后的反馈节点外）都由另一个角色独立评审，产物落在一个案子目录里，最后产出一份可回溯的风险评估报告与风险等级。

包内有什么：

| 文件 / 目录 | 作用 |
|---|---|
| `pack.json` | 清单：目标 id、能力要求、产物契约（`caseDirContract`）、硬停说明、来源声明 |
| `roles.json` | 10 个角色的元数据（固定 id、名称、职责、人设文件、模型意图、工具预设、超时） |
| `workflow.json` | 11 节点 DAG（顺序由 `dependsOn` 决定）+ `haltOnFailure: true` |
| `models.map.json` | 模型意图 → 具体 provider/model 的 `prefer` 顺序 + `reasoningEffort` 策略 |
| `prompts/` | 10 份角色人设（用户原文逐字保存） |
| `adapters/` | 工作流契约（产物总线与阻断规则）+ 2 份评审职责适配 |
| `PROVENANCE.json` | `prompts/` 的 sha256 清单，用于发现被误改 |
| `install.mjs` / `uninstall.mjs` / `selftest.mjs` | 安装器 / 卸载器 / 随包自检 |
| `SKILL.md` | 给 agent 用的技能（装到技能根目录后，模型能自己判断何时加载） |
| `README.md` | 本文件 |

> 本文面向**接收方**（要把这套东西装起来用的人），不是开发者。文中所有命令与参数来自本包的接口约定（`pack.json.entrypoints` 与包内脚本）；凡是无法在你自己的环境里复核的说法，本文都会如实标注。

---

## 一、前置条件

| 要求 | 为什么 | 怎么确认 |
|---|---|---|
| **Node.js ≥ 20** | 安装器只用 Node 内置模块，不需要 `npm install` | `node --version` |
| **DSH 已装好并能启动 Web GUI** | 本包的角色与工作流是通过 team-flowise 的 HTTP 接口写进运行中的 DSH 进程的 | 打开 DSH 的 Web GUI（默认 `http://127.0.0.1:3080`） |
| **team-flowise 插件（第 1 步装）** | 本包**不含**它的源码：角色定义、工作流、调度器、评审闸门、进度面板都由它提供 | `GET http://127.0.0.1:3080/api/team-flowise/ping` 返回 `{"ok":true,"pong":true,"domains":[...]}` |
| **一个 DSH profile 目录** | 装 team-flowise 时插件行与依赖写在这里；默认是 `%USERPROFILE%\.dsh\profiles\web` | `node <team-flowise 仓库根>/scripts/install.mjs --check` |

team-flowise 的安装命令（在 **team-flowise 仓库根**执行，仓库根 = 含 `packages/team-flowise` 与 `scripts/install.mjs` 的目录）：

```
node scripts/install.mjs
```

常用变体：`--profile <dir>`（装到别的 profile）、`--dry-run`（只打印将要做的改动）、`--check`（只校验，退出码 0 = 已就位、3 = 有漂移）。详细说明见 team-flowise 仓库自己的 `README.md`。

📌 **装完 team-flowise 必须重启 DSH**：宿主半代码与客户端界面 bundle 都在 DSH 启动时加载/快照。重启前 `GET /api/team-flowise/ping` 很可能被网关伪装成 **401**，界面入口也不会出现——那不是本包的问题。重启后再确认一次 `ping`。

---

## 二、两步安装

**第 1 步：装 team-flowise**（见上一节）

```
node <team-flowise 仓库根>/scripts/install.mjs
```

**第 2 步：装本包**（在**本包目录**里执行）

```
node install.mjs
```

默认目标：profile = `%USERPROFILE%\.dsh\profiles\web`，端点 = `http://127.0.0.1:3080`。

本包安装器的接口：

```
node install.mjs [--profile <dir>] [--endpoint <url>] [--dry-run] [--check] [--force] [--skip-skill] [--json] [--help]
node uninstall.mjs [--profile <dir>] [--endpoint <url>] [--dry-run] [--help]
node selftest.mjs
```

权威清单用 `node install.mjs --help`；`--dry-run` 与 `--check` **都不落盘**（连目录都不创建），且两者不能同时使用。安装器退出码：`0` 成功（含「读回发现 `haltOnFailure` 没存住」这类能力降级——那是告警不是失败），`1` 参数/前置校验失败，`2` 运行时不可达，`3` `--check` 不一致。

它做的事（每步幂等，重复执行输出「已存在，跳过」）：

1. **前置校验**：读并校验 `pack.json` / `roles.json` / `workflow.json` / `models.map.json` / `PROVENANCE.json`；校验 `prompts/`、`adapters/` 里没有双左花括号（那是运行时的插值语法，会被改写）；校验 DAG 无环、无悬空 `dependsOn`、`agent` / `reviewer` 都能解析到角色。任一失败就非零退出，**不写任何东西**。
2. **探测运行时**：`GET <endpoint>/api/team-flowise/ping`。不可达就给出指引（「先启动 DSH，或先装 team-flowise」），不尝试写。
3. **解析模型意图**：`GET /api/team-flowise/models`，对每个意图按 `models.map.json` 的 `prefer` 顺序找第一个存在的 (provider, model)。找不到就**不写该角色的 `model` 字段**（改为继承会话模型）并如实告警，不猜。
4. **导入 10 个角色**：`GET /agents` 建 name→id 映射，然后逐个 `POST /agent`，**id 用 `roles.json` 里的固定 id**（钉住 id 才能幂等），`systemPrompt` = 人设正文 +（有适配时）空行 + 适配正文。
5. **导入 1 条工作流**：`POST /workflow`，`prompt` 填 `adapters/00-workflow-contract.md` 的正文；写入后**读回**校验 `haltOnFailure === true` 与 `review.maxRework === 1` 确实存住了（见「能力探测」）。
6. **装技能**：把 `SKILL.md` 装到技能根目录（优先本部署配置的技能目录，否则 `%USERPROFILE%\.dsh\skills\leasing-risk-assessment\`）。
7. 打印结论：**技能热加载不需要重启；角色与工作流是通过 HTTP 写进运行中的进程的，因此立即生效、也不需要重启**。（这一点与 team-flowise 自身「装完必须重启」不同，别照抄。）

`--check` 会逐项比对目标状态并打印每一项不一致的原因；`--dry-run` 只打印将要发生的事。

装完怎么确认：

| 检查 | 期望 |
|---|---|
| `GET /api/team-flowise/agents` | 出现 10 个 `lease-*` 角色（id 与 `pack.json.targets.roleIds` 一致） |
| `GET /api/team-flowise/workflows` | 出现 `leasing-risk-assessment`，11 个节点 |
| DSH 界面 | 设置 → 多 Agent 团队 里能看到这 10 个角色与这条工作流 |
| 技能 | 新会话的技能列表里出现 `leasing-risk-assessment` |

---

## 三、跑一个案子

### 3.1 准备案子目录

产物总线是文件系统：你给一个目录，流水线的每个节点读上游的固定文件名、写自己那一个文件。原始材料放在 `inputs/` 子目录下。

```
<你的case目录>/
  inputs/                     # 原始材料（你准备，节点只读）
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

- `case_dir` 用**绝对路径**。
- **一次运行独占一个目录**：同一目录并发跑两个案子会互相覆盖产物。
- 产物文件名与节点、角色的对应关系：`00-plan.json` ← 调度协调员的就绪检查；`01-data.json` ← 数据标准化；`02-web.json` ← 公开渠道收集；`03-finance.json` ← 财务分析；`04-credit-legal.json` ← 信用与法律；`05-asset-registry.json` ← 租赁物与中登网核查；`06-verify.json` ← 独立核验；`07-arbitration.json` ← 冲突仲裁；`08-risk-review.json` ← 综合评审定级；`09-report.md` ← 报告；`10-feedback.json` ← 反馈与偏差诊断。逐字清单在 `pack.json.caseDirContract.artifacts`。

### 3.2 启动

**方式 A：HTTP（后台跑，立刻返回 runId）**

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:3080/api/team-flowise/run/start `
  -ContentType 'application/json' `
  -Body '{"workflowId":"leasing-risk-assessment","input":{"case_dir":"<你的case目录>","tenant":"某某机械制造有限公司"}}'
```

返回 `{ ok: true, run: { id, workflowId, status: 'running' } }`；运行在后台继续。

**方式 B：在 DSH 会话里让 agent 启动**

直接说「用 leasing-risk-assessment 工作流评一下 `<你的case目录>`」，或由 agent 调用：

```
team_run_workflow({ workflowId: "leasing-risk-assessment", input: { case_dir: "<你的case目录>" } })
```

注意 `team_run_workflow` **会阻塞到整次运行结束**（每个节点还有自己的单步超时，默认 30 分钟），真实案子可能等很久。

`input` 里除 `case_dir` 外可以放任何 JSON 字段（例如 `tenant` 承租人名称），节点能读到；`case_dir` 是唯一被流水线约定含义的键。

### 3.3 看进度与结果

- 界面：**设置 → 多 Agent 团队**（看板/Agents/工作流/任务/运行）；左侧边栏的「多 Agent 团队进度」；会话右栏的「多 Agent 进度」页签。
- HTTP：`GET /api/team-flowise/progress?runId=<runId>`；某个角色的节点与评审判据：`GET /api/team-flowise/role?runId=<runId>&agent=<角色名>`。
- 结果本体：最终报告是 `<case_dir>/09-report.md`，风险等级在 `<case_dir>/08-risk-review.json`。

用 HTTP 启动的运行若没带 `session`，就没有会话归属，界面上不会出现在「本会话」下——这是如实标注，不是故障。

---

## 四、改模型

角色用的是**模型意图名**（`flash` / `terra` / `astra`），不是具体模型。`models.map.json` 把意图按 `prefer` 顺序翻译成 `(provider, model)`。两种改法：

**改法 1：改意图映射（推荐，覆盖面广）** — 编辑 `models.map.json` 的 `prefer` 列表（把你能用的 provider/model 排到前面或替换掉），然后重跑一次 `node install.mjs`：安装器按固定 id upsert，会覆盖这 10 个角色的模型字段。

**改法 2：改单个角色** — 在 **设置 → 多 Agent 团队 → Agents** 里改该角色的 provider/model（下拉框里是这个部署真实注册过的值），或让 agent 调用：

```
team_create_agent({ id: "lease-risk-reviewer", provider: "<provider id>", model: "<model id>" })
```

（`team_create_agent` 带 `id` 是改，不带 `id` 是建；`provider` 与 `model` **必须成对**给，只给一半那一半会被忽略并在返回值 `warning` 里说明。）

三条要点：

1. 查真实可选值：`GET http://127.0.0.1:3080/api/team-flowise/models`（只读，权威）。
2. **不要声明 `reasoningEffort`**：它必须是该模型自己 efforts 列表里的 id。很多模型的 `reasoning.efforts` 是**空数组**（实测示例：`amd/DeepSeek-V4.1-Flash`、`hub16/gpt-5.6-terra`、`hub16/gpt-6-astra` 都是 `{"efforts":[],"defaultEffort":null}`），给它们声明强度会让整层路由作废并回退父级——配了等于没配。本包因此一律不声明，用模型默认值。
3. 改完**立即生效**（不需要重启），但只影响之后新起的运行。

---

## 五、卸载

在**本包目录**里执行：

```
node uninstall.mjs
```

它逐个 `DELETE /api/team-flowise/agent?id=<id>` 删除 `pack.json.targets.roleIds` 里的 10 个角色，`DELETE /api/team-flowise/workflow?id=` 删除 `leasing-risk-assessment`，并按 `--keep-skill` 决定是否保留技能目录。幂等：不存在时输出「不存在，跳过」。**默认不会删除同名但 id 不同的角色**（只告警），以免误删别人的东西。

如果包内没有带卸载器（或你想自己来一遍），这两个写接口都在宿主里注册着，手动删也一样（写接口仅限 loopback）：

```powershell
$ids = @('lease-coordinator','lease-data-organizer','lease-web-collector','lease-financial-analyst',
         'lease-credit-legal-analyst','lease-asset-registry-analyst','lease-data-verifier',
         'lease-risk-reviewer','lease-report-writer','lease-feedback-optimizer')
foreach ($id in $ids) {
  Invoke-RestMethod -Method Delete "http://127.0.0.1:3080/api/team-flowise/agent?id=$id"
}
Invoke-RestMethod -Method Delete 'http://127.0.0.1:3080/api/team-flowise/workflow?id=leasing-risk-assessment'
```

技能目录不会因此被删，按你的技能根目录自己移除 `<技能根>/leasing-risk-assessment/` 即可。

要连 team-flowise 一起卸：在 team-flowise 仓库根执行 `node scripts/uninstall.mjs`（详见它的 README）。

---

## 六、能力探测：这个 team-flowise 支不支持 `haltOnFailure` 与 `inheritContext`

这两个字段的**缺失含义完全不同**，所以探测之后要做的事也不同。

### 6.1 `haltOnFailure`：缺了是真缺口

流水线的「失败即停」有**两层**（见 `SKILL.md` 第五节）：引擎级 `haltOnFailure` 与产物级阻断。产物级阻断在任何版本上都有效；**引擎级只在支持该字段的 team-flowise 版本上有效**。

自己验一次（30 秒，只读）：

```powershell
(Invoke-RestMethod http://127.0.0.1:3080/api/team-flowise/workflows).workflows |
  Where-Object { $_.id -eq 'leasing-risk-assessment' } |
  ConvertTo-Json -Depth 3
```

看输出里有没有 `"haltOnFailure": true`：

- **有** → 引擎级硬停可用：任一步骤失败、或某节点的阻塞项在返工上限内未解决时，运行停止，未开始的节点记为 `skipped`。
- **没有这个键** → 你的插件版本丢弃了该字段（写入成功但没存住）。流水线**照常能跑**，只是没有引擎级停止：此时**只剩产物级阻断**——每个节点遇到上游产物缺失/为空/`blocked`/`FAIL`/`return_to_intake`/`stop_for_human` 时必须写阻断产物并停止，不产出风险结论。

字段被丢弃时怎么办：把 team-flowise 升到带该能力的版本、**重启 DSH**（宿主半在启动时加载），再重跑一次 `node install.mjs` 把工作流重写一遍，然后再探测一次。

### 6.2 `inheritContext`：缺了是无害降级

本包在 workflow 层声明了 `"inheritContext": "none"`（见 `SKILL.md` 第六节）：这条流水线的节点**不继承主会话的对话历史**，案情材料只走 `case_dir` 下的文件。

同一个探测命令，看输出里有没有 `"inheritContext": "none"`：

- **有** → 声明落库了。此后若有人给某个节点/角色单点开 `session`，会被这条 workflow 层声明压住并在节点记录的 `overridden` 里留痕。
- **没有这个键** → 你的插件版本丢弃了该字段。**这不需要补救，也不会改变任何运行结果**：不声明该字段时的默认就是不继承，与本包钉的 `none` 生效值相同；在没有任何下层声明 `session` 时，两者连运行记录都逐键相同（不产生 `context` 记录）。真正丢掉的只有那条显式声明和上面的压制留痕。

安装器对这个字段的读回校验**只会告警、退出码仍是 0**，`--check` 也不会因此报不一致——因为它是按**生效值**比较的（缺失按默认 `none` 计），不是按"字段在不在"。这与 `haltOnFailure` 的处理刻意不同：那个缺了是真的没有硬停能力，这里缺了行为一字不差。

自己确认继承有没有被介入（比看字段更直接）：跑一次案子，看每个节点记录里有没有 `context` 键。**没有 `context` 键 = 继承没有被介入**，这正是本包想要的状态。

### 6.3 从 1.0.0 升到 1.1.0 时：这条声明怎么才算真的落库

这一条容易踩，如实写清。安装器的 `--check` 与「是否需要写入」都按**生效值**比较，所以：

- 你 1.0.0 装上去的工作流记录里**没有** `inheritContext`，但它的生效值（不继承）与 1.1.0 声明的 `none` 相同 → 安装器判定「已就位且一致」，**不会重写这条工作流**。也就是说，光跑 `node install.mjs` 不会把那条策略声明写进记录。
- 与此同时 `SKILL.md` 的内容变了，所以 `--check` 会为**技能**报不一致（退出码 3）；而普通 `node install.mjs` 出于安全（绝不覆盖别人的技能文件，见第五节）只会告警、不会覆盖。

要让策略声明与新技能都真正落库，用 `--force`：

```powershell
node install.mjs --check      # 先看它怎么说（此时应为：技能不一致）
node install.mjs --force      # 重写角色/工作流/技能；随后 --check 回到 0
```

`--force` 会重写 10 个角色与 1 条工作流，内容与本包声明相同，**不会改变运行行为**；它做的是把「没落库的声明」补上。全新部署不需要这一步。

---

## 七、如实的能力边界

这一节逐条写清本包**做不到**和**依赖别人**的地方。请按这里写的理解能力，不要按期望理解。

1. **模型意图解析不到 → 继承会话模型。** `models.map.json` 的 `prefer` 在本机（P13 开发机）解析为 `deepseek-official/deepseek-flash`（日常角色）与 `deepseek-official/deepseek-v4-pro`（财务分析师、风控评审员、报告撰写、反馈优化）；换一个部署可能**一个都解析不到**。届时安装器不写该角色的 `model` 字段，角色直接**继承发起这次运行的会话模型**，并如实告警。这是降级，不是失败；想让意图生效就往 `models.map.json` 里加你这个部署真实存在的 provider/model。
   （v2 备注：三个意图的首选原先指向 `amd`、`hub16`；实测 `amd` 极慢——一个节点跑了 1000 秒才以 `stopReason=error` 收场——因此改为首选 DeepSeek 官方，用户原本指定的模型保留为后续选择。想恢复按角色分模型，只要把 `prefer` 顺序调回去。）

2. **`haltOnFailure` 需要新版 team-flowise。** 旧版本会把这个字段丢掉（写入时不报错、存不住），此时**只有产物级阻断**，没有引擎级停止：上游失败后下游仍可能被派发，靠下游自己读到空/阻断的上游产物才停下来。用第六节 6.1 的方法探测。

3. **`return_to_intake` 不会自动回环。** 调度协调员在 `07-arbitration.json` 判 `decision = return_to_intake`（口径差异）时，只会给出逐项可执行的 `intake_recheck_items` 清单；当前插件**没有 loop / 回退原语**，DAG 不会自动退回数据整理员重跑。必须由人（或调用方）据此**发起新的一次运行**；同时下游节点被要求在该 decision 下写阻断产物、不定级。**不要把它当成自动回退。**

4. **`mode` / `gate` 是死字段。** 工作流的节点 schema 收了这两个字段，但调度器从不读它们。本包不依赖它们，也请你不要用它们来配置行为（写了没有效果）。

5. **本包不含 team-flowise 源码。** 归档里只有本包自身的文件；插件必须按第二节第 1 步单独安装。这样做的原因是避免把某个版本的插件源码随包分发造成**版本漂移**——插件与包各自升级、各自 `--check`。

6. **`route.measured` 已观测到 `true`，但它仍是尽力而为，不要当保证。** P13 在**真实子代理**上第一次观测到 `route.measured === true`：一个失败节点的 `route.effective` 就等于该子代理自身 request header 里的 config（这正是它的定义）。但它是"读到了就记、读不到就记 `false`、绝不拿请求值冒充实测值"的语义；判断路由是否真的生效，仍应结合 `route.source`（`run` / `node` / `workflow` / `role` / `inherited`）与 `route.warning`。

7. **节点的 `reviewer` 才有评审。** 只有节点级 `reviewer`（或工作流级 `review.reviewer` 默认值）会派发评审者；本工作流里 `feedback` 节点没有评审。`team_delegate_agent` 的 `reviewer` 只登记在台账上，不派发评审者。

8. **命令与参数以包内脚本的 `--help` 为准。** 本文列出的 `install.mjs` / `uninstall.mjs` 参数与退出码来自本包的接口约定（`pack.json.entrypoints`）；在你自己机器上先跑 `node install.mjs --help` 再看一遍，`node install.mjs --dry-run` 与 `--check` 都不会写任何东西，可以放心先跑。**本包不声称任何未在你环境里验证过的运行结果**——包括「模型意图一定能解析到」「硬停一定生效」「技能一定被宿主加载」。

9. **`inheritContext: "none"` 是钉住默认值，不是否决权。** 本包在 workflow 层声明不继承会话上下文（理由与实测成本见 `SKILL.md` 第六节）。但解析顺序是 `run > node > workflow > role`，所以调用方在**运行级**显式传 `inheritContext: "session"` 时仍然优先——那时节点会继承，本包压不住，这是设计如此而不是缺陷。它防的是"后来有人给某个节点单点开继承"这类静默漂移。旧版本丢弃该字段属**无害降级**（生效值不变），探测方法见第六节 6.2。

10. **`SKILL.md` 的工具参数表目前没有机械校验钉住。** 它曾经过期过一次：P16 给 `team_create_workflow` 与 `team_run_workflow` 各加了一个 `inheritContext`，表里没跟上，而宿主的文档校验只查「文档里写的参数名是否真实存在」这一个方向，所以不会红。1.1.0 已补齐并与运行时注册的工具 schema 逐字核对过；但改动这张表时仍需自己对着 schema 复核。
