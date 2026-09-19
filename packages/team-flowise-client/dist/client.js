window.__ModuleLoader__.load({
	id: "@local/team-flowise-client",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/contract/panels.js
		/** Slot kind as declared by the owning shell package. */
		const SLOT_KINDS = {
			/** One full page per entry, rendered by the settings shell's content column. */
			settingsSection: "list",
			/** Ascending row of actions beside the per-Session title. */
			sessionHeaderActions: "list"
		};
		/** The Settings page contribution. */
		const SETTINGS_SECTION = {
			slot: "settings.section",
			kind: SLOT_KINDS.settingsSection,
			id: "team-flowise",
			order: 500,
			label: "多 Agent 团队"
		};
		/**
		* The session-header contribution.
		*
		* `order` keeps it after the shipped job list (20) and schedule catalog, and
		* before nothing — collisions are resolved by id, and this id is ours.
		*/
		const SESSION_HEADER_ACTION = {
			slot: "conversation.session.header.actions",
			kind: SLOT_KINDS.sessionHeaderActions,
			id: "team-flowise-activity",
			order: 60,
			label: "团队活动"
		};
		/** Locale namespace this package registers dictionaries under. */
		const LOCALE_NAMESPACE = "team-flowise";
		const DICTIONARIES = {
			zh: {
				"section.label": "多 Agent 团队",
				"action.refresh": "刷新",
				"action.refreshing": "刷新中…",
				"action.create": "新建",
				"action.save": "保存",
				"action.cancel": "取消",
				"action.close": "关闭",
				"action.delete": "删除",
				"action.edit": "编辑",
				"action.run": "运行",
				"action.running": "启动中…",
				"action.detail": "详情",
				"action.back": "返回",
				"action.rework": "提交返工",
				"action.retry": "重试",
				"action.viewDag": "查看 DAG",
				"state.loading": "加载中…",
				"state.empty": "暂无数据",
				"state.error": "错误",
				"state.notSelected": "未选择",
				"state.unknown": "未知",
				"tab.overview": "总览",
				"tab.agents": "Agents",
				"tab.workflows": "工作流",
				"tab.dag": "DAG 画布",
				"tab.tasks": "任务",
				"tab.runs": "运行",
				"overview.title": "多 Agent 团队",
				"overview.subtitle": "读取宿主 @local/team-flowise 的 storageDomain 数据（Agent 定义 / 任务账本 / 工作流 / 运行）。",
				"overview.stat.agents": "Agents",
				"overview.stat.workflows": "工作流",
				"overview.stat.tasksOpen": "未结算任务",
				"overview.stat.runsLive": "运行中",
				"overview.health": "宿主连通性",
				"overview.healthOk": "已连通",
				"overview.healthFail": "不可达",
				"overview.domains": "存储域",
				"overview.recentRuns": "最近运行",
				"overview.openTasks": "待处理任务",
				"agents.title": "Agent 定义",
				"agents.empty": "暂无 Agent，点击「新建 Agent」创建第一个角色。",
				"agents.new": "新建 Agent",
				"agents.edit": "编辑 Agent",
				"agents.field.name": "名称",
				"agents.field.role": "角色",
				"agents.field.systemPrompt": "系统提示",
				"agents.field.provider": "Provider",
				"agents.field.model": "模型",
				"agents.field.skills": "技能（逗号分隔）",
				"agents.field.toolsAllow": "允许工具（逗号分隔）",
				"agents.field.toolsDeny": "禁止工具（逗号分隔）",
				"agents.detail.title": "Agent 详情",
				"agents.confirmDelete": "确认删除该 Agent？",
				"agents.needName": "名称必填",
				"workflows.title": "工作流",
				"workflows.empty": "暂无工作流，点击「新建工作流」，或用节点编辑器从零搭一个 DAG。",
				"workflows.new": "新建工作流",
				"workflows.edit": "编辑工作流",
				"workflows.field.name": "名称",
				"workflows.field.description": "描述",
				"workflows.field.nodes": "节点（JSON 对象：{ \"<节点 id>\": { \"agent\": \"...\", \"dependsOn\": [\"...\"], \"taskTemplate\": { \"requirement\": \"...\" } } }）",
				"workflows.nodeCount": "{count} 个节点",
				"workflows.nodesInvalid": "nodes 必须是 JSON 对象",
				"workflows.confirmDelete": "确认删除该工作流？",
				"workflows.needName": "名称必填",
				"workflows.started": "已启动运行 {id}",
				"dag.title": "工作流 DAG",
				"dag.empty": "暂无工作流可绘制。",
				"dag.pick": "选择工作流",
				"dag.nodes": "节点",
				"dag.edges": "依赖边",
				"dag.waves": "层数",
				"dag.cycle": "检测到环依赖，环上的节点画在最后一层：{ids}",
				"dag.missingDeps": "引用了不存在的依赖：{ids}",
				"dag.noDep": "无依赖",
				"dag.legend.pending": "未执行",
				"dag.legend.completed": "成功",
				"dag.legend.failed": "失败",
				"dag.legend.edge": "依赖",
				"dag.runState": "叠加最近一次运行状态",
				"dag.canvasLabel": "工作流有向无环图",
				"tasks.title": "任务账本",
				"tasks.empty": "暂无任务。",
				"tasks.new": "新建任务",
				"tasks.field.assignee": "指派 Agent",
				"tasks.field.requirement": "需求",
				"tasks.field.acceptance": "验收标准",
				"tasks.field.reviewer": "评审人",
				"tasks.field.feedback": "返工反馈",
				"tasks.field.unassigned": "(未指派)",
				"tasks.field.none": "(无)",
				"tasks.iteration": "第 {n} 轮",
				"tasks.steps": "{count} 步",
				"tasks.needRequirement": "需求必填",
				"runs.title": "运行记录",
				"runs.empty": "暂无运行记录，可在工作流页触发一次。",
				"runs.progress": "节点进度",
				"runs.summary": "结果摘要",
				"runs.nodes": "节点状态",
				"runs.field.workflow": "工作流",
				"runs.field.started": "开始时间",
				"runs.field.ended": "结束时间",
				"runs.field.duration": "耗时",
				"runs.field.tools": "工具可见性",
				"runs.field.output": "节点输出",
				"runs.field.error": "节点错误",
				"runs.live": "运行中",
				"activity.trigger": "团队活动",
				"activity.title": "多 Agent 团队活动",
				"activity.liveRuns": "{count} 个运行进行中",
				"activity.idleRuns": "{count} 个运行记录",
				"activity.openTasks": "{count} 个任务未结算",
				"activity.blockedTasks": "{count} 个任务需返工",
				"activity.empty": "暂无团队活动。",
				"activity.openSettings": "打开设置页",
				"activity.aria": "团队活动"
			},
			en: {
				"section.label": "Multi-agent team",
				"action.refresh": "Refresh",
				"action.refreshing": "Refreshing…",
				"action.create": "Create",
				"action.save": "Save",
				"action.cancel": "Cancel",
				"action.close": "Close",
				"action.delete": "Delete",
				"action.edit": "Edit",
				"action.run": "Run",
				"action.running": "Starting…",
				"action.detail": "Details",
				"action.back": "Back",
				"action.rework": "Send back",
				"action.retry": "Retry",
				"action.viewDag": "View DAG",
				"state.loading": "Loading…",
				"state.empty": "Nothing here yet",
				"state.error": "Error",
				"state.notSelected": "Not selected",
				"state.unknown": "unknown",
				"tab.overview": "Overview",
				"tab.agents": "Agents",
				"tab.workflows": "Workflows",
				"tab.dag": "DAG canvas",
				"tab.tasks": "Tasks",
				"tab.runs": "Runs",
				"overview.title": "Multi-agent team",
				"overview.subtitle": "Reads the storageDomain data of the host plugin @local/team-flowise (agent definitions, task ledger, workflows, runs).",
				"overview.stat.agents": "Agents",
				"overview.stat.workflows": "Workflows",
				"overview.stat.tasksOpen": "Open tasks",
				"overview.stat.runsLive": "Running",
				"overview.health": "Host connectivity",
				"overview.healthOk": "reachable",
				"overview.healthFail": "unreachable",
				"overview.domains": "Storage domains",
				"overview.recentRuns": "Recent runs",
				"overview.openTasks": "Open tasks",
				"agents.title": "Agent definitions",
				"agents.empty": "No agents yet — use “New agent” to create the first role.",
				"agents.new": "New agent",
				"agents.edit": "Edit agent",
				"agents.field.name": "Name",
				"agents.field.role": "Role",
				"agents.field.systemPrompt": "System prompt",
				"agents.field.provider": "Provider",
				"agents.field.model": "Model",
				"agents.field.skills": "Skills (comma separated)",
				"agents.field.toolsAllow": "Allowed tools (comma separated)",
				"agents.field.toolsDeny": "Denied tools (comma separated)",
				"agents.detail.title": "Agent details",
				"agents.confirmDelete": "Delete this agent?",
				"agents.needName": "A name is required",
				"workflows.title": "Workflows",
				"workflows.empty": "No workflows yet — use “New workflow”, or build a DAG with the node editor.",
				"workflows.new": "New workflow",
				"workflows.edit": "Edit workflow",
				"workflows.field.name": "Name",
				"workflows.field.description": "Description",
				"workflows.field.nodes": "Nodes (JSON object: { \"<node id>\": { \"agent\": \"...\", \"dependsOn\": [\"...\"], \"taskTemplate\": { \"requirement\": \"...\" } } })",
				"workflows.nodeCount": "{count} nodes",
				"workflows.nodesInvalid": "nodes must be a JSON object",
				"workflows.confirmDelete": "Delete this workflow?",
				"workflows.needName": "A name is required",
				"workflows.started": "Started run {id}",
				"dag.title": "Workflow DAG",
				"dag.empty": "No workflow to draw.",
				"dag.pick": "Workflow",
				"dag.nodes": "Nodes",
				"dag.edges": "Edges",
				"dag.waves": "Waves",
				"dag.cycle": "Cyclic dependency detected; nodes on the cycle are drawn in the last wave: {ids}",
				"dag.missingDeps": "Depends on nodes that do not exist: {ids}",
				"dag.noDep": "no dependencies",
				"dag.legend.pending": "not run",
				"dag.legend.completed": "succeeded",
				"dag.legend.failed": "failed",
				"dag.legend.edge": "dependency",
				"dag.runState": "Overlay the latest run state",
				"dag.canvasLabel": "Workflow directed acyclic graph",
				"tasks.title": "Task ledger",
				"tasks.empty": "No tasks yet.",
				"tasks.new": "New task",
				"tasks.field.assignee": "Assignee",
				"tasks.field.requirement": "Requirement",
				"tasks.field.acceptance": "Acceptance criteria",
				"tasks.field.reviewer": "Reviewer",
				"tasks.field.feedback": "Rework feedback",
				"tasks.field.unassigned": "(unassigned)",
				"tasks.field.none": "(none)",
				"tasks.iteration": "iteration {n}",
				"tasks.steps": "{count} steps",
				"tasks.needRequirement": "A requirement is required",
				"runs.title": "Runs",
				"runs.empty": "No runs recorded yet — start one from the Workflows tab.",
				"runs.progress": "Node progress",
				"runs.summary": "Result summary",
				"runs.nodes": "Node states",
				"runs.field.workflow": "Workflow",
				"runs.field.started": "Started",
				"runs.field.ended": "Ended",
				"runs.field.duration": "Duration",
				"runs.field.tools": "Tool visibility",
				"runs.field.output": "Node output",
				"runs.field.error": "Node error",
				"runs.live": "running",
				"activity.trigger": "Team activity",
				"activity.title": "Multi-agent team activity",
				"activity.liveRuns": "{count} run(s) in flight",
				"activity.idleRuns": "{count} run record(s)",
				"activity.openTasks": "{count} task(s) still open",
				"activity.blockedTasks": "{count} task(s) need rework",
				"activity.empty": "No team activity yet.",
				"activity.openSettings": "Open the settings page",
				"activity.aria": "Team activity"
			}
		};
		/** Locale namespaces this package answers for, in preference order. */
		const LOCALE_FALLBACKS = ["zh", "en"];
		/**
		* Interpolate `{name}` placeholders.
		*
		* @param template - dictionary value.
		* @param params - replacement map; missing keys leave the placeholder intact.
		* @returns the rendered string.
		*/
		function format(template, params) {
			if (params === void 0 || params === null) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => {
				const value = params[key];
				return value === void 0 || value === null ? match : String(value);
			});
		}
		/**
		* Build a translator over a dictionary table.
		*
		* @param table - `{ zh, en }` dictionary map.
		* @param locale - requested locale; the first {@link LOCALE_FALLBACKS} entry whose
		*   dictionary contains the key wins, then the key itself.
		* @returns `(key, params?) => string`.
		*/
		function createTranslator(table, locale) {
			const dictionaries = table === void 0 || table === null ? DICTIONARIES : table;
			const preferred = [];
			if (typeof locale === "string" && locale !== "") preferred.push(locale);
			for (const fallback of LOCALE_FALLBACKS) if (preferred.indexOf(fallback) === -1) preferred.push(fallback);
			for (const key of Object.keys(dictionaries)) if (preferred.indexOf(key) === -1) preferred.push(key);
			return (key, params) => {
				for (const name of preferred) {
					const dictionary = dictionaries[name];
					if (dictionary !== void 0 && typeof dictionary[key] === "string") return format(dictionary[key], params);
				}
				return format(String(key), params);
			};
		}
		//#endregion
		//#region src/contract/domain.js
		/** Task ledger lifecycle, as ordered board columns. */
		const TASK_COLUMNS = [
			{
				key: "queued",
				label: "已排队",
				tone: "neutral"
			},
			{
				key: "submitted",
				label: "已提交",
				tone: "warn"
			},
			{
				key: "working",
				label: "进行中",
				tone: "business"
			},
			{
				key: "completed",
				label: "已完成",
				tone: "success"
			},
			{
				key: "reworked",
				label: "需返工",
				tone: "error"
			},
			{
				key: "settle",
				label: "已结算",
				tone: "dimmed"
			}
		];
		/** Run lifecycle. `interrupted` is what the host's startup reap writes. */
		const RUN_STATUSES = [
			{
				key: "running",
				label: "运行中",
				tone: "business"
			},
			{
				key: "completed",
				label: "已完成",
				tone: "success"
			},
			{
				key: "failed",
				label: "失败",
				tone: "error"
			},
			{
				key: "cancelled",
				label: "已取消",
				tone: "dimmed"
			},
			{
				key: "interrupted",
				label: "已中断",
				tone: "warn"
			}
		];
		/** Per-node run state. The host writes exactly these two. */
		const NODE_STATUSES = [
			{
				key: "pending",
				label: "待执行",
				tone: "neutral"
			},
			{
				key: "completed",
				label: "成功",
				tone: "success"
			},
			{
				key: "failed",
				label: "失败",
				tone: "error"
			}
		];
		/** Tone → CSS custom property suffix used by the stylesheet. */
		const TONE_VARS = {
			neutral: "label-tertiary",
			dimmed: "label-dimmed",
			business: "state-business-primary",
			warn: "state-warn-primary",
			error: "state-error-primary",
			success: "state-success-primary"
		};
		/** The five tabs of the Settings section page, in display order. */
		const SECTION_TABS = [
			{
				key: "overview",
				label: "总览"
			},
			{
				key: "agents",
				label: "Agents"
			},
			{
				key: "workflows",
				label: "工作流"
			},
			{
				key: "dag",
				label: "DAG 画布"
			},
			{
				key: "tasks",
				label: "任务"
			},
			{
				key: "runs",
				label: "运行"
			}
		];
		/**
		* Find the display entry for a status key.
		*
		* @param table - one of {@link TASK_COLUMNS}, {@link RUN_STATUSES}, {@link NODE_STATUSES}.
		* @param key - status key as stored by the host.
		* @returns the entry, or a synthesised fallback so an unknown status still renders.
		*/
		function statusEntry(table, key) {
			for (const entry of table) if (entry.key === key) return entry;
			const text = key === void 0 || key === null || key === "" ? "未知" : String(key);
			return {
				key: text,
				label: text,
				tone: "neutral"
			};
		}
		/**
		* Pick the leaf fields of an Agent definition that the UI actually renders.
		*
		* Live host records are never forwarded whole: a definition is reduced to the
		* scalars this package draws, so nothing host-owned leaks into React state.
		*
		* @param raw - one record from `GET /agents`.
		* @returns a plain display object, or `null` when the input is not an object.
		*/
		function pickAgent(raw) {
			if (raw === null || typeof raw !== "object") return null;
			const model = raw.model !== null && typeof raw.model === "object" ? raw.model : {};
			const tools = raw.tools !== null && typeof raw.tools === "object" ? raw.tools : {};
			const allow = Array.isArray(tools.allow) ? tools.allow.map(String) : [];
			const deny = Array.isArray(tools.deny) ? tools.deny.map(String) : [];
			const skills = Array.isArray(raw.skills) ? raw.skills.map(String) : [];
			return {
				id: String(raw.id === void 0 ? "" : raw.id),
				name: String(raw.name === void 0 || raw.name === "" ? raw.id === void 0 ? "" : raw.id : raw.name),
				role: String(raw.role === void 0 ? "" : raw.role),
				systemPrompt: String(raw.systemPrompt === void 0 ? "" : raw.systemPrompt),
				provider: String(model.provider === void 0 ? "" : model.provider),
				model: String(model.model === void 0 ? "" : model.model),
				skills,
				allow,
				deny,
				updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0
			};
		}
		/**
		* Reduce one workflow record to the fields the list, canvas, and editor use.
		*
		* @param raw - one record from `GET /workflows`.
		* @returns a plain display object, or `null` when the input is not an object.
		*/
		function pickWorkflow(raw) {
			if (raw === null || typeof raw !== "object") return null;
			const rawNodes = raw.nodes !== null && typeof raw.nodes === "object" ? raw.nodes : {};
			const nodes = [];
			for (const key of Object.keys(rawNodes)) {
				const node = rawNodes[key];
				if (node === null || typeof node !== "object") continue;
				const template = node.taskTemplate !== null && typeof node.taskTemplate === "object" ? node.taskTemplate : {};
				nodes.push({
					id: String(node.id === void 0 || node.id === "" ? key : node.id),
					agent: String(node.agent === void 0 ? "" : node.agent),
					reviewer: String(node.reviewer === void 0 ? "" : node.reviewer),
					mode: String(node.mode === void 0 ? "once" : node.mode),
					dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map(String) : [],
					requirement: String(template.requirement === void 0 ? "" : template.requirement),
					acceptanceCriteria: String(template.acceptanceCriteria === void 0 ? "" : template.acceptanceCriteria)
				});
			}
			return {
				id: String(raw.id === void 0 ? "" : raw.id),
				name: String(raw.name === void 0 || raw.name === "" ? raw.id === void 0 ? "" : raw.id : raw.name),
				description: String(raw.description === void 0 ? "" : raw.description),
				nodes,
				updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0
			};
		}
		/**
		* Reduce one ledger task, decoding the iteration history into scalars only.
		*
		* @param raw - one record from `GET /tasks`.
		* @returns a plain display object, or `null` when the input is not an object.
		*/
		function pickTask(raw) {
			if (raw === null || typeof raw !== "object") return null;
			const history = Array.isArray(raw.history) ? raw.history : [];
			return {
				id: String(raw.id === void 0 ? "" : raw.id),
				workflowId: String(raw.workflowId === void 0 ? "" : raw.workflowId),
				nodeId: String(raw.nodeId === void 0 ? "" : raw.nodeId),
				assignee: String(raw.assignee === void 0 ? "" : raw.assignee),
				reviewer: String(raw.reviewer === void 0 ? "" : raw.reviewer),
				requirement: String(raw.requirement === void 0 ? "" : raw.requirement),
				acceptanceCriteria: String(raw.acceptanceCriteria === void 0 ? "" : raw.acceptanceCriteria),
				status: String(raw.status === void 0 ? "queued" : raw.status),
				iteration: typeof raw.iteration === "number" ? raw.iteration : 0,
				output: typeof raw.output === "string" ? raw.output : "",
				feedback: typeof raw.feedback === "string" ? raw.feedback : "",
				steps: history.map((step) => ({
					iteration: typeof step.iteration === "number" ? step.iteration : 0,
					status: String(step.status === void 0 ? "" : step.status),
					at: typeof step.at === "number" ? step.at : 0,
					feedback: typeof step.feedback === "string" ? step.feedback : ""
				})),
				createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
				updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0
			};
		}
		/**
		* Reduce one run, keeping only per-node scalars.
		*
		* The host stores a node's `output` and `tools` note alongside its status; only
		* short scalar forms are kept so a large node payload never lands in React state.
		*
		* @param raw - one record from `GET /runs` or `GET /run?id=`.
		* @returns a plain display object, or `null` when the input is not an object.
		*/
		function pickRun(raw) {
			if (raw === null || typeof raw !== "object") return null;
			const states = raw.nodeStates !== null && typeof raw.nodeStates === "object" ? raw.nodeStates : {};
			const nodes = [];
			for (const key of Object.keys(states)) {
				const state = states[key];
				if (state === null || typeof state !== "object") continue;
				nodes.push({
					id: String(key),
					status: String(state.status === void 0 ? "pending" : state.status),
					assignee: String(state.assignee === void 0 ? "" : state.assignee),
					output: typeof state.output === "string" ? state.output.slice(0, 400) : "",
					error: typeof state.error === "string" ? state.error.slice(0, 400) : "",
					tools: typeof state.tools === "string" ? state.tools : ""
				});
			}
			const result = raw.result !== null && typeof raw.result === "object" ? raw.result : {};
			return {
				id: String(raw.id === void 0 ? "" : raw.id),
				workflowId: String(raw.workflowId === void 0 ? "" : raw.workflowId),
				status: String(raw.status === void 0 ? "running" : raw.status),
				nodes,
				summary: typeof result.summary === "string" ? result.summary : "",
				startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
				endedAt: typeof raw.endedAt === "number" ? raw.endedAt : 0
			};
		}
		/**
		* Percentage of a run's nodes that reached a terminal success state.
		*
		* @param run - a value from {@link pickRun}.
		* @returns an integer 0–100; 0 when the run has no nodes yet.
		*/
		function runProgress(run) {
			if (run === null || run === void 0 || !Array.isArray(run.nodes) || run.nodes.length === 0) return 0;
			let done = 0;
			for (const node of run.nodes) if (node.status === "completed") done += 1;
			return Math.round(done / run.nodes.length * 100);
		}
		//#endregion
		//#region src/contract/routes.js
		/** Route prefix owned by the host half. */
		const API_BASE = "/api/team-flowise";
		/** The four durable storage domains the host opens. */
		const DOMAINS = [
			"team_agent_defs",
			"team_ledger",
			"team_workflows",
			"team_runs"
		];
		/**
		* Full route table. `id` is the stable key the client calls by, so a path change
		* on the host is a one-line edit here instead of a hunt through components.
		*/
		const ROUTES = [
			{
				id: "ping",
				method: "GET",
				path: "/ping",
				summary: "Connectivity and the composed domain list."
			},
			{
				id: "agents.list",
				method: "GET",
				path: "/agents",
				summary: "Every stored Agent definition."
			},
			{
				id: "agents.upsert",
				method: "POST",
				path: "/agent",
				summary: "Create or update an Agent definition (body = definition)."
			},
			{
				id: "agents.delete",
				method: "DELETE",
				path: "/agent",
				summary: "Delete an Agent definition (query: id)."
			},
			{
				id: "workflows.list",
				method: "GET",
				path: "/workflows",
				summary: "Every stored workflow."
			},
			{
				id: "workflows.upsert",
				method: "POST",
				path: "/workflow",
				summary: "Create or update a workflow (body = definition)."
			},
			{
				id: "workflows.delete",
				method: "DELETE",
				path: "/workflow",
				summary: "Delete a workflow (query: id)."
			},
			{
				id: "tasks.list",
				method: "GET",
				path: "/tasks",
				summary: "Every task on the ledger."
			},
			{
				id: "tasks.create",
				method: "POST",
				path: "/task/create",
				summary: "Create a task by hand."
			},
			{
				id: "tasks.rework",
				method: "POST",
				path: "/task/rework",
				summary: "Send a task back for rework (body: { id, feedback })."
			},
			{
				id: "runs.list",
				method: "GET",
				path: "/runs",
				summary: "Every recorded run."
			},
			{
				id: "runs.get",
				method: "GET",
				path: "/run",
				summary: "One run, including per-node state (query: id)."
			},
			{
				id: "runs.start",
				method: "POST",
				path: "/run/start",
				summary: "Start a run (body: { workflowId, input }). Answers as soon as the id exists."
			}
		];
		/**
		* Build the concrete request path for a route id, appending encoded query values.
		*
		* @param id - route id from {@link ROUTES}.
		* @param query - optional query pairs; `undefined`/`null` values are dropped.
		* @returns the path including {@link API_BASE}, or `undefined` for an unknown id.
		*/
		function routeUrl(id, query) {
			let found;
			for (const route of ROUTES) if (route.id === id) {
				found = route;
				break;
			}
			if (found === void 0) return void 0;
			let url = API_BASE + found.path;
			if (query !== void 0 && query !== null) {
				const parts = [];
				for (const key of Object.keys(query)) {
					const value = query[key];
					if (value === void 0 || value === null || value === "") continue;
					parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
				}
				if (parts.length > 0) url += "?" + parts.join("&");
			}
			return url;
		}
		//#endregion
		//#region src/client/api.js
		/** Default per-request ceiling. A hung request must surface as an error, not a spinner. */
		const REQUEST_TIMEOUT_MS = 15e3;
		/** Build a `{ status, code }` error with a message the UI can show verbatim. */
		function apiError(message, extra) {
			const error = new Error(message);
			error.name = "TeamApiError";
			if (extra !== void 0) {
				if (extra.status !== void 0) error.status = extra.status;
				if (extra.code !== void 0) error.code = extra.code;
			}
			return error;
		}
		/** Human-readable text for any thrown value. */
		function describeError(error) {
			if (error === null || error === void 0) return "未知错误";
			if (typeof error === "string") return error;
			if (typeof error.message === "string" && error.message !== "") return error.message;
			return String(error);
		}
		/**
		* Create a host API client.
		*
		* @param options - optional overrides:
		*   `base` (default {@link API_BASE}), `timeoutMs`, and `fetch` (injected for tests).
		* @returns `{ request, getJson, ping, listAgents, upsertAgent, deleteAgent, ... }`.
		* @throws when no fetch implementation is reachable.
		*/
		function createTeamApi(options) {
			const config = options === void 0 || options === null ? {} : options;
			const base = typeof config.base === "string" && config.base !== "" ? config.base : API_BASE;
			const timeoutMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : REQUEST_TIMEOUT_MS;
			const fetchImpl = config.fetch !== void 0 ? config.fetch : globalThis.fetch;
			if (typeof fetchImpl !== "function") throw apiError("team-flowise: no fetch implementation available in this environment");
			/** Absolute URL from a route id and query, honouring a non-default base. */
			const url = (id, query) => {
				const path = routeUrl(id, query);
				if (path === void 0) throw apiError("team-flowise: unknown route id \"" + String(id) + "\"");
				return base === "/api/team-flowise" ? path : base + path.slice(17);
			};
			/**
			* One request. The response body is parsed as JSON; the `{ ok, error }`
			* envelope the host writes for failures is unwrapped into a thrown error so
			* callers never branch on a payload shape.
			*
			* @param routeId - id from {@link ROUTES}.
			* @param init - optional `method` and `body` (JSON-serialised here).
			* @param query - optional query pairs.
			* @returns the parsed payload.
			*/
			const request = async (routeId, init, query) => {
				const method = init !== void 0 && typeof init.method === "string" ? init.method : "GET";
				const controller = typeof AbortController === "function" ? new AbortController() : void 0;
				let timer;
				if (controller !== void 0) timer = setTimeout(() => controller.abort(), timeoutMs);
				let response;
				try {
					response = await fetchImpl(url(routeId, query), {
						method,
						headers: init !== void 0 && init.body !== void 0 ? { "Content-Type": "application/json" } : void 0,
						body: init !== void 0 && init.body !== void 0 ? JSON.stringify(init.body) : void 0,
						signal: controller === void 0 ? void 0 : controller.signal
					});
				} catch (error) {
					if (error !== null && typeof error === "object" && error.name === "AbortError") throw apiError("team-flowise: request timed out after " + timeoutMs + "ms (" + routeId + ")", { code: "timeout" });
					throw apiError("team-flowise: request failed (" + routeId + "): " + describeError(error), { code: "network" });
				} finally {
					if (timer !== void 0) clearTimeout(timer);
				}
				let payload;
				const text = await response.text();
				if (text !== "") try {
					payload = JSON.parse(text);
				} catch {
					throw apiError("team-flowise: " + routeId + " returned a non-JSON body", {
						status: response.status,
						code: "bad-json"
					});
				}
				if (!response.ok) {
					const detail = payload !== null && typeof payload === "object" && typeof payload.error === "string" ? ": " + payload.error : "";
					throw apiError("team-flowise: " + routeId + " failed with HTTP " + String(response.status) + detail, {
						status: response.status,
						code: "http"
					});
				}
				if (payload !== null && typeof payload === "object" && payload.ok === false) throw apiError("team-flowise: " + routeId + " refused: " + String(payload.error === void 0 ? "unknown" : payload.error), { code: "refused" });
				return payload;
			};
			/** First array found under `key`, else an empty array. Keeps a bad payload from crashing a tab. */
			const arrayAt = (payload, key) => payload !== null && typeof payload === "object" && Array.isArray(payload[key]) ? payload[key] : [];
			return {
				base,
				timeoutMs,
				request,
				url,
				routes: ROUTES,
				ping: () => request("ping"),
				listAgents: async () => arrayAt(await request("agents.list"), "agents"),
				upsertAgent: async (definition) => {
					const payload = await request("agents.upsert", {
						method: "POST",
						body: definition
					});
					return payload !== null && typeof payload === "object" ? payload.agent : void 0;
				},
				deleteAgent: (id) => request("agents.delete", { method: "DELETE" }, { id }),
				listWorkflows: async () => arrayAt(await request("workflows.list"), "workflows"),
				upsertWorkflow: async (definition) => {
					const payload = await request("workflows.upsert", {
						method: "POST",
						body: definition
					});
					return payload !== null && typeof payload === "object" ? payload.workflow : void 0;
				},
				deleteWorkflow: (id) => request("workflows.delete", { method: "DELETE" }, { id }),
				listTasks: async () => arrayAt(await request("tasks.list"), "tasks"),
				createTask: async (spec) => {
					const payload = await request("tasks.create", {
						method: "POST",
						body: spec
					});
					return payload !== null && typeof payload === "object" ? payload.task : void 0;
				},
				reworkTask: async (id, feedback) => {
					const payload = await request("tasks.rework", {
						method: "POST",
						body: {
							id,
							feedback
						}
					});
					return payload !== null && typeof payload === "object" ? payload.task : void 0;
				},
				listRuns: async () => arrayAt(await request("runs.list"), "runs"),
				getRun: async (id) => {
					const payload = await request("runs.get", void 0, { id });
					return payload !== null && typeof payload === "object" ? payload.run : void 0;
				},
				startRun: async (workflowId, input) => {
					const payload = await request("runs.start", {
						method: "POST",
						body: {
							workflowId,
							input: input === void 0 ? {} : input
						}
					});
					return payload !== null && typeof payload === "object" ? payload.run : void 0;
				}
			};
		}
		//#endregion
		//#region src/client/store.js
		/** In-flight ceiling. The host answers quickly; a long poll interval is enough. */
		const POLL_INTERVAL_MS = 6e3;
		/** Initial state: no data, no error, not loading. */
		function emptyState() {
			return {
				agents: [],
				workflows: [],
				tasks: [],
				runs: [],
				loading: false,
				refreshing: false,
				errors: {},
				health: "unknown",
				domains: [],
				lastLoadedAt: 0,
				revision: 0
			};
		}
		/**
		* Reduce a raw payload list to display records.
		*
		* @param list - raw array from the API.
		* @param pick - one of the `pick*` reducers.
		* @returns display records; entries that are not objects are dropped.
		*/
		function reduceList(list, pick) {
			if (!Array.isArray(list)) return [];
			const out = [];
			for (const item of list) {
				const picked = pick(item);
				if (picked !== null) out.push(picked);
			}
			return out;
		}
		/** Count the tasks the host still considers open (everything before `settle`). */
		function openTaskCount(tasks) {
			let count = 0;
			for (const task of tasks) if (task.status !== "settle") count += 1;
			return count;
		}
		/** Count the runs the host is still driving. */
		function liveRunCount(runs) {
			let count = 0;
			for (const run of runs) if (run.status === "running") count += 1;
			return count;
		}
		/** Newest-first copy, by `startedAt`/`createdAt`, without mutating the input. */
		function newestFirst(list, field) {
			return list.slice().sort((a, b) => (b[field] || 0) - (a[field] || 0));
		}
		/**
		* Create a store. One instance is created per module materialization.
		*
		* @param options - `{ api, fetch }`; `api` defaults to a real HTTP client and
		*   `fetch` is forwarded to it (injected in tests).
		* @returns the store handle.
		*/
		function createTeamStore(options) {
			const config = options === void 0 || options === null ? {} : options;
			const api = config.api !== void 0 ? config.api : createTeamApi({ fetch: config.fetch });
			let state = emptyState();
			const listeners = /* @__PURE__ */ new Set();
			const t = createTranslator(DICTIONARIES, "zh");
			const notify = () => {
				for (const listener of listeners) try {
					listener();
				} catch {}
			};
			/** Replace state and notify, but only when `next` is a different object. */
			const commit = (next) => {
				if (next === state) return;
				state = next;
				notify();
			};
			/** Patch one slice of state. */
			const patch = (partial) => {
				commit(Object.assign({}, state, partial, { revision: state.revision + 1 }));
			};
			const recordError = (key, error) => {
				const errors = Object.assign({}, state.errors);
				errors[key] = describeError(error);
				return errors;
			};
			/**
			* Reload every slice. Concurrent calls collapse onto the first one, so a poll
			* tick and a user click cannot double-fetch.
			*
			* @returns a promise settling when the refresh finished.
			*/
			let inFlight = null;
			const refresh = () => {
				if (inFlight !== null) return inFlight;
				patch({
					loading: state.lastLoadedAt === 0,
					refreshing: state.lastLoadedAt !== 0
				});
				inFlight = Promise.all([
					api.listAgents(),
					api.listWorkflows(),
					api.listTasks(),
					api.listRuns()
				]).then(([agents, workflows, tasks, runs]) => patch({
					agents: reduceList(agents, pickAgent),
					workflows: reduceList(workflows, pickWorkflow),
					tasks: reduceList(tasks, pickTask),
					runs: reduceList(runs, pickRun),
					errors: {},
					health: "ok",
					domains: DOMAINS.slice(),
					lastLoadedAt: Date.now(),
					loading: false,
					refreshing: false
				})).catch((error) => {
					patch({
						errors: recordError("all", error),
						health: "down",
						loading: false,
						refreshing: false
					});
				}).finally(() => {
					inFlight = null;
				});
				return inFlight;
			};
			/**
			* Run one write, then reload. The error is returned instead of thrown so a
			* component can render it without its own try/catch.
			*
			* @param key - slice name used as the error key.
			* @param action - the write to perform.
			* @returns `{ ok, error? }`.
			*/
			const mutate = async (key, action) => {
				patch({ loading: true });
				try {
					const value = await action();
					await refresh();
					return {
						ok: true,
						value
					};
				} catch (error) {
					patch({
						errors: recordError(key, error),
						loading: false,
						refreshing: false
					});
					return {
						ok: false,
						error: describeError(error)
					};
				}
			};
			/** Find a record by id in one slice. */
			const find = (slice, id) => {
				for (const item of state[slice]) if (item.id === id) return item;
			};
			/** A static DAG view of one workflow, for the canvas. */
			const workflowById = (id) => find("workflows", id);
			return {
				api,
				t,
				/** A translator for another locale, sharing this store's dictionary table. */
				translatorFor: (locale) => createTranslator(DICTIONARIES, locale),
				tabs: SECTION_TABS,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getState: () => state,
				refresh,
				mutate,
				find,
				workflowById,
				runProgress,
				liveRunCount: () => liveRunCount(state.runs),
				openTaskCount: () => openTaskCount(state.tasks),
				newestRuns: (limit) => newestFirst(state.runs, "startedAt").slice(0, limit === void 0 ? 5 : limit),
				newestTasks: (limit) => newestFirst(state.tasks, "updatedAt").slice(0, limit === void 0 ? 5 : limit),
				actions: {
					saveAgent: (definition) => mutate("agent", () => api.upsertAgent(definition)),
					deleteAgent: (id) => mutate("agent", () => api.deleteAgent(id)),
					saveWorkflow: (definition) => mutate("workflow", () => api.upsertWorkflow(definition)),
					deleteWorkflow: (id) => mutate("workflow", () => api.deleteWorkflow(id)),
					createTask: (spec) => mutate("task", () => api.createTask(spec)),
					reworkTask: (id, feedback) => mutate("task", () => api.reworkTask(id, feedback)),
					startRun: (workflowId, input) => mutate("run", () => api.startRun(workflowId, input))
				}
			};
		}
		//#endregion
		//#region src/client/styles.js
		const STYLE_TAG_ID = "@local/team-flowise-client/styles.css";
		const CSS = [
			".tfc-root{--tfc-gap:10px;--tfc-radius:10px;font-family:var(--dsw-font-family,var(--dsw-alias-font-sans,system-ui,-apple-system,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif));color:var(--dsw-alias-label-primary,#0f1115);font-size:13px;line-height:20px;display:flex;flex-direction:column;gap:var(--tfc-gap);min-width:0}",
			".tfc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".tfc-row-between{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
			".tfc-col{display:flex;flex-direction:column;gap:8px;min-width:0}",
			".tfc-grow{flex:1;min-width:0}",
			".tfc-muted{color:var(--dsw-alias-label-tertiary,#81858c)}",
			".tfc-dim{color:var(--dsw-alias-label-dimmed,#a8adb4)}",
			".tfc-title{font-size:15px;line-height:24px;font-weight:600;margin:0}",
			".tfc-subtitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);margin:0}",
			".tfc-caption{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption,#8b9098)}",
			".tfc-card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:var(--tfc-radius);padding:12px;min-width:0}",
			".tfc-card-l2{background:var(--dsw-alias-bg-layer-2,#f6f7f8)}",
			".tfc-btn{font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;white-space:nowrap}",
			".tfc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}",
			".tfc-btn:disabled{opacity:.5;cursor:default}",
			".tfc-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,#0f1115));border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff)}",
			".tfc-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#33373d)}",
			".tfc-btn-danger{color:var(--dsw-alias-state-error-primary,#d92d20);border-color:var(--dsw-alias-border-l2,rgb(0 0 0 / 16%))}",
			".tfc-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgb(217 45 32 / 8%))}",
			".tfc-btn-ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%));color:var(--dsw-alias-label-primary,#0f1115)}",
			".tfc-btn-icon{padding:3px 7px;font-size:13px;line-height:18px}",
			".tfc-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));padding-bottom:6px}",
			".tfc-tab{font:inherit;font-size:12px;line-height:18px;padding:4px 12px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}",
			".tfc-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}",
			".tfc-tab-active{background:var(--dsw-alias-interactive-bg-active,rgb(0 0 0 / 7%));color:var(--dsw-alias-label-primary,#0f1115);font-weight:600}",
			".tfc-field{display:flex;flex-direction:column;gap:4px;min-width:0}",
			".tfc-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-input,.tfc-textarea,.tfc-select{font:inherit;font-size:12px;line-height:18px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);width:100%;box-sizing:border-box}",
			".tfc-textarea{min-height:66px;resize:vertical;font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);line-height:18px}",
			".tfc-input:focus,.tfc-textarea:focus,.tfc-select:focus{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-1px}",
			".tfc-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));white-space:nowrap;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}",
			".tfc-chip{display:inline-flex;align-items:center;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 6%));color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}",
			".tfc-list{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".tfc-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));background:var(--dsw-alias-bg-layer-1,#fff);min-width:0}",
			".tfc-item:hover{border-color:var(--dsw-alias-border-l3,rgb(0 0 0 / 22%))}",
			".tfc-item-selectable{cursor:pointer}",
			".tfc-item-on{border-color:var(--dsw-alias-brand-primary,#0f1115)}",
			".tfc-item-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
			".tfc-item-title{font-size:12px;line-height:18px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".tfc-item-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#81858c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".tfc-empty{padding:14px;border:1px dashed var(--dsw-alias-border-l2,rgb(0 0 0 / 16%));border-radius:var(--tfc-radius);color:var(--dsw-alias-label-tertiary,#81858c);font-size:12px;text-align:center}",
			".tfc-error{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-error-primary,#d92d20);color:var(--dsw-alias-state-error-primary,#d92d20);font-size:12px;white-space:pre-wrap;word-break:break-word}",
			".tfc-notice{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-success-primary,#067647);color:var(--dsw-alias-state-success-primary,#067647);font-size:12px}",
			".tfc-warn{padding:8px 10px;border-radius:var(--tfc-radius);border:1px solid var(--dsw-alias-state-warn-primary,#b54708);color:var(--dsw-alias-state-warn-label,#b54708);font-size:12px}",
			".tfc-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 8%));overflow:hidden;width:100%}",
			".tfc-bar-fill{height:100%;background:var(--dsw-alias-state-business-primary,#175cd3);border-radius:999px}",
			".tfc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px}",
			".tfc-stat{padding:10px;border-radius:var(--tfc-radius);background:var(--dsw-alias-bg-layer-2,#f6f7f8);display:flex;flex-direction:column;gap:2px}",
			".tfc-stat-value{font-size:20px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}",
			".tfc-stat-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-board{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:6px}",
			".tfc-col-item{min-width:196px;flex:0 0 196px;background:var(--dsw-alias-bg-layer-2,#f6f7f8);border-radius:var(--tfc-radius);padding:8px;display:flex;flex-direction:column;gap:6px}",
			".tfc-col-head{display:flex;align-items:center;justify-content:space-between;gap:6px}",
			".tfc-col-title{font-size:11px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-mini{font-size:12px;line-height:18px;padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));cursor:pointer;display:flex;flex-direction:column;gap:3px}",
			".tfc-modal{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgb(0 0 0 / 40%));display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}",
			".tfc-modal-card{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);border-radius:14px;padding:16px;width:min(560px,100%);max-height:82vh;overflow:auto;box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 24%));display:flex;flex-direction:column;gap:10px}",
			".tfc-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}",
			".tfc-modal-title{font-size:14px;line-height:22px;font-weight:600;margin:0}",
			".tfc-panel{position:absolute;top:calc(100% + 6px);right:0;width:336px;max-width:min(400px,100vw - 32px);max-height:min(460px,100vh - 160px);overflow:auto;background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#0f1115);border-radius:16px;box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgb(0 0 0 / 24%));padding:8px;display:flex;flex-direction:column;gap:6px;z-index:50}",
			".tfc-trigger{position:relative;display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:12px;line-height:18px;min-height:28px;padding:3px 4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}",
			".tfc-trigger:hover{color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}",
			".tfc-trigger-on{color:var(--dsw-alias-label-primary,#0f1115)}",
			".tfc-panel-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;font-size:12px;line-height:18px}",
			".tfc-panel-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgb(0 0 0 / 4%))}",
			".tfc-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px}",
			".tfc-canvas-wrap{position:relative;overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgb(0 0 0 / 10%));border-radius:var(--tfc-radius);background:var(--dsw-alias-bg-layer-1,#fff)}",
			".tfc-canvas{display:block;width:100%}",
			".tfc-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#61666b)}",
			".tfc-legend-item{display:inline-flex;align-items:center;gap:5px}",
			".tfc-swatch{width:10px;height:10px;border-radius:3px;border:1px solid var(--dsw-alias-border-l2,rgb(0 0 0 / 16%))}",
			".tfc-node-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(212px,1fr));gap:8px}",
			".tfc-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;min-width:0}",
			".tfc-kv-key{color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap}",
			".tfc-kv-val{min-width:0;word-break:break-word}",
			".tfc-pre{margin:0;padding:8px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2,#f6f7f8));color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);font-size:11px;line-height:17px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word}",
			".tfc-spin{animation:tfc-spin 1s linear infinite;display:inline-block}",
			"@keyframes tfc-spin{to{transform:rotate(360deg)}}",
			".tfc-code{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,Consolas,monospace);font-size:11px}"
		].join("\n");
		/**
		* Inject the stylesheet once, tagged for the client module system to claim.
		*
		* @param doc - a `Document`; pass `undefined` on a non-DOM platform to no-op.
		* @returns a disposer removing the tag this call created, or a no-op disposer.
		*/
		function injectStyles(doc) {
			const target = doc === void 0 ? typeof document === "undefined" ? void 0 : document : doc;
			if (target === void 0 || target === null || typeof target.createElement !== "function") return () => {};
			if (target.querySelector("style[data-plugin-css=" + JSON.stringify("@local/team-flowise-client/styles.css") + "]") !== null) return () => {};
			const tag = target.createElement("style");
			tag.setAttribute("data-plugin", "@local/team-flowise-client");
			tag.setAttribute("data-plugin-css", STYLE_TAG_ID);
			tag.textContent = CSS;
			target.head.appendChild(tag);
			return () => {
				if (tag.parentNode !== null && tag.parentNode !== void 0) tag.parentNode.removeChild(tag);
			};
		}
		//#endregion
		//#region src/client/context.js
		const TeamContext = react.createContext(null);
		/**
		* Provide the store and translator to a surface's subtree.
		*
		* @param props - `{ store, children }`.
		* @returns the provider element.
		*/
		function TeamProvider(props) {
			const store = props === void 0 || props === null ? void 0 : props.store;
			const value = react.useMemo(() => ({
				store,
				t: store === void 0 || store === null ? void 0 : store.t
			}), [store]);
			const children = props === void 0 || props === null ? void 0 : props.children;
			return react.createElement(TeamContext.Provider, { value }, children);
		}
		/**
		* Read the nearest store.
		*
		* The context value is `{ store, t }` — the provider carries the translator
		* alongside the store so a surface never has to build one. Every caller here
		* wants the STORE (it calls `getState`, `subscribe`, `refresh`), so this hook
		* unwraps it: returning the whole context value made `store.getState` a property
		* of a plain object, and the settings page threw on its first render.
		*
		* @returns the store, or `undefined` when rendered outside a provider.
		*/
		function useStore() {
			const value = react.useContext(TeamContext);
			return value === void 0 || value === null ? void 0 : value.store;
		}
		/**
		* Subscribe to the store snapshot.
		*
		* @returns the current team state, or `undefined` outside a provider.
		*/
		function useTeamState() {
			const store = useStore();
			const subscribe = react.useCallback((listener) => store === void 0 || store === null ? () => {} : store.subscribe(listener), [store]);
			const getSnapshot = react.useCallback(() => store === void 0 || store === null ? EMPTY_SNAPSHOT : store.getState(), [store]);
			return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
		}
		/** Stable fallback snapshot, so `useSyncExternalStore` never returns a new object. */
		const EMPTY_SNAPSHOT = {
			agents: [],
			workflows: [],
			tasks: [],
			runs: [],
			loading: false,
			refreshing: false,
			errors: {},
			health: "unknown",
			domains: [],
			lastLoadedAt: 0,
			revision: 0
		};
		/**
		* Translator bound to the active locale.
		*
		* @param locale - an optional locale observed from the shell; when absent, the
		*   store's default (Simplified Chinese) dictionary is used.
		* @returns `(key, params?) => string`.
		*/
		function useTranslate(locale) {
			const store = useStore();
			return react.useMemo(() => {
				if (store === void 0 || store === null) return (key) => String(key);
				if (typeof locale !== "string" || locale === "" || locale.indexOf("zh") === 0) return store.t;
				return store.translatorFor(locale);
			}, [store, locale]);
		}
		/**
		* Load on mount, then poll while the surface is mounted.
		*
		* The returned `refresh` is the shared store refresh, so a manual click and a
		* poll tick cannot fetch twice.
		*
		* @param intervalMs - poll period; `0` disables polling.
		* @returns the shared `refresh` function.
		*/
		function usePolling(intervalMs) {
			const store = useStore();
			const refresh = react.useCallback(() => store === void 0 || store === null ? Promise.resolve() : store.refresh(), [store]);
			react.useEffect(() => {
				if (store === void 0 || store === null) return void 0;
				refresh();
				if (intervalMs === void 0 || intervalMs === null || intervalMs <= 0) return void 0;
				if (typeof setInterval !== "function") return void 0;
				const id = setInterval(refresh, intervalMs);
				return () => {
					if (typeof clearInterval === "function") clearInterval(id);
				};
			}, [
				store,
				refresh,
				intervalMs
			]);
			return refresh;
		}
		//#endregion
		//#region src/contract/layout.js
		/** Geometry defaults. Kept in one place so the canvas and the hit-test agree. */
		const LAYOUT = {
			nodeWidth: 168,
			nodeHeight: 62,
			gapX: 92,
			gapY: 26,
			padding: 22
		};
		/**
		* Topologically order nodes and detect cycles.
		*
		* Kahn's algorithm with stable tie-breaking on first-seen order, so a given
		* workflow always produces the same picture — a canvas that reshuffles between
		* polls is unreadable.
		*
		* @param ids - node ids in record order.
		* @param depsOf - id → array of dependency ids.
		* @returns `{ order, cyclic }`; when cyclic, `order` holds the acyclic prefix and
		*   `cyclic` lists the ids left unresolved.
		*/
		function topologicalOrder(ids, depsOf) {
			const indegree = /* @__PURE__ */ new Map();
			const children = /* @__PURE__ */ new Map();
			for (const id of ids) {
				indegree.set(id, 0);
				children.set(id, []);
			}
			for (const id of ids) for (const dep of depsOf(id)) {
				if (!indegree.has(dep)) continue;
				indegree.set(id, indegree.get(id) + 1);
				children.get(dep).push(id);
			}
			const order = [];
			const ready = ids.filter((id) => indegree.get(id) === 0);
			while (ready.length > 0) {
				const id = ready.shift();
				order.push(id);
				for (const child of children.get(id)) {
					indegree.set(child, indegree.get(child) - 1);
					if (indegree.get(child) === 0) ready.push(child);
				}
			}
			return {
				order,
				cyclic: ids.filter((id) => order.indexOf(id) === -1)
			};
		}
		/**
		* Lay a workflow out left-to-right in dependency waves.
		*
		* Layer `n` holds every node whose longest path from a root is `n`, so an edge
		* always points strictly to a later layer and no edge is drawn backwards.
		* Nodes inside a layer are ordered by the mean row of their parents (one
		* barycenter pass) to pull connected chains into straight lines.
		*
		* @param nodes - workflow nodes: `{ id, dependsOn }` (extra fields are ignored).
		* @param options - optional geometry overrides merged over {@link LAYOUT}.
		* @returns `{ nodes, edges, layers, width, height, cyclic, entryIds, terminalIds }`
		*   where each returned node is `{ id, layer, row, x, y, width, height, missingDeps }`.
		*/
		function layoutDag(nodes, options) {
			const geometry = Object.assign({}, LAYOUT, options === void 0 || options === null ? {} : options);
			const list = Array.isArray(nodes) ? nodes : [];
			const ids = [];
			const known = /* @__PURE__ */ new Set();
			for (const node of list) {
				const id = node !== null && typeof node === "object" && node.id !== void 0 ? String(node.id) : "";
				if (id === "" || known.has(id)) continue;
				known.add(id);
				ids.push(id);
			}
			const byId = /* @__PURE__ */ new Map();
			for (const node of list) {
				if (node === null || typeof node !== "object") continue;
				const id = node.id === void 0 ? "" : String(node.id);
				if (id === "" || byId.has(id)) continue;
				byId.set(id, node);
			}
			/** Dependencies of `id` that exist in this workflow, de-duplicated. */
			const depsOf = (id) => {
				const node = byId.get(id);
				const raw = node !== void 0 && Array.isArray(node.dependsOn) ? node.dependsOn : [];
				const out = [];
				for (const dep of raw) {
					const key = String(dep);
					if (known.has(key) && key !== id && out.indexOf(key) === -1) out.push(key);
				}
				return out;
			};
			/** Dependency ids recorded on the node but absent from the workflow. */
			const missingOf = (id) => {
				const node = byId.get(id);
				const raw = node !== void 0 && Array.isArray(node.dependsOn) ? node.dependsOn : [];
				const out = [];
				for (const dep of raw) {
					const key = String(dep);
					if (key === id || known.has(key) || out.indexOf(key) !== -1) continue;
					out.push(key);
				}
				return out;
			};
			const { order, cyclic } = topologicalOrder(ids, depsOf);
			const layerOf = /* @__PURE__ */ new Map();
			for (const id of order) {
				let layer = 0;
				for (const dep of depsOf(id)) {
					const candidate = (layerOf.has(dep) ? layerOf.get(dep) : 0) + 1;
					if (candidate > layer) layer = candidate;
				}
				layerOf.set(id, layer);
			}
			let maxLayer = 0;
			for (const layer of layerOf.values()) if (layer > maxLayer) maxLayer = layer;
			for (const id of cyclic) layerOf.set(id, maxLayer + 1);
			const layers = [];
			for (const id of ids) {
				const layer = layerOf.get(id);
				while (layers.length <= layer) layers.push([]);
				layers[layer].push(id);
			}
			const rowOf = /* @__PURE__ */ new Map();
			for (let index = 0; index < layers.length; index += 1) {
				const layer = layers[index];
				const scored = layer.map((id, position) => {
					const parents = depsOf(id).filter((dep) => rowOf.has(dep));
					if (parents.length === 0) return {
						id,
						score: position,
						hasParents: false
					};
					let sum = 0;
					for (const parent of parents) sum += rowOf.get(parent);
					return {
						id,
						score: sum / parents.length,
						hasParents: true
					};
				});
				scored.sort((a, b) => {
					if (a.hasParents !== b.hasParents) return a.hasParents ? 1 : -1;
					if (a.score !== b.score) return a.score - b.score;
					return layer.indexOf(a.id) - layer.indexOf(b.id);
				});
				layers[index] = scored.map((entry) => entry.id);
				for (let row = 0; row < layers[index].length; row += 1) rowOf.set(layers[index][row], row);
			}
			const outNodes = [];
			const positions = /* @__PURE__ */ new Map();
			let maxRows = 0;
			for (let layer = 0; layer < layers.length; layer += 1) if (layers[layer].length > maxRows) maxRows = layers[layer].length;
			for (let layer = 0; layer < layers.length; layer += 1) {
				const count = layers[layer].length;
				const offset = (maxRows - count) * (geometry.nodeHeight + geometry.gapY) / 2;
				for (let row = 0; row < count; row += 1) {
					const id = layers[layer][row];
					const x = geometry.padding + layer * (geometry.nodeWidth + geometry.gapX);
					const y = geometry.padding + offset + row * (geometry.nodeHeight + geometry.gapY);
					const entry = {
						id,
						layer,
						row,
						x,
						y,
						width: geometry.nodeWidth,
						height: geometry.nodeHeight,
						missingDeps: missingOf(id)
					};
					positions.set(id, entry);
					outNodes.push(entry);
				}
			}
			const edges = [];
			for (const id of ids) for (const dep of depsOf(id)) {
				const from = positions.get(dep);
				const to = positions.get(id);
				if (from === void 0 || to === void 0) continue;
				edges.push({
					from: dep,
					to: id,
					x1: from.x + from.width,
					y1: from.y + from.height / 2,
					x2: to.x,
					y2: to.y + to.height / 2
				});
			}
			const width = layers.length === 0 ? geometry.padding * 2 : geometry.padding * 2 + layers.length * geometry.nodeWidth + (layers.length - 1) * geometry.gapX;
			const height = maxRows === 0 ? geometry.padding * 2 : geometry.padding * 2 + maxRows * geometry.nodeHeight + (maxRows - 1) * geometry.gapY;
			const entryIds = layers.length === 0 ? [] : layers[0].slice();
			const terminalIds = [];
			for (const id of ids) {
				let hasChild = false;
				for (const other of ids) if (depsOf(other).indexOf(id) !== -1) {
					hasChild = true;
					break;
				}
				if (!hasChild) terminalIds.push(id);
			}
			return {
				nodes: outNodes,
				edges,
				layers,
				width,
				height,
				cyclic,
				entryIds,
				terminalIds
			};
		}
		/**
		* Merge a workflow's geometry with live per-node run state.
		*
		* @param layout - a value from {@link layoutDag}.
		* @param nodeStates - run nodes from `pickRun`, or `undefined` for a static view.
		* @returns a new node array where each entry carries `status` and node detail.
		*/
		function decorateDag(layout, nodeStates) {
			const byId = /* @__PURE__ */ new Map();
			if (Array.isArray(nodeStates)) for (const state of nodeStates) byId.set(state.id, state);
			return layout.nodes.map((node) => {
				const state = byId.get(node.id);
				return Object.assign({}, node, {
					status: state === void 0 ? "pending" : state.status,
					assignee: state === void 0 ? "" : state.assignee,
					output: state === void 0 ? "" : state.output,
					error: state === void 0 ? "" : state.error,
					tools: state === void 0 ? "" : state.tools
				});
			});
		}
		//#endregion
		//#region src/client/palette.js
		/** Token → fallback pairs, per semantic role. */
		const PALETTE_TOKENS = {
			text: ["--dsw-alias-label-primary", "#0f1115"],
			muted: ["--dsw-alias-label-tertiary", "#81858c"],
			border: ["--dsw-alias-border-l2", "rgba(0,0,0,0.16)"],
			surface: ["--dsw-alias-bg-layer-1", "#ffffff"],
			surfaceAlt: ["--dsw-alias-bg-layer-2", "#f6f7f8"],
			accent: ["--dsw-alias-brand-primary", "#0f1115"],
			success: ["--dsw-alias-state-success-primary", "#067647"],
			error: ["--dsw-alias-state-error-primary", "#d92d20"],
			warn: ["--dsw-alias-state-warn-primary", "#b54708"],
			business: ["--dsw-alias-state-business-primary", "#175cd3"]
		};
		/** Node status → palette role. */
		const STATUS_ROLE = {
			pending: "muted",
			completed: "success",
			failed: "error",
			running: "business"
		};
		/** Status → fill colour when no token is resolvable. */
		const STATUS_FALLBACK = {
			pending: "#c4c8ce",
			completed: "#12a150",
			failed: "#e5484d",
			running: "#3b82f6"
		};
		/**
		* Resolve the palette for the current page.
		*
		* Dark mode is detected the way the shell marks it (`body[data-ds-dark-theme]`),
		* which only affects the fallbacks — resolvable tokens win either way.
		*
		* @param win - a `Window`; omit on a non-DOM platform.
		* @returns an object of concrete colour strings keyed by palette role.
		*/
		function resolvePalette(win) {
			const target = win === void 0 ? typeof window === "undefined" ? void 0 : window : win;
			const palette = {};
			for (const role of Object.keys(PALETTE_TOKENS)) palette[role] = PALETTE_TOKENS[role][1];
			if (target === void 0 || target === null || typeof target.getComputedStyle !== "function") return palette;
			const doc = target.document;
			if (doc !== void 0 && doc.body !== null && doc.body !== void 0 && doc.body.hasAttribute("data-ds-dark-theme")) {
				palette.text = "#f4f5f6";
				palette.muted = "#9ba1a8";
				palette.border = "rgba(255,255,255,0.18)";
				palette.surface = "#1c1c1f";
				palette.surfaceAlt = "#232327";
				palette.accent = "#f4f5f6";
			}
			const root = doc !== void 0 && doc.documentElement !== void 0 ? doc.documentElement : void 0;
			if (root === void 0) return palette;
			let computed;
			try {
				computed = target.getComputedStyle(root);
			} catch {
				return palette;
			}
			for (const role of Object.keys(PALETTE_TOKENS)) {
				let value = "";
				try {
					value = computed.getPropertyValue(PALETTE_TOKENS[role][0]);
				} catch {
					value = "";
				}
				const trimmed = typeof value === "string" ? value.trim() : "";
				if (trimmed !== "") palette[role] = trimmed;
			}
			return palette;
		}
		//#endregion
		//#region src/client/ui.js
		/**
		* Colour for one semantic tone, as a CSS custom property reference.
		*
		* @param tone - a tone key from the domain tables.
		* @returns a `var(...)` expression with a neutral fallback.
		*/
		function toneColor(tone) {
			return "var(--dsw-alias-" + (TONE_VARS[tone] === void 0 ? TONE_VARS.neutral : TONE_VARS[tone]) + ", var(--dsw-alias-label-secondary, #61666b))";
		}
		/**
		* A status pill: a colour dot plus the status label.
		*
		* @param props - `{ table, status }`, where `table` is one of the domain status
		*   tables and `status` is the raw key stored by the host.
		* @returns the badge element.
		*/
		function StatusBadge(props) {
			const entry = statusEntry(props.table, props.status);
			return react.createElement("span", {
				className: "tfc-badge",
				style: { color: toneColor(entry.tone) },
				title: String(props.status === void 0 ? "" : props.status)
			}, react.createElement("span", { className: "tfc-dot" }), entry.label);
		}
		/**
		* A neutral chip for short scalar metadata.
		*
		* @param props - `{ children, title? }`.
		* @returns the chip element.
		*/
		function Chip(props) {
			const children = props.children;
			if (children === void 0 || children === null || children === "") return null;
			return react.createElement("span", {
				className: "tfc-chip",
				title: props.title
			}, children);
		}
		/**
		* A labelled form field wrapper.
		*
		* @param props - `{ label, children, hint? }`.
		* @returns the field element.
		*/
		function Field(props) {
			return react.createElement("div", { className: "tfc-field" }, react.createElement("label", { className: "tfc-label" }, props.label), props.children, props.hint === void 0 ? null : react.createElement("span", { className: "tfc-caption" }, props.hint));
		}
		/**
		* A controlled text input.
		*
		* @param props - `{ value, onChange, placeholder?, type? }`; `onChange` receives
		*   the next string, not the event.
		* @returns the input element.
		*/
		function TextInput(props) {
			return react.createElement("input", {
				className: "tfc-input",
				type: props.type === void 0 ? "text" : props.type,
				value: props.value === void 0 || props.value === null ? "" : props.value,
				placeholder: props.placeholder,
				onChange: (event) => props.onChange(event.target.value)
			});
		}
		/**
		* A controlled multi-line input.
		*
		* @param props - `{ value, onChange, placeholder?, rows? }`.
		* @returns the textarea element.
		*/
		function TextArea(props) {
			return react.createElement("textarea", {
				className: "tfc-textarea",
				rows: props.rows,
				value: props.value === void 0 || props.value === null ? "" : props.value,
				placeholder: props.placeholder,
				onChange: (event) => props.onChange(event.target.value)
			});
		}
		/**
		* A controlled select over `{ value, label }` options.
		*
		* @param props - `{ value, onChange, options, placeholder? }`.
		* @returns the select element.
		*/
		function Select(props) {
			const options = Array.isArray(props.options) ? props.options : [];
			const children = [];
			if (props.placeholder !== void 0) children.push(react.createElement("option", {
				key: "__none",
				value: ""
			}, props.placeholder));
			for (const option of options) children.push(react.createElement("option", {
				key: option.value,
				value: option.value
			}, option.label));
			return react.createElement("select", {
				className: "tfc-select",
				value: props.value === void 0 || props.value === null ? "" : props.value,
				onChange: (event) => props.onChange(event.target.value)
			}, children);
		}
		/**
		* A button. `variant` selects the visual weight.
		*
		* @param props - `{ children, onClick?, variant?, disabled?, title? }`.
		* @returns the button element.
		*/
		function Button(props) {
			const classes = ["tfc-btn"];
			if (props.variant === "primary") classes.push("tfc-btn-primary");
			else if (props.variant === "danger") classes.push("tfc-btn-danger");
			else if (props.variant === "ghost") classes.push("tfc-btn-ghost");
			return react.createElement("button", {
				type: "button",
				className: classes.join(" "),
				onClick: props.onClick,
				disabled: props.disabled === true,
				title: props.title
			}, props.children);
		}
		/**
		* A loading placeholder.
		*
		* @param props - `{ label }`.
		* @returns the placeholder element.
		*/
		function Loading(props) {
			return react.createElement("div", { className: "tfc-empty" }, react.createElement("span", { className: "tfc-spin" }, "◌"), " ", props.label);
		}
		/**
		* An empty-state placeholder.
		*
		* @param props - `{ label }`.
		* @returns the placeholder element.
		*/
		function Empty(props) {
			return react.createElement("div", { className: "tfc-empty" }, props.label);
		}
		/**
		* An error banner with an optional retry action.
		*
		* @param props - `{ label, message, onRetry?, retryLabel? }`.
		* @returns the banner element.
		*/
		function ErrorBanner(props) {
			return react.createElement("div", { className: "tfc-error" }, react.createElement("div", null, props.label + ": " + props.message), props.onRetry === void 0 ? null : react.createElement("div", { style: { marginTop: 6 } }, react.createElement(Button, {
				onClick: props.onRetry,
				variant: "ghost"
			}, props.retryLabel)));
		}
		/**
		* A determinate progress bar.
		*
		* @param props - `{ percent }`, clamped to 0–100.
		* @returns the bar element.
		*/
		function ProgressBar(props) {
			const raw = typeof props.percent === "number" && Number.isFinite(props.percent) ? props.percent : 0;
			const percent = Math.max(0, Math.min(100, Math.round(raw)));
			return react.createElement("div", {
				className: "tfc-bar",
				title: String(percent) + "%"
			}, react.createElement("div", {
				className: "tfc-bar-fill",
				style: { width: String(percent) + "%" }
			}));
		}
		/**
		* A modal shell. Clicking the backdrop closes; clicking the card does not.
		*
		* @param props - `{ open, title, onClose, children }`.
		* @returns the modal element, or `null` when closed.
		*/
		function Modal(props) {
			if (props.open !== true) return null;
			return react.createElement("div", {
				className: "tfc-modal",
				onClick: (event) => {
					if (event.target === event.currentTarget && typeof props.onClose === "function") props.onClose();
				}
			}, react.createElement("div", { className: "tfc-modal-card" }, react.createElement("h3", { className: "tfc-modal-title" }, props.title), props.children));
		}
		/**
		* Format an epoch-millisecond timestamp for display.
		*
		* @param value - milliseconds since epoch, or `0`/`undefined` when unknown.
		* @returns a locale string, or an em dash for a missing timestamp.
		*/
		function formatTime(value) {
			if (typeof value !== "number" || value <= 0) return "—";
			try {
				return new Date(value).toLocaleString();
			} catch {
				return String(value);
			}
		}
		/**
		* Format a duration between two timestamps.
		*
		* @param start - epoch milliseconds.
		* @param end - epoch milliseconds; `0` means "still running", measured against now.
		* @returns a compact duration such as `1m 12s`, or an em dash.
		*/
		function formatDuration(start, end) {
			if (typeof start !== "number" || start <= 0) return "—";
			const seconds = Math.max(0, Math.round(((typeof end === "number" && end > 0 ? end : Date.now()) - start) / 1e3));
			if (seconds < 60) return String(seconds) + "s";
			const minutes = Math.floor(seconds / 60);
			if (minutes < 60) return String(minutes) + "m " + String(seconds % 60) + "s";
			return String(Math.floor(minutes / 60)) + "h " + String(minutes % 60) + "m";
		}
		//#endregion
		//#region src/client/components/dag-canvas.js
		/** Draw one rounded rectangle path. */
		function roundRect(context, x, y, width, height, radius) {
			const r = Math.min(radius, width / 2, height / 2);
			context.beginPath();
			context.moveTo(x + r, y);
			context.lineTo(x + width - r, y);
			context.quadraticCurveTo(x + width, y, x + width, y + r);
			context.lineTo(x + width, y + height - r);
			context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
			context.lineTo(x + r, y + height);
			context.quadraticCurveTo(x, y + height, x, y + height - r);
			context.lineTo(x, y + r);
			context.quadraticCurveTo(x, y, x + r, y);
			context.closePath();
		}
		/** Truncate text to fit a pixel width, appending an ellipsis. */
		function fitText(context, text, maxWidth) {
			if (context.measureText(text).width <= maxWidth) return text;
			let value = text;
			while (value.length > 1 && context.measureText(value + "…").width > maxWidth) value = value.slice(0, -1);
			return value + "…";
		}
		/** Colour for a node status. */
		function statusColor(palette, status) {
			const role = STATUS_ROLE[status] === void 0 ? "muted" : STATUS_ROLE[status];
			if (palette[role] !== void 0 && palette[role] !== "") return palette[role];
			return STATUS_FALLBACK[status] === void 0 ? STATUS_FALLBACK.pending : STATUS_FALLBACK[status];
		}
		/**
		* Paint a laid-out DAG.
		*
		* @param canvas - the target element.
		* @param layout - a value from `layoutDag`.
		* @param nodeStates - run nodes used to colour the boxes, or `undefined`.
		* @returns the pixel size that was drawn, for the hover hit-test.
		*/
		function paintDag(canvas, layout, nodeStates) {
			const palette = resolvePalette(typeof window === "undefined" ? void 0 : window);
			const ratio = typeof window !== "undefined" && typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
			const nodes = decorateDag(layout, nodeStates);
			const width = Math.max(LAYOUT.padding * 2, Math.round(layout.width));
			const height = Math.max(LAYOUT.padding * 2, Math.round(layout.height));
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			canvas.style.height = String(height) + "px";
			const context = canvas.getContext("2d");
			if (context === null || context === void 0) return {
				width,
				height,
				nodes
			};
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, width, height);
			context.lineWidth = 1.5;
			context.strokeStyle = palette.border;
			for (const edge of layout.edges) {
				const midX = edge.x1 + (edge.x2 - edge.x1) / 2;
				context.beginPath();
				context.moveTo(edge.x1, edge.y1);
				context.bezierCurveTo(midX, edge.y1, midX, edge.y2, edge.x2, edge.y2);
				context.stroke();
				const direction = edge.y2 === edge.y1 ? 0 : edge.y2 > edge.y1 ? 1 : -1;
				context.beginPath();
				context.moveTo(edge.x2, edge.y2);
				context.lineTo(edge.x2 - 7, edge.y2 - 4 * (direction === 0 ? 1 : direction));
				context.lineTo(edge.x2 - 7, edge.y2 + 4 * (direction === 0 ? 1 : direction));
				context.closePath();
				context.fillStyle = palette.border;
				context.fill();
			}
			for (const node of nodes) {
				const accent = statusColor(palette, node.status);
				context.fillStyle = palette.surface;
				roundRect(context, node.x, node.y, node.width, node.height, 10);
				context.fill();
				context.lineWidth = node.status === "pending" ? 1 : 2;
				context.strokeStyle = node.status === "pending" ? palette.border : accent;
				context.stroke();
				context.fillStyle = accent;
				roundRect(context, node.x, node.y, 4, node.height, 2);
				context.fill();
				context.fillStyle = palette.text;
				context.font = "600 12px system-ui, -apple-system, \"Segoe UI\", sans-serif";
				context.textBaseline = "alphabetic";
				context.fillText(fitText(context, node.id, node.width - 20), node.x + 12, node.y + 22);
				context.fillStyle = palette.muted;
				context.font = "11px system-ui, -apple-system, \"Segoe UI\", sans-serif";
				const detail = node.assignee === "" ? node.status : node.assignee;
				context.fillText(fitText(context, detail, node.width - 20), node.x + 12, node.y + 40);
				if (node.missingDeps.length > 0) {
					context.fillStyle = palette.warn;
					context.fillText(fitText(context, "⚠ " + node.missingDeps.join(","), node.width - 20), node.x + 12, node.y + 55);
				}
			}
			return {
				width,
				height,
				nodes
			};
		}
		/**
		* The canvas surface plus its legend and per-node detail list.
		*
		* @param props - `{ layout, nodeStates, t, selectedId?, onSelect? }`.
		* @returns the element.
		*/
		function DagCanvas(props) {
			const canvasRef = react.useRef(null);
			const [hover, setHover] = react.useState(null);
			const layout = props.layout;
			const nodeStates = props.nodeStates;
			const t = props.t;
			react.useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null || canvas === void 0) return;
				try {
					paintDag(canvas, layout, nodeStates);
				} catch {}
			}, [layout, nodeStates]);
			const decorated = react.useMemo(() => decorateDag(layout, nodeStates), [layout, nodeStates]);
			const legend = [
				{
					status: "pending",
					label: t("dag.legend.pending")
				},
				{
					status: "completed",
					label: t("dag.legend.completed")
				},
				{
					status: "failed",
					label: t("dag.legend.failed")
				}
			];
			return react.createElement("div", { className: "tfc-col" }, react.createElement("div", { className: "tfc-legend" }, legend.map((item) => react.createElement("span", {
				key: item.status,
				className: "tfc-legend-item"
			}, react.createElement("span", {
				className: "tfc-swatch",
				style: { background: statusColor(resolvePalette(void 0), item.status) }
			}), item.label)), react.createElement("span", { className: "tfc-legend-item" }, react.createElement("span", {
				className: "tfc-swatch",
				style: { background: "transparent" }
			}), t("dag.legend.edge"))), react.createElement("div", { className: "tfc-canvas-wrap" }, react.createElement("canvas", {
				ref: canvasRef,
				className: "tfc-canvas",
				role: "img",
				"aria-label": t("dag.canvasLabel"),
				onMouseMove: (event) => {
					const canvas = canvasRef.current;
					if (canvas === null || canvas === void 0) return;
					const rect = canvas.getBoundingClientRect();
					const x = event.clientX - rect.left;
					const y = event.clientY - rect.top;
					let found = null;
					for (const node of decorated) if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
						found = node.id;
						break;
					}
					if (found !== hover) setHover(found);
				},
				onMouseLeave: () => setHover(null),
				onClick: () => {
					if (typeof props.onSelect === "function") props.onSelect(hover);
				}
			})), react.createElement("div", { className: "tfc-node-list" }, decorated.map((node) => react.createElement("div", {
				key: node.id,
				className: "tfc-card" + (props.selectedId === node.id ? " tfc-item-on" : ""),
				style: { borderColor: hover === node.id || props.selectedId === node.id ? "var(--dsw-alias-brand-primary, #0f1115)" : void 0 },
				onClick: () => {
					if (typeof props.onSelect === "function") props.onSelect(node.id);
				}
			}, react.createElement("div", { className: "tfc-row-between" }, react.createElement("span", { className: "tfc-item-title" }, node.id), react.createElement(StatusBadge, {
				table: NODE_STATUSES,
				status: node.status
			})), react.createElement("div", {
				className: "tfc-row",
				style: { marginTop: 4 }
			}, react.createElement(Chip, { title: "agent" }, node.assignee === "" ? "—" : node.assignee), react.createElement(Chip, null, "L" + String(node.layer)), node.missingDeps.length === 0 ? null : react.createElement(Chip, { title: t("dag.missingDeps", { ids: node.missingDeps.join(", ") }) }, "⚠ " + node.missingDeps.join(","))), node.output === "" ? null : react.createElement("pre", {
				className: "tfc-pre",
				style: { marginTop: 6 }
			}, node.output), node.error === "" ? null : react.createElement("div", {
				className: "tfc-error",
				style: { marginTop: 6 }
			}, node.error)))));
		}
		//#endregion
		//#region src/client/components/settings-section.js
		/** The empty create-task draft. */
		function emptyTaskDraft() {
			return {
				kind: "task",
				id: "",
				assignee: "",
				reviewer: "",
				requirement: "",
				acceptanceCriteria: "",
				feedback: "",
				steps: []
			};
		}
		/** Split a comma-separated field into trimmed, non-empty entries. */
		function splitList(value) {
			return String(value === void 0 || value === null ? "" : value).split(",").map((item) => item.trim()).filter((item) => item !== "");
		}
		/** Join list entries for a comma-separated field. */
		function joinList(list) {
			return Array.isArray(list) ? list.join(", ") : "";
		}
		/**
		* The workflow to show when the DAG tab opens without one explicitly picked.
		*
		* The default is not "the first record": an empty workflow (one saved before its
		* nodes were filled in) would open the tab on a blank canvas, which reads as a
		* broken page. A workflow with nodes wins; insertion order breaks the tie, and
		* an all-empty store still resolves to a real record so the picker stays honest.
		*
		* @param workflows - the workflow slice of the store.
		* @returns the workflow to lay out, or `undefined` for an empty store.
		*/
		function defaultDagWorkflow(workflows) {
			if (!Array.isArray(workflows) || workflows.length === 0) return void 0;
			let best;
			for (const workflow of workflows) {
				if (best === void 0) {
					best = workflow;
					continue;
				}
				if ((Array.isArray(workflow.nodes) ? workflow.nodes.length : 0) > (Array.isArray(best.nodes) ? best.nodes.length : 0)) best = workflow;
			}
			return best;
		}
		/** A key/value grid. */
		function KeyValues(props) {
			return react.createElement("div", { className: "tfc-kv" }, props.rows.map((row) => react.createElement("span", {
				key: "k-" + row.label,
				className: "tfc-kv-key"
			}, row.label)), props.rows.map((row) => react.createElement("span", {
				key: "v-" + row.label,
				className: "tfc-kv-val"
			}, row.value === void 0 || row.value === "" ? "—" : row.value)));
		}
		/** The tab strip. */
		function Tabs(props) {
			return react.createElement("div", { className: "tfc-tabs" }, props.tabs.map((tab) => react.createElement("button", {
				key: tab.key,
				type: "button",
				className: "tfc-tab" + (props.active === tab.key ? " tfc-tab-active" : ""),
				onClick: () => props.onSelect(tab.key)
			}, props.t("tab." + tab.key))));
		}
		/** Overview tab: counts, host health, and the newest records. */
		function OverviewTab(props) {
			const t = props.t;
			const state = props.state;
			const store = props.store;
			const open = store.openTaskCount();
			const live = store.liveRunCount();
			const stats = [
				{
					label: t("overview.stat.agents"),
					value: state.agents.length
				},
				{
					label: t("overview.stat.workflows"),
					value: state.workflows.length
				},
				{
					label: t("overview.stat.tasksOpen"),
					value: open
				},
				{
					label: t("overview.stat.runsLive"),
					value: live
				}
			];
			return react.createElement("div", { className: "tfc-col" }, react.createElement("div", { className: "tfc-stats" }, stats.map((stat) => react.createElement("div", {
				key: stat.label,
				className: "tfc-stat"
			}, react.createElement("span", { className: "tfc-stat-value" }, String(stat.value)), react.createElement("span", { className: "tfc-stat-label" }, stat.label)))), react.createElement("div", { className: "tfc-card tfc-card-l2" }, react.createElement("div", { className: "tfc-label" }, t("overview.health")), react.createElement("div", { className: "tfc-row" }, react.createElement(Chip, null, state.health === "ok" ? t("overview.healthOk") : state.health === "down" ? t("overview.healthFail") : t("state.unknown")), state.domains.map((domain) => react.createElement(Chip, { key: domain }, domain))), react.createElement("div", {
				className: "tfc-caption",
				style: { marginTop: 4 }
			}, formatTime(state.lastLoadedAt))), react.createElement("div", { className: "tfc-card" }, react.createElement("div", { className: "tfc-label" }, t("overview.recentRuns")), state.runs.length === 0 ? react.createElement(Empty, { label: t("runs.empty") }) : react.createElement("div", { className: "tfc-list" }, store.newestRuns(5).map((run) => react.createElement("div", {
				key: run.id,
				className: "tfc-item tfc-item-selectable",
				onClick: () => props.onOpenRun(run.id)
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, "#" + run.id.slice(-8)), react.createElement("span", { className: "tfc-item-sub" }, (run.workflowId || "—") + " · " + formatTime(run.startedAt))), react.createElement("div", { style: { width: 72 } }, react.createElement(ProgressBar, { percent: store.runProgress(run) })), react.createElement(StatusBadge, {
				table: RUN_STATUSES,
				status: run.status
			}))))), react.createElement("div", { className: "tfc-card" }, react.createElement("div", { className: "tfc-label" }, t("overview.openTasks")), state.tasks.length === 0 ? react.createElement(Empty, { label: t("tasks.empty") }) : react.createElement("div", { className: "tfc-list" }, store.newestTasks(5).filter((task) => task.status !== "settle").map((task) => react.createElement("div", {
				key: task.id,
				className: "tfc-item"
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, task.requirement === "" ? task.id : task.requirement), react.createElement("span", { className: "tfc-item-sub" }, (task.assignee || "—") + " · " + t("tasks.iteration", { n: task.iteration }))), react.createElement(StatusBadge, {
				table: TASK_COLUMNS,
				status: task.status
			}))))));
		}
		/** Agents tab: list, create, edit, delete. */
		function AgentsTab(props) {
			const t = props.t;
			const state = props.state;
			const draft = props.draft;
			const setDraft = props.setDraft;
			if (state.agents.length === 0) return react.createElement(Empty, { label: t("agents.empty") });
			return react.createElement("div", { className: "tfc-list" }, state.agents.map((agent) => react.createElement("div", {
				key: agent.id,
				className: "tfc-item"
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, agent.name), react.createElement("span", { className: "tfc-item-sub" }, (agent.role || "—") + (agent.model === "" ? "" : " · " + agent.provider + "/" + agent.model))), react.createElement(Chip, null, String(agent.allow.length + agent.deny.length) + " tools"), react.createElement(Chip, null, "it " + formatTime(agent.updatedAt)), react.createElement(Button, {
				variant: "ghost",
				onClick: () => {
					setDraft({
						kind: "agent",
						id: agent.id,
						name: agent.name,
						role: agent.role,
						systemPrompt: agent.systemPrompt,
						provider: agent.provider,
						model: agent.model,
						skills: joinList(agent.skills),
						allow: joinList(agent.allow),
						deny: joinList(agent.deny)
					});
				}
			}, t("action.edit")), react.createElement(Button, {
				variant: "danger",
				onClick: () => {
					if (typeof props.onDelete === "function" && props.confirmDelete(t("agents.confirmDelete"))) props.onDelete(agent.id);
				}
			}, t("action.delete")))), draft.kind === "agent" ? react.createElement(Modal, {
				open: true,
				title: t("agents.edit"),
				onClose: () => setDraft(null)
			}, react.createElement(Field, { label: t("agents.field.name") }, react.createElement(TextInput, {
				value: draft.name,
				onChange: (value) => setDraft(Object.assign({}, draft, { name: value }))
			})), react.createElement(Field, { label: t("agents.field.role") }, react.createElement(TextInput, {
				value: draft.role,
				onChange: (value) => setDraft(Object.assign({}, draft, { role: value }))
			})), react.createElement(Field, { label: t("agents.field.systemPrompt") }, react.createElement(TextArea, {
				value: draft.systemPrompt,
				onChange: (value) => setDraft(Object.assign({}, draft, { systemPrompt: value }))
			})), react.createElement("div", { className: "tfc-row" }, react.createElement(Field, { label: t("agents.field.provider") }, react.createElement(TextInput, {
				value: draft.provider,
				onChange: (value) => setDraft(Object.assign({}, draft, { provider: value }))
			})), react.createElement(Field, { label: t("agents.field.model") }, react.createElement(TextInput, {
				value: draft.model,
				onChange: (value) => setDraft(Object.assign({}, draft, { model: value }))
			}))), react.createElement(Field, { label: t("agents.field.skills") }, react.createElement(TextInput, {
				value: draft.skills,
				onChange: (value) => setDraft(Object.assign({}, draft, { skills: value }))
			})), react.createElement(Field, { label: t("agents.field.toolsAllow") }, react.createElement(TextInput, {
				value: draft.allow,
				onChange: (value) => setDraft(Object.assign({}, draft, { allow: value }))
			})), react.createElement(Field, { label: t("agents.field.toolsDeny") }, react.createElement(TextInput, {
				value: draft.deny,
				onChange: (value) => setDraft(Object.assign({}, draft, { deny: value }))
			})), react.createElement("div", { className: "tfc-modal-actions" }, react.createElement(Button, {
				variant: "ghost",
				onClick: () => setDraft(null)
			}, t("action.cancel")), react.createElement(Button, {
				variant: "primary",
				disabled: draft.name.trim() === "",
				onClick: props.onSave
			}, t("action.save")))) : null);
		}
		/** Workflows tab: list, run, edit, delete. */
		function WorkflowsTab(props) {
			const t = props.t;
			const state = props.state;
			const draft = props.draft;
			const setDraft = props.setDraft;
			const editDraft = draft.kind === "workflow" ? draft : null;
			const rows = state.workflows.length === 0 ? [react.createElement(Empty, {
				key: "empty",
				label: t("workflows.empty")
			})] : state.workflows.map((workflow) => react.createElement("div", {
				key: workflow.id,
				className: "tfc-item"
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, workflow.name), react.createElement("span", { className: "tfc-item-sub" }, (workflow.description || "—") + " · " + t("workflows.nodeCount", { count: workflow.nodes.length }))), react.createElement(Chip, null, formatTime(workflow.updatedAt)), react.createElement(Button, {
				variant: "ghost",
				onClick: () => props.onShowDag(workflow.id)
			}, t("action.viewDag")), react.createElement(Button, {
				variant: "primary",
				disabled: props.busy,
				onClick: () => props.onRun(workflow.id)
			}, props.busy ? t("action.running") : t("action.run")), react.createElement(Button, {
				variant: "ghost",
				onClick: () => setDraft({
					kind: "workflow",
					id: workflow.id,
					name: workflow.name,
					description: workflow.description,
					nodesText: JSON.stringify(workflow.nodes.reduce((accumulator, node) => {
						accumulator[node.id] = {
							agent: node.agent,
							dependsOn: node.dependsOn,
							reviewer: node.reviewer,
							taskTemplate: {
								requirement: node.requirement,
								acceptanceCriteria: node.acceptanceCriteria
							}
						};
						return accumulator;
					}, {}), null, 2)
				})
			}, t("action.edit")), react.createElement(Button, {
				variant: "danger",
				onClick: () => {
					if (typeof props.onDelete === "function" && props.confirmDelete(t("workflows.confirmDelete"))) props.onDelete(workflow.id);
				}
			}, t("action.delete"))));
			return react.createElement("div", { className: "tfc-col" }, react.createElement("div", { className: "tfc-list" }, rows), editDraft === null ? null : react.createElement(Modal, {
				open: true,
				title: t("workflows.edit"),
				onClose: () => setDraft(null)
			}, react.createElement(Field, { label: t("workflows.field.name") }, react.createElement(TextInput, {
				value: editDraft.name,
				onChange: (value) => setDraft(Object.assign({}, editDraft, { name: value }))
			})), react.createElement(Field, { label: t("workflows.field.description") }, react.createElement(TextInput, {
				value: editDraft.description,
				onChange: (value) => setDraft(Object.assign({}, editDraft, { description: value }))
			})), react.createElement(Field, {
				label: t("workflows.field.nodes"),
				hint: props.nodesError === "" ? void 0 : props.nodesError
			}, react.createElement(TextArea, {
				rows: 12,
				value: editDraft.nodesText,
				onChange: (value) => setDraft(Object.assign({}, editDraft, { nodesText: value }))
			})), react.createElement("div", { className: "tfc-modal-actions" }, react.createElement(Button, {
				variant: "ghost",
				onClick: () => setDraft(null)
			}, t("action.cancel")), react.createElement(Button, {
				variant: "primary",
				disabled: editDraft.name.trim() === "" || props.nodesError !== "",
				onClick: props.onSave
			}, t("action.save")))));
		}
		/** DAG tab: pick a workflow, lay it out, paint it, optionally overlay a run. */
		function DagTab(props) {
			const t = props.t;
			const state = props.state;
			const [workflowId, setWorkflowId] = react.useState(props.initialWorkflowId === void 0 ? "" : props.initialWorkflowId);
			const [overlay, setOverlay] = react.useState(false);
			const [selectedId, setSelectedId] = react.useState(null);
			const workflow = state.workflows.filter((item) => item.id === workflowId)[0];
			const active = workflow === void 0 ? defaultDagWorkflow(state.workflows) : workflow;
			const layout = react.useMemo(() => active === void 0 ? null : layoutDag(active.nodes.map((node) => ({
				id: node.id,
				dependsOn: node.dependsOn
			}))), [active]);
			const latestRun = react.useMemo(() => {
				if (active === void 0) return void 0;
				const matches = state.runs.filter((run) => run.workflowId === active.id);
				matches.sort((a, b) => b.startedAt - a.startedAt);
				return matches[0];
			}, [active, state.runs]);
			const nodeStates = overlay && latestRun !== void 0 ? latestRun.nodes : void 0;
			if (state.workflows.length === 0) return react.createElement(Empty, { label: t("dag.empty") });
			const missing = [];
			for (const node of layout === null ? [] : layout.nodes) for (const dep of node.missingDeps) if (missing.indexOf(node.id + " → " + dep) === -1) missing.push(node.id + " → " + dep);
			return react.createElement("div", { className: "tfc-col" }, react.createElement("div", { className: "tfc-row-between" }, react.createElement("div", { className: "tfc-row" }, react.createElement("span", { className: "tfc-label" }, t("dag.pick")), react.createElement(Select, {
				value: active === void 0 ? "" : active.id,
				onChange: (value) => {
					setWorkflowId(value);
					setSelectedId(null);
				},
				options: state.workflows.map((item) => ({
					value: item.id,
					label: item.name
				}))
			}), react.createElement(Chip, null, t("dag.nodes") + ": " + String(layout === null ? 0 : layout.nodes.length)), react.createElement(Chip, null, t("dag.edges") + ": " + String(layout === null ? 0 : layout.edges.length)), react.createElement(Chip, null, t("dag.waves") + ": " + String(layout === null ? 0 : layout.layers.length))), latestRun === void 0 ? null : react.createElement("label", {
				className: "tfc-row",
				style: {
					gap: 6,
					cursor: "pointer"
				}
			}, react.createElement("input", {
				type: "checkbox",
				checked: overlay,
				onChange: (event) => setOverlay(event.target.checked)
			}), react.createElement("span", { className: "tfc-caption" }, t("dag.runState") + " · #" + latestRun.id.slice(-8)))), layout !== null && layout.cyclic.length > 0 ? react.createElement("div", { className: "tfc-warn" }, t("dag.cycle", { ids: layout.cyclic.join(", ") })) : null, missing.length > 0 ? react.createElement("div", { className: "tfc-warn" }, t("dag.missingDeps", { ids: missing.join("; ") })) : null, layout === null ? react.createElement(Empty, { label: t("dag.empty") }) : react.createElement(DagCanvas, {
				layout,
				nodeStates,
				t,
				selectedId,
				onSelect: setSelectedId
			}), active === void 0 ? null : react.createElement("div", { className: "tfc-card tfc-card-l2" }, react.createElement("div", { className: "tfc-label" }, active.name), react.createElement(KeyValues, { rows: [{
				label: t("workflows.field.description"),
				value: active.description
			}, {
				label: t("dag.nodes"),
				value: active.nodes.map((node) => node.id + (node.agent === "" ? "" : "(" + node.agent + ")") + (node.dependsOn.length === 0 ? " [" + t("dag.noDep") + "]" : " ← " + node.dependsOn.join(","))).join("  |  ")
			}] })));
		}
		/** Tasks tab: kanban board plus a create/rework form. */
		function TasksTab(props) {
			const t = props.t;
			const state = props.state;
			const draft = props.draft;
			const setDraft = props.setDraft;
			const byStatus = {};
			for (const task of state.tasks) {
				if (byStatus[task.status] === void 0) byStatus[task.status] = [];
				byStatus[task.status].push(task);
			}
			const columns = TASK_COLUMNS.map((column) => {
				const items = byStatus[column.key] === void 0 ? [] : byStatus[column.key];
				return react.createElement("div", {
					key: column.key,
					className: "tfc-col-item"
				}, react.createElement("div", { className: "tfc-col-head" }, react.createElement("span", {
					className: "tfc-col-title",
					style: { color: toneColor(column.tone) }
				}, column.label), react.createElement("span", { className: "tfc-count tfc-chip" }, String(items.length))), items.length === 0 ? react.createElement("span", { className: "tfc-caption" }, t("state.empty")) : items.map((task) => react.createElement("div", {
					key: task.id,
					className: "tfc-mini",
					onClick: () => props.onOpenTask(task.id)
				}, react.createElement("span", {
					className: "tfc-item-title",
					style: { whiteSpace: "normal" }
				}, task.requirement === "" ? task.id : task.requirement), react.createElement("div", {
					className: "tfc-row",
					style: { gap: 4 }
				}, react.createElement(Chip, null, task.assignee === "" ? "—" : task.assignee), task.reviewer === "" ? null : react.createElement(Chip, null, "rev:" + task.reviewer), react.createElement(Chip, null, t("tasks.iteration", { n: task.iteration })), task.steps.length === 0 ? null : react.createElement(Chip, null, t("tasks.steps", { count: task.steps.length }))))));
			});
			const detail = draft.kind === "task" ? draft : null;
			const agents = state.agents.map((agent) => ({
				value: agent.name === "" ? agent.id : agent.name,
				label: agent.name === "" ? agent.id : agent.name
			}));
			return react.createElement("div", { className: "tfc-col" }, state.tasks.length === 0 ? react.createElement(Empty, { label: t("tasks.empty") }) : null, react.createElement("div", { className: "tfc-board" }, columns), detail === null ? null : react.createElement(Modal, {
				open: true,
				title: detail.id === "" ? t("tasks.new") : t("action.detail"),
				onClose: () => setDraft(null)
			}, react.createElement(Field, { label: t("tasks.field.assignee") }, react.createElement(Select, {
				value: detail.assignee,
				onChange: (value) => setDraft(Object.assign({}, detail, { assignee: value })),
				placeholder: t("tasks.field.unassigned"),
				options: agents
			})), react.createElement(Field, { label: t("tasks.field.requirement") }, react.createElement(TextArea, {
				rows: 3,
				value: detail.requirement,
				onChange: (value) => setDraft(Object.assign({}, detail, { requirement: value }))
			})), react.createElement(Field, { label: t("tasks.field.acceptance") }, react.createElement(TextArea, {
				rows: 3,
				value: detail.acceptanceCriteria,
				onChange: (value) => setDraft(Object.assign({}, detail, { acceptanceCriteria: value }))
			})), react.createElement(Field, { label: t("tasks.field.reviewer") }, react.createElement(Select, {
				value: detail.reviewer,
				onChange: (value) => setDraft(Object.assign({}, detail, { reviewer: value })),
				placeholder: t("tasks.field.none"),
				options: agents
			})), detail.id === "" ? null : react.createElement(Field, { label: t("tasks.field.feedback") }, react.createElement(TextArea, {
				rows: 2,
				value: detail.feedback,
				onChange: (value) => setDraft(Object.assign({}, detail, { feedback: value }))
			})), detail.id === "" || detail.steps.length === 0 ? null : react.createElement("div", { className: "tfc-card tfc-card-l2" }, react.createElement("div", { className: "tfc-label" }, t("runs.nodes")), detail.steps.map((step, index) => react.createElement("div", {
				key: String(index),
				className: "tfc-row"
			}, react.createElement(Chip, null, "it" + String(step.iteration)), react.createElement(Chip, null, step.status), react.createElement("span", { className: "tfc-caption" }, formatTime(step.at)), react.createElement("span", { className: "tfc-grow tfc-caption" }, step.feedback)))), react.createElement("div", { className: "tfc-modal-actions" }, react.createElement(Button, {
				variant: "ghost",
				onClick: () => setDraft(null)
			}, t("action.cancel")), detail.id === "" ? react.createElement(Button, {
				variant: "primary",
				disabled: detail.requirement.trim() === "",
				onClick: props.onCreate
			}, t("action.create")) : react.createElement(Button, {
				variant: "primary",
				disabled: detail.feedback.trim() === "",
				onClick: props.onRework
			}, t("action.rework")))));
		}
		/** Runs tab: list with an expandable node-level detail. */
		function RunsTab(props) {
			const t = props.t;
			const state = props.state;
			const store = props.store;
			const [expanded, setExpanded] = react.useState(null);
			if (state.runs.length === 0) return react.createElement(Empty, { label: t("runs.empty") });
			const runs = store.newestRuns(50);
			return react.createElement("div", { className: "tfc-col" }, runs.map((run) => {
				const isOpen = expanded === run.id;
				return react.createElement("div", {
					key: run.id,
					className: "tfc-card"
				}, react.createElement("div", { className: "tfc-row-between" }, react.createElement("div", {
					className: "tfc-item-main",
					style: { cursor: "pointer" },
					onClick: () => setExpanded(isOpen ? null : run.id)
				}, react.createElement("span", { className: "tfc-item-title" }, "#" + run.id.slice(-8) + "  " + (run.workflowId || "—")), react.createElement("span", { className: "tfc-item-sub" }, formatTime(run.startedAt) + " · " + formatDuration(run.startedAt, run.endedAt))), react.createElement("div", { style: { width: 90 } }, react.createElement(ProgressBar, { percent: store.runProgress(run) })), react.createElement(StatusBadge, {
					table: RUN_STATUSES,
					status: run.status
				}), react.createElement(Button, {
					variant: "ghost",
					onClick: () => setExpanded(isOpen ? null : run.id)
				}, isOpen ? t("action.close") : t("action.detail"))), isOpen ? react.createElement("div", {
					className: "tfc-col",
					style: { marginTop: 8 }
				}, react.createElement(KeyValues, { rows: [
					{
						label: t("runs.field.workflow"),
						value: run.workflowId
					},
					{
						label: t("runs.field.started"),
						value: formatTime(run.startedAt)
					},
					{
						label: t("runs.field.ended"),
						value: run.endedAt === 0 ? t("runs.live") : formatTime(run.endedAt)
					},
					{
						label: t("runs.field.duration"),
						value: formatDuration(run.startedAt, run.endedAt)
					},
					{
						label: t("runs.summary"),
						value: run.summary
					}
				] }), react.createElement("div", { className: "tfc-node-list" }, run.nodes.length === 0 ? react.createElement(Empty, { label: t("state.empty") }) : run.nodes.map((node) => react.createElement("div", {
					key: node.id,
					className: "tfc-card tfc-card-l2"
				}, react.createElement("div", { className: "tfc-row-between" }, react.createElement("span", { className: "tfc-item-title" }, node.id), react.createElement(StatusBadge, {
					table: NODE_STATUSES,
					status: node.status
				})), react.createElement("div", {
					className: "tfc-row",
					style: { marginTop: 4 }
				}, react.createElement(Chip, { title: "agent" }, node.assignee === "" ? "—" : node.assignee), node.tools === "" ? null : react.createElement(Chip, { title: t("runs.field.tools") }, node.tools)), node.output === "" ? null : react.createElement("pre", {
					className: "tfc-pre",
					style: { marginTop: 6 }
				}, node.output), node.error === "" ? null : react.createElement("div", {
					className: "tfc-error",
					style: { marginTop: 6 }
				}, node.error))))) : null);
			}));
		}
		/**
		* The Settings section page.
		*
		* @param props - the slot's owner props (`{ close }`); nothing else is required.
		* @returns the page element.
		*/
		function TeamSettingsSection(props) {
			const store = useStore();
			const state = useTeamState();
			const t = useTranslate(props.locale);
			const refresh = usePolling(POLL_INTERVAL_MS);
			const [tab, setTab] = react.useState("overview");
			const [draft, setDraft] = react.useState(null);
			const [notice, setNotice] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [dagWorkflowId, setDagWorkflowId] = react.useState("");
			const confirmDelete = (message) => {
				if (typeof globalThis.confirm !== "function") return true;
				return globalThis.confirm(message);
			};
			/** Parse the workflow editor's JSON node text; `''` means valid. */
			const nodesError = react.useMemo(() => {
				if (draft === null || draft.kind !== "workflow") return "";
				const text = draft.nodesText.trim();
				if (text === "") return "";
				try {
					const parsed = JSON.parse(text);
					if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return t("workflows.nodesInvalid");
					return "";
				} catch (error) {
					return String(error.message);
				}
			}, [draft, t]);
			/**
			* Build a task draft. With an id, the live record is copied in (and the
			* mutable `feedback` field starts empty); without one, an empty create draft.
			*/
			const taskDraft = (id) => {
				if (typeof id !== "string" || id === "") return emptyTaskDraft();
				const found = state.tasks.filter((task) => task.id === id)[0];
				if (found === void 0) return emptyTaskDraft();
				return {
					kind: "task",
					id: found.id,
					assignee: found.assignee,
					reviewer: found.reviewer,
					requirement: found.requirement,
					acceptanceCriteria: found.acceptanceCriteria,
					feedback: "",
					steps: found.steps
				};
			};
			const saveAgent = async () => {
				const definition = {
					id: draft.id,
					name: draft.name.trim(),
					role: draft.role.trim(),
					systemPrompt: draft.systemPrompt,
					skills: splitList(draft.skills),
					tools: {
						allow: splitList(draft.allow),
						deny: splitList(draft.deny)
					}
				};
				if (draft.provider.trim() !== "" || draft.model.trim() !== "") definition.model = {
					provider: draft.provider.trim() === "" ? "deepseek" : draft.provider.trim(),
					model: draft.model.trim() === "" ? "deepseek-chat" : draft.model.trim()
				};
				if ((await store.actions.saveAgent(definition)).ok) {
					setDraft(null);
					setNotice("");
				}
			};
			const saveWorkflow = async () => {
				if (nodesError !== "") return;
				const text = draft.nodesText.trim();
				if ((await store.actions.saveWorkflow({
					id: draft.id,
					name: draft.name.trim(),
					description: draft.description,
					nodes: text === "" ? {} : JSON.parse(text)
				})).ok) setDraft(null);
			};
			const createTask = async () => {
				if ((await store.actions.createTask({
					assignee: draft.assignee,
					reviewer: draft.reviewer,
					requirement: draft.requirement,
					acceptanceCriteria: draft.acceptanceCriteria
				})).ok) setDraft(null);
			};
			const reworkTask = async () => {
				if ((await store.actions.reworkTask(draft.id, draft.feedback)).ok) setDraft(null);
			};
			const runWorkflow = async (workflowId) => {
				setBusy(true);
				setNotice("");
				const result = await store.actions.startRun(workflowId);
				setBusy(false);
				setTab("runs");
				if (result.ok) {
					const started = result.value;
					setNotice(t("workflows.started", { id: started === void 0 || started === null || started.id === void 0 ? "" : String(started.id).slice(-8) }));
				}
			};
			if (store === void 0 || store === null) return react.createElement("div", { className: "tfc-root" }, react.createElement(Empty, { label: t("state.error") }));
			const errorKey = Object.keys(state.errors)[0];
			const toolbar = react.createElement("div", { className: "tfc-row" }, react.createElement(Button, {
				onClick: refresh,
				disabled: state.refreshing
			}, state.refreshing ? t("action.refreshing") : t("action.refresh")), react.createElement(Button, {
				variant: "primary",
				onClick: () => setDraft({
					kind: "agent",
					id: "",
					name: "",
					role: "",
					systemPrompt: "",
					provider: "",
					model: "",
					skills: "",
					allow: "",
					deny: ""
				})
			}, "+ " + t("agents.new")), react.createElement(Button, { onClick: () => setDraft({
				kind: "workflow",
				id: "",
				name: "",
				description: "",
				nodesText: "{\n  \"plan\": { \"agent\": \"\", \"dependsOn\": [], \"taskTemplate\": { \"requirement\": \"\" } },\n  \"build\": { \"agent\": \"\", \"dependsOn\": [\"plan\"], \"taskTemplate\": { \"requirement\": \"\" } }\n}"
			}) }, "+ " + t("workflows.new")), react.createElement(Button, { onClick: () => setDraft(emptyTaskDraft()) }, "+ " + t("tasks.new")));
			let body;
			if (state.loading && state.lastLoadedAt === 0) body = react.createElement(Loading, { label: t("state.loading") });
			else if (tab === "overview") body = react.createElement(OverviewTab, {
				t,
				state,
				store,
				onOpenRun: () => setTab("runs")
			});
			else if (tab === "agents") body = react.createElement(AgentsTab, {
				t,
				state,
				draft: draft === null ? {} : draft,
				setDraft,
				confirmDelete,
				onDelete: (id) => store.actions.deleteAgent(id),
				onSave: saveAgent
			});
			else if (tab === "workflows") body = react.createElement(WorkflowsTab, {
				t,
				state,
				draft: draft === null ? {} : draft,
				setDraft,
				nodesError,
				busy,
				confirmDelete,
				onDelete: (id) => store.actions.deleteWorkflow(id),
				onSave: saveWorkflow,
				onRun: runWorkflow,
				onShowDag: (id) => {
					setDagWorkflowId(id);
					setTab("dag");
				}
			});
			else if (tab === "dag") body = react.createElement(DagTab, {
				t,
				state,
				initialWorkflowId: dagWorkflowId
			});
			else if (tab === "tasks") body = react.createElement(TasksTab, {
				t,
				state,
				draft: draft === null ? {} : draft,
				setDraft,
				onOpenTask: (id) => setDraft(taskDraft(id)),
				onCreate: createTask,
				onRework: reworkTask
			});
			else body = react.createElement(RunsTab, {
				t,
				state,
				store
			});
			return react.createElement("div", { className: "tfc-root" }, react.createElement("div", { className: "tfc-row-between" }, react.createElement("div", { className: "tfc-col" }, react.createElement("h3", { className: "tfc-title" }, t("overview.title")), react.createElement("p", { className: "tfc-subtitle" }, t("overview.subtitle"))), toolbar), react.createElement(Tabs, {
				tabs: SECTION_TABS,
				active: tab,
				onSelect: setTab,
				t
			}), notice === "" ? null : react.createElement("div", { className: "tfc-notice" }, notice), errorKey === void 0 ? null : react.createElement(ErrorBanner, {
				label: t("state.error"),
				message: state.errors[errorKey],
				onRetry: refresh,
				retryLabel: t("action.retry")
			}), body);
		}
		//#endregion
		//#region src/client/components/activity-panel.js
		/** A headline for the panel, derived only from counts. */
		function summarize(t, live, open, blocked) {
			const parts = [t("activity.liveRuns", { count: live })];
			if (open > 0) parts.push(t("activity.openTasks", { count: open }));
			if (blocked > 0) parts.push(t("activity.blockedTasks", { count: blocked }));
			return parts.join(" · ");
		}
		/**
		* The header activity contribution.
		*
		* @param props - the slot's standard Session props; only `locale` is read, and
		*   it is optional (the store falls back to its default dictionary).
		* @returns the trigger element with its popover.
		*/
		function TeamActivityAction(props) {
			const store = useStore();
			const state = useTeamState();
			const t = useTranslate(props === void 0 ? void 0 : props.locale);
			usePolling(POLL_INTERVAL_MS);
			const [open, setOpen] = react.useState(false);
			const rootRef = react.useRef(null);
			react.useEffect(() => {
				if (!open) return void 0;
				if (typeof document === "undefined") return void 0;
				const onPointerDown = (event) => {
					const root = rootRef.current;
					if (root === null || root === void 0) return;
					if (typeof root.contains === "function" && root.contains(event.target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			if (store === void 0 || store === null) return null;
			const live = store.liveRunCount();
			const openTasks = store.openTaskCount();
			let blocked = 0;
			for (const task of state.tasks) if (task.status === "reworked") blocked += 1;
			const runs = store.newestRuns(6);
			const tasks = store.newestTasks(6).filter((task) => task.status !== "settle");
			const trigger = react.createElement("button", {
				type: "button",
				className: "tfc-trigger" + (open || live > 0 ? " tfc-trigger-on" : ""),
				title: summarize(t, live, openTasks, blocked),
				"aria-label": t("activity.aria"),
				"aria-expanded": open,
				onClick: () => setOpen(!open)
			}, react.createElement("span", {
				className: "tfc-dot",
				style: { color: live > 0 ? "var(--dsw-alias-state-business-primary, #175cd3)" : "currentColor" }
			}), react.createElement("span", null, t("activity.trigger")), live > 0 || openTasks > 0 ? react.createElement("span", { className: "tfc-chip" }, String(live + openTasks)) : null);
			const panel = !open ? null : react.createElement("div", {
				className: "tfc-panel",
				role: "dialog",
				"aria-label": t("activity.title")
			}, react.createElement("div", { className: "tfc-panel-head" }, react.createElement("span", { className: "tfc-item-title" }, t("activity.title")), react.createElement(Button, {
				variant: "ghost",
				onClick: () => store.refresh()
			}, t("action.refresh"))), react.createElement("div", {
				className: "tfc-caption",
				style: { padding: "0 8px" }
			}, summarize(t, live, openTasks, blocked)), runs.length === 0 && tasks.length === 0 ? react.createElement(Empty, { label: t("activity.empty") }) : null, runs.map((run) => react.createElement("div", {
				key: "run-" + run.id,
				className: "tfc-panel-row"
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, "#" + run.id.slice(-8) + " · " + (run.workflowId || "—")), react.createElement("span", { className: "tfc-item-sub" }, formatTime(run.startedAt))), react.createElement("div", { style: { width: 56 } }, react.createElement(ProgressBar, { percent: store.runProgress(run) })), react.createElement(StatusBadge, {
				table: RUN_STATUSES,
				status: run.status
			}))), tasks.length === 0 ? null : react.createElement("div", {
				className: "tfc-col",
				style: { padding: "0 4px" }
			}, tasks.map((task) => react.createElement("div", {
				key: "task-" + task.id,
				className: "tfc-panel-row"
			}, react.createElement("div", { className: "tfc-item-main" }, react.createElement("span", { className: "tfc-item-title" }, task.requirement === "" ? task.id : task.requirement), react.createElement("span", { className: "tfc-item-sub" }, (task.assignee || "—") + " · " + t("tasks.iteration", { n: task.iteration }))), react.createElement(StatusBadge, {
				table: TASK_COLUMNS,
				status: task.status
			})))), react.createElement("div", { className: "tfc-panel-head" }, react.createElement("span", { className: "tfc-caption" }, t("activity.openSettings")), react.createElement(Chip, null, "settings.section: team-flowise")));
			return react.createElement("div", {
				ref: rootRef,
				style: { position: "relative" }
			}, trigger, panel);
		}
		//#endregion
		//#region src/client/index.js
		/** Locale namespaces this package answers for. */
		const inject = ["slots"];
		/**
		* Wrap a surface so it renders inside the store provider.
		*
		* `React.createElement` and not JSX: the client half is delivered to the browser
		* verbatim, with no JSX or TypeScript transform in the pipeline.
		*
		* @param store - the store created by {@link apply}.
		* @param Surface - the component to wrap.
		* @returns a component with no required props of its own.
		*/
		function withStore(store, Surface) {
			return function TeamSurface(props) {
				return react.createElement(TeamProvider, { store }, react.createElement(Surface, props));
			};
		}
		/**
		* Register the package's three surfaces.
		*
		* Effects are declared with `ctx.effect(...)` and slot registrations happen
		* inside `slots.inject(...)`, so stopping or updating the plugin removes the
		* stylesheet, both slot entries, and the polling store together.
		*
		* @param ctx - the client root context.
		*/
		function apply(ctx) {
			if (ctx === void 0 || ctx === null || typeof ctx.get !== "function") return;
			ctx.effect(() => injectStyles(), "team-flowise-client: stylesheet");
			const locale = ctx.get("locale");
			if (locale !== void 0 && locale !== null && typeof locale.register === "function") try {
				ctx.effect(() => locale.register(LOCALE_NAMESPACE, DICTIONARIES), "team-flowise-client: dictionaries");
			} catch (error) {
				if (ctx.logger !== void 0 && typeof ctx.logger.warn === "function") ctx.logger.warn(error);
			}
			const slots = ctx.get("slots");
			if (slots === void 0 || slots === null || typeof slots.register !== "function") return;
			const store = createTeamStore();
			slots.inject(SETTINGS_SECTION.slot, () => slots.register({
				name: SETTINGS_SECTION.slot,
				id: SETTINGS_SECTION.id,
				order: SETTINGS_SECTION.order,
				label: SETTINGS_SECTION.label
			}, withStore(store, TeamSettingsSection)));
			slots.inject(SESSION_HEADER_ACTION.slot, () => slots.register({
				name: SESSION_HEADER_ACTION.slot,
				id: SESSION_HEADER_ACTION.id,
				order: SESSION_HEADER_ACTION.order,
				label: SESSION_HEADER_ACTION.label
			}, withStore(store, TeamActivityAction)));
		}
		//#endregion
		exports.apply = apply;
		exports.createTeamStore = createTeamStore;
		exports.inject = inject;
		return module.exports;
	}
});
