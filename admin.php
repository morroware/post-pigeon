<?php
// admin.php — admin-only endpoints for managing users.
//
//   GET    ?action=list                                   -> {users:[...]}
//   POST   ?action=create  {email, username, password, is_admin?}  -> {user, temp_password?}
//   POST   ?action=delete  {id}                                    -> {ok}
//   POST   ?action=set_active {id, is_active}                      -> {ok}
//   POST   ?action=set_admin  {id, is_admin}                       -> {ok}
//   POST   ?action=reset_password {id} -> {ok, temp_password}
//
// The current user must be an admin. The first user created (via setup.php)
// is automatically promoted; subsequent admins are toggled here.

declare(strict_types=1);

require_once __DIR__ . '/lib/util.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

pp_json_headers();
pp_check_same_origin();

$me = pp_require_admin();
$action = $_GET['action'] ?? '';

if ($action === 'list') {
    $rows = pp_db_all(
        'SELECT id, email, username, is_admin, is_active, must_change_password, created_at, last_login_at
           FROM users ORDER BY id ASC'
    );
    foreach ($rows as &$r) {
        $r['is_admin']  = (int)$r['is_admin']  === 1;
        $r['is_active'] = (int)$r['is_active'] === 1;
        $r['must_change_password'] = (int)$r['must_change_password'] === 1;
    }
    pp_json(200, ['users' => $rows]);
}

if ($action === 'create') {
    $b = pp_read_json_body();
    $email    = (string)($b['email']    ?? '');
    $username = (string)($b['username'] ?? '');
    $pw       = (string)($b['password'] ?? '');
    $isAdmin  = !empty($b['is_admin']);

    // If the admin omitted a password, generate one and force a change on first login.
    $tempGenerated = false;
    if ($pw === '') {
        $pw = pp_generate_temp_password();
        $tempGenerated = true;
    }
    try {
        $id = pp_create_user($email, $username, $pw, $isAdmin, $tempGenerated);
    } catch (InvalidArgumentException $e) {
        pp_json_error(400, $e->getMessage());
    } catch (RuntimeException $e) {
        pp_json_error(409, $e->getMessage());
    }
    $out = ['user' => pp_admin_user_row($id)];
    if ($tempGenerated) $out['temp_password'] = $pw;
    pp_json(201, $out);
}

if ($action === 'delete') {
    $b = pp_read_json_body();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) pp_json_error(400, 'id is required');
    if ($id === (int)$me['id']) pp_json_error(400, 'You cannot delete your own account.');

    // Refuse to delete the last admin.
    pp_guard_last_admin($id, 'delete');

    pp_db_exec('DELETE FROM users WHERE id = ?', [$id]);
    pp_json(200, ['ok' => true]);
}

if ($action === 'set_active') {
    $b = pp_read_json_body();
    $id = (int)($b['id'] ?? 0);
    $val = !empty($b['is_active']) ? 1 : 0;
    if ($id <= 0) pp_json_error(400, 'id is required');
    if ($id === (int)$me['id'] && $val === 0) {
        pp_json_error(400, 'You cannot deactivate your own account.');
    }
    if ($val === 0) pp_guard_last_admin($id, 'deactivate');

    pp_db_exec('UPDATE users SET is_active = ? WHERE id = ?', [$val, $id]);
    if ($val === 0) pp_db_exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
    pp_json(200, ['ok' => true]);
}

if ($action === 'set_admin') {
    $b = pp_read_json_body();
    $id = (int)($b['id'] ?? 0);
    $val = !empty($b['is_admin']) ? 1 : 0;
    if ($id <= 0) pp_json_error(400, 'id is required');
    if ($id === (int)$me['id'] && $val === 0) {
        pp_json_error(400, 'You cannot demote your own account.');
    }
    if ($val === 0) pp_guard_last_admin($id, 'demote');
    pp_db_exec('UPDATE users SET is_admin = ? WHERE id = ?', [$val, $id]);
    pp_json(200, ['ok' => true]);
}

if ($action === 'reset_password') {
    $b = pp_read_json_body();
    $id = (int)($b['id'] ?? 0);
    if ($id <= 0) pp_json_error(400, 'id is required');
    $temp = pp_generate_temp_password();
    pp_db_exec(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [pp_password_hash($temp), $id]
    );
    // Invalidate all of that user's sessions.
    pp_db_exec('DELETE FROM sessions WHERE user_id = ?', [$id]);
    pp_json(200, ['ok' => true, 'temp_password' => $temp]);
}

pp_json_error(400, 'Unknown action');

/* ---------------- helpers ---------------- */

function pp_admin_user_row(int $id): ?array {
    $row = pp_db_one(
        'SELECT id, email, username, is_admin, is_active, must_change_password, created_at, last_login_at
           FROM users WHERE id = ?',
        [$id]
    );
    if (!$row) return null;
    $row['is_admin']  = (int)$row['is_admin']  === 1;
    $row['is_active'] = (int)$row['is_active'] === 1;
    $row['must_change_password'] = (int)$row['must_change_password'] === 1;
    return $row;
}

/**
 * Refuse the operation if it would leave the system with zero active admins.
 */
function pp_guard_last_admin(int $userId, string $verb): void {
    $row = pp_db_one(
        'SELECT COUNT(*) AS n FROM users
          WHERE is_admin = 1 AND is_active = 1 AND id <> ?',
        [$userId]
    );
    if (((int)($row['n'] ?? 0)) === 0) {
        pp_json_error(400, "Cannot {$verb} the last active admin.");
    }
}

/**
 * Generate a memorable-ish temporary password. Long enough to satisfy
 * password_min_length under any reasonable setting, all printable ASCII.
 */
function pp_generate_temp_password(): string {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ' .          // no I, O — disambiguate
                'abcdefghijkmnopqrstuvwxyz' .          // no l
                '23456789' .                           // no 0, 1
                '!@#%^&*-_=+';
    $len = max((int)pp_config_get('password_min_length', 10), 12);
    $out = '';
    $alphaLen = strlen($alphabet) - 1;
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[random_int(0, $alphaLen)];
    }
    return $out;
}
