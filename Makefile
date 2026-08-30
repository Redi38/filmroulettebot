# Convenience targets for local dev, Docker, and running the same checks
# CI runs (.github/workflows/ci.yml) before you push.
#
# Run `make help` (or just `make`) to see what's available.

PYTHON ?= python3
PIP ?= $(PYTHON) -m pip
DC ?= docker compose

.DEFAULT_GOAL := help

.PHONY: help venv install install-dev up web down logs ps \
        ci compile lint typecheck test js-syntax js-install js-build js-watch \
        css-build css-watch clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Local Python env -----------------------------------------------------

venv: ## Create a local virtualenv in ./.venv
	$(PYTHON) -m venv .venv
	@echo "Activate it with: source .venv/bin/activate"

install: ## Install runtime dependencies (requirements/base.txt)
	$(PIP) install -r requirements/base.txt

install-dev: ## Install runtime + test dependencies (requirements/dev.txt)
	$(PIP) install -r requirements/dev.txt

# --- Docker -----------------------------------------------------------

up: ## docker compose up -d --build (bot + web + autoheal)
	$(DC) up -d --build

web: ## docker compose up -d --build web (web service only)
	$(DC) up -d --build web

down: ## docker compose down
	$(DC) down

logs: ## Tail logs for all services
	$(DC) logs -f

ps: ## Show status of the compose services
	$(DC) ps

# --- CI, runnable locally before you push -------------------------------
# Same steps, same order, as .github/workflows/ci.yml's `test` and
# `js-syntax` jobs -- run `make ci` for the full thing, or a target
# below to run just one stage.

ci: compile lint typecheck test js-syntax ## Run every CI stage locally (compile + lint + typecheck + pytest + JS syntax)

compile: ## CI stage: byte-compile the whole project (fast syntax smoke test)
	$(PYTHON) -m compileall -q app main.py

lint: ## CI stage: ruff lint (style, unused imports, import order)
	ruff check app main.py tests

typecheck: ## CI stage: mypy static type checking
	mypy

test: ## CI stage: run the pytest suite
	pytest -v

js-syntax: ## CI stage: node --check every static JS file
	find app/web/static/js -name "*.js" -not -path "*/dist/*" -print0 | xargs -0 -n1 node --check

# --- Frontend JS bundle (esbuild, no framework) ------------------------
# `python main.py` / `uvicorn` serve app/web/static/js/dist/bundle.min.js,
# which is a build artifact (gitignored) — run js-build at least once
# after cloning, and again after editing anything under static/js.
# `make up`/`make web` (Docker) build it automatically; only needed here
# for running the app directly with Python.

js-install: ## Install JS build tooling (esbuild) via npm
	npm install

js-build: ## Bundle+minify app/web/static/js into dist/bundle.min.js
	npm run build:js

js-watch: ## Rebuild the JS bundle on every change (local dev)
	npm run watch:js

# --- Frontend CSS bundle (esbuild, no framework) ------------------------
# `python main.py` / `uvicorn` serve app/web/static/css/dist/bundle.min.css,
# which is a build artifact (gitignored) — run css-build at least once
# after cloning, and again after editing anything under static/css.
# `make up`/`make web` (Docker) build it automatically; only needed here
# for running the app directly with Python. Uses the same npm install as
# js-install, so run that first if you haven't.

css-build: ## Bundle+minify app/web/static/css into dist/bundle.min.css
	npm run build:css

css-watch: ## Rebuild the CSS bundle on every change (local dev)
	npm run watch:css

# --- Housekeeping -----------------------------------------------------

clean: ## Remove caches and test artifacts
	find . -type d -name __pycache__ -not -path "./.git/*" -exec rm -rf {} +
	rm -rf .pytest_cache pytest-report.xml
