// P15: does the RUNNING dsh process honour `haltOnFailure` -- and only when it should?
//
// Every other halt test imports src/index.js and drives the scheduler in-process.
// None of them can prove that the code the DAEMON actually loaded behaves this
// way: the host half is assembled at startup from the profile's patch layer, so
// "the file is correct" and "the process is correct" are different claims.
//
// This suite makes the second claim, over the real REST API, in two runs:
//
//   EXPERIMENT (wf `p15-live-halt-probe`, haltOnFailure: true)
//     probe-a runs on a role whose timeoutMs is 1 (the clamp floors it at 1000 ms)
//     and is ordered to run a ~30 s shell command, so it CANNOT finish in budget.
//     probe-b dependsOn probe-a and must therefore be SKIPPED. Asserted: status
//     `halted`; probe-a `failed`; probe-b `skipped` with `blockedBy: probe-a`,
//     `endedAt: null` and no `error` key; and a result whose key set is exactly
//     the halt one.
//
//   CONTROL (wf `p15-live-control-probe`, haltOnFailure: true, nothing fails)
//     Both nodes complete. Asserted: status `completed`, both nodes `completed`,
//     and a result whose keys are exactly `outputs,summary,reviews` -- the halt
//     vocabulary must NOT leak into a run that did not halt. This is the half
//     that fails if someone "fixes" haltOnFailure by making it always halt.
//
// The control deliberately runs LAST, so the newest run on the board is an
// ordinary successful one. p8-acceptance reads the newest run for its live
// phase; leaving a degenerate one on top would make an unrelated suite look red.
//
// The failure in the experiment is induced by a long command rather than by a
// one-second budget racing a one-word answer, because the latter is a coin flip
// and a suite that flips coins is worse than no suite. If the worker still
// answers from memory, the attempt proves nothing, so it is retried and the
// suite says so rather than reporting a false PASS.
//
// Both probe roles and both probe workflows are deleted in teardown. The run
// records are left behind on purpose: they are the evidence.
//
// Usage:
//   node validation/p15-live-halt.mjs
//   TF_ORIGIN=http://127.0.0.1:3080 node validation/p15-live-halt.mjs
//
// Exit code: 0 = all checks passed (or no host is running -> SKIP),
//            1 = at least one failed.

const ORIGIN = (process.env.TF_ORIGIN && process.env.TF_ORIGIN.trim() !== '' ? process.env.TF_ORIGIN.trim() : 'http://127.0.0.1:3080').replace(/\/+$/, '')
const ROLE_SLOW = 'p15-probe-slow'
const ROLE_OK = 'p15-probe-ok'
const WF_HALT = 'p15-live-halt-probe'
const WF_CONTROL = 'p15-live-control-probe'
const HALT_RESULT_KEYS = ['haltReason', 'haltedBy', 'outputs', 'reviews', 'skipped', 'summary']
const NORMAL_RESULT_KEYS = ['outputs', 'reviews', 'summary']
const TERMINAL = ['completed', 'failed', 'halted', 'interrupted']
const POLL_MS = 2000
const POLL_BUDGET_MS = 150000
const ATTEMPTS = 3

let checks = 0
let failures = 0
const failedLabels = []
function check(label, ok, detail) {
	checks += 1
	if (ok) { console.log('  ok   ' + label + (detail ? '  -> ' + detail : '')); return true }
	failures += 1
	failedLabels.push(label)
	console.log('  FAIL ' + label + (detail ? '  -> ' + detail : ''))
	return false
}
function skip(label, detail) { console.log('  ...  ' + label + (detail ? '  -> ' + detail : '')) }
function summaryLine() {
	console.log('\n=== SUMMARY ===')
	console.log('checks=' + checks + '  failures=' + failures)
	console.log('target: ' + ORIGIN)
	if (failedLabels.length > 0) {
		console.log('failed checks:')
		for (const l of failedLabels) console.log('  - ' + l)
	}
	console.log(failures === 0 ? '\nRESULT: PASS' : '\nRESULT: FAIL')
	return failures
}
process.on('uncaughtException', (e) => {
	check('未捕获异常：本次运行在此中断，后续检查未执行', false, String(e && e.stack ? e.stack.split('\n')[0] : e))
	console.error(String(e && e.stack ? e.stack : e))
	process.exit(1)
})

const api = {
	async get(path) {
		const ctl = new AbortController()
		const t = setTimeout(() => ctl.abort(), 20000)
		try {
			const r = await fetch(ORIGIN + path, { signal: ctl.signal })
			return { status: r.status, body: await r.json() }
		} finally { clearTimeout(t) }
	},
	async post(path, body) {
		const r = await fetch(ORIGIN + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
		const text = await r.text()
		let parsed = null
		try { parsed = JSON.parse(text) } catch { /* keep the text */ }
		return { status: r.status, body: parsed === null ? text : parsed }
	},
	async del(path) {
		const r = await fetch(ORIGIN + path, { method: 'DELETE' })
		return { status: r.status, text: await r.text() }
	},
}
const listOf = (x, k) => (Array.isArray(x) ? x : (x && x[k]) || [])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const role = (id, over) => Object.assign({
	id, name: id,
	role: 'P15 fail-fast probe role (created and removed by validation/p15-live-halt.mjs)',
	systemPrompt: 'You are a probe used to test workflow fail-fast. Obey the task literally.',
	model: { provider: 'deepseek-official', model: 'deepseek-flash' },
	tools: { preset: 'full' },
	timeoutMs: 300000,
}, over)
const mkNode = (id, title, agent, deps, requirement) => ({
	id, title, agent, dependsOn: deps,
	taskTemplate: { requirement, acceptanceCriteria: 'the task was carried out exactly as instructed' },
})

const ROLE_SLOW_DEF = role(ROLE_SLOW, {
	role: 'P15 fail-fast probe: a role whose budget cannot cover its task',
	tools: { preset: 'full' },
	timeoutMs: 1,
})
const ROLE_OK_DEF = role(ROLE_OK, { tools: { preset: 'read-only' }, timeoutMs: 300000 })

const LONG_TASK = 'Run this exact shell command and wait for it to finish before replying: ping -n 30 127.0.0.1 (if the shell is not Windows, use: sleep 30). Then reply with the word done.'
const WF_HALT_DEF = {
	id: WF_HALT,
	name: 'P15 live halt probe',
	description: 'probe-a cannot finish inside its budget; probe-b depends on it. haltOnFailure: true.',
	haltOnFailure: true,
	nodes: {
		'probe-a': mkNode('probe-a', '探针 A：1 秒预算内必然超时', ROLE_SLOW, [], LONG_TASK),
		'probe-b': mkNode('probe-b', '探针 B：依赖 A，应当被跳过', ROLE_SLOW, ['probe-a'], 'Reply with exactly one word: b'),
	},
}
const WF_CONTROL_DEF = {
	id: WF_CONTROL,
	name: 'P15 live control probe',
	description: 'Same shape, nothing fails. haltOnFailure: true must stay silent.',
	haltOnFailure: true,
	nodes: {
		'ctrl-a': mkNode('ctrl-a', '对照 A：正常完成', ROLE_OK, [], 'Reply with exactly one word: a'),
		'ctrl-b': mkNode('ctrl-b', '对照 B：依赖 A，正常完成', ROLE_OK, ['ctrl-a'], 'Reply with exactly one word: b'),
	},
}

async function startAndWait(workflowId) {
	const started = await api.post('/api/team-flowise/run/start', { workflowId })
	const runId = started.body && started.body.run && started.body.run.id
	if (!runId) return { runId: null, rec: null, started }
	const t0 = Date.now()
	let rec = null
	while (Date.now() - t0 < POLL_BUDGET_MS) {
		await sleep(POLL_MS)
		const runs = listOf((await api.get('/api/team-flowise/runs')).body, 'runs')
		rec = runs.find((r) => r.id === runId) || null
		if (rec && TERMINAL.includes(rec.status)) break
	}
	return { runId, rec, started, seconds: (Date.now() - t0) / 1000 }
}

console.log('=== P15 live haltOnFailure test (against a running dsh) ===')
console.log('target: ' + ORIGIN)

// An unreachable host is a SKIP, not a failure: this suite is opt-in by having a
// daemon up, exactly like the live phase of p8-acceptance.
try {
	const ping = await api.get('/api/team-flowise/ping')
	if (ping.status !== 200) throw new Error('HTTP ' + ping.status)
} catch (e) {
	skip('no reachable dsh at ' + ORIGIN + ' (' + (e && e.message ? e.message : e) + ') -- live halt checks are SKIPPED')
	console.log('\n=== SUMMARY ===\nchecks=0  failures=0\nRESULT: PASS (skipped: no running host)')
	process.exit(0)
}

try {
	/* ---------------------------------------------------------- experiment */
	console.log('\n--- setup: probe roles + workflows (all four removed again at the end) ---')
	for (const def of [ROLE_SLOW_DEF, ROLE_OK_DEF]) {
		const a = await api.post('/api/team-flowise/agent', def)
		check('probe role created: ' + def.id, a.status === 200 && a.body && a.body.ok !== false, 'HTTP ' + a.status)
	}
	for (const def of [WF_HALT_DEF, WF_CONTROL_DEF]) {
		const w = await api.post('/api/team-flowise/workflow', def)
		check('probe workflow created with haltOnFailure: true: ' + def.id, w.status === 200 && w.body && w.body.ok !== false, 'HTTP ' + w.status)
	}
	const flows = listOf((await api.get('/api/team-flowise/workflows')).body, 'workflows')
	const haltRec = flows.filter((f) => f.id === WF_HALT)
	check('the running process reads the field back (merged schema keeps haltOnFailure)',
		haltRec.length === 1 && haltRec[0].haltOnFailure === true,
		'records=' + haltRec.length + ' haltOnFailure=' + (haltRec[0] ? haltRec[0].haltOnFailure : 'n/a'))

	console.log('\n--- EXPERIMENT: induce a timeout failure, then read the halt shape ---')
	let run = null
	let attemptsUsed = 0
	for (let attempt = 1; attempt <= ATTEMPTS && run === null; attempt += 1) {
		attemptsUsed = attempt
		const { runId, rec } = await startAndWait(WF_HALT)
		if (runId === null) { check('attempt ' + attempt + ': run started', false, 'no run id returned'); break }
		if (rec === null) { check('attempt ' + attempt + ' (' + runId + '): run reached a terminal state', false, 'still running after ' + POLL_BUDGET_MS + 'ms'); continue }
		if (rec.status === 'completed') {
			skip('attempt ' + attempt + ' (' + runId + '): the worker answered without running the long command, so nothing failed -- retrying')
			continue
		}
		run = rec
	}
	if (run === null) {
		check('a failing probe run was produced within ' + ATTEMPTS + ' attempts (the worker must obey the shell instruction)', false,
			'attempts=' + attemptsUsed + '; the halt shape could not be observed')
	} else {
		const ns = run.nodeStates || {}
		const a1 = ns['probe-a'] || {}
		const b1 = ns['probe-b'] || {}
		console.log('  run under test: ' + run.id + '  status=' + run.status)
		check('A1 the run status is `halted` (not failed/completed) -- fail-fast is live in this process', run.status === 'halted', 'status=' + run.status)
		check('A2 the node that ran out of budget is `failed`', a1.status === 'failed', 'probe-a=' + a1.status + ' :: ' + String(a1.error || '').slice(0, 120))
		check('A3 the dependent node never ran: `skipped`', b1.status === 'skipped', 'probe-b=' + b1.status)
		check('A4 the skipped node names the failure that cut it off', b1.blockedBy === 'probe-a', 'blockedBy=' + JSON.stringify(b1.blockedBy))
		check('A5 a skipped node carries endedAt:null (no invented end time for an event that never happened)', b1.endedAt === null, 'endedAt=' + JSON.stringify(b1.endedAt))
		check('A6 the skipped node carries no error (it did not fail, it never started)', !Object.prototype.hasOwnProperty.call(b1, 'error'), 'keys=' + Object.keys(b1).join(','))
		const keys = Object.keys(run.result || {}).sort()
		check('A7 the run result key set is exactly the halt key set (nothing else crept in)',
			keys.join(',') === HALT_RESULT_KEYS.join(','), 'keys=' + keys.join(','))
		check('A8 result.haltedBy / haltReason / skipped carry the halt facts',
			run.result.haltedBy === 'probe-a' && run.result.haltReason === 'node-failed'
			&& Array.isArray(run.result.skipped) && run.result.skipped.join(',') === 'probe-b',
			JSON.stringify({ haltedBy: run.result.haltedBy, haltReason: run.result.haltReason, skipped: run.result.skipped }))
		check('A9 the summary says the run was stopped on purpose', /^workflow halted: /.test(String(run.result.summary)), String(run.result.summary).slice(0, 160))
		check('A10 every node state was written before the final status (the board can tell "never ran" from "not yet")',
			Object.keys(ns).sort().join(',') === 'probe-a,probe-b', 'nodes recorded=' + Object.keys(ns).join(','))
		console.log('  evidence kept on the board: halted run ' + run.id)
	}

	/* ------------------------------------------------------------- control */
	console.log('\n--- CONTROL: the same shape with nothing failing must stay silent (run LAST) ---')
	const ctl = await startAndWait(WF_CONTROL)
	if (ctl.rec === null) {
		check('control run reached a terminal state', false, 'runId=' + ctl.runId + ' not terminal after ' + POLL_BUDGET_MS + 'ms')
	} else {
		const ns = ctl.rec.nodeStates || {}
		const cKeys = Object.keys(ctl.rec.result || {}).sort()
		console.log('  control run: ' + ctl.rec.id + '  status=' + ctl.rec.status + '  (' + ctl.seconds.toFixed(1) + 's)')
		check('C1 the control run is `completed`, not `halted` (nothing failed, so nothing may be halted)', ctl.rec.status === 'completed', 'status=' + ctl.rec.status)
		check('C2 both control nodes completed',
			(ns['ctrl-a'] || {}).status === 'completed' && (ns['ctrl-b'] || {}).status === 'completed',
			'ctrl-a=' + (ns['ctrl-a'] || {}).status + ' ctrl-b=' + (ns['ctrl-b'] || {}).status)
		check('C3 no halt vocabulary leaks into a run that did not halt (result key set is the normal one)',
			cKeys.join(',') === NORMAL_RESULT_KEYS.join(','), 'keys=' + cKeys.join(','))
		check('C4 the control summary is the ordinary one', String(ctl.rec.result.summary) === 'workflow completed', String(ctl.rec.result.summary).slice(0, 120))
		check('C5 no node in the control run is `skipped`', Object.values(ns).every((n) => n.status !== 'skipped'),
			'statuses=' + Object.values(ns).map((n) => n.status).join(','))
		console.log('  newest run on the board is now the ordinary one: ' + ctl.rec.id)
	}
} finally {
	// Teardown runs unconditionally: a half-created probe must not survive a
	// failure, and deleting something that was never created is a no-op here.
	console.log('\n--- teardown ---')
	for (const id of [WF_HALT, WF_CONTROL]) {
		const d = await api.del('/api/team-flowise/workflow?id=' + encodeURIComponent(id)).catch((e) => ({ status: -1, text: String(e) }))
		check('probe workflow removed again: ' + id, d.status === 200, 'HTTP ' + d.status)
	}
	for (const id of [ROLE_SLOW, ROLE_OK]) {
		const d = await api.del('/api/team-flowise/agent?id=' + encodeURIComponent(id)).catch((e) => ({ status: -1, text: String(e) }))
		check('probe role removed again: ' + id, d.status === 200, 'HTTP ' + d.status)
	}
	const flows = listOf((await api.get('/api/team-flowise/workflows')).body, 'workflows')
	const agents = listOf((await api.get('/api/team-flowise/agents')).body, 'agents')
	const leftWf = flows.filter((f) => f.id === WF_HALT || f.id === WF_CONTROL).length
	const leftAg = agents.filter((x) => x.id === ROLE_SLOW || x.id === ROLE_OK).length
	check('B1 nothing of the probe is left in the registry', leftWf === 0 && leftAg === 0, 'workflows=' + leftWf + ' roles=' + leftAg)
}

summaryLine()
process.exit(failures === 0 ? 0 : 1)
