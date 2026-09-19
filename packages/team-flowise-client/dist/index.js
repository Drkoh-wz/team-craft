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
/** Ambiguous or unknown: resolved by `matchRoute` when nothing matches. */
const ROUTE_NOT_FOUND = {
	id: "none",
	method: "GET",
	path: "/",
	summary: "No matching host route."
};
/**
* Resolve the route a request uses.
*
* Exact (method, path) wins. A `HEAD` request resolves to the `GET` route for
* the same path, mirroring what the host's WebServer route kinds accept.
*
* @param method - upper-case HTTP method.
* @param path - path without the `/api/team-flowise` prefix.
* @returns the matching route, or `ROUTE_NOT_FOUND`.
*/
function matchRoute(method, path) {
	const want = typeof method === "string" ? method.toUpperCase() : "";
	const effective = want === "HEAD" ? "GET" : want;
	for (const route of ROUTES) if (route.path === path && route.method === effective) return route;
	return ROUTE_NOT_FOUND;
}
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
/** Both contributions, in registration order. */
const CONTRIBUTIONS = [SETTINGS_SECTION, SESSION_HEADER_ACTION];
/** Locale namespace this package registers dictionaries under. */
const LOCALE_NAMESPACE = "team-flowise";
//#endregion
//#region src/node/index.js
/**
* A JSON-safe snapshot of everything this package contributes.
*
* Deliberately built by hand rather than by spreading its sources: the result is
* written to logs and asserted in tests, so it must never carry a live object.
*
* @returns `{ name, clientId, localeNamespace, apiBase, routes, tabs, contributions }`
*   where every value is a string, number, or array of those.
*/
function describeClient() {
	return {
		name: "@local/team-flowise-client",
		clientId: "@local/team-flowise-client",
		localeNamespace: LOCALE_NAMESPACE,
		apiBase: "/api/team-flowise",
		routes: ROUTES.map((route) => ({
			id: route.id,
			method: route.method,
			path: route.path
		})),
		tabs: SECTION_TABS.map((tab) => ({
			key: tab.key,
			label: tab.label
		})),
		contributions: CONTRIBUTIONS.map((entry) => ({
			slot: entry.slot,
			kind: entry.kind,
			id: entry.id,
			order: entry.order,
			label: entry.label
		}))
	};
}
//#endregion
export { API_BASE, CONTRIBUTIONS, DOMAINS, LAYOUT, LOCALE_NAMESPACE, NODE_STATUSES, ROUTES, ROUTE_NOT_FOUND, RUN_STATUSES, SECTION_TABS, SESSION_HEADER_ACTION, SETTINGS_SECTION, SLOT_KINDS, TASK_COLUMNS, TONE_VARS, decorateDag, describeClient, layoutDag, matchRoute, pickAgent, pickRun, pickTask, pickWorkflow, routeUrl, runProgress, statusEntry, topologicalOrder };

//# sourceMappingURL=index.js.map