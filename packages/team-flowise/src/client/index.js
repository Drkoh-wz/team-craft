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

  // One board column per status the change-request ledger can report. The P10
  // review statuses ('reviewing' = the reviewer is judging the artifact,
  // 'rework' = the artifact was rejected and is being redone) are real columns:
  // without them the board would claim no task is in progress while an agent is
  // working on one.
  var STATUS_COLUMNS = [
    { key: 'queued', label: '已排队', color: '#9aa0a6' },
    { key: 'submitted', label: '已提交', color: '#f5a623' },
    { key: 'working', label: '进行中', color: '#3b82f6' },
    { key: 'reviewing', label: '审核中', color: '#7c3aed' },
    { key: 'rework', label: '返工中', color: '#ec4899' },
    { key: 'completed', label: '已完成', color: '#22c55e' },
    { key: 'reworked', label: '需返工', color: '#ef4444' }
  ];
  function statusColor(s) { for (var i = 0; i < STATUS_COLUMNS.length; i++) { if (STATUS_COLUMNS[i].key === s) return STATUS_COLUMNS[i].color; } return '#9aa0a6'; }
  // A function component is called with a PROPS OBJECT. This was declared as
  // `Badge(s)` while every caller wrote `createElement(Badge, null, status)`, so
  // `s` was `{children: status}`: statusColor() never matched a key and the label
  // stringified to the literal text "[object Object]". Every status badge in the
  // board has therefore been rendering that grey placeholder.
  function Badge(props) {
    var s = props && props.value !== undefined ? props.value : (props ? props.children : undefined);
    var label = s === undefined || s === null ? '' : String(s);
    return React.createElement('span', { style: { color: '#fff', background: statusColor(label), borderRadius: 999, padding: '1px 11px', fontSize: 12, whiteSpace: 'nowrap' } }, label);
  }

  var STYLE = '.tf-root{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937)}.tf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.tf-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-text-muted,#6b7280)}.tf-tab.active{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.tf-toolbar{display:flex;gap:8px}.tf-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;color:var(--dsw-alias-text,#1f2937)}.tf-btn.primary{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-btn.danger{color:#ef4444;border-color:#ef4444}.tf-btn:disabled{opacity:.5;cursor:default}.tf-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}.tf-col{min-width:230px;flex:0 0 230px;background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:12px;padding:10px}.tf-col-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.tf-col-title{font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}.tf-count{background:var(--dsw-alias-surface,#fff);border-radius:999px;padding:0 8px;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-card{background:var(--dsw-alias-surface,#fff);border-radius:10px;border:1px solid var(--dsw-alias-border,#e5e7eb);padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:box-shadow .15s,border-color .15s}.tf-card:hover{border-color:#3b82f6;box-shadow:0 4px 14px rgba(0,0,0,.08)}.tf-card-req{font-size:13px;font-weight:600;line-height:1.4;margin-bottom:6px}.tf-card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-chip{background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:6px;padding:1px 6px;font-size:11px}.tf-list{background:var(--dsw-alias-surface,#fff);border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;padding:12px}.tf-row{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid var(--dsw-alias-border,#e5e7eb)}.tf-row:last-child{border-bottom:none}.tf-row-main{flex:1;min-width:0}.tf-row-title{font-size:13px;font-weight:600}.tf-row-sub{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-top:2px}.tf-icon-btn{background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-icon-btn:hover{color:#3b82f6}.tf-empty{padding:24px;text-align:center;color:var(--dsw-alias-text-muted,#6b7280);font-size:13px}.tf-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}.tf-modal-card{background:var(--dsw-alias-surface,#fff);border-radius:14px;padding:20px;width:min(560px,92vw);max-height:88vh;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)}.tf-field{margin-bottom:12px}.tf-field-label{font-size:12px;font-weight:600;margin-bottom:5px;color:var(--dsw-alias-text,#1f2937);display:block}.tf-input,.tf-select,.tf-textarea{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);font-size:13px;background:var(--dsw-alias-surface,#fff);color:var(--dsw-alias-text,#1f2937)}.tf-textarea{min-height:70px;resize:vertical;font-family:inherit}.tf-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}';

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
        React.createElement(Badge, { value: x.status })
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
        React.createElement(Badge, { value: t.status }),
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
  // P8: 团队进度注册进侧边栏，取代原先覆盖整帧的浮层。
  //
  // 选型依据是实际 SlotMap，并在已安装的 ui-sidebar / ui-layout bundle 里核对了调用链
  // （不是猜的）：
  //   sidebar.panellist — kind:list, scope:root, replaceRisk:none；catalog 原文
  //     "Global panel icons. Each list id addresses the matching main panel;
  //      the sidebar owns the button and resolves its label from list metadata."
  //     ownerProps: { size: number; active: boolean }
  //   main — kind:keyed, scope:root；"Central panel selected by sidebar entry id."
  // 所以用同一个 id 'team-progress' 注册这两处：侧边栏多出一个图标按钮，点击后
  // 中央列切到本页。页面占据中央列，结构上不可能遮盖其它元素——原先的
  // shell.overlay 注册（"遮盖住页面其他案件" 的来源）连同其面板实现已删除。
  // ---------------------------------------------------------------------------
  var POLL_MS = 3000;         // /progress 轻量轮询：只有状态与计时
  var ROLE_POLL_MS = 5000;    // 角色详情仅在仍有节点在跑时跟着刷新
  var ORCH = '编排器';

  // The element is <style>; its TEXT must therefore be bare CSS. These strings
  // used to carry their own leading <style> and trailing </style>, so the parser
  // saw a malformed first qualified rule (`<style>.tf-root{...}`) and dropped it
  // -- the element's own first rule never applied.
  var PAGE_STYLE = '.tf-pg{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937);padding:2px}.tf-pg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tf-pg-title{margin:0;font-size:16px;font-weight:700}.tf-pg-sub{font-size:12px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-pg-toolbar{margin-left:auto;display:flex;gap:8px;align-items:center}.tf-pg-sec{margin-top:18px}.tf-pg-sec-h{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:8px}.tf-select{padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);color:var(--dsw-alias-text,#1f2937);font-size:12px;max-width:280px}.tf-seq-box{overflow:auto;border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;background:var(--dsw-alias-surface,#fff)}.tf-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:8px}.tf-legend span{display:inline-flex;align-items:center;gap:4px}.tf-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}.tf-chips{display:flex;gap:8px;flex-wrap:wrap}.tf-chip2{display:flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);border-radius:10px;padding:6px 11px;cursor:pointer;font-size:12px;color:inherit}.tf-chip2:hover{border-color:#3b82f6}.tf-chip2.on{border-color:#3b82f6;box-shadow:inset 0 0 0 1px #3b82f6}.tf-chip2 b{font-weight:700}.tf-ncard{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;background:var(--dsw-alias-surface,#fff);padding:12px 14px;margin-top:10px}.tf-nhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tf-nid{font-weight:700;font-size:14px}.tf-kv{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-lbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-muted,#6b7280);margin:12px 0 4px}.tf-pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-surface-2,#f8fafc);border:1px solid var(--dsw-alias-border,#eef2f7);border-radius:8px;padding:10px;max-height:300px;overflow:auto}.tf-pre.tf-reason{border-color:#8b5cf6}.tf-pre.tf-errbox{border-color:#ef4444;color:#b91c1c}.tf-badge2{border-radius:999px;padding:1px 10px;font-size:11px;color:#fff;white-space:nowrap}.tf-empty{color:var(--dsw-alias-text-muted,#6b7280);font-size:13px;padding:14px 0}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden;margin-top:6px}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}.tf-rv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tf-rv-verdict{border-radius:999px;padding:1px 10px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap}.tf-rv-group{margin-top:10px}.tf-rv-group-h{font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:6px}.tf-rv-item{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-surface-2,#f8fafc)}.tf-rv-item.blocking{border-left:3px solid #ef4444}.tf-rv-item.advisory{border-left:3px solid #f5a623}.tf-rv-dim{display:inline-block;border-radius:999px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);padding:0 7px;font-size:10px;font-weight:700;margin-right:6px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-rv-crit{font-size:12px;font-weight:600}.tf-rv-field{font-size:11px;line-height:1.6;color:var(--dsw-alias-text,#1f2937);margin-top:3px}.tf-rv-field b{font-weight:700;color:var(--dsw-alias-text-muted,#6b7280)}.tf-rv-note{display:inline-block;border-radius:6px;padding:0 6px;font-size:10px;font-weight:700;background:#fee2e2;color:#b91c1c}.tf-rv-unc{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin:2px 0 0}.tf-rv-res{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-surface,#fff)}.tf-rv-res.yes{border-left:3px solid #22c55e}.tf-rv-res.no{border-left:3px solid #f5a623}.tf-rv-summary{font-size:12px;line-height:1.6;color:var(--dsw-alias-text,#1f2937)}';

  var IDLE_COLOR = '#9aa0a6';
  var RUNNING_COLOR = '#3b82f6';
  var FAILED_COLOR = '#ef4444';
  var DONE_COLOR = '#22c55e';
  var REVIEW_COLOR = '#7c3aed';
  var REWORK_COLOR = '#ec4899';
  var NODE_STATUS = {
    pending: { label: '等待', color: IDLE_COLOR, mark: 'tf-ar-i' },
    working: { label: '进行中', color: RUNNING_COLOR, mark: 'tf-ar-w' },
    // P10: a node whose artifact is currently being judged, and a node that was
    // sent back. Both are "in flight", so neither may fall back to '等待'.
    reviewing: { label: '审核中', color: REVIEW_COLOR, mark: 'tf-ar-w' },
    rework: { label: '返工中', color: REWORK_COLOR, mark: 'tf-ar-w' },
    completed: { label: '已完成', color: DONE_COLOR, mark: 'tf-ar-c' },
    failed: { label: '失败', color: FAILED_COLOR, mark: 'tf-ar-f' }
  };
  var RUN_STATUS = {
    running: { label: '运行中', color: RUNNING_COLOR },
    completed: { label: '已完成', color: DONE_COLOR },
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
  function fmtClock(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '—';
    try { return new Date(ts).toLocaleTimeString(); } catch (e) { return '—'; }
  }
  // Must match the host's roll-up literal EXACTLY. The role chips come from the
  // /progress `roles` roll-up (which spells it '(未指派)'), and clicking one sends
  // that string back as /role?agent=..., which filters on the normalised name. A
  // mismatch renders one role as two different labels -- and makes `busy` never
  // true for it, so its detail would never refresh while a node is running.
  function roleOf(n) { return n && n.agentName ? String(n.agentName) : '(未指派)'; }
  // Never lead with a raw id like "fix-tabs": prefer the readable title the host
  // derives (explicit node title, then the 【…】 tag, then the requirement's own
  // opening words), and keep the id as secondary metadata.
  function nodeLabel(n) { return (n && typeof n.title === 'string' && n.title !== '') ? n.title : String((n && n.id) || '?'); }
  function clip(s, n) { var t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) + '…' : t; }
  function runStamp(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '';
    try { var d = new Date(ts); return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + d.toLocaleTimeString(); } catch (e) { return ''; }
  }
  function Dot(props) { return React.createElement('span', { className: 'tf-dot', style: { background: props.color } }); }
  // NOTE: a function component receives a PROPS OBJECT. Declaring this as
  // `function StatusBadge(status)` and calling it via createElement(status) —
  // the shape the shipped `Badge` above uses — makes nodeInfo() see
  // `{children: 'completed'}` and render the fallback for every status.
  function StatusBadge(props) {
    var info = nodeInfo(props && props.status);
    return React.createElement('span', { className: 'tf-badge2', style: { background: info.color } }, info.label);
  }

  // ---------------------------------------------------------------------------
  // P10: 审核结论（review）的展示部件。
  //
  // 数据来源有两个形状，都必须容忍字段缺失：
  //   /progress 的节点上是 lightReview 投影（verdict/blocking/advisory/
  //     unresolved/rounds/reviewerName/elapsedMs/summary），或 null；
  //   /role 的 kind:'review' 条目是完整记录（外加 score/findings/resolved/
  //     uncertainties/reasoning/notes/error/parseError/unresolvedReason）。
  // 旧数据没有 review 键，lightReview 会返回 null —— 所有 render 都以
  // reviewOf() 判空为前提，缺失时完全不渲染审核区块，行为与改动前一致。
  // ---------------------------------------------------------------------------
  var VERDICTS = {
    pass: { label: '通过', color: DONE_COLOR },
    rework: { label: '需返工', color: FAILED_COLOR },
    error: { label: '评审异常', color: '#b45309' }
  };
  function verdictInfo(v) { return VERDICTS[v] || { label: '未知结论', color: IDLE_COLOR }; }
  function reviewOf(src) {
    if (src === null || src === undefined) return null;
    return typeof src.review === 'object' && src.review !== null ? src.review : null;
  }
  function isBlockingFinding(f) {
    if (f === null || typeof f !== 'object') return false;
    return f.severity === 'blocking' || f.severity === 'blocker';
  }
  function splitFindings(list) {
    var arr = Array.isArray(list) ? list : [];
    var out = { blocking: [], advisory: [] };
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === null || typeof arr[i] !== 'object') continue;
      if (isBlockingFinding(arr[i])) out.blocking.push(arr[i]);
      else out.advisory.push(arr[i]);
    }
    return out;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  // A verdict badge. `value` is 'pass' | 'rework' | 'error' | null: a null/missing
  // verdict is rendered as an explicit "—" instead of an empty coloured pill.
  function VerdictBadge(props) {
    var raw = props && (props.value !== undefined ? props.value : props.children);
    var has = raw !== undefined && raw !== null && raw !== '';
    var info = has ? verdictInfo(String(raw)) : { label: '—', color: IDLE_COLOR };
    return React.createElement('span', { className: 'tf-rv-verdict', style: { background: info.color } }, has ? info.label : '—');
  }
  // One finding. Every field is optional in the host's projection, so a missing
  // one is simply not drawn rather than printed as "null"/"undefined".
  function FindingItem(props) {
    var f = (props && props.finding) || {};
    var cls = (props && props.kind === 'blocking') ? 'tf-rv-item blocking' : 'tf-rv-item advisory';
    var rows = [];
    if (f.dimension) rows.push(React.createElement('span', { className: 'tf-rv-dim', key: 'd' }, String(f.dimension)));
    if (f.downgraded) rows.push(React.createElement('span', { className: 'tf-rv-note', key: 'dg', title: f.downgradeReason ? String(f.downgradeReason) : '' }, '已降级为建议'));
    rows.push(React.createElement('span', { className: 'tf-rv-crit', key: 'c' }, f.criterion ? String(f.criterion) : '（未给出 criterion）'));
    var body = [];
    if (f.evidence) body.push(React.createElement('div', { className: 'tf-rv-field', key: 'ev' }, React.createElement('b', null, '证据：'), String(f.evidence)));
    if (f.impact) body.push(React.createElement('div', { className: 'tf-rv-field', key: 'im' }, React.createElement('b', null, '影响：'), String(f.impact)));
    if (f.suggestion) body.push(React.createElement('div', { className: 'tf-rv-field', key: 'sg' }, React.createElement('b', null, '建议：'), String(f.suggestion)));
    if (f.downgraded) body.push(React.createElement('div', { className: 'tf-rv-field', key: 'dr' }, React.createElement('b', null, '降级原因：'), f.downgradeReason ? String(f.downgradeReason) : '（未提供原因）'));
    return React.createElement('div', { className: cls }, React.createElement('div', null, rows), body.length ? React.createElement('div', null, body) : null);
  }
  // findings 分两组：阻塞项 / 建议项（含被机械降级的条目）。两组都为空时给出
  // 显式空态，而不是留白。
  function ReviewFindings(props) {
    var groups = splitFindings(props && props.findings);
    if (!groups.blocking.length && !groups.advisory.length) {
      return React.createElement('div', { className: 'tf-kv' }, '本次评审没有记录任何发现项（findings 为空）。');
    }
    var out = [];
    if (groups.blocking.length) out.push(React.createElement('div', { className: 'tf-rv-group', key: 'bk' },
      React.createElement('div', { className: 'tf-rv-group-h' }, '阻塞项（必须返工）· ' + groups.blocking.length + ' 条'),
      groups.blocking.map(function (f, i) { return React.createElement(FindingItem, { key: 'bk' + i, finding: f, kind: 'blocking' }); })
    ));
    if (groups.advisory.length) out.push(React.createElement('div', { className: 'tf-rv-group', key: 'ad' },
      React.createElement('div', { className: 'tf-rv-group-h' }, '建议项（不阻塞）· ' + groups.advisory.length + ' 条'),
      groups.advisory.map(function (f, i) { return React.createElement(FindingItem, { key: 'ad' + i, finding: f, kind: 'advisory' }); })
    ));
    return React.createElement('div', null, out);
  }
  function ReviewResolved(props) {
    var list = Array.isArray(props && props.resolved) ? props.resolved : [];
    if (!list.length) return React.createElement('div', { className: 'tf-kv' }, '本次评审没有对上一轮阻塞项的回应记录（resolved 为空）。');
    return React.createElement('div', null, list.map(function (r, i) {
      var f = (r !== null && typeof r === 'object') ? r : {};
      return React.createElement('div', { className: 'tf-rv-res ' + (f.resolved === true ? 'yes' : 'no'), key: 'r' + i },
        React.createElement('div', { className: 'tf-rv-crit' }, (f.resolved === true ? '已解决：' : '仍未解决：') + (f.finding ? String(f.finding) : '（未给出条目）')),
        f.evidence ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '证据：'), String(f.evidence)) : null
      );
    }));
  }
  function ReviewUncertainties(props) {
    var list = Array.isArray(props && props.uncertainties) ? props.uncertainties : [];
    if (!list.length) return React.createElement('div', { className: 'tf-kv' }, '评审者没有记录不确定项（uncertainties 为空）。');
    return React.createElement('div', null, list.map(function (u, i) {
      return React.createElement('div', { className: 'tf-rv-unc', key: 'u' + i }, '· ' + String(u));
    }));
  }
  // The reviewer's own reasoning trace, labelled with the role that produced it.
  function ReviewReasoning(props) {
    var rv = (props && props.review) || {};
    var who = rv.reviewerName ? String(rv.reviewerName) : '评审者';
    var len = num(rv.reasoningLen);
    var title = '评审者思考过程 (' + who + ')' + (len !== null ? ' · ' + len + ' 字' + (len > (rv.reasoning || '').length ? '（已截断）' : '') : '');
    return React.createElement('div', { className: 'tf-rv-group' },
      React.createElement('div', { className: 'tf-rv-group-h' }, title),
      rv.reasoning
        ? React.createElement('pre', { className: 'tf-pre tf-reason' }, rv.reasoning)
        : React.createElement('div', { className: 'tf-kv' }, '本次评审没有记录到可显示的推理块（该模型/该次调用没有返回 reasoning 内容）。')
    );
  }
  // 节点卡片里的「审核」区块：verdict 徽章 + 评审者 + 计数 + 轮数/耗时/评分 +
  // 未闭合原因 + findings/resolved/uncertainties 与评审者思考过程。
  //
  // 两个数据形状都要吃下：/role 的完整记录带 findings/resolved/...，而
  // /progress 的轻投影只有 verdict/blocking/advisory/rounds/reviewerName/
  // elapsedMs/summary。所以只渲染**该形状真正带有的**分区，绝不把缺字段印成
  // "undefined"，也绝不为轻投影编造 findings。
  function ReviewBlock(props) {
    var rv = (props && props.review) || {};
    var v = verdictInfo(rv.verdict);
    var meta = [];
    if (rv.reviewerName) meta.push('评审者 ' + String(rv.reviewerName));
    meta.push('阻塞 ' + (num(rv.blocking) === null ? 0 : rv.blocking) + ' · 建议 ' + (num(rv.advisory) === null ? 0 : rv.advisory));
    meta.push('轮数 ' + (num(rv.rounds) === null ? 0 : rv.rounds));
    if (num(rv.elapsedMs) !== null) meta.push('耗时 ' + fmtElapsed(rv.elapsedMs));
    if (num(rv.score) !== null) meta.push('评分 ' + rv.score);
    if (rv.unresolved === true) meta.push('未闭合');
    var hasFindings = Array.isArray(rv.findings);
    var hasResolved = Array.isArray(rv.resolved);
    var hasUncertainties = Array.isArray(rv.uncertainties);
    return React.createElement('div', { className: 'tf-rv-group' },
      React.createElement('div', { className: 'tf-rv-head' },
        React.createElement('div', { className: 'tf-lbl', style: { margin: 0 } }, '审核'),
        React.createElement(Dot, { color: v.color }),
        React.createElement(VerdictBadge, { value: rv.verdict }),
        React.createElement('span', { className: 'tf-kv' }, meta.join(' · '))
      ),
      rv.summary ? React.createElement('div', { className: 'tf-rv-summary' }, String(rv.summary)) : null,
      rv.unresolved === true
        ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '未闭合原因：'), rv.unresolvedReason ? String(rv.unresolvedReason) : '评审记录标记为未闭合，但未提供原因。')
        : null,
      hasFindings
        ? React.createElement('div', { className: 'tf-rv-group' },
            React.createElement('div', { className: 'tf-rv-group-h' }, '发现项（阻塞 / 建议）'),
            React.createElement(ReviewFindings, { findings: rv.findings })
          )
        : React.createElement('div', { className: 'tf-kv' }, '这次只取到了评审结论的轻量投影（阻塞 ' + (num(rv.blocking) === null ? 0 : rv.blocking) + ' / 建议 ' + (num(rv.advisory) === null ? 0 : rv.advisory) + '），逐条 findings、resolved 与 uncertainties 需要点开该角色查看完整评审记录。'),
      hasResolved ? React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '上一轮阻塞项的回应 (resolved)'),
        React.createElement(ReviewResolved, { resolved: rv.resolved })
      ) : null,
      hasUncertainties ? React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '评审者不确定项 (uncertainties)'),
        React.createElement(ReviewUncertainties, { uncertainties: rv.uncertainties })
      ) : null,
      rv.reasoning !== undefined || rv.reasoningLen !== undefined ? React.createElement(ReviewReasoning, { review: rv }) : null,
      rv.error || rv.parseError ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '评审异常：'), String(rv.error || rv.parseError)) : null,
      rv.toolNote ? React.createElement('div', { className: 'tf-kv' }, String(rv.toolNote)) : null
    );
  }

  // ---------------------------------------------------------------------------
  // P10: /role 的 kind:'review' 条目是完整评审记录，用它渲染评审条目视图。
  // ---------------------------------------------------------------------------

  // 调度波次：同一波次的节点是并发跑的。时序图按 (波次, 定义顺序) 排列，这样
  // 图里节点的先后关系与调度器真实的 dependsOn 波次一致，而不是文件里的顺序。
  function waveOrder(nodes) {
    var byId = {};
    for (var i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i];
    var level = {};
    function lvl(id, seen) {
      if (level[id] !== undefined) return level[id];
      if (seen[id]) return 0;
      seen[id] = true;
      var deps = (byId[id] && byId[id].dependsOn) || [];
      var m = 0;
      for (var d = 0; d < deps.length; d++) if (byId[deps[d]]) m = Math.max(m, lvl(deps[d], seen) + 1);
      level[id] = m;
      return m;
    }
    for (var j = 0; j < nodes.length; j++) lvl(nodes[j].id, {});
    var out = nodes.slice();
    out.sort(function (a, b) {
      var la = level[a.id] || 0; var lb = level[b.id] || 0;
      if (la !== lb) return la - lb;
      return (a.order || 0) - (b.order || 0);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // UML 时序图（SVG）。参与者 = 编排器 + 该工作流里出现过的每个角色；消息 =
  // 每个节点的一次派发（实线）与一次交付（虚线）。
  //
  // 只画调度器真实存在的那两条交互：它按 dependsOn 波次把任务交给 node.agent，
  // 等子代理结束后收回产出。`reviewer` 只是记录在任务上的元数据——调度器并不
  // 为它起一步——所以这里不画评审箭头，画了就是伪造。
  // ---------------------------------------------------------------------------
  function SequenceDiagram(props) {
    var nodes = waveOrder(props.nodes || []);
    var names = [ORCH];
    for (var i = 0; i < nodes.length; i++) {
      var who = roleOf(nodes[i]);
      if (names.indexOf(who) === -1) names.push(who);
    }
    // RIGHT must clear the participant header's half-width (66) or the last
    // header overhangs the viewBox and is clipped by the SVG's overflow:hidden.
    var LANE_W = 176; var LEFT = 100; var RIGHT = 72;
    var HEAD_H = 46; var ROW_H = 42; var TOP = 14; var BOTTOM = 20;
    var width = LEFT + Math.max(0, names.length - 1) * LANE_W + RIGHT;
    // 每个节点占两行：第 2k 行是派发，第 2k+1 行是交付。
    var height = HEAD_H + TOP + nodes.length * 2 * ROW_H + BOTTOM;
    var laneX = function (name) { var idx = names.indexOf(name); return LEFT + (idx < 0 ? 0 : idx) * LANE_W; };
    var rowY = function (k) { return HEAD_H + TOP + k * ROW_H + 16; };
    var kids = [];

    kids.push(React.createElement('defs', { key: 'defs' },
      React.createElement('marker', { id: 'tf-ar-i', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M0,0 L10,5 L0,10 z', fill: IDLE_COLOR })),
      React.createElement('marker', { id: 'tf-ar-w', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M0,0 L10,5 L0,10 z', fill: RUNNING_COLOR })),
      React.createElement('marker', { id: 'tf-ar-c', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M0,0 L10,5 L0,10 z', fill: DONE_COLOR })),
      React.createElement('marker', { id: 'tf-ar-f', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, React.createElement('path', { d: 'M0,0 L10,5 L0,10 z', fill: FAILED_COLOR }))
    ));

    // 生命线 + 参与者头（角色头可点击）
    for (var p = 0; p < names.length; p++) {
      (function (nm, idx) {
        var x = laneX(nm);
        var isSel = props.selected === nm;
        var isOrch = nm === ORCH;
        kids.push(React.createElement('line', { key: 'll' + idx, x1: x, y1: HEAD_H, x2: x, y2: height - BOTTOM, stroke: 'var(--dsw-alias-border,#e5e7eb)', strokeDasharray: '4 4', strokeWidth: 1 }));
        kids.push(React.createElement('g', {
          key: 'hd' + idx,
          style: { cursor: isOrch ? 'default' : 'pointer' },
          onClick: isOrch ? null : function () { props.onSelect(nm); }
        },
          React.createElement('rect', { x: x - 66, y: 8, width: 132, height: 30, rx: 9, fill: isSel ? '#3b82f6' : 'var(--dsw-alias-surface-2,#f3f4f6)', stroke: isSel ? '#3b82f6' : 'var(--dsw-alias-border,#e5e7eb)' }),
          React.createElement('text', { x: x, y: 27, textAnchor: 'middle', fontSize: 12, fontWeight: 600, fill: isSel ? '#fff' : 'var(--dsw-alias-text,#1f2937)' }, isOrch ? nm : nm + (props.working && props.working[nm] ? ' ●' : ''))
        ));
      })(names[p], p);
    }

    // 消息
    for (var k = 0; k < nodes.length; k++) {
      (function (n, k) {
        var who = roleOf(n);
        var info = nodeInfo(n.status);
        var xRole = laneX(who); var xOrch = laneX(ORCH);
        var yCall = rowY(2 * k); var yRet = rowY(2 * k + 1);

        // An arrow asserts that an interaction HAPPENED. A node that has not been
        // dispatched (no startedAt => `pending`) or has not returned (`working`)
        // must therefore not get one: it gets a short dashed stub instead. Drawing
        // a full arrow for those would be the same fabrication as drawing a review
        // step the scheduler never runs.
        var dispatched = n.status !== 'pending';
        // P10: a node under review, or one sent back for rework, HAS returned its
        // artifact -- that is exactly why it is being judged or redone. Treating
        // those as "尚未交付" would contradict the review label on the same row.
        var returned = n.status === 'completed' || n.status === 'failed' || n.status === 'reviewing' || n.status === 'rework';

        // 激活条：派发之后才有；已交付则闭合，仍在进行中则只有一小段。
        if (dispatched) kids.push(React.createElement('rect', { key: 'act' + k, x: xRole - 5, y: yCall - 8, width: 10, height: returned ? (yRet - yCall) + 16 : 18, rx: 3, fill: info.color, opacity: 0.85 }));

        // 派发：编排器 -> 角色（<title> 提供悬停全文，line 本身不能带子元素）
        if (dispatched) {
          kids.push(React.createElement('g', { key: 'c' + k },
            React.createElement('title', null, '「' + nodeLabel(n) + '」(' + n.id + ') 派发给 ' + who + (n.brief ? '：' + n.brief : '')),
            React.createElement('line', { x1: xOrch, y1: yCall, x2: xRole, y2: yCall, stroke: info.color, strokeWidth: 1.5, markerEnd: 'url(#' + info.mark + ')' })
          ));
          kids.push(React.createElement('text', { key: 'cl' + k, x: (xOrch + xRole) / 2, y: yCall - 6, textAnchor: 'middle', fontSize: 11, fontWeight: 600, fill: info.color }, '«task» ' + clip(nodeLabel(n), 22)));
        } else {
          kids.push(React.createElement('line', { key: 'c' + k, x1: xOrch, y1: yCall, x2: xOrch + 26, y2: yCall, stroke: IDLE_COLOR, strokeWidth: 1.2, strokeDasharray: '2 3' }));
          kids.push(React.createElement('text', { key: 'cl' + k, x: (xOrch + xRole) / 2, y: yCall - 6, textAnchor: 'middle', fontSize: 11, fill: IDLE_COLOR }, '「' + clip(nodeLabel(n), 22) + '」尚未派发（等待依赖）'));
        }
        // 第二行给出「这一步在做什么 / 做出了什么」：优先 worker 自己产出的摘要，
        // 没有摘要时退回需求的开头，最后才是节点 id。
        var sub = n.summary ? n.summary : n.brief;
        kids.push(React.createElement('text', { key: 'cs' + k, x: (xOrch + xRole) / 2, y: yCall + 13, textAnchor: 'middle', fontSize: 10, fill: 'var(--dsw-alias-text-muted,#6b7280)' }, clip('#' + n.id + (sub ? ' · ' + sub : ''), 48)));

        // 评审结论只作为**交付标签的后缀**追加，不新增泳道：泳道是按节点逐个画
        // 的，给评审者加一条泳道会改变既有布局与既有断言。没有评审数据、或结论
        // 还没落定时前缀为空串，标签与改动前逐字一致；有结论时形如
        // 「«result» 已完成 · 评审 需返工 2」。
        var rvLight = reviewOf(n);
        var reviewSuffix = '';
        if (rvLight !== null) {
          var rvWord = rvLight.verdict === 'pass' ? '通过' : (rvLight.verdict === 'rework' ? '需返工' : (rvLight.verdict === 'error' ? '评审异常' : '结论未知'));
          reviewSuffix = ' · 评审 ' + rvWord;
          if (rvLight.verdict === 'rework' && typeof rvLight.rounds === 'number' && rvLight.rounds > 0) reviewSuffix += ' ' + rvLight.rounds;
        }
        // 交付：只有真的回来了才画回程箭头。
        if (returned) {
          var retLabel = '«' + (n.status === 'failed' ? 'failed' : 'result') + '» ' + info.label + (typeof n.elapsedMs === 'number' ? ' · ' + fmtElapsed(n.elapsedMs) : '') + reviewSuffix;
          kids.push(React.createElement('line', { key: 'r' + k, x1: xRole, y1: yRet, x2: xOrch, y2: yRet, stroke: info.color, strokeWidth: 1.3, strokeDasharray: '5 4', markerEnd: 'url(#' + info.mark + ')' }));
          kids.push(React.createElement('text', { key: 'rl' + k, x: (xOrch + xRole) / 2, y: yRet - 6, textAnchor: 'middle', fontSize: 11, fill: info.color }, retLabel));
        } else {
          kids.push(React.createElement('line', { key: 'r' + k, x1: xRole, y1: yRet, x2: xRole - 26, y2: yRet, stroke: info.color, strokeWidth: 1.2, strokeDasharray: '2 3' }));
          kids.push(React.createElement('text', { key: 'rl' + k, x: (xOrch + xRole) / 2, y: yRet - 6, textAnchor: 'middle', fontSize: 11, fill: info.color }, n.status === 'working' ? ('进行中' + (typeof n.elapsedMs === 'number' ? ' · ' + fmtElapsed(n.elapsedMs) : '') + '（尚未交付）') : '尚未交付'));
        }
      })(nodes[k], k);
    }

    return React.createElement('div', { className: 'tf-seq-box' },
      React.createElement('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, style: { display: 'block' } }, kids)
    );
  }

  // 一个角色的单个节点卡片：任务要求 / 验收标准 / 工具策略 / 思考过程 / 完整产出
  function NodeCard(props) {
    var n = props.node;
    var info = nodeInfo(n.status);
    var rows = [];
    rows.push(React.createElement('div', { className: 'tf-nhead', key: 'h' },
      React.createElement('span', { className: 'tf-nid' }, nodeLabel(n)),
      React.createElement('span', { className: 'tf-kv', style: { fontFamily: 'ui-monospace,Menlo,Consolas,monospace' } }, '#' + n.id),
      React.createElement(StatusBadge, { key: 'b', status: n.status }),
      React.createElement('span', { className: 'tf-kv' }, (n.elapsedMs !== null && n.elapsedMs !== undefined ? fmtElapsed(n.elapsedMs) : '—') + ' · ' + fmtClock(n.startedAt) + ' → ' + fmtClock(n.endedAt)),
      // Three branches, not two. With a review record the ReviewBlock below
      // already states the outcome, so calling it "评审(仅记录)" here would
      // contradict the data on the SAME screen -- the review really did run, and
      // may even have forced a rework. Only a declared reviewer with no record
      // gets a note, and the note says exactly that instead of implying that
      // review is never executed.
      reviewOf(n) === null && n.reviewer ? React.createElement('span', { className: 'tf-kv' }, '评审者 ' + n.reviewer + ' · 尚无评审记录') : null,
      n.dependsOn && n.dependsOn.length ? React.createElement('span', { className: 'tf-kv' }, '依赖: ' + n.dependsOn.join(', ')) : null,
      n.taskId ? React.createElement('span', { className: 'tf-kv' }, 'task ' + String(n.taskId).slice(-6) + ' · ' + (n.taskStatus || '') + (n.iteration ? ' · it' + n.iteration : '')) : null
    ));
    // P10: the review verdict, its counts, its findings and the reviewer's own
    // trace. Rendered ONLY when the run recorded a review for this node -- an old
    // record (no `review` key => null projection) renders exactly as before.
    if (reviewOf(n) !== null) rows.push(React.createElement('div', { key: 'rv' }, React.createElement(ReviewBlock, { review: reviewOf(n) })));
    if (n.summary) rows.push(React.createElement('div', { key: 'sm' },
      React.createElement('div', { className: 'tf-lbl' }, '产出摘要'),
      React.createElement('div', { className: 'tf-kv', style: { lineHeight: 1.6, color: 'var(--dsw-alias-text,#1f2937)' } }, n.summary)
    ));

    if (n.requirement) rows.push(React.createElement('div', { key: 'req' },
      React.createElement('div', { className: 'tf-lbl' }, '任务要求'),
      React.createElement('pre', { className: 'tf-pre' }, n.requirement)
    ));
    if (n.acceptanceCriteria) rows.push(React.createElement('div', { key: 'ac' },
      React.createElement('div', { className: 'tf-lbl' }, '验收标准'),
      React.createElement('pre', { className: 'tf-pre' }, n.acceptanceCriteria)
    ));
    if (n.tools) rows.push(React.createElement('div', { key: 'tl' },
      React.createElement('div', { className: 'tf-lbl' }, '工具策略'),
      React.createElement('div', { className: 'tf-kv', style: { wordBreak: 'break-word' } }, n.tools)
    ));

    // 思考过程：来自子代理 result.output 里的 reasoning 块。以前这一路被直接丢弃，
    // 所以角色"在想什么"完全不可见。
    rows.push(React.createElement('div', { key: 'rs' },
      React.createElement('div', { className: 'tf-lbl' }, '思考过程 (reasoning)' + (n.reasoningLen ? ' · ' + n.reasoningLen + ' 字' + (n.reasoningLen > (n.reasoning || '').length ? '（已截断）' : '') : '')),
      n.reasoning
        ? React.createElement('pre', { className: 'tf-pre tf-reason' }, n.reasoning)
        : React.createElement('div', { className: 'tf-kv' }, '本次未产生可记录的推理块（该模型/该次调用没有返回 reasoning 内容）。以下完整产出仍是该角色真实的工作结果。')
    ));

    if (n.error) rows.push(React.createElement('div', { key: 'er' },
      React.createElement('div', { className: 'tf-lbl' }, '失败原因'),
      React.createElement('pre', { className: 'tf-pre tf-errbox' }, n.error)
    ));

    rows.push(React.createElement('div', { key: 'out' },
      React.createElement('div', { className: 'tf-lbl' }, '完整产出' + (n.outputLen ? ' · ' + n.outputLen + ' 字' + (n.outputTruncated ? '（超出上限，已截断）' : '') : '')),
      n.output
        ? React.createElement('pre', { className: 'tf-pre' }, n.output)
        : React.createElement('div', { className: 'tf-kv' }, '该节点还没有产出。')
    ));

    return React.createElement('div', { className: 'tf-ncard' }, rows);
  }

  // ---------------------------------------------------------------------------
  // P10: /role 在原有条目之外会返回 kind:'review' 的条目 —— 该角色作为评审者
  // 复核过的节点。评审条目有自己的形状（verdict / findings / resolved /
  // uncertainties / 评审者推理），所以用独立视图渲染；负责人的节点视图完全不变。
  // 条目缺失或旧宿主不返回 reviews 时，这里退化成「该角色本次没有评审记录」。
  // ---------------------------------------------------------------------------
  function ReviewEntry(props) {
    var r = props.entry || {};
    var v = verdictInfo(r.verdict);
    var meta = [];
    if (r.reviewedAgentName) meta.push('被评审 ' + String(r.reviewedAgentName));
    if (r.reviewedStatus) meta.push('节点状态 ' + nodeInfo(r.reviewedStatus).label);
    meta.push('阻塞 ' + (num(r.blockingCount) === null ? 0 : r.blockingCount) + ' · 建议 ' + (num(r.advisoryCount) === null ? 0 : r.advisoryCount));
    meta.push('轮数 ' + (num(r.rounds) === null ? 0 : r.rounds));
    if (num(r.elapsedMs) !== null) meta.push('耗时 ' + fmtElapsed(r.elapsedMs));
    if (num(r.score) !== null) meta.push('评分 ' + r.score);
    if (r.unresolved === true) meta.push('未闭合');
    var who = r.reviewerName ? String(r.reviewerName) : (r.reviewer ? String(r.reviewer) : '');
    return React.createElement('div', { className: 'tf-ncard' },
      React.createElement('div', { className: 'tf-rv-head' },
        React.createElement('span', { className: 'tf-nid' }, r.nodeTitle ? String(r.nodeTitle) : String(r.id || '?')),
        React.createElement('span', { className: 'tf-kv', style: { fontFamily: 'ui-monospace,Menlo,Consolas,monospace' } }, '#' + String(r.id === undefined ? '' : r.id)),
        React.createElement(VerdictBadge, { value: r.verdict }),
        React.createElement('span', { className: 'tf-kv' }, '评审' + (who ? '：' + who : '')),
        React.createElement('span', { className: 'tf-kv' }, meta.join(' · '))
      ),
      r.summary ? React.createElement('div', { className: 'tf-rv-summary' }, String(r.summary)) : null,
      r.reviewedSummary ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '被评审节点产出摘要：'), String(r.reviewedSummary)) : null,
      r.unresolved === true
        ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '未闭合原因：'), r.unresolvedReason ? String(r.unresolvedReason) : '评审记录标记为未闭合，但未提供原因。')
        : null,
      React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '发现项（阻塞 / 建议分组 · 共 ' + (Array.isArray(r.findings) ? r.findings.length : 0) + ' 条）'),
        React.createElement(ReviewFindings, { findings: r.findings })
      ),
      React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '上一轮阻塞项的回应 (resolved)'),
        React.createElement(ReviewResolved, { resolved: r.resolved })
      ),
      React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '评审者不确定项 (uncertainties)'),
        React.createElement(ReviewUncertainties, { uncertainties: r.uncertainties })
      ),
      React.createElement(ReviewReasoning, { review: r }),
      r.error || r.parseError ? React.createElement('div', { className: 'tf-rv-field' }, React.createElement('b', null, '评审异常：'), String(r.error || r.parseError)) : null,
      (Array.isArray(r.notes) && r.notes.length) ? React.createElement('div', { className: 'tf-rv-group' },
        React.createElement('div', { className: 'tf-rv-group-h' }, '机械归一化记录 (notes)'),
        r.notes.map(function (x, i) { return React.createElement('div', { className: 'tf-rv-unc', key: 'n' + i }, '· ' + String(x)); })
      ) : null
    );
  }

  function ReviewEntries(props) {
    var list = Array.isArray(props && props.entries) ? props.entries : [];
    return React.createElement('div', { className: 'tf-rv-group' },
      React.createElement('div', { className: 'tf-rv-group-h' }, '评审记录（kind=review）· ' + list.length + ' 个节点'),
      list.length
        ? React.createElement('div', null, list.map(function (r, i) { return React.createElement(ReviewEntry, { key: (r && r.id ? String(r.id) : 'rv') + i, entry: r }); }))
        : React.createElement('div', { className: 'tf-kv' }, '该角色在本次运行里没有评审记录（它没有作为评审者复核任何节点）。')
    );
  }

  function RoleDetail(props) {
    var detail = props.detail;
    var nodes = (detail && detail.nodes) || [];
    // P10 reviewer entries. `kind === 'review'` is the host's marker; an older host
    // (or a role that reviewed nothing) yields an empty list and the view below is
    // byte-for-byte what it always rendered.
    var reviews = ((detail && Array.isArray(detail.reviews)) ? detail.reviews : []).filter(function (r) {
      return r !== null && typeof r === 'object' && r.kind === 'review';
    });
    if (props.error) return React.createElement('div', { className: 'tf-ncard' }, React.createElement('div', { className: 'tf-kv', style: { color: '#ef4444' } }, '角色详情获取失败: ' + props.error));
    // No role at all (e.g. a run whose workflow has no nodes) is a real state, not
    // a pending fetch: without this the pane would say "loading" forever.
    if (!props.role) return React.createElement('div', { className: 'tf-empty' }, '该运行没有可显示的角色（工作流没有节点）。');
    if (!detail) return React.createElement('div', { className: 'tf-empty' }, '正在载入 ' + props.role + ' 的详情…');
    // P10: a reviewer OWNS no node, so "该角色没有节点" must not hide its review
    // entries -- that empty state used to short-circuit the whole pane and make a
    // reviewer look like it had done nothing at all.
    if (!nodes.length && !reviews.length) return React.createElement('div', { className: 'tf-empty' }, '该角色在本次运行里没有节点。');
    var head = React.createElement('div', { className: 'tf-pg-head', key: 'h' },
      React.createElement('h3', { className: 'tf-pg-title', style: { fontSize: 14 } }, String(props.role || '')),
      React.createElement('span', { className: 'tf-kv' }, nodes.length + ' 个节点' + (reviews.length ? ' · 复核 ' + reviews.length + ' 个节点' : '')),
      React.createElement('span', { className: 'tf-kv' }, '合计 ' + fmtElapsed(nodes.reduce(function (a, n) { return a + (typeof n.elapsedMs === 'number' ? n.elapsedMs : 0); }, 0)))
    );
    return React.createElement('div', null,
      head,
      nodes.length
        ? nodes.map(function (n) { return React.createElement(NodeCard, { key: n.id, node: n }); })
        : React.createElement('div', { className: 'tf-kv' }, '该角色不拥有节点（它只作为评审者复核别人的节点）。'),
      reviews.length ? React.createElement(ReviewEntries, { key: '__reviews', entries: reviews }) : null
    );
  }

  // ---------------------------------------------------------------------------
  // 主面板：团队进度。注册进 main(keyed) 的 'team-progress' 单元，由侧边栏
  // sidebar.panellist 的同名条目选中。它只读 /progress（轻量轮询）与 /role
  // （点开某角色时按需取，带完整报告），不触碰看板的任何状态。
  // ---------------------------------------------------------------------------
  function TeamProgressPage(props) {
    var compact = !!(props && props.compact);
    var st = React.useState({ data: null, error: null, role: null, detail: null, detailError: null, runs: [], wfs: [] });
    var s = st[0]; var set = st[1];
    var rs = React.useState(null); var runId = rs[0]; var setRunId = rs[1];

    // 只做函数式更新：把渲染期快照合并回去，长生命周期的轮询回调就会用旧值
    // 覆盖新值（看板标签回退那次事故的根因）。
    var patch = React.useCallback(function (p) {
      set(function (prev) { return Object.assign({}, prev, typeof p === 'function' ? p(prev) : p); });
    }, []);

    var tick = React.useCallback(function () {
      var q = runId ? ('?runId=' + encodeURIComponent(runId)) : '';
      return get('/progress' + q).then(function (d) {
        patch({ data: d, error: null });
      }).catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        patch(function (prev) { return { data: prev.data, error: msg }; });
      });
    }, [runId, patch]);

    React.useEffect(function () {
      tick();
      var id = setInterval(tick, POLL_MS);
      return function () { clearInterval(id); };
    }, [tick]);

    // 运行列表与工作流名只取一次：运行记录里只存 workflowId，而选择器要显示
    // 人能读的工作流名字，所以两张表都要。
    React.useEffect(function () {
      get('/runs').then(function (d) { patch({ runs: d.runs || [] }); }).catch(function () { /* 运行列表不是必需 */ });
      get('/workflows').then(function (d) { patch({ wfs: d.workflows || [] }); }).catch(function () { /* 名字不是必需 */ });
    }, [patch]);

    var wfName = function (id) {
      var list = s.wfs || [];
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i].name || id || '未命名工作流';
      return id || '未命名工作流';
    };

    var nodes = (s.data && s.data.nodes) || [];
    var roles = (s.data && s.data.roles) || [];
    // P10: 评审者（监督角色）的复核成绩。旧宿主/旧数据没有这个键 => [] => 空态。
    var reviewers = (s.data && Array.isArray(s.data.reviewers)) ? s.data.reviewers : [];

    // 选中角色是派生值，不是状态：这样数据刷新后不可能出现"选中了一个已经不存在
    // 的角色"这种悬空引用，也不需要 effect 去同步。
    // P10: 评审者不在 roles 里（它不拥有任何节点），但它是页面上可点选的角色；
    // 合法性必须以「所有可点选的名字」为准，否则点评审者会被这层守卫静默弹回。
    var selectable = roles.map(function (r) { return r.name; }).concat(reviewers.map(function (r) { return r.name; }));
    var selected = null;
    if (s.role && selectable.indexOf(s.role) !== -1) selected = s.role;
    else if (roles.length) {
      var busy0 = roles.filter(function (r) { return r.working > 0; })[0];
      selected = busy0 ? busy0.name : roles[0].name;
    }
    var selectedRef = React.useRef(null);
    selectedRef.current = selected;

    var loadDetail = React.useCallback(function (roleName) {
      if (!roleName) { patch({ detail: null }); return Promise.resolve(); }
      var q = '?agent=' + encodeURIComponent(roleName) + (runId ? '&runId=' + encodeURIComponent(runId) : '');
      return get('/role' + q).then(function (d) {
        patch({ detail: d, detailError: null });
      }).catch(function (e) {
        patch({ detailError: e && e.message ? e.message : String(e) });
      });
    }, [runId, patch]);

    React.useEffect(function () {
      if (!selected) { patch({ detail: null }); return; }
      patch({ detail: null, detailError: null });
      loadDetail(selected);
    }, [selected, loadDetail, patch]);

    var busy = selected !== null && nodes.some(function (n) { return roleOf(n) === selected && n.status === 'working'; });
    React.useEffect(function () {
      if (!selected || !busy) return undefined;
      var id = setInterval(function () { loadDetail(selectedRef.current); }, ROLE_POLL_MS);
      return function () { clearInterval(id); };
    }, [selected, busy, loadDetail]);

    var data = s.data || null;
    var run = data && data.run ? data.run : null;
    var totals = (data && data.totals) || { total: 0, completed: 0, failed: 0, working: 0, pending: 0, percent: 0 };
    var percent = totals.percent || 0;
    var isFailed = (run !== null && run.status === 'failed') || (totals.failed || 0) > 0;
    var barColor = run === null ? IDLE_COLOR : (isFailed ? FAILED_COLOR : (run.status === 'running' ? RUNNING_COLOR : runInfo(run.status).color));

    var header = React.createElement('div', { className: 'tf-pg-head' },
      React.createElement(compact ? 'h3' : 'h2', { className: 'tf-pg-title' }, compact ? '多 Agent 进度' : '多 Agent 团队进度'),
      run === null ? React.createElement('span', { className: 'tf-pg-sub' }, '暂无运行') : React.createElement('span', { className: 'tf-badge2', style: { background: runInfo(run.status).color } }, runInfo(run.status).label),
      // 领先显示「哪个工作流 · 几个节点 · 何时开始」，短 id 只作为次级信息。
      run === null ? null : React.createElement('span', { className: 'tf-pg-sub' }, (run.workflowName || wfName(run.workflowId)) + ' · ' + (totals.total || 0) + ' 个节点 · ' + runStamp(run.startedAt) + ' · #' + String(run.id).slice(-6)),
      React.createElement('div', { className: 'tf-pg-toolbar' },
        compact ? null : React.createElement('select', {
          className: 'tf-select',
          value: runId || '',
          onChange: function (e) { setRunId(e.target.value || null); }
        },
          React.createElement('option', { value: '' }, '最新运行'),
          (s.runs || []).slice(0, 40).map(function (x) {
            var ncount = x && x.nodeStates && typeof x.nodeStates === 'object' ? Object.keys(x.nodeStates).length : 0;
            return React.createElement('option', { key: x.id, value: x.id }, wfName(x.workflowId) + ' · ' + ncount + ' 节点 · ' + runInfo(x.status).label + ' · ' + runStamp(x.startedAt) + ' · #' + String(x.id).slice(-6));
          })
        ),
        React.createElement('button', { className: 'tf-btn', onClick: function () { tick(); if (selectedRef.current) loadDetail(selectedRef.current); } }, '刷新')
      )
    );

    var content;
    if (run === null) {
      content = React.createElement('div', { className: 'tf-empty' }, s.error ? ('进度获取失败: ' + s.error) : '暂无运行。启动一个工作流后，这里会显示每个角色的交互时序与产出。');
    } else {
      content = React.createElement('div', null,
        React.createElement('div', { className: 'tf-pg-sec', key: 'sum' },
          React.createElement('div', { className: 'tf-kv' }, percent + '% · 完成 ' + (totals.completed || 0) + '/' + (totals.total || 0) + ' · 失败 ' + (totals.failed || 0) + ' · 进行中 ' + (totals.working || 0) + ' · 审核中 ' + (totals.reviewing || 0) + ' · 返工中 ' + (totals.rework || 0) + ' · 未闭合 ' + (totals.unresolved || 0) + ' · 等待 ' + (totals.pending || 0) + ' · 开始 ' + fmtClock(run.startedAt) + (run.endedAt ? ' · 结束 ' + fmtClock(run.endedAt) : '')),
          React.createElement('div', { className: 'tf-progress' }, React.createElement('div', { className: 'tf-progress-bar', style: { width: percent + '%', background: barColor } }))
        ),
        React.createElement('div', { className: 'tf-pg-sec', key: 'seq' },
          React.createElement('div', { className: 'tf-pg-sec-h' }, '角色交互时序（UML sequence · 按 dependsOn 波次线性化，同波次为并发）'),
          React.createElement('div', { className: 'tf-legend' },
            React.createElement('span', null, React.createElement(Dot, { color: DONE_COLOR }), ' 已完成'),
            React.createElement('span', null, React.createElement(Dot, { color: RUNNING_COLOR }), ' 进行中'),
            React.createElement('span', null, React.createElement(Dot, { color: REVIEW_COLOR }), ' 审核中'),
            React.createElement('span', null, React.createElement(Dot, { color: REWORK_COLOR }), ' 返工中'),
            React.createElement('span', null, React.createElement(Dot, { color: FAILED_COLOR }), ' 失败'),
            React.createElement('span', null, React.createElement(Dot, { color: IDLE_COLOR }), ' 等待'),
            React.createElement('span', null, '实线=派发任务，虚线=交付产出；点角色名查看其思考过程与完整产出')
          ),
          React.createElement(SequenceDiagram, {
            nodes: nodes,
            selected: selected,
            working: (function () { var m = {}; roles.forEach(function (r) { if (r.working > 0) m[r.name] = true; }); return m; })(),
            onSelect: function (nm) { patch({ role: nm }); }
          })
        ),
        React.createElement('div', { className: 'tf-pg-sec', key: 'roles' },
          React.createElement('div', { className: 'tf-pg-sec-h' }, '角色（点击查看该角色的思考过程与任务进展）'),
          React.createElement('div', { className: 'tf-chips' }, roles.map(function (r) {
            var c = r.failed > 0 ? FAILED_COLOR : (r.working > 0 ? RUNNING_COLOR : (r.completed === r.total ? DONE_COLOR : IDLE_COLOR));
            return React.createElement('button', {
              key: r.name,
              className: 'tf-chip2' + (r.name === selected ? ' on' : ''),
              onClick: function () { patch({ role: r.name }); }
            },
              React.createElement(Dot, { color: c }),
              React.createElement('b', null, r.name),
              React.createElement('span', { className: 'tf-kv' }, r.completed + '/' + r.total + (r.working ? ' · 进行中' + r.working : '') + (r.failed ? ' · 失败' + r.failed : '') + (r.elapsedMs ? ' · ' + fmtElapsed(r.elapsedMs) : ''))
            );
          }))
        ),
        React.createElement('div', { className: 'tf-pg-sec', key: 'detail' },
          React.createElement('div', { className: 'tf-pg-sec-h' }, '角色详情'),
          React.createElement(RoleDetail, { role: selected, detail: s.detail, error: s.detailError })
        )
      );
    }

    // 没有运行（或运行还没有数据）时，审核区块仍然存在并给出显式空态，而不是
    // 整块消失：页面上多出的一节必须能被看见，缺数据不等于可以留白。
    var reviewsBlock = React.createElement('div', { className: 'tf-pg-sec' },
      React.createElement('div', { className: 'tf-pg-sec-h' }, '审核（监督）· 评审者角色的复核成绩'),
      reviewers.length
        ? React.createElement('div', { className: 'tf-chips' }, reviewers.map(function (r) {
            var name = r && r.name ? String(r.name) : '(未署名评审者)';
            var bad = (r && (r.rework || 0)) + (r && (r.error || 0));
            var c = (r && r.unresolved) ? FAILED_COLOR : (bad > 0 ? REWORK_COLOR : (r && r.pass ? DONE_COLOR : IDLE_COLOR));
            var sub = '复核 ' + (r && r.reviewed ? r.reviewed : 0)
              + ' · 通过 ' + (r && r.pass ? r.pass : 0)
              + ' · 返工 ' + (r && r.rework ? r.rework : 0)
              + ' · 异常 ' + (r && r.error ? r.error : 0)
              + ' · 阻塞 ' + (r && r.blocking ? r.blocking : 0)
              + ' · 建议 ' + (r && r.advisory ? r.advisory : 0)
              + (r && r.unresolved ? ' · 未闭合 ' + r.unresolved : '')
              + (r && r.elapsedMs ? ' · ' + fmtElapsed(r.elapsedMs) : '');
            return React.createElement('button', {
              key: name,
              className: 'tf-chip2' + (name === selected ? ' on' : ''),
              onClick: function () { patch({ role: name }); }
            },
              React.createElement(Dot, { color: c }),
              React.createElement('b', null, name),
              React.createElement('span', { className: 'tf-kv' }, sub)
            );
          }))
        : React.createElement('div', { className: 'tf-empty' }, '暂无评审记录：本次运行没有节点声明 reviewer，或这些评审记录早于本次改动。')
    );

    return React.createElement('div', { className: 'tf-pg' },
      React.createElement('style', null, PAGE_STYLE),
      header,
      s.error && run !== null ? React.createElement('div', { className: 'tf-kv', style: { color: '#ef4444', marginTop: 6 } }, '进度获取失败: ' + s.error) : null,
      content,
      reviewsBlock
    );
  }

  // sidebar.panellist 的 ownerProps 只有 { size, active }：侧边栏拥有这个按钮，
  // 我们只负责图标本身，所以这里不取任何数据、不挂任何定时器。
  function TeamIcon(props) {
    var size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
    var c = props.active ? '#3b82f6' : 'currentColor';
    return React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: c, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
      className: props.className, 'aria-hidden': 'true', focusable: 'false'
    },
      React.createElement('title', null, '多 Agent 团队进度'),
      React.createElement('circle', { cx: 12, cy: 5.5, r: 2.6 }),
      React.createElement('circle', { cx: 5, cy: 17.5, r: 2.6 }),
      React.createElement('circle', { cx: 19, cy: 17.5, r: 2.6 }),
      React.createElement('path', { d: 'M10.6 7.9 6.4 15.2' }),
      React.createElement('path', { d: 'M13.4 7.9 17.6 15.2' }),
      React.createElement('path', { d: 'M7.6 17.5h8.8' })
    );
  }

  // ---------------------------------------------------------------------------
  // P9: 右侧栏停靠面板（真正的 sidebar）。
  //
  // 之前只做了 sidebar.panellist 图标 + main 中央面板，所以它其实是一个"整页"，
  // 会顶掉会话，而不是贴着会话的侧边栏。右侧栏是 shell 自己的 pane 系统：
  //   ui-sidebar-right 用 ctx.reflect.provide("sidebarRightTabs", registry) 暴露
  //   类型注册表；SidebarRightTabRegistry.register({id, kind, priority?, title, guide?})
  //   注册一个 tab 类型，body 按 kind 在 force 的类型的 id 上派发到
  //   sidebar.right.pane.tab(keyed)，chip 标题派发到 sidebar.right.pane.tab.title。
  //   用户入口是 guide 列表：GuideBody 的 onPick 直接
  //   tab.actions.openTab(entry.kind, { replaceTab: true })，所以**不需要**地址或
  //   pattern —— guide 条目本身就是"点一下就打开"的入口。
  // 因此这里额外注册一个真正停靠的右侧面板，与整页视图并存、互不影响。
  // ---------------------------------------------------------------------------
  var PANE_ID = '@local/team-flowise';
  var PANE_KIND = 'team-progress';

  function TeamPane() { return React.createElement(TeamProgressPage, { compact: true }); }
  function TeamTabTitle() {
    return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
      React.createElement(TeamIcon, { size: 14, active: false }),
      '多 Agent 进度');
  }

  function apply(ctx) {
    var slots = ctx.get('slots');
    if (slots === undefined) return;
    // 同一个 id 注册两处，正是 shell 自己的机制（已在已安装的 bundle 里逐行核对）：
    //   ui-sidebar 对每个 panellist 条目渲染
    //     renderSlot("sidebar.panellist", { size, active }, { only: id })
    //     并 onClick: () => selectPanel(id)
    //   ui-layout 的 MainPanel = renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })
    //   且 hasMainPanel = (id) => entries("main").some(e => e.options.key === id)
    // 关键耦合：selectPanel 在没有同名 main 条目时**直接抛错**
    //   (layout.selectPanel: main panel "X" is not registered)
    // 所以 id 与 key 必须完全一致，且两者必须同时注册——少一个，点图标就是抛异常。
    slots.inject('sidebar.panellist', function () {
      var un = slots.register({ name: 'sidebar.panellist', id: 'team-progress', order: 800, label: '多 Agent 团队进度' }, TeamIcon);
      return function () { un(); };
    });
    slots.inject('main', function () {
      var un = slots.register({ name: 'main', key: 'team-progress' }, TeamProgressPage);
      return function () { un(); };
    });
    // 右侧栏的停靠面板。sidebarRightTabs 可能不存在（该包未启用），所以是可选
    // 服务：读不到就只少了这一个面板，其余功能照常。
    var tabs = ctx.get('sidebarRightTabs');
    if (tabs !== undefined && typeof tabs.register === 'function') {
      ctx.effect(function () {
        var off = tabs.register({
          id: PANE_ID,
          kind: PANE_KIND,
          title: function () { return '多 Agent 进度'; },
          guide: [{
            order: 30,
            title: function () { return '多 Agent 团队进度'; },
            description: function () { return 'Planner / Coder / Reviewer / Validator 的交互时序、思考过程与产出摘要'; },
            icon: TeamIcon
          }]
        });
        return function () { off(); };
      });
      slots.inject('sidebar.right.pane.tab', function () {
        var un = slots.register({ name: 'sidebar.right.pane.tab', key: PANE_ID }, TeamPane);
        return function () { un(); };
      });
      slots.inject('sidebar.right.pane.tab.title', function () {
        var un = slots.register({ name: 'sidebar.right.pane.tab.title', key: PANE_ID }, TeamTabTitle);
        return function () { un(); };
      });
    }
    // settings.section 的看板保持原样：它是一个独立页面，与进度页互不影响。
    slots.inject('settings.section', function () {
      var un = slots.register({ name: 'settings.section', id: 'team', order: 500, label: '多 Agent 团队' }, Board);
      return function () { un(); };
    });
  }

  exports.name = 'team-flowise-client'; exports.inject = ['slots', 'locale']; exports.apply = apply; return module.exports;
} });