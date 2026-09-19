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

  function Board() {
    var st = React.useState({ tab: 'board', a: [], w: [], t: [], r: [], run: null, modal: null, task: null, loading: false, error: null, feedback: '' });
    var s = st[0]; var set = st[1];
    var patch = function (p) { set(Object.assign({}, s, p)); };

    var load = React.useCallback(function () {
      Promise.all([
        get('/agents').then(function (d) { return d.agents; }).catch(function () { return []; }),
        get('/workflows').then(function (d) { return d.workflows; }).catch(function () { return []; }),
        get('/tasks').then(function (d) { return d.tasks; }).catch(function () { return []; }),
        get('/runs').then(function (d) { return d.runs; }).catch(function () { return []; })
      ]).then(function (x) { patch({ a: x[0], w: x[1], t: x[2], r: x[3] }); });
    }, []);

    React.useEffect(function () { load(); var id = setInterval(load, 5000); return function () { clearInterval(id); }; }, [load]);

    function runAction(fn) {
      patch({ loading: true, error: null });
      Promise.resolve().then(fn).then(load).catch(function (e) { patch({ error: String(e && e.message ? e.message : e) }); }).then(function () { patch({ loading: false }); });
    }

    // Inline field handlers: because react state closures are tricky with uncontrolled inputs,
    // we keep input values on a mutable object captured by the Board closure.
    var draft = { assignee: '', requirement: '', acceptanceCriteria: '', reviewer: '', feedback: '' };

    function createTask() {
      if (!draft.requirement) return;
      patch({ loading: true, error: null });
      post('/task/create', { assignee: draft.assignee, requirement: draft.requirement, acceptanceCriteria: draft.acceptanceCriteria, reviewer: draft.reviewer })
        .then(load).then(function () { patch({ modal: null, task: null, loading: false }); })
        .catch(function (e) { patch({ error: String(e.message || e), loading: false }); });
    }

    function reworkTask() {
      var t = s.task;
      if (!t || !draft.feedback) return;
      post('/task/rework', { id: t.id, feedback: draft.feedback })
        .then(load).then(function () { patch({ modal: null, task: null, feedback: '' }); })
        .catch(function (e) { patch({ error: String(e.message || e) }); });
    }

    function openTask(t){
      draft.assignee = (t && t.assignee) || ''; draft.requirement = (t && t.requirement) || ''; draft.acceptanceCriteria = (t && t.acceptanceCriteria) || ''; draft.reviewer = (t && t.reviewer) || ''; draft.feedback = '';
      patch({ modal: 'task', task: t || null });
    }

    function BoardView() {
      var by = {};
      s.t.forEach(function (t) { (by[t.status] = by[t.status] || []).push(t); });
      var cols = STATUS_COLUMNS.map(function (c) {
        var items = by[c.key] || [];
        var cards = items.length ? items.map(function (t) {
          return React.createElement('div', { key: t.id, className: 'tf-card', onClick: function () { openTask(t); } },
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

    function AgentsView() {
      var rows = s.a.length ? s.a.map(function (a) {
        return React.createElement('div', { key: a.id, className: 'tf-row' },
          React.createElement('div', { className: 'tf-row-main' },
            React.createElement('div', { className: 'tf-row-title' }, a.name),
            React.createElement('div', { className: 'tf-row-sub' }, (a.role || '') + (a.model && a.model.name ? ' · ' + a.model.name : ''))
          ),
          React.createElement('span', { className: 'tf-chip' }, Object.keys(a.tools || {}).length + ' 工具'),
          React.createElement('button', { className: 'tf-btn', onClick: function () { patch({ modal: 'agent', agent: a }); } }, '详情')
        );
      }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无 Agent')];
      return React.createElement('div', { className: 'tf-list' }, rows);
    }

    function WorkflowsView() {
      var rows = s.w.length ? s.w.map(function (x) {
        var nodeCount = Object.keys(x.nodes || {}).length;
        return React.createElement('div', { key: x.id, className: 'tf-row' },
          React.createElement('div', { className: 'tf-row-main' },
            React.createElement('div', { className: 'tf-row-title' }, x.name),
            React.createElement('div', { className: 'tf-row-sub' }, (x.description || '') + (x.description ? ' · ' : '') + nodeCount + ' 节点')
          ),
          React.createElement('button', { className: 'tf-btn primary', disabled: s.loading, onClick: function () { runAction(function () { return post('/run/start', { workflowId: x.id }); }); } }, '运行'),
          React.createElement('button', { className: 'tf-btn danger', onClick: function () { runAction(function () { return del('/workflow?id=' + encodeURIComponent(x.id)); }); } }, '删除')
        );
      }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无工作流')];
      return React.createElement('div', { className: 'tf-list' }, rows);
    }

    function RunsView() {
      var rows = s.r.length ? s.r.map(function (x) {
        var ns = x.nodeStates || {};
        var done = Object.keys(ns).filter(function (k) { return ns[k] === 'completed' || ns[k] === 'success'; }).length;
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

    function TasksView() {
      var rows = s.t.length ? s.t.map(function (t) {
        return React.createElement('div', { key: t.id, className: 'tf-row' },
          React.createElement('div', { className: 'tf-row-main' },
            React.createElement('div', { className: 'tf-row-title' }, t.requirement),
            React.createElement('div', { className: 'tf-row-sub' }, (t.assignee || '') + (t.reviewer ? ' · 评审:' + t.reviewer : '') + ' · it' + (t.iteration || 1))
          ),
          React.createElement(Badge, null, t.status),
          React.createElement('button', { className: 'tf-icon-btn', onClick: function () { openTask(t); } }, '\u270E')
        );
      }) : [React.createElement('div', { key: 'e', className: 'tf-empty' }, '暂无任务')];
      return React.createElement('div', { className: 'tf-list' }, rows);
    }

    var body;
    if (s.tab === 'agents') body = React.createElement(AgentsView, null);
    else if (s.tab === 'workflows') body = React.createElement(WorkflowsView, null);
    else if (s.tab === 'tasks') body = React.createElement(TasksView, null);
    else if (s.tab === 'runs') body = React.createElement(RunsView, null);
    else body = React.createElement(BoardView, null);

    var modal = null; var modalTitle = '';
    if (s.modal === 'task') {
      var isEdit = !!(s.task && s.task.id);
      modalTitle = isEdit ? '编辑任务' : '新建任务';
      modal = React.createElement('div', null,
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '指派 Agent'),
          React.createElement('select', { className: 'tf-select', value: draft.assignee, onChange: function (e) { draft.assignee = e.target.value; } },
            React.createElement('option', { value: '' }, '(未指派)'),
            s.a.map(function (a) { return React.createElement('option', { key: a.id, value: a.name || a.id }, a.name || a.id); })
          )
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '需求'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.requirement, onChange: function (e) { draft.requirement = e.target.value; } })
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '验收标准'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.acceptanceCriteria, onChange: function (e) { draft.acceptanceCriteria = e.target.value; } })
        ),
        React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '评审人'),
          React.createElement('select', { className: 'tf-select', value: draft.reviewer, onChange: function (e) { draft.reviewer = e.target.value; } },
            React.createElement('option', { value: '' }, '(无)'),
            s.a.map(function (a) { return React.createElement('option', { key: a.id, value: a.name || a.id }, a.name || a.id); })
          )
        ),
        isEdit ? React.createElement('div', { className: 'tf-field' }, React.createElement('label', { className: 'tf-field-label' }, '返工反馈'),
          React.createElement('textarea', { className: 'tf-textarea', value: draft.feedback, onChange: function (e) { draft.feedback = e.target.value; } })
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
          React.createElement('button', { className: 'tf-btn', onClick: function () { set(function (old) { return Object.assign({}, old, { modal: null, agent: null }); }); } }, '关闭')
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

  function apply(ctx) {
    var slots = ctx.get('slots');
    if (slots === undefined) return;
    slots.inject('settings.section', function () {
      var un = slots.register({ name: 'settings.section', id: 'team', order: 500, label: '多 Agent 团队' }, Board);
      return function () { un(); };
    });
  }
  exports.name = 'team-flowise-client'; exports.inject = ['slots', 'locale']; exports.apply = apply; return module.exports;
} });