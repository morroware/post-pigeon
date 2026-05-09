<?php
// storage.php — flat-file JSON persistence under data/.
// Buckets: collections, history, environments, settings.
header('Content-Type: application/json; charset=utf-8');

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);

$action = $_GET['action'] ?? 'get';
$bucket = preg_replace('/[^a-z0-9_]/i', '', $_GET['bucket'] ?? '');
if (!$bucket) { http_response_code(400); echo json_encode(['error'=>'bad bucket']); exit; }
$file = "$dataDir/$bucket.json";

if ($action === 'get') {
    if (!file_exists($file)) { echo json_encode(['data' => null]); exit; }
    echo json_encode(['data' => json_decode(file_get_contents($file), true)]);
    exit;
}
if ($action === 'set') {
    $payload = file_get_contents('php://input');
    file_put_contents($file, $payload, LOCK_EX);
    echo json_encode(['ok' => true]);
    exit;
}
http_response_code(400);
echo json_encode(['error' => 'bad action']);
