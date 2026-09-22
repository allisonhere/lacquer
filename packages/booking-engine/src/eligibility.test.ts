import { describe, it, expect } from 'vitest';
import {
  isStaffQualifiedForService,
  evaluateStaffEligibility,
  type EligibilityStaff,
  type EligibilityService,
} from './eligibility.js';
const downtown = 'location-downtown';
const north = 'location-north';
const acrylic = 'skill-acrylic';
const nailArt = 'skill-nail-art';
const staff: EligibilityStaff = {
  id: 'staff-alex',
  active: true,
  acceptsOnlineBookings: true,
  skillIds: [acrylic],
  activeLocationIds: [downtown],
};
const service: EligibilityService = {
  id: 'service-full-set',
  active: true,
  acceptsOnlineBooking: true,
  staffEligibilityMode: 'all_qualified',
  requiredSkillIds: [acrylic],
  activeLocationIds: [downtown],
};
describe('staff eligibility for a service', () => {
  it('qualifies a technician holding every required skill', () => {
    expect(isStaffQualifiedForService({ staff, service })).toBe(true);
    expect(
      isStaffQualifiedForService({ staff, service, locationId: downtown }),
    ).toBe(true);
  });
  it('rejects a technician missing a required skill and names it', () => {
    const result = evaluateStaffEligibility({
      staff,
      service: { ...service, requiredSkillIds: [acrylic, nailArt] },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('missing_required_skill');
    expect(result.missingSkillIds).toEqual([nailArt]);
  });
  it('applies the additional skills a variant demands', () => {
    const variant = {
      id: 'variant-xl',
      active: true,
      requiredSkillIds: [nailArt],
    };
    expect(isStaffQualifiedForService({ staff, service, variant })).toBe(false);
    expect(
      isStaffQualifiedForService({
        staff: { ...staff, skillIds: [acrylic, nailArt] },
        service,
        variant,
      }),
    ).toBe(true);
  });
  it('rejects a technician not assigned to the requested location', () => {
    const result = evaluateStaffEligibility({
      staff,
      service: { ...service, activeLocationIds: [downtown, north] },
      locationId: north,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('not_assigned_to_location');
  });
  it('rejects a service that is not offered at the requested location', () => {
    const result = evaluateStaffEligibility({
      staff: { ...staff, activeLocationIds: [downtown, north] },
      service,
      locationId: north,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('service_not_offered_at_location');
  });
  it('rejects an inactive technique, service, or variant', () => {
    expect(
      evaluateStaffEligibility({
        staff: { ...staff, active: false },
        service,
      }).reasons,
    ).toContain('staff_inactive');
    expect(
      evaluateStaffEligibility({
        staff,
        service: { ...service, active: false },
      }).reasons,
    ).toContain('service_inactive');
    expect(
      evaluateStaffEligibility({
        staff,
        service,
        variant: { id: 'v', active: false, requiredSkillIds: [] },
      }).reasons,
    ).toContain('variant_inactive');
  });
  it('honours an explicit ineligible assignment even when skills are held', () => {
    const result = evaluateStaffEligibility({
      staff,
      service,
      explicit: 'ineligible',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('explicitly_ineligible');
  });
  it('requires an explicit assignment for an explicit_only service', () => {
    const explicitOnly = {
      ...service,
      staffEligibilityMode: 'explicit_only' as const,
    };
    expect(
      evaluateStaffEligibility({ staff, service: explicitOnly }).reasons,
    ).toContain('not_explicitly_eligible');
    expect(
      isStaffQualifiedForService({
        staff,
        service: explicitOnly,
        explicit: 'eligible',
      }),
    ).toBe(true);
  });
  it('never lets an explicit assignment waive a required skill', () => {
    const result = evaluateStaffEligibility({
      staff: { ...staff, skillIds: [] },
      service: { ...service, staffEligibilityMode: 'explicit_only' },
      explicit: 'eligible',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(['missing_required_skill']);
  });
  it('applies online-booking gates only when the client is booking online', () => {
    const declining = { ...staff, acceptsOnlineBookings: false };
    expect(isStaffQualifiedForService({ staff: declining, service })).toBe(
      true,
    );
    const online = evaluateStaffEligibility({
      staff: declining,
      service,
      onlineBookingRequested: true,
    });
    expect(online.eligible).toBe(false);
    expect(online.reasons).toContain('staff_declines_online_bookings');
    expect(
      evaluateStaffEligibility({
        staff,
        service: { ...service, acceptsOnlineBooking: false },
        onlineBookingRequested: true,
      }).reasons,
    ).toContain('service_declines_online_bookings');
  });
  it('collects every failing rule rather than stopping at the first', () => {
    const result = evaluateStaffEligibility({
      staff: { ...staff, active: false, skillIds: [] },
      service,
      locationId: north,
    });
    expect(result.reasons).toEqual([
      'staff_inactive',
      'not_assigned_to_location',
      'service_not_offered_at_location',
      'missing_required_skill',
    ]);
  });
});
