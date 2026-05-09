<?php
// storage.php — flat-file JSON persistence under data/.
// Buckets: workspace (currently the only writer; the schema can grow).
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// 4MB cap for a workspace snapshot — generous for a single-user setup,
// stops a runaway loop from filling the disk.
const POSTPIGEON_MAX_SNAPSHOT = 4 * 1024 * 1024;

function pp_fail(int $code, string $msg): void {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    if (!@mkdir($dataDir, 0755, true) && !is_dir($dataDir)) {
        pp_fail(500, 'Could not create data directory; check filesystem permissions');
    }
}
if (!is_writable($dataDir)) {
    pp_fail(500, 'Data directory is not writable by PHP');
}

$action = $_GET['action'] ?? 'get';
// Bucket is sanitized to alnum+underscore so it can't escape $dataDir.
$bucket = preg_replace('/[^a-z0-9_]/i', '', (string)($_GET['bucket'] ?? ''));
if (!$bucket) {
    pp_fail(400, 'bad bucket');
}
$file = $dataDir . '/' . $bucket . '.json';

if ($action === 'get') {
    if (!file_exists($file)) {
        echo json_encode(['data' => null]);
        exit;
    }
    $contents = @file_get_contents($file);
    if ($contents === false) {
        pp_fail(500, 'Could not read bucket file');
    }
    $decoded = json_decode($contents, true);
    // If the file was corrupted somehow, return null rather than a parse error
    // so the frontend falls back to localStorage instead of breaking.
    echo json_encode(['data' => $decoded]);
    exit;
}

if ($action === 'set') {
    $payload = file_get_contents('php://input', false, null, 0, POSTPIGEON_MAX_SNAPSHOT + 1);
    if ($payload === false) {
        pp_fail(400, 'Could not read request body');
    }
    if (strlen($payload) > POSTPIGEON_MAX_SNAPSHOT) {
        pp_fail(413, 'Snapshot too large (max ' . POSTPIGEON_MAX_SNAPSHOT . ' bytes)');
    }
    // Reject non-JSON to avoid storing garbage that breaks future reads.
    json_decode($payload, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        pp_fail(400, 'Payload is not valid JSON: ' . json_last_error_msg());
    }
    // Atomic write: write to a temp file in the same dir, then rename.
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    $written = @file_put_contents($tmp, $payload, LOCK_EX);
    if ($written === false) {
        @unlink($tmp);
        pp_fail(500, 'Could not write bucket file');
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        pp_fail(500, 'Could not commit bucket file');
    }
    echo json_encode(['ok' => true]);
    exit;
}

pp_fail(400, 'bad action');
