<?php
// storage.php — deprecated. Workspace persistence moved to MySQL via api.php
// when authentication was added. This shim exists so callers that still hit
// the old endpoint get a clear error instead of a confusing 404.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
http_response_code(410);
echo json_encode([
    'error' => 'storage.php was removed. Use api.php (resource=workspace) and authenticate via auth.php.',
]);
