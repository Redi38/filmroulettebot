// Entry point. Everything else is pulled in transitively via imports —
// see build-js.mjs. The four `import "./x.js"` lines below have no bindings
// because those modules are pure side effects (DOM wiring run once at load
// time, e.g. mountSpinDocks() / the categories bootstrap fetch): nothing
// else in the app imports a value from them, so without an explicit import
// here esbuild's bundler would drop them from the graph entirely.
import "./bg-dust.js";
import "./bootstrap.js";
import { initRouting } from "./router.js";
import "../spin/spin-dock.js";
import "../card/pick-actions.js";

initRouting();
