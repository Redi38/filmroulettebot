"""Dump the FastAPI app's OpenAPI schema to scripts/openapi.json.

Used as the source for scripts/generate-types.mjs (openapi-typescript),
so the frontend's JSDoc-typed api() calls stay in sync with the actual
Pydantic request/response models — no server needs to be running, this
imports the app object directly.

Run: python3 scripts/dump_openapi.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Make `app` importable regardless of cwd (mirrors how pytest's rootdir
# config does this for tests/conftest.py).
sys.path.insert(0, str(Path(__file__).parent.parent))

# Same pattern as tests/conftest.py: Settings() requires these with no
# defaults, and is constructed once at import time, so they must be set
# before anything imports app.config for the first time. Dummy values are
# fine here — we only need the schema, never a live TMDb/Telegram call.
os.environ.setdefault("TOKEN", "schema-dump-token")
os.environ.setdefault("TMDB_API_KEY", "schema-dump-key")

from app.web.server import app  # noqa: E402  (must follow the env setdefault above)

OUT_PATH = Path(__file__).parent / "openapi.json"


def main() -> None:
    schema = app.openapi()
    OUT_PATH.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[dump-openapi] wrote {OUT_PATH} ({len(schema.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
