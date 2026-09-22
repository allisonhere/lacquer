import { and, eq, asc } from 'drizzle-orm';
import {
  tenants,
  locations,
  services,
  serviceCategories,
  serviceLocations,
  serviceVariants,
  serviceAddOns,
  addOns,
  staffProfiles,
  tenantSchedulingSettings,
  appointments,
  appointmentServices,
  appointmentAddons,
  appointmentStaffAssignments,
  appointmentContacts,
  appointmentPublicAccess,
  type Database,
} from '@lacquer/db';
import {
  publicSelectionSchema,
  publicSearchSchema,
  publicCreateSchema,
  publicLocationSchema,
  publicBookingSchema,
  bookingTokenSchema,
  availabilitySearchSchema,
  type PublicSelection,
  type PublicBooking,
} from '@lacquer/schemas';
import { localDateAt } from '@lacquer/booking-engine';
import { resolvePublicContext } from '../public-context.js';
import { createBookingService, tokenHash } from './booking.js';
import { createEligibilityService } from './eligibility.js';
import { notFound } from '../errors.js';

type Display = {
  priceDisplayMode: 'exact' | 'starting_at' | 'hidden';
  durationDisplayMode: 'exact' | 'starting_at' | 'hidden';
};
const display = (s: Display, price: number, duration: number) => ({
  priceMode: s.priceDisplayMode,
  durationMode: s.durationDisplayMode,
  priceMinorUnits: s.priceDisplayMode === 'hidden' ? null : price,
  durationMinutes: s.durationDisplayMode === 'hidden' ? null : duration,
});
/** Post-commit integration hook. No delivery provider/outbox is implied. Consumers must not log this payload. */
export interface PublicBookingCreatedEvent {
  type: 'public_booking.created';
  booking: PublicBooking;
  managementUrl: string;
}
export function createPublicBookingService(
  db: Database,
  currency: string,
  secret: string,
  appUrl: string,
  onCreated?: (event: PublicBookingCreatedEvent) => Promise<void>,
) {
  const engine = createBookingService(db);
  async function salon(slug: string) {
    const ctx = await resolvePublicContext(db, slug);
    const [[tenant], rows, [settings]] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, ctx.tenantId)),
      db
        .select()
        .from(locations)
        .where(
          and(eq(locations.tenantId, ctx.tenantId), eq(locations.active, true)),
        )
        .orderBy(locations.name),
      db
        .select()
        .from(tenantSchedulingSettings)
        .where(eq(tenantSchedulingSettings.tenantId, ctx.tenantId)),
    ]);
    return {
      slug: tenant!.slug,
      name: tenant!.name,
      currency,
      locations: rows.map((r) => publicLocationSchema.parse(r)),
      today: localDateAt(rows[0]?.timezone ?? 'UTC', Date.now()),
      maximumBookingHorizonDays: settings?.maximumBookingHorizonDays ?? 60,
    };
  }
  async function catalog(slug: string, locationId: string) {
    const ctx = await resolvePublicContext(db, slug);
    const [location] = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.tenantId, ctx.tenantId),
          eq(locations.id, locationId),
          eq(locations.active, true),
        ),
      );
    if (!location) throw notFound();
    const [rows, variants, addons, links, categories] = await Promise.all([
      db
        .select({ service: services })
        .from(services)
        .innerJoin(
          serviceLocations,
          and(
            eq(serviceLocations.serviceId, services.id),
            eq(serviceLocations.tenantId, services.tenantId),
          ),
        )
        .where(
          and(
            eq(services.tenantId, ctx.tenantId),
            eq(services.active, true),
            eq(services.visibleOnline, true),
            eq(services.acceptsOnlineBooking, true),
            eq(serviceLocations.locationId, locationId),
            eq(serviceLocations.active, true),
          ),
        )
        .orderBy(asc(services.sortOrder), asc(services.name)),
      db
        .select()
        .from(serviceVariants)
        .where(
          and(
            eq(serviceVariants.tenantId, ctx.tenantId),
            eq(serviceVariants.active, true),
          ),
        )
        .orderBy(serviceVariants.sortOrder),
      db
        .select()
        .from(addOns)
        .where(and(eq(addOns.tenantId, ctx.tenantId), eq(addOns.active, true)))
        .orderBy(addOns.sortOrder),
      db
        .select()
        .from(serviceAddOns)
        .where(eq(serviceAddOns.tenantId, ctx.tenantId)),
      db
        .select()
        .from(serviceCategories)
        .where(
          and(
            eq(serviceCategories.tenantId, ctx.tenantId),
            eq(serviceCategories.active, true),
          ),
        ),
    ]);
    return rows.map(({ service: s }) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: categories.find((c) => c.id === s.categoryId)?.name ?? null,
      ...display(s, s.basePrice, s.baseDurationMinutes),
      variants: variants
        .filter((v) => v.serviceId === s.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          description: v.description,
          priceMinorUnits: s.priceDisplayMode === 'hidden' ? null : v.price,
          durationMinutes:
            s.durationDisplayMode === 'hidden' ? null : v.durationMinutes,
        })),
      addons: addons
        .filter(
          (a) =>
            a.globallyAvailable ||
            links.some((l) => l.serviceId === s.id && l.addOnId === a.id),
        )
        .map((a) => {
          const link = links.find(
            (l) => l.serviceId === s.id && l.addOnId === a.id,
          );
          return {
            id: a.id,
            name: a.name,
            description: a.description,
            priceMinorUnits: s.priceDisplayMode === 'hidden' ? null : a.price,
            durationMinutes:
              s.durationDisplayMode === 'hidden' ? null : a.durationMinutes,
            required: link?.required ?? false,
            exclusiveGroup: link?.exclusiveGroup ?? null,
          };
        }),
    }));
  }
  async function selection(slug: string, raw: unknown) {
    const input = publicSelectionSchema.parse(raw),
      ctx = await resolvePublicContext(db, slug);
    const all = await catalog(slug, input.locationId),
      service = all.find((s) => s.id === input.serviceId);
    if (
      !service ||
      (input.variantId &&
        !service.variants.some((v) => v.id === input.variantId)) ||
      input.addOnIds.some((id) => !service.addons.some((a) => a.id === id))
    )
      throw notFound();
    return { input, ctx, service };
  }
  const selectFields = (v: PublicSelection) => ({
    locationId: v.locationId,
    serviceId: v.serviceId,
    variantId: v.variantId,
    addOnIds: v.addOnIds,
  });
  async function staff(slug: string, raw: unknown) {
    const { input, ctx, service } = await selection(slug, raw);
    const [evaluations, people, addons] = await Promise.all([
      createEligibilityService(db).forService(ctx, input.serviceId, {
        locationId: input.locationId,
        variantId: input.variantId,
        onlineBookingRequested: true,
      }),
      db
        .select({ id: staffProfiles.id, name: staffProfiles.displayName })
        .from(staffProfiles)
        .where(eq(staffProfiles.tenantId, ctx.tenantId)),
      db.select().from(addOns).where(eq(addOns.tenantId, ctx.tenantId)),
    ]);
    const selected = addons.filter((a) => input.addOnIds.includes(a.id));
    return evaluations
      .filter((e) => e.eligible)
      .map((e) => ({
        id: e.staffId,
        name: people.find((p) => p.id === e.staffId)!.name,
        ...display(
          {
            priceDisplayMode: service.priceMode,
            durationDisplayMode: service.durationMode,
          },
          e.price + selected.reduce((s, a) => s + a.price, 0),
          e.durationMinutes +
            selected.reduce((s, a) => s + a.durationMinutes, 0),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  async function lookup(raw: string) {
    if (!bookingTokenSchema.safeParse(raw).success) throw notFound();
    const [row] = await db
      .select({
        access: appointmentPublicAccess,
        appointment: appointments,
        tenant: tenants,
        location: locations,
        contact: appointmentContacts,
      })
      .from(appointmentPublicAccess)
      .innerJoin(
        appointments,
        and(
          eq(appointments.id, appointmentPublicAccess.appointmentId),
          eq(appointments.tenantId, appointmentPublicAccess.tenantId),
        ),
      )
      .innerJoin(
        tenants,
        and(
          eq(tenants.id, appointments.tenantId),
          eq(tenants.status, 'active'),
        ),
      )
      .innerJoin(
        locations,
        and(
          eq(locations.id, appointments.locationId),
          eq(locations.tenantId, appointments.tenantId),
        ),
      )
      .innerJoin(
        appointmentContacts,
        and(
          eq(appointmentContacts.appointmentId, appointments.id),
          eq(appointmentContacts.tenantId, appointments.tenantId),
        ),
      )
      .where(eq(appointmentPublicAccess.tokenHash, tokenHash(raw)));
    if (!row) throw notFound();
    const { appointment: a, access, tenant, location, contact } = row;
    const [parts, addons, assignments] = await Promise.all([
      db
        .select()
        .from(appointmentServices)
        .where(
          and(
            eq(appointmentServices.tenantId, a.tenantId),
            eq(appointmentServices.appointmentId, a.id),
          ),
        )
        .orderBy(appointmentServices.position),
      db
        .select({ name: appointmentAddons.name })
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
            eq(appointmentServices.tenantId, a.tenantId),
            eq(appointmentServices.appointmentId, a.id),
          ),
        ),
      db
        .select()
        .from(appointmentStaffAssignments)
        .where(
          and(
            eq(appointmentStaffAssignments.tenantId, a.tenantId),
            eq(appointmentStaffAssignments.appointmentId, a.id),
          ),
        ),
    ]);
    return publicBookingSchema.parse({
      reference: a.id.slice(0, 8).toUpperCase(),
      status: a.status,
      salonName: tenant.name,
      salonSlug: tenant.slug,
      location: publicLocationSchema.parse(location),
      startsAt: a.startsAt.toISOString(),
      timezone: a.locationTimezone,
      serviceName: parts[0]!.serviceName,
      variantName: parts[0]!.variantName,
      addons: addons.map((r) => r.name),
      staffName: assignments[0]!.staffName,
      ...display(
        {
          priceDisplayMode: access.priceMode,
          durationDisplayMode: access.durationMode,
        },
        a.subtotalMinorUnits,
        a.totalServiceMinutes,
      ),
      currency,
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        customerNote: contact.customerNote,
      },
    });
  }
  return {
    salon,
    catalog,
    staff,
    lookup,
    async availability(slug: string, raw: unknown) {
      const input = publicSearchSchema.parse(raw),
        { ctx, service } = await selection(slug, selectFields(input));
      const people = await staff(slug, selectFields(input));
      // Check foreign staff before eligibility filtering, preserving tenant 404 behavior.
      const slots = await engine.getAvailableSlots(
        ctx,
        availabilitySearchSchema.parse({
          locationId: input.locationId,
          staffId: input.staffId,
          anyAvailable: input.anyAvailable,
          services: [
            {
              serviceId: input.serviceId,
              variantId: input.variantId,
              addOnIds: input.addOnIds,
            },
          ],
          date: input.date,
          endDate: input.endDate,
          source: 'online',
        }),
      );
      return slots.map((s) => ({
        startsAt: s.startsAt,
        staffId: s.staffId,
        staffName: people.find((p) => p.id === s.staffId)!.name,
        ...display(
          {
            priceDisplayMode: service.priceMode,
            durationDisplayMode: service.durationMode,
          },
          s.subtotalMinorUnits,
          s.totalServiceMinutes,
        ),
      }));
    },
    async create(slug: string, raw: unknown) {
      const input = publicCreateSchema.parse(raw);
      await selection(slug, selectFields(input));
      const { token } = await engine.createGuestAppointment(
        slug,
        input,
        secret,
      );
      const booking = await lookup(token);
      // Optional delivery integration is post-commit and may see retries. Deduplicate by management URL.
      if (onCreated)
        await onCreated({
          type: 'public_booking.created',
          booking,
          managementUrl: `${appUrl}/book/manage/${token}`,
        }).catch(() => undefined);
      return { token, booking };
    },
  };
}
