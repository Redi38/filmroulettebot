"""Small, dependency-free helpers shared by the movie/series/studio
modules: picking the right search result, formatting poster/genre/actor
fields, and normalizing raw TMDb result lists."""
from __future__ import annotations

from typing import Any


def best_match(results: list[dict[str, Any]], query: str, title_field: str = "title") -> dict[str, Any] | None:
    """Pick the most likely correct result instead of blindly trusting results[0].

    TMDb sorts search results by its own relevance score, which is often just
    popularity — a well-known remake or a same-named low-effort title can
    outrank the film the user actually meant. We prefer an exact
    case-insensitive title match (ties broken by popularity), and only fall
    back to "most popular of all results" when nothing matches exactly.
    """
    if not results:
        return None
    q = query.strip().casefold()

    def _titles(r: dict[str, Any]) -> set[str]:
        alt = title_field.replace("title", "original_title") if "title" in title_field else "original_name"
        return {str(r.get(title_field, "")).casefold(), str(r.get(alt, "")).casefold()}

    exact = [r for r in results if q in _titles(r)]
    pool = exact or results
    return max(pool, key=lambda r: r.get("popularity") or 0)


def best_trailer_url(videos: dict) -> str | None:
    results = videos.get("results") or []
    youtube = [v for v in results if v.get("site") == "YouTube"]
    trailers = [v for v in youtube if v.get("type") == "Trailer"]
    pick = next((v for v in trailers if v.get("official")), None) or (trailers[0] if trailers else None)
    if not pick:
        teasers = [v for v in youtube if v.get("type") == "Teaser"]
        pick = teasers[0] if teasers else None
    return f"https://www.youtube.com/watch?v={pick['key']}" if pick else None


def poster(obj: dict) -> str | None:
    path = obj.get("poster_path")
    return f"https://image.tmdb.org/t/p/w500{path}" if path else None


def genres(details: dict) -> str:
    return ", ".join(g["name"] for g in details.get("genres", [])) or "—"


def actors(credits: dict) -> str:
    return ", ".join(a["name"] for a in credits.get("cast", [])[:3]) or "—"


def format_movie_results(results: list[dict]) -> list[dict[str, Any]]:
    """Normalize a raw TMDb movie result list into the shape the web/bot
    layers expect, deduplicating by id and dropping undated entries."""
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for m in results:
        mid = m.get("id")
        if mid is not None:
            if mid in seen:
                continue
            seen.add(mid)
        if not m.get("release_date"):
            continue
        out.append({
            "id": mid,
            "title": m.get("title"),
            "original_title": m.get("original_title") or "",
            "release_date": m.get("release_date") or "",
            "poster_url": poster(m),
            "overview": m.get("overview") or "",
            "rating": round(m["vote_average"], 1) if m.get("vote_average") else "—",
            "is_series": False,
        })
    return out
