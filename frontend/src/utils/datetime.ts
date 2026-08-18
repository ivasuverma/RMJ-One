// Every timestamp the backend sends is a UTC ISO-8601 string (see
// backend/server.py's now_utc()/isoformat()) — the shop runs in exactly one
// timezone, India (UTC+5:30, no DST), so converting for display is always
// the same fixed offset. We do that with plain arithmetic instead of
// dayjs/Intl timezone data: React Native's Hermes engine doesn't reliably
// ship full ICU timezone tables, so `Intl.DateTimeFormat(..., { timeZone })`
// or `dayjs.tz()` can silently misbehave on some devices. Shifting the
// timestamp by the offset and reading it back with the UTC getters sidesteps
// that entirely and needs no timezone database.
//
// Before this utility existed, screens across the app called
// `someIsoString.slice(0, 10)` / `.slice(11, 16)` directly on the raw UTC
// string, or used `new Date().toISOString().slice(0, 10)` for "today" —
// both silently wrong by up to 5.5 hours, and wrong about the calendar day
// itself between 00:00-05:29 IST. Use these helpers instead, everywhere a
// backend timestamp is displayed or a "today" needs computing on the client.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

function shiftToIST(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS);
}

/** 'YYYY-MM-DD' in IST, from a UTC ISO timestamp. */
export function istDate(iso?: string | null): string {
  const d = shiftToIST(iso);
  if (!d) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'HH:mm' (24h) in IST, from a UTC ISO timestamp. */
export function istTime(iso?: string | null): string {
  const d = shiftToIST(iso);
  if (!d) return '';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD HH:mm' in IST, from a UTC ISO timestamp. */
export function istDateTime(iso?: string | null): string {
  if (!iso) return '';
  return `${istDate(iso)} ${istTime(iso)}`;
}

/** 'D Mon YYYY' in IST — for the more human-friendly display spots. */
export function istDisplayDate(iso?: string | null): string {
  const d = shiftToIST(iso);
  if (!d) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 'D Mon YYYY, HH:mm' in IST — human-friendly date plus a 24h time. */
export function istDisplayDateTime(iso?: string | null): string {
  const d = shiftToIST(iso);
  if (!d) return '';
  return `${istDisplayDate(iso)}, ${istTime(iso)}`;
}

/**
 * Format a Date object using its *local* (device) Y/M/D components as
 * 'YYYY-MM-DD' — for stepping through a plain calendar date (e.g. a
 * date-picker's "next/prev day"), where the arithmetic and the read-back
 * both happen in the same local frame. Deliberately does NOT go through
 * toISOString()/UTC, which would silently shift the date near midnight.
 * Same convention DateField.tsx already uses internally.
 */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** IST calendar date, `days` away from right now (negative = past, positive = future), as 'YYYY-MM-DD'. */
export function shiftedISTDate(days: number): string {
  return istDate(new Date(Date.now() + days * 86400000).toISOString());
}

/**
 * Today's date in IST as 'YYYY-MM-DD' — the frontend equivalent of the
 * backend's today_str(). Replaces every `new Date().toISOString().slice(0,10)`
 * call, which computes "today" in UTC and is wrong for roughly 5.5 hours
 * every night IST.
 */
export function todayIST(): string {
  return shiftedISTDate(0);
}

/**
 * Right-now, in IST, as e.g. 'Tuesday, 18 August' — for header-style
 * greetings ("today is..."). Pinned to IST explicitly rather than the
 * device's own clock/locale so it's correct even if the device timezone
 * is misconfigured.
 */
export function nowISTLongLabel(): string {
  const d = shiftToIST(new Date().toISOString());
  if (!d) return '';
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_FULL[d.getUTCMonth()]}`;
}

/**
 * Format a bare 'YYYY-MM-DD' calendar date (no time component, e.g. a
 * due_date or a date-picker value) as 'D Mon YYYY'. Parsed as plain text,
 * never round-tripped through a Date/UTC conversion — safe regardless of
 * device timezone, and correct even though it doesn't go through the IST
 * helpers above (there's no timestamp to convert, just digits to relabel).
 */
export function displayDateOnly(ds?: string | null): string {
  if (!ds) return '';
  const [y, m, d] = ds.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ds;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Same as displayDateOnly, but with the full weekday name prefixed, e.g. 'Tuesday, 18 August 2026'. */
export function displayDateOnlyWithWeekday(ds?: string | null): string {
  if (!ds) return '';
  const [y, m, d] = ds.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return ds;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS_FULL[m - 1]} ${y}`;
}
