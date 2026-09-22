import type { DoubleBookingMode } from '@lacquer/types';
import type { AutomaticBreakRule, DailyLimits } from './pricing.js';
import {
  addLocalDays,
  addMinutes,
  localDateAt,
  localInstant,
  millisecondsPerMinute,
  toZonedParts,
  weekdayOfLocalDate,
} from './time.js';

export const slotIntervalMinutes = 15;
export interface Interval {
  start: number;
  end: number;
}
export const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;
export function unionIntervals(rows: readonly Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const row of [...rows]
    .filter((r) => r.start < r.end)
    .sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && row.start <= last.end) last.end = Math.max(last.end, row.end);
    else result.push({ ...row });
  }
  return result;
}
export function subtractIntervals(
  work: readonly Interval[],
  blocked: readonly Interval[],
): Interval[] {
  let result = unionIntervals(work);
  for (const block of unionIntervals(blocked))
    result = result.flatMap((row) =>
      !overlaps(row, block)
        ? [row]
        : [
            { start: row.start, end: Math.min(row.end, block.start) },
            { start: Math.max(row.start, block.end), end: row.end },
          ].filter((r) => r.start < r.end),
    );
  return result;
}
export interface ScheduleBlock {
  weekday: number;
  kind: 'work' | 'break';
  startMinute: number;
  endMinute: number;
  active: boolean;
}
export interface AvailabilityOverride {
  localDate: string;
  kind: 'added' | 'removed';
  startMinute: number;
  endMinute: number;
}
export interface TimeOff {
  startsAt: Date;
  endsAt: Date;
  status: 'scheduled' | 'cancelled';
}
export function composeSchedule(input: {
  date: string;
  timezone: string;
  blocks: readonly ScheduleBlock[];
  overrides: readonly AvailabilityOverride[];
  timeOff: readonly TimeOff[];
}): Interval[] {
  const { date, timezone } = input;
  const wall = (r: { startMinute: number; endMinute: number }) => ({
    start: localInstant(timezone, date, r.startMinute),
    end: localInstant(timezone, date, r.endMinute),
  });
  const blocks = input.blocks.filter(
    (r) => r.active && r.weekday === weekdayOfLocalDate(date),
  );
  const overrides = input.overrides.filter((r) => r.localDate === date);
  const weekly = subtractIntervals(
    blocks.filter((r) => r.kind === 'work').map(wall),
    blocks.filter((r) => r.kind === 'break').map(wall),
  );
  const added = unionIntervals([
    ...weekly,
    ...overrides.filter((r) => r.kind === 'added').map(wall),
  ]);
  return subtractIntervals(added, [
    ...overrides.filter((r) => r.kind === 'removed').map(wall),
    ...input.timeOff
      .filter((r) => r.status === 'scheduled')
      .map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() })),
  ]);
}
export interface BookingPart {
  durationMinutes: number;
  activeMinutes: number;
  processingMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  addOnMinutes: number;
}
/** Incomplete or incompatible splits conservatively require the technician throughout. */
export function resolveActiveProcessing(
  duration: number,
  active: number | null,
  processing: number | null,
) {
  if (
    active !== null &&
    processing !== null &&
    active > 0 &&
    processing >= 0 &&
    active + processing === duration
  )
    return { activeMinutes: active, processingMinutes: processing };
  return { activeMinutes: duration, processingMinutes: 0 };
}
export interface Occupancy extends Interval {
  active: Interval[];
  serviceMinutes: number;
  startsAt: number;
  endsAt: number;
  locationId: string;
}
/** Ordered services: active then processing, then active add-ons. Buffers remain capacity. */
export function bookingOccupancy(
  startsAt: number,
  locationId: string,
  parts: readonly BookingPart[],
): Occupancy {
  let cursor = startsAt;
  const active: Interval[] = [];
  let serviceMinutes = 0;
  const start = addMinutes(startsAt, -(parts[0]?.bufferBeforeMinutes ?? 0));
  for (const [index, p] of parts.entries()) {
    const before = index === 0 ? start : cursor;
    if (index > 0) cursor = addMinutes(cursor, p.bufferBeforeMinutes);
    active.push({ start: before, end: addMinutes(cursor, p.activeMinutes) });
    cursor = addMinutes(cursor, p.durationMinutes);
    active.push({
      start: cursor,
      end: addMinutes(cursor, p.addOnMinutes + p.bufferAfterMinutes),
    });
    cursor = addMinutes(cursor, p.addOnMinutes + p.bufferAfterMinutes);
    serviceMinutes += p.durationMinutes + p.addOnMinutes;
  }
  return {
    start,
    end: cursor,
    startsAt,
    endsAt: addMinutes(cursor, -(parts.at(-1)?.bufferAfterMinutes ?? 0)),
    active: unionIntervals(active),
    serviceMinutes,
    locationId,
  };
}
export interface ExistingBooking extends Occupancy {
  id: string;
}
export function hasBookingConflict(
  candidate: Occupancy,
  existing: readonly ExistingBooking[],
  mode: DoubleBookingMode,
): boolean {
  return existing.some((row) => {
    if (!overlaps(candidate, row)) return false;
    // Unattended processing does not authorize travelling to another location.
    if (
      mode !== 'intelligent_overlap' ||
      row.locationId !== candidate.locationId
    )
      return true;
    return candidate.active.some((a) => row.active.some((b) => overlaps(a, b)));
  });
}
export type UnavailableReason =
  | 'SLOT_UNAVAILABLE'
  | 'MINIMUM_NOTICE_NOT_MET'
  | 'OUTSIDE_BOOKING_HORIZON'
  | 'DAILY_APPOINTMENT_LIMIT_REACHED'
  | 'DAILY_BOOKED_MINUTES_LIMIT_REACHED'
  | 'AUTOMATIC_BREAK_REQUIRED';
export interface SlotRules {
  timezone: string;
  now: number;
  minimumNoticeMinutes: number;
  maximumHorizonDays: number;
  limits: DailyLimits;
  automaticBreak: AutomaticBreakRule;
  mode: DoubleBookingMode;
}
/** Sum booked service/processing minutes between adequate occupancy-free gaps. */
export function needsAutomaticBreak(
  candidate: Occupancy,
  existing: readonly ExistingBooking[],
  rule: AutomaticBreakRule,
): boolean {
  if (!rule.enabled) return false;
  const rows = [...existing, candidate].sort((a, b) => a.start - b.start);
  let end = -Infinity,
    workload = 0,
    containsCandidate = false;
  for (const row of rows) {
    if (row.start >= addMinutes(end, rule.breakDurationMinutes)) {
      if (
        containsCandidate &&
        workload > rule.consecutiveBookedMinutesThreshold
      )
        return true;
      workload = 0;
      containsCandidate = false;
    }
    workload += row.serviceMinutes;
    end = Math.max(end, row.end);
    containsCandidate ||= row === candidate;
  }
  return containsCandidate && workload > rule.consecutiveBookedMinutesThreshold;
}
export function slotFailure(
  candidate: Occupancy,
  work: readonly Interval[],
  existing: readonly ExistingBooking[],
  rules: SlotRules,
  forceConflict = false,
): UnavailableReason | null {
  if (candidate.startsAt < addMinutes(rules.now, rules.minimumNoticeMinutes))
    return 'MINIMUM_NOTICE_NOT_MET';
  if (
    localDateAt(rules.timezone, candidate.startsAt) >
    addLocalDays(
      localDateAt(rules.timezone, rules.now),
      rules.maximumHorizonDays,
    )
  )
    return 'OUTSIDE_BOOKING_HORIZON';
  if (!work.some((w) => w.start <= candidate.start && w.end >= candidate.end))
    return 'SLOT_UNAVAILABLE';
  // Even a manual override cannot put a technician in two locations at once.
  if (
    existing.some(
      (row) =>
        row.locationId !== candidate.locationId && overlaps(candidate, row),
    )
  )
    return 'SLOT_UNAVAILABLE';
  const day = localDateAt(rules.timezone, candidate.startsAt);
  const daily = existing.filter(
    (row) => localDateAt(rules.timezone, row.startsAt) === day,
  );
  if (
    rules.limits.maxAppointmentsPerDay !== null &&
    daily.length + 1 > rules.limits.maxAppointmentsPerDay
  )
    return 'DAILY_APPOINTMENT_LIMIT_REACHED';
  if (
    rules.limits.maxBookedMinutesPerDay !== null &&
    daily.reduce((sum, r) => sum + r.serviceMinutes, candidate.serviceMinutes) >
      rules.limits.maxBookedMinutesPerDay
  )
    return 'DAILY_BOOKED_MINUTES_LIMIT_REACHED';
  if (needsAutomaticBreak(candidate, existing, rules.automaticBreak))
    return 'AUTOMATIC_BREAK_REQUIRED';
  if (
    !(forceConflict && rules.mode === 'manual_override') &&
    hasBookingConflict(candidate, existing, rules.mode)
  )
    return 'SLOT_UNAVAILABLE';
  return null;
}
/** Generate local wall-clock grid starts; skip nonexistent times and deduplicate DST normalization. */
export function candidateStarts(date: string, timezone: string): number[] {
  const result = new Set<number>();
  for (let minute = 0; minute < 1440; minute += slotIntervalMinutes) {
    const instant = localInstant(timezone, date, minute);
    if (
      toZonedParts(timezone, new Date(instant)).minutes === minute &&
      localDateAt(timezone, instant) === date
    )
      result.add(instant);
  }
  return [...result].sort((a, b) => a - b);
}
export function occupancyMinutes(row: Occupancy): number {
  return (row.end - row.start) / millisecondsPerMinute;
}
