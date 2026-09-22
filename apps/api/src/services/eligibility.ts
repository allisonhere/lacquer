import { and, eq, inArray } from 'drizzle-orm';
import {
  staffProfiles,
  staffSkills,
  staffLocationAssignments,
  staffServices,
  staffServiceOverrides,
  services,
  serviceLocations,
  serviceSkillRequirements,
  serviceVariants,
  variantSkillRequirements,
  tenantSchedulingSettings,
  type Database,
} from '@lacquer/db';
import {
  evaluateStaffEligibility,
  getEffectiveServicePrice,
  getEffectiveServiceDuration,
  getEffectiveBufferBefore,
  getEffectiveBufferAfter,
  type SchedulingDefaults,
} from '@lacquer/booking-engine';
import type { TenantContext } from '../tenant-context.js';
import { requireOne, groupBy } from './support.js';
/**
 * Answers "can staff X perform service Y (variant Z) at location L, and what
 * would it cost and take?" by loading the rows the pure domain helpers need.
 *
 * The decision itself lives in `@lacquer/booking-engine`; this module only
 * gathers data. That separation is what lets the rules be unit-tested without
 * a database and reused unchanged by Milestone 3's availability engine.
 *
 * Loading is batched: one query per table for the whole candidate set, never
 * one per technician.
 */
export function createEligibilityService(db: Pick<Database, 'select'>) {
  return {
    /**
     * Evaluate every technician in the salon against one service, optionally at
     * a location and for a variant. Used by the service editor to show who can
     * perform a service and by the staff editor to preview effective values.
     */
    async forService(
      context: Pick<TenantContext, 'tenantId'>,
      serviceId: string,
      options: { locationId?: string | null; variantId?: string | null; onlineBookingRequested?: boolean } = {},
    ) {
      const service = requireOne(
        await db
          .select()
          .from(services)
          .where(
            and(
              eq(services.tenantId, context.tenantId),
              eq(services.id, serviceId),
            ),
          ),
      );
      const variant = options.variantId
        ? requireOne(
            await db
              .select()
              .from(serviceVariants)
              .where(
                and(
                  eq(serviceVariants.tenantId, context.tenantId),
                  eq(serviceVariants.serviceId, serviceId),
                  eq(serviceVariants.id, options.variantId),
                ),
              ),
          )
        : null;
      const [
        staffRows,
        serviceSkillRows,
        serviceLocationRows,
        variantSkillRows,
        settingsRow,
      ] = await Promise.all([
        db
          .select()
          .from(staffProfiles)
          .where(eq(staffProfiles.tenantId, context.tenantId)),
        db
          .select({ skillId: serviceSkillRequirements.skillId })
          .from(serviceSkillRequirements)
          .where(
            and(
              eq(serviceSkillRequirements.tenantId, context.tenantId),
              eq(serviceSkillRequirements.serviceId, serviceId),
            ),
          ),
        db
          .select({ locationId: serviceLocations.locationId })
          .from(serviceLocations)
          .where(
            and(
              eq(serviceLocations.tenantId, context.tenantId),
              eq(serviceLocations.serviceId, serviceId),
              eq(serviceLocations.active, true),
            ),
          ),
        variant
          ? db
              .select({ skillId: variantSkillRequirements.skillId })
              .from(variantSkillRequirements)
              .where(
                and(
                  eq(variantSkillRequirements.tenantId, context.tenantId),
                  eq(variantSkillRequirements.variantId, variant.id),
                ),
              )
          : Promise.resolve([] as { skillId: string }[]),
        db
          .select()
          .from(tenantSchedulingSettings)
          .where(eq(tenantSchedulingSettings.tenantId, context.tenantId)),
      ]);
      const staffIds = staffRows.map((row) => row.id);
      const [skillRows, assignmentRows, explicitRows, overrideRows] =
        staffIds.length
          ? await Promise.all([
              db
                .select({
                  staffId: staffSkills.staffId,
                  skillId: staffSkills.skillId,
                })
                .from(staffSkills)
                .where(
                  and(
                    eq(staffSkills.tenantId, context.tenantId),
                    inArray(staffSkills.staffId, staffIds),
                  ),
                ),
              db
                .select({
                  staffId: staffLocationAssignments.staffId,
                  locationId: staffLocationAssignments.locationId,
                })
                .from(staffLocationAssignments)
                .where(
                  and(
                    eq(staffLocationAssignments.tenantId, context.tenantId),
                    inArray(staffLocationAssignments.staffId, staffIds),
                    eq(staffLocationAssignments.active, true),
                  ),
                ),
              db
                .select({
                  staffId: staffServices.staffId,
                  eligibility: staffServices.eligibility,
                })
                .from(staffServices)
                .where(
                  and(
                    eq(staffServices.tenantId, context.tenantId),
                    eq(staffServices.serviceId, serviceId),
                    inArray(staffServices.staffId, staffIds),
                  ),
                ),
              db
                .select()
                .from(staffServiceOverrides)
                .where(
                  and(
                    eq(staffServiceOverrides.tenantId, context.tenantId),
                    eq(staffServiceOverrides.serviceId, serviceId),
                    inArray(staffServiceOverrides.staffId, staffIds),
                  ),
                ),
            ])
          : [[], [], [], []];
      // Defaults must match the table defaults; a tenant that has never opened
      // the settings screen still resolves complete values.
      const settings: SchedulingDefaults = settingsRow[0] ?? {
        defaultBufferBeforeMinutes: 0,
        defaultBufferAfterMinutes: 10,
        minimumBookingNoticeMinutes: 120,
        maximumBookingHorizonDays: 60,
        autoBreakEnabled: false,
        autoBreakThresholdMinutes: 240,
        autoBreakDurationMinutes: 30,
      };
      const skillsByStaff = groupBy(skillRows, (row) => row.staffId);
      const locationsByStaff = groupBy(assignmentRows, (row) => row.staffId);
      const explicitByStaff = new Map(
        explicitRows.map((row) => [row.staffId, row.eligibility]),
      );
      const overrideByStaff = new Map(
        overrideRows.map((row) => [row.staffId, row]),
      );
      const serviceView = {
        id: service.id,
        active: service.active,
        acceptsOnlineBooking: service.acceptsOnlineBooking,
        staffEligibilityMode: service.staffEligibilityMode,
        requiredSkillIds: serviceSkillRows.map((row) => row.skillId),
        activeLocationIds: serviceLocationRows.map((row) => row.locationId),
      };
      const variantView = variant
        ? {
            id: variant.id,
            active: variant.active,
            requiredSkillIds: variantSkillRows.map((row) => row.skillId),
          }
        : null;
      return staffRows.map((staff) => {
        const override = overrideByStaff.get(staff.id) ?? null;
        const result = evaluateStaffEligibility({
          staff: {
            id: staff.id,
            active: staff.active,
            acceptsOnlineBookings: staff.acceptsOnlineBookings,
            skillIds: (skillsByStaff.get(staff.id) ?? []).map(
              (row) => row.skillId,
            ),
            activeLocationIds: (locationsByStaff.get(staff.id) ?? []).map(
              (row) => row.locationId,
            ),
          },
          service: serviceView,
          variant: variantView,
          locationId: options.locationId ?? null,
          explicit: explicitByStaff.get(staff.id) ?? null,
          onlineBookingRequested: options.onlineBookingRequested ?? false,
        });
        const price = getEffectiveServicePrice({
          service,
          variant,
          override,
        });
        const durationMinutes = getEffectiveServiceDuration({
          service,
          variant,
          override,
        });
        const bufferBeforeMinutes = getEffectiveBufferBefore({
          settings,
          service,
          override,
        });
        const bufferAfterMinutes = getEffectiveBufferAfter({
          settings,
          service,
          override,
        });
        return {
          staffId: staff.id,
          serviceId,
          variantId: variant?.id ?? null,
          price,
          durationMinutes,
          bufferBeforeMinutes,
          bufferAfterMinutes,
          totalMinutes:
            bufferBeforeMinutes + durationMinutes + bufferAfterMinutes,
          eligible: result.eligible,
          reasons: result.reasons,
        };
      });
    },
  };
}
