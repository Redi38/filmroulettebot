"""watch_link: retry the site search as "<title>. Фильм" when the plain title finds nothing."""
from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.services import watch_link

TEMPLATE = "https://kinogo.test/index.php?do=search&subaction=search&story={query}"


def _page(*slugs: str) -> str:
    return "".join(f'<a href="https://kinogo.test/{s}.html">x</a>' for s in slugs)


class FakeClient:
    def __init__(self, pages: dict[str, str | Exception]):
        self.pages = pages
        self.queries: list[str] = []

    async def get(self, url, **kw):
        from urllib.parse import parse_qs, urlparse
        query = parse_qs(urlparse(url).query)["story"][0]
        self.queries.append(query)
        page = self.pages.get(query, "")
        if isinstance(page, Exception):
            raise page
        return httpx.Response(200, text=page, request=httpx.Request("GET", url))


@pytest.fixture
def site(monkeypatch):
    monkeypatch.setattr(settings, "WATCH_LINK_TEMPLATE", TEMPLATE)
    monkeypatch.setattr(watch_link, "_RETRY_DELAY", 0)
    watch_link._cache.clear()

    def install(pages):
        client = FakeClient(pages)
        monkeypatch.setattr(watch_link, "_get_client", lambda: client)
        return client

    yield install
    watch_link._cache.clear()


async def test_plain_title_found_no_second_request(site):
    client = site({"Боец": _page("films/1-boec")})
    assert await watch_link.find_watch_page_url("Боец") == "https://kinogo.test/films/1-boec.html"
    assert client.queries == ["Боец"]


async def test_falls_back_to_label_query(site):
    client = site({
        "Боец": _page("series/5-legenda-serial", "series/6-halo-serial"),
        "Боец. Фильм": _page("films/7-boec-film"),
    })
    assert await watch_link.find_watch_page_url("Боец") == "https://kinogo.test/films/7-boec-film.html"
    assert client.queries == ["Боец", "Боец. Фильм"]


async def test_none_when_label_finds_nothing(site):
    client = site({"Боец": _page("series/5-legenda-serial"), "Боец. Фильм": _page("films/9-drugoe")})
    assert await watch_link.find_watch_page_url("Боец") is None
    assert client.queries == ["Боец", "Боец. Фильм"]


async def test_no_label_retry_if_title_already_labeled(site):
    client = site({"Боец. Фильм": _page("series/5-legenda-serial")})
    assert await watch_link.find_watch_page_url("Боец. Фильм") is None
    assert client.queries == ["Боец. Фильм"]


async def test_site_down_does_not_retry_with_label(site):
    client = site({"Боец": httpx.ConnectError("down")})
    assert await watch_link.find_watch_page_url("Боец") is None
    assert "Боец. Фильм" not in client.queries
