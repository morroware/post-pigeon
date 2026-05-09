# Post Pigeon

A self-hosted, dark-utilitarian API client. Vanilla HTML/CSS/JS on the front end, two small PHP files on the back end. Drop the folder into any `public_html/` on shared cPanel hosting and it just works — no build step, no Node, no Docker, no database.

If `proxy.php` is reachable, requests are sent through it as a CORS-bypassing cURL proxy. If not, the UI falls back to the browser's `fetch()` (works for CORS-friendly APIs, blocked for the rest).

---

## Features

- **Request workshop** — method, URL with `{{var}}` substitution, query params, headers, body (none / form-data / x-www-form-urlencoded / raw JSON·XML·HTML·text·JS), auth (none, Basic, Bearer, API Key)
- **Response viewer** — status pill, time, size, pretty / raw / sandboxed-HTML preview with JSON syntax coloring, in-response search, headers table, cookies, synthetic timeline
- **Collections + history** — flat-file persistence under `data/`, mirrored to `localStorage`
- **Environments** — multiple sets of `{{vars}}`, switchable from the topbar; live-highlighted in the URL bar
- **Pre-request scripts + tests** — sandboxed `rb.test()`, `rb.expect()`, `rb.env.set()` helpers
- **Code generator** — cURL, fetch, axios, Python `requests`, PHP cURL, Go `net/http`, raw HTTP
- **Import / export** — paste a `curl` command, paste JSON, or download the whole workspace
- **Tabs, splitter, keyboard shortcuts** — `⌘↵` send, `⌘S` save, `⌘T` new tab, `⌘W` close, `/` focus search

> **Heads-up — limitations:** the **binary** body mode is UI only (the file picker shows up but a binary file is not yet streamed through the proxy). The **timeline** tab shows synthetic phases — cURL's real DNS/TCP/TLS phase numbers aren't plumbed through `proxy.php` yet. There is **no built-in cookie jar** — every request is independent. There is **no built-in auth** on `storage.php` / `proxy.php`; if you want only yourself to use it, put a `.htpasswd` in front of the directory (instructions below).

---

## What gets deployed

These are the only files you need on the server:

```
index.php          # serves app.html
app.html           # single-page UI
assets/app.js      # all logic, vanilla JS
assets/styles.css  # dark theme
proxy.php          # cURL proxy (bypasses browser CORS)
storage.php        # flat-file JSON persistence under data/
.htaccess          # default doc + denies direct .json access
```

Everything else in the repo (`project/`, `chats/`, `.git`) is reference material — safe to skip when uploading.

---

## Install on cPanel shared hosting

This is the easy path. If you already know how to FTP a folder into `public_html/`, you can skim.

### 1. Download the files

Either:

- Click **Code → Download ZIP** on the GitHub repo and unzip it locally, or
- Run `git clone https://github.com/morroware/post-pigeon.git` if you have git installed.

### 2. Upload to your host

Sign in to cPanel, open **File Manager**, and navigate to `public_html/`.

You have two reasonable layouts:

- **Subfolder** (recommended) — create `public_html/postpigeon/` and upload into that. URL becomes `https://yourdomain.com/postpigeon/`.
- **Subdomain** — create a subdomain like `pigeon.yourdomain.com` in cPanel (it will create a folder for you), and upload there.

Upload these files/folders only:

```
index.php
app.html
.htaccess
proxy.php
storage.php
assets/
```

> Tip: it's easier to upload the whole project as a single ZIP and use cPanel File Manager's **Extract** action than to upload files one at a time. Just delete `project/`, `chats/`, `.git/`, and `README.md` afterwards if you want a tidy directory.

### 3. Make sure `.htaccess` was uploaded

`.htaccess` is a hidden file, and many FTP/upload tools skip hidden files by default. In cPanel File Manager, click **Settings** (top right) and tick **Show Hidden Files (dotfiles)**, then re-check that `.htaccess` is in your project folder. Without it, the default doc behavior and `data/*.json` denial won't work.

### 4. Set permissions

In File Manager, right-click the project folder and choose **Change Permissions**. The defaults from upload are usually fine:

- The project folder itself: `0755`
- `*.php` and `*.html`: `0644`
- `assets/`: `0755` and files inside: `0644`

Post Pigeon will create `data/` itself on first save, with mode `0755`. If your host's PHP can't write to the project folder (rare), change the project folder to `0775` temporarily and try again — once `data/` exists, you can revert.

### 5. Verify PHP requirements

Post Pigeon needs:

- PHP 7.2 or newer (any host running PHP 7.4 / 8.x is fine)
- The **cURL** extension enabled (default on every shared host I've tested)

Most cPanel control panels have a **Select PHP Version** or **MultiPHP Manager** tool. Open it, confirm the version is 7.2+, and verify that `curl` is checked in the extension list.

### 6. Open it in your browser

- Subfolder: `https://yourdomain.com/postpigeon/`
- Subdomain: `https://pigeon.yourdomain.com/`

You should see the Post Pigeon UI with the proxy status pill in the top-right showing **proxy · ok**. If it shows **proxy offline · direct fetch**, see Troubleshooting below.

### 7. (Strongly recommended) Lock it down

`storage.php` and `proxy.php` have **no built-in authentication**. On a public host, anyone who knows the URL can use your proxy and read/overwrite your saved workspace. Protect the directory with HTTP Basic Auth:

In cPanel, open **Directory Privacy** (sometimes called "Password Protect Directories"), navigate to the project folder, tick **Password protect this directory**, name the realm something like *Post Pigeon*, save, then create a user. Now the whole app prompts for a username/password before loading.

---

## Manual install (any host with PHP + cURL)

The same files work outside cPanel:

```bash
git clone https://github.com/morroware/post-pigeon.git
cd post-pigeon

# Local smoke-test:
php -S 127.0.0.1:8080
# → http://127.0.0.1:8080/
```

For Apache: drop the project into your document root. The included `.htaccess` handles default-doc and locks down `data/*.json`.

For Nginx: `.htaccess` is ignored. Either:

- Move `data/` outside the web root and update `$dataDir` in `storage.php`, or
- Add a server block rule that 403s requests under `/data/`. Example:

```nginx
location ^~ /data/ { deny all; return 403; }
location / { try_files $uri $uri/ /index.php; }
location ~ \.php$ {
    include fastcgi_params;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
}
```

---

## File map

| File | Role |
|---|---|
| `index.php` | Entry point; serves `app.html` |
| `app.html` | Single-page UI shell |
| `assets/app.js` | Application logic |
| `assets/styles.css` | Dark theme |
| `proxy.php` | Server-side cURL proxy. Restricted to `http(s)://`, request body capped at 16 MiB, timeout clamped 1–600s. |
| `storage.php` | Reads/writes JSON buckets under `data/`. Validates JSON, caps payload at 16 MiB, drops a `data/.htaccess` deny-all on first write. |
| `.htaccess` | Default doc + denies direct download of any `*.json` |
| `data/` | Auto-created on first save. Holds `workspace.json`. Listed in `.gitignore`. |
| `project/`, `chats/` | Original handoff artifacts from Claude Design — reference only, do not deploy. |

---

## How it works

The whole UI is one HTML file (`app.html`) and one JS file (`assets/app.js`). State lives in a plain JS object and is double-buffered to:

1. `localStorage["postpigeon.v1"]` — instant, survives without a server.
2. `data/workspace.json` via `storage.php` — for cross-device sync.

When you click **Send**, the UI POSTs a small JSON envelope to `proxy.php`:

```json
{
  "method": "POST",
  "url": "https://api.example.com/v1/users",
  "headers": [{"name":"Authorization","value":"Bearer …"}],
  "body": "{\"name\":\"Alice\"}",
  "timeout": 30,
  "followRedirects": false,
  "verifySSL": true
}
```

`proxy.php` runs that through cURL and returns:

```json
{
  "status": 201,
  "timeMs": 84,
  "sizeBytes": 142,
  "headers": [...],
  "body": "...",
  "finalUrl": "...",
  "redirects": 0
}
```

Variable substitution (`{{baseUrl}}` etc.) happens in the UI before the envelope is built — `proxy.php` never sees your env vars.

---

## Security notes

- `proxy.php` only accepts `http://` and `https://` URLs (no `file://`, `gopher://`, etc.).
- `proxy.php` follows redirects only when you opt in per request, and only to `http(s)://` targets.
- Headers with embedded CR/LF are stripped to defeat header injection.
- `storage.php` validates that the saved payload is JSON before writing, and rejects payloads larger than 16 MiB.
- The HTML response preview iframe is `sandbox`-ed and `referrerPolicy="no-referrer"` so previewed pages can't run scripts or leak referrers.
- **There is no built-in user auth.** Anyone who can reach `storage.php` / `proxy.php` can use them. Use cPanel **Directory Privacy** (or any HTTP Basic Auth) to lock the folder down. This is also a soft-SSRF mitigation — only authenticated users can fire requests through your server.

---

## Troubleshooting

**Status pill says "proxy offline · direct fetch (CORS)"**
The browser couldn't reach `proxy.php`. Open `https://yourdomain.com/postpigeon/proxy.php` directly — you should see `{"error":"Missing url"}`. If you instead see PHP source, your host isn't running PHP for that file (enable PHP for the directory in cPanel). If you get 403/404, re-check that `proxy.php` was uploaded and `index.php` is the default doc.

**"Could not write storage" toast / saves don't persist**
Your project folder isn't writable by the PHP user. In cPanel File Manager, change permissions on the project folder to `0775`, send a request to trigger a save, then revert to `0755`.

**Saved workspace is being overwritten by other tabs**
Same browser, multiple tabs, no auth — every tab persists its own `STATE` to `data/workspace.json`. Open the app in only one tab at a time, or restrict to a single device with Directory Privacy.

**Headers I add in the UI don't appear on the wire**
This was a bug in pre-1.0 builds — the header rows were stored as `{key, val}` but the request builder read `{name, value}`. Pull the latest, refresh the page, and re-save your workspace.

**HTML preview is blank**
Sandboxed iframes can't run scripts, so single-page apps render as their initial server-side HTML only. Switch the response viewer to `pretty` or `raw` to see the full body.

**Binary body mode does nothing**
Known limitation — the UI accepts a file but `proxy.php` doesn't yet stream it. Use `raw` mode with a base64-encoded payload as a workaround.

---

## Development / local hacking

The whole stack is two PHP files plus three static assets. To iterate locally:

```bash
php -S 127.0.0.1:8080
# Edit assets/app.js or assets/styles.css; reload the page.
```

There is no build step. There is no test suite — see `project/CLAUDE.md` for the smoke checklist.

The `project/` and `chats/` folders are the original Claude Design handoff bundle (kept for reference). They contain a duplicate of the deployable files plus the design transcript.

---

## License

MIT.
