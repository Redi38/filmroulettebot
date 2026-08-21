"""Table creation and one-off migrations, run once at startup via init_db()."""
from __future__ import annotations

import logging

import aiosqlite

from .connection import NOCASE_TABLES, conn

logger = logging.getLogger(__name__)


async def _migrate_to_nocase(db: aiosqlite.Connection, table: str) -> None:
    """If `table` exists but its `title` column isn't COLLATE NOCASE, rebuild it
    with the new schema, migrating data and merging case-insensitive duplicates
    (first occurrence wins, rest are dropped silently)."""
    async with db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        return

    create_sql = row[0] or ""
    if "COLLATE NOCASE" in create_sql.upper().replace("COLLATE  NOCASE", "COLLATE NOCASE"):
        return

    logger.info("Migration: rebuilding table %r with COLLATE NOCASE on title…", table)

    tmp_table = f"{table}__new_nocase"
    await db.execute(f"DROP TABLE IF EXISTS {tmp_table}")
    await db.execute(
        f"CREATE TABLE {tmp_table} "
        f"(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE)"
    )

    async with db.execute(f"SELECT title FROM {table} ORDER BY id ASC") as cur:
        titles = [r[0] async for r in cur]

    dropped: list[str] = []
    for title in titles:
        result = await db.execute(
            f"INSERT OR IGNORE INTO {tmp_table} (title) VALUES (?)", (title,)
        )
        if result.rowcount == 0:
            dropped.append(title)

    await db.execute(f"DROP TABLE {table}")
    await db.execute(f"ALTER TABLE {tmp_table} RENAME TO {table}")

    if dropped:
        logger.warning(
            "Migration: table %r had %d case-insensitive duplicate(s) merged away: %s",
            table, len(dropped), dropped,
        )
    logger.info("Migration: table %r rebuilt (%d rows kept).", table, len(titles) - len(dropped))


async def init_db() -> None:
    """Create tables and run migrations."""
    async with conn() as db:
        async with db.execute("PRAGMA table_info(history)") as cur:
            cols = {row[1] async for row in cur}
        if cols and "user_id" not in cols:
            logger.info("Migration: adding user_id to history…")
            await db.execute(
                "ALTER TABLE history ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0"
            )
        if cols and "resolved_type" not in cols:
            logger.info("Migration: adding resolved_type/resolved_new_title to history…")
            await db.execute(
                "ALTER TABLE history ADD COLUMN resolved_type TEXT"
            )
            await db.execute(
                "ALTER TABLE history ADD COLUMN resolved_new_title TEXT"
            )
        await db.commit()

        for table in NOCASE_TABLES:
            await _migrate_to_nocase(db, table)
        await db.commit()

        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL DEFAULT 0,
                category  TEXT    NOT NULL,
                title     TEXT    NOT NULL,
                timestamp REAL    NOT NULL,
                resolved_type      TEXT,
                resolved_new_title TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_history_user_category_ts
                ON history (user_id, category, timestamp);

            CREATE TABLE IF NOT EXISTS movies        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS cartoons      (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS series        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS dc            (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS marvel        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS upcoming_movies (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS tracked_series  (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS tmdb_cache (
                cache_key TEXT PRIMARY KEY,
                payload   TEXT NOT NULL,
                cached_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tmdb_cache_cached_at ON tmdb_cache (cached_at);

            CREATE TABLE IF NOT EXISTS skipped_titles (
                scope TEXT NOT NULL,
                title TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY (scope, title)
            );
            """
        )
        await db.commit()
    logger.info("DB initialised.")
