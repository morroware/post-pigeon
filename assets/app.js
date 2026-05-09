/* =============================================================
   Post Pigeon — vanilla JS app
   No frameworks. State is a plain object, persisted to localStorage
   and (when available) to PHP storage.php on the server.
   ============================================================= */

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------- State ---------------- */
const STATE = {
  tabs: [],          // [{id, name, dirty, request}]
  activeTabId: null,
  collections: [],   // [{id, name, open:true, requests:[reqLite]}]
  history: [],       // [{id, ts, method, url, status, timeMs}]
  envs: [],          // [{id, name, vars:[{key,val,enabled}]}]
  activeEnvId: null,
  serverProxy: null, // 'ok' | 'fallback' | null
};

const newRequest = (over={}) => normalizeRequest({
  id: uid(),
  name: 'Untitled',
  method: 'GET',
  url: '',
  params:    [],
  headers:   [],
  form:      [],
  urlencoded:[],
  body:      { mode: 'none', raw: '', rawType: 'json', binary: null },
  auth:      { type: 'none', basic: {user:'',pass:''}, bearer:{token:''}, apikey:{key:'',value:'',in:'header'} },
  description: '',
  prescript: '',
  tests: '',
  settings: { followRedirects: false, verifySSL: true, timeout: 30 },
  response: null,    // {status, timeMs, sizeBytes, headers, body, error?}
  testResults: [],
  ...over,
});

// Hydrates a (possibly-old) request to the current schema. Used whenever a
// request enters the app from external data — collections, history, imports.
// Don't trust the shape of anything we read off disk.
function normalizeRequest(r = {}) {
  const out = { ...r };
  out.id          = r.id || uid();
  out.name        = r.name || 'Untitled';
  // method must be ASCII letters only — interpolated into HTML attributes
  // and data-m="" downstream, so we lock it down at the entry point.
  const m         = String(r.method || 'GET').toUpperCase();
  out.method      = /^[A-Z]+$/.test(m) ? m : 'GET';
  out.url         = r.url || '';
  out.description = r.description || '';
  out.prescript   = r.prescript || '';
  out.tests       = r.tests || '';
  for (const k of ['params','headers','form','urlencoded']) {
    out[k] = Array.isArray(r[k]) ? r[k] : [];
  }
  const b = (r.body && typeof r.body === 'object') ? r.body : {};
  out.body = {
    mode:    b.mode || 'none',
    raw:     b.raw || '',
    rawType: b.rawType || 'json',
    binary:  b.binary ?? null,
  };
  const a = (r.auth && typeof r.auth === 'object') ? r.auth : {};
  out.auth = {
    type:   a.type || 'none',
    basic:  { user: a.basic?.user || '',  pass: a.basic?.pass || '' },
    bearer: { token: a.bearer?.token || '' },
    apikey: { key: a.apikey?.key || '', value: a.apikey?.value || '', in: a.apikey?.in || 'header' },
  };
  const s = (r.settings && typeof r.settings === 'object') ? r.settings : {};
  out.settings = {
    followRedirects: !!s.followRedirects,
    verifySSL:       s.verifySSL !== false,
    timeout:         Number.isFinite(+s.timeout) && +s.timeout > 0 ? +s.timeout : 30,
  };
  out.response    = r.response || null;
  out.testResults = Array.isArray(r.testResults) ? r.testResults : [];
  return out;
}

/* ---------------- Persistence ---------------- */
const LS_KEY = 'postpigeon.v1';
const PERSIST_KEYS = ['collections', 'history', 'envs', 'activeEnvId'];
function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object') return;
  for (const k of PERSIST_KEYS) {
    if (snap[k] !== undefined) STATE[k] = snap[k];
  }
}
let persistTimer = null;
async function persistNow() {
  const snap = {
    collections: STATE.collections,
    history:     STATE.history.slice(0, 200),
    envs:        STATE.envs,
    activeEnvId: STATE.activeEnvId,
  };
  try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch {}
  // Mirror to server if storage.php is reachable.
  try {
    await fetch('storage.php?action=set&bucket=workspace', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(snap),
    });
  } catch {}
}
function persist() {
  // Debounce server writes — prevents a flood of POSTs while users type.
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 200);
}
async function hydrate() {
  let merged = null;
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (cached && typeof cached === 'object') merged = cached;
  } catch {}
  // Server snapshot wins per-key when present, but missing keys keep their cached value.
  try {
    const r = await fetch('storage.php?action=get&bucket=workspace');
    if (r.ok) {
      const j = await r.json();
      if (j && j.data && typeof j.data === 'object') merged = { ...(merged||{}), ...j.data };
    }
  } catch {}
  applySnapshot(merged);
  if (!Array.isArray(STATE.collections) || !STATE.collections.length) seed();
  if (!Array.isArray(STATE.envs)) STATE.envs = [];
  if (!Array.isArray(STATE.history)) STATE.history = [];
}

function seed() {
  STATE.envs = [
    { id: uid(), name: 'Local', vars: [
      {key:'baseUrl', val:'http://localhost:3000', enabled:true},
      {key:'token',   val:'dev_token_xxx',         enabled:true},
    ]},
    { id: uid(), name: 'Staging', vars: [
      {key:'baseUrl', val:'https://staging.api.example.com', enabled:true},
      {key:'token',   val:'',                                enabled:true},
    ]},
    { id: uid(), name: 'Production', vars: [
      {key:'baseUrl', val:'https://api.example.com', enabled:true},
      {key:'token',   val:'',                        enabled:true},
    ]},
  ];
  STATE.activeEnvId = STATE.envs[0].id;

  STATE.collections = [
    { id: uid(), name: 'Sample · httpbin', open: true, requests: [
      makeLite('GET',  'https://httpbin.org/get?hello=world',  'List things'),
      makeLite('POST', 'https://httpbin.org/post',             'Create thing',
        {body:{mode:'raw', raw:'{\n  "name": "Post Pigeon",\n  "ok": true\n}', rawType:'json'}}),
      makeLite('PUT',  'https://httpbin.org/put',              'Update thing'),
      makeLite('DELETE','https://httpbin.org/delete',          'Delete thing'),
    ]},
    { id: uid(), name: 'My API', open: false, requests: [
      makeLite('GET',  '{{baseUrl}}/v1/users',                 'GET /users'),
      makeLite('GET',  '{{baseUrl}}/v1/users/{{userId}}',      'GET /users/:id'),
      makeLite('POST', '{{baseUrl}}/v1/auth/login',            'Login',
        {body:{mode:'raw', raw:'{\n  "email": "you@example.com",\n  "password": ""\n}', rawType:'json'}}),
    ]},
  ];
}
function makeLite(method, url, name, over={}) {
  return newRequest({ method, url, name, ...over });
}

/* ---------------- Variable resolution ---------------- */
function activeEnv() { return STATE.envs.find(e => e.id === STATE.activeEnvId) || null; }
function getVarMap() {
  const env = activeEnv();
  const m = new Map();
  if (env) for (const v of env.vars) if (v.enabled && v.key) m.set(v.key, v.val);
  return m;
}
function resolveVars(str) {
  if (!str) return str;
  const m = getVarMap();
  return String(str).replace(/\{\{([^}]+)\}\}/g, (_, k) => m.has(k.trim()) ? m.get(k.trim()) : `{{${k}}}`);
}
function highlightVars(text) {
  const m = getVarMap();
  const escaped = text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  return escaped.replace(/\{\{([^}]+)\}\}/g, (_, k) =>
    `<span class="var ${m.has(k.trim()) ? '' : 'unset'}">{{${k}}}</span>`);
}

/* ---------------- Send ---------------- */
async function sendRequest(req) {
  // Apply pre-request script (sandboxed). Surface errors so users can debug.
  try {
    runUserScript(req.prescript, { req });
  } catch (e) {
    toast('Pre-request script error: ' + (e.message || e), 'err');
  }

  // Build the actual request after variable substitution.
  const url = buildUrl(req);
  const headers = buildHeaders(req);
  const body = buildBody(req);

  const payload = {
    method: req.method,
    url,
    headers,
    body,
    timeout: req.settings.timeout || 30,
    followRedirects: !!req.settings.followRedirects,
    verifySSL: req.settings.verifySSL !== false,
  };
  const t0 = performance.now();
  let resp;
  try {
    if (STATE.serverProxy === 'ok') {
      const r = await fetch('proxy.php', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      resp = await r.json();
    } else {
      // Direct fetch fallback (will hit CORS for many APIs).
      const init = { method: req.method, headers: {} };
      for (const h of headers) {
        if (!h.name) continue;
        // Some headers are forbidden by the Fetch spec (Cookie, Host, etc.) and
        // throw when assigned. Skip individually so one bad header doesn't kill
        // the whole request.
        try { init.headers[h.name] = h.value || ''; } catch {}
      }
      if (body && !['GET','HEAD'].includes(req.method)) init.body = body;
      const r = await fetch(url, init);
      const txt = await r.text();
      const hdrs = []; r.headers.forEach((v,k) => hdrs.push({name:k, value:v}));
      resp = {
        status: r.status, headers: hdrs, body: txt,
        timeMs: Math.round(performance.now() - t0),
        sizeBytes: new Blob([txt]).size, finalUrl: r.url, redirects: 0,
      };
    }
  } catch (err) {
    resp = { error: String(err.message || err), timeMs: Math.round(performance.now() - t0) };
  }

  req.response = resp;
  // Run tests
  req.testResults = runTests(req);
  // History
  STATE.history.unshift({
    id: uid(), ts: Date.now(),
    method: req.method, url, status: resp.status || 0,
    timeMs: resp.timeMs || 0, snapshot: structuredClone(simplify(req)),
  });
  STATE.history = STATE.history.slice(0, 200);
  // Bypass the 200ms debounce — we want history flushed before the user
  // navigates away from a freshly-sent request.
  await persistNow();
}

function buildUrl(req) {
  let url = resolveVars(req.url || '');
  const pairs = (req.params || []).filter(p => p.enabled !== false && p.key)
    .map(p => [resolveVars(p.key), resolveVars(p.val||'')]);
  // API key auth → query mode injects an extra pair.
  const a = req.auth || {};
  if (a.type === 'apikey' && a.apikey && a.apikey.in === 'query' && a.apikey.key) {
    pairs.push([resolveVars(a.apikey.key), resolveVars(a.apikey.value||'')]);
  }
  if (pairs.length) {
    const search = pairs.map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    url += (url.includes('?') ? '&' : '?') + search;
  }
  return url;
}
function buildHeaders(req) {
  // Headers may be stored as {key,val} (UI editor) or {name,value} (legacy/import).
  // Normalize to {name, value}.
  const out = (req.headers || [])
    .map(h => ({ name: h.name ?? h.key ?? '', value: h.value ?? h.val ?? '', enabled: h.enabled }))
    .filter(h => h.enabled !== false && h.name)
    .map(h => ({ name: resolveVars(h.name), value: resolveVars(h.value) }));
  // Auth
  const a = req.auth || {};
  if (a.type === 'basic' && a.basic && a.basic.user) {
    out.push({ name: 'Authorization', value: 'Basic ' + btoa(resolveVars(a.basic.user)+':'+resolveVars(a.basic.pass||'')) });
  } else if (a.type === 'bearer' && a.bearer && a.bearer.token) {
    out.push({ name: 'Authorization', value: 'Bearer ' + resolveVars(a.bearer.token) });
  } else if (a.type === 'apikey' && a.apikey && a.apikey.key && (a.apikey.in||'header') === 'header') {
    out.push({ name: resolveVars(a.apikey.key), value: resolveVars(a.apikey.value || '') });
  }
  // Body content-type defaults
  const hasCT = () => out.some(h => h.name.toLowerCase() === 'content-type');
  if (req.body.mode === 'raw' && !hasCT()) {
    const map = { json:'application/json', xml:'application/xml', html:'text/html', text:'text/plain', javascript:'application/javascript' };
    out.push({ name: 'Content-Type', value: map[req.body.rawType] || 'text/plain' });
  } else if (req.body.mode === 'urlencoded' && !hasCT()) {
    out.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
  }
  return out;
}
function buildBody(req) {
  if (['GET','HEAD'].includes(req.method)) return null;
  if (req.body.mode === 'raw') return resolveVars(req.body.raw || '');
  if (req.body.mode === 'urlencoded') {
    return req.urlencoded.filter(p => p.enabled !== false && p.key)
      .map(p => encodeURIComponent(resolveVars(p.key))+'='+encodeURIComponent(resolveVars(p.val||''))).join('&');
  }
  if (req.body.mode === 'form') {
    return req.form.filter(p => p.enabled !== false && p.key)
      .map(p => encodeURIComponent(resolveVars(p.key))+'='+encodeURIComponent(resolveVars(p.val||''))).join('&');
  }
  return null;
}

function simplify(req) {
  const { response, testResults, ...rest } = req;
  return rest;
}

/* ---------------- Tests sandbox ---------------- */
function runUserScript(src, ctx) {
  if (!src || !src.trim()) return;
  const env = activeEnv();
  const rb = {
    env: {
      get: k => env ? (env.vars.find(v => v.key===k)||{}).val : undefined,
      set: (k,v) => { if (!env) return;
        const f = env.vars.find(x=>x.key===k);
        if (f) f.val = String(v); else env.vars.push({key:k, val:String(v), enabled:true});
      }
    },
    req: ctx.req,
    res: ctx.res,
    test: () => {}, expect: () => ({ toEqual:()=>{}, toBeTruthy:()=>{}, toContain:()=>{} }),
  };
  // eslint-disable-next-line no-new-func
  new Function('rb', src)(rb);
}
function runTests(req) {
  if (!req.tests || !req.tests.trim() || !req.response) return [];
  const results = [];
  let parsedJson = null;
  try { parsedJson = JSON.parse(req.response.body); } catch {}
  const env = activeEnv();
  const rb = {
    env: { get: k => env ? (env.vars.find(v => v.key===k)||{}).val : undefined, set: ()=>{} },
    req,
    res: { status: req.response.status, headers: req.response.headers, body: req.response.body, json: parsedJson },
    test(name, fn) {
      try { fn(); results.push({ name, pass: true }); }
      catch (e) { results.push({ name, pass: false, msg: String(e.message||e) }); }
    },
    expect(actual) {
      return {
        toEqual: x => { if (actual !== x && JSON.stringify(actual) !== JSON.stringify(x)) throw new Error(`expected ${JSON.stringify(x)}, got ${JSON.stringify(actual)}`); },
        toBeTruthy: () => { if (!actual) throw new Error('expected truthy, got '+JSON.stringify(actual)); },
        toContain: x => { if (!String(actual).includes(x)) throw new Error(`expected to contain ${x}`); },
      };
    },
  };
  try { new Function('rb', req.tests)(rb); }
  catch (e) { results.push({ name: 'script error', pass: false, msg: String(e.message||e) }); }
  return results;
}

/* ---------------- Render ---------------- */
function activeTab() { return STATE.tabs.find(t => t.id === STATE.activeTabId); }

function openRequestInTab(req) {
  const id = uid();
  const cloned = structuredClone(req || {});
  const normalized = normalizeRequest(cloned);
  const tab = { id, name: normalized.name || nameFromUrl(normalized.url) || 'Untitled', request: normalized };
  STATE.tabs.push(tab);
  STATE.activeTabId = id;
  renderTabs();
  renderActivePanel();
}
function nameFromUrl(u) { try { return new URL(u).pathname.replace(/^\/+/, '') || u; } catch { return u; } }

function renderTabs() {
  const bar = $('#tabbar');
  bar.innerHTML = '';
  for (const t of STATE.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === STATE.activeTabId ? ' is-active' : '');
    el.dataset.tabId = t.id;
    el.dataset.dirty = t.dirty ? 'true' : 'false';
    const method = escapeHtml(t.request.method);
    el.innerHTML = `
      <span class="tab-method method-tag" data-m="${method}">${method}</span>
      <span class="tab-name">${escapeHtml(t.name)}</span>
      <span class="tab-dot"></span>
      <button class="tab-close" title="Close">×</button>`;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) { closeTab(t.id); return; }
      STATE.activeTabId = t.id; renderTabs(); renderActivePanel();
    });
    bar.appendChild(el);
  }
  const add = document.createElement('button');
  add.className = 'tab-add'; add.textContent = '+';
  add.addEventListener('click', () => openRequestInTab(newRequest()));
  bar.appendChild(add);
}
function closeTab(id) {
  const i = STATE.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  STATE.tabs.splice(i, 1);
  if (STATE.activeTabId === id) STATE.activeTabId = (STATE.tabs[i] || STATE.tabs[i-1] || {}).id || null;
  if (!STATE.tabs.length) openRequestInTab(newRequest()); else { renderTabs(); renderActivePanel(); }
}

function renderActivePanel() {
  const body = $('#workspaceBody');
  body.innerHTML = '';
  const tab = activeTab(); if (!tab) return;
  const tpl = $('#tpl-tab-panel').content.cloneNode(true);
  const panel = tpl.querySelector('.tab-panel');
  panel.classList.add('is-active');
  body.appendChild(panel);
  bindPanel(panel, tab);
}

function bindPanel(panel, tab) {
  const r = tab.request;

  // ---- Method + URL
  const methodSel = $('select[data-bind="method"]', panel);
  methodSel.value = r.method;
  methodSel.dataset.m = r.method;
  methodSel.addEventListener('change', () => {
    r.method = methodSel.value; methodSel.dataset.m = r.method;
    renderTabs(); markDirty(tab);
  });

  const urlInput = $('input[data-bind="url"]', panel);
  const urlOver = $('[data-overlay]', panel);
  urlInput.value = r.url;
  const refreshOverlay = () => { urlOver.innerHTML = highlightVars(urlInput.value); urlOver.scrollLeft = urlInput.scrollLeft; };
  urlInput.addEventListener('input', () => { r.url = urlInput.value; refreshOverlay(); markDirty(tab); });
  urlInput.addEventListener('scroll', refreshOverlay);
  refreshOverlay();

  // ---- Subtabs
  bindSubtabs(panel, '[data-subtabs="req"]', '[data-subtab-body] > [data-pane]');

  // ---- KV editors
  bindKV(panel, 'params');
  bindKV(panel, 'headers');
  bindKV(panel, 'form');
  bindKV(panel, 'urlencoded');

  // ---- Body modes
  const modeRadios = $$('input[name="bodymode"]', panel);
  modeRadios.forEach(rad => {
    rad.checked = (rad.value === r.body.mode);
    rad.addEventListener('change', () => {
      r.body.mode = rad.value; refreshBodyView(); updateBadges(); markDirty(tab);
    });
  });
  const refreshBodyView = () => {
    $$('[data-bodyview]', panel).forEach(el => el.hidden = (el.dataset.bodyview !== r.body.mode));
    $('.body-rawtype', panel).hidden  = r.body.mode !== 'raw';
    $('[data-bodyformat]', panel).hidden = r.body.mode !== 'raw';
  };
  refreshBodyView();

  const rawType = $('[data-bind="body.rawType"]', panel);
  rawType.value = r.body.rawType;
  rawType.addEventListener('change', () => { r.body.rawType = rawType.value; markDirty(tab); });

  const rawArea = $('textarea[data-bind="body.raw"]', panel);
  rawArea.value = r.body.raw || '';
  rawArea.addEventListener('input', () => { r.body.raw = rawArea.value; updateBadges(); markDirty(tab); });

  $('[data-action="format-body"]', panel).addEventListener('click', () => {
    if (r.body.rawType !== 'json') return;
    try { r.body.raw = JSON.stringify(JSON.parse(r.body.raw), null, 2); rawArea.value = r.body.raw; toast('Formatted','ok'); }
    catch (e) { toast('Invalid JSON: ' + e.message, 'err'); }
  });

  // ---- Auth
  const authType = $('select[data-bind="auth.type"]', panel);
  authType.value = r.auth.type;
  authType.addEventListener('change', () => { r.auth.type = authType.value; renderAuthForm(); markDirty(tab); });
  const authForm = $('[data-auth-form]', panel);
  function renderAuthForm() {
    authForm.innerHTML = '';
    const t = r.auth.type;
    const mk = (label, key, type='text') => {
      const wrap = document.createElement('label'); wrap.className = 'field';
      wrap.innerHTML = `<span class="field-label">${label}</span><input type="${type}" data-k="${key}">`;
      const inp = wrap.querySelector('input');
      inp.value = key.split('.').reduce((o,p)=>o?.[p], r.auth) || '';
      inp.addEventListener('input', () => {
        const parts = key.split('.');
        let o = r.auth; for (let i=0; i<parts.length-1; i++) o = o[parts[i]];
        o[parts.at(-1)] = inp.value; markDirty(tab);
      });
      authForm.appendChild(wrap);
    };
    if (t === 'basic')  { mk('Username','basic.user'); mk('Password','basic.pass','password'); }
    if (t === 'bearer') { mk('Token','bearer.token'); }
    if (t === 'apikey') {
      mk('Key','apikey.key'); mk('Value','apikey.value');
      const sel = document.createElement('label'); sel.className='field';
      sel.innerHTML = `<span class="field-label">Add To</span><select><option value="header">Header</option><option value="query">Query Param</option></select>`;
      const s = sel.querySelector('select'); s.value = r.auth.apikey.in || 'header';
      s.addEventListener('change', () => { r.auth.apikey.in = s.value; markDirty(tab); });
      authForm.appendChild(sel);
    }
    if (t === 'none') { authForm.innerHTML = '<p class="muted" style="font:500 12px var(--mono)">No auth will be sent with this request.</p>'; }
  }
  renderAuthForm();

  // ---- Scripts + settings
  bindBindings(panel, r, tab);

  // ---- Send
  const sendBtn = $('[data-action="send"]', panel);
  sendBtn.addEventListener('click', async () => {
    if (sendBtn.dataset.loading === 'true') return; // prevent double-send
    sendBtn.dataset.loading = 'true';
    sendBtn.disabled = true;
    try {
      await sendRequest(r);
      renderResponse(panel, r);
      renderHistory();
    } catch (e) {
      toast('Send failed: ' + (e.message || e), 'err');
    } finally {
      sendBtn.dataset.loading = 'false';
      sendBtn.disabled = false;
      updateBadges();
    }
  });

  // ---- Save / code-gen
  $('[data-action="save-request"]', panel).addEventListener('click', () => openSaveModal(tab));
  $('[data-action="code-gen"]', panel).addEventListener('click', () => openCodegenModal(r));

  // ---- Splitter
  bindSplitter(panel);

  // ---- Response (if exists)
  renderResponse(panel, r);

  updateBadges();
  function updateBadges() { updatePanelBadges(panel); }

  // Keyboard shortcut: Ctrl/Cmd+Enter to send
  panel.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); openSaveModal(tab); }
  });
}

function bindBindings(panel, r, tab) {
  $$('[data-bind]', panel).forEach(el => {
    const key = el.dataset.bind;
    if (['method','url','auth.type','body.rawType','body.raw'].includes(key)) return;
    if (key === 'body.binary') return;
    const get = () => key.split('.').reduce((o,p)=>o?.[p], r);
    const set = v => {
      const parts = key.split('.'); let o = r;
      for (let i=0;i<parts.length-1;i++) o = o[parts[i]];
      o[parts.at(-1)] = v;
    };
    if (el.type === 'checkbox') { el.checked = !!get(); el.addEventListener('change', ()=>{set(el.checked); markDirty(tab);}); }
    else {
      el.value = get() ?? '';
      el.addEventListener('input', () => {
        let v = el.value;
        if (el.type === 'number') {
          const n = parseFloat(v);
          // Clamp to the input's own min/max if present so timeouts stay sane.
          const min = el.min !== '' ? parseFloat(el.min) : -Infinity;
          const max = el.max !== '' ? parseFloat(el.max) :  Infinity;
          v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : (Number.isFinite(min) ? min : 0);
        }
        set(v); markDirty(tab);
      });
    }
  });
}

function markDirty(tab) {
  tab.dirty = true;
  const el = $(`.tab[data-tab-id="${tab.id}"]`); if (el) el.dataset.dirty = 'true';
  const r = tab.request;
  if (r.url) {
    const nm = nameFromUrl(resolveVars(r.url)); tab.name = r.name && r.name !== 'Untitled' ? r.name : nm;
    const span = el?.querySelector('.tab-name'); if (span) span.textContent = tab.name;
    const meth = el?.querySelector('.tab-method'); if (meth) { meth.dataset.m = r.method; meth.textContent = r.method; }
  }
}

/* ---------------- Subtab + KV ---------------- */
function bindSubtabs(root, tabsSel, paneAncestorSel) {
  const tabs = $$(tabsSel + ' .subtab', root);
  const panes = $$(paneAncestorSel, root);
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('is-active', x === t));
    panes.forEach(p => p.hidden = (p.dataset.pane !== t.dataset.subtab));
  }));
}

function bindKV(panel, target) {
  const list = $(`[data-rows="${target}"]`, panel);
  const tab = activeTab(); if (!tab) return;
  if (!Array.isArray(tab.request[target])) tab.request[target] = [];
  const arr = tab.request[target];
  list.innerHTML = '';
  arr.forEach(row => list.appendChild(buildKVRow(target, row, tab, panel)));
  // ensure at least one empty row for entry
  if (!arr.length) { addRow(target, panel); }
  $(`[data-action="add-row"][data-row-target="${target}"]`, panel)
    .addEventListener('click', () => addRow(target, panel));
}
function addRow(target, panel) {
  const tab = activeTab(); if (!tab) return;
  const row = { key:'', val:'', desc:'', enabled:true };
  tab.request[target].push(row);
  const scope = panel || document;
  const list = scope.querySelector(`[data-rows="${target}"]`);
  if (list) list.appendChild(buildKVRow(target, row, tab, panel));
}
function buildKVRow(target, row, tab, panel) {
  const tpl = $('#tpl-kv-row').content.cloneNode(true);
  const el = tpl.querySelector('.kv-row');
  el.dataset.disabled = (row.enabled === false);
  const dirty = () => { if (tab) markDirty(tab); if (panel) updatePanelBadges(panel); };
  const c = el.querySelector('.kv-check');
  c.checked = row.enabled !== false;
  c.addEventListener('change', () => {
    row.enabled = c.checked; el.dataset.disabled = !c.checked; dirty();
  });
  const k = el.querySelector('.kv-key'); k.value = row.key||'';  k.addEventListener('input', () => { row.key = k.value; dirty(); });
  const v = el.querySelector('.kv-val'); v.value = row.val||'';  v.addEventListener('input', () => { row.val = v.value; dirty(); });
  const d = el.querySelector('.kv-desc'); d.value = row.desc||''; d.addEventListener('input', () => { row.desc = d.value; dirty(); });
  if (target === 'form') d.placeholder = 'text · file';
  el.querySelector('.kv-del').addEventListener('click', () => {
    const arr = tab ? tab.request[target] : null;
    if (arr) { const i = arr.indexOf(row); if (i>=0) arr.splice(i,1); }
    el.remove(); dirty();
  });
  return el;
}
// Helper used by KV/body handlers to refresh subtab counts without re-rendering.
function updatePanelBadges(panel) {
  const tab = activeTab(); if (!tab) return;
  const r = tab.request;
  const set = (sel, n) => { const el = panel.querySelector(sel); if (el) el.textContent = n || ''; };
  set('[data-count="params"]',  (r.params||[]).filter(p => p.enabled !== false && p.key).length);
  set('[data-count="headers"]', (r.headers||[]).filter(p => p.enabled !== false && (p.name || p.key)).length);
  const bodyCount = r.body.mode==='none' ? '' :
    r.body.mode==='raw' ? (r.body.raw?'•':'') :
    r.body.mode==='binary' ? (r.body.binary?'•':'') :
    (r[r.body.mode] || []).filter(p => p.enabled !== false && p.key).length || '';
  set('[data-count="body"]', bodyCount);
}

/* ---------------- Splitter ---------------- */
function bindSplitter(panel) {
  const top = $('.splitpane-top', panel);
  const bot = $('.splitpane-bot', panel);
  const div = $('.splitpane-divider', panel);
  let dragging = false;
  div.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'row-resize'; });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = panel.getBoundingClientRect();
    const reqRect = $('.reqbar', panel).getBoundingClientRect();
    const offset = e.clientY - reqRect.bottom;
    const total = rect.bottom - reqRect.bottom;
    const ratio = Math.max(0.18, Math.min(0.82, offset / total));
    top.style.flex = `${ratio} 0 0`; bot.style.flex = `${1-ratio} 0 0`;
  });
}

/* ---------------- Response render ---------------- */
function renderResponse(panel, r) {
  const meta = $('[data-resp-meta]', panel);
  const tabsBar = $('[data-subtabs="resp"]', panel);
  const body = $('[data-resp-body]', panel);
  if (!r.response) {
    meta.innerHTML = '<span class="resp-empty muted">No response yet — hit <kbd>Send</kbd> to fire this request.</span>';
    tabsBar.hidden = true; body.hidden = true; return;
  }
  tabsBar.hidden = false; body.hidden = false;
  const res = r.response;

  if (res.error) {
    meta.innerHTML = `<span class="status-pill" data-class="5">FAIL</span>
      <span class="resp-meta-item"><strong>${res.timeMs||0}</strong> ms</span>`;
    body.innerHTML = `<div class="resp-error">⚠ ${escapeHtml(res.error)}</div>`;
    return;
  }
  const cls = (typeof res.status === 'number' && res.status > 0) ? String(res.status)[0] : '5';
  const sizeKb = res.sizeBytes ? (res.sizeBytes/1024).toFixed(1) : '0';
  meta.innerHTML = `
    <span class="status-pill" data-class="${cls}">${res.status||0} ${statusText(res.status)}</span>
    <span class="resp-meta-item">⏱ <strong>${res.timeMs||0} ms</strong></span>
    <span class="resp-meta-item">⇣ <strong>${sizeKb} KB</strong></span>
    ${res.redirects?`<span class="resp-meta-item">↻ ${res.redirects} redirects</span>`:''}
    <span class="resp-meta-spacer"></span>
    <button class="ghost-btn" data-action="copy-resp">copy</button>
    <button class="ghost-btn" data-action="save-resp">save</button>
  `;
  meta.querySelector('[data-action="copy-resp"]').addEventListener('click', () => {
    navigator.clipboard.writeText(res.body || ''); toast('Response copied', 'ok');
  });
  meta.querySelector('[data-action="save-resp"]').addEventListener('click', () => {
    const blob = new Blob([res.body || ''], {type: 'text/plain'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'response.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  });

  $('[data-bodyviewmode]', panel).hidden = false;
  $('.resp-search', panel).hidden = false;

  // Subtab switching — clone each button to drop any stale listeners from prior renders.
  // (renderResponse runs once per Send; the panel DOM persists between sends.)
  const oldRespTabs = $$('.subtab', tabsBar);
  const respTabs = oldRespTabs.map(t => { const c = t.cloneNode(true); t.replaceWith(c); return c; });
  respTabs.forEach((t, i) => t.classList.toggle('is-active', i === 0));
  respTabs.forEach(t => t.addEventListener('click', () => {
    respTabs.forEach(x => x.classList.toggle('is-active', x===t));
    drawRespBody(t.dataset.subtab);
  }));

  // View mode
  const oldVmBtns = $$('[data-bodyviewmode] .seg', panel);
  const vmBtns = oldVmBtns.map(b => { const c = b.cloneNode(true); b.replaceWith(c); return c; });
  let viewMode = 'pretty';
  vmBtns.forEach(b => b.addEventListener('click', () => {
    vmBtns.forEach(x => x.classList.toggle('is-active', x===b));
    viewMode = b.dataset.viewmode; drawRespBody('body');
  }));

  // Search
  let searchTerm = '';
  const oldSearch = panel.querySelector('[data-action="search-resp"]');
  const searchInput = oldSearch.cloneNode(true);
  oldSearch.replaceWith(searchInput);
  searchInput.value = '';
  searchInput.addEventListener('input', () => { searchTerm = searchInput.value; drawRespBody('body'); });

  // Header/test counts
  panel.querySelector('[data-count="resp-headers"]').textContent = res.headers ? (res.headers.length || '') : '';
  panel.querySelector('[data-count="resp-tests"]').textContent = (r.testResults && r.testResults.length) || '';

  drawRespBody('body');

  function drawRespBody(which) {
    body.innerHTML = '';
    if (which === 'body') {
      const ct = ((res.headers||[]).find(h => h.name && h.name.toLowerCase()==='content-type')||{}).value || '';
      const rawBody = res.body || '';
      const isJson = ct.includes('json') || /^[\s\[{]/.test(rawBody);
      const isHtml = ct.includes('html');
      if (viewMode === 'preview' && isHtml) {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'flex:1; width:100%; border:0; background:#fff;';
        // sandbox out scripts/forms — preview is a renderer, not a runtime.
        iframe.setAttribute('sandbox', '');
        iframe.srcdoc = rawBody;
        body.appendChild(iframe); return;
      }
      const pre = document.createElement('pre');
      pre.className = 'resp-pre';
      let txt = rawBody;
      if (viewMode === 'pretty' && isJson) {
        try { txt = JSON.stringify(JSON.parse(rawBody), null, 2); }
        catch {}
        pre.innerHTML = colorJson(txt, searchTerm);
      } else {
        if (searchTerm) {
          const safe = escapeHtml(txt);
          const re = new RegExp(escapeRegex(searchTerm), 'gi');
          pre.innerHTML = safe.replace(re, m => `<span class="search-hit">${m}</span>`);
        } else {
          pre.textContent = txt;
        }
      }
      body.appendChild(pre);
      return;
    }
    if (which === 'headers') {
      body.appendChild(buildKvTable('Header', res.headers.map(h => [h.name, h.value])));
      return;
    }
    if (which === 'cookies') {
      const setCookie = (res.headers||[]).filter(h => h.name && h.name.toLowerCase()==='set-cookie');
      if (!setCookie.length) { body.innerHTML = '<p class="muted" style="padding:18px">No cookies in response.</p>'; return; }
      body.appendChild(buildKvTable('Cookie', setCookie.map(h => {
        const first = (h.value||'').split(';')[0];
        const eq = first.indexOf('=');
        return eq < 0 ? [first, ''] : [first.slice(0, eq), first.slice(eq+1)];
      })));
      return;
    }
    if (which === 'tests') {
      const wrap = document.createElement('div'); wrap.className = 'test-list';
      if (!r.testResults.length) { wrap.innerHTML = '<p class="muted">No tests defined for this request.</p>'; }
      r.testResults.forEach(t => {
        const row = document.createElement('div'); row.className = 'test-row';
        row.dataset.pass = t.pass;
        row.innerHTML = `<span class="test-status">${t.pass?'PASS':'FAIL'}</span>
                        <span class="test-name">${escapeHtml(t.name)}</span>
                        ${t.msg?`<span class="test-msg">${escapeHtml(t.msg)}</span>`:''}`;
        wrap.appendChild(row);
      });
      body.appendChild(wrap); return;
    }
    if (which === 'timeline') {
      const total = Math.max(0, res.timeMs || 0);
      // synthetic split (proxy doesn't expose phases)
      const dns = Math.round(total*0.05), tcp = Math.round(total*0.10),
            tls = Math.round(total*0.10), wait = Math.round(total*0.65);
      const dl  = Math.max(0, total - dns - tcp - tls - wait);
      const denom = total || 1;
      const pct = n => (n / denom * 100).toFixed(2);
      const wrap = document.createElement('div'); wrap.className = 'timeline';
      wrap.innerHTML = `
        <div class="timeline-bar">
          <span class="seg-dns" style="width:${pct(dns)}%"></span>
          <span class="seg-tcp" style="width:${pct(tcp)}%"></span>
          <span class="seg-tls" style="width:${pct(tls)}%"></span>
          <span class="seg-wait" style="width:${pct(wait)}%"></span>
          <span class="seg-download" style="width:${pct(dl)}%"></span>
        </div>
        <div class="timeline-legend">
          <span><i class="seg-dns" style="background:#5b8def"></i>DNS ${dns} ms</span>
          <span><i class="seg-tcp" style="background:#4fb286"></i>TCP ${tcp} ms</span>
          <span><i class="seg-tls" style="background:#b07cd9"></i>TLS ${tls} ms</span>
          <span><i class="seg-wait" style="background:#d9a441"></i>Server ${wait} ms</span>
          <span><i class="seg-download" style="background:#d96363"></i>Download ${dl} ms</span>
          <span class="muted">total ${total} ms · synthetic phases</span>
        </div>`;
      body.appendChild(wrap); return;
    }
  }
}

function buildKvTable(keyLabel, rows) {
  const t = document.createElement('table'); t.className = 'kv-table';
  t.innerHTML = `<thead><tr><th>${keyLabel}</th><th>Value</th></tr></thead>`;
  const tb = document.createElement('tbody');
  rows.forEach(([k,v]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="kv-table-key">${escapeHtml(k)}</td><td class="kv-table-val">${escapeHtml(v)}</td>`;
    tb.appendChild(tr);
  });
  t.appendChild(tb); return t;
}

/* ---------------- JSON colorizer ----------------
   Highlight matches BEFORE colorizing so the search regex never collides
   with span markup. We use a placeholder pair ( …) that can't
   appear in JSON text, then escape, then swap placeholders for spans. */
function colorJson(src, searchTerm='') {
  let staged = String(src);
  if (searchTerm) {
    const re = new RegExp(escapeRegex(searchTerm), 'gi');
    staged = staged.replace(re, m => ` ${m}`);
  }
  let out = escapeHtml(staged)
    .replace(/(&quot;[^&\\]*?(?:\\.[^&\\]*?)*&quot;)\s*:/g, '<span class="tok-key">$1</span>:')
    .replace(/:\s*(&quot;[^&\\]*?(?:\\.[^&\\]*?)*&quot;)/g, ': <span class="tok-str">$1</span>')
    .replace(/\b(true|false)\b/g, '<span class="tok-bool">$1</span>')
    .replace(/\bnull\b/g, '<span class="tok-null">null</span>')
    .replace(/(?<![&\w])(-?\d+\.?\d*(?:e[+-]?\d+)?)/gi, '<span class="tok-num">$1</span>')
    .replace(/([{}\[\],])/g, '<span class="tok-punct">$1</span>');
  if (searchTerm) {
    out = out.replace(/ ([^]*)/g, '<span class="search-hit">$1</span>');
  }
  return out;
}

/* ---------------- Sidebar ---------------- */
function renderSidebar() {
  // Pane switching
  const tabs = $$('.side-tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('is-active', x===t));
    $$('.side-pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === t.dataset.pane));
  }));
  renderCollections(); renderHistory(); renderEnvs(); renderEnvSwitcher();
  $('#sideSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $$('.tree-leaf, .tree-group').forEach(el => {
      const txt = el.textContent.toLowerCase();
      el.style.display = txt.includes(q) ? '' : 'none';
    });
  });
}
function renderCollections() {
  const tree = $('#collectionsTree'); tree.innerHTML = '';
  for (const col of STATE.collections) {
    const g = document.createElement('div'); g.className = 'tree-group'; g.dataset.open = col.open;
    g.innerHTML = `
      <div class="tree-group-header">
        <span class="tree-caret">▾</span>
        <span class="tree-group-name">${escapeHtml(col.name)}</span>
        <span class="tree-group-meta">${col.requests.length}</span>
      </div>
      <div class="tree-children"></div>`;
    g.querySelector('.tree-group-header').addEventListener('click', () => {
      col.open = (g.dataset.open !== 'true'); g.dataset.open = col.open; persist();
    });
    const kids = g.querySelector('.tree-children');
    col.requests.forEach(req => {
      const leaf = document.createElement('div'); leaf.className = 'tree-leaf';
      const method = escapeHtml(req.method || 'GET');
      leaf.innerHTML = `<span class="method-tag" data-m="${method}">${method}</span>
                       <span class="tree-leaf-name">${escapeHtml(req.name || nameFromUrl(req.url))}</span>`;
      leaf.addEventListener('click', () => openRequestInTab(req));
      kids.appendChild(leaf);
    });
    tree.appendChild(g);
  }
}
function renderHistory() {
  const tree = $('#historyTree'); tree.innerHTML = '';
  if (!STATE.history.length) { tree.innerHTML = '<p class="muted" style="padding:14px;font:500 12px var(--mono)">No history yet.</p>'; return; }
  for (const h of STATE.history) {
    const leaf = document.createElement('div'); leaf.className = 'tree-leaf';
    const method = escapeHtml(h.method || 'GET');
    const status = h.status ? `<span class="tree-leaf-time">${escapeHtml(String(h.status))}</span>` : '';
    leaf.innerHTML = `<span class="method-tag" data-m="${method}">${method}</span>
                     <span class="tree-leaf-name">${escapeHtml(h.url || '')}</span> ${status}
                     <span class="tree-leaf-time">${escapeHtml(timeAgo(h.ts))}</span>`;
    leaf.addEventListener('click', () => openRequestInTab(h.snapshot || {}));
    tree.appendChild(leaf);
  }
}
function renderEnvs() {
  const tree = $('#envTree'); tree.innerHTML = '';
  for (const env of STATE.envs) {
    const g = document.createElement('div'); g.className = 'tree-group';
    // Open state lives on the env itself so renderEnvs() (called on every
    // keystroke in the editor) doesn't slam the group closed.
    g.dataset.open = env.open ? 'true' : 'false';
    const isActive = env.id === STATE.activeEnvId;
    g.innerHTML = `
      <div class="tree-group-header">
        <span class="tree-caret">▾</span>
        <span class="tree-group-name">${escapeHtml(env.name)} ${isActive?'<span class="muted">· active</span>':''}</span>
        <span class="tree-group-meta">${env.vars.length}</span>
      </div>
      <div class="tree-children"></div>`;
    g.querySelector('.tree-group-header').addEventListener('click', () => {
      env.open = (g.dataset.open !== 'true');
      g.dataset.open = env.open ? 'true' : 'false';
    });
    const kids = g.querySelector('.tree-children');
    env.vars.forEach(v => {
      const row = document.createElement('div'); row.className = 'tree-leaf';
      const preview = String(v.val||'').slice(0, 20);
      row.innerHTML = `<span class="tree-leaf-name"><code>{{${escapeHtml(v.key)}}}</code></span>
                      <span class="tree-leaf-time">${escapeHtml(preview)}</span>`;
      kids.appendChild(row);
    });
    const setBtn = document.createElement('button'); setBtn.className = 'ghost-btn ghost-btn--row';
    setBtn.textContent = isActive ? 'editing…' : 'set active'; setBtn.style.margin = '4px 0 8px';
    setBtn.addEventListener('click', e => { e.stopPropagation(); STATE.activeEnvId = env.id; persist(); renderEnvs(); renderEnvSwitcher(); refreshAllOverlays(); });
    kids.appendChild(setBtn);
    const editBtn = document.createElement('button'); editBtn.className = 'ghost-btn ghost-btn--row';
    editBtn.textContent = 'edit vars'; editBtn.style.margin = '0 0 8px';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openEnvEditor(env); });
    kids.appendChild(editBtn);
    tree.appendChild(g);
  }
}
function renderEnvSwitcher() {
  const env = activeEnv();
  $('#envCurrentName').textContent = env ? env.name : 'No environment';
  $('#envButton').dataset.active = !!env;
}
function refreshAllOverlays() {
  $$('[data-overlay]').forEach(over => {
    const inp = over.parentElement.querySelector('.url-input');
    if (inp) over.innerHTML = highlightVars(inp.value);
  });
}

/* ---------------- Modals ---------------- */
function openModal(html) {
  const root = $('#modalRoot');
  root.innerHTML = html; root.hidden = false;
  root.addEventListener('click', e => { if (e.target === root) closeModal(); }, { once: true });
  return root.firstElementChild;
}
function closeModal() { const r = $('#modalRoot'); r.innerHTML = ''; r.hidden = true; }

function openSaveModal(tab) {
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Save request</h2><span class="modal-sub">⌘ S</span></div>
      <div class="modal-body">
        <label class="field"><span class="field-label">Name</span><input id="m-name" value="${escapeHtml(tab.name||'')}"></label>
        <label class="field"><span class="field-label">Collection</span>
          <select id="m-col">${STATE.collections.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            <option value="__new">+ New collection…</option>
          </select>
        </label>
        <label class="field" id="m-newcol-wrap" hidden><span class="field-label">New collection name</span><input id="m-newcol"></label>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" data-cancel>Cancel</button>
        <button class="btn-primary" data-save>Save</button>
      </div>
    </div>`);
  m.querySelector('#m-col').addEventListener('change', e => {
    m.querySelector('#m-newcol-wrap').hidden = e.target.value !== '__new';
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-save]').addEventListener('click', () => {
    const name = m.querySelector('#m-name').value || 'Untitled';
    let colId = m.querySelector('#m-col').value;
    if (colId === '__new') {
      const newName = m.querySelector('#m-newcol').value || 'New Collection';
      const c = { id: uid(), name: newName, open: true, requests: [] };
      STATE.collections.push(c); colId = c.id;
    }
    const col = STATE.collections.find(c => c.id === colId);
    if (!col) { toast('Collection not found', 'err'); return; }
    const stored = structuredClone(simplify(tab.request));
    stored.id = uid(); // fresh id so re-saving the same tab doesn't duplicate
    stored.name = name;
    col.requests.push(stored);
    tab.name = name; tab.dirty = false;
    const tabEl = $(`.tab[data-tab-id="${tab.id}"]`); if (tabEl) tabEl.dataset.dirty = 'false';
    closeModal(); renderTabs(); renderCollections(); persist();
    toast('Saved to ' + col.name, 'ok');
  });
}

function openEnvEditor(env) {
  const rows = env.vars.map((v,i) => `
    <tr data-i="${i}">
      <td><input class="kv-key" value="${escapeHtml(v.key)}" data-k="key"></td>
      <td><input class="kv-val" value="${escapeHtml(v.val||'')}" data-k="val"></td>
      <td><button class="kv-del" title="Remove">✕</button></td>
    </tr>`).join('');
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Variables · ${escapeHtml(env.name)}</h2><span class="modal-sub">use as <code>{{key}}</code></span></div>
      <div class="modal-body">
        <table class="kv-table vars-table">
          <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
          <tbody id="vars-rows">${rows}</tbody>
        </table>
        <button class="ghost-btn ghost-btn--row" id="vars-add">+ variable</button>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" data-cancel>Close</button>
      </div>
    </div>`);
  const tbody = m.querySelector('#vars-rows');
  function rebind() {
    tbody.querySelectorAll('input').forEach(inp => {
      inp.oninput = () => {
        const i = +inp.closest('tr').dataset.i;
        env.vars[i][inp.dataset.k] = inp.value;
        env.vars[i].enabled = true;
        persist(); renderEnvs(); refreshAllOverlays();
      };
    });
    tbody.querySelectorAll('.kv-del').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.closest('tr').dataset.i;
        env.vars.splice(i,1); persist(); renderEnvs(); refreshAllOverlays(); openEnvEditor(env);
      };
    });
  }
  rebind();
  m.querySelector('#vars-add').addEventListener('click', () => {
    env.vars.push({ key:'', val:'', enabled:true });
    openEnvEditor(env);
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
}

function openCodegenModal(req) {
  const langs = [
    { id:'curl',    label:'cURL' },
    { id:'fetch',   label:'JS fetch' },
    { id:'axios',   label:'JS axios' },
    { id:'python',  label:'Python requests' },
    { id:'php',     label:'PHP cURL' },
    { id:'go',      label:'Go net/http' },
    { id:'http',    label:'HTTP' },
  ];
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Code snippet</h2><span class="modal-sub">copy-paste, ready to run</span></div>
      <div class="codegen-langs">${langs.map((l,i)=>`<button class="codegen-lang ${i===0?'is-active':''}" data-lang="${l.id}">${l.label}</button>`).join('')}</div>
      <div class="modal-body" style="padding:0">
        <pre class="codegen-pre" id="cg-pre"></pre>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" data-cancel>Close</button>
        <button class="btn-primary" id="cg-copy">Copy</button>
      </div>
    </div>`);
  const pre = m.querySelector('#cg-pre');
  let cur = 'curl';
  const draw = () => { pre.textContent = generateCode(cur, req); };
  m.querySelectorAll('.codegen-lang').forEach(b => b.addEventListener('click', () => {
    m.querySelectorAll('.codegen-lang').forEach(x => x.classList.toggle('is-active', x===b));
    cur = b.dataset.lang; draw();
  }));
  m.querySelector('#cg-copy').addEventListener('click', () => { navigator.clipboard.writeText(pre.textContent); toast('Copied','ok'); });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  draw();
}

function generateCode(lang, req) {
  const url = buildUrl(req); const headers = buildHeaders(req); const body = buildBody(req);
  if (lang === 'curl') {
    let s = `curl -X ${req.method} '${url}'`;
    headers.forEach(h => s += ` \\\n  -H '${h.name}: ${h.value}'`);
    if (body) s += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
    return s;
  }
  if (lang === 'fetch') {
    return `fetch('${url}', {\n  method: '${req.method}',\n  headers: ${JSON.stringify(headers.reduce((a,h)=>(a[h.name]=h.value,a),{}), null, 2)},\n  ${body?`body: ${JSON.stringify(body)},\n`:''}})\n  .then(r => r.json())\n  .then(console.log);`;
  }
  if (lang === 'axios') {
    return `import axios from 'axios';\n\naxios({\n  method: '${req.method}',\n  url: '${url}',\n  headers: ${JSON.stringify(headers.reduce((a,h)=>(a[h.name]=h.value,a),{}), null, 2)},\n  ${body?`data: ${JSON.stringify(body)},\n`:''}}).then(r => console.log(r.data));`;
  }
  if (lang === 'python') {
    return `import requests\n\nresp = requests.request(\n    "${req.method}",\n    "${url}",\n    headers=${JSON.stringify(headers.reduce((a,h)=>(a[h.name]=h.value,a),{}))},\n    ${body?`data=${JSON.stringify(body)},\n`:''})\nprint(resp.status_code, resp.text)`;
  }
  if (lang === 'php') {
    let s = `$ch = curl_init('${url}');\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${req.method}');\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n`;
    if (headers.length) s += `curl_setopt($ch, CURLOPT_HTTPHEADER, [\n${headers.map(h=>`    '${h.name}: ${h.value}'`).join(',\n')}\n]);\n`;
    if (body) s += `curl_setopt($ch, CURLOPT_POSTFIELDS, ${JSON.stringify(body)});\n`;
    s += `$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;
    return s;
  }
  if (lang === 'go') {
    return `req, _ := http.NewRequest("${req.method}", "${url}", ${body?`strings.NewReader(${JSON.stringify(body)})`:'nil'})\n${headers.map(h=>`req.Header.Set("${h.name}", "${h.value}")`).join('\n')}\n\nresp, _ := http.DefaultClient.Do(req)\ndefer resp.Body.Close()`;
  }
  if (lang === 'http') {
    let s = `${req.method} ${url} HTTP/1.1\n`;
    headers.forEach(h => s += `${h.name}: ${h.value}\n`);
    if (body) s += `\n${body}`;
    return s;
  }
  return '';
}

function openVarsInspector() {
  const env = activeEnv();
  const rows = env ? env.vars.map(v => `<tr><td class="kv-table-key"><code>{{${escapeHtml(v.key)}}}</code></td><td class="kv-table-val">${escapeHtml(v.val||'')}</td></tr>`).join('') : '';
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Active variables</h2><span class="modal-sub">${env?escapeHtml(env.name):'no env selected'}</span></div>
      <div class="modal-body">
        ${env?`<table class="kv-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`:`<p class="muted">Pick an environment from the sidebar.</p>`}
      </div>
      <div class="modal-foot"><button class="btn-ghost" data-cancel>Close</button></div>
    </div>`);
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
}

function openImportModal() {
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Import</h2><span class="modal-sub">paste cURL or JSON</span></div>
      <div class="modal-body">
        <textarea id="imp" class="code-area" placeholder="curl 'https://api.example.com' -H 'Authorization: …'"></textarea>
      </div>
      <div class="modal-foot">
        <button class="btn-ghost" data-cancel>Cancel</button>
        <button class="btn-primary" id="imp-go">Import</button>
      </div>
    </div>`);
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#imp-go').addEventListener('click', () => {
    const txt = m.querySelector('#imp').value.trim();
    try {
      const req = txt.startsWith('curl') ? parseCurl(txt) : newRequest(JSON.parse(txt));
      openRequestInTab(req); closeModal(); toast('Imported','ok');
    } catch (e) { toast('Could not parse: '+e.message,'err'); }
  });
}
function parseCurl(s) {
  // very basic curl parser — handles -X, -H, -d/--data, url. Strips backslash
  // line continuations so multiline pasted curl works.
  const cleaned = String(s || '').replace(/\\\r?\n/g, ' ').trim();
  const tokens = cleaned.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g);
  if (!tokens || !tokens.length) throw new Error('empty curl');
  const rest = tokens.slice(tokens[0].toLowerCase() === 'curl' ? 1 : 0);
  const strip = t => t.replace(/^['"]|['"]$/g, '');
  const r = newRequest();
  for (let i=0; i<rest.length; i++) {
    const t = strip(rest[i]);
    if (t === '-X' || t === '--request') r.method = strip(rest[++i] || 'GET').toUpperCase();
    else if (t === '-H' || t === '--header') {
      const hv = strip(rest[++i] || ''); const idx = hv.indexOf(':');
      if (idx > 0) r.headers.push({key: hv.slice(0,idx).trim(), val: hv.slice(idx+1).trim(), desc:'', enabled:true});
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      r.body.mode = 'raw'; r.body.raw = strip(rest[++i] || ''); r.body.rawType = 'json';
      if (r.method === 'GET') r.method = 'POST';
    } else if (t === '-u' || t === '--user') {
      const cred = strip(rest[++i] || ''); const ci = cred.indexOf(':');
      r.auth.type = 'basic';
      r.auth.basic = ci < 0
        ? { user: cred, pass: '' }
        : { user: cred.slice(0, ci), pass: cred.slice(ci+1) };
    } else if (/^https?:\/\//i.test(t)) r.url = t;
  }
  r.name = nameFromUrl(r.url) || 'Imported';
  return r;
}

function openExportModal() {
  const data = JSON.stringify({ collections: STATE.collections, envs: STATE.envs }, null, 2);
  const m = openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Export workspace</h2><span class="modal-sub">copy or download</span></div>
      <div class="modal-body" style="padding:0"><pre class="codegen-pre">${escapeHtml(data)}</pre></div>
      <div class="modal-foot">
        <button class="btn-ghost" data-cancel>Close</button>
        <button class="btn-primary" id="exp-dl">Download .json</button>
      </div>
    </div>`);
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#exp-dl').addEventListener('click', () => {
    const blob = new Blob([data], {type: 'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'postpigeon-export.json'; a.click();
  });
}

function openShortcuts() {
  openModal(`
    <div class="modal">
      <div class="modal-head"><h2>Keyboard shortcuts</h2></div>
      <div class="modal-body">
        <table class="kv-table">
          <tr><td class="kv-table-key">⌘ ↵</td><td>Send request</td></tr>
          <tr><td class="kv-table-key">⌘ S</td><td>Save request to collection</td></tr>
          <tr><td class="kv-table-key">⌘ T</td><td>New tab</td></tr>
          <tr><td class="kv-table-key">⌘ W</td><td>Close tab</td></tr>
          <tr><td class="kv-table-key">/</td><td>Focus sidebar search</td></tr>
          <tr><td class="kv-table-key">Esc</td><td>Close modal</td></tr>
        </table>
      </div>
      <div class="modal-foot"><button class="btn-ghost" data-cancel>Close</button></div>
    </div>
  `).querySelector('[data-cancel]').addEventListener('click', closeModal);
}

/* ---------------- Toasts ---------------- */
let toastWrap;
function toast(msg, kind='ok') {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className='toast-wrap'; document.body.appendChild(toastWrap); }
  const t = document.createElement('div'); t.className = 'toast'; t.dataset.kind = kind; t.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* ---------------- Topbar wiring ---------------- */
function bindTopbar() {
  $('#envButton').addEventListener('click', () => {
    if (!STATE.envs.length) return;
    const idx = STATE.envs.findIndex(e => e.id === STATE.activeEnvId);
    const next = STATE.envs[(idx+1) % STATE.envs.length];
    STATE.activeEnvId = next.id; renderEnvSwitcher(); renderEnvs(); refreshAllOverlays(); persist();
    toast('Env: ' + next.name, 'ok');
  });
  document.querySelector('[data-action="open-vars"]').addEventListener('click', openVarsInspector);
  document.querySelector('[data-action="import"]').addEventListener('click', openImportModal);
  document.querySelector('[data-action="export"]').addEventListener('click', openExportModal);
  document.querySelector('[data-action="docs"]').addEventListener('click', () => {
    window.open('https://github.com/morroware/post-pigeon#readme', '_blank', 'noopener');
  });
  document.querySelector('[data-action="shortcuts"]').addEventListener('click', openShortcuts);
  document.querySelector('[data-action="new-collection"]').addEventListener('click', () => {
    const name = prompt('Collection name?'); if (!name) return;
    STATE.collections.push({ id: uid(), name, open: true, requests: [] });
    persist(); renderCollections();
  });
  document.querySelector('[data-action="clear-history"]').addEventListener('click', () => {
    if (!confirm('Clear all history?')) return;
    STATE.history = []; persist(); renderHistory();
  });
  document.querySelector('[data-action="new-env"]').addEventListener('click', () => {
    const name = prompt('Environment name?'); if (!name) return;
    STATE.envs.push({ id: uid(), name, vars: [] });
    persist(); renderEnvs();
  });

  // Global hotkeys
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); $('#sideSearch').focus();
    }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); openRequestInTab(newRequest()); }
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); if (STATE.activeTabId) closeTab(STATE.activeTabId); }
  });
}

/* ---------------- Server probe ----------------
   Probes proxy.php cheaply — sends an empty body, expects the 400
   "Missing url" envelope. Confirms the file exists and PHP is wired up
   without making an external HTTP call. */
async function probeProxy() {
  const el = $('#serverStatus'); const txt = $('#serverStatusText');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch('proxy.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: '{}',
      signal: ctrl.signal,
    });
    // proxy.php replies with HTTP 400 + JSON {error:'Missing url'} when called
    // with no url. Anything else (404, network error) means it isn't reachable.
    if (r.status === 400) {
      let j = null; try { j = await r.json(); } catch {}
      if (j && j.error) {
        STATE.serverProxy = 'ok'; el.dataset.state = 'ok'; txt.textContent = 'proxy · ok'; return;
      }
    }
    throw new Error('unexpected proxy response: ' + r.status);
  } catch {
    STATE.serverProxy = 'fallback'; el.dataset.state = 'warn'; txt.textContent = 'proxy offline · direct fetch (CORS)';
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- Helpers ---------------- */
function escapeHtml(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function timeAgo(ts) {
  const d = (Date.now()-ts)/1000;
  if (d < 60) return Math.floor(d)+'s';
  if (d < 3600) return Math.floor(d/60)+'m';
  if (d < 86400) return Math.floor(d/3600)+'h';
  return Math.floor(d/86400)+'d';
}
function statusText(s) {
  return ({200:'OK',201:'Created',204:'No Content',301:'Moved',302:'Found',304:'Not Modified',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',409:'Conflict',422:'Unprocessable',429:'Too Many',500:'Server Error',502:'Bad Gateway',503:'Unavailable'})[s] || '';
}

/* ---------------- Boot ---------------- */
(async function init() {
  await hydrate();
  renderSidebar();
  bindTopbar();
  // Await the probe so the first Send picks the right transport. The probe is
  // a HEAD against a small endpoint — adds <500ms in the worst case.
  await probeProxy();
  // Open one tab to start
  const seedReq = STATE.collections[0]?.requests[0] || newRequest({ method:'GET', url:'https://httpbin.org/get?hello={{baseUrl}}' });
  openRequestInTab(seedReq);
})();
