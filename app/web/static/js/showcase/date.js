// Builds the secondary line under a showcase card's title: release date,
// "new season" / "airing now" badges, or a status message for tracked
// series. Split out of row.js — this ternary chain was the least
// readable part of that file and is easiest to reason about on its own.
//
// Raw dates ("2026-08-27") are hard to scan at a glance, so every date
// that reaches this line is run through humanizeShowcaseDate() first:
// close dates collapse to a short badge word ("Сегодня", "Завтра",
// "На этой неделе"), everything else becomes "27 авг · через 6 дней".

const RU_MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function ruDaysWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function ruMonthsWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "месяцев";
  if (last === 1) return "месяц";
  if (last >= 2 && last <= 4) return "месяца";
  return "месяцев";
}

function ruYearsWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "лет";
  if (last === 1) return "год";
  if (last >= 2 && last <= 4) return "года";
  return "лет";
}

function mondayOf(d) {
  const monday = new Date(d);
  const day = d.getDay();
  monday.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Calendar-accurate years/months/days between two dates (to must be >= from).
// Plain day-division (diffDays / 365) drifts on leap years and gives ugly
// numbers like "601 дней"; walking the calendar fields instead gives exact,
// readable spans ("1 год 7 месяцев").
function ymdSpan(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return {years, months, days};
}

// dateStr: "YYYY-MM-DD". Returns the original string unchanged if it can't
// be parsed, so unexpected formats degrade gracefully instead of breaking.
// withSpan=false drops the trailing "· через X" / "· X назад" part, leaving
// just the short date (or the Сегодня/Завтра/На этой неделе badges) — used
// for plain release dates where "29 лет 6 месяцев назад" isn't useful.
function humanizeShowcaseDate(dateStr, withSpan = true) {
  if (!dateStr) return dateStr;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  const short = d.getFullYear() !== today.getFullYear()
    ? `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
    : `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]}`;

  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Завтра";
  if (diffDays === -1) return "Вчера";
  if (diffDays > 0 && diffDays < 7 && mondayOf(d).getTime() === mondayOf(today).getTime()) {
    return "На этой неделе";
  }

  const future = diffDays > 0;
  if (!withSpan) return short;

  const {years, months, days} = future ? ymdSpan(today, d) : ymdSpan(d, today);
  let span;
  if (years >= 1) {
    span = months > 0 ? `${years} ${ruYearsWord(years)} ${months} ${ruMonthsWord(months)}` : `${years} ${ruYearsWord(years)}`;
  } else if (months >= 1) {
    span = `${months} ${ruMonthsWord(months)}`;
  } else {
    span = `${days} ${ruDaysWord(days)}`;
  }
  return future ? `${short} · через ${span}` : `${short} · ${span} назад`;
}

function showcaseDateLine(item, cat, isNewSeasons, addMode) {
  if (addMode === "tracked-series") {
    if (item.status === "not_found") return "⚠️ Не найдено на TMDb";
    if (item.status === "no_upcoming") return "Нет анонса нового сезона";
    if (item.is_new_season) return `🆕 Новый сезон — ${humanizeShowcaseDate(item.release_date)}`;
    if (item.airing_now) return `📅 Сезон выходит — финал ${humanizeShowcaseDate(item.release_date)}`;
    return humanizeShowcaseDate(item.release_date);
  }
  if (isNewSeasons && item.next_season) {
    return item.airing_now
      ? `📅 Сезон ${item.next_season.season_number} выходит — финал ${humanizeShowcaseDate(item.season_finale_date)}`
      : `Сезон ${item.next_season.season_number} — ${humanizeShowcaseDate(item.next_season.air_date)}`;
  }
  if (item.is_new_season) return `🆕 Новый сезон — ${humanizeShowcaseDate(item.release_date)}`;
  if (item.airing_now) return `📅 Сезон выходит — финал ${humanizeShowcaseDate(item.release_date)}`;
  if (addMode === "now-playing" && item.digitally_released) return `${humanizeShowcaseDate(item.release_date, false)} · 📀 уже в цифре`;
  return humanizeShowcaseDate(item.release_date, false);
}
