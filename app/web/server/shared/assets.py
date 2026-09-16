"""Static-asset versioning for index.html.

The page loads one JS and one CSS bundle. Without a version in their URLs a
browser that cached yesterday's bundle happily runs it against today's API
after a deploy. Rather than teach the build to rewrite index.html (the
Docker image copies index.html from source and only the dist/ folders from
the assets stage), the server stamps a short content hash onto each bundle
URL when it renders the page, and the static middleware in server/__init__
hands out `immutable` cache headers for any dist/ file requested with that
`?v=` query. The build stays a pure "sources in, bundles out" step.

The same render pass inlines js/core/constants.js so the header-title
script that runs before the bundle loads uses the exact same category and
view labels as the app — the two used to be hand-copied and drifted.
"""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

from .constants import STATIC_DIR

INDEX_PATH = STATIC_DIR / "index.html"
CONSTANTS_JS_PATH = STATIC_DIR / "js" / "core" / "constants.js"
BUNDLES = {
    "JS_BUNDLE": STATIC_DIR / "js" / "dist" / "bundle.min.js",
    "CSS_BUNDLE": STATIC_DIR / "css" / "dist" / "bundle.min.css",
}

# (path -> (mtime, size)) -> rendered html. Re-rendered only when one of the
# inputs changes on disk, so dev watch-mode rebuilds are picked up without a
# restart while a production instance does the work once.
_render_cache: tuple[tuple[tuple[str, float, int], ...], str] | None = None


def _stat_key(path: Path) -> tuple[str, float, int]:
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return (str(path), 0.0, -1)
    return (str(path), st.st_mtime, st.st_size)


def asset_version(path: Path) -> str:
    """Short content hash of a file, or "dev" when the bundle has not been
    built yet (running from source without `npm run build`)."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return "dev"
    return hashlib.sha256(data).hexdigest()[:12]


def _inline_constants() -> str:
    try:
        src = CONSTANTS_JS_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""
    src = re.sub(r"^\s*import .*$", "", src, flags=re.MULTILINE)
    src = re.sub(r"^export\s+", "", src, flags=re.MULTILINE)
    return src.replace("</script", "<\\/script")


def render_index_html() -> str:
    global _render_cache
    inputs = (INDEX_PATH, CONSTANTS_JS_PATH, *BUNDLES.values())
    key = tuple(_stat_key(p) for p in inputs)
    if _render_cache and _render_cache[0] == key:
        return _render_cache[1]

    html = INDEX_PATH.read_text(encoding="utf-8")
    for name, path in BUNDLES.items():
        html = html.replace("{{%s_VERSION}}" % name, asset_version(path))
    html = html.replace("{{INLINE_CONSTANTS_JS}}", _inline_constants())
    _render_cache = (key, html)
    return html
