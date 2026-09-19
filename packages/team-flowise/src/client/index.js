window.__ModuleLoader__.load({ id: '@local/team-flowise', factory: function (require) {
  var module = { exports: {} }; var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
  var React = require('react');
  var API = '/api/team-flowise';

  function get(p) { return fetch(API + p).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }
  function post(p, body) {
    return fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
  }
  function del(p) { return fetch(API + p, { method: 'DELETE' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); }); }

  var STATUS_COLUMNS = [
    { key: 'queued', label: '已排队', color: '#9aa0a6' },
    { key: 'submitted', label: '已提交', color: '#f5a623' },
    { key: 'working', label: '进行中', color: '#3b82f6' },
    { key: 'completed', label: '已完成', color: '#22c55e' },
    { key: 'reworked', label: '需返工', color: '#ef4444' }
  ];
  function statusColor(s) { for (var i = 0; i < STATUS_COLUMNS.length; i++) { if (STATUS_COLUMNS[i].key === s) return STATUS_COLUMNS[i].color; } return '#9aa0a6'; }
  function Badge(s) {
    return React.createElement('span', { style: { color: '#fff', background: statusColor(s), borderRadius: 999, padding: '1px 11px', fontSize: 12, whiteSpace: 'nowrap' } }, String(s || ''));
  }

  var STYLE = '<style>.tf-root{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937)}.tf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.tf-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-text-muted,#6b7280)}.tf-tab.active{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.tf-toolbar{display:flex;gap:8px}.tf-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;color:var(--dsw-alias-text,#1f2937)}.tf-btn.primary{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-btn.danger{color:#ef4444;border-color:#ef4444}.tf-btn:disabled{opacity:.5;cursor:default}.tf-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}.tf-col{min-width:230px;flex:0 0 230px;background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:12px;padding:10px}.tf-col-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.tf-col-title{font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}.tf-count{background:var(--dsw-alias-surface,#fff);border-radius:999px;padding:0 8px;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-card{background:var(--dsw-alias-surface,#fff);border-radius:10px;border:1px solid var(--dsw-alias-border,#e5e7eb);padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:box-shadow .15s,border-color .15s}.tf-card:hover{border-color:#3b82f6;box-shadow:0 4px 14px rgba(0,0,0,.08)}.tf-card-req{font-size:13px;font-weight:600;line-height:1.4;margin-bottom:6px}.tf-card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-chip{background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:6px;padding:1px 6px;font-size:11px}.tf-list{background:var(--dsw-alias-surface,#fff);border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;padding:12px}.tf-row{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid var(--dsw-alias-border,#e5e7eb)}.tf-row:last-child{border-bottom:none}.tf-row-main{flex:1;min-width:0}.tf-row-title{font-size:13px;font-weight:600}.tf-row-sub{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-top:2px}.tf-icon-btn{background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-icon-btn:hover{color:#3b82f6}.tf-empty{padding:24px;text-align:center;color:var(--dsw-alias-text-muted,#6b7280);font-size:13px}.tf-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}.tf-modal-card{background:var(--dsw-alias-surface,#fff);border-radius:14px;padding:20px;width:min(560px,92vw);max-height:88vh;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)}.tf-field{margin-bottom:12px}.tf-field-label{font-size:12px;font-weight:600;margin-bottom:5px;color:var(--dsw-alias-text,#1f2937);display:block}.tf-input,.tf-select,.tf-textarea{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);font-size:13px;background:var(--dsw-alias-surface,#fff);color:var(--dsw-alias-text,#1f2937)}.tf-textarea{min-height:70px;resize:vertical;font-family:inherit}.tf-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}</style>';

  function Modal(props) {
    if (!props.open) return null;
    return React.createElement('div', { className: 'tf-modal', onClick: function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); } },
      React.createElement('div', { className: 'tf-modal-card' },
        React.createElement('h3', { style: { margin: '0 0 16px', fontSize: 16 } }, props.title),
        props.children
      )
    );
  }

  // The view components are declared at module scope on purpose: declaring them inside Board
  // created a brand new component type on every render, so React unmounted and rebuilt the whole
  // subtree (losing input focus/state) instead of just re-rendering it.
  function BoardView(props) {
    var by = {};
    props.tasks.forEach(function (t) { (by[t.status] = by[t.status] || []).push(t); });
    var cols = STATUS_COLUMNS.map(function (c) {
      var items = by[c.key] || [];
      var cards = items.length ? items.map(function (t) {
        return React.createElement('div', { key: t.id, className: 'tf-card', onClick: function () { props.onOpenTask(t); } },
          React.createElement('div', { className: 'tf-card-req' }, t.requirement),
          React.createElement('div', { className: 'tf-card-meta' },
            React.createElement('span', { className: 'tf-chip' }, '#' + (t.assignee || '?')),
            t.reviewer ? React.createElement('span', { className: 'tf-chip' }, 'rev:' + t.reviewer) : null,
            React.createElement('span', null, 'it' + (t.iteration || 1)),
            t.history && t.history.length ? React.createElement('span', null, t.history.length + '步') : null
          )
        );
      }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无任务')];
      return React.createElement('div', { key: c.key, className: 'tf-col' },
        React.createElement('div', { className: 'tf-col-head' },
          React.createElement('span', { className: 'tf-col-title', style: { color: c.color } }, c.label),
          React.createElement('span', { className: 'tf-count' }, items.length)
        ),
        cards
      );
    });
    return React.createElement('div', { className: 'tf-board' }, cols);
  }

  function AgentsView(props) {
    var rows = props.agents.length ? props.agents.map(function (a) {
      return React.createElement('div', { key: a.id, className: 'tf-row' },
        React.createElement('div', { className: 'tf-row-main' },
          React.createElement('div', { className: 'tf-row-title' }, a.name),
          React.createElement('div', { className: 'tf-row-sub' }, (a.role || '') + (a.model && a.model.name ? ' · ' + a.model.name : ''))
        ),
        React.createElement('span', { className: 'tf-chip' }, Object.keys(a.tools || {}).length + ' 工具'),
        React.createElement('button', { className: 'tf-btn', onClick: function () { props.onOpenAgent(a); } }, '详情')
      );
    }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无 Agent')];
    return React.createElement('div', { className: 'tf-list' }, rows);
  }

  function WorkflowsView(props) {
    var rows = props.workflows.length ? props.workflows.map(function (x) {
      var nodeCount = Object.keys(x.nodes || {}).length;
      return React.createElement('div', { key: x.id, className: 'tf-row' },
        React.createElement('div', { className: 'tf-row-main' },
          React.createElement('div', { className: 'tf-row-title' }, x.name),
          React.createElement('div', { className: 'tf-row-sub' }, (x.description || '') + (x.description ? ' · ' : '') + nodeCount + ' 节点')
        ),
        React.createElement('button', { className: 'tf-btn primary', disabled: props.loading, onClick: function () { props.onRun(x); } }, '运行'),
        React.createElement('button', { className: 'tf-btn danger', onClick: function () { props.onDelete(x); } }, '删除')
      );
    }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无工作流')];
    return React.createElement('div', { className: 'tf-list' }, rows);
  }

  function RunsView(props) {
    var rows = props.runs.length ? props.runs.map(function (x) {
      var ns = x.nodeStates || {};
      // nodeStates values are objects ({status, assignee, startedAt, ...}), not status
      // strings. Comparing the object itself to 'completed' was always false, so this bar
      // read 0% no matter what the run had done — contradicting the progress panel, which
      // reads the same data correctly. Accept both shapes so older runs still render.
      var statusOf = function (v) { return (v && typeof v === 'object') ? v.status : v; };
      var done = Object.keys(ns).filter(function (k) { var v = statusOf(ns[k]); return v === 'completed' || v === 'success'; }).length;
      var total = Object.keys(ns).length;
      var pct = total ? Math.round(done / total * 100) : 0;
      return React.createElement('div', { key: x.id, className: 'tf-row' },
        React.createElement('div', { className: 'tf-row-main' },
          React.createElement('div', { className: 'tf-row-title' }, '运行 #' + (x.id || '').slice(-6)),
          React.createElement('div', { className: 'tf-row-sub' }, (x.workflowId || '') + ' · ' + new Date(x.startedAt).toLocaleString())
        ),
        React.createElement('div', { style: { width: 90 } },
          React.createElement('div', { className: 'tf-progress' }, React.createElement('div', { className: 'tf-progress-bar', style: { width: pct + '%' } }))
        ),
        React.createElement(Badge, null, x.status)
      );
    }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无运行')];
    return React.createElement('div', { className: 'tf-list' }, rows);
  }

  function TasksView(props) {
    var rows = props.tasks.length ? props.tasks.map(function (t) {
      return React.createElement('div', { key: t.id, className: 'tf-row' },
        React.createElement('div', { className: 'tf-row-main' },
          React.createElement('div', { className: 'tf-row-title' }, t.requirement),
          React.createElement('div', { className: 'tf-row-sub' }, (t.assignee || '') + (t.reviewer ? ' · 评审:' + t.reviewer : '') + ' · it' + (t.iteration || 1))
        ),
        React.createElement(Badge, null, t.status),
        React.createElement('button', { className: 'tf-icon-btn', onClick: function () { props.onOpenTask(t); } }, '\u270E')
      );
    }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无任务')];
    return React.createElement('div', { className: 'tf-list' }, rows);
  }

  function Board() {
    var st = React.useState({ tab: 'board', a: [], w: [], t: [], r: [], run: null, modal: null, task: null, loading: false, error: null, feedback: '' });
    var s = st[0]; var set = st[1];
    // Form draft used to be a plain object re-created on every render, so a re-render (e.g. the
    // 5s poll) wiped typed input and never echoed the task being edited. It is React state now.
    var dt = React.useState({ assignee: '', requirement: '', acceptanceCriteria: '', reviewer: '', feedback: '' });
    var draft = dt[0]; var patchDraft = dt[1];
    var taskRef = React.useRef(null); taskRef.current = s.task;

    // Functional-only writes. The old patch merged a render-time state snapshot into the new
    // state, so any long-lived callback kept writing the FIRST render's values back - tab included.
    var patch = React.useCallback(function (p) {
      set(function (prev) { return Object.assign({}, prev, typeof p === 'function' ? p(prev) : p); });
    }, []);
    var setForm = React.useCallback(function (p) {
      patchDraft(function (prev) { return Object.assign({}, prev, typeof p === 'function' ? p(prev) : p); });
    }, []);

    var load = React.useCallback(function () {
      Promise.all([
        get('/agents').then(function (d) { return d.agents; }).catch(function () { return []; }),
        get('/workflows').then(function (d) { return d.workflows; }).catch(function () { return []; }),
        get('/tasks').then(function (d) { return d.tasks; }).catch(function () { return []; }),
        get('/runs').then(function (d) { return d.runs; }).catch(function () { return []; })
      ]).then(function (x) { patch({ a: x[0], w: x[1], t: x[2], r: x[3] }); });
    }, [patch]);

    React.useEffect(function () { load(); var id = setInterval(load, 5000); return function () { clearInterval(id); }; }, [load]);

    function runAction(fn) {
      patch({ loading: true, error: null });
      Promise.resolve().then(fn).then(load).catch(function (e) { patch({ error: String(e && e.message ? e.message : e) }); }).then(function () { patch({ loading: false }); });
    }

    function createTask() {
      if (!draft.requirement) return;
      patch({ loading: true, error: null });
      post('/task/create', { assignee: draft.assignee, requirement: draft.requirement, acceptanceCriteria: draft.acceptanceCriteria, reviewer: draft.reviewer })
        .then(load).then(function () { patch({ modal: null, task: null, loading: false }); })
        .catch(function (e) { patch({ error: String(e.message || e), loading: false }); });
    }

    function reworkTask() {
      var t = taskRef.current;
      var feedback = draft.feedback;
      if (!t || !feedback) return;
      post('/task/rework', { id: t.id, feedback: feedback })
        .then(load).then(function () { patch({ modal: null, task: null }); setForm({ feedback: '' }); })
        .catch(function (e) { patch({ error: String(e.message || e) }); });
    }

    // Seeds the draft state from the clicked task so the modal echoes the current values.
    function openTask(t){
      setForm({
        assignee: (t && t.assignee) || '',
        requirement: (t && t.requirement) || '',
        acceptanceCriteria: (t && t.acceptanceCriteria) || '',
        reviewer: (t && t.reviewer) || '',
        feedback: ''
      });
      patch({ modal: 'task', task: t || null });
    }

    function openAgent(a) { patch({ modal: 'agent', agent: a }); }
    function startRun(w) { runAction(function () { return post('/run/start', { workflowId: w.id }); }); }
    function deleteWorkflow(w) { runAction(function () { return del('/workflow?id=' + encodeURIComponent(w.id)); }); }

    var body;
    if (s.tab === 'agents') body = React.createElement(AgentsView, { agents: s.a, onOpenAgent: openAgent });
    else if (s.tab === 'workflows') body = React.createElement(WorkflowsView, { workflows: s.w, loading: s.loading, onRun: startRun, onDelete: deleteWorkflow });
    else if (s.tab === 'tasks') body = React.createElement(TasksView, { tasks: s.t, onOpenTask: openTask });
    else if (s.tab === 'runs') body = React.createElement(RunsView, { runs: s.r });
    else body = React.createElement(BoardView, { tasks: s.t, onOpenTask: openTask });

    var modal = null; var modalTitle = '';
    if (s.modal === 'task') {
      var isEdit = !!(s.task && s.task.id);
      modalTitle = isEdit ? '编辑任务' : '新建任务';
      modal = React.createElement('div', null,
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '指派 Agent'),
          React.createElement('select', { className: 'tf-select', value: draft.assignee, onChange: function (e) { setForm({ assignee: e.target.value }); } },
            React.createElement('option', { value: '' }, '(未指派)'),
            s.a.map(function (a) { return React.createElement('option', { key: a.id, value: a.name || a.id }, a.name || a.id); })
          )
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '需求'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.requirement, onChange: function (e) { setForm({ requirement: e.target.value }); } })
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '验收标准'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.acceptanceCriteria, onChange: function (e) { setForm({ acceptanceCriteria: e.target.value }); } })
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '评审人'),
          React.createElement('select', { className: 'tf-select', value: draft.reviewer, onChange: function (e) { setForm({ reviewer: e.target.value }); } },
            React.createElement('option', { value: '' }, '(无)'),
            s.a.map(function (a) { return React.createElement('option', { key: a.id, value: a.name || a.id }, a.name || a.id); })
          )
        ),
        isEdit ? React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '返工反馈'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.feedback, onChange: function (e) { setForm({ feedback: e.target.value }); } })
        ) : null,
        React.createElement('div', { className: 'tf-modal-actions' },
          React.createElement('button', { className: 'tf-btn', onClick: function () { patch({ modal: null, task: null }); } }, '取消'),
          isEdit
            ? React.createElement('button', { className: 'tf-btn danger', disabled: !draft.feedback, onClick: reworkTask }, '提交返工')
            : React.createElement('button', { className: 'tf-btn primary', disabled: !draft.requirement, onClick: createTask }, '创建任务')
        )
      );
    } else if (s.modal === 'agent') {
      var ag = s.agent || {};
      modalTitle = 'Agent \u00B7 ' + (ag.name || '');
      var toolKeys = Object.keys(ag.tools || {});
      modal = React.createElement('div', null,
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '角色'), React.createElement('div', null, ag.role || '\u2014')),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '模型'), React.createElement('div', null, (ag.model && ag.model.name) || '\u2014')),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '系统提示'),
          React.createElement('div', { style: { fontSize: 13, whiteSpace: 'pre-wrap', color: '#374151' } }, ag.systemPrompt || '\u2014')
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '工具'),
          React.createElement('div', null, (toolKeys.length ? toolKeys.join(', ') : '\u2014'))
        ),
        React.createElement('div', { className: 'tf-modal-actions' },
          React.createElement('button', { className: 'tf-btn', onClick: function () { patch({ modal: null, agent: null }); } }, '关闭')
        )
      );
    }

    return React.createElement('div', { className: 'tf-root' },
      React.createElement('style', null, STYLE),
      React.createElement('div', { className: 'tf-head' },
        React.createElement('h3', { style: { margin: 0 } }, '多 Agent 团队'),
        React.createElement('div', { className: 'tf-toolbar' },
          React.createElement('button', { className: 'tf-btn', onClick: load, disabled: s.loading }, '刷新'),
          React.createElement('button', { className: 'tf-btn primary', onClick: function () { openTask(null); } }, '+ 新建任务')
        )
      ),
      React.createElement('div', { className: 'tf-tabs' },
        [['board', '看板'], ['agents', 'Agents'], ['workflows', '工作流'], ['tasks', '任务'], ['runs', '运行']].map(function (x) {
          return React.createElement('button', { key: x[0], className: 'tf-tab' + (s.tab === x[0] ? ' active' : ''), onClick: function () { patch({ tab: x[0] }); } }, x[1]);
        })
      ),
      s.error ? React.createElement('div', { style: { color: '#ef4444', fontSize: 12, marginBottom: 8 } }, '错误: ' + s.error) : null,
      body,
      modal ? React.createElement(Modal, { open: true, title: modalTitle, onClose: function () { patch({ modal: null, task: null }); } }, modal) : null
    );
  }

  // ---------------------------------------------------------------------------
  // P7-B2 常驻进度面板（shell.overlay / team-progress）
  // 它与 settings.section 的看板是两个各自独立的 slots.register 条目：独立组件、独立
  // state、独立 fetch（只打 /api/team-flowise/progress），既不调用看板的 load/patch，
  // 也不读写看板的任何模块级可变状态。因此它自己的 3s 轮询在结构上不可能改变看板页
  // 的可见交互状态（标签、弹窗、表单草稿、loading、错误横幅）。
  // ---------------------------------------------------------------------------
  var POLL_MS = 3000;
  var PANEL_COLLAPSED_KEY = 'tf-progress-collapsed';
  var panelCollapsedMemory = null;  // localStorage 不可用时的模块内回退

  var PANEL_STYLE = '<style>.tf-pp{position:absolute;right:16px;bottom:16px;width:260px;max-height:40vh;overflow:auto;box-sizing:border-box;background:var(--dsw-alias-surface,#fff);border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.16);padding:10px 12px;pointer-events:auto;z-index:1;font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:12px;color:var(--dsw-alias-text,#1f2937)}.tf-pp.collapsed{display:inline-flex;align-items:center;gap:6px;width:auto;max-width:260px;padding:5px 10px;border-radius:999px;cursor:pointer}.tf-pp-head{display:flex;align-items:center;gap:6px}.tf-pp-title{font-size:12px;font-weight:700;white-space:nowrap}.tf-pp-sub{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tf-pp-spacer{flex:1 1 auto}.tf-pp-badge{border-radius:999px;padding:1px 8px;font-size:11px;color:#fff;white-space:nowrap}.tf-pp-toggle{border:none;background:transparent;cursor:pointer;font-size:11px;line-height:1;padding:2px 4px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-pp-toggle:hover{color:#3b82f6}.tf-pp-body{margin-top:8px}.tf-pp-counts{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-top:6px}.tf-pp-nodes{margin-top:8px;display:flex;flex-direction:column;gap:4px}.tf-pp-node{display:flex;align-items:center;gap:6px;font-size:11px}.tf-pp-node-id{font-weight:600;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tf-pp-node-meta{color:var(--dsw-alias-text-muted,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tf-pp-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;display:inline-block}.tf-pp-err{font-size:11px;color:#ef4444;margin-top:6px}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden;margin-top:6px}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}</style>';

  // 收起状态：优先 localStorage（跨刷新记住），受限上下文/隐私模式下退化为模块内变量。
  function readPanelCollapsed() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var raw = localStorage.getItem(PANEL_COLLAPSED_KEY);
        if (raw === '1') return true;
        if (raw === '0') return false;
      }
    } catch (e) { /* 存储不可用：用模块内记忆 */ }
    return panelCollapsedMemory === true;
  }
  function writePanelCollapsed(value) {
    panelCollapsedMemory = value === true;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(PANEL_COLLAPSED_KEY, value === true ? '1' : '0');
    } catch (e) { /* 同上 */ }
  }

  var IDLE_COLOR = '#9aa0a6';
  var RUNNING_COLOR = '#3b82f6';
  var FAILED_COLOR = '#ef4444';
  var NODE_STATUS = {
    pending: { label: '等待', color: IDLE_COLOR },
    working: { label: '进行中', color: RUNNING_COLOR },
    completed: { label: '已完成', color: '#22c55e' },
    failed: { label: '失败', color: FAILED_COLOR }
  };
  var RUN_STATUS = {
    running: { label: '运行中', color: RUNNING_COLOR },
    completed: { label: '已完成', color: '#22c55e' },
    failed: { label: '失败', color: FAILED_COLOR },
    cancelled: { label: '已取消', color: IDLE_COLOR },
    interrupted: { label: '已中断', color: IDLE_COLOR }
  };
  function nodeInfo(status) { return NODE_STATUS[status] || NODE_STATUS.pending; }
  function runInfo(status) { return RUN_STATUS[status] || { label: String(status || '未知'), color: IDLE_COLOR }; }
  function fmtElapsed(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '';
    var sec = Math.round(ms / 1000);
    if (sec < 60) return sec + 's';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm' + (sec % 60 ? String(sec % 60) + 's' : '');
    return Math.floor(min / 60) + 'h' + (min % 60) + 'm';
  }

  // 常驻面板：定义在模块作用域（不在 Board 内），因此不会随看板重挂载，也不继承看板的闭包。
  function ProgressPanel() {
    var st = React.useState({ data: null, error: null });
    var state = st[0]; var setState = st[1];
    var cs = React.useState(readPanelCollapsed);
    var collapsed = cs[0]; var setCollapsed = cs[1];

    // 面板唯一的数据来源：/api/team-flowise/progress。不请求 /agents /tasks /runs /workflows，
    // 所以面板的每次轮询都不会触碰看板的数据面（可被桩 fetch 逐条证明）。
    var tick = React.useCallback(function () {
      return get('/progress').then(function (d) {
        setState(function () { return { data: d, error: null }; });
      }).catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        setState(function (prev) { return { data: prev.data, error: msg }; });
      });
    }, []);

    // 展开时每 3s 轮询；收起时不挂定时器（挂载/展开时立即取一次）。
    React.useEffect(function () {
      tick();
      if (collapsed) return undefined;
      var id = setInterval(tick, POLL_MS);
      return function () { clearInterval(id); };
    }, [tick, collapsed]);

    function toggle() { var next = !collapsed; setCollapsed(next); writePanelCollapsed(next); }

    var data = state.data || null;
    var run = data !== null && data.run ? data.run : null;
    var nodes = data !== null && data.nodes ? data.nodes : [];
    var totals = data !== null && data.totals ? data.totals : { total: 0, completed: 0, failed: 0, working: 0, pending: 0, percent: 0 };
    var failed = totals.failed || 0;
    var percent = totals.percent || 0;
    var isFailed = (run !== null && run.status === 'failed') || failed > 0;
    var accent = run === null ? IDLE_COLOR : (isFailed ? FAILED_COLOR : (run.status === 'running' ? RUNNING_COLOR : runInfo(run.status).color));
    var shortId = run !== null && run.id ? String(run.id).slice(-6) : '';
    var styleEl = React.createElement('style', { key: 'css' }, PANEL_STYLE);

    // 收起态：一行紧凑胶囊；与展开态共用同一个组件类型与同一个根节点类型（div），
    // 所以切换不会丢 hook 状态。
    if (collapsed) {
      return React.createElement('div', { className: 'tf-pp collapsed', style: { pointerEvents: 'auto' }, title: '多角色运行进度（点击展开）', onClick: toggle },
        styleEl,
        React.createElement('span', { className: 'tf-pp-dot', style: { background: accent } }),
        React.createElement('span', { className: 'tf-pp-title' }, '多角色运行'),
        React.createElement('span', { className: 'tf-pp-sub' }, run === null ? '暂无运行' : (percent + '%' + (failed ? ' · 失败' + failed : (totals.working ? ' · 进行' + totals.working : ''))))
      );
    }

    var rows = [];
    rows.push(React.createElement('div', { className: 'tf-pp-head', key: 'head' },
      React.createElement('span', { className: 'tf-pp-title' }, '多角色运行'),
      React.createElement('span', { className: 'tf-pp-sub' }, run === null ? '暂无运行' : ('#' + shortId)),
      React.createElement('span', { className: 'tf-pp-spacer' }),
      run === null ? null : React.createElement('span', { className: 'tf-pp-badge', style: { background: runInfo(run.status).color } }, runInfo(run.status).label),
      React.createElement('button', { className: 'tf-pp-toggle', title: '收起面板', onClick: toggle }, '收起')
    ));

    // 无运行时只显示空闲态：不画 0% 进度条，避免被误读为「跑起来了但没进展」。
    if (run === null) {
      rows.push(React.createElement('div', { className: 'tf-pp-body', key: 'idle' }, '暂无运行'));
    } else {
      rows.push(React.createElement('div', { className: 'tf-pp-body', key: 'body' },
        React.createElement('div', { className: 'tf-pp-sub' }, String(run.workflowId || '(未知工作流)')),
        React.createElement('div', { className: 'tf-progress' },
          React.createElement('div', { className: 'tf-progress-bar', style: { width: percent + '%', background: isFailed ? FAILED_COLOR : RUNNING_COLOR } })
        ),
        React.createElement('div', { className: 'tf-pp-counts' }, percent + '% · 完成 ' + (totals.completed || 0) + '/' + (totals.total || 0) + ' · 失败 ' + failed + ' · 进行中 ' + (totals.working || 0) + ' · 等待 ' + (totals.pending || 0)),
        nodes.length ? React.createElement('div', { className: 'tf-pp-nodes' }, nodes.map(function (n) {
          var info = nodeInfo(n.status);
          var tail = n.status === 'pending' ? '等待' : (fmtElapsed(n.elapsedMs) || info.label);
          return React.createElement('div', { key: n.id, className: 'tf-pp-node' },
            React.createElement('span', { className: 'tf-pp-dot', style: { background: info.color } }),
            React.createElement('span', { className: 'tf-pp-node-id' }, String(n.id)),
            React.createElement('span', { className: 'tf-pp-node-meta' }, (n.agent ? String(n.agent) + ' · ' : '') + info.label + (tail === info.label ? '' : ' · ' + tail))
          );
        })) : null
      ));
    }
    if (state.error) rows.push(React.createElement('div', { className: 'tf-pp-err', key: 'err' }, '进度获取失败: ' + state.error));

    return React.createElement('div', { className: 'tf-pp', style: { pointerEvents: 'auto' } }, styleEl, rows);
  }

  function apply(ctx) {
    var slots = ctx.get('slots');
    if (slots === undefined) return;
    // 两个条目共存：list 类槽位是叠加而非替换，所以看板与新面板互不干扰。
    slots.inject('settings.section', function () {
      var un = slots.register({ name: 'settings.section', id: 'team', order: 500, label: '多 Agent 团队' }, Board);
      return function () { un(); };
    });
    // shell.overlay：kind:'list'、scope:'root' 的全帧浮层，位于所有列之上、在各列滚动
    // 容器之外且始终挂载；该层本身 click-through，条目必须自己 opt-in 指针事件
    // （面板容器已显式 pointer-events:auto）。新 id 'team-progress' 是叠加注册。
    slots.inject('shell.overlay', function () {
      var un = slots.register({ name: 'shell.overlay', id: 'team-progress', order: 900 }, ProgressPanel);
      return function () { un(); };
    });
  }
  exports.name = 'team-flowise-client'; exports.inject = ['slots', 'locale']; exports.apply = apply; return module.exports;
} });