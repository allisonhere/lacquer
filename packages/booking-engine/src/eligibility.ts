import type {
  StaffEligibilityMode,
  StaffServiceEligibility,
} from '@lacquer/types';
/**
 * Can technician X perform service Y (optionally variant Z) at location L?
 *
 * There is exactly one rule chain, evaluated in order. Skill requirements are
 * authoritative in every mode: an explicit `eligible` assignment opts a
 * technician into an `explicit_only` service but never waives a required
 * skill. This is deliberate — two competing systems (an allow-list that
 * bypasses skills, and skills that bypass the allow-list) would make the
 * question unanswerable.
 *
 *   1. The staff profile must be active.
 *   2. The service must be active.
 *   3. An explicit `ineligible` assignment denies unconditionally.
 *   4. When a location is named, the technician must hold an active assignment
 *      to it and the service must be offered there.
 *   5. When the service is `explicit_only`, an explicit `eligible` assignment
 *      is required.
 *   6. The technician must hold every skill the service requires, plus every
 *      additional skill the chosen variant requires.
 *
 * `onlineBookingRequested` additionally requires that both the salon and the
 * technician accept online bookings for this service. Staff-facing booking
 * (front desk creating an appointment) passes it as false.
 *
 * The function is pure. Callers load the relevant rows and pass them in;
 * `apps/api/src/services/eligibility.ts` does that in a single batched query.
 */
export interface EligibilityStaff {
  id: string;
  active: boolean;
  acceptsOnlineBookings: boolean;
  /** Skill IDs held by this technician. */
  skillIds: readonly string[];
  /** Location IDs with an active assignment. */
  activeLocationIds: readonly string[];
}
export interface EligibilityService {
  id: string;
  active: boolean;
  acceptsOnlineBooking: boolean;
  staffEligibilityMode: StaffEligibilityMode;
  /** Skill IDs this service requires of any technician. */
  requiredSkillIds: readonly string[];
  /** Location IDs where the service is actively offered. */
  activeLocationIds: readonly string[];
}
export interface EligibilityVariant {
  id: string;
  active: boolean;
  /** Skills demanded in addition to the service's own requirements. */
  requiredSkillIds: readonly string[];
}
export type IneligibilityReason =
  | 'staff_inactive'
  | 'service_inactive'
  | 'variant_inactive'
  | 'explicitly_ineligible'
  | 'not_assigned_to_location'
  | 'service_not_offered_at_location'
  | 'not_explicitly_eligible'
  | 'missing_required_skill'
  | 'staff_declines_online_bookings'
  | 'service_declines_online_bookings';
export interface EligibilityResult {
  eligible: boolean;
  /** Every rule that failed, in evaluation order. Empty when eligible. */
  reasons: IneligibilityReason[];
  /** Required skill IDs the technician does not hold. */
  missingSkillIds: string[];
}
export interface EligibilityInput {
  staff: EligibilityStaff;
  service: EligibilityService;
  variant?: EligibilityVariant | null;
  /** Omit to ask "anywhere in the salon" rather than at a specific location. */
  locationId?: string | null;
  /** Explicit per-technician decision for this service, when one exists. */
  explicit?: StaffServiceEligibility | null;
  /** Apply the online-booking gates as well as the operational ones. */
  onlineBookingRequested?: boolean;
}
/** Full evaluation with the reasons a technician was excluded, for admin UI. */
export function evaluateStaffEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const {
    staff,
    service,
    variant,
    locationId,
    explicit,
    onlineBookingRequested = false,
  } = input;
  const reasons: IneligibilityReason[] = [];
  if (!staff.active) reasons.push('staff_inactive');
  if (!service.active) reasons.push('service_inactive');
  if (variant && !variant.active) reasons.push('variant_inactive');
  if (explicit === 'ineligible') reasons.push('explicitly_ineligible');
  if (locationId) {
    if (!staff.activeLocationIds.includes(locationId))
      reasons.push('not_assigned_to_location');
    if (!service.activeLocationIds.includes(locationId))
      reasons.push('service_not_offered_at_location');
  }
  if (
    service.staffEligibilityMode === 'explicit_only' &&
    explicit !== 'eligible'
  )
    reasons.push('not_explicitly_eligible');
  const held = new Set(staff.skillIds);
  const missingSkillIds = [
    ...new Set([
      ...service.requiredSkillIds,
      ...(variant?.requiredSkillIds ?? []),
    ]),
  ].filter((skillId) => !held.has(skillId));
  if (missingSkillIds.length) reasons.push('missing_required_skill');
  if (onlineBookingRequested) {
    if (!staff.acceptsOnlineBookings)
      reasons.push('staff_declines_online_bookings');
    if (!service.acceptsOnlineBooking)
      reasons.push('service_declines_online_bookings');
  }
  return { eligible: reasons.length === 0, reasons, missingSkillIds };
}
/**
 * The question Milestone 3 asks most often, reduced to a boolean.
 * `evaluateStaffEligibility` returns the same decision with its reasoning.
 */
export function isStaffQualifiedForService(input: EligibilityInput): boolean {
  return evaluateStaffEligibility(input).eligible;
}
