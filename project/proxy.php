<?php
// proxy.php — Post Pigeon's server-side cURL proxy so the browser can hit any API
// without CORS interference. Returns a JSON envelope with the response
// body, status, headers, and timing.

header('Content-Type: application/json; charset=utf-8');

$raw = file_get_contents('php://input');
$req = json_decode($raw, true);
if (!$req || empty($req['url'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url']);
    exit;
}

$method  = strtoupper($req['method'] ?? 'GET');
$url     = $req['url'];
$headers = $req['headers'] ?? [];
$body    = $req['body']    ?? null;
$timeout = (int)($req['timeout'] ?? 30);
$followRedirects = !empty($req['followRedirects']);
$verifySSL = $req['verifySSL'] ?? true;

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => true,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_FOLLOWLOCATION => $followRedirects,
    CURLOPT_SSL_VERIFYPEER => $verifySSL,
    CURLOPT_SSL_VERIFYHOST => $verifySSL ? 2 : 0,
    CURLOPT_ENCODING       => '',
]);

$hdrLines = [];
$hasUA = false;
foreach ($headers as $h) {
    if (empty($h['name'])) continue;
    if (strcasecmp($h['name'], 'user-agent') === 0) $hasUA = true;
    $hdrLines[] = $h['name'] . ': ' . ($h['value'] ?? '');
}
if (!$hasUA) $hdrLines[] = 'User-Agent: PostPigeon/1.0';
curl_setopt($ch, CURLOPT_HTTPHEADER, $hdrLines);

if ($body !== null && $body !== '' && !in_array($method, ['GET','HEAD'])) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$t0 = microtime(true);
$raw = curl_exec($ch);
$t1 = microtime(true);

if ($raw === false) {
    echo json_encode([
        'error'  => curl_error($ch),
        'errno'  => curl_errno($ch),
        'timeMs' => (int)(($t1 - $t0) * 1000),
    ]);
    curl_close($ch);
    exit;
}

$info       = curl_getinfo($ch);
$headerSize = $info['header_size'];
$rawHeaders = substr($raw, 0, $headerSize);
$respBody   = substr($raw, $headerSize);

$blocks = preg_split("/\r?\n\r?\n/", trim($rawHeaders));
$lastBlock = end($blocks);
$parsedHeaders = [];
foreach (preg_split("/\r?\n/", $lastBlock) as $i => $line) {
    if ($i === 0) continue;
    if (strpos($line, ':') === false) continue;
    [$k, $v] = explode(':', $line, 2);
    $parsedHeaders[] = ['name' => trim($k), 'value' => trim($v)];
}

curl_close($ch);
echo json_encode([
    'status'      => $info['http_code'],
    'timeMs'      => (int)(($t1 - $t0) * 1000),
    'sizeBytes'   => strlen($respBody),
    'headers'     => $parsedHeaders,
    'body'        => $respBody,
    'finalUrl'    => $info['url'],
    'redirects'   => $info['redirect_count'] ?? 0,
]);
