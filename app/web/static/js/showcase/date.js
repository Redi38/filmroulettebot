// Builds the secondary line under a showcase card's title: release date,
// "new season" / "airing now" badges, or a status message for tracked
// series. Split out of row.js — this ternary chain was the least
// readable part of that file and is easiest to reason about on its own.

function showcaseDateLine(item, cat, isNewSeasons, addMode) {
  if (addMode === "tracked-series") {
    if (item.status === "not_found") return "⚠️ Не найдено на TMDb";
    if (item.status === "no_upcoming") return "Нет анонса нового сезона";
    if (item.is_new_season) return `🆕 Новый сезон — ${item.release_date}`;
    if (item.airing_now) return `📅 Сезон выходит — финал ${item.release_date}`;
    return item.release_date;
  }
  if (isNewSeasons && item.next_season) {
    return item.airing_now
      ? `📅 Сезон ${item.next_season.season_number} выходит — финал ${item.season_finale_date}`
      : `Сезон ${item.next_season.season_number} — ${item.next_season.air_date}`;
  }
  if (item.is_new_season) return `🆕 Новый сезон — ${item.release_date}`;
  if (item.airing_now) return `📅 Сезон выходит — финал ${item.release_date}`;
  if (addMode === "now-playing" && item.digitally_released) return `${item.release_date} · 📀 уже в цифре`;
  return item.release_date;
}
