// Day-by-day grouping for the release calendars (the studio showcase, the
// theaters tab and the series-premieres tab).
//
// Each of those screens is a calendar, but a flat list hides the thing a
// calendar is for: theatrical releases cluster hard on Thursdays and
// Fridays, streaming premieres on Wednesdays, and reading that off a
// column of individual dates takes real effort. The "По дням" toggle
// buckets the rows under a heading per release day instead.

const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
  "августа", "сентября", "октября", "ноября", "декабря"];
const RU_WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Heading for a day bucket: "Сегодня" / "Завтра" / "Вчера" for the three
// dates a reader shouldn't have to decode, "пт, 25 сентября" otherwise.
// The weekday is the whole point of the grouping, so it always leads.
export function dayHeading(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = startOfToday();
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  if (diff === -1) return "Вчера";
  const weekday = RU_WEEKDAYS_SHORT[d.getDay()];
  const base = `${weekday}, ${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

// [[heading, items], ...], always running from the earliest date to the
// latest — regardless of how the section itself is ordered.
//
// The sections disagree about direction on purpose: "уже вышло" and
// "сейчас в прокате" read newest-first, everything upcoming reads
// soonest-first. Inheriting that here meant the day view started at
// whichever end the section happened to use, so switching the toggle on
// two neighbouring columns produced calendars running opposite ways. A
// calendar should always read forwards, so this sorts rather than
// following the incoming order. Undated rows (rare, but TMDb does hand
// back the odd entry with an empty release_date) collect in one bucket at
// the very end instead of sorting to the top as an empty string would.
export function groupByDay(items) {
  const byDate = new Map();
  for (const item of items) {
    const date = item.release_date || "";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    })
    .map(([date, group]) => [date ? dayHeading(date) : "Без даты", group]);
}
