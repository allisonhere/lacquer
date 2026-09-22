import { describe, it, expect } from 'vitest';
import {
  timezoneOffsetMinutes,
  toZonedParts,
  zonedWallClockToUtc,
  parseLocalDate,
  formatLocalDate,
  weekdayOfLocalDate,
  formatMinutes,
  parseMinutes,
  rangesOverlap,
  findOverlap,
  isValidTimezone,
} from './time.js';
const chicago = 'America/Chicago';
describe('timezone offsets', () => {
  it('reports standard and daylight offsets with an ISO sign convention', () => {
    // 2026-01-15 is CST (UTC-6); 2026-07-15 is CDT (UTC-5).
    expect(
      timezoneOffsetMinutes(chicago, new Date('2026-01-15T18:00:00Z')),
    ).toBe(-360);
    expect(
      timezoneOffsetMinutes(chicago, new Date('2026-07-15T18:00:00Z')),
    ).toBe(-300);
    expect(
      timezoneOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z')),
    ).toBe(120);
    expect(timezoneOffsetMinutes('UTC', new Date('2026-07-15T12:00:00Z'))).toBe(
      0,
    );
  });
  it('validates IANA zone names', () => {
    expect(isValidTimezone(chicago)).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});
describe('recurring wall-clock schedules survive daylight saving', () => {
  it('keeps a 9am shift at 9am local on both sides of a transition', () => {
    // US DST began 2026-03-08. A "Monday 09:00" block must be 09:00 local in
    // both weeks even though the UTC instant shifts by an hour.
    const beforeTransition = zonedWallClockToUtc(
      chicago,
      { year: 2026, month: 3, day: 2 },
      9 * 60,
    );
    const afterTransition = zonedWallClockToUtc(
      chicago,
      { year: 2026, month: 3, day: 9 },
      9 * 60,
    );
    expect(beforeTransition.toISOString()).toBe('2026-03-02T15:00:00.000Z');
    expect(afterTransition.toISOString()).toBe('2026-03-09T14:00:00.000Z');
    expect(toZonedParts(chicago, beforeTransition).minutes).toBe(9 * 60);
    expect(toZonedParts(chicago, afterTransition).minutes).toBe(9 * 60);
  });
  it('resolves a spring-forward gap without inventing availability', () => {
    // 02:30 on 2026-03-08 does not exist in Chicago; it must not resolve to a
    // time before the transition.
    const instant = zonedWallClockToUtc(
      chicago,
      { year: 2026, month: 3, day: 8 },
      2 * 60 + 30,
    );
    expect(toZonedParts(chicago, instant).minutes).toBeGreaterThanOrEqual(
      3 * 60,
    );
  });
  it('resolves an autumn-back overlap to the first occurrence', () => {
    // 01:30 on 2026-11-01 happens twice in Chicago; the earlier (CDT) one wins.
    const instant = zonedWallClockToUtc(
      chicago,
      { year: 2026, month: 11, day: 1 },
      60 + 30,
    );
    expect(instant.toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(timezoneOffsetMinutes(chicago, instant)).toBe(-300);
  });
  it('round-trips wall clock through UTC and back for many zones', () => {
    for (const timezone of [
      chicago,
      'UTC',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Asia/Kolkata',
    ])
      for (const month of [1, 4, 7, 10]) {
        const date = { year: 2026, month, day: 15 };
        const instant = zonedWallClockToUtc(timezone, date, 14 * 60 + 30);
        const parts = toZonedParts(timezone, instant);
        expect({
          year: parts.year,
          month: parts.month,
          day: parts.day,
          minutes: parts.minutes,
        }).toEqual({ ...date, minutes: 14 * 60 + 30 });
      }
  });
  it('reports the local weekday rather than the UTC one near a date boundary', () => {
    // 23:30 Sunday in Chicago is already Monday in UTC.
    const instant = zonedWallClockToUtc(
      chicago,
      { year: 2026, month: 3, day: 15 },
      23 * 60 + 30,
    );
    expect(instant.getUTCDay()).toBe(1);
    expect(toZonedParts(chicago, instant).weekday).toBe(7);
  });
});
describe('local calendar dates', () => {
  it('parses, formats, and round-trips YYYY-MM-DD', () => {
    expect(parseLocalDate('2026-10-14')).toEqual({
      year: 2026,
      month: 10,
      day: 14,
    });
    expect(formatLocalDate({ year: 2026, month: 1, day: 5 })).toBe(
      '2026-01-05',
    );
    expect(() => parseLocalDate('14/10/2026')).toThrow(RangeError);
  });
  it('reports ISO weekdays with Monday as 1 and Sunday as 7', () => {
    expect(weekdayOfLocalDate('2026-10-12')).toBe(1);
    expect(weekdayOfLocalDate('2026-10-18')).toBe(7);
  });
});
describe('minutes after midnight', () => {
  it('formats and parses HH:MM', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(9 * 60)).toBe('09:00');
    expect(formatMinutes(20 * 60)).toBe('20:00');
    expect(formatMinutes(1440)).toBe('24:00');
    expect(parseMinutes('09:00')).toBe(540);
    expect(parseMinutes('9:30')).toBe(570);
    expect(parseMinutes('24:00')).toBe(1440);
  });
  it('rejects out-of-range and malformed values', () => {
    for (const value of ['24:01', '09:60', 'noon', '', '9'])
      expect(() => parseMinutes(value)).toThrow(RangeError);
    for (const value of [-1, 1441, 1.5])
      expect(() => formatMinutes(value)).toThrow(RangeError);
  });
});
describe('overlap detection for recurring blocks', () => {
  it('treats touching ranges as adjacent, not overlapping', () => {
    expect(
      rangesOverlap(
        { startMinute: 540, endMinute: 780 },
        { startMinute: 780, endMinute: 900 },
      ),
    ).toBe(false);
  });
  it('detects a genuine overlap in either order', () => {
    const morning = { startMinute: 540, endMinute: 780 };
    const midday = { startMinute: 700, endMinute: 900 };
    expect(rangesOverlap(morning, midday)).toBe(true);
    expect(rangesOverlap(midday, morning)).toBe(true);
  });
  it('accepts a split shift as non-overlapping', () => {
    // Monday 09:00-13:00 and 16:00-20:00.
    expect(
      findOverlap([
        { startMinute: 540, endMinute: 780 },
        { startMinute: 960, endMinute: 1200 },
      ]),
    ).toBeNull();
  });
  it('finds the offending pair among many blocks', () => {
    const overlap = findOverlap([
      { startMinute: 960, endMinute: 1200 },
      { startMinute: 540, endMinute: 780 },
      { startMinute: 1100, endMinute: 1300 },
    ]);
    expect(overlap).not.toBeNull();
    expect(overlap?.[0].startMinute).toBe(960);
    expect(overlap?.[1].startMinute).toBe(1100);
  });
});
