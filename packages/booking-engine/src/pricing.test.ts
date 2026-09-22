import { describe, it, expect } from 'vitest';
import {
  getEffectiveServicePrice,
  getEffectiveServiceDuration,
  getEffectiveBufferBefore,
  getEffectiveBufferAfter,
  getEffectiveTotalDuration,
  getEffectiveMinimumBookingNotice,
  getEffectiveAutomaticBreakRule,
  getEffectiveDailyLimits,
  type ServicePricingFields,
  type SchedulingDefaults,
  type StaffServiceOverrideFields,
} from './pricing.js';
const service: ServicePricingFields = {
  basePrice: 7500,
  baseDurationMinutes: 60,
  bufferBeforeMinutes: null,
  bufferAfterMinutes: null,
};
const settings: SchedulingDefaults = {
  defaultBufferBeforeMinutes: 5,
  defaultBufferAfterMinutes: 10,
  minimumBookingNoticeMinutes: 120,
  maximumBookingHorizonDays: 60,
  autoBreakEnabled: false,
  autoBreakThresholdMinutes: 240,
  autoBreakDurationMinutes: 30,
};
const noOverride: StaffServiceOverrideFields = {
  priceOverride: null,
  durationOverrideMinutes: null,
  bufferBeforeOverrideMinutes: null,
  bufferAfterOverrideMinutes: null,
};
describe('effective service price', () => {
  it('uses the service base price when nothing overrides it', () => {
    expect(getEffectiveServicePrice({ service })).toBe(7500);
    expect(getEffectiveServicePrice({ service, override: noOverride })).toBe(
      7500,
    );
  });
  it('uses the variant price in place of the base price', () => {
    expect(
      getEffectiveServicePrice({
        service,
        variant: { price: 9500, durationMinutes: 90 },
      }),
    ).toBe(9500);
  });
  it('lets a technician override win over both service and variant', () => {
    expect(
      getEffectiveServicePrice({
        service,
        override: { ...noOverride, priceOverride: 9000 },
      }),
    ).toBe(9000);
    expect(
      getEffectiveServicePrice({
        service,
        variant: { price: 9500, durationMinutes: 90 },
        override: { ...noOverride, priceOverride: 9000 },
      }),
    ).toBe(9000);
  });
  it('treats a zero override as a real price rather than absent', () => {
    expect(
      getEffectiveServicePrice({
        service,
        override: { ...noOverride, priceOverride: 0 },
      }),
    ).toBe(0);
  });
});
describe('effective service duration', () => {
  it('uses the service base duration by default', () => {
    expect(getEffectiveServiceDuration({ service })).toBe(60);
  });
  it('uses the variant duration when a variant is chosen', () => {
    expect(
      getEffectiveServiceDuration({
        service,
        variant: { price: 9500, durationMinutes: 90 },
      }),
    ).toBe(90);
  });
  it('lets a technician duration override win', () => {
    expect(
      getEffectiveServiceDuration({
        service,
        variant: { price: 9500, durationMinutes: 90 },
        override: { ...noOverride, durationOverrideMinutes: 75 },
      }),
    ).toBe(75);
  });
});
describe('buffer precedence: salon default, service, technician', () => {
  it('falls back to the salon default when the service sets nothing', () => {
    expect(getEffectiveBufferBefore({ settings, service })).toBe(5);
    expect(getEffectiveBufferAfter({ settings, service })).toBe(10);
  });
  it('prefers a service-level buffer over the salon default', () => {
    const withBuffers = {
      ...service,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 20,
    };
    expect(getEffectiveBufferBefore({ settings, service: withBuffers })).toBe(
      15,
    );
    expect(getEffectiveBufferAfter({ settings, service: withBuffers })).toBe(
      20,
    );
  });
  it('prefers a technician override over the service and the salon default', () => {
    const withBuffers = {
      ...service,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 20,
    };
    expect(
      getEffectiveBufferBefore({
        settings,
        service: withBuffers,
        override: { ...noOverride, bufferBeforeOverrideMinutes: 0 },
      }),
    ).toBe(0);
    expect(
      getEffectiveBufferAfter({
        settings,
        service: withBuffers,
        override: { ...noOverride, bufferAfterOverrideMinutes: 25 },
      }),
    ).toBe(25);
  });
  it('treats an explicit zero buffer as "no buffer", not "inherit"', () => {
    expect(
      getEffectiveBufferBefore({
        settings,
        service: { ...service, bufferBeforeMinutes: 0 },
      }),
    ).toBe(0);
  });
});
describe('total booked duration', () => {
  it('sums buffer before, service time, add-ons, and buffer after', () => {
    expect(
      getEffectiveTotalDuration({
        settings,
        service,
        addOns: [{ durationMinutes: 15 }, { durationMinutes: 10 }],
      }),
    ).toBe(5 + 60 + 25 + 10);
  });
  it('composes variant and technician overrides consistently', () => {
    expect(
      getEffectiveTotalDuration({
        settings,
        service: { ...service, bufferAfterMinutes: 0 },
        variant: { price: 9500, durationMinutes: 90 },
        override: { ...noOverride, bufferBeforeOverrideMinutes: 20 },
      }),
    ).toBe(20 + 90 + 0);
  });
});
describe('minimum booking notice', () => {
  it('uses the salon-wide notice when the technician has no override', () => {
    expect(getEffectiveMinimumBookingNotice({ settings })).toBe(120);
    expect(
      getEffectiveMinimumBookingNotice({
        settings,
        staff: { minimumBookingNoticeOverrideMinutes: null },
      }),
    ).toBe(120);
  });
  it('lets a technician tighten or relax the notice', () => {
    expect(
      getEffectiveMinimumBookingNotice({
        settings,
        staff: { minimumBookingNoticeOverrideMinutes: 1440 },
      }),
    ).toBe(1440);
    expect(
      getEffectiveMinimumBookingNotice({
        settings,
        staff: { minimumBookingNoticeOverrideMinutes: 0 },
      }),
    ).toBe(0);
  });
});
describe('automatic break rule', () => {
  const staffDefaults = {
    minimumBookingNoticeOverrideMinutes: null,
    autoBreakEnabled: null,
    autoBreakThresholdMinutes: null,
    autoBreakDurationMinutes: null,
  };
  it('inherits the salon-wide configuration', () => {
    expect(
      getEffectiveAutomaticBreakRule({
        settings: { ...settings, autoBreakEnabled: true },
      }),
    ).toEqual({
      enabled: true,
      consecutiveBookedMinutesThreshold: 240,
      breakDurationMinutes: 30,
    });
  });
  it('lets each field be overridden independently for one technician', () => {
    expect(
      getEffectiveAutomaticBreakRule({
        settings: { ...settings, autoBreakEnabled: true },
        staff: { ...staffDefaults, autoBreakDurationMinutes: 45 },
      }),
    ).toEqual({
      enabled: true,
      consecutiveBookedMinutesThreshold: 240,
      breakDurationMinutes: 45,
    });
  });
  it('lets a technician opt out of automatic breaks entirely', () => {
    expect(
      getEffectiveAutomaticBreakRule({
        settings: { ...settings, autoBreakEnabled: true },
        staff: { ...staffDefaults, autoBreakEnabled: false },
      }).enabled,
    ).toBe(false);
  });
});
describe('daily technician limits', () => {
  it('reports null for an unlimited technician', () => {
    expect(
      getEffectiveDailyLimits({
        maxAppointmentsPerDay: null,
        maxBookedMinutesPerDay: null,
      }),
    ).toEqual({ maxAppointmentsPerDay: null, maxBookedMinutesPerDay: null });
  });
  it('reports configured ceilings', () => {
    expect(
      getEffectiveDailyLimits({
        maxAppointmentsPerDay: 8,
        maxBookedMinutesPerDay: 480,
      }),
    ).toEqual({ maxAppointmentsPerDay: 8, maxBookedMinutesPerDay: 480 });
  });
});
