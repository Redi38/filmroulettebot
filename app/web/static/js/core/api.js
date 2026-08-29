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
 * Thin fetch wrapper: aborts after API_TIMEOUT_MS, throws an ApiError
 * (`.status` 0 for a client-side timeout) on any non-2xx response or
 * network failure, otherwise resolves with the parsed JSON body.
 *
 * Typed against api.d.ts whenever `path` is a literal string matching one
 * of the backend's actual OpenAPI paths — e.g. `api("/api/history")` infers
 * its return type straight from the FastAPI route's response model, so a
 * field rename on the backend shows up as a type error here instead of a
 * silent `undefined` at runtime. Endpoints built from a template literal
 * (dynamic category segment, etc.) can't be matched against those literal
 * keys, so those calls need an explicit cast at the call site — see
 * performSequel/performDelete below for the pattern.
 *
 * @template {keyof ApiPaths} Path
 * @param {Path} path
 * @param {RequestInit} [opts]
 * @returns {Promise<ApiResponseOf<Path>>}
 */
async function api(path, opts) {
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
  // This route has no `response_model` on the backend (app/web/server/routes_core.py),
  // so OpenAPI has no schema for its body and ApiResponseOf falls back to an
  // untyped dict — hence the manual cast here. Adding a response_model there
  // (e.g. a small `SequelResponse(BaseModel): new_title: str`) would let
  // ApiResponseOf infer `new_title: string` for real, removing this cast.
  return /** @type {string} */ (r.new_title);
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
