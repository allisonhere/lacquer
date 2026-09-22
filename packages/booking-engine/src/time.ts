import { minutesPerDay, type Weekday } from '@lacquer/types';
/**
 * Centralized time conversion for salon scheduling.
 *
 * Why no date library: the only conversion Lacquer needs is between a location's
 * local wall clock and an absolute instant. Node 22+ ships full ICU, and
 * `Intl.DateTimeFormat` already carries the complete IANA rule set including
 * historical and future daylight-saving transitions. Adding Luxon or date-fns-tz
 * would duplicate that data for one operation, so this module wraps `Intl`
 * instead. Every conversion in the codebase must go through here rather than
 * manipulating `Date` fields ad hoc.
 *
 * Two distinct kinds of time exist in the schema and must not be conflated:
 *
 *   Recurring wall clock — "Monday 09:00" at a location. Stored as an ISO
 *   weekday plus minutes after local midnight. Never a UTC instant, because
 *   a 9am shift stays 9am across a DST transition even though the UTC offset
 *   moved by an hour.
 *
 *   Absolute instant — "this technician is away from 2026-10-14T14:00:00Z".
 *   Stored as `timestamptz`.
 */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  /** Minutes after local midnight, 0..1439. */
  minutes: number;
  /** ISO weekday, 1 = Monday through 7 = Sunday. */
  weekday: Weekday;
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, cached);
  }
  return cached;
}
/** True when the string is an IANA zone this runtime can resolve. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
function numericParts(timezone: string, instant: Date) {
  const parts = formatter(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new RangeError(`Missing ${type} for timezone ${timezone}`);
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}
/**
 * The zone's offset from UTC, in minutes, at a given instant. Positive east of
 * Greenwich, matching the sign convention of an ISO offset such as `+02:00`
 * (and therefore the opposite of `Date.prototype.getTimezoneOffset`).
 */
export function timezoneOffsetMinutes(timezone: string, instant: Date): number {
  const local = numericParts(timezone, instant);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  // Compare against the instant truncated to whole seconds; the formatter has
  // no sub-second precision and would otherwise skew the offset.
  return (asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}
/** Split an absolute instant into the location's local calendar fields. */
export function toZonedParts(timezone: string, instant: Date): ZonedParts {
  const local = numericParts(timezone, instant);
  // Derive the weekday from the local calendar date rather than the instant, so
  // an evening appointment near a date boundary reports the local day.
  const isoWeekday =
    ((new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() +
      6) %
      7) +
    1;
  return {
    year: local.year,
    month: local.month,
    day: local.day,
    minutes: local.hour * 60 + local.minute,
    weekday: isoWeekday as Weekday,
  };
}
/**
 * Resolve a local wall-clock time at a location to the absolute instant it
 * refers to.
 *
 * The offset depends on the very instant being computed, so this derives two
 * candidates and then checks which of them actually round-trips back to the
 * requested wall-clock time. Away from a daylight-saving transition both agree;
 * near one they straddle it and the check decides.
 *
 * Ambiguity at DST boundaries is resolved deterministically:
 *   - Spring-forward gap (02:30 where 02:00 jumps to 03:00): the returned
 *     instant lands after the transition, so the shift effectively starts at
 *     03:00 local. Availability is never invented inside a gap.
 *   - Autumn-back overlap (01:30 occurring twice): the first (pre-transition)
 *     occurrence is returned.
 */
export function zonedWallClockToUtc(
  timezone: string,
  date: { year: number; month: number; day: number },
  minutesAfterMidnight: number,
): Date {
  const naive =
    Date.UTC(date.year, date.month - 1, date.day) +
    minutesAfterMidnight * 60000;
  // Two candidates: one using the offset at the naive timestamp, one using the
  // offset at that first guess. Away from a transition both agree. Near one
  // they straddle it, and neither may be blindly trusted — inside a gap the
  // second candidate walks backwards to a time before the transition.
  const first =
    naive - timezoneOffsetMinutes(timezone, new Date(naive)) * 60000;
  const second =
    naive - timezoneOffsetMinutes(timezone, new Date(first)) * 60000;
  const roundTrips = (instant: number) => {
    const parts = toZonedParts(timezone, new Date(instant));
    return (
      parts.year === date.year &&
      parts.month === date.month &&
      parts.day === date.day &&
      parts.minutes === minutesAfterMidnight
    );
  };
  const valid = [first, second].filter(roundTrips);
  // Overlap (the hour repeats): both candidates are real; take the earlier,
  // which is the first occurrence.
  if (valid.length) return new Date(Math.min(...valid));
  // Gap (the wall-clock time does not exist): neither round-trips. Take the
  // later candidate, which lands past the transition — 02:30 becomes 03:30
  // rather than 01:30, so a shift is never pulled earlier than requested.
  return new Date(Math.max(first, second));
}
/** Parse a `YYYY-MM-DD` calendar date, as stored in `date` columns. */
export function parseLocalDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, received ${value}`);
  const [, year, month, day] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  return { year: Number(year), month: Number(month), day: Number(day) };
}
/** Format calendar fields back into the `YYYY-MM-DD` storage form. */
export function formatLocalDate(date: {
  year: number;
  month: number;
  day: number;
}): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;
}
/** ISO weekday, 1 = Monday through 7 = Sunday, for a `YYYY-MM-DD` date. */
export function weekdayOfLocalDate(value: string): Weekday {
  const { year, month, day } = parseLocalDate(value);
  return (((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) +
    1) as Weekday;
}
/** Render minutes after midnight as `HH:MM` for display and form fields. */
export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > minutesPerDay)
    throw new RangeError(`Minutes out of range: ${minutes}`);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
/** Parse an `HH:MM` form value into minutes after midnight. */
export function parseMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Expected HH:MM, received ${value}`);
  const [, hours, minutes] = match as unknown as [string, string, string];
  const total = Number(hours) * 60 + Number(minutes);
  if (Number(minutes) > 59 || total > minutesPerDay)
    throw new RangeError(`Time out of range: ${value}`);
  return total;
}
export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}
/** True when two half-open minute ranges share any minute. Touching ends do not overlap. */
export function rangesOverlap(left: MinuteRange, right: MinuteRange): boolean {
  return (
    left.startMinute < right.endMinute && right.startMinute < left.endMinute
  );
}
/**
 * The first pair of overlapping ranges, or null when all are disjoint.
 * Used to reject accidentally overlapping recurring shifts.
 */
export function findOverlap<T extends MinuteRange>(
  ranges: readonly T[],
): [T, T] | null {
  const sorted = [...ranges].sort((a, b) => a.startMinute - b.startMinute);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && rangesOverlap(previous, current))
      return [previous, current];
  }
  return null;
}

/** Calendar arithmetic belongs here; a local day is not always 24 elapsed hours. */
export function addLocalDays(value: string, days: number): string {
  const d = parseLocalDate(value);
  const next = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return formatLocalDate({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}
export const millisecondsPerMinute = 60_000;
export function addMinutes(instant: number, minutes: number): number {
  return instant + minutes * millisecondsPerMinute;
}
export function localDateAt(timezone: string, instant: number): string {
  return formatLocalDate(toZonedParts(timezone, new Date(instant)));
}
export function localInstant(
  timezone: string,
  date: string,
  minutes: number,
): number {
  // Normalize 24:00 to tomorrow's midnight before resolving the UTC offset.
  return zonedWallClockToUtc(
    timezone,
    parseLocalDate(minutes === minutesPerDay ? addLocalDays(date, 1) : date),
    minutes === minutesPerDay ? 0 : minutes,
  ).getTime();
}
