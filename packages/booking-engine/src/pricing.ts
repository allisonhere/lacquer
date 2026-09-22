/**
 * Effective price, duration, and buffer resolution.
 *
 * Precedence, most specific last — the first non-null value going up this list
 * wins:
 *
 *   price     variant explicit price  ->  service base price
 *             ...overridden by a technician/service price override
 *   duration  variant explicit duration -> service base duration
 *             ...overridden by a technician/service duration override
 *   buffers   salon default -> service override -> technician/service override
 *
 * Variants carry EXPLICIT effective values rather than deltas (see the
 * `service_variants` schema comment), so selecting a variant replaces the
 * service's base figure instead of adjusting it. A later price change to the
 * parent service therefore never silently re-prices its variants, and a
 * historical appointment can be reconstructed from the variant row alone.
 *
 * A technician override is the most specific statement a salon can make, so it
 * wins even over a variant. "Alex charges 9000 for an acrylic full set" is a
 * deliberate instruction, not a suggestion.
 *
 * Every function here is pure: it takes plain records and returns a number.
 * Milestone 3's availability engine composes them; nothing in this module
 * reads the database or generates slots.
 */
export interface ServicePricingFields {
  basePrice: number;
  baseDurationMinutes: number;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
}
export interface VariantPricingFields {
  price: number;
  durationMinutes: number;
}
export interface StaffServiceOverrideFields {
  priceOverride: number | null;
  durationOverrideMinutes: number | null;
  bufferBeforeOverrideMinutes: number | null;
  bufferAfterOverrideMinutes: number | null;
}
export interface SchedulingDefaults {
  defaultBufferBeforeMinutes: number;
  defaultBufferAfterMinutes: number;
  minimumBookingNoticeMinutes: number;
  maximumBookingHorizonDays: number;
  autoBreakEnabled: boolean;
  autoBreakThresholdMinutes: number;
  autoBreakDurationMinutes: number;
}
export interface StaffSchedulingOverrides {
  minimumBookingNoticeOverrideMinutes: number | null;
  autoBreakEnabled: boolean | null;
  autoBreakThresholdMinutes: number | null;
  autoBreakDurationMinutes: number | null;
}
/** Price in minor currency units for one technician performing one service or variant. */
export function getEffectiveServicePrice(input: {
  service: ServicePricingFields;
  variant?: VariantPricingFields | null;
  override?: StaffServiceOverrideFields | null;
}): number {
  const { service, variant, override } = input;
  return override?.priceOverride ?? variant?.price ?? service.basePrice;
}
/**
 * Service duration in minutes, excluding buffers. This is the time the client
 * occupies the chair; buffers are added around it by the caller.
 */
export function getEffectiveServiceDuration(input: {
  service: ServicePricingFields;
  variant?: VariantPricingFields | null;
  override?: StaffServiceOverrideFields | null;
}): number {
  const { service, variant, override } = input;
  return (
    override?.durationOverrideMinutes ??
    variant?.durationMinutes ??
    service.baseDurationMinutes
  );
}
export function getEffectiveBufferBefore(input: {
  settings: Pick<SchedulingDefaults, 'defaultBufferBeforeMinutes'>;
  service: Pick<ServicePricingFields, 'bufferBeforeMinutes'>;
  override?: Pick<
    StaffServiceOverrideFields,
    'bufferBeforeOverrideMinutes'
  > | null;
}): number {
  return (
    input.override?.bufferBeforeOverrideMinutes ??
    input.service.bufferBeforeMinutes ??
    input.settings.defaultBufferBeforeMinutes
  );
}
export function getEffectiveBufferAfter(input: {
  settings: Pick<SchedulingDefaults, 'defaultBufferAfterMinutes'>;
  service: Pick<ServicePricingFields, 'bufferAfterMinutes'>;
  override?: Pick<
    StaffServiceOverrideFields,
    'bufferAfterOverrideMinutes'
  > | null;
}): number {
  return (
    input.override?.bufferAfterOverrideMinutes ??
    input.service.bufferAfterMinutes ??
    input.settings.defaultBufferAfterMinutes
  );
}
/**
 * Total minutes a booking consumes on a technician's calendar: buffer before,
 * the service itself, and buffer after.
 */
export function getEffectiveTotalDuration(input: {
  settings: SchedulingDefaults;
  service: ServicePricingFields;
  variant?: VariantPricingFields | null;
  override?: StaffServiceOverrideFields | null;
  addOns?: readonly { durationMinutes: number }[];
}): number {
  const addOnMinutes = (input.addOns ?? []).reduce(
    (total, addOn) => total + addOn.durationMinutes,
    0,
  );
  return (
    getEffectiveBufferBefore(input) +
    getEffectiveServiceDuration(input) +
    addOnMinutes +
    getEffectiveBufferAfter(input)
  );
}
/**
 * How far ahead a client must book. A technician may tighten or relax the
 * salon-wide notice; the maximum booking horizon stays salon-wide in v1 and
 * has no per-technician override by design.
 */
export function getEffectiveMinimumBookingNotice(input: {
  settings: Pick<SchedulingDefaults, 'minimumBookingNoticeMinutes'>;
  staff?: Pick<
    StaffSchedulingOverrides,
    'minimumBookingNoticeOverrideMinutes'
  > | null;
}): number {
  return (
    input.staff?.minimumBookingNoticeOverrideMinutes ??
    input.settings.minimumBookingNoticeMinutes
  );
}
export interface AutomaticBreakRule {
  enabled: boolean;
  consecutiveBookedMinutesThreshold: number;
  breakDurationMinutes: number;
}
/**
 * Configuration for workload-based automatic breaks, resolved for one
 * technician. Milestone 2 stores and serves this only — no break is inserted
 * anywhere. Milestone 3's availability engine consumes it.
 *
 * Each field falls back independently, so a salon can override only the
 * duration for one technician and inherit the rest.
 */
export function getEffectiveAutomaticBreakRule(input: {
  settings: Pick<
    SchedulingDefaults,
    | 'autoBreakEnabled'
    | 'autoBreakThresholdMinutes'
    | 'autoBreakDurationMinutes'
  >;
  staff?: StaffSchedulingOverrides | null;
}): AutomaticBreakRule {
  const { settings, staff } = input;
  return {
    enabled: staff?.autoBreakEnabled ?? settings.autoBreakEnabled,
    consecutiveBookedMinutesThreshold:
      staff?.autoBreakThresholdMinutes ?? settings.autoBreakThresholdMinutes,
    breakDurationMinutes:
      staff?.autoBreakDurationMinutes ?? settings.autoBreakDurationMinutes,
  };
}
export interface DailyLimits {
  maxAppointmentsPerDay: number | null;
  maxBookedMinutesPerDay: number | null;
}
/**
 * Per-technician daily ceilings; null means no limit. Milestone 2 exposes the
 * configuration through this accessor only. Milestone 3 enforces it against
 * actual bookings.
 */
export function getEffectiveDailyLimits(
  staff: DailyLimits,
): Readonly<DailyLimits> {
  return {
    maxAppointmentsPerDay: staff.maxAppointmentsPerDay,
    maxBookedMinutesPerDay: staff.maxBookedMinutesPerDay,
  };
}
