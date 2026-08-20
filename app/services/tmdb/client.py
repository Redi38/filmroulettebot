"""Low-level async HTTP client for the TMDb API: connection reuse plus
retry/backoff on transient failures. All other tmdb_pkg modules call
through `_get` here instead of touching httpx directly."""
from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.themoviedb.org/3"
_KEY = settings.TMDB_API_KEY

_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0  # seconds
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10)
    return _client


async def close_client() -> None:
    """Close the shared client on bot shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _get(path: str, **params: Any) -> dict[str, Any] | None:
    params["api_key"] = _KEY
    params.setdefault("language", "ru-RU")
    url = f"{BASE_URL}{path}"

    client = _get_client()
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = await client.get(url, params=params)

            if resp.status_code in _RETRYABLE_STATUSES and attempt < _MAX_RETRIES:
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else _BACKOFF_BASE * (2 ** (attempt - 1))
                delay += random.uniform(0, 0.5)
                logger.warning(
                    "TMDb %s returned %s (attempt %s/%s), retrying in %.1fs",
                    path, resp.status_code, attempt, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue

            resp.raise_for_status()
            return resp.json()

        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt < _MAX_RETRIES:
                delay = _BACKOFF_BASE * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                logger.warning(
                    "TMDb network error on %s (attempt %s/%s): %s",
                    path, attempt, _MAX_RETRIES, exc,
                )
                await asyncio.sleep(delay)
                continue
            logger.warning("TMDb request failed after %s attempts: %s %s – %s", _MAX_RETRIES, path, params, exc)
            return None

        except httpx.HTTPStatusError as exc:
            logger.warning("TMDb request failed: %s %s – %s", path, params, exc)
            return None

        except Exception as exc:
            logger.warning("TMDb request failed: %s %s – %s", path, params, exc)
            return None

    return None
