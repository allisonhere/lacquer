import { and, eq, inArray, asc } from 'drizzle-orm';
import {
  staffProfiles,
  staffLocationAssignments,
  staffSkills,
  staffServices,
  staffServiceOverrides,
  services,
  skills,
  locations,
  tenantMemberships,
  type Database,
} from '@lacquer/db';
import type { StaffInput, StaffPatch } from '@lacquer/schemas';
import { assertPermission, type TenantContext } from '../tenant-context.js';
import { present } from './present.js';
import {
  scopeById,
  requireOne,
  requireInserted,
  assertAllBelongToTenant,
  inTenant,
  groupBy,
} from './support.js';
/**
 * Staff profiles and everything attached to one technician.
 *
 * A staff profile is a salon-facing record, deliberately separate from the
 * `users` identity that owns authentication. `userId` stays null for a
 * technician the salon has added but who has not accepted an invitation, so a
 * schedule can be built before an account exists. Authoritative identity
 * (login email, password, verification) is never duplicated here; the profile's
 * own `email`/`phone` are salon contact details for an unclaimed profile.
 *
 * Staff are deactivated, never deleted: appointments will reference them.
 */
export function createStaffService(db: Database) {
  const scope = (context: TenantContext, id?: string) =>
    scopeById(staffProfiles.tenantId, staffProfiles.id, context, id);
  async function owned(context: TenantContext, staffId: string) {
    return requireOne(
      await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(scope(context, staffId)),
    );
  }
  /** A linked user must already be a member of this salon. */
  async function assertMembership(context: TenantContext, userId: string) {
    requireOne(
      await db
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.tenantId, context.tenantId),
            eq(tenantMemberships.userId, userId),
          ),
        ),
    );
  }
  return {
    /** List view with each technician's active locations, in two queries. */
    async list(
      context: TenantContext,
      page: { limit: number; offset: number },
    ) {
      const rows = await db
        .select()
        .from(staffProfiles)
        .where(scope(context))
        .orderBy(asc(staffProfiles.displayName), asc(staffProfiles.id))
        .limit(page.limit)
        .offset(page.offset);
      if (!rows.length) return [];
      const assignments = await db
        .select({
          staffId: staffLocationAssignments.staffId,
          locationId: staffLocationAssignments.locationId,
        })
        .from(staffLocationAssignments)
        .where(
          and(
            eq(staffLocationAssignments.tenantId, context.tenantId),
            inArray(
              staffLocationAssignments.staffId,
              rows.map((row) => row.id),
            ),
            eq(staffLocationAssignments.active, true),
          ),
        );
      const byStaff = groupBy(assignments, (row) => row.staffId);
      return rows.map((row) => ({
        ...present(row),
        locationIds: (byStaff.get(row.id) ?? []).map((link) => link.locationId),
      }));
    },
    async get(context: TenantContext, id: string) {
      const staff = requireOne(
        await db.select().from(staffProfiles).where(scope(context, id)),
      );
      const [assignments, skillRows, overrideRows, eligibilityRows] =
        await Promise.all([
          db
            .select({
              locationId: staffLocationAssignments.locationId,
              active: staffLocationAssignments.active,
            })
            .from(staffLocationAssignments)
            .where(
              and(
                eq(staffLocationAssignments.tenantId, context.tenantId),
                eq(staffLocationAssignments.staffId, id),
              ),
            ),
          db
            .select({ skillId: staffSkills.skillId })
            .from(staffSkills)
            .where(
              and(
                eq(staffSkills.tenantId, context.tenantId),
                eq(staffSkills.staffId, id),
              ),
            ),
          db
            .select()
            .from(staffServiceOverrides)
            .where(
              and(
                eq(staffServiceOverrides.tenantId, context.tenantId),
                eq(staffServiceOverrides.staffId, id),
              ),
            ),
          db
            .select({
              serviceId: staffServices.serviceId,
              eligibility: staffServices.eligibility,
            })
            .from(staffServices)
            .where(
              and(
                eq(staffServices.tenantId, context.tenantId),
                eq(staffServices.staffId, id),
              ),
            ),
        ]);
      return {
        ...present(staff),
        locationIds: assignments
          .filter((link) => link.active)
          .map((link) => link.locationId),
        skillIds: skillRows.map((link) => link.skillId),
        serviceOverrides: overrideRows.map(present),
        serviceEligibility: eligibilityRows,
      };
    },
    async create(context: TenantContext, input: StaffInput) {
      assertPermission(context, 'manage_staff');
      if (input.userId) await assertMembership(context, input.userId);
      return present(
        requireInserted(
          await db
            .insert(staffProfiles)
            .values({ ...input, tenantId: context.tenantId })
            .returning(),
          'Staff profile',
        ),
      );
    },
    async update(context: TenantContext, id: string, input: StaffPatch) {
      assertPermission(context, 'manage_staff');
      if (input.userId) await assertMembership(context, input.userId);
      return present(
        requireOne(
          await db
            .update(staffProfiles)
            .set(input)
            .where(scope(context, id))
            .returning(),
        ),
      );
    },
    /* --- Locations ------------------------------------------------------- */
    locations: {
      list: async (context: TenantContext, staffId: string) => {
        await owned(context, staffId);
        return (
          await db
            .select()
            .from(staffLocationAssignments)
            .where(
              and(
                eq(staffLocationAssignments.tenantId, context.tenantId),
                eq(staffLocationAssignments.staffId, staffId),
              ),
            )
        ).map(present);
      },
      /**
       * Replace the set of locations a technician works at. The composite
       * foreign key already blocks another salon's location; checking first
       * turns that into a 404 rather than a foreign-key conflict.
       */
      async set(
        context: TenantContext,
        staffId: string,
        locationIds: readonly string[],
      ) {
        assertPermission(context, 'manage_staff');
        await owned(context, staffId);
        await assertAllBelongToTenant(
          db
            .select({ id: locations.id })
            .from(locations)
            .where(
              inTenant(
                locations.tenantId,
                locations.id,
                context.tenantId,
                locationIds,
              ),
            ),
          locationIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(staffLocationAssignments)
            .where(
              and(
                eq(staffLocationAssignments.tenantId, context.tenantId),
                eq(staffLocationAssignments.staffId, staffId),
              ),
            );
          if (locationIds.length)
            await tx.insert(staffLocationAssignments).values(
              [...new Set(locationIds)].map((locationId) => ({
                tenantId: context.tenantId,
                staffId,
                locationId,
              })),
            );
        });
        return { ok: true };
      },
    },
    /* --- Skills ---------------------------------------------------------- */
    skills: {
      async set(
        context: TenantContext,
        staffId: string,
        skillIds: readonly string[],
      ) {
        assertPermission(context, 'manage_staff');
        await owned(context, staffId);
        await assertAllBelongToTenant(
          db
            .select({ id: skills.id })
            .from(skills)
            .where(
              inTenant(skills.tenantId, skills.id, context.tenantId, skillIds),
            ),
          skillIds,
        );
        await db.transaction(async (tx) => {
          await tx
            .delete(staffSkills)
            .where(
              and(
                eq(staffSkills.tenantId, context.tenantId),
                eq(staffSkills.staffId, staffId),
              ),
            );
          if (skillIds.length)
            await tx.insert(staffSkills).values(
              [...new Set(skillIds)].map((skillId) => ({
                tenantId: context.tenantId,
                staffId,
                skillId,
              })),
            );
        });
        return { ok: true };
      },
    },
    /* --- Service eligibility and overrides ------------------------------- */
    services: {
      /**
       * Record or clear an explicit eligibility decision for one service.
       * A null value removes the row, returning the technician to the
       * service's configured default behavior.
       */
      async setEligibility(
        context: TenantContext,
        staffId: string,
        serviceId: string,
        eligibility: 'eligible' | 'ineligible' | null,
      ) {
        assertPermission(context, 'manage_staff');
        await owned(context, staffId);
        await assertAllBelongToTenant(
          db
            .select({ id: services.id })
            .from(services)
            .where(
              inTenant(services.tenantId, services.id, context.tenantId, [
                serviceId,
              ]),
            ),
          [serviceId],
        );
        if (eligibility === null) {
          await db
            .delete(staffServices)
            .where(
              and(
                eq(staffServices.tenantId, context.tenantId),
                eq(staffServices.staffId, staffId),
                eq(staffServices.serviceId, serviceId),
              ),
            );
          return { ok: true };
        }
        await db
          .insert(staffServices)
          .values({
            tenantId: context.tenantId,
            staffId,
            serviceId,
            eligibility,
          })
          .onConflictDoUpdate({
            target: [staffServices.staffId, staffServices.serviceId],
            set: { eligibility },
          });
        return { ok: true };
      },
      /**
       * Set the per-technician price, duration, and buffer overrides for one
       * service. Every field is independently nullable; a row whose fields are
       * all null is deleted rather than kept as a no-op.
       */
      async setOverride(
        context: TenantContext,
        staffId: string,
        serviceId: string,
        input: {
          priceOverride: number | null;
          durationOverrideMinutes: number | null;
          bufferBeforeOverrideMinutes: number | null;
          bufferAfterOverrideMinutes: number | null;
        },
      ) {
        assertPermission(context, 'manage_staff');
        await owned(context, staffId);
        await assertAllBelongToTenant(
          db
            .select({ id: services.id })
            .from(services)
            .where(
              inTenant(services.tenantId, services.id, context.tenantId, [
                serviceId,
              ]),
            ),
          [serviceId],
        );
        const empty = Object.values(input).every((value) => value === null);
        if (empty) {
          await db
            .delete(staffServiceOverrides)
            .where(
              and(
                eq(staffServiceOverrides.tenantId, context.tenantId),
                eq(staffServiceOverrides.staffId, staffId),
                eq(staffServiceOverrides.serviceId, serviceId),
              ),
            );
          return { ok: true };
        }
        await db
          .insert(staffServiceOverrides)
          .values({ ...input, tenantId: context.tenantId, staffId, serviceId })
          .onConflictDoUpdate({
            target: [
              staffServiceOverrides.staffId,
              staffServiceOverrides.serviceId,
            ],
            set: input,
          });
        return { ok: true };
      },
      list: async (context: TenantContext, staffId: string) => {
        await owned(context, staffId);
        return (
          await db
            .select()
            .from(staffServiceOverrides)
            .where(
              and(
                eq(staffServiceOverrides.tenantId, context.tenantId),
                eq(staffServiceOverrides.staffId, staffId),
              ),
            )
        ).map(present);
      },
    },
  };
}
