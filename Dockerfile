FROM node:22-slim AS js-build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm install
COPY scripts/build-js.mjs scripts/build-js.mjs
COPY app/web/static/js app/web/static/js
RUN npm run build:js

FROM python:3.14-slim AS base

WORKDIR /app

COPY requirements/base.txt requirements/base.txt
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements/base.txt

COPY app/ app/
COPY main.py main.py

FROM base AS bot

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python3 -c "\
import os, sys, time; \
f = '/tmp/bot_heartbeat'; \
sys.exit(0 if os.path.exists(f) and time.time() - os.path.getmtime(f) < 90 else 1)"

CMD ["python", "main.py"]

FROM base AS web

COPY --from=js-build /app/app/web/static/js/dist app/web/static/js/dist

CMD ["uvicorn", "app.web.server:app", "--host", "0.0.0.0", "--port", "8000"]
