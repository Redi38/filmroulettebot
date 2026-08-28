// Shared localStorage get/set wrappers. Centralizes the try/catch-around-
// localStorage pattern that used to be copy-pasted in every file that
// persisted a setting (spin-settings.js, history.js, hub-upload.js,
// state.js, showcase-filters.js).
function getLS(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function setLS(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  } catch {}
}

function removeLS(key) {
  try { localStorage.removeItem(key); } catch {}
}

function getLSJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setLSJSON(key, value) {
  setLS(key, value);
}
