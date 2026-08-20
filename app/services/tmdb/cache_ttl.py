"""Cache TTLs (seconds) shared by every tmdb_pkg module. Kept in one place
so the relative freshness of each cache category stays easy to compare."""

INFO_CACHE_TTL = 24 * 3600
SEARCH_CACHE_TTL = 3 * 3600
DISCOVER_CACHE_TTL = 6 * 3600
COMPANY_ID_CACHE_TTL = 30 * 24 * 3600
