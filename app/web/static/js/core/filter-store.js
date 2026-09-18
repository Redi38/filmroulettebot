import { getLSJSON, setLSJSON } from "./storage.js";

// A tiny persisted key/value store for one screen's filter panel.
//
// Every filter surface used to hand-roll this: showcase/filters.js had
// loadShowcaseFilters/saveShowcaseFilters with a hardcoded two-field
// shape, while theaters.js kept two separate single-string localStorage
// keys and a module-level `let` for each. One store per panel instead,
// created from a defaults object that also doubles as the schema, so
// adding a filter to a screen is one line rather than a load/save pair
// and a variable to keep in sync.
//
// Unknown keys from an older build's saved state are dropped on load, and
// a value that's no longer one of the allowed options falls back to the
// default — so shipping a changed option set never leaves someone stuck
// with a filter they can't see or clear.
export function createFilterStore(storageKey, defaults, options = {}) {
  const allowed = options.allowed || {};
  const saved = getLSJSON(storageKey, null) || {};
  const state = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = saved[key];
    if (Array.isArray(fallback)) {
      state[key] = Array.isArray(value) ? value.filter((v) => typeof v === "string") : [...fallback];
    } else if (value === undefined || value === null || typeof value !== typeof fallback) {
      state[key] = fallback;
    } else if (allowed[key] && !allowed[key].includes(value)) {
      state[key] = fallback;
    } else {
      state[key] = value;
    }
  }

  function save() {
    setLSJSON(storageKey, state);
  }

  function isDefault(key) {
    const fallback = defaults[key];
    if (Array.isArray(fallback)) return state[key].length === fallback.length;
    return state[key] === fallback;
  }

  return {
    get: (key) => state[key],
    all: () => ({...state}),
    set(key, value) {
      if (state[key] === value) return false;
      state[key] = value;
      save();
      return true;
    },
    // Multi-select helper: flips one value in an array-valued filter.
    // Nothing uses an array-valued filter today, but the store's schema
    // handling already has to cope with arrays (see the load loop above),
    // so the matching mutator stays here rather than being half-supported.
    toggleIn(key, value) {
      const list = state[key];
      const at = list.indexOf(value);
      if (at === -1) list.push(value);
      else list.splice(at, 1);
      save();
      return true;
    },
    clear(key) {
      const fallback = defaults[key];
      state[key] = Array.isArray(fallback) ? [...fallback] : fallback;
      save();
    },
    reset() {
      for (const [key, fallback] of Object.entries(defaults)) {
        state[key] = Array.isArray(fallback) ? [...fallback] : fallback;
      }
      save();
    },
    isDefault,
    // How many filters are set to something other than their default —
    // drives the "Фильтры · 2" badge on the collapsed mobile panel, which
    // is the only hint that a screen is showing a narrowed list.
    activeCount(keys) {
      return (keys || Object.keys(defaults)).filter((k) => !isDefault(k)).length;
    },
  };
}
