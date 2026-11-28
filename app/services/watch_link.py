"""Best-effort resolver for a direct "watch page" URL on the site configured
via WATCH_LINK_TEMPLATE (see app/config.py), instead of linking to a generic
search-results page.

There's no official API for sites like kinogo — this works by fetching the
site's search page, collecting every link that looks like a real title page
(…/<category>/<numeric-id>-<slug>.html, the pattern kinogo-family sites use),
and picking the one whose URL slug best matches the title we searched for —
kinogo's own search relevance ordering isn't reliable (e.g. querying
"Менталист" can rank "Менталистка" first), so we don't just trust results[0].
If the site's markup doesn't match, or the request fails/times out, the
caller should fall back to the plain search link — this module never raises
for that; it just returns None.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from urllib.parse import quote_plus

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 5

# kinogo-family sites answer non-browser clients (including a "…bot/1.0"
# User-Agent) with 404 / bot-detection pages, so the search request is sent
# with ordinary browser headers.
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}
_MAX_RETRIES = 2
_RETRY_DELAY = 0.7  # seconds
_client: httpx.AsyncClient | None = None

_cache: dict[str, tuple[str | None, float]] = {}
_CACHE_TTL_HIT = 24 * 3600
_CACHE_TTL_MISS = 3600

# Some films are listed on the site as "<title>. Фильм" (e.g. "Боец. Фильм")
# and don't show up when searching by the bare title — see _fetch_watch_page_url.
_TITLE_LABELS = ("Фильм",)
_LABEL_SUFFIX_RE = re.compile(r"\.\s*(?:%s)\s*$" % "|".join(map(re.escape, _TITLE_LABELS)), re.I)

# .../<category-slug>/<numeric-id>-<title-slug>.html — matches kinogo.my,
# kinogo.co, kinogo.cc, and similar DLE-engine sites' article URLs.
_PAGE_LINK_RE = re.compile(r'href="(https?://{domain}/[a-z0-9\-]+/\d+-[a-z0-9\-]+\.html)"', re.I)

_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _translit(text: str) -> str:
    return "".join(_TRANSLIT.get(ch, ch) for ch in text.lower())


# Sites transliterate differently (ц -> c / ts, ю -> yu / ju / iu, я -> ya / ja ...),
# so both the slug and our own transliteration are reduced to one rough key
# before comparing; only used for matching, never shown anywhere.
_KEY_REPLACEMENTS = (
    ("shch", "sh"), ("sch", "sh"), ("tch", "ch"), ("ts", "c"), ("kh", "h"),
    ("yu", "u"), ("ju", "u"), ("iu", "u"), ("ya", "a"), ("ja", "a"), ("ia", "a"),
    ("yo", "o"), ("jo", "o"), ("ye", "e"), ("je", "e"), ("y", "i"), ("j", "i"),
)


def _key(word: str) -> str:
    for old, new in _KEY_REPLACEMENTS:
        word = word.replace(old, new)
    return word


def _slug_words(url: str) -> set[str]:
    """Extract the word tokens from a page URL's slug, e.g.
    ".../films/52629-djuna-chast-tretja.html" -> {"djuna", "chast", "tretja"}
    (the numeric id is dropped, it's never part of the title)."""
    slug = url.rsplit("/", 1)[-1].removesuffix(".html")
    slug = re.sub(r"^\d+-", "", slug)  # strip leading numeric id
    return {_key(w) for w in slug.split("-") if w}


def _title_words(title: str) -> set[str]:
    translit = _translit(title)
    return {_key(w) for w in re.split(r"[^a-z0-9]+", translit) if len(w) > 1}


def _best_link(urls: list[str], title: str) -> str | None:
    """Pick the URL whose slug shares the most words with the transliterated
    title, instead of trusting the site's own result ordering."""
    if not urls:
        return None
    wanted = _title_words(title)
    if not wanted:
        return urls[0]

    def score(url: str) -> float:
        overlap = len(wanted & _slug_words(url))
        return overlap / len(wanted)

    best = max(urls, key=score)
    # Требуем хотя бы половину слов названия — иначе это, скорее всего,
    # вообще другой тайтл, и лучше вернуть generic-ссылку на поиск.
    return best if score(best) >= 0.5 else None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            headers=_BROWSER_HEADERS,
            follow_redirects=True,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def find_watch_page_url(title: str) -> str | None:
    """Search the configured site for `title` and return the URL of the
    best-matching result (by slug word overlap, not site relevance order),
    or None if no template is configured, the site couldn't be reached, or
    nothing matched well enough. Results (including misses) are cached in
    memory for a while — see _CACHE_TTL_HIT / _CACHE_TTL_MISS."""
    key = title.strip().casefold()
    cached = _cache.get(key)
    if cached is not None:
        result, expires_at = cached
        if time.monotonic() < expires_at:
            return result
        del _cache[key]

    result = await _fetch_watch_page_url(title)
    ttl = _CACHE_TTL_HIT if result else _CACHE_TTL_MISS
    _cache[key] = (result, time.monotonic() + ttl)
    return result


async def _fetch_watch_page_url(title: str) -> str | None:
    """Uncached: always hits the site.

    Searches by the plain title first. If that finds no matching page, retries
    as "<title>. Фильм": the site lists some films under that label and its
    search doesn't find them by the bare title. If the site is unreachable we
    stop right away instead of retrying with the label.
    """
    template = settings.WATCH_LINK_TEMPLATE
    if not template:
        return None

    queries = [title]
    if not _LABEL_SUFFIX_RE.search(title):
        queries += [f"{title.strip()}. {label}" for label in _TITLE_LABELS]

    for query in queries:
        resp = await _fetch_search_page(template, query)
        if resp is None:
            return None
        url = _pick_page_url(resp, title)
        if url:
            if query != title:
                logger.info("find_watch_page_url: %r found via label query %r", title, query)
            return url
    return None


async def _fetch_search_page(template: str, query: str) -> httpx.Response | None:
    """GET the site's search page for `query`, with retries; None on failure."""
    search_url = template.format(query=quote_plus(query))
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = await _get_client().get(search_url)
            resp.raise_for_status()
            return resp
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            if attempt == _MAX_RETRIES:
                logger.warning("find_watch_page_url: request failed for %r after %d attempts: %s",
                                query, attempt, e)
                return None
            logger.info("find_watch_page_url: attempt %d failed for %r (%s), retrying…",
                        attempt, query, e)
            await asyncio.sleep(_RETRY_DELAY)
    return None


def _pick_page_url(resp: httpx.Response, title: str) -> str | None:
    """Best title page among the links on a search-results page."""
    # Сайт может редиректить на другое зеркало (например kinogo.my -> kinogomy.net) —
    # берём домен из ФИНАЛЬНОГО URL (resp.url), а не из исходного запроса,
    # иначе регулярка ищет ссылки не того домена и ничего не находит.
    domain = resp.url.host
    if not domain:
        return None

    pattern = re.compile(_PAGE_LINK_RE.pattern.format(domain=re.escape(domain)), re.I)
    candidates = pattern.findall(resp.text)
    seen = list(dict.fromkeys(candidates))
    best = _best_link(seen, title)
    if best is None:
        logger.info("find_watch_page_url: no match for %r among %d page links on %s, e.g. %s",
                    title, len(seen), domain, [u.rsplit("/", 1)[-1] for u in seen[:5]])
    return best
