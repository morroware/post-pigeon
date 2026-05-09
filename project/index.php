<?php
// Post Pigeon — entry point. The whole UI is static HTML/CSS/JS;
// this file only exists so cPanel serves it as the default doc.
// All persistence happens through storage.php; all outbound API calls go through proxy.php.
header('Content-Type: text/html; charset=utf-8');
readfile(__DIR__ . '/app.html');
