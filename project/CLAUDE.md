# CLAUDE.md — Post Pigeon

Handoff notes for Claude Code (or any other dev) picking this up.

## Mission
A self-hosted, dark-utilitarian API client. Vanilla HTML/CSS/JS front end, two tiny PHP files on the back end. Drops into any cPanel `public_html/` folder and runs.

## Tree
```
index.php          # serves app.html (nothing else)
app.html           # whole UI shell — only HTML in the project
assets/styles.css  # all styling, CSS-vars based
assets/app.js      # all logic, vanilla, ~1200 lines
proxy.php          # POST { url, method, headers, body, ... } → JSON envelope (uses cURL)
storage.php        # ?action=get|set&bucket=<name>  → reads/writes data/<name>.json
.htaccess          # locks data/*.json, sets default doc
data/              # auto-created on first save (must be writable by PHP)
```

## State model (in `assets/app.js`)
```
STATE = {
  tabs:        [{ id, name, dirty, request }],
  activeTabId: string,
  collections: [{ id, name, open, requests: [Request] }],
  history:     [{ id, ts, method, url, status, timeMs, snapshot: Request }],
  envs:        [{ id, name, vars: [{ key, val, enabled }] }],
  activeEnvId: string,
  serverProxy: 'ok' | 'fallback' | null,
}

Request = {
  id, name, method, url, description,
  params:[], headers:[], form:[], urlencoded:[],     // [{key,val,desc,enabled}]
  body:    { mode, raw, rawType, binary },
  auth:    { type, basic, bearer, apikey },
  prescript, tests,
  settings:{ followRedirects, verifySSL, timeout },
  response: null | { status, timeMs, sizeBytes, headers, body, error? },
  testResults: [{ name, pass, msg? }],
}
```

Persistence is double-buffered:
1. `localStorage[postpigeon.v1]` (always) — instant, survives without a server.
2. `storage.php → data/workspace.json` (when reachable) — for cross-device sync.

`hydrate()` prefers the server snapshot, falls back to localStorage, falls back to seed data.

## Render strategy
- One `<template id="tpl-tab-panel">` is cloned per open tab.
- `renderActivePanel()` mounts the active tab; inactive tabs are *not* mounted (cheap).
- `bindPanel(panel, tab)` wires every input via `data-bind="path.to.field"` against the request object.
- Subtab switching is a tiny helper (`bindSubtabs`) toggling `[hidden]` on `[data-pane]` peers.
- `renderResponse` is the only place that touches the response viewer.

## Send pipeline
```
sendBtn.click
  └ runUserScript(req.prescript, {req})    // sandboxed via new Function
      └ build: url = resolveVars(req.url) + buildUrl(params)
      └ build: headers = req.headers + auth + content-type defaults
      └ build: body    = raw / urlencoded / form / null
      └ POST proxy.php  (or fallback to direct fetch)
      └ req.response = envelope
      └ req.testResults = runTests(req)    // sandboxed
      └ STATE.history.unshift(...) ; persist()
```

## Variable substitution
- Anywhere a string is sent (URL, header values, body, auth fields) it goes through `resolveVars()`.
- `{{key}}` is replaced by the active env's matching var if `enabled`.
- The URL bar has a live overlay (`highlightVars`) — known vars render in amber, unknown in red.

## Theme
- All colors are CSS variables in `:root` (top of `styles.css`).
- Method colors: GET teal, POST amber, PUT blue, PATCH purple, DELETE red.
- Single accent: `--accent: #d9a441`. If you change it, every focus ring, active tab, and primary button updates.

## Adding a new feature — hot-spots to know
| You want to… | Edit |
|---|---|
| Add a new request subtab (e.g. "Docs") | `app.html` template — add `<button class="subtab" data-subtab="docs">` and `<div data-pane="docs">`; nothing else needed |
| Add a new auth type | `app.html` `<select data-bind="auth.type">`, then extend `renderAuthForm()` and `buildHeaders()` in `app.js` |
| Support a new code-gen target | Add a row to `langs` array in `openCodegenModal` and a branch in `generateCode()` |
| Send via a different proxy | Swap the `fetch('proxy.php', …)` block in `sendRequest()` |
| Add per-user accounts | Add a session check at the top of `proxy.php` + `storage.php`; namespace data dir by user |

## PHP back end notes
- `proxy.php` requires the cURL extension (default on every shared host I've tested).
- `storage.php` uses `LOCK_EX` for atomic writes; safe under concurrent tabs.
- `.htaccess` denies direct access to `data/*.json`. If your host doesn't honor `.htaccess` (nginx), move `data/` outside the web root and update `$dataDir` in `storage.php`.

## Known limitations / next steps
- **Timeline** is synthetic — cURL doesn't expose phase timing through PHP without `CURLINFO_*` plumbing. Add to `proxy.php` if you want real DNS/TCP/TLS/wait/download numbers.
- **No multipart file upload** end-to-end — UI accepts files but `proxy.php` would need to switch from a string `POSTFIELDS` to a `CURLFile` array. Stub is in place.
- **No cookie jar** — each request is independent. Easy to add: persist cookies per-host in `data/cookies.json`, inject as `Cookie:` header.
- **No GraphQL helper** — could be a body mode that wraps `{query, variables}` JSON.
- **No request chaining / runner** — would build on the existing `tests` sandbox.
- **Single-user** by design. Stick a `.htpasswd` in front of the directory if you want auth.

## Testing
No formal test suite. Smoke checklist:
1. Send `GET https://httpbin.org/get?x=1` — expect 200, JSON pretty-printed.
2. Send `POST https://httpbin.org/post` with raw JSON body — verify the echoed JSON.
3. Set an env var `baseUrl=https://httpbin.org`, change URL to `{{baseUrl}}/get` — overlay should highlight it amber.
4. Save a request to a collection, reload the page, reopen — request should still be there.
5. Toggle off the proxy (rename `proxy.php`), reload — status pill flips to "proxy offline · direct fetch".

## Style guidelines if extending
- Don't add a CSS framework. Use the existing variables and the dense, sharp-cornered, monospace-heavy aesthetic.
- Don't add a JS framework. State lives in `STATE`; rendering functions read from it.
- Keep tooltips on every interactive element (`title="…"`) — it's a power-user tool, discoverability matters.
- Match the existing copywriting: lowercase ghost-button labels, terse helper text, monospace for technical content.
