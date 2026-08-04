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
from urllib.parse import quote_plus

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 5  # seconds — this is best-effort, don't hold up the card render
_MAX_RETRIES = 2
_RETRY_DELAY = 0.7  # seconds
_client: httpx.AsyncClient | None = None

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


def _slug_words(url: str) -> set[str]:
    """Extract the word tokens from a page URL's slug, e.g.
    ".../films/52629-djuna-chast-tretja.html" -> {"djuna", "chast", "tretja"}
    (the numeric id is dropped, it's never part of the title)."""
    slug = url.rsplit("/", 1)[-1].removesuffix(".html")
    slug = re.sub(r"^\d+-", "", slug)  # strip leading numeric id
    return {w for w in slug.split("-") if w}


def _title_words(title: str) -> set[str]:
    translit = _translit(title)
    return {w for w in re.split(r"[^a-z0-9]+", translit) if len(w) > 1}


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
    return best if score(best) >= 0.5 else None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0 (compatible; filmroulettebot/1.0)"},
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
    nothing matched well enough."""
    template = settings.WATCH_LINK_TEMPLATE
    if not template:
        return None

    search_url = template.format(query=quote_plus(title))

    resp = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = await _get_client().get(search_url)
            resp.raise_for_status()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            if attempt == _MAX_RETRIES:
                logger.warning("find_watch_page_url: request failed for %r after %d attempts: %s",
                                title, attempt, e)
                return None
            logger.info("find_watch_page_url: attempt %d failed for %r (%s), retrying…",
                        attempt, title, e)
            await asyncio.sleep(_RETRY_DELAY)

    if resp is None:
        return None

    domain = resp.url.host
    if not domain:
        return None

    pattern = re.compile(_PAGE_LINK_RE.pattern.format(domain=re.escape(domain)), re.I)
    candidates = pattern.findall(resp.text)
    seen = dict.fromkeys(candidates)
    return _best_link(list(seen), title)
