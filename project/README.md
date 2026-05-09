# Post Pigeon

A self-hosted, dark-utilitarian API client. Vanilla HTML/CSS/JS on the front end, two tiny PHP files on the back end. Drop the folder into any `public_html/` on shared cPanel hosting and it just works — no build step, no node, no docker.

## What's in the loft
- **Request workshop** — method, URL with `{{var}}` substitution, params, headers, body (none / form-data / x-www-form-urlencoded / raw JSON·XML·HTML·text·JS / binary), auth (none, Basic, Bearer, API Key)
- **Response viewer** — status pill, time, size, pretty/raw/preview JSON with syntax coloring, response search, headers table, cookies, synthetic timeline
- **Collections + history** — flat-file persistence under `data/`, mirrored to `localStorage`
- **Environments** — multiple sets of `{{vars}}`, switchable from the topbar; live-highlighted in the URL bar
- **Pre-request scripts + tests** — sandboxed `pp.test()`, `pp.expect()`, `pp.env.set()` style helpers
- **Code generator** — cURL, fetch, axios, Python requests, PHP cURL, Go net/http, raw HTTP
- **Import / export** — paste a `curl` command, paste JSON, or download the whole workspace
- **Tabs, splitter, keyboard shortcuts** — `⌘↵` send, `⌘S` save, `⌘T` new tab, `⌘W` close, `/` focus search

## Files
| File | Role |
|---|---|
| `index.php` | Entry point; serves `app.html` |
| `app.html` | Single-page UI shell |
| `assets/styles.css` | Dark theme |
| `assets/app.js` | Application logic |
| `proxy.php` | Server-side cURL proxy (bypasses browser CORS) |
| `storage.php` | Reads/writes JSON buckets under `data/` |
| `.htaccess` | Default doc + locks `data/*.json` from direct download |

## Deploy to cPanel
1. Upload the whole folder to `public_html/postpigeon/` (or wherever).
2. Make sure `data/` is writable by PHP (cPanel default 0755 usually works; chmod 0775 if not).
3. Visit `https://yourdomain.com/postpigeon/`.
4. The proxy uses PHP's bundled cURL; available on every shared host I've seen.

If `proxy.php` is unreachable the UI falls back to direct browser `fetch()` — fine for CORS-friendly APIs, blocked for the rest.
