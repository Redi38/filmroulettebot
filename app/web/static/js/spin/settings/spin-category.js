// ---- roulette category ("Наугад" / Фильмы / Сериалы / …) ------------------
//
// Replaces what used to be four separate menu entries and two separate spin
// screens. "Наугад" keeps the old random-across-categories behaviour
// (POST /api/random-spin, with the little category pre-spin animation);
// anything else spins that one list.
function spinCatOptions() {
  return [
    [RANDOM_CAT, "Рандом"],
    ...spinnableCats().map((code) => [code, CATS[code] || code]),
  ];
}

// A dropdown rather than a pill row: the dock is a narrow fixed column on
// desktop, and four or five pills do not fit across it.
function renderSpinCatChips() {
  renderCatSelect("spin-cat-select", {
    options: spinCatOptions(),
    value: spinCat,
    label: "Категория рулетки",
    onChange: (code) => switchSpinCat(code),
  });
}

// Shared by showSection(), switchSpinCat() and the spin-mode toggle so the
// empty-state copy always matches the category that is actually selected.
function resetSpinResult() {
  const el = document.getElementById("spin-result");
  if (!el) return;
  el.innerHTML = placeholderHtml(
    isRandomSpin()
      ? "Нажми «Крутить», и рулетка сама выберет категорию и тайтл 🍿"
      : `Нажми «Крутить», чтобы узнать, что посмотреть 🎬`,
  );
}
