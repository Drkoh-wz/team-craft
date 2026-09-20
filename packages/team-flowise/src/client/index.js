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

  var STYLE = '.tf-root{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937)}.tf-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.tf-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-text-muted,#6b7280)}.tf-tab.active{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.tf-toolbar{display:flex;gap:8px}.tf-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);cursor:pointer;font-size:13px;color:var(--dsw-alias-text,#1f2937)}.tf-btn.primary{background:#3b82f6;color:#fff;border-color:#3b82f6}.tf-btn.danger{color:#ef4444;border-color:#ef4444}.tf-btn:disabled{opacity:.5;cursor:default}.tf-board{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:8px}.tf-col{min-width:230px;flex:0 0 230px;background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:12px;padding:10px}.tf-col-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.tf-col-title{font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}.tf-count{background:var(--dsw-alias-surface,#fff);border-radius:999px;padding:0 8px;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-card{background:var(--dsw-alias-surface,#fff);border-radius:10px;border:1px solid var(--dsw-alias-border,#e5e7eb);padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:box-shadow .15s,border-color .15s}.tf-card:hover{border-color:#3b82f6;box-shadow:0 4px 14px rgba(0,0,0,.08)}.tf-card-req{font-size:13px;font-weight:600;line-height:1.4;margin-bottom:6px}.tf-card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-chip{background:var(--dsw-alias-surface-2,#f3f4f6);border-radius:6px;padding:1px 6px;font-size:11px}.tf-list{background:var(--dsw-alias-surface,#fff);border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;padding:12px}.tf-row{display:flex;align-items:center;gap:12px;padding:12px 6px;border-bottom:1px solid var(--dsw-alias-border,#e5e7eb)}.tf-row:last-child{border-bottom:none}.tf-row-main{flex:1;min-width:0}.tf-row-title{font-size:13px;font-weight:600}.tf-row-sub{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-top:2px}.tf-icon-btn{background:none;border:none;cursor:pointer;font-size:16px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-icon-btn:hover{color:#3b82f6}.tf-empty{padding:24px;text-align:center;color:var(--dsw-alias-text-muted,#6b7280);font-size:13px}.tf-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}.tf-modal-card{background:var(--dsw-alias-surface,#fff);border-radius:14px;padding:20px;width:min(560px,92vw);max-height:88vh;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.25)}.tf-field{margin-bottom:12px}.tf-field-label{font-size:12px;font-weight:600;margin-bottom:5px;color:var(--dsw-alias-text,#1f2937);display:block}.tf-input,.tf-select,.tf-textarea{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);font-size:13px;background:var(--dsw-alias-surface,#fff);color:var(--dsw-alias-text,#1f2937)}.tf-textarea{min-height:70px;resize:vertical;font-family:inherit}.tf-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}.tf-form-row{display:flex;gap:10px;flex-wrap:wrap}.tf-form-col{flex:1 1 180px;min-width:180px}.tf-help{font-size:11px;line-height:1.5;color:var(--dsw-alias-text-muted,#6b7280);margin-top:4px}.tf-ctl-note{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-top:4px}.tf-err{font-size:12px;line-height:1.5;color:#b91c1c;background:#fee2e2;border-radius:8px;padding:6px 9px;margin-bottom:10px}.tf-manual{background:none;border:none;padding:0;cursor:pointer;font-size:11px;color:#3b82f6;text-decoration:underline;margin-top:4px}.tf-manual:hover{color:#1d4ed8}';

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

  // ---------------------------------------------------------------------------
  // P11: 角色定义（agentDef）里真实存在的字段投影。
  //
  // 这一行以前写的是 `a.model.name` —— agentDefSchema.model 是
  // { provider, model, reasoningEffort, maxTokens }，**没有 name 键**，所以那个分支
  // 永远不成立，摘要里从来没有出现过模型名。这里只读真实字段：缺什么就不显示
  // 什么，绝不把 undefined 印到界面上。
  // ---------------------------------------------------------------------------
  function agentModelText(a) {
    var m = (a && a.model && typeof a.model === 'object') ? a.model : {};
    var provider = typeof m.provider === 'string' && m.provider !== '' ? m.provider : '';
    var model = typeof m.model === 'string' && m.model !== '' ? m.model : '';
    if (provider !== '' && model !== '') return provider + '/' + model;
    if (model !== '') return model + '（未声明 provider，成对规则下 provider/model 作废）';
    if (provider !== '') return provider + '（未声明 model，成对规则下 provider/model 作废）';
    return '';
  }
  function agentRouteSummary(a) {
    var m = (a && a.model && typeof a.model === 'object') ? a.model : {};
    var parts = [];
    var mt = agentModelText(a);
    if (mt !== '') parts.push(mt);
    if (typeof m.reasoningEffort === 'string' && m.reasoningEffort !== '') parts.push('effort ' + m.reasoningEffort);
    var preset = a && a.tools && typeof a.tools.preset === 'string' && a.tools.preset !== '' ? a.tools.preset : '';
    if (preset !== '') parts.push('预设 ' + preset);
    var sp = typeof (a && a.systemPrompt) === 'string' ? a.systemPrompt : '';
    if (sp !== '') parts.push('人设 ' + sp.length + ' 字');
    return parts.join(' · ');
  }
  function AgentsView(props) {
    var rows = props.agents.length ? props.agents.map(function (a) {
      var sub = agentRouteSummary(a);
      return React.createElement('div', { key: a.id, className: 'tf-row' },
        React.createElement('div', { className: 'tf-row-main' },
          React.createElement('div', { className: 'tf-row-title' }, a.name),
          // 角色说明与真实字段摘要分两行：两者都可能不存在，空的那行不渲染。
          a.role ? React.createElement('div', { className: 'tf-row-sub' }, a.role) : null,
          sub !== '' ? React.createElement('div', { className: 'tf-row-sub' }, sub) : null
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

  // ---------------------------------------------------------------------------
  // P11: 模型目录（GET /models）驱动的表单选项。
  //
  // 目录只是一个**便利**，不是依赖：这一组函数在任何一步拿不到数据时都返回空
  // 列表，由调用方退回手工输入。空列表绝不能让表单卡死或抛异常。
  //   providers: [{ id, name, models:[{ id, name, reasoning:{ efforts:[{id,name}],
  //                defaultEffort } }] }]
  // ---------------------------------------------------------------------------
  var PROVIDER_NONE = '\u0000none';   // 选项 value 用不可打印字符开头，避免与真实 provider 名撞车
  var PROVIDER_MANUAL = '\u0000manual';
  function providerListOf(cat) {
    var list = (cat && Array.isArray(cat.providers)) ? cat.providers : [];
    return list.filter(function (p) { return p !== null && typeof p === 'object'; });
  }
  // 只有恰好一条 provider 时才自动选中它：多条时自动选会在不经意间改写某人的
  // 路由，这比让用户多点一下昂贵得多。
  function defaultProvider(list) { return list.length === 1 ? String(list[0].id) : ''; }
  // 名字可能被手动输入，也可能来自目录里的旧记录，所以两种都认。
  function findProvider(list, name) {
    var want = typeof name === 'string' ? name : '';
    if (want === '') return null;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === want || String(list[i].name) === want) return list[i];
    }
    return null;
  }
  function modelsOf(p) { return (p && Array.isArray(p.models)) ? p.models : []; }
  function findModel(p, id) {
    var list = modelsOf(p);
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function effortsOf(p, modelId) {
    var m = findModel(p, modelId);
    var r = m && m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : null;
    return r && Array.isArray(r.efforts) ? r.efforts.filter(function (e) { return e !== null && typeof e === 'object' && e.id !== undefined && e.id !== null; }) : [];
  }
  function defaultEffortOf(p, modelId) {
    var m = findModel(p, modelId);
    var r = m && m.reasoning && typeof m.reasoning === 'object' ? m.reasoning : null;
    return r && typeof r.defaultEffort === 'string' ? r.defaultEffort : '';
  }
  // Comma-separated text -> a de-duplicated, trimmed list. An empty box means
  // "declare nothing", i.e. the key is omitted rather than stored as [].
  function splitList(text) {
    var out = [];
    String(text === undefined || text === null ? '' : text).split(',').forEach(function (x) {
      var t = x.trim();
      if (t !== '' && out.indexOf(t) === -1) out.push(t);
    });
    return out;
  }
  function listToText(list) {
    return Array.isArray(list) ? list.map(function (x) { return String(x); }).join(', ') : '';
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

    // -------------------------------------------------------------------------
    // P11: 可编辑的 agent 表单草稿 + 模型目录。
    //
    // 目录只在弹窗真的打开时取一次（这是**新增**的一次 GET /models；boards 的
    // 既有轮询一行没动）。取不到不是错误状态：providers 留空，表单退回手工输入。
    // -------------------------------------------------------------------------
    var mst = React.useState({ providers: [], errors: [], loaded: false });
    var models = mst[0]; var setModels = mst[1];
    React.useEffect(function () {
      if (s.modal !== 'agent') return undefined;
      var alive = true;
      get('/models')
        .then(function (d) {
          if (!alive) return;
          setModels({ providers: providerListOf(d), errors: (d && Array.isArray(d.errors)) ? d.errors : [], loaded: true });
        })
        .catch(function (e) {
          if (!alive) return;
          // 端点不存在（宿主未重启）/ 500 / 网络失败：都降级为手工输入，
          // 并把原因如实写出来，而不是把表单变成空的。
          setModels({ providers: [], errors: ['模型目录获取失败（' + String(e && e.message ? e.message : e) + '）：provider/model/effort 请手工输入'], loaded: true });
        });
      return function () { alive = false; };
    }, [s.modal, setModels]);

    var fst = React.useState(null);
    var agentDraft = fst[0]; var setAgentDraft = fst[1];
    var ast = React.useState({ saving: false, error: null });
    var agentSave = ast[0]; var setAgentSave = ast[1];
    var patchAgent = React.useCallback(function (p) {
      setAgentDraft(function (prev) {
        var next = Object.assign({}, prev || {});
        var d = typeof p === 'function' ? p(next) : p;
        if (d === null || d === undefined) return next;
        return Object.assign(next, d);
      });
    }, []);

    function saveAgent() {
      var d = agentDraft || {};
      setAgentSave({ saving: true, error: null });
      patch({ loading: true, error: null });
      // 完整角色记录（契约）：id 存在即为修改既有角色；model 里空字段一律省略，
      // 因为 `{}` 必须保持"什么都没声明"，而不是被写成空串。
      var m = {};
      if (d.provider) m.provider = d.provider;
      if (d.model) m.model = d.model;
      if (d.reasoningEffort) m.reasoningEffort = d.reasoningEffort;
      var n = parseInt(String(d.maxTokens === undefined ? '' : d.maxTokens).trim(), 10);
      if (isFinite(n) && n > 0) m.maxTokens = n;
      var tools = {};
      if (d.preset) tools.preset = d.preset;
      var allow = splitList(d.allow);
      var deny = splitList(d.deny);
      if (allow.length) tools.allow = allow;
      if (deny.length) tools.deny = deny;
      var body = {
        id: d.id,
        name: d.name || '',
        role: d.role || '',
        systemPrompt: d.systemPrompt || '',
        model: m,
        tools: tools,
        skills: Array.isArray(d.skills) ? d.skills : [],
        updatedAt: Date.now()
      };
      var t = parseInt(String(d.timeoutMs === undefined ? '' : d.timeoutMs).trim(), 10);
      if (isFinite(t) && t > 0) body.timeoutMs = t; else delete body.timeoutMs;
      post('/agent', body)
        .then(function () {
          // The save itself SUCCEEDED, so report that first and only then refresh.
          // Chaining .then(load) before this made a failing refresh surface as
          // "保存失败" -- the UI told the user their edit was lost when it had in
          // fact been stored. A refresh failure is now attributed to the refresh.
          patch({ modal: null, agent: null, loading: false });
          setAgentSave({ saving: false, error: null });
          return load().catch(function (e) {
            patch({ error: '角色已保存，但列表刷新失败：' + String(e && e.message ? e.message : e) });
          });
        })
        .catch(function (e) {
          // 失败必须显示出来：静默关闭弹窗会让人以为改动已经保存。
          var msg = String(e && e.message ? e.message : e);
          setAgentSave({ saving: false, error: msg });
          patch({ loading: false, error: msg });
        });
    }

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

    // 打开弹窗时把角色记录投影成表单草稿：字段缺失就是空串/空值，绝不把
    // undefined 放进受控 input（受控 input 拿到 undefined 会变成非受控并丢值）。
    function openAgent(a) {
      var m = (a && a.model && typeof a.model === 'object') ? a.model : {};
      var t = (a && a.tools && typeof a.tools === 'object') ? a.tools : {};
      setAgentDraft({
        id: (a && a.id) || '',
        name: (a && a.name) || '',
        role: (a && a.role) || '',
        systemPrompt: (a && typeof a.systemPrompt === 'string') ? a.systemPrompt : '',
        provider: (typeof m.provider === 'string') ? m.provider : '',
        model: (typeof m.model === 'string') ? m.model : '',
        reasoningEffort: (typeof m.reasoningEffort === 'string') ? m.reasoningEffort : '',
        maxTokens: (typeof m.maxTokens === 'number' && isFinite(m.maxTokens)) ? String(m.maxTokens) : '',
        timeoutMs: (typeof a.timeoutMs === 'number' && isFinite(a.timeoutMs)) ? String(a.timeoutMs) : '',
        preset: (typeof t.preset === 'string') ? t.preset : '',
        allow: listToText(t.allow),
        deny: listToText(t.deny),
        skills: Array.isArray(a && a.skills) ? (a.skills || []).slice() : []
      });
      setAgentSave({ saving: false, error: null });
      patch({ modal: 'agent', agent: a });
    }
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
      // ---------------------------------------------------------------------
      // P11: 真正可编辑的角色表单（原来是只读展示 + 一个"关闭"按钮）。
      //
      // 字段与控件一一对应 agentDefSchema：名称/角色说明（文本）、systemPrompt
      // （多行 textarea）、model.provider/.model/.reasoningEffort/.maxTokens、
      // timeoutMs、tools.preset/.allow/.deny。下拉选项来自 /models，拿不到时
      // 全部退回手工输入，表单永远不会被空目录卡死。
      // ---------------------------------------------------------------------
      var d = agentDraft || {};
      var provs = providerListOf(models);
      var pObj = findProvider(provs, d.provider);
      var pModels = modelsOf(pObj);
      var curModel = findModel(pObj, d.model);
      var effortList = effortsOf(pObj, d.model);
      var defEffort = defaultEffortOf(pObj, d.model);
      modalTitle = (d.id ? '编辑角色' : '新建角色') + ' \u00B7 ' + (d.name || '');
      // 目录缺失（拿不到 /models）就整块退回手工输入：provs 为空即全部走 input。
      // 目录里没有当前存着的 provider 时同样退回手工输入，而不是给一个空下拉——
      // 空下拉会让人以为值丢了，而且改完一保存就可能把它清掉。
      var manualProv = provs.length === 0 || d.manualProvider === true || (d.provider !== '' && pObj === null);
      var modelManual = pModels.length === 0;

      var nameField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, '名称（name，工作流里用它引用该角色）'),
        React.createElement('input', { className: 'tf-input', value: d.name || '', onChange: function (e) { patchAgent({ name: e.target.value }); } })
      );
      var roleField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, '角色说明（role）'),
        React.createElement('input', { className: 'tf-input', value: d.role || '', onChange: function (e) { patchAgent({ role: e.target.value }); } })
      );
      var promptField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, '角色人设（persona，会遮蔽该子代理的 deployment persona 段；不会移除一等公民指引）'),
        React.createElement('textarea', { className: 'tf-textarea', value: d.systemPrompt || '', onChange: function (e) { patchAgent({ systemPrompt: e.target.value }); } }),
        React.createElement('div', { className: 'tf-help' }, '这一段作为 persona 的 role 层随派发写入（顺序：role → workflow → node）。它只覆盖 deployment persona 段，不会移除编辑/工具等一等公民指引。')
      );
      var noteText = (models.errors && models.errors.length) ? (' /models：' + models.errors.join('；')) : '';
      var provField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, 'provider'),
        manualProv
          ? React.createElement('input', {
              className: 'tf-input',
              placeholder: '手工输入 provider id',
              value: d.provider || '',
              onChange: function (e) { patchAgent({ provider: e.target.value, model: '', reasoningEffort: '' }); }
            })
          : React.createElement('select', {
              className: 'tf-select tf-select-full',
              value: d.provider || '',
              onChange: function (e) {
                var v = e.target.value;
                if (v === PROVIDER_MANUAL) { patchAgent({ manualProvider: true }); return; }
                var np = findProvider(provs, v);
                var one = modelsOf(np)[0];
                patchAgent({ manualProvider: false, provider: v === PROVIDER_NONE ? '' : v, model: one ? String(one.id) : '', reasoningEffort: '' });
              }
            },
              React.createElement('option', { value: '' }, '(不声明 provider)'),
              provs.map(function (p) { return React.createElement('option', { key: String(p.id), value: String(p.id) }, String(p.name || p.id) + (String(p.name || p.id) === String(p.id) ? '' : ' (' + p.id + ')')); }),
              // A stored provider that is not in the catalog must still be
              // selectable: without this option a controlled <select> cannot match
              // its value and the field would LOOK empty right before a save.
              (d.provider !== '' && pObj === null) ? React.createElement('option', { value: String(d.provider) }, String(d.provider) + '（不在模型目录中）') : null,
              React.createElement('option', { value: PROVIDER_MANUAL }, '（手工输入…）')
            ),
        React.createElement('div', { className: 'tf-help' },
          'provider/model 必须成对声明：只声明一半时该对作废（不会与父级拼出一条没人声明过的混合路由）。' +
          (models.loaded === false ? ' 正在读取模型目录…' : '') +
          (models.loaded === true && provs.length === 0 ? ' 模型目录为空或不可用，请手工输入。' : '') +
          noteText
        )
      );
      var modelField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, 'model'),
        (pModels.length > 0 && !modelManual)
          ? React.createElement('select', {
              className: 'tf-select tf-select-full',
              value: d.model || '',
              onChange: function (e) { patchAgent({ model: e.target.value, reasoningEffort: '' }); }
            },
              React.createElement('option', { value: '' }, '(不声明 model)'),
              pModels.map(function (m) {
                var lab = String(m.name || m.id);
                if (m.description) lab += ' · ' + String(m.description);
                if (typeof m.contextWindow === 'number') lab += ' · ctx ' + m.contextWindow;
                return React.createElement('option', { key: String(m.id), value: String(m.id) }, lab);
              }),
              // Same reason as the provider list: a stored model id missing from
              // the catalog needs a matching option, or the control displays blank.
              (d.model !== '' && curModel === null) ? React.createElement('option', { value: String(d.model) }, String(d.model) + '（不在模型目录中）') : null
            )
          : React.createElement('input', {
              className: 'tf-input',
              placeholder: '手工输入 model id',
              value: d.model || '',
              onChange: function (e) { patchAgent({ model: e.target.value, reasoningEffort: '' }); }
            }),
        React.createElement('div', { className: 'tf-help' },
          (d.provider ? '当前 provider：' + d.provider + '。' : '尚未选择 provider。') +
          (curModel && typeof curModel.defaultMaxTokens === 'number' ? ' 该模型默认 maxTokens=' + curModel.defaultMaxTokens + '。' : '') +
          (pModels.length > 0 && !modelManual ? '' : ' 无目录数据，手工输入。')
        )
      );
      var effortField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, 'reasoningEffort（思考强度）'),
        effortList.length
          ? React.createElement('select', {
              className: 'tf-select tf-select-full',
              value: d.reasoningEffort || '',
              onChange: function (e) { patchAgent({ reasoningEffort: e.target.value }); }
            },
              React.createElement('option', { value: '' }, '（不指定）'),
              effortList.map(function (x) { return React.createElement('option', { key: String(x.id), value: String(x.id) }, String(x.name || x.id) + (defEffort === String(x.id) ? '（该模型默认）' : '')); }),
              // A stored effort that this model does not offer must stay visible
              // (and selectable) instead of silently rendering as "（不指定）".
              (d.reasoningEffort !== '' && !effortList.some(function (x) { return String(x.id) === String(d.reasoningEffort); }))
                ? React.createElement('option', { value: String(d.reasoningEffort) }, String(d.reasoningEffort) + '（不在该模型的 effort 列表中）')
                : null
            )
          : React.createElement('input', {
              className: 'tf-input',
              placeholder: '手工输入 effort id（可留空）',
              value: d.reasoningEffort || '',
              onChange: function (e) { patchAgent({ reasoningEffort: e.target.value }); }
            }),
        React.createElement('div', { className: 'tf-help' },
          (effortList.length ? '选项来自该模型的 reasoning.efforts。' : '未取到该模型的 effort 列表，可手工输入。') +
          '若改动了 provider/model 却不声明 effort，运行时会清除继承来的父级 effort，改由该模型默认值决定。'
        )
      );
      var numsField = React.createElement('div', { className: 'tf-form-row' },
        React.createElement('div', { className: 'tf-form-col tf-field' },
          React.createElement('label', { className: 'tf-field-label' }, 'maxTokens（可空）'),
          React.createElement('input', { className: 'tf-input', inputMode: 'numeric', placeholder: '留空 = 不声明', value: d.maxTokens || '', onChange: function (e) { patchAgent({ maxTokens: e.target.value }); } }),
          React.createElement('div', { className: 'tf-help' }, '必须是正有限数；留空表示不声明（该层不参与 maxTokens 决策）。')
        ),
        React.createElement('div', { className: 'tf-form-col tf-field' },
          React.createElement('label', { className: 'tf-field-label' }, 'timeoutMs（可空，宿主会夹紧到上限）'),
          React.createElement('input', { className: 'tf-input', inputMode: 'numeric', placeholder: '留空 = 用宿主上限', value: d.timeoutMs || '', onChange: function (e) { patchAgent({ timeoutMs: e.target.value }); } }),
          React.createElement('div', { className: 'tf-help' }, '角色只能收紧自己的超时：宿主把它夹进 [1000ms, 上限]，永远无法把上限抬高。')
        )
      );
      var presetField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, '工具预设（tools.preset）'),
        React.createElement('select', { className: 'tf-select tf-select-full', value: d.preset || '', onChange: function (e) { patchAgent({ preset: e.target.value }); } },
          React.createElement('option', { value: '' }, '（不指定预设）'),
          React.createElement('option', { value: 'full' }, 'full · 不额外加 deny'),
          React.createElement('option', { value: 'no-write' }, 'no-write · 去掉写文件工具'),
          React.createElement('option', { value: 'no-shell' }, 'no-shell · 去掉命令行工具'),
          React.createElement('option', { value: 'read-only' }, 'read-only · no-write + no-shell')
        ),
        React.createElement('div', { className: 'tf-help' }, '预设是纪律预设，不是沙箱：它按名字移除最明显的写/执行工具（在派发时展开成 deny 列表），拦不住一个被放行的工具间接写入。')
      );
      var toolsField = React.createElement('div', { className: 'tf-form-row' },
        React.createElement('div', { className: 'tf-form-col tf-field' },
          React.createElement('label', { className: 'tf-field-label' }, '工具 allow（逗号分隔）'),
          React.createElement('input', { className: 'tf-input', placeholder: '例如 read, glob', value: d.allow || '', onChange: function (e) { patchAgent({ allow: e.target.value }); } }),
          React.createElement('div', { className: 'tf-help' }, '显式白名单；永远不会重新放行被宿主阻断的工具（如客户端 Inspect / 人类提示类）。')
        ),
        React.createElement('div', { className: 'tf-form-col tf-field' },
          React.createElement('label', { className: 'tf-field-label' }, '工具 deny（逗号分隔）'),
          React.createElement('input', { className: 'tf-input', placeholder: '例如 pwsh, write', value: d.deny || '', onChange: function (e) { patchAgent({ deny: e.target.value }); } }),
          React.createElement('div', { className: 'tf-help' }, '逐名追加到派发用的 deny 列表；部署中不存在的名字会被就地记入 toolNote，不会静默丢弃。')
        )
      );
      var skillField = React.createElement('div', { className: 'tf-field' },
        React.createElement('label', { className: 'tf-field-label' }, '技能 skills（只读展示，本轮不改）'),
        React.createElement('div', { className: 'tf-kv' }, (Array.isArray(d.skills) && d.skills.length) ? d.skills.join(', ') : '（未声明技能）')
      );
      var actions = React.createElement('div', { className: 'tf-modal-actions' },
        React.createElement('button', { className: 'tf-btn', onClick: function () { patch({ modal: null, agent: null }); } }, '取消'),
        React.createElement('button', { className: 'tf-btn primary', disabled: agentSave.saving, onClick: saveAgent }, agentSave.saving ? '保存中…' : '保存')
      );

      // No models catalog at all (host not restarted / endpoint failed): the form
      // is the SAME form, with every provider/model/effort control falling back to
      // a free-text input -- never an empty dropdown that blocks saving.
      modal = React.createElement('div', null,
        agentSave.error ? React.createElement('div', { className: 'tf-err' }, '保存失败：' + String(agentSave.error)) : null,
        nameField,
        roleField,
        promptField,
        provField,
        modelField,
        effortField,
        numsField,
        presetField,
        toolsField,
        skillField,
        actions
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
  // P12: 侧栏页脚常驻芯片的轮询间隔。硬约束是"不得比进度页更密"，所以这里与
  // 进度页同拍（3 秒），不是更密。
  var FOOTER_POLL_MS = 3000;

  // ---------------------------------------------------------------------------
  // P12：会话归属 —— "这条运行是不是本会话发起的？"
  //
  // 缺陷：进度页以前问的是 /progress（不带任何参数），拿到的永远是**全进程最新**
  // 的一次运行。别的会话让 AI 调团队干活时，本会话的侧栏要么看到别人的运行，要么
  // 什么都没跑过而只看到空态。
  //
  // 当前会话 id 的取法（三跳，全部经过实际核对，不是猜的）：
  //   1) 会话作用域槽位（sidebar.right.pane.tab / .title）的 props 直接带
  //      `sessionId: SessionId`                       —— slots 目录 standardProps 原文
  //   2) 根作用域槽位（main / settings.section / sidebar.footer.action）的 props 带
  //      标准座位 `useSessions`：ui-session 用
  //        ctx.slots.provideRoot({ hooks: { sessions: ctx.sessions.list, ... } })
  //      （dsh-client-ui-session/lib/client.js:321-324）发布，渲染层把 hook 名按
  //      standardHookPropName('sessions') = 'useSessions' 注入进每个根作用域条目
  //      （dsh-client-ui-renderer/lib/client.js:538-556）
  //   3) 兜底：apply() 里 ctx.get('sessions') 捕获的客户端 sessions 服务，按快照现读
  //      contract/sessions.d.ts:19-21  interface ISessions { readonly list: ObservableSnapshot<SessionListState> }
  //      sessions/service.d.ts:61-69  interface SessionListState { ids; byId; current: SessionId | undefined; ... }
  //
  // 三跳都拿不到 => "未知会话"：/progress **不带** session 参数（与改动前逐字一致），
  // 界面如实写"全部运行"。绝不把别人的运行当成自己的。
  // ---------------------------------------------------------------------------
  var SESSIONS_SVC = null;    // apply() 捕获；服务缺席时保持 null（不是错误）
  var OPEN_PROGRESS = null;   // apply() 组装的"打开进度面"降级链；缺席时什么都不做

  /** `useSessions` 的选择器：只读当前会话 id（SessionListState.current）。 */
  function sessionCurrentOf(state) {
    return state && typeof state.current === 'string' && state.current !== '' ? state.current : null;
  }

  /** 会话 id 的短形式，只用于界面标注，不参与任何判定。 */
  function shortSid(id) { return typeof id === 'string' && id !== '' ? '#' + id.slice(-6) : ''; }

  /**
   * 当前会话 id，每次调用都从 sessions 服务的快照里现取（所以轮询里重新取值就能
   * 跟随现场切换会话）。服务缺失 / 形状不符 / 取值抛错一律返回 null —— 调用方据此
   * 退回"全部运行"。
   * @returns 会话 id，或 null。
   */
  function currentSessionIdFromService() {
    try {
      var svc = SESSIONS_SVC;
      if (svc === null || svc === undefined) return null;
      var list = svc.list;
      if (list === null || list === undefined || typeof list.getSnapshot !== 'function') return null;
      return sessionCurrentOf(list.getSnapshot());
    } catch (e) {
      return null;
    }
  }

  /**
   * 组件侧的标准会话座位：先看会话作用域直接给的 `sessionId`，再看根作用域标准
   * 钩子 `useSessions`。两者都缺席就返回 null（由服务兜底路径补上）。
   * 钩子只在 props 里真有它时才调用，而同一个组件实例的 props 不会中途改变这一点，
   * 因此钩子顺序是稳定的。
   * @returns 会话 id，或 null。
   */
  function useStandardSessionId(props) {
    var direct = props ? props.sessionId : undefined;
    if (typeof direct === 'string' && direct !== '') return direct;
    if (props && typeof props.useSessions === 'function') {
      try { return props.useSessions(sessionCurrentOf) || null; } catch (e) { return null; }
    }
    return null;
  }

  /**
   * 把 /progress 的答案读成"这是谁的运行"。纯函数：只吃入参，不读 ctx、不写状态。
   *
   * @param asked - 本次请求带上的会话 id；null = 没有会话（改动前的全局最新语义）。
   * @param data - /progress 的响应体（可能为 null / 残缺）。
   * @param runs - /runs 的列表（未按会话过滤；用来判断"别的会话有没有在跑"）。
   * @returns { kind, run, others, legacy, otherExists }：
   *   kind 'none'   什么都没有运行；
   *   kind 'mine'   返回的运行就是本会话的（run.sessionId 逐字等于 asked）；
   *   kind 'other'  返回的运行是**别的会话**的（宿主在 run.sessionId 里回显归属）；
   *   kind 'legacy' 记录早于归属改动（没有 sessionId），无法判定 —— 不猜；
   *   kind 'all'    本次就是按"全部运行"问的（或拿不到会话）。
   *   others       别的会话发起的运行条数（判定状态 b 用，不靠时间戳猜）。
   *   otherExists  "本会话没有、但进程里有别人的运行"确有证据。
   */
  function classifyProgress(asked, data, runs) {
    var run = data && typeof data.run === 'object' && data.run !== null ? data.run : null;
    var list = Array.isArray(runs) ? runs : [];
    var others = 0;
    var legacy = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r.id !== 'string') continue;
      var owner = typeof r.sessionId === 'string' && r.sessionId !== '' ? r.sessionId : null;
      if (owner === null) legacy += 1;
      else if (asked !== null && owner !== asked) others += 1;
    }
    var kind = 'none';
    if (run !== null) {
      var runOwner = typeof run.sessionId === 'string' && run.sessionId !== '' ? run.sessionId : null;
      if (asked === null) kind = 'all';
      else if (runOwner === null) kind = 'legacy';
      else kind = runOwner === asked ? 'mine' : 'other';
    }
    // 宿主半的 scope 信封（P12 新增的"凭什么选了这条"）是最直接的证据，两种写法都要认：
    //   * 旧/兜底写法：runCountInScope === 0 且 fallback === 'latest-global'
    //     —— 宿主在说"你自己的会话一条都没有，我退回全局了"；
    //   * P12 新宿主：{mode:'session', runCountInScope:0, fallback:null, hasAnyGlobal:true}
    //     —— fallback 为 null（按会话查就没有 fallback 可言），但仍明确说了"别处有运行"。
    // 只认前者的后果：当 /runs 也拿不到数据时，面板会把"本会话还没有运行"退化成全局空态。
    var scope = data && typeof data.scope === 'object' && data.scope !== null ? data.scope : null;
    var hostSaysForeign = scope !== null && (
      (scope.runCountInScope === 0 && scope.fallback === 'latest-global') ||
      (scope.runCountInScope === 0 && scope.hasAnyGlobal === true)
    );
    return {
      kind: kind,
      run: run,
      others: others,
      legacy: legacy,
      otherExists: others > 0 || hostSaysForeign || kind === 'other'
    };
  }

  /**
   * 请求失败时印在界面上的说法。401 在这个部署里**不是**"没登录"，而是网关把
   * 未注册的 /api 路径伪装成的样子 —— 必须写清楚，否则会被读成"没有运行"。
   */
  function progressErrorText(msg) {
    var m = msg === undefined || msg === null ? '' : String(msg);
    if (m === '401') return '401：这个部署的网关会把**未注册**的 /api 路径伪装成 401 —— 宿主半可能没加载，或 dsh 还没重启。';
    if (m === '404') return '404：宿主没有注册这条路由。';
    if (m === '500') return '500：宿主在处理这次请求时抛了异常（看宿主日志）。';
    if (/^[0-9]{3}$/.test(m)) return m + '：宿主拒绝了这次请求。';
    if (m === '') return '未知错误（响应里没有可读的错误信息）。';
    return m;
  }

  // The element is <style>; its TEXT must therefore be bare CSS. These strings
  // used to carry their own leading <style> and trailing </style>, so the parser
  // saw a malformed first qualified rule (`<style>.tf-root{...}`) and dropped it
  // -- the element's own first rule never applied.
  var PAGE_STYLE = '.tf-pg{font-family:var(--dsw-alias-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);color:var(--dsw-alias-text,#1f2937);padding:2px}.tf-pg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tf-pg-title{margin:0;font-size:16px;font-weight:700}.tf-pg-sub{font-size:12px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-pg-toolbar{margin-left:auto;display:flex;gap:8px;align-items:center}.tf-pg-sec{margin-top:18px}.tf-pg-sec-h{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:8px}.tf-select{padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);color:var(--dsw-alias-text,#1f2937);font-size:12px;max-width:280px}.tf-seq-box{overflow:auto;border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;background:var(--dsw-alias-surface,#fff)}.tf-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:8px}.tf-legend span{display:inline-flex;align-items:center;gap:4px}.tf-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}.tf-chips{display:flex;gap:8px;flex-wrap:wrap}.tf-chip2{display:flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);border-radius:10px;padding:6px 11px;cursor:pointer;font-size:12px;color:inherit}.tf-chip2:hover{border-color:#3b82f6}.tf-chip2.on{border-color:#3b82f6;box-shadow:inset 0 0 0 1px #3b82f6}.tf-chip2 b{font-weight:700}.tf-ncard{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:12px;background:var(--dsw-alias-surface,#fff);padding:12px 14px;margin-top:10px}.tf-nhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tf-nid{font-weight:700;font-size:14px}.tf-kv{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-lbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-muted,#6b7280);margin:12px 0 4px}.tf-pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-surface-2,#f8fafc);border:1px solid var(--dsw-alias-border,#eef2f7);border-radius:8px;padding:10px;max-height:300px;overflow:auto}.tf-pre.tf-reason{border-color:#8b5cf6}.tf-pre.tf-errbox{border-color:#ef4444;color:#b91c1c}.tf-badge2{border-radius:999px;padding:1px 10px;font-size:11px;color:#fff;white-space:nowrap}.tf-empty{color:var(--dsw-alias-text-muted,#6b7280);font-size:13px;padding:14px 0}.tf-progress{height:6px;border-radius:999px;background:var(--dsw-alias-surface-2,#f3f4f6);overflow:hidden;margin-top:6px}.tf-progress-bar{height:100%;background:#3b82f6;border-radius:999px;transition:width .4s}.tf-rv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tf-rv-verdict{border-radius:999px;padding:1px 10px;font-size:11px;font-weight:700;color:#fff;white-space:nowrap}.tf-rv-group{margin-top:10px}.tf-rv-group-h{font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--dsw-alias-text-muted,#6b7280);margin-bottom:6px}.tf-rv-item{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-surface-2,#f8fafc)}.tf-rv-item.blocking{border-left:3px solid #ef4444}.tf-rv-item.advisory{border-left:3px solid #f5a623}.tf-rv-dim{display:inline-block;border-radius:999px;border:1px solid var(--dsw-alias-border,#e5e7eb);background:var(--dsw-alias-surface,#fff);padding:0 7px;font-size:10px;font-weight:700;margin-right:6px;color:var(--dsw-alias-text-muted,#6b7280)}.tf-rv-crit{font-size:12px;font-weight:600}.tf-rv-field{font-size:11px;line-height:1.6;color:var(--dsw-alias-text,#1f2937);margin-top:3px}.tf-rv-field b{font-weight:700;color:var(--dsw-alias-text-muted,#6b7280)}.tf-rv-note{display:inline-block;border-radius:6px;padding:0 6px;font-size:10px;font-weight:700;background:#fee2e2;color:#b91c1c}.tf-rv-unc{font-size:11px;color:var(--dsw-alias-text-muted,#6b7280);margin:2px 0 0}.tf-rv-res{border:1px solid var(--dsw-alias-border,#e5e7eb);border-radius:10px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-surface,#fff)}.tf-rv-res.yes{border-left:3px solid #22c55e}.tf-rv-res.no{border-left:3px solid #f5a623}.tf-rv-summary{font-size:12px;line-height:1.6;color:var(--dsw-alias-text,#1f2937)}.tf-select.tf-select-full{width:100%;max-width:none}.tf-mb{display:flex;flex-direction:column;gap:6px}.tf-mb-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tf-mb-src{border-radius:6px;padding:0 7px;font-size:10px;font-weight:700;background:var(--dsw-alias-surface-2,#f3f4f6);color:var(--dsw-alias-text-muted,#6b7280)}.tf-mb-eff{font-size:11px;font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--dsw-alias-text,#1f2937);word-break:break-all}.tf-mb-line{font-size:12px;line-height:1.6;color:var(--dsw-alias-text,#1f2937);word-break:break-all}.tf-mb-note{font-size:11px;line-height:1.5;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:5px 8px}.tf-mb-warn{font-size:11px;line-height:1.5;color:#b91c1c;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:5px 8px}';

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

  // ---------------------------------------------------------------------------
  // P11: 节点卡片上的「实际生效的模型」区块。
  //
  // 数据形状（/progress 的轻投影 与 /role 的完整记录都吃）：
  //   route: { source, effective:{provider,model,reasoningEffort,maxTokens},
  //            measured, warning } | null
  //   persona: { chars, layers:[...] } | null
  //
  // 两条硬规则：
  //  1. measured === false 时必须显式写「未能实测（显示的是请求值）」——
  //     measured 为真才代表子代理自己的请求头真的被读过，那时 effective 就是
  //     实测值；否则它只是**按层级推导出来的请求值**，说成实测就是伪造证据。
  //  2. 旧记录（根本没有 route 键 => null）与改动前逐字一致：整块不渲染。
  // ---------------------------------------------------------------------------
  var ROUTE_SOURCE_LABEL = { run: '运行覆盖', node: '节点覆盖', workflow: '工作流', role: '角色定义', inherited: '继承' };
  function routeSourceText(src) {
    if (typeof src !== 'string' || src === '') return '';
    var known = ROUTE_SOURCE_LABEL[src];
    return known ? known : '未知来源 ' + src;
  }
  function routeOf(n) { return (n && typeof n.route === 'object' && n.route !== null) ? n.route : null; }
  function personaOf(n) { return (n && typeof n.persona === 'object' && n.persona !== null) ? n.persona : null; }
  // provider/model 成对显示：运行时的成对规则让"只有一半"成为一条真实可陈述的
  // 事实（该对作废），所以这里如实写出来，而不是留一个空位。
  function pairText(provider, model) {
    var p = (typeof provider === 'string' && provider !== '') ? provider : '';
    var m = (typeof model === 'string' && model !== '') ? model : '';
    if (p !== '' && m !== '') return p + '/' + m;
    if (m !== '') return m + '（未声明 provider，成对规则下 provider/model 作废）';
    if (p !== '') return p + '（未声明 model，成对规则下 provider/model 作废）';
    return '';
  }
  // effort 为空是**有意义的**：adapter 用自己的默认值。所以显式写「（未声明，
  // 由模型/适配器默认值决定）」，而不是留白或写 undefined。
  function effortText(v) {
    return (typeof v === 'string' && v !== '') ? String(v) : '（未声明，由模型/适配器默认值决定）';
  }
  function ModelRouteBlock(props) {
    var r = props.route;
    var persona = props.persona;
    if (r === null && persona === null) return null;
    var rows = [];
    var head = [];
    if (r !== null) {
      head.push(React.createElement('span', { className: 'tf-lbl', style: { margin: 0 }, key: 'l' }, '实际生效的模型'));
      var src = routeSourceText(r.source);
      if (src !== '') head.push(React.createElement('span', { className: 'tf-mb-src', key: 's' }, src));
    }
    rows.push(React.createElement('div', { className: 'tf-mb-head', key: 'h' }, head));

    if (r !== null) {
      var e = (r.effective && typeof r.effective === 'object') ? r.effective : {};
      var pm = pairText(e.provider, e.model);
      if (pm !== '') {
        rows.push(React.createElement('div', { className: 'tf-mb-line', key: 'pm' },
          React.createElement('b', null, 'provider/model：'), pm
        ));
      } else {
        rows.push(React.createElement('div', { className: 'tf-mb-line', key: 'pm' },
          React.createElement('b', null, 'provider/model：'), '（未记录：该节点没有可显示的路由）'
        ));
      }
      rows.push(React.createElement('div', { className: 'tf-mb-eff', key: 'ef' }, 'reasoningEffort: ' + effortText(e.reasoningEffort)));
      rows.push(React.createElement('div', { className: 'tf-mb-eff', key: 'mt' }, 'maxTokens: ' + ((typeof e.maxTokens === 'number' && isFinite(e.maxTokens)) ? String(e.maxTokens) : '（未声明，沿用父级上限 / 适配器默认值）')));
      // 这一行是这块存在的理由：请求值 ≠ 实测值，二者必须能被区分。
      rows.push(React.createElement('div', {
        className: r.measured === true ? 'tf-kv' : 'tf-mb-note',
        key: 'ms'
      }, r.measured === true
        ? '已实测：读取了该子代理自己的请求头，上面的 provider/model/effort 就是它真实运行的路由。'
        : '未能实测（显示的是请求值）：没有读到该子代理自己的请求头，上面是按层级推导出的请求路由，不是实测结果。'));
      if (r.warning) rows.push(React.createElement('div', { className: 'tf-mb-warn', key: 'wn' }, '路由告警：' + String(r.warning)));
    }

    if (persona !== null) {
      var chars = (typeof persona.chars === 'number' && isFinite(persona.chars)) ? persona.chars : 0;
      var layers = Array.isArray(persona.layers) ? persona.layers.filter(function (x) { return typeof x === 'string' && x !== ''; }) : [];
      var layerText = layers.map(function (x) { return ROUTE_SOURCE_LABEL[x] || x; }).join(' → ');
      rows.push(React.createElement('div', { className: 'tf-pg-sec-h', key: 'ph', style: { marginTop: 8 } }, '人设段（persona）'));
      rows.push(React.createElement('div', { className: 'tf-mb-line', key: 'pc' },
        ('人设字数：' + chars + ' 字') + (layers.length ? ' · 生效层：' + layerText : ' · 没有层贡献文本')
      ));
    }
    return React.createElement('div', { className: 'tf-mb' }, rows);
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
    // P11: 该节点实际生效的模型与人设段。两者都没有（旧记录，没有 route /
    // persona 键）时整块不渲染，卡片与改动前逐字一致。
    var nodeRoute = routeOf(n);
    var nodePersona = personaOf(n);
    if (nodeRoute !== null || nodePersona !== null) {
      rows.push(React.createElement(ModelRouteBlock, { key: 'rt', route: nodeRoute, persona: nodePersona }));
    }
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
    // P12: 这一屏显示哪一批运行。'session' = 带上 ?session=<id> 按会话查（本轮的
    // 修复），'all' = 改动前的"全进程最新"。默认 'session'；拿不到会话 id 时它**自己**
    // 退化成 'all'（界面如实写"全部运行"），开关只是让人主动去看全局。
    var ms = React.useState('session'); var mode = ms[0]; var setMode = ms[1];
    var ps = React.useState(null); var polledSid = ps[0]; var setPolledSid = ps[1];

    // 会话 id：props 的标准座位优先，服务快照兜底。两者都拿不到就是 null（未知会话）。
    var hookedSid = useStandardSessionId(props);
    var sessionId = hookedSid || polledSid || null;
    // 生效的会话：'all' 模式或未知会话都是 null => 请求里**不带** session 参数。
    var activeSid = mode === 'all' ? null : sessionId;
    // 轮询回调闭包里的 "最新值"：轮询不能把渲染期的旧值当成新值（看板标签回退那次的教训）。
    var hookedRef = React.useRef(null); hookedRef.current = hookedSid;
    var polledRef = React.useRef(null); polledRef.current = polledSid;

    // /progress 的答案按"我们问的是哪个会话"来读（纯函数，见文件上方 classifyProgress）。
    var cls = classifyProgress(activeSid, s.data, s.runs);

    // 只做函数式更新：把渲染期快照合并回去，长生命周期的轮询回调就会用旧值
    // 覆盖新值（看板标签回退那次事故的根因）。
    var patch = React.useCallback(function (p) {
      set(function (prev) { return Object.assign({}, prev, typeof p === 'function' ? p(prev) : p); });
    }, []);

    var tick = React.useCallback(function () {
      // 每次轮询都重新读一次会话 id：现场切换会话后本页跟着走（标准座位那一路会自己
      // 触发重渲染，服务那一路靠这里同步）。
      var live = currentSessionIdFromService();
      if (polledRef.current !== live) { polledRef.current = live; setPolledSid(live); }
      var sid = mode === 'all' ? null : (hookedRef.current || live);
      // 显式选中的 runId 仍然只发 runId：显式选择优先，且不传新参数时行为与改动前一致。
      var q = runId
        ? ('?runId=' + encodeURIComponent(runId))
        : (sid ? ('?session=' + encodeURIComponent(sid)) : '');
      return get('/progress' + q).then(function (d) {
        patch({ data: d, error: null });
      }).catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        patch(function (prev) { return { data: prev.data, error: msg }; });
      });
    }, [runId, mode, patch]);

    var scopeKey = mode + '|' + (sessionId === null ? '' : sessionId);
    React.useEffect(function () {
      tick();
      var id = setInterval(tick, POLL_MS);
      return function () { clearInterval(id); };
    }, [tick, scopeKey]);

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

    // P12: 角色详情必须跟着**屏幕上那条运行**取，否则会出现"上面写着别的会话的运行、
    // 下面详情却是全进程最新"的自相矛盾。显式选择的 runId 优先（与 /progress 同序）；
    // 没有显式选择时，本会话的运行按 session 取（宿主用同一套归属规则解析它），
    // 别人的运行按它自己的 runId 取 —— 问自己的会话却渲染别人的节点才是真正的错。
    // 拿不到会话、也拿不到运行时是空串 => 与改动前的查询串逐字一致。
    var detailScope = runId
      ? ('&runId=' + encodeURIComponent(runId))
      : (cls.run === null
        ? ''
        : (cls.kind === 'mine' && activeSid
          ? ('&session=' + encodeURIComponent(activeSid))
          : ('&runId=' + encodeURIComponent(cls.run.id))));

    var loadDetail = React.useCallback(function (roleName) {
      if (!roleName) { patch({ detail: null }); return Promise.resolve(); }
      var q = '?agent=' + encodeURIComponent(roleName) + detailScope;
      return get('/role' + q).then(function (d) {
        patch({ detail: d, detailError: null });
      }).catch(function (e) {
        patch({ detailError: e && e.message ? e.message : String(e) });
      });
    }, [detailScope, patch]);

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

    // ---------------------------------------------------------------------
    // P12 状态机（三种状态必须各自可辨，且都写在界面上）：
    //   (a) 本会话有运行      -> cls.kind 'mine'，正常进度（文案与改动前一致）
    //   (b) 本会话没有、全局有 -> cls.kind 'none' + cls.otherExists，或 'other'/'legacy'
    //                            -> 显式写出"本会话暂无运行" + "看全部运行"开关
    //   (c) 完全没有运行      -> 现有空态
    // 另外：拿不到会话 id 时**如实**标注当前是"全部运行"，不假装是本会话的。
    // ---------------------------------------------------------------------
    var scopeLabel = mode === 'all'
      ? ('全部运行' + (sessionId === null ? '（拿不到当前会话）' : '（本会话是 ' + shortSid(sessionId) + '，已主动切到全部）'))
      : (sessionId === null ? '全部运行（拿不到当前会话）' : ('本会话 ' + shortSid(sessionId)));
    var scopeBadge = React.createElement('span', {
      className: 'tf-pg-sub',
      style: { border: '1px solid var(--dsw-alias-border,#e5e7eb)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }
    }, scopeLabel);

    var note = null;
    if (!s.error && mode === 'session' && cls.kind === 'other') {
      note = '本会话暂无运行 —— 下面这条运行是**其他会话**发起的（' + shortSid(cls.run.sessionId) + '），它不是本会话的进度。要看全部就点"看全部运行"。';
    } else if (!s.error && mode === 'session' && cls.kind === 'legacy') {
      note = '本会话暂无运行 —— 下面这条运行记录早于会话归属改动（记录里没有 sessionId），无法判定它由哪个会话发起，所以不把它算作本会话的。';
    } else if (!s.error && mode === 'session' && cls.kind === 'none' && cls.otherExists) {
      note = '本会话暂无运行：本会话一次都没跑过团队，进程里另有 ' + (cls.others > 0 ? cls.others + ' 条别的会话的运行' : '别的会话的运行') + '。点"看全部运行"能看它们。';
    } else if (!s.error && mode === 'all' && cls.kind === 'all') {
      note = '当前是"全部运行"：这是全进程最新的一次运行，它可能属于别的会话。';
    } else if (!s.error && mode === 'session' && cls.kind === 'none' && !cls.otherExists) {
      note = null;
    }
    var noteBlock = note === null ? null : React.createElement('div', {
      style: { marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid #f5a623', background: '#fffbeb', color: '#92400e', fontSize: 12, lineHeight: 1.5 }
    }, note);

    var header = React.createElement('div', { className: 'tf-pg-head' },
      React.createElement(compact ? 'h3' : 'h2', { className: 'tf-pg-title' }, compact ? '多 Agent 进度' : '多 Agent 团队进度'),
      scopeBadge,
      run === null ? React.createElement('span', { className: 'tf-pg-sub' }, '暂无运行') : React.createElement('span', { className: 'tf-badge2', style: { background: runInfo(run.status).color } }, runInfo(run.status).label),
      // 领先显示「哪个工作流 · 几个节点 · 何时开始」，短 id 只作为次级信息。
      run === null ? null : React.createElement('span', { className: 'tf-pg-sub' }, (run.workflowName || wfName(run.workflowId)) + ' · ' + (totals.total || 0) + ' 个节点 · ' + runStamp(run.startedAt) + ' · #' + String(run.id).slice(-6)),
      React.createElement('div', { className: 'tf-pg-toolbar' },
        // P12: "本会话 / 全部运行"的显式开关。本会话没有运行时它是唯一的入口，
        // 所以不藏在折叠里；切换时清掉显式选中的 runId（否则会继续显示那条运行）。
        React.createElement('button', {
          className: 'tf-btn',
          onClick: function () { setRunId(null); setMode(mode === 'all' ? 'session' : 'all'); }
        }, mode === 'all' ? '只看本会话' : '看全部运行'),
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

    // P12: 请求失败必须看得见。**绝不**在失败时渲染"暂无运行"（那是把一次失败说成
    // "没有活干"，401 在这个部署里尤其容易被这么误读）。
    var errorBlock = s.error === null || s.error === undefined ? null : React.createElement('div', {
      style: { marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid #ef4444', background: '#fef2f2', color: '#b91c1c', fontSize: 12, lineHeight: 1.5 }
    },
      '进度获取失败：' + progressErrorText(s.error),
      React.createElement('div', { style: { marginTop: 4, color: '#7f1d1d' } }, '接口 GET ' + API + '/progress' + (activeSid ? ('?session=' + activeSid) : '') + ' —— 这不是"没有运行"，是这次请求失败了。')
    );

    var content;
    if (run === null) {
      // 失败时不渲染空态（上面已经有明确的错误块）；成功且真的没有运行才是空态。
      // P12: 状态 (b)（本会话没有、别的会话有）**不能**复用"暂无运行"那句全局空态
      // —— 那会把"我这次没跑"说成"什么都没有"，正是本轮要修的误读。
      var sessionScopedEmpty = mode === 'session' && sessionId !== null && cls.otherExists;
      content = s.error
        ? null
        : React.createElement('div', { className: 'tf-empty' },
          sessionScopedEmpty
            ? '本会话还没有运行。这个面板按会话过滤，要看别的会话/历史运行，点上面的"看全部运行"。'
            : '暂无运行。启动一个工作流后，这里会显示每个角色的交互时序与产出。');
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
      errorBlock,
      noteBlock,
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

  // P12: sidebar.right.pane.tab 是**会话作用域**槽位，它的 props 里带着
  // `sessionId` 与标准座位 `useSessions`（slots 目录 standardProps 原文）。P9 的实现
  // 把 props 整个丢掉了，于是贴着会话的这个面板反而看不到自己在哪个会话。转发它。
  function TeamPane(props) {
    return React.createElement(TeamProgressPage, {
      compact: true,
      sessionId: props ? props.sessionId : undefined,
      useSessions: props ? props.useSessions : undefined
    });
  }
  function TeamTabTitle() {
    return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
      React.createElement(TeamIcon, { size: 14, active: false }),
      '多 Agent 进度');
  }

  // ---------------------------------------------------------------------------
  // P12: 常驻可见的状态入口 —— `sidebar.footer.action`。
  //
  // 槽位契约（ui-sidebar 声明，已逐字核对：
  //   dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:65-73、:120-124、
  //   dsh-cordis-client-runner 生成的 slots 目录条目）：
  //     kind: 'list' · scope: 'root' · replaceRisk: 'none'
  //     register options: id（必填）/ order（可选）/ label（可选，列表元数据）
  //     ownerProps: { wide: boolean }  —— 侧栏宽形态 / 56px 窄轨
  //     standardProps 含 useSessions（所以这里也能自己读到当前会话）
  //   渲染点：ui-sidebar 的 foot 区 `renderSlot("sidebar.footer.action", { wide })`
  //   （dsh-client-ui-sidebar/lib/client.js:292-301）。它是常驻的、不占中央面板、
  //   不遮挡任何东西 —— shell.overlay 那种浮层正是 P9 删掉的形态，这里不回退过去。
  //
  // 数据源是 `GET /runs`：只有运行记录同时带着 status 与 sessionId，"有没有活干"
  // 和"是谁的活"都只能从它读出来，不猜时间戳。轮询 FOOTER_POLL_MS（3 秒，与进度页
  // 同拍，不比进度页更密）。任何失败都只变成红点 + 一句"获取失败"，绝不抛。
  // ---------------------------------------------------------------------------
  /** 一个运行列表里指定状态的条数（缺字段不算数）。 */
  function countRunStatus(list, status) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].status === status) n += 1;
    return n;
  }

  function TeamFooterAction(props) {
    // wide 缺省按宽形态渲染：ownerProps 里一定有它，但不许依赖它（页面在别的注册面
    // 渲染时可能没有这个字段）。
    var wide = !(props && props.wide === false);
    var st = React.useState({ runs: null, error: null });
    var s = st[0]; var set = st[1];
    var hookedSid = useStandardSessionId(props);
    var hookedRef = React.useRef(null); hookedRef.current = hookedSid;
    var ps = React.useState(null); var polledSid = ps[0]; var setPolledSid = ps[1];
    var polledRef = React.useRef(null); polledRef.current = polledSid;

    var tick = React.useCallback(function () {
      var live = currentSessionIdFromService();
      if (polledRef.current !== live) { polledRef.current = live; setPolledSid(live); }
      return get('/runs').then(function (d) {
        set(function () { return { runs: d && Array.isArray(d.runs) ? d.runs : [], error: null }; });
      }).catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        set(function () { return { runs: null, error: msg }; });
      });
    }, []);

    React.useEffect(function () {
      tick();
      var id = setInterval(tick, FOOTER_POLL_MS);
      return function () { clearInterval(id); };
    }, [tick]);

    var sid = hookedSid || polledSid || null;
    var all = Array.isArray(s.runs) ? s.runs : [];
    // 有会话就只统计**本会话**的运行（"我的团队有没有在干活"），没有会话才统计全部。
    // "别的会话在跑"和"归属未知"各自单独成态，绝不混进自己的计数里：P12 之前的记录
    // 没有 sessionId，那既不是"我的"也不是"别人的"，按未知诚实标出来。
    var mine = [];
    var foreign = [];
    var unknown = [];
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (!r) continue;
      var owner = typeof r.sessionId === 'string' && r.sessionId !== '' ? r.sessionId : null;
      if (owner === null) {
        // 没有会话可判定归属时，它落在"全部运行"这个口径里；有会话时单列。
        if (sid === null) mine.push(r); else unknown.push(r);
      } else if (sid === null || owner === sid) mine.push(r);
      else foreign.push(r);
    }
    var mineRunning = countRunStatus(mine, 'running');
    var mineDone = countRunStatus(mine, 'completed');
    var foreignRunning = countRunStatus(foreign, 'running');
    var unknownRunning = countRunStatus(unknown, 'running');
    var unknownDone = countRunStatus(unknown, 'completed');

    var dot = IDLE_COLOR;
    var text;
    if (s.error !== null && s.error !== undefined) {
      dot = FAILED_COLOR;
      text = '团队：获取失败';
    } else if (all.length === 0) {
      text = '团队：空闲';
    } else if (mineRunning > 0) {
      dot = RUNNING_COLOR;
      text = '团队：' + mineRunning + ' 运行中' + (mineDone > 0 ? ' · ' + mineDone + ' 已完成' : '');
    } else if (foreignRunning > 0) {
      dot = '#f5a623';
      text = '团队：其他会话 ' + foreignRunning + ' 运行中';
    } else if (unknownRunning > 0) {
      dot = '#f5a623';
      text = '团队：' + unknownRunning + ' 运行中（归属未知）';
    } else if (mineDone > 0) {
      dot = DONE_COLOR;
      text = '团队：' + mineDone + ' 已完成';
    } else if (unknownDone > 0) {
      dot = DONE_COLOR;
      text = '团队：' + unknownDone + ' 已完成（归属未知）';
    } else if (unknown.length > 0) {
      text = '团队：' + unknown.length + ' 条运行（归属未知）';
    } else {
      text = '团队：空闲';
    }
    var scopeText = s.error !== null && s.error !== undefined
      ? progressErrorText(s.error)
      : (sid === null ? '全部运行（拿不到当前会话）' : '本会话 ' + shortSid(sid))
        + ' · 运行中 ' + mineRunning + ' · 已完成 ' + mineDone
        + (foreignRunning > 0 ? ' · 其他会话运行中 ' + foreignRunning : '')
        + (unknown.length > 0 ? ' · 归属未知 ' + unknown.length : '');

    return React.createElement('button', {
      type: 'button',
      className: 'tf-foot-chip',
      title: scopeText + ' —— 点击打开进度面板',
      'aria-label': '多 Agent 团队进度：' + text,
      // 降级链在 apply() 里组装；服务全缺时 openProgressSurface() 什么都不做，不抛。
      onClick: function () { openProgressSurface(); },
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: 32, padding: wide ? '0 9px' : '0', width: wide ? 'auto' : 32,
        border: '1px solid var(--dsw-alias-border,#e5e7eb)', borderRadius: 8,
        background: 'var(--dsw-alias-surface,#fff)', color: 'var(--dsw-alias-text-muted,#6b7280)',
        fontFamily: 'inherit', fontSize: 12, lineHeight: 1, cursor: 'pointer', whiteSpace: 'nowrap'
      }
    },
      React.createElement('span', { className: 'tf-dot', style: { background: dot } }),
      wide ? React.createElement('span', null, text) : null
    );
  }

  /**
   * 点开进度面。降级链每一步都 try/catch：两个服务的方法在**目标非法时按契约抛错**
   * （ISidebarRight.openTab:"A kind nothing registered throws."；
   *  ILayout.selectPanel:"@throws if the selected main key is not registered"），
   * 所以 try/catch 是必需的，不是洁癖。
   *   1) ctx.sidebarRight.openTab(PANE_KIND) —— 贴着会话的右栏停靠面板（首选形态）
   *   2) ctx.layout.selectPanel('team-progress') —— 中央面板（会顶掉会话，次选）
   *   3) 什么都不做 —— 服务缺席时芯片仍然是一个诚实的状态读数，绝不因此崩掉
   * @returns 实际执行的那一步（'sidebarRight.openTab' / 'layout.selectPanel' / 'none'）。
   */
  function openProgressSurface() {
    var chain = OPEN_PROGRESS;
    if (typeof chain !== 'function') return 'none';
    try { return chain(); } catch (e) { return 'none'; }
  }

  function apply(ctx) {
    var slots = ctx.get('slots');
    if (slots === undefined) return;
    // P12: 每次 apply 都从零开始捕获，不继承上一次的引用（同一个 face 被两个 ctx 驱动
    // 时——验收脚本就是这么干的——不能读到别人的服务）。
    SESSIONS_SVC = null;
    OPEN_PROGRESS = null;
    // 三个服务都可能缺席（ctx.get 在没有 provide 时返回 undefined，且**不需要** inject
    // 声明：cordis reflect.get 的语义就是"不要求 inject"）。exports.inject 保持
    // ['slots','locale'] 不变 —— 把 'sessions' 加进 inject 会让服务缺失时整个客户端
    // 插件不挂载，那是比少一个面板严重得多的失败。
    try { SESSIONS_SVC = ctx.get('sessions') || null; } catch (e) { SESSIONS_SVC = null; }
    var srService = null;
    try { srService = ctx.get('sidebarRight') || null; } catch (e) { srService = null; }
    var layoutService = null;
    try { layoutService = ctx.get('layout') || null; } catch (e) { layoutService = null; }
    OPEN_PROGRESS = function () {
      if (srService !== null && typeof srService.openTab === 'function') {
        try { srService.openTab(PANE_KIND); return 'sidebarRight.openTab'; } catch (e) { /* 落到中央面板 */ }
      }
      if (layoutService !== null && typeof layoutService.selectPanel === 'function') {
        try { layoutService.selectPanel('team-progress'); return 'layout.selectPanel'; } catch (e) { /* 落到"什么都不做" */ }
      }
      return 'none';
    };
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
    // P12: 第 5 个注册面 —— 侧栏页脚的状态入口（常驻可见，见 TeamFooterAction 的注释）。
    // id 用带命名空间的值，避免和 panellist 的 'team-progress'（语义不同：那是中央面板
    // 的条目）混淆；order 900 让它排在 Settings 附近但不抢位。
    // `inject` 是槽位生命周期的正确机制：槽位此刻已声明就立刻回调，否则等声明提交后再
    // 回调；侧栏 shell 缺席时这里安静地什么都不发生，也不会抛。
    slots.inject('sidebar.footer.action', function () {
      var un = slots.register({ name: 'sidebar.footer.action', id: 'team-flowise-progress', order: 900, label: '多 Agent 团队进度' }, TeamFooterAction);
      return function () { un(); };
    });
  }

  exports.name = 'team-flowise-client'; exports.inject = ['slots', 'locale']; exports.apply = apply; return module.exports;
} });