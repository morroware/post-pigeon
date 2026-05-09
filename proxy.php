<?php
// proxy.php — Post Pigeon's server-side cURL proxy so the browser can hit any API
// without CORS interference. Returns a JSON envelope with the response
// body, status, headers, and timing.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// 1MB cap on inbound payload — request bodies bigger than this don't belong
// in a JSON envelope; resist accidental DoS / memory blowup.
const POSTPIGEON_MAX_INPUT = 1048576;

function pp_fail(int $code, string $msg, array $extra = []): void {
    http_response_code($code);
    echo json_encode(array_merge(['error' => $msg], $extra));
    exit;
}

if (!function_exists('curl_init')) {
    pp_fail(500, 'cURL extension not installed — proxy cannot run');
}

$raw = file_get_contents('php://input', false, null, 0, POSTPIGEON_MAX_INPUT + 1);
if ($raw === false) {
    pp_fail(400, 'Could not read request body');
}
if (strlen($raw) > POSTPIGEON_MAX_INPUT) {
    pp_fail(413, 'Request body too large (max ' . POSTPIGEON_MAX_INPUT . ' bytes)');
}
$req = json_decode($raw, true);
if (!is_array($req) || empty($req['url'])) {
    pp_fail(400, 'Missing url');
}

$url = (string)$req['url'];

// Validate URL scheme. Reject file://, gopher://, dict://, etc. — those let
// cURL exfiltrate local files or pivot into internal services. Pretty much
// every legit Post Pigeon use case is http or https.
$parts = parse_url($url);
if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
    pp_fail(400, 'Invalid url');
}
$scheme = strtolower($parts['scheme']);
if ($scheme !== 'http' && $scheme !== 'https') {
    pp_fail(400, 'Unsupported scheme: ' . $scheme . ' (only http/https allowed)');
}

$method  = strtoupper($req['method'] ?? 'GET');
// Allow only ASCII letters in method. Prevents header injection through CRLF.
if (!preg_match('/^[A-Z]+$/', $method)) {
    pp_fail(400, 'Invalid method');
}

$headers = is_array($req['headers'] ?? null) ? $req['headers'] : [];
$body    = $req['body']    ?? null;
$timeout = (int)($req['timeout'] ?? 30);
if ($timeout < 1)   $timeout = 1;
if ($timeout > 600) $timeout = 600;
$followRedirects = !empty($req['followRedirects']);
$verifySSL = isset($req['verifySSL']) ? (bool)$req['verifySSL'] : true;

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => min(15, $timeout),
    CURLOPT_FOLLOWLOCATION => $followRedirects,
    CURLOPT_MAXREDIRS      => 10,
    CURLOPT_SSL_VERIFYPEER => $verifySSL,
    CURLOPT_SSL_VERIFYHOST => $verifySSL ? 2 : 0,
    CURLOPT_ENCODING       => '',
    // Restrict cURL to http(s) at the protocol layer too, in case redirects
    // try to escape the scheme allowlist above.
    CURLOPT_PROTOCOLS         => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS   => CURLPROTO_HTTP | CURLPROTO_HTTPS,
]);

$hdrLines = [];
$hasUA = false;
foreach ($headers as $h) {
    if (!is_array($h) || empty($h['name'])) continue;
    $name  = (string)$h['name'];
    $value = (string)($h['value'] ?? '');
    // Block CRLF injection in headers.
    if (preg_match('/[\r\n]/', $name) || preg_match('/[\r\n]/', $value)) continue;
    if (strcasecmp($name, 'user-agent') === 0) $hasUA = true;
    $hdrLines[] = $name . ': ' . $value;
}
if (!$hasUA) $hdrLines[] = 'User-Agent: PostPigeon/1.0';
curl_setopt($ch, CURLOPT_HTTPHEADER, $hdrLines);

if ($body !== null && $body !== '' && !in_array($method, ['GET','HEAD'], true)) {
    // body must be a string for POSTFIELDS; coerce arrays/objects to JSON
    // rather than having cURL fall back to multipart with no boundary.
    if (!is_string($body)) {
        $body = json_encode($body);
    }
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$t0 = microtime(true);
$rawResp = curl_exec($ch);
$t1 = microtime(true);

if ($rawResp === false) {
    echo json_encode([
        'error'  => curl_error($ch),
        'errno'  => curl_errno($ch),
        'timeMs' => (int)(($t1 - $t0) * 1000),
    ]);
    curl_close($ch);
    exit;
}

$info       = curl_getinfo($ch);
$headerSize = (int)($info['header_size'] ?? 0);
$rawHeaders = substr($rawResp, 0, $headerSize);
$respBody   = substr($rawResp, $headerSize);

$blocks = preg_split("/\r?\n\r?\n/", trim((string)$rawHeaders));
$lastBlock = is_array($blocks) && count($blocks) ? end($blocks) : '';
$parsedHeaders = [];
foreach (preg_split("/\r?\n/", (string)$lastBlock) as $i => $line) {
    if ($i === 0) continue; // skip status line
    if (strpos($line, ':') === false) continue;
    [$k, $v] = explode(':', $line, 2);
    $parsedHeaders[] = ['name' => trim($k), 'value' => trim($v)];
}

curl_close($ch);
echo json_encode([
    'status'      => (int)($info['http_code'] ?? 0),
    'timeMs'      => (int)(($t1 - $t0) * 1000),
    'sizeBytes'   => strlen((string)$respBody),
    'headers'     => $parsedHeaders,
    'body'        => $respBody,
    'finalUrl'    => $info['url'] ?? $url,
    'redirects'   => (int)($info['redirect_count'] ?? 0),
]);
