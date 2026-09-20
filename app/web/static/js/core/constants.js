// Category and view vocabularies — the single source of truth for every
// label the UI shows in a menu, chip row or the header.

// CATS have their own roulette; REF_CATS are reference-only showcases (no
// spin). LIST_CATS is what the single "Списки" view lets you switch between.
export const CATS = {movies: "Фильмы", cartoons: "Мульты", series: "Сериалы"};
export const REF_CATS = {marvel: "Marvel", dc: "DC"};
export const ALL_CATS = {...CATS, ...REF_CATS};
export const LIST_CATS = {...CATS, ...REF_CATS};

// The roulette is a single view; RANDOM_CAT is the pseudo-category that
// means "pick the category for me too" (POST /api/random-spin).
export const RANDOM_CAT = "random";

export const VIEW_TITLES = {
  home: "Афиша", upcoming: "Ожидаемые",
  theaters: "В прокате", series_releases: "Премьеры сериалов",
  tracked_series: "Отслеживание сериалов",
};

// Header text for a view. The chip row under the header already names the
// selected category, so the header names the screen and only appends the
// category where the screen would otherwise be ambiguous.
export function viewTitleFor(view, cat, spinCatCode) {
  if (view === "spin") {
    return spinCatCode === RANDOM_CAT || !spinCatCode
      ? "Рулетка"
      : `Рулетка — ${CATS[spinCatCode] || ""}`;
  }
  if (view === "list") return `Списки — ${LIST_CATS[cat] || ""}`;
  if (view === "showcase") return `${ALL_CATS[cat] || ""} — скоро`;
  return VIEW_TITLES[view] || "";
}
