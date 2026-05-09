<?php
// auth.php — public auth endpoints.
//   POST ?action=login           {login, password}            -> {ok, user}
//   POST ?action=logout                                       -> {ok}
//   GET  ?action=me                                           -> {user|null}
//   POST ?action=change_password {current, password, confirm} -> {ok}

declare(strict_types=1);

require_once __DIR__ . '/lib/util.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

pp_json_headers();
pp_check_same_origin();

$action = $_GET['action'] ?? '';

if ($action === 'me') {
    $u = pp_current_user();
    pp_json(200, ['user' => $u ? pp_user_public($u) : null]);
}

if ($action === 'login') {
    $body = pp_read_json_body();
    $login = trim((string)($body['login'] ?? ''));
    $password = (string)($body['password'] ?? '');
    if ($login === '' || $password === '') {
        pp_json_error(400, 'Login and password are required.');
    }

    $ip = pp_client_ip();
    if (pp_throttle_blocked($ip)) {
        pp_json_error(429, 'Too many failed login attempts. Try again in a few minutes.');
    }

    $user = pp_find_user_by_login($login);
    $ok = $user
        && (int)$user['is_active'] === 1
        && pp_password_verify($password, (string)$user['password_hash']);

    pp_throttle_record($ip, $login, $ok);

    if (!$ok) {
        // Same wording for "no such user" and "wrong password" to avoid enumeration.
        pp_json_error(401, 'Invalid credentials.');
    }

    pp_session_cleanup();
    pp_session_create((int)$user['id']);
    pp_db_exec('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [(int)$user['id']]);

    // Re-fetch so last_login_at is included.
    $fresh = pp_find_user((int)$user['id']);
    pp_json(200, ['ok' => true, 'user' => pp_user_public($fresh ?: $user)]);
}

if ($action === 'logout') {
    pp_logout_current();
    pp_json(200, ['ok' => true]);
}

if ($action === 'change_password') {
    $u = pp_require_user();
    $body = pp_read_json_body();
    $current = (string)($body['current'] ?? '');
    $next    = (string)($body['password'] ?? '');
    $confirm = (string)($body['confirm'] ?? '');

    if (!pp_password_verify($current, (string)$u['password_hash'])) {
        pp_json_error(401, 'Current password is incorrect.');
    }
    if ($next !== $confirm) {
        pp_json_error(400, 'New passwords do not match.');
    }
    $err = pp_validate_password($next);
    if ($err) pp_json_error(400, $err);

    pp_db_exec(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [pp_password_hash($next), (int)$u['id']]
    );
    // Invalidate all OTHER sessions; the current one stays valid.
    $token = $_COOKIE[pp_session_cookie_name()] ?? '';
    pp_db_exec('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [(int)$u['id'], $token]);
    pp_json(200, ['ok' => true]);
}

pp_json_error(400, 'Unknown action');

/* ---------------- helpers local to this entry point ---------------- */

/**
 * Public-shape user object (no password hash, no internal flags users don't need).
 */
function pp_user_public(array $u): array {
    return [
        'id'        => (int)$u['id'],
        'email'     => $u['email'],
        'username'  => $u['username'],
        'is_admin'  => (int)($u['is_admin'] ?? 0) === 1,
        'must_change_password' => (int)($u['must_change_password'] ?? 0) === 1,
        'created_at'   => $u['created_at']    ?? null,
        'last_login_at'=> $u['last_login_at'] ?? null,
    ];
}
