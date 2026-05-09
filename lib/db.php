<?php
// lib/db.php — PDO connection singleton and small query helpers.

declare(strict_types=1);

require_once __DIR__ . '/util.php';

/**
 * Return a memoised PDO instance. Aborts with a 500 / clear message if the
 * connection fails so the caller doesn't have to repeat boilerplate.
 */
function pp_db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    if (!pp_config_present()) {
        pp_json_error(503, 'Server is not configured. Copy config.example.php to config.php and run setup.php.');
    }

    $db = pp_config_get('db', []);
    $host    = $db['host']    ?? 'localhost';
    $port    = (int)($db['port'] ?? 3306);
    $name    = $db['name']    ?? '';
    $user    = $db['user']    ?? '';
    $pass    = $db['pass']    ?? '';
    $charset = $db['charset'] ?? 'utf8mb4';
    if ($name === '' || $user === '') {
        pp_json_error(503, 'Database credentials are missing in config.php');
    }

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset={$charset}";
    try {
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::MYSQL_ATTR_FOUND_ROWS   => true,
        ]);
    } catch (PDOException $e) {
        // Don't leak credentials in the error envelope.
        error_log('post-pigeon: DB connect failed: ' . $e->getMessage());
        pp_json_error(503, 'Database connection failed. Check config.php and that MySQL is reachable.');
    }
    return $pdo;
}

/**
 * Convenience: prepare + execute + fetchAll.
 *
 * @param string $sql
 * @param array<int|string,mixed> $args
 * @return array<int,array<string,mixed>>
 */
function pp_db_all(string $sql, array $args = []): array {
    $stmt = pp_db()->prepare($sql);
    $stmt->execute($args);
    return $stmt->fetchAll();
}

/**
 * Convenience: prepare + execute + fetch one row (or null).
 *
 * @return array<string,mixed>|null
 */
function pp_db_one(string $sql, array $args = []): ?array {
    $stmt = pp_db()->prepare($sql);
    $stmt->execute($args);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function pp_db_exec(string $sql, array $args = []): int {
    $stmt = pp_db()->prepare($sql);
    $stmt->execute($args);
    return $stmt->rowCount();
}

/**
 * Apply schema.sql idempotently. Reads the file, splits on top-level
 * semicolons, and executes each statement in order.
 *
 * @return array{statements:int,already_present:bool}
 */
function pp_db_apply_schema(): array {
    $sql = @file_get_contents(PP_ROOT . '/schema.sql');
    if ($sql === false) {
        throw new RuntimeException('schema.sql not found at project root');
    }
    // Strip line comments and split. We don't have any procedure/trigger DDL
    // in schema.sql so a naive split on `;` at end-of-statement is safe.
    $stripped = preg_replace('/^\s*--.*$/m', '', $sql) ?? '';
    $parts = array_filter(array_map('trim', preg_split('/;\s*\R/', $stripped)));
    $count = 0;
    $alreadyPresent = pp_db_table_exists('users');
    foreach ($parts as $stmt) {
        if ($stmt === '') continue;
        pp_db()->exec($stmt);
        $count++;
    }
    return ['statements' => $count, 'already_present' => $alreadyPresent];
}

function pp_db_table_exists(string $table): bool {
    $row = pp_db_one(
        'SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [$table]
    );
    return $row !== null;
}

function pp_db_user_count(): int {
    if (!pp_db_table_exists('users')) return 0;
    $row = pp_db_one('SELECT COUNT(*) AS n FROM users');
    return (int)($row['n'] ?? 0);
}
