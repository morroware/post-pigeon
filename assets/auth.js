/* =============================================================
   Post Pigeon — login page logic.
   POSTs to auth.php, redirects to index.php on success.
   ============================================================= */

(() => {
  const form = document.getElementById('login-form');
  const err  = document.getElementById('err');
  const sub  = document.getElementById('submit');
  if (!form) return;

  // Pre-fill the username field if we just landed here from a logout/redirect.
  const params = new URLSearchParams(location.search);
  if (params.get('reason') === 'expired') {
    showErr('Your session expired. Sign in again.');
  } else if (params.get('reason') === 'logout') {
    showOk('Signed out.');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    sub.disabled = true;
    sub.textContent = 'Signing in…';

    const login = document.getElementById('login').value.trim();
    const password = document.getElementById('password').value;

    try {
      const r = await fetch('auth.php?action=login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({ login, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        showErr(j.error || 'Sign in failed.');
        sub.disabled = false;
        sub.textContent = 'Sign in';
        return;
      }
      // On success, jump to the app. The "next" param lets the app gate
      // bounce us through to a deep link, but right now there's only one page.
      const next = params.get('next') || 'index.php';
      location.replace(next);
    } catch (ex) {
      showErr('Network error. Try again.');
      sub.disabled = false;
      sub.textContent = 'Sign in';
    }
  });

  function showErr(msg) {
    err.classList.remove('auth-flash--ok');
    err.classList.add('auth-flash--err');
    err.textContent = msg;
    err.hidden = false;
  }
  function showOk(msg) {
    err.classList.remove('auth-flash--err');
    err.classList.add('auth-flash--ok');
    err.textContent = msg;
    err.hidden = false;
  }
})();
