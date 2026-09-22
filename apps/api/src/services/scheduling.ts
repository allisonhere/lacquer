import { and, eq, asc, gte, lte, ne } from 'drizzle-orm';
import {
  tenantSchedulingSettings,
  staffScheduleBlocks,
  staffTimeOff,
  staffAvailabilityOverrides,
  staffProfiles,
  staffLocationAssignments,
  locations,
  type Database,
} from '@lacquer/db';
import {
  findOverlap,
  zonedWallClockToUtc,
  parseLocalDate,
} from '@lacquer/booking-engine';
import type {
  SchedulingSettingsPatch,
  ScheduleBlockInput,
  TimeOffInput,
  AvailabilityOverrideInput,
} from '@lacquer/schemas';
import { assertPermission, type TenantContext } from '../tenant-context.js';
import { present } from './present.js';
import { requireOne, requireInserted, conflict, invalid } from './support.js';
/**
 * Scheduling configuration and staff availability data.
 *
 * Nothing here generates slots. It stores the five distinct concepts Milestone
 * 3 must be able to tell apart, each as its own first-class rows rather than
 * buried in JSON:
 *
 *   1. recurring weekly work blocks   (staff_schedule_blocks, kind 'work')
 *   2. recurring weekly breaks        (staff_schedule_blocks, kind 'break')
 *   3. dated absence                  (staff_time_off, absolute instants)
 *   4. dated added availability       (staff_availability_overrides, 'added')
 *   5. dated removed availability     (staff_availability_overrides, 'removed')
 */
export function createSchedulingService(db: Database) {
  async function ownedStaff(context: TenantContext, staffId: string) {
    return requireOne(
      await db
        .select({ id: staffProfiles.id })
        .from(staffProfiles)
        .where(
          and(
            eq(staffProfiles.tenantId, context.tenantId),
            eq(staffProfiles.id, staffId),
          ),
        ),
    );
  }
  /**
   * A schedule block only means something at a location the technician
   * actually works at, so this resolves the location and its timezone in the
   * same check.
   */
  async function assignedLocation(
    context: TenantContext,
    staffId: string,
    locationId: string,
  ) {
    const [row] = await db
      .select({ id: locations.id, timezone: locations.timezone })
      .from(staffLocationAssignments)
      .innerJoin(
        locations,
        and(
          eq(locations.id, staffLocationAssignments.locationId),
          eq(locations.tenantId, staffLocationAssignments.tenantId),
        ),
      )
      .where(
        and(
          eq(staffLocationAssignments.tenantId, context.tenantId),
          eq(staffLocationAssignments.staffId, staffId),
          eq(staffLocationAssignments.locationId, locationId),
          eq(staffLocationAssignments.active, true),
        ),
      );
    if (!row)
      throw invalid(
        'Assign this team member to the location before scheduling them there.',
      );
    return row;
  }
  /**
   * Reject a recurring block that overlaps an existing one of the same kind on
   * the same weekday at the same location. Split shifts (09:00-13:00 and
   * 16:00-20:00) are the reason overlap is checked rather than simply limiting
   * a weekday to one row. Breaks are checked against breaks, not against work,
   * because a break is meant to sit inside working time.
   */
  async function assertNoOverlap(
    context: TenantContext,
    block: {
      staffId: string;
      locationId: string;
      kind: 'work' | 'break';
      weekday: number;
      startMinute: number;
      endMinute: number;
    },
    excludeId?: string,
  ) {
    const existing = await db
      .select({
        startMinute: staffScheduleBlocks.startMinute,
        endMinute: staffScheduleBlocks.endMinute,
      })
      .from(staffScheduleBlocks)
      .where(
        and(
          eq(staffScheduleBlocks.tenantId, context.tenantId),
          eq(staffScheduleBlocks.staffId, block.staffId),
          eq(staffScheduleBlocks.locationId, block.locationId),
          eq(staffScheduleBlocks.kind, block.kind),
          eq(staffScheduleBlocks.weekday, block.weekday),
          eq(staffScheduleBlocks.active, true),
          excludeId ? ne(staffScheduleBlocks.id, excludeId) : undefined,
        ),
      );
    if (
      findOverlap([
        ...existing,
        { startMinute: block.startMinute, endMinute: block.endMinute },
      ])
    )
      throw conflict(
        block.kind === 'break'
          ? 'This break overlaps another break on the same day.'
          : 'This shift overlaps another shift on the same day.',
      );
  }
  return {
    /* --- Salon-wide scheduling settings ---------------------------------- */
    settings: {
      /**
       * Read the salon's settings, creating the row with strong defaults on
       * first access so every tenant always has a complete configuration.
       */
      async get(context: TenantContext) {
        const [existing] = await db
          .select()
          .from(tenantSchedulingSettings)
          .where(eq(tenantSchedulingSettings.tenantId, context.tenantId));
        if (existing) return present(existing);
        const [created] = await db
          .insert(tenantSchedulingSettings)
          .values({ tenantId: context.tenantId })
          .onConflictDoNothing()
          .returning();
        if (created) return present(created);
        return present(
          requireOne(
            await db
              .select()
              .from(tenantSchedulingSettings)
              .where(eq(tenantSchedulingSettings.tenantId, context.tenantId)),
          ),
        );
      },
      async update(context: TenantContext, input: SchedulingSettingsPatch) {
        assertPermission(context, 'manage_settings');
        return present(
          requireInserted(
            await db
              .insert(tenantSchedulingSettings)
              .values({ tenantId: context.tenantId, ...input })
              .onConflictDoUpdate({
                target: tenantSchedulingSettings.tenantId,
                set: input,
              })
              .returning(),
            'Scheduling settings',
          ),
        );
      },
    },
    /* --- Recurring weekly schedule --------------------------------------- */
    schedule: {
      list: async (context: TenantContext, staffId: string) => {
        await ownedStaff(context, staffId);
        return (
          await db
            .select()
            .from(staffScheduleBlocks)
            .where(
              and(
                eq(staffScheduleBlocks.tenantId, context.tenantId),
                eq(staffScheduleBlocks.staffId, staffId),
              ),
            )
            .orderBy(
              asc(staffScheduleBlocks.weekday),
              asc(staffScheduleBlocks.startMinute),
            )
        ).map(present);
      },
      async create(
        context: TenantContext,
        staffId: string,
        input: ScheduleBlockInput,
      ) {
        assertPermission(context, 'manage_staff');
        await ownedStaff(context, staffId);
        await assignedLocation(context, staffId, input.locationId);
        await assertNoOverlap(context, { ...input, staffId });
        return present(
          requireInserted(
            await db
              .insert(staffScheduleBlocks)
              .values({ ...input, tenantId: context.tenantId, staffId })
              .returning(),
            'Schedule block',
          ),
        );
      },
      async update(
        context: TenantContext,
        staffId: string,
        blockId: string,
        input: Partial<ScheduleBlockInput>,
      ) {
        assertPermission(context, 'manage_staff');
        const current = requireOne(
          await db
            .select()
            .from(staffScheduleBlocks)
            .where(
              and(
                eq(staffScheduleBlocks.tenantId, context.tenantId),
                eq(staffScheduleBlocks.staffId, staffId),
                eq(staffScheduleBlocks.id, blockId),
              ),
            ),
        );
        const merged = { ...current, ...input };
        if (input.locationId)
          await assignedLocation(context, staffId, input.locationId);
        await assertNoOverlap(
          context,
          {
            staffId,
            locationId: merged.locationId,
            kind: merged.kind,
            weekday: merged.weekday,
            startMinute: merged.startMinute,
            endMinute: merged.endMinute,
          },
          blockId,
        );
        return present(
          requireOne(
            await db
              .update(staffScheduleBlocks)
              .set(input)
              .where(
                and(
                  eq(staffScheduleBlocks.tenantId, context.tenantId),
                  eq(staffScheduleBlocks.staffId, staffId),
                  eq(staffScheduleBlocks.id, blockId),
                ),
              )
              .returning(),
          ),
        );
      },
      async remove(context: TenantContext, staffId: string, blockId: string) {
        assertPermission(context, 'manage_staff');
        requireOne(
          await db
            .delete(staffScheduleBlocks)
            .where(
              and(
                eq(staffScheduleBlocks.tenantId, context.tenantId),
                eq(staffScheduleBlocks.staffId, staffId),
                eq(staffScheduleBlocks.id, blockId),
              ),
            )
            .returning(),
        );
        return { ok: true };
      },
      /**
       * Replace a technician's whole week at one location atomically. This is
       * what the schedule editor saves: it is far easier to reason about than
       * a diff of individual blocks, and it validates the submitted week as a
       * unit before writing anything.
       */
      async replace(
        context: TenantContext,
        staffId: string,
        locationId: string,
        blocks: readonly {
          kind: 'work' | 'break';
          weekday: number;
          startMinute: number;
          endMinute: number;
        }[],
      ) {
        assertPermission(context, 'manage_staff');
        await ownedStaff(context, staffId);
        await assignedLocation(context, staffId, locationId);
        for (const block of blocks)
          if (block.startMinute >= block.endMinute)
            throw invalid('Each shift must start before it ends.');
        // Validate the whole submitted week before writing, per weekday and kind.
        for (const kind of ['work', 'break'] as const)
          for (let weekday = 1; weekday <= 7; weekday += 1) {
            const sameDay = blocks.filter(
              (block) => block.kind === kind && block.weekday === weekday,
            );
            if (findOverlap(sameDay))
              throw conflict(
                kind === 'break'
                  ? 'Two breaks overlap on the same day.'
                  : 'Two shifts overlap on the same day.',
              );
          }
        await db.transaction(async (tx) => {
          await tx
            .delete(staffScheduleBlocks)
            .where(
              and(
                eq(staffScheduleBlocks.tenantId, context.tenantId),
                eq(staffScheduleBlocks.staffId, staffId),
                eq(staffScheduleBlocks.locationId, locationId),
              ),
            );
          if (blocks.length)
            await tx.insert(staffScheduleBlocks).values(
              blocks.map((block) => ({
                ...block,
                tenantId: context.tenantId,
                staffId,
                locationId,
              })),
            );
        });
        return (
          await db
            .select()
            .from(staffScheduleBlocks)
            .where(
              and(
                eq(staffScheduleBlocks.tenantId, context.tenantId),
                eq(staffScheduleBlocks.staffId, staffId),
              ),
            )
            .orderBy(
              asc(staffScheduleBlocks.weekday),
              asc(staffScheduleBlocks.startMinute),
            )
        ).map(present);
      },
    },
    /* --- Time off -------------------------------------------------------- */
    timeOff: {
      list: async (
        context: TenantContext,
        staffId: string,
        range?: { from?: string; to?: string },
      ) => {
        await ownedStaff(context, staffId);
        return (
          await db
            .select()
            .from(staffTimeOff)
            .where(
              and(
                eq(staffTimeOff.tenantId, context.tenantId),
                eq(staffTimeOff.staffId, staffId),
                range?.from
                  ? gte(staffTimeOff.endsAt, new Date(range.from))
                  : undefined,
                range?.to
                  ? lte(staffTimeOff.startsAt, new Date(range.to))
                  : undefined,
              ),
            )
            .orderBy(asc(staffTimeOff.startsAt))
        ).map((row) => ({
          ...present(row),
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        }));
      },
      /**
       * Time off is stored as absolute instants. The location's timezone is
       * recorded alongside so the entry can still be rendered as the local days
       * the salon meant, even if the location's timezone is later corrected.
       */
      async create(
        context: TenantContext,
        staffId: string,
        input: TimeOffInput,
      ) {
        assertPermission(context, 'manage_staff');
        await ownedStaff(context, staffId);
        let timezone = 'UTC';
        if (input.locationId) {
          const location = await assignedLocation(
            context,
            staffId,
            input.locationId,
          );
          timezone = location.timezone;
        } else {
          // Salon-wide absence: record the technician's primary location zone
          // so an all-day entry has a meaningful local reference.
          const [primary] = await db
            .select({ timezone: locations.timezone })
            .from(staffLocationAssignments)
            .innerJoin(
              locations,
              and(
                eq(locations.id, staffLocationAssignments.locationId),
                eq(locations.tenantId, staffLocationAssignments.tenantId),
              ),
            )
            .where(
              and(
                eq(staffLocationAssignments.tenantId, context.tenantId),
                eq(staffLocationAssignments.staffId, staffId),
                eq(staffLocationAssignments.active, true),
              ),
            )
            .orderBy(asc(locations.name))
            .limit(1);
          if (primary) timezone = primary.timezone;
        }
        const row = requireInserted(
          await db
            .insert(staffTimeOff)
            .values({
              tenantId: context.tenantId,
              staffId,
              locationId: input.locationId,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              allDay: input.allDay,
              reason: input.reason,
              locationTimezone: timezone,
              createdBy: context.userId,
            })
            .returning(),
          'Time off',
        );
        return {
          ...present(row),
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        };
      },
      /** Cancelling keeps the record; deleting would erase why a day was blocked. */
      async update(
        context: TenantContext,
        staffId: string,
        timeOffId: string,
        input: { status?: 'scheduled' | 'cancelled'; reason?: string | null },
      ) {
        assertPermission(context, 'manage_staff');
        const row = requireOne(
          await db
            .update(staffTimeOff)
            .set(input)
            .where(
              and(
                eq(staffTimeOff.tenantId, context.tenantId),
                eq(staffTimeOff.staffId, staffId),
                eq(staffTimeOff.id, timeOffId),
              ),
            )
            .returning(),
        );
        return {
          ...present(row),
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        };
      },
    },
    /* --- Dated availability overrides ------------------------------------ */
    overrides: {
      list: async (context: TenantContext, staffId: string) => {
        await ownedStaff(context, staffId);
        return (
          await db
            .select()
            .from(staffAvailabilityOverrides)
            .where(
              and(
                eq(staffAvailabilityOverrides.tenantId, context.tenantId),
                eq(staffAvailabilityOverrides.staffId, staffId),
              ),
            )
            .orderBy(
              asc(staffAvailabilityOverrides.localDate),
              asc(staffAvailabilityOverrides.startMinute),
            )
        ).map(present);
      },
      async create(
        context: TenantContext,
        staffId: string,
        input: AvailabilityOverrideInput,
      ) {
        assertPermission(context, 'manage_staff');
        await ownedStaff(context, staffId);
        const location = await assignedLocation(
          context,
          staffId,
          input.locationId,
        );
        // Confirm the local date resolves in the location's zone. This never
        // stores an instant — the row stays local-date plus local minutes — but
        // it rejects a date that cannot be interpreted there at all.
        zonedWallClockToUtc(
          location.timezone,
          parseLocalDate(input.localDate),
          input.startMinute,
        );
        return present(
          requireInserted(
            await db
              .insert(staffAvailabilityOverrides)
              .values({ ...input, tenantId: context.tenantId, staffId })
              .returning(),
            'Availability override',
          ),
        );
      },
      async remove(
        context: TenantContext,
        staffId: string,
        overrideId: string,
      ) {
        assertPermission(context, 'manage_staff');
        requireOne(
          await db
            .delete(staffAvailabilityOverrides)
            .where(
              and(
                eq(staffAvailabilityOverrides.tenantId, context.tenantId),
                eq(staffAvailabilityOverrides.staffId, staffId),
                eq(staffAvailabilityOverrides.id, overrideId),
              ),
            )
            .returning(),
        );
        return { ok: true };
      },
    },
  };
}
