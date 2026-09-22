import { describe, expect, it } from 'vitest';
import {
  bookingOccupancy,
  candidateStarts,
  composeSchedule,
  hasBookingConflict,
  needsAutomaticBreak,
  overlaps,
  resolveActiveProcessing,
  slotFailure,
  subtractIntervals,
  type BookingPart,
  type SlotRules,
} from './availability.js';
import { addMinutes, localInstant, toZonedParts } from './time.js';
const timezone = 'America/Chicago',
  date = '2026-10-12';
const at = (minute: number) => localInstant(timezone, date, minute);
const part: BookingPart = {
  durationMinutes: 60,
  activeMinutes: 60,
  processingMinutes: 0,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  addOnMinutes: 0,
};
const book = (minute: number, patch: Partial<BookingPart> = {}) =>
  bookingOccupancy(at(minute), 'location', [{ ...part, ...patch }]);
const existing = (minute: number, patch: Partial<BookingPart> = {}) => ({
  ...book(minute, patch),
  id: String(minute),
});
const rules: SlotRules = {
  timezone,
  now: at(0),
  minimumNoticeMinutes: 0,
  maximumHorizonDays: 60,
  limits: { maxAppointmentsPerDay: null, maxBookedMinutesPerDay: null },
  automaticBreak: {
    enabled: false,
    consecutiveBookedMinutesThreshold: 120,
    breakDurationMinutes: 30,
  },
  mode: 'disabled',
};
const work = [{ start: at(540), end: at(1020) }];
const block = (
  startMinute: number,
  endMinute: number,
  kind: 'work' | 'break' = 'work',
) => ({ weekday: 1, startMinute, endMinute, kind, active: true });
const compose = (extra: Partial<Parameters<typeof composeSchedule>[0]> = {}) =>
  composeSchedule({
    date,
    timezone,
    blocks: [block(540, 1020)],
    overrides: [],
    timeOff: [],
    ...extra,
  });
describe('half-open capacity intervals', () => {
  it('permits touching endpoints and rejects partial overlap and containment', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(overlaps({ start: 0, end: 10 }, { start: 9, end: 20 })).toBe(true);
    expect(overlaps({ start: 0, end: 30 }, { start: 9, end: 20 })).toBe(true);
  });
  it('subtracts nested and touching blocks without empty intervals', () => {
    expect(
      subtractIntervals(
        [{ start: 0, end: 30 }],
        [
          { start: 10, end: 20 },
          { start: 30, end: 40 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });
  it('accounts for before and after buffers', () => {
    expect(
      hasBookingConflict(
        book(600, { bufferBeforeMinutes: 5 }),
        [existing(540)],
        'disabled',
      ),
    ).toBe(true);
    expect(
      hasBookingConflict(
        book(600),
        [existing(540, { bufferAfterMinutes: 15 })],
        'disabled',
      ),
    ).toBe(true);
    expect(
      hasBookingConflict(
        book(615),
        [existing(540, { bufferAfterMinutes: 15 })],
        'disabled',
      ),
    ).toBe(false);
    expect(
      book(540, { bufferBeforeMinutes: 5, bufferAfterMinutes: 10 }).endsAt,
    ).toBe(at(600));
  });
});
describe('schedule composition', () => {
  it('composes a simple workday', () => expect(compose()).toEqual(work));
  it('does not bridge split shifts', () => {
    const shifts = compose({ blocks: [block(540, 780), block(960, 1200)] });
    expect(slotFailure(book(750), shifts, [], rules)).toBe('SLOT_UNAVAILABLE');
    expect(slotFailure(book(960), shifts, [], rules)).toBeNull();
  });
  it('subtracts recurring breaks', () => {
    expect(
      slotFailure(
        book(690),
        compose({ blocks: [block(540, 1020), block(720, 750, 'break')] }),
        [],
        rules,
      ),
    ).toBe('SLOT_UNAVAILABLE');
  });
  it.each([
    [600, 660],
    [0, 1440],
  ])('subtracts scheduled time off %s–%s', (start, end) => {
    const schedule = compose({
      timeOff: [
        {
          startsAt: new Date(at(start)),
          endsAt: new Date(at(end)),
          status: 'scheduled',
        },
      ],
    });
    expect(slotFailure(book(600), schedule, [], rules)).toBe(
      'SLOT_UNAVAILABLE',
    );
  });
  it('ignores cancelled time off', () => {
    expect(
      compose({
        timeOff: [
          {
            startsAt: new Date(at(0)),
            endsAt: new Date(at(1440)),
            status: 'cancelled',
          },
        ],
      }),
    ).toEqual(work);
  });
  it('adds then removes dated availability; time off wins over additions', () => {
    const overrides = [
      {
        localDate: date,
        startMinute: 1020,
        endMinute: 1200,
        kind: 'added' as const,
      },
      {
        localDate: date,
        startMinute: 1080,
        endMinute: 1110,
        kind: 'removed' as const,
      },
    ];
    expect(
      slotFailure(book(1020), compose({ overrides }), [], rules),
    ).toBeNull();
    expect(slotFailure(book(1080), compose({ overrides }), [], rules)).toBe(
      'SLOT_UNAVAILABLE',
    );
    expect(
      slotFailure(
        book(1020),
        compose({
          overrides,
          timeOff: [
            {
              startsAt: new Date(at(1020)),
              endsAt: new Date(at(1080)),
              status: 'scheduled',
            },
          ],
        }),
        [],
        rules,
      ),
    ).toBe('SLOT_UNAVAILABLE');
  });
  it('allows a dated addition to explicitly reopen a recurring break', () => {
    expect(
      compose({
        blocks: [block(540, 1020), block(720, 750, 'break')],
        overrides: [
          { localDate: date, startMinute: 720, endMinute: 750, kind: 'added' },
        ],
      }),
    ).toEqual(work);
  });
});
describe('booking limits and automatic breaks', () => {
  it('enforces appointment caps with zero a real limit', () => {
    expect(
      slotFailure(book(600), work, [existing(540)], {
        ...rules,
        limits: { ...rules.limits, maxAppointmentsPerDay: 1 },
      }),
    ).toBe('DAILY_APPOINTMENT_LIMIT_REACHED');
    expect(
      slotFailure(book(540), work, [], {
        ...rules,
        limits: { ...rules.limits, maxAppointmentsPerDay: 0 },
      }),
    ).toBe('DAILY_APPOINTMENT_LIMIT_REACHED');
  });
  it('counts service/processing/add-on minutes, excluding buffers', () => {
    expect(
      slotFailure(
        book(630, { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }),
        work,
        [existing(540)],
        { ...rules, limits: { ...rules.limits, maxBookedMinutesPerDay: 120 } },
      ),
    ).toBeNull();
    expect(
      slotFailure(book(630, { addOnMinutes: 1 }), work, [existing(540)], {
        ...rules,
        limits: { ...rules.limits, maxBookedMinutesPerDay: 120 },
      }),
    ).toBe('DAILY_BOOKED_MINUTES_LIMIT_REACHED');
  });
  it('requires an adequate free gap and checks appointments after an inserted booking', () => {
    const rule = { ...rules.automaticBreak, enabled: true };
    expect(
      needsAutomaticBreak(book(600), [existing(540), existing(660)], rule),
    ).toBe(true);
    expect(
      needsAutomaticBreak(book(690), [existing(540), existing(600)], rule),
    ).toBe(false);
    expect(
      needsAutomaticBreak(book(675), [existing(540), existing(600)], rule),
    ).toBe(true);
    expect(needsAutomaticBreak(book(600), [existing(540)], rule)).toBe(false);
  });
  it('rejects a service longer than the consecutive workload threshold', () => {
    expect(
      slotFailure(
        book(540, { durationMinutes: 180, activeMinutes: 180 }),
        work,
        [],
        {
          ...rules,
          automaticBreak: { ...rules.automaticBreak, enabled: true },
        },
      ),
    ).toBe('AUTOMATIC_BREAK_REQUIRED');
  });
  it('does not reject an unrelated historical workload violation', () => {
    expect(
      needsAutomaticBreak(
        book(900),
        [existing(540), existing(600), existing(660)],
        { ...rules.automaticBreak, enabled: true },
      ),
    ).toBe(false);
  });
  it('enforces notice at exact boundaries and the local-date horizon', () => {
    expect(
      slotFailure(book(540), work, [], {
        ...rules,
        now: at(500),
        minimumNoticeMinutes: 60,
      }),
    ).toBe('MINIMUM_NOTICE_NOT_MET');
    expect(
      slotFailure(book(540), work, [], {
        ...rules,
        now: at(480),
        minimumNoticeMinutes: 60,
      }),
    ).toBeNull();
    expect(
      slotFailure(book(540), work, [], {
        ...rules,
        now: localInstant(timezone, '2026-08-01', 0),
        maximumHorizonDays: 60,
      }),
    ).toBe('OUTSIDE_BOOKING_HORIZON');
  });
});
describe('intelligent overlap', () => {
  const split = { activeMinutes: 30, processingMinutes: 30 };
  it('rejects active overlap and permits unattended processing overlap', () => {
    expect(
      hasBookingConflict(
        book(555),
        [existing(540, split)],
        'intelligent_overlap',
      ),
    ).toBe(true);
    expect(
      hasBookingConflict(
        book(570),
        [existing(540, split)],
        'intelligent_overlap',
      ),
    ).toBe(false);
  });
  it.each(['disabled', 'manual_override'] as const)(
    '%s does not expose overlapping slots',
    (mode) => {
      expect(hasBookingConflict(book(570), [existing(540, split)], mode)).toBe(
        true,
      );
    },
  );
  it('processing cannot overlap another location', () => {
    expect(
      hasBookingConflict(
        { ...book(570), locationId: 'other' },
        [existing(540, split)],
        'intelligent_overlap',
      ),
    ).toBe(true);
  });
  it('buffers and add-ons block technician capacity during processing overlaps', () => {
    expect(
      hasBookingConflict(
        book(600),
        [existing(540, { ...split, addOnMinutes: 15 })],
        'intelligent_overlap',
      ),
    ).toBe(true);
    expect(
      hasBookingConflict(
        book(600),
        [existing(540, { ...split, bufferAfterMinutes: 15 })],
        'intelligent_overlap',
      ),
    ).toBe(true);
  });
  it('manual overrides waive only appointment conflicts', () => {
    expect(
      slotFailure(
        book(540),
        work,
        [existing(540)],
        { ...rules, mode: 'manual_override' },
        true,
      ),
    ).toBeNull();
    expect(slotFailure(book(540), work, [existing(540)], rules, true)).toBe(
      'SLOT_UNAVAILABLE',
    );
    expect(
      slotFailure(
        book(480),
        work,
        [],
        { ...rules, mode: 'manual_override' },
        true,
      ),
    ).toBe('SLOT_UNAVAILABLE');
    expect(
      slotFailure(
        { ...book(540), locationId: 'other' },
        work,
        [existing(540)],
        { ...rules, mode: 'manual_override' },
        true,
      ),
    ).toBe('SLOT_UNAVAILABLE');
  });
  it('falls back to all-active for incomplete or overridden splits', () => {
    expect(resolveActiveProcessing(60, 30, 30)).toEqual(split);
    expect(resolveActiveProcessing(90, 30, 30)).toEqual({
      activeMinutes: 90,
      processingMinutes: 0,
    });
    expect(resolveActiveProcessing(60, null, 30)).toEqual({
      activeMinutes: 60,
      processingMinutes: 0,
    });
  });
  it('sequences multiple service buffers without releasing internal occupancy', () => {
    const result = bookingOccupancy(at(540), 'location', [
      { ...part, bufferAfterMinutes: 10 },
      { ...part, bufferBeforeMinutes: 5 },
    ]);
    expect(result.endsAt).toBe(at(675));
    expect(result.serviceMinutes).toBe(120);
    expect(result.active).toEqual([{ start: at(540), end: at(675) }]);
  });
});
describe('DST slot generation', () => {
  it.each([
    ['2026-03-01', '2026-03-01T15:00:00.000Z'],
    ['2026-03-08', '2026-03-08T14:00:00.000Z'],
    ['2026-11-01', '2026-11-01T15:00:00.000Z'],
  ])('keeps 09:00 local on %s', (day, expected) => {
    const schedule = compose({
      date: day,
      blocks: [{ ...block(540, 1020), weekday: 7 }],
    });
    expect(new Date(schedule[0]!.start).toISOString()).toBe(expected);
    expect(toZonedParts(timezone, new Date(schedule[0]!.start)).minutes).toBe(
      540,
    );
    expect(candidateStarts(day, timezone)).toContain(schedule[0]!.start);
  });
  it('spring-forward skips nonexistent wall times', () => {
    const starts = candidateStarts('2026-03-08', timezone);
    expect(starts).toHaveLength(92);
    expect(
      starts.some((t) => toZonedParts(timezone, new Date(t)).minutes === 150),
    ).toBe(false);
  });
  it('fall-back returns the first occurrence once and measures elapsed service time', () => {
    const starts = candidateStarts('2026-11-01', timezone);
    expect(starts).toHaveLength(96);
    const first = localInstant(timezone, '2026-11-01', 90);
    expect(new Date(first).toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(
      toZonedParts(timezone, new Date(addMinutes(first, 60))).minutes,
    ).toBe(90);
  });
});
