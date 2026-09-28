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

需要 DeepSeek Harness，以及一个组合了 web app 的 profile——通常就是 `web`。

```sh
dsh plugin --profile web add "git+https://github.com/Drkoh-wz/team-craft.git#path:packages/team-flowise"
```

不用构建，也没有需要批准的步骤。

本版本针对 **DeepSeek Harness `0.1.5-rc.1`**、`@deepseek-ai/*` **`0.1.5-rc.2`**、**Node 24** 做过端到端验证，`packages/team-flowise/package.json` 里的 `engines.dsh` 与 peer 范围也是照着这套组合写的。哪天 harness 更新后插件挂不上了——行没激活，或者 `team_*` 工具不再出现——先对照这几个版本号。

请装进有 web app 的 profile，这样界面才会出现。（装进裸 profile 也挂得上，只是没有浏览器那一半。）

然后重启 dsh。宿主代码和客户端 bundle 都是启动时读的，不重启就不生效。

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
node scripts/install.mjs --skill-root none # 不装技能
```

</details>

## 装好了吗？

按这个顺序查，别信浏览器缓存。

| # | 检查 | 期望 |
|---|---|---|
| 1 | `curl -s http://127.0.0.1:3080/api/team-flowise/ping` | `{"ok":true,"pong":true,"domains":[…4 个…]}` |
| 2 | 新开会话，看它的工具列表 | 那七个 `team_*` 工具 |
| 3 | 设置页 | 出现 **team-flowise** 分区：角色、工作流、运行 |
| 4 | 侧边栏 | 出现 **多 Agent 进度** 页签 |

第 1 条返回 404 就是没挂上——宿主日志会说明原因，最常见的是 `flowise-team` 行重复。第 1 条通了但 2 或 3 不通，说明挂上了却没贡献东西，日志同样会讲。

## 卸载

```sh
dsh plugin --profile web remove @local/team-flowise
```

从克隆装的话用 `node scripts/uninstall.mjs`——加 `--remove-skill` 连技能一起收回，而且不碰任何不是它写的东西。

之后重启 dsh，理由同前。

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
- `node validation/preflight-install.mjs` 是发布闸门：把包按每一条发布路径装进一次性 profile，再启动其中一个、把它整套 HTTP 面跑一遍。它需要联网，并会临时起一个宿主。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
