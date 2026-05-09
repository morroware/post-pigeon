<?php
// Post Pigeon — entry point.
// If config.php is missing, redirect to setup.php so the user lands somewhere helpful.
// If the user is not authenticated, redirect to login.html.
// Otherwise, serve app.html (which is the static SPA shell).

require_once __DIR__ . '/lib/util.php';

if (!pp_config_present()) {
    header('Location: setup.php', true, 302);
    exit;
}

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

// If the schema isn't applied yet, also send the user to setup.
if (!pp_db_table_exists('users') || pp_db_user_count() === 0) {
    header('Location: setup.php', true, 302);
    exit;
}

if (!pp_current_user()) {
    // Preserve the originally requested URL so the user lands back here after login.
    $next = $_SERVER['REQUEST_URI'] ?? 'index.php';
    header('Location: login.html?next=' . urlencode($next), true, 302);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/app.html');
