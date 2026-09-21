import { fadeIn, fadeOut } from "./transitions.js";
import { errorHtml } from "./utils.js";

// The three steps every section loader (list, upcoming, showcase, theaters,
// series releases, tracked series) repeats around its own fetch and render.
// Loaders differ in when they fade and what counts as "unchanged" (see
// loadUpcoming and loadHistory, which wait for the data before deciding), so
// this is deliberately a set of small pieces and not one load function.

/**
 * Put `html` (a skeleton) into `el` at full opacity. The opacity write is the
 * point: a container left at 0 by an earlier fadeOut would hide the skeleton.
 * Don't follow this with fadeOut(el) in the same tick — the browser never
 * paints the opacity: 1 frame, so the skeleton stays invisible until the real
 * content arrives.
 */
export function showSkeleton(el, html) {
  el.style.opacity = "1";
  el.innerHTML = html;
}

/**
 * Start a load: on a fresh view show the skeleton and return an already
 * resolved promise (nothing stale to fade out); otherwise start fading the
 * stale content and return the promise for that fade. Await it together with
 * the request, so the fade runs during the round trip instead of after it.
 *
 * @param {HTMLElement} container
 * @param {{fresh: boolean, skeleton: string}} opts
 * @returns {Promise<void>}
 */
export function beginLoad(container, {fresh, skeleton}) {
  if (fresh) {
    showSkeleton(container, skeleton);
    return Promise.resolve();
  }
  return fadeOut(container);
}

/** Replace `container`'s content with the request's error message and fade it in. */
export function showLoadError(container, err) {
  container.innerHTML = errorHtml(err);
  fadeIn(container);
}
