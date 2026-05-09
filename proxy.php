<?php
// proxy.php — Post Pigeon's server-side cURL proxy so the browser can hit any API
// without CORS interference. Returns a JSON envelope with the response
// body, status, headers, and timing.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if (!function_exists('curl_init')) {
    http_response_code(500);
    echo json_encode(['error' => 'PHP cURL extension is not enabled on this host.']);
    exit;
}

$raw = file_get_contents('php://input');
if (strlen($raw) > 16 * 1024 * 1024) { // 16 MiB request cap
    http_response_code(413);
    echo json_encode(['error' => 'Request too large']);
    exit;
}
$req = json_decode($raw, true);
if (!$req || empty($req['url'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url']);
    exit;
}

$url = (string)$req['url'];
// Only allow http(s) — blocks file://, gopher://, dict://, etc.
$scheme = strtolower(parse_url($url, PHP_URL_SCHEME) ?: '');
if ($scheme !== 'http' && $scheme !== 'https') {
    http_response_code(400);
    echo json_encode(['error' => 'Only http and https URLs are allowed']);
    exit;
}

$method  = strtoupper(preg_replace('/[^A-Z]/i', '', $req['method'] ?? 'GET')) ?: 'GET';
$headers = is_array($req['headers'] ?? null) ? $req['headers'] : [];
$body    = $req['body'] ?? null;
$timeout = (int)($req['timeout'] ?? 30);
if ($timeout < 1)   $timeout = 1;
if ($timeout > 600) $timeout = 600;
$followRedirects = !empty($req['followRedirects']);
$verifySSL = !array_key_exists('verifySSL', $req) ? true : (bool)$req['verifySSL'];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => min($timeout, 15),
    CURLOPT_FOLLOWLOCATION => $followRedirects,
    CURLOPT_MAXREDIRS      => 10,
    CURLOPT_SSL_VERIFYPEER => $verifySSL,
    CURLOPT_SSL_VERIFYHOST => $verifySSL ? 2 : 0,
    CURLOPT_ENCODING       => '',
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS=> CURLPROTO_HTTP | CURLPROTO_HTTPS,
]);

$hdrLines = [];
$hasUA = false;
foreach ($headers as $h) {
    if (!is_array($h) || empty($h['name'])) continue;
    $name = (string)$h['name'];
    // Strip CR/LF to defeat header injection.
    if (preg_match('/[\r\n]/', $name)) continue;
    $value = isset($h['value']) ? preg_replace('/[\r\n]+/', ' ', (string)$h['value']) : '';
    if (strcasecmp($name, 'user-agent') === 0) $hasUA = true;
    $hdrLines[] = $name . ': ' . $value;
}
if (!$hasUA) $hdrLines[] = 'User-Agent: PostPigeon/1.0';
curl_setopt($ch, CURLOPT_HTTPHEADER, $hdrLines);

if ($body !== null && $body !== '' && !in_array($method, ['GET','HEAD'], true)) {
    if (!is_string($body)) $body = json_encode($body);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$t0 = microtime(true);
$resp = curl_exec($ch);
$t1 = microtime(true);

if ($resp === false) {
    http_response_code(502);
    echo json_encode([
        'error'  => curl_error($ch) ?: 'cURL request failed',
        'errno'  => curl_errno($ch),
        'timeMs' => (int)(($t1 - $t0) * 1000),
    ]);
    curl_close($ch);
    exit;
}

$info       = curl_getinfo($ch);
$headerSize = $info['header_size'] ?? 0;
$rawHeaders = substr($resp, 0, $headerSize);
$respBody   = substr($resp, $headerSize);

$blocks = preg_split("/\r?\n\r?\n/", trim($rawHeaders));
$lastBlock = end($blocks);
$parsedHeaders = [];
foreach (preg_split("/\r?\n/", $lastBlock) as $i => $line) {
    if ($i === 0) continue; // status line
    if (strpos($line, ':') === false) continue;
    [$k, $v] = explode(':', $line, 2);
    $parsedHeaders[] = ['name' => trim($k), 'value' => trim($v)];
}

curl_close($ch);

$envelope = [
    'status'    => $info['http_code']      ?? 0,
    'timeMs'    => (int)(($t1 - $t0) * 1000),
    'sizeBytes' => strlen($respBody),
    'headers'   => $parsedHeaders,
    'body'      => $respBody,
    'finalUrl'  => $info['url']            ?? $url,
    'redirects' => $info['redirect_count'] ?? 0,
];

// JSON_INVALID_UTF8_SUBSTITUTE keeps non-UTF-8 / binary bodies from crashing the encode.
$flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
$out = json_encode($envelope, $flags);

if ($out === false) {
    // Last-ditch fallback: base64-encode the body so the envelope is always valid JSON.
    $envelope['body']        = base64_encode($respBody);
    $envelope['bodyEncoding'] = 'base64';
    $out = json_encode($envelope, JSON_UNESCAPED_SLASHES);
}

if ($out === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Could not encode response']);
    exit;
}
echo $out;
