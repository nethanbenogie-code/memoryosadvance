/**
 * MemoryOS — services/time-query-service.js
 *
 * Turns the time and kind expressions people actually type ("last June",
 * "yesterday", "my notes from last week", "in 2024") into a concrete date
 * range and an optional type filter, so the assistant can fetch exactly
 * the right slice of the database instead of guessing from recent items.
 *
 * Pure and deterministic — no I/O, no DB, no model. That makes it work
 * identically for the cloud and offline providers, and easy to unit-test.
 * All bounds are built from LOCAL midnight (matching journal-service's
 * dayBounds) and returned as ISO strings, half-open [startIso, endIso).
 */

import { MemoryType } from "../data/models.js";

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};
const MONTH_NAMES = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];

function startOfDay(y, m0, d) { return new Date(y, m0, d, 0, 0, 0, 0); }
function iso(date) { return date.toISOString(); }

function range(startDate, endDateExclusive, label) {
  return { startIso: iso(startDate), endIso: iso(endDateExclusive), label };
}

function fmtDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Resolve a month name (no year given) to the most sensible year.
 * Bare "June" → the most recent June that has already begun (this year if
 * that month has started, else last year). "last June" forces the prior
 * occurrence when it would otherwise resolve to the current month.
 */
function resolveMonthYear(month0, now, isLast) {
  const curY = now.getFullYear();
  const curM = now.getMonth();
  let year = curY;
  if (month0 > curM) year = curY - 1;          // hasn't happened yet this year
  else if (month0 === curM && isLast) year = curY - 1; // "last June" in June
  return year;
}

/**
 * Parse a time period from free text.
 * @param {string} text
 * @param {Date} [now]
 * @returns {{startIso:string, endIso:string, label:string} | null}
 */
export function parsePeriod(text, now = new Date()) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const todayStart = startOfDay(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  // ISO date: 2026-06-12
  const isoM = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoM) {
    const y = +isoM[1], m0 = +isoM[2] - 1, d = +isoM[3];
    const s = startOfDay(y, m0, d);
    return range(s, startOfDay(y, m0, d + 1), fmtDay(s));
  }

  // today / yesterday / tomorrow
  if (/\btoday\b/.test(t)) return range(todayStart, tomorrowStart, "today (" + fmtDay(todayStart) + ")");
  if (/\byesterday\b/.test(t)) {
    const y = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return range(y, todayStart, "yesterday (" + fmtDay(y) + ")");
  }
  if (/\btomorrow\b/.test(t)) {
    const dayAfter = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    return range(tomorrowStart, dayAfter, "tomorrow (" + fmtDay(tomorrowStart) + ")");
  }

  // this / last week (Monday-based)
  const dow = now.getDay();                  // 0 Sun … 6 Sat
  const fromMonday = (dow + 6) % 7;
  const thisWeekStart = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday);
  const nextWeekStart = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday + 7);
  if (/\bthis week\b/.test(t))
    return range(thisWeekStart, nextWeekStart, `this week (${fmtDay(thisWeekStart)} – ${fmtDay(startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday + 6))})`);
  if (/\blast week\b/.test(t)) {
    const lastWeekStart = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday - 7);
    return range(lastWeekStart, thisWeekStart, `last week (${fmtDay(lastWeekStart)} – ${fmtDay(startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday - 1))})`);
  }

  // this / last month
  if (/\bthis month\b/.test(t)) {
    const s = startOfDay(now.getFullYear(), now.getMonth(), 1);
    return range(s, startOfDay(now.getFullYear(), now.getMonth() + 1, 1), `this month (${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()})`);
  }
  if (/\blast month\b/.test(t)) {
    const s = startOfDay(now.getFullYear(), now.getMonth() - 1, 1);
    const e = startOfDay(now.getFullYear(), now.getMonth(), 1);
    return range(s, e, `last month (${MONTH_NAMES[s.getMonth()]} ${s.getFullYear()})`);
  }

  // this / last year
  if (/\bthis year\b/.test(t))
    return range(startOfDay(now.getFullYear(), 0, 1), startOfDay(now.getFullYear() + 1, 0, 1), `this year (${now.getFullYear()})`);
  if (/\blast year\b/.test(t))
    return range(startOfDay(now.getFullYear() - 1, 0, 1), startOfDay(now.getFullYear(), 0, 1), `last year (${now.getFullYear() - 1})`);

  // past/last N days | weeks | months
  const nUnit = t.match(/\b(?:past|last)\s+(\d{1,3})\s+(day|week|month)s?\b/);
  if (nUnit) {
    const n = +nUnit[1], unit = nUnit[2];
    let s;
    if (unit === "day") s = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1));
    else if (unit === "week") s = startOfDay(now.getFullYear(), now.getMonth(), now.getDate() - 7 * n + 1);
    else s = startOfDay(now.getFullYear(), now.getMonth() - n, now.getDate());
    return range(s, tomorrowStart, `the last ${n} ${unit}${n > 1 ? "s" : ""}`);
  }

  // <month> <day>, <year>   |  <month> <day>  |  <month> <year>  |  (last) <month>
  const monthAlt = Object.keys(MONTHS).join("|");
  const mWithDayYear = t.match(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (mWithDayYear) {
    const m0 = MONTHS[mWithDayYear[1]];
    const d = +mWithDayYear[2];
    const y = mWithDayYear[3] ? +mWithDayYear[3] : resolveMonthYear(m0, now, /\blast\b/.test(t));
    const s = startOfDay(y, m0, d);
    return range(s, startOfDay(y, m0, d + 1), fmtDay(s));
  }
  const mWithYear = t.match(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{4})\\b`));
  if (mWithYear) {
    const m0 = MONTHS[mWithYear[1]], y = +mWithYear[2];
    return range(startOfDay(y, m0, 1), startOfDay(y, m0 + 1, 1), `${MONTH_NAMES[m0]} ${y}`);
  }
  const mAlone = t.match(new RegExp(`\\b(?:(last|this)\\s+)?(${monthAlt})\\b`));
  if (mAlone) {
    const m0 = MONTHS[mAlone[2]];
    const wantsLast = mAlone[1] === "last";
    const y = resolveMonthYear(m0, now, wantsLast);
    return range(startOfDay(y, m0, 1), startOfDay(y, m0 + 1, 1), `${MONTH_NAMES[m0]} ${y}`);
  }

  // bare year: 2024 / in 2023
  const yM = t.match(/\b(20\d{2})\b/);
  if (yM) {
    const y = +yM[1];
    return range(startOfDay(y, 0, 1), startOfDay(y + 1, 0, 1), `${y}`);
  }

  return null;
}

/**
 * Detect which kinds of memory the user is asking about. Returns an array
 * of MemoryType values, or null when the question isn't kind-specific (in
 * which case everything in the range is fair game).
 * @param {string} text
 * @returns {string[] | null}
 */
export function parseTypeFilters(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const types = new Set();
  if (/\bjournal/.test(t)) types.add(MemoryType.JOURNAL);
  if (/\bnote/.test(t)) { types.add(MemoryType.NOTE); types.add(MemoryType.IDEA); }
  if (/\bidea/.test(t)) types.add(MemoryType.IDEA);
  if (/\btask|to-?do/.test(t)) types.add(MemoryType.TASK);
  if (/memory card/.test(t)) types.add(MemoryType.MEMORY_CARD);
  if (/\barticle|saved read|saved article/.test(t)) types.add(MemoryType.ARTICLE);
  if (/\blearn|\bbook\b|\bstudied?\b/.test(t)) types.add(MemoryType.LEARNING);
  if (/\bevent\b|\bmeeting\b/.test(t)) { types.add(MemoryType.EVENT); types.add(MemoryType.MEETING); }
  return types.size ? [...types] : null;
}

/** Human label for a set of type filters, for echoing back in context. */
export function typeFilterLabel(types) {
  if (!types || !types.length) return "memories";
  const names = { [MemoryType.JOURNAL]: "journal entries", [MemoryType.NOTE]: "notes",
    [MemoryType.IDEA]: "ideas", [MemoryType.TASK]: "tasks", [MemoryType.MEMORY_CARD]: "Memory Cards",
    [MemoryType.ARTICLE]: "saved articles", [MemoryType.LEARNING]: "learning records",
    [MemoryType.EVENT]: "events", [MemoryType.MEETING]: "meetings" };
  const labels = [...new Set(types.map(t => names[t] || t))];
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
}
