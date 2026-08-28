# --- JS bundle stage ---------------------------------------------------
# Concatenates + minifies app/web/static/js/**/*.js (per manifest.json)
# into one file with esbuild. Node is only needed here, not at runtime.
FROM node:22-slim AS js-build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY scripts/build-js.mjs scripts/build-js.mjs
COPY app/web/static/js app/web/static/js
RUN npm run build:js

# --- App image -----------------------------------------------------------
FROM python:3.14-slim

WORKDIR /app

# Install deps
COPY requirements/base.txt requirements/base.txt
RUN pip install --no-cache-dir -r requirements/base.txt

# Copy source
COPY . .
# Bring in the bundle built above (overwrites the source-only js/ copy's
# dist/ dir, which isn't committed to the repo).
COPY --from=js-build /app/app/web/static/js/dist app/web/static/js/dist

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "\
import os, sys, time; \
f = '/tmp/bot_heartbeat'; \
sys.exit(0 if os.path.exists(f) and time.time() - os.path.getmtime(f) < 90 else 1)"

# Run
CMD ["python", "main.py"]
