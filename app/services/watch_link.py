"""Best-effort resolver for a direct "watch page" URL on the site configured
via WATCH_LINK_TEMPLATE (see app/config.py), instead of linking to a generic
search-results page.

There's no official API for sites like kinogo — this works by fetching the
site's search page and pulling out the first link that looks like a real
title page (…/<category>/<numeric-id>-<slug>.html, the pattern kinogo-family
sites use). If the site's markup doesn't match, or the request fails/times
out, the caller should fall back to the plain search link — this module
never raises for that; it just returns None.
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
    """Search the configured site for `title` and return the direct URL of
    the first result, or None if no template is configured, the site
    couldn't be reached, or nothing matched the expected link pattern."""
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
    match = pattern.search(resp.text)
    return match.group(1) if match else None
