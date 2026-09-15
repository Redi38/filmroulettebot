// @ts-check
/** @typedef {import("../types/api.js").paths} ApiPaths */
/**
 * Response body type for a literal API path present in the generated
 * OpenAPI types (see npm run generate:types / scripts/dump_openapi.py).
 * Falls back to `unknown` for a path with no matching GET/POST 200 JSON
 * response in the schema.
 * @template {keyof ApiPaths} Path
 * @typedef {ApiPaths[Path] extends {get: {responses: {200: {content: {"application/json": infer R}}}}} ? R
 *   : ApiPaths[Path] extends {post: {responses: {200: {content: {"application/json": infer R}}}}} ? R
 *   : unknown} ApiResponseOf
 */

const API_TIMEOUT_MS = 15000;

// GET-only, in-memory SWR-lite cache: repeat navigation to a screen the
// user already has data for (switching list categories back and forth,
// re-opening a showcase tab) reuses that data instead of re-running the
// fetch, so the skeleton that used to flash on every visit only shows up
// the first time. Two windows: within FRESH_MS an entry is served straight
// from memory with no request at all; between FRESH_MS and MAX_AGE_MS it's
// still served immediately (never blocks the caller) but a background
// request quietly refreshes it for whoever asks next. Past MAX_AGE_MS the
// entry is dropped and the next call is a normal network round trip.
const API_CACHE_FRESH_MS = 20000;
const API_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

/** @type {Map<string, {data: any, ts: number}>} */
const _apiCache = new Map();
/** @type {Set<string>} */
const _apiRevalidating = new Set();

class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {boolean} [isTimeout]
   */
  constructor(message, status, isTimeout = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isTimeout = isTimeout;
  }
}

/**
 * The actual network request, with no cache involvement — aborts after
 * API_TIMEOUT_MS, throws an ApiError (`.status` 0 for a client-side
 * timeout) on any non-2xx response or network failure, otherwise resolves
 * with the parsed JSON body. api() below wraps this with the GET cache;
 * call this directly only from within that wrapper.
 *
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function _fetchApi(path, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  const callerSignal = opts && opts.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort());
  }

  /** @type {Response} */
  let resp;
  try {
    resp = await fetch(path, {...opts, signal: controller.signal});
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new ApiError("Сервер не отвечает. Проверь соединение и попробуй ещё раз.", 0, true);
    }
    // The browser throws a bare `TypeError` (message literally "Failed to
    // fetch" in Chrome, "NetworkError when attempting to fetch resource."
    // in Firefox, "Load failed" in Safari) whenever the request never got a
    // response at all — no connection, DNS hiccup, or (the common case
    // here) the server was mid-restart after a deploy/rebuild and dropped
    // the connection. That raw message would otherwise bubble straight up
    // to showToast/handleSpinError and get shown to the user verbatim in
    // English, so translate it into the same kind of friendly message the
    // timeout case gets above.
    if (e instanceof TypeError) {
      throw new ApiError("Не удалось подключиться к серверу. Возможно, сайт сейчас обновляется — подожди немного и попробуй снова.", 0);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({detail: resp.statusText}));
    throw new ApiError(err.detail || "Ошибка запроса", resp.status);
  }
  return resp.json();
}

// Only a plain GET (no explicit method, or "GET", and definitely no body)
// is safe to cache/dedupe — anything else is a mutation and has to reach
// the server every time.
/**
 * @param {RequestInit} [opts]
 * @returns {boolean}
 */
function _isCacheableGet(opts) {
  if (!opts) return true;
  if (opts.body) return false;
  if (opts.method && opts.method.toUpperCase() !== "GET") return false;
  return true;
}

/**
 * @param {string} path
 */
function _revalidateInBackground(path) {
  if (_apiRevalidating.has(path)) return;
  _apiRevalidating.add(path);
  _fetchApi(path)
    .then((data) => _apiCache.set(path, {data, ts: Date.now()}))
    // A background refresh failing (offline blip, timeout) isn't something
    // the user asked for right now — the caller already got an answer from
    // cache. Just leave the stale entry in place for next time.
    .catch(() => {})
    .finally(() => _apiRevalidating.delete(path));
}

/**
 * Typed against api.d.ts whenever `path` is a literal string matching one
 * of the backend's actual OpenAPI paths — e.g. `api("/api/history")` infers
 * its return type straight from the FastAPI route's response model, so a
 * field rename on the backend shows up as a type error here instead of a
 * silent `undefined` at runtime. Endpoints built from a template literal
 * (dynamic category segment, etc.) can't be matched against those literal
 * keys, so those calls need an explicit cast at the call site — see
 * performSequel/performDelete below for the pattern.
 *
 * A successful non-GET call clears the whole cache: it's the simplest way
 * to guarantee "add a title, then reload the list" never serves the list
 * as it was before the add — trading a few discarded-but-still-valid GET
 * entries for never showing genuinely stale data right after a mutation.
 *
 * @template {keyof ApiPaths} Path
 * @param {Path} path
 * @param {RequestInit} [opts]
 * @returns {Promise<ApiResponseOf<Path>>}
 */
async function api(path, opts) {
  const cacheable = _isCacheableGet(opts);
  if (cacheable) {
    const entry = _apiCache.get(path);
    if (entry) {
      const age = Date.now() - entry.ts;
      if (age < API_CACHE_FRESH_MS) return entry.data;
      if (age < API_CACHE_MAX_AGE_MS) {
        _revalidateInBackground(path);
        return entry.data;
      }
      _apiCache.delete(path);
    }
  }

  const data = await _fetchApi(path, opts);
  if (cacheable) {
    _apiCache.set(path, {data, ts: Date.now()});
  } else {
    _apiCache.clear();
  }
  return data;
}

/**
 * @param {string} category
 * @param {string} title
 * @returns {Promise<string>}
 */
async function performSequel(category, title) {
  // `category` is only known at runtime, so the built path can't be checked
  // against ApiPaths's literal keys — cast the *call* to `any` (bypassing
  // the generic's literal-key constraint) and the *result* to the response
  // shape of the matching literal route, /api/{cat}/sequel, so the return
  // type is still real instead of `any`.
  const r = /** @type {ApiResponseOf<"/api/{cat}/sequel">} */ (
    await api(/** @type {any} */ (`/api/${category}/sequel`), {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title}),
    })
  );
  // The route declares response_model=SequelResponse, so `new_title` is a
  // real `string` in api.d.ts — no cast needed.
  return r.new_title;
}

/**
 * @param {string} category
 * @param {string} title
 * @returns {Promise<void>}
 */
async function performDelete(category, title) {
  await api(/** @type {any} */ (`/api/${category}/delete-by-title`), {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({title}),
  });
}
