import {
  resolvePublicContext,
  type PublicBookingContext,
} from '../public-context.js';
import {
  guestContactSchema,
  publicCreateSchema,
  type PublicCreate,
} from '@lacquer/schemas';
import { appointmentContacts, appointmentPublicAccess } from '@lacquer/db';
import { createHash, createHmac } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  appointments,
  appointmentServices,
  appointmentAddons,
  appointmentStaffAssignments,
  appointmentStatusHistory,
  appointmentIdempotency,
  locations,
  staffProfiles,
  services,
  serviceVariants,
  addOns,
  serviceAddOns,
  tenantSchedulingSettings,
  staffScheduleBlocks,
  staffAvailabilityOverrides,
  staffTimeOff,
  type Database,
} from '@lacquer/db';
import {
  appointmentCreateSchema,
  availabilitySearchSchema,
  appointmentRescheduleSchema,
  appointmentCancelSchema,
  appointmentListQuerySchema,
  schedulingSettingsInputSchema,
  type AvailabilitySearchInput,
  type AppointmentCreateInput,
  type AppointmentListQuery,
} from '@lacquer/schemas';
import {
  addLocalDays,
  localDateAt,
  candidateStarts,
  composeSchedule,
  bookingOccupancy,
  slotFailure,
  resolveActiveProcessing,
  getEffectiveMinimumBookingNotice,
  getEffectiveDailyLimits,
  getEffectiveAutomaticBreakRule,
  occupancyMinutes,
  maxMinorUnits,
  type BookingPart,
  type ExistingBooking,
  type SlotRules,
} from '@lacquer/booking-engine';
import {
  assertPermission,
  resolveTenantContext,
  type TenantContext,
} from '../tenant-context.js';
import { ApiFault, notFound } from '../errors.js';
import { createEligibilityService } from './eligibility.js';
import { requireOne, groupBy, invalid } from './support.js';

type BookingContext = TenantContext | PublicBookingContext;
const actor = (ctx: BookingContext) =>
  'publicBooking' in ctx ? null : ctx.userId;
function authorize(ctx: BookingContext) {
  if (!('publicBooking' in ctx)) assertPermission(ctx, 'manage_calendar');
}
type Session = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;
type Selection = Pick<
  AppointmentCreateInput,
  'locationId' | 'staffId' | 'anyAvailable' | 'services' | 'source'
>;
type ServiceSnapshot = typeof appointmentServices.$inferSelect;
type AddonSnapshot = typeof appointmentAddons.$inferSelect;
interface ResolvedPart extends BookingPart {
  serviceId: string;
  variantId: string | null;
  serviceName: string;
  variantName: string | null;
  priceMinorUnits: number;
  addons: {
    addOnId: string;
    name: string;
    priceMinorUnits: number;
    durationMinutes: number;
  }[];
}
const fault = (code: string) =>
  new ApiFault(409, code, 'The requested booking is not available.');
const scoped = (
  table: { tenantId: typeof appointments.tenantId },
  ctx: BookingContext,
) => eq(table.tenantId, ctx.tenantId);
function snapshotParts(
  rows: ServiceSnapshot[],
  addons: AddonSnapshot[],
): ResolvedPart[] {
  const byService = groupBy(addons, (a) => a.appointmentServiceId);
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const children = byService.get(row.id) ?? [];
      return {
        ...row,
        addons: children,
        addOnMinutes: children.reduce((sum, a) => sum + a.durationMinutes, 0),
      };
    });
}
type Serialized<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
const serialize = <T>(row: T): Serialized<T> => JSON.parse(JSON.stringify(row));
async function detail(db: Session, context: BookingContext, id: string) {
  const [row] = await db
    .select()
    .from(appointments)
    .where(and(scoped(appointments, context), eq(appointments.id, id)));
  if (!row)
    throw new ApiFault(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');
  const [serviceRows, addonRows, staffAssignments, history, contacts] =
    await Promise.all([
      db
        .select()
        .from(appointmentServices)
        .where(
          and(
            eq(appointmentServices.tenantId, context.tenantId),
            eq(appointmentServices.appointmentId, id),
          ),
        )
        .orderBy(appointmentServices.position),
      db
        .select({ addon: appointmentAddons })
        .from(appointmentAddons)
        .innerJoin(
          appointmentServices,
          and(
            eq(appointmentServices.id, appointmentAddons.appointmentServiceId),
            eq(appointmentServices.tenantId, appointmentAddons.tenantId),
          ),
        )
        .where(
          and(
            eq(appointmentAddons.tenantId, context.tenantId),
            eq(appointmentServices.appointmentId, id),
          ),
        ),
      db
        .select()
        .from(appointmentStaffAssignments)
        .where(
          and(
            eq(appointmentStaffAssignments.tenantId, context.tenantId),
            eq(appointmentStaffAssignments.appointmentId, id),
          ),
        ),
      db
        .select()
        .from(appointmentStatusHistory)
        .where(
          and(
            eq(appointmentStatusHistory.tenantId, context.tenantId),
            eq(appointmentStatusHistory.appointmentId, id),
          ),
        )
        .orderBy(
          appointmentStatusHistory.createdAt,
          appointmentStatusHistory.id,
        ),
      db.select().from(appointmentContacts).where(and(eq(appointmentContacts.tenantId,context.tenantId),eq(appointmentContacts.appointmentId,id))),
    ]);
  return {
    ...row,
    contact: contacts[0] ?? null,
    services: serviceRows,
    addons: addonRows.map((r) => r.addon),
    staffAssignments,
    history,
  };
}
/** All reads occur before the candidate loop. Eligibility queries are bounded by selected services, never staff or slots. */
async function load(
  db: Session,
  context: BookingContext,
  selection: Selection,
  preserved?: ResolvedPart[],
) {
  const location = requireOne(
    await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, context.tenantId),
          eq(locations.id, selection.locationId),
        ),
      ),
  );
  if (!location.active) throw fault('SLOT_UNAVAILABLE');
  const [
    staffRows,
    settingsRows,
    catalog,
    variants,
    addonRows,
    addonLinks,
    blocks,
    overrides,
    timeOff,
    bookedRows,
    snapshotRows,
    snapshotAddonRows,
  ] = await Promise.all([
    db
      .select()
      .from(staffProfiles)
      .where(eq(staffProfiles.tenantId, context.tenantId)),
    db
      .select()
      .from(tenantSchedulingSettings)
      .where(eq(tenantSchedulingSettings.tenantId, context.tenantId)),
    db
      .select()
      .from(services)
      .where(
        and(
          eq(services.tenantId, context.tenantId),
          inArray(
            services.id,
            selection.services.map((s) => s.serviceId),
          ),
        ),
      ),
    db
      .select()
      .from(serviceVariants)
      .where(eq(serviceVariants.tenantId, context.tenantId)),
    db.select().from(addOns).where(eq(addOns.tenantId, context.tenantId)),
    db
      .select()
      .from(serviceAddOns)
      .where(eq(serviceAddOns.tenantId, context.tenantId)),
    db
      .select()
      .from(staffScheduleBlocks)
      .where(
        and(
          eq(staffScheduleBlocks.tenantId, context.tenantId),
          eq(staffScheduleBlocks.locationId, location.id),
        ),
      ),
    db
      .select()
      .from(staffAvailabilityOverrides)
      .where(
        and(
          eq(staffAvailabilityOverrides.tenantId, context.tenantId),
          eq(staffAvailabilityOverrides.locationId, location.id),
        ),
      ),
    db
      .select()
      .from(staffTimeOff)
      .where(eq(staffTimeOff.tenantId, context.tenantId)),
    db
      .select()
      .from(appointments)
      .where(
        and(scoped(appointments, context), eq(appointments.status, 'booked')),
      ),
    db
      .select({ part: appointmentServices })
      .from(appointmentServices)
      .innerJoin(
        appointments,
        and(
          eq(appointments.id, appointmentServices.appointmentId),
          eq(appointments.tenantId, appointmentServices.tenantId),
        ),
      )
      .where(
        and(scoped(appointments, context), eq(appointments.status, 'booked')),
      ),
    db
      .select({ addon: appointmentAddons })
      .from(appointmentAddons)
      .innerJoin(
        appointmentServices,
        and(
          eq(appointmentServices.id, appointmentAddons.appointmentServiceId),
          eq(appointmentServices.tenantId, appointmentAddons.tenantId),
        ),
      )
      .innerJoin(
        appointments,
        and(
          eq(appointments.id, appointmentServices.appointmentId),
          eq(appointments.tenantId, appointmentServices.tenantId),
        ),
      )
      .where(
        and(scoped(appointments, context), eq(appointments.status, 'booked')),
      ),
  ]);
  if (selection.staffId && !staffRows.some((s) => s.id === selection.staffId))
    throw notFound();
  const settings = settingsRows[0] ?? schedulingSettingsInputSchema.parse({});
  // Validate all substituted IDs even when there are no eligible staff.
  for (const item of selection.services) {
    const service = catalog.find((s) => s.id === item.serviceId);
    if (!service) throw notFound();
    if (
      'publicBooking' in context &&
      (!service.active ||
        !service.visibleOnline ||
        !service.acceptsOnlineBooking)
    )
      throw notFound();
    if (
      item.variantId &&
      !variants.some(
        (v) => v.id === item.variantId && v.serviceId === item.serviceId,
      )
    )
      throw notFound();
    for (const id of item.addOnIds)
      if (!addonRows.some((a) => a.id === id)) throw notFound();
    if (!preserved) {
      const links = addonLinks.filter((a) => a.serviceId === item.serviceId);
      const groups = new Set<string>();
      for (const id of item.addOnIds) {
        const addon = addonRows.find((a) => a.id === id)!;
        const link = links.find((a) => a.addOnId === id);
        if (!addon.active || (!addon.globallyAvailable && !link))
          throw invalid('Add-on is unavailable for this service.');
        if (link?.exclusiveGroup && groups.has(link.exclusiveGroup))
          throw invalid('Select at most one add-on from an exclusive group.');
        if (link?.exclusiveGroup) groups.add(link.exclusiveGroup);
      }
      if (links.some((l) => l.required && !item.addOnIds.includes(l.addOnId)))
        throw invalid('A required add-on is missing.');
    }
  }
  const evaluations = await Promise.all(
    selection.services.map((item) =>
      createEligibilityService(db).forService(context, item.serviceId, {
        locationId: location.id,
        variantId: item.variantId,
        onlineBookingRequested: selection.source === 'online',
      }),
    ),
  );
  if (
    evaluations.some((rows) =>
      rows.some((r) => r.reasons.includes('service_not_offered_at_location')),
    )
  )
    throw fault('SERVICE_NOT_AVAILABLE_AT_LOCATION');
  const eligible = staffRows
    .filter(
      (s) =>
        (!selection.staffId || s.id === selection.staffId) &&
        evaluations.every((rows) =>
          rows.some((r) => r.staffId === s.id && r.eligible),
        ),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (selection.staffId && !eligible.length) throw fault('STAFF_NOT_QUALIFIED');
  const partsByStaff = new Map<string, ResolvedPart[]>();
  for (const staff of eligible) {
    const parts =
      preserved ??
      selection.services.map((item, index) => {
        const service = catalog.find((s) => s.id === item.serviceId)!;
        const variant = variants.find((v) => v.id === item.variantId);
        const effective = evaluations[index]!.find(
          (r) => r.staffId === staff.id,
        )!;
        const addons = item.addOnIds
          .map((id) => addonRows.find((a) => a.id === id)!)
          .map((a) => ({
            addOnId: a.id,
            name: a.name,
            priceMinorUnits: a.price,
            durationMinutes: a.durationMinutes,
          }));
        return {
          serviceId: service.id,
          variantId: variant?.id ?? null,
          serviceName: service.name,
          variantName: variant?.name ?? null,
          priceMinorUnits: effective.price,
          durationMinutes: effective.durationMinutes,
          bufferBeforeMinutes: effective.bufferBeforeMinutes,
          bufferAfterMinutes: effective.bufferAfterMinutes,
          ...resolveActiveProcessing(
            effective.durationMinutes,
            service.activeTimeMinutes,
            service.processingTimeMinutes,
          ),
          addons,
          addOnMinutes: addons.reduce((sum, a) => sum + a.durationMinutes, 0),
        };
      });
    const subtotal = parts.reduce(
      (sum, p) =>
        sum +
        p.priceMinorUnits +
        p.addons.reduce((s, a) => s + a.priceMinorUnits, 0),
      0,
    );
    if (subtotal > maxMinorUnits)
      throw invalid('Booking subtotal is too large.');
    partsByStaff.set(staff.id, parts);
  }
  const snapshots = groupBy(
    snapshotRows.map((r) => r.part),
    (r) => r.appointmentId,
  );
  const allAddons = snapshotAddonRows.map((r) => r.addon);
  const existingByStaff = groupBy(
    bookedRows.map((row) => ({
      ...bookingOccupancy(
        row.startsAt.getTime(),
        row.locationId,
        snapshotParts(snapshots.get(row.id) ?? [], allAddons),
      ),
      id: row.id,
      staffId: row.primaryStaffId,
    })),
    (r) => r.staffId,
  );
  return {
    location,
    settings,
    eligible,
    partsByStaff,
    blocks: groupBy(blocks, (r) => r.staffId),
    overrides: groupBy(overrides, (r) => r.staffId),
    timeOff: groupBy(
      timeOff.filter(
        (r) => r.locationId === null || r.locationId === location.id,
      ),
      (r) => r.staffId,
    ),
    existingByStaff,
  };
}
type Loaded = Awaited<ReturnType<typeof load>>;
function rulesFor(
  data: Loaded,
  staff: Loaded['eligible'][number],
  now: number,
): SlotRules {
  return {
    timezone: data.location.timezone,
    now,
    minimumNoticeMinutes: getEffectiveMinimumBookingNotice({
      settings: data.settings,
      staff,
    }),
    maximumHorizonDays: data.settings.maximumBookingHorizonDays,
    limits: getEffectiveDailyLimits(staff),
    automaticBreak: getEffectiveAutomaticBreakRule({
      settings: data.settings,
      staff,
    }),
    mode: data.settings.doubleBookingMode,
  };
}
function workFor(data: Loaded, staffId: string, date: string) {
  return composeSchedule({
    date,
    timezone: data.location.timezone,
    blocks: data.blocks.get(staffId) ?? [],
    overrides: data.overrides.get(staffId) ?? [],
    timeOff: data.timeOff.get(staffId) ?? [],
  });
}
function normalizedSlot(data: Loaded, staffId: string, startsAt: number) {
  const parts = data.partsByStaff.get(staffId)!;
  const occupancy = bookingOccupancy(startsAt, data.location.id, parts);
  return {
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(occupancy.endsAt).toISOString(),
    staffId,
    locationId: data.location.id,
    totalServiceMinutes: occupancy.serviceMinutes,
    totalOccupancyMinutes: occupancyMinutes(occupancy),
    subtotalMinorUnits: parts.reduce(
      (sum, p) =>
        sum +
        p.priceMinorUnits +
        p.addons.reduce((s, a) => s + a.priceMinorUnits, 0),
      0,
    ),
  };
}
function claim(
  data: Loaded,
  startsAt: number,
  now: number,
  forceConflict: boolean,
  excludeId?: string,
) {
  const date = localDateAt(data.location.timezone, startsAt);
  if (!candidateStarts(date, data.location.timezone).includes(startsAt))
    throw fault('SLOT_UNAVAILABLE');
  let failure = 'SLOT_UNAVAILABLE';
  for (const staff of data.eligible) {
    const occupancy = bookingOccupancy(
      startsAt,
      data.location.id,
      data.partsByStaff.get(staff.id)!,
    );
    const existing: ExistingBooking[] = (
      data.existingByStaff.get(staff.id) ?? []
    ).filter((r) => r.id !== excludeId);
    const reason = slotFailure(
      occupancy,
      workFor(data, staff.id, date),
      existing,
      rulesFor(data, staff, now),
      forceConflict,
    );
    if (!reason)
      return { staff, slot: normalizedSlot(data, staff.id, startsAt) };
    failure = reason;
  }
  throw fault(failure);
}
/** Coarse tenant lock: every booking mutation uses the same transaction-bound key. */
async function lock(tx: Session, context: BookingContext) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`lacquer:booking:${context.tenantId}`}, 0))`,
  );
  // Refresh membership/permission after waiting for the lock.
  if ('publicBooking' in context) {
    const fresh = await resolvePublicContext(tx, context.slug);
    // Slug reassignment must never move a write outside the tenant we locked.
    if (fresh.tenantId !== context.tenantId) throw notFound();
    return fresh;
  }
  const fresh = await resolveTenantContext(
    tx,
    context.userId,
    context.tenantId,
  );
  assertPermission(fresh, 'manage_calendar');
  return fresh;
}
export function createBookingService(
  db: Database,
  clock: () => number = Date.now,
) {
  const api = {
    async getAvailableSlots(
      context: BookingContext,
      raw: AvailabilitySearchInput,
    ) {
      authorize(context);
      const input = availabilitySearchSchema.parse(raw);
      if ('publicBooking' in context && input.source !== 'online')
        throw invalid('Invalid public source');
      const data = await load(db, context, input);
      const slots: ReturnType<typeof normalizedSlot>[] = [];
      const now = clock();
      for (
        let date = input.date;
        date <= (input.endDate ?? input.date);
        date = addLocalDays(date, 1)
      ) {
        const starts = candidateStarts(date, data.location.timezone);
        for (const staff of data.eligible) {
          const work = workFor(data, staff.id, date),
            rules = rulesFor(data, staff, now);
          for (const start of starts)
            if (
              !slotFailure(
                bookingOccupancy(
                  start,
                  data.location.id,
                  data.partsByStaff.get(staff.id)!,
                ),
                work,
                data.existingByStaff.get(staff.id) ?? [],
                rules,
              )
            )
              slots.push(normalizedSlot(data, staff.id, start));
        }
      }
      return slots.sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) ||
          a.staffId.localeCompare(b.staffId),
      );
    },
    async get(context: TenantContext, id: string) {
      authorize(context);
      return serialize(await detail(db, context, id));
    },
    async list(context: TenantContext, raw: AppointmentListQuery) {
      authorize(context);
      const input = appointmentListQuerySchema.parse(raw);
      if (input.locationId)
        requireOne(
          await db
            .select()
            .from(locations)
            .where(
              and(
                eq(locations.tenantId, context.tenantId),
                eq(locations.id, input.locationId),
              ),
            ),
        );
      if (input.staffId)
        requireOne(
          await db
            .select()
            .from(staffProfiles)
            .where(
              and(
                eq(staffProfiles.tenantId, context.tenantId),
                eq(staffProfiles.id, input.staffId),
              ),
            ),
        );
      return serialize(
        await db
          .select()
          .from(appointments)
          .where(
            and(
              scoped(appointments, context),
              input.locationId
                ? eq(appointments.locationId, input.locationId)
                : undefined,
              input.staffId
                ? eq(appointments.primaryStaffId, input.staffId)
                : undefined,
              input.status ? eq(appointments.status, input.status) : undefined,
              input.startsAfter
                ? gte(appointments.startsAt, new Date(input.startsAfter))
                : undefined,
              input.startsBefore
                ? lt(appointments.startsAt, new Date(input.startsBefore))
                : undefined,
            ),
          )
          .orderBy(asc(appointments.startsAt), asc(appointments.id))
          .limit(input.limit)
          .offset(input.offset),
      );
    },
    async createAppointment(
      context: BookingContext,
      raw: AppointmentCreateInput,
      guest?: { contact: PublicCreate['contact']; secret: string },
    ) {
      authorize(context);
      const input = appointmentCreateSchema.parse(raw);
      if (
        'publicBooking' in context &&
        (!guest ||
          input.source !== 'online' ||
          input.forceConflict ||
          input.anyAvailable ||
          input.notes !== null)
      )
        throw invalid('Invalid guest booking');
      const contact = guest
        ? guestContactSchema.parse(guest.contact)
        : undefined;
      // Schema parsing fixes field order/defaults; add-on order has no scheduling meaning.
      const canonical = {
        ...input,
        ...(contact ? { contact } : {}),
        services: input.services.map((s) => ({
          ...s,
          addOnIds: [...s.addOnIds].sort(),
        })),
      };
      const hash = createHash('sha256')
        .update(JSON.stringify(canonical))
        .digest('hex');
      return db.transaction(async (tx) => {
        const fresh = await lock(tx, context);
        const [prior] = await tx
          .select()
          .from(appointmentIdempotency)
          .where(
            and(
              eq(appointmentIdempotency.tenantId, fresh.tenantId),
              eq(appointmentIdempotency.key, input.idempotencyKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== hash) throw fault('IDEMPOTENCY_CONFLICT');
          return serialize(await detail(tx, fresh, prior.appointmentId));
        }
        const data = await load(tx, fresh, input);
        if (
          input.forceConflict &&
          data.settings.doubleBookingMode !== 'manual_override'
        )
          throw invalid('Manual conflict overrides are disabled.');
        const { staff, slot } = claim(
          data,
          Date.parse(input.startsAt),
          clock(),
          input.forceConflict,
        );
        const row = requireOne(
          await tx
            .insert(appointments)
            .values({
              tenantId: fresh.tenantId,
              locationId: input.locationId,
              primaryStaffId: staff.id,
              source: input.source,
              startsAt: new Date(slot.startsAt),
              endsAt: new Date(slot.endsAt),
              locationTimezone: data.location.timezone,
              totalServiceMinutes: slot.totalServiceMinutes,
              totalOccupancyMinutes: slot.totalOccupancyMinutes,
              subtotalMinorUnits: slot.subtotalMinorUnits,
              notes: input.notes,
              createdBy: actor(fresh),
            })
            .returning(),
        );
        for (const [position, part] of data.partsByStaff
          .get(staff.id)!
          .entries()) {
          const { addons, addOnMinutes: _minutes, ...snapshot } = part;
          void _minutes;
          const saved = requireOne(
            await tx
              .insert(appointmentServices)
              .values({
                ...snapshot,
                tenantId: fresh.tenantId,
                appointmentId: row.id,
                position,
              })
              .returning(),
          );
          if (addons.length)
            await tx.insert(appointmentAddons).values(
              addons.map((a) => ({
                ...a,
                tenantId: fresh.tenantId,
                appointmentServiceId: saved.id,
              })),
            );
        }
        await tx.insert(appointmentStaffAssignments).values({
          tenantId: fresh.tenantId,
          appointmentId: row.id,
          staffId: staff.id,
          staffName: staff.displayName,
        });
        await tx.insert(appointmentStatusHistory).values({
          tenantId: fresh.tenantId,
          appointmentId: row.id,
          actorId: actor(fresh),
          action: 'created',
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          forcedConflict: input.forceConflict,
          reason: input.reason,
        });
        await tx.insert(appointmentIdempotency).values({
          tenantId: fresh.tenantId,
          key: input.idempotencyKey,
          requestHash: hash,
          appointmentId: row.id,
        });
        if (guest && contact) {
          const service = requireOne(
            await tx
              .select()
              .from(services)
              .where(
                and(
                  eq(services.tenantId, fresh.tenantId),
                  eq(services.id, input.services[0]!.serviceId),
                ),
              ),
          );
          await tx
            .insert(appointmentContacts)
            .values({
              tenantId: fresh.tenantId,
              appointmentId: row.id,
              ...contact,
            });
          const token = managementToken(guest.secret, row.id);
          await tx
            .insert(appointmentPublicAccess)
            .values({
              tenantId: fresh.tenantId,
              appointmentId: row.id,
              tokenHash: tokenHash(token),
              priceMode: service.priceDisplayMode,
              durationMode: service.durationDisplayMode,
            });
        }
        return serialize(await detail(tx, fresh, row.id));
      });
    },
    async rescheduleAppointment(
      context: TenantContext,
      id: string,
      raw: unknown,
    ) {
      authorize(context);
      const input = appointmentRescheduleSchema.parse(raw);
      return db.transaction(async (tx) => {
        const fresh = await lock(tx, context);
        const old = await detail(tx, fresh, id);
        if (old.status === 'cancelled') throw fault('SLOT_UNAVAILABLE');
        const parts = snapshotParts(old.services, old.addons);
        const data = await load(
          tx,
          fresh,
          {
            locationId: old.locationId,
            staffId: old.primaryStaffId,
            anyAvailable: false,
            source: 'staff',
            services: parts.map((p) => ({
              serviceId: p.serviceId,
              variantId: p.variantId,
              addOnIds: p.addons.map((a) => a.addOnId),
            })),
          },
          parts,
        );
        if (
          input.forceConflict &&
          data.settings.doubleBookingMode !== 'manual_override'
        )
          throw invalid('Manual conflict overrides are disabled.');
        const { slot } = claim(
          data,
          Date.parse(input.startsAt),
          clock(),
          input.forceConflict,
          id,
        );
        await tx
          .update(appointments)
          .set({
            startsAt: new Date(slot.startsAt),
            endsAt: new Date(slot.endsAt),
            updatedAt: new Date(clock()),
          })
          .where(and(scoped(appointments, fresh), eq(appointments.id, id)));
        await tx.insert(appointmentStatusHistory).values({
          tenantId: fresh.tenantId,
          appointmentId: id,
          action: 'rescheduled',
          actorId: actor(fresh),
          previousStartsAt: old.startsAt,
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt),
          forcedConflict: input.forceConflict,
          reason: input.reason,
        });
        return serialize(await detail(tx, fresh, id));
      });
    },
    async cancelAppointment(context: BookingContext, id: string, raw: unknown) {
      authorize(context);
      const input = appointmentCancelSchema.parse(raw);
      return db.transaction(async (tx) => {
        const fresh = await lock(tx, context);
        const old = await detail(tx, fresh, id);
        if (old.status === 'cancelled') return serialize(old);
        const now = new Date(clock());
        await tx
          .update(appointments)
          .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(and(scoped(appointments, fresh), eq(appointments.id, id)));
        await tx.insert(appointmentStatusHistory).values({
          tenantId: fresh.tenantId,
          appointmentId: id,
          action: 'cancelled',
          actorId: actor(fresh),
          startsAt: old.startsAt,
          endsAt: old.endsAt,
          reason: input.reason,
        });
        return serialize(await detail(tx, fresh, id));
      });
    },
  };
  return {
    ...api,
    async createGuestAppointment(slug: string, raw: unknown, secret: string) {
      const input = publicCreateSchema.parse(raw);
      const context = await resolvePublicContext(db, slug);
      const row = await api.createAppointment(
        context,
        appointmentCreateSchema.parse({
          locationId: input.locationId,
          staffId: input.staffId,
          services: [
            {
              serviceId: input.serviceId,
              variantId: input.variantId,
              addOnIds: input.addOnIds,
            },
          ],
          source: 'online',
          startsAt: input.startsAt,
          idempotencyKey: `public:${input.idempotencyKey}`,
        }),
        { contact: input.contact, secret },
      );
      return { appointmentId: row.id, token: managementToken(secret, row.id) };
    },
  };
}
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
// Domain-separated PRF gives retries the same unguessable token without storing it raw.
const managementToken = (secret: string, id: string) =>
  createHmac('sha256', secret)
    .update(`lacquer:public-booking:v1:${id}`)
    .digest('base64url');
