<?php
// storage.php — flat-file JSON persistence under data/.
// Buckets: collections, history, environments, settings.
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true) && !is_dir($dataDir)) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not create data directory. Check permissions on the project folder.']);
        exit;
    }
}

// Defense-in-depth: drop a .htaccess inside data/ on first write so the directory
// can never be browsed, even if the project root .htaccess is bypassed (e.g. nginx).
$dataHt = $dataDir . '/.htaccess';
if (!file_exists($dataHt)) {
    @file_put_contents($dataHt,
        "Require all denied\n" .
        "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
    );
}

$action = $_GET['action'] ?? 'get';
$bucket = preg_replace('/[^a-z0-9_]/i', '', $_GET['bucket'] ?? '');
if (!$bucket) {
    http_response_code(400);
    echo json_encode(['error' => 'bad bucket']);
    exit;
}
$file = "$dataDir/$bucket.json";

if ($action === 'get') {
    if (!file_exists($file)) { echo json_encode(['data' => null]); exit; }
    $raw = @file_get_contents($file);
    if ($raw === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not read storage']);
        exit;
    }
    $decoded = json_decode($raw, true);
    echo json_encode(['data' => $decoded]);
    exit;
}

if ($action === 'set') {
    $payload = file_get_contents('php://input');
    if ($payload === false) {
        http_response_code(400);
        echo json_encode(['error' => 'no body']);
        exit;
    }
    if (strlen($payload) > 16 * 1024 * 1024) { // 16 MiB cap
        http_response_code(413);
        echo json_encode(['error' => 'payload too large']);
        exit;
    }
    // Reject non-JSON to keep the file readable.
    json_decode($payload);
    if (json_last_error() !== JSON_ERROR_NONE) {
        http_response_code(400);
        echo json_encode(['error' => 'payload is not valid JSON: ' . json_last_error_msg()]);
        exit;
    }
    $written = @file_put_contents($file, $payload, LOCK_EX);
    if ($written === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Could not write storage. Make sure the data/ directory is writable by PHP.']);
        exit;
    }
    echo json_encode(['ok' => true, 'bytes' => $written]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'bad action']);
