import {
  tenants,
  tenantMemberships,
  locations,
  staffProfiles,
  staffLocationAssignments,
  serviceCategories,
  services,
  serviceLocations,
  serviceVariants,
  serviceSkillRequirements,
  variantSkillRequirements,
  addOns,
  serviceAddOns,
  skills,
  staffSkills,
  staffServiceOverrides,
  staffScheduleBlocks,
  staffTimeOff,
  staffAvailabilityOverrides,
  tenantSchedulingSettings,
  type Database,
} from './index.js';
/**
 * Milestone 2 development seed: one fully configured demo salon.
 *
 * Every record uses a fixed UUID so the seed is repeatable — re-running it
 * updates the same rows rather than accumulating duplicates. All data is
 * fictional; see the README for the public fake credentials.
 *
 * Prices are integer minor currency units (7500 is $75.00) and schedule times
 * are minutes after LOCAL midnight at the location.
 */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Fixed identifiers keep the seed idempotent without natural unique keys. */
const ids = {
  tenant: 'd0000001-0000-4000-8000-000000000000',
  downtown: 'd0000010-0000-4000-8000-000000000000',
  north: 'd0000011-0000-4000-8000-000000000000',
  alex: 'd0000020-0000-4000-8000-000000000000',
  jamie: 'd0000021-0000-4000-8000-000000000000',
  catManicures: 'd0000030-0000-4000-8000-000000000000',
  catPedicures: 'd0000031-0000-4000-8000-000000000000',
  catAcrylics: 'd0000032-0000-4000-8000-000000000000',
  catNailArt: 'd0000033-0000-4000-8000-000000000000',
  svcGelMani: 'd0000040-0000-4000-8000-000000000000',
  svcPedicure: 'd0000041-0000-4000-8000-000000000000',
  svcFullSet: 'd0000042-0000-4000-8000-000000000000',
  svcNailArt: 'd0000043-0000-4000-8000-000000000000',
  varShort: 'd0000050-0000-4000-8000-000000000000',
  varLong: 'd0000051-0000-4000-8000-000000000000',
  varXl: 'd0000052-0000-4000-8000-000000000000',
  skillAcrylic: 'd0000060-0000-4000-8000-000000000000',
  skillGel: 'd0000061-0000-4000-8000-000000000000',
  skillArt: 'd0000062-0000-4000-8000-000000000000',
  skillPedicure: 'd0000063-0000-4000-8000-000000000000',
  skillSanitation: 'd0000064-0000-4000-8000-000000000000',
  addOnRemoval: 'd0000070-0000-4000-8000-000000000000',
  addOnFrench: 'd0000071-0000-4000-8000-000000000000',
  addOnMassage: 'd0000072-0000-4000-8000-000000000000',
  timeOff: 'd0000080-0000-4000-8000-000000000000',
  overrideAdded: 'd0000090-0000-4000-8000-000000000000',
  overrideRemoved: 'd0000091-0000-4000-8000-000000000000',
};
const tenantId = ids.tenant;
/** Weekday-and-time helper so the schedule below reads like a rota. */
const at = (hours: number, minutes = 0) => hours * 60 + minutes;
export async function seedSalonOperations(tx: Tx, ownerUserId: string) {
  await tx
    .insert(tenants)
    .values({
      id: tenantId,
      slug: 'lacquer-demo',
      name: 'Lacquer Demo Salon',
      publicBookingEnabled: true,
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: { name: 'Lacquer Demo Salon', publicBookingEnabled: true },
    });
  await tx
    .insert(tenantMemberships)
    .values({ tenantId, userId: ownerUserId, role: 'owner' })
    .onConflictDoNothing();
  await tx
    .insert(tenantSchedulingSettings)
    .values({
      tenantId,
      defaultBufferBeforeMinutes: 5,
      defaultBufferAfterMinutes: 10,
      minimumBookingNoticeMinutes: 120,
      maximumBookingHorizonDays: 60,
      doubleBookingMode: 'disabled',
      autoBreakEnabled: true,
      autoBreakThresholdMinutes: 240,
      autoBreakDurationMinutes: 30,
    })
    .onConflictDoNothing();
  await tx
    .insert(locations)
    .values([
      {
        id: ids.downtown,
        tenantId,
        name: 'Downtown',
        slug: 'downtown',
        timezone: 'America/Chicago',
        addressLine1: '18 Example Avenue',
        city: 'Example City',
        region: 'IL',
        country: 'US',
      },
      {
        id: ids.north,
        tenantId,
        name: 'North',
        slug: 'north',
        timezone: 'America/Chicago',
        addressLine1: '4400 Example Parkway',
        city: 'Example City',
        region: 'IL',
        country: 'US',
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(staffProfiles)
    .values([
      {
        id: ids.alex,
        tenantId,
        displayName: 'Alex Morgan',
        firstName: 'Alex',
        lastName: 'Morgan',
        email: 'alex@example.test',
        bio: 'Acrylic and structured gel specialist.',
        // Tighter notice than the salon default, and a daily ceiling.
        minimumBookingNoticeOverrideMinutes: 240,
        maxAppointmentsPerDay: 8,
        maxBookedMinutesPerDay: 480,
      },
      {
        id: ids.jamie,
        tenantId,
        displayName: 'Jamie Lee',
        firstName: 'Jamie',
        lastName: 'Lee',
        email: 'jamie@example.test',
        bio: 'Pedicures and freehand nail art.',
        autoBreakDurationMinutes: 45,
      },
    ])
    .onConflictDoNothing();
  // Alex works at both locations; Jamie only Downtown.
  await tx
    .insert(staffLocationAssignments)
    .values([
      { tenantId, staffId: ids.alex, locationId: ids.downtown },
      { tenantId, staffId: ids.alex, locationId: ids.north },
      { tenantId, staffId: ids.jamie, locationId: ids.downtown },
    ])
    .onConflictDoNothing();
  await tx
    .insert(serviceCategories)
    .values([
      {
        id: ids.catManicures,
        tenantId,
        name: 'Manicures',
        slug: 'manicures',
        sortOrder: 0,
      },
      {
        id: ids.catPedicures,
        tenantId,
        name: 'Pedicures',
        slug: 'pedicures',
        sortOrder: 1,
      },
      {
        id: ids.catAcrylics,
        tenantId,
        name: 'Acrylics',
        slug: 'acrylics',
        sortOrder: 2,
      },
      {
        id: ids.catNailArt,
        tenantId,
        name: 'Nail Art',
        slug: 'nail-art',
        sortOrder: 3,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(skills)
    .values([
      {
        id: ids.skillAcrylic,
        tenantId,
        name: 'Acrylic',
        description: 'Acrylic application and fills.',
      },
      {
        id: ids.skillGel,
        tenantId,
        name: 'Structured gel',
        description: 'Builder gel and overlays.',
      },
      {
        id: ids.skillArt,
        tenantId,
        name: 'Advanced nail art',
        description: 'Freehand and detail work.',
      },
      {
        id: ids.skillPedicure,
        tenantId,
        name: 'Pedicure',
        description: 'Spa and clinical pedicures.',
      },
      {
        id: ids.skillSanitation,
        tenantId,
        name: 'Sanitation certification',
        description: 'State sanitation certification.',
      },
    ])
    .onConflictDoNothing();
  // Alex holds acrylic and gel; Jamie holds pedicure and nail art. Both are
  // sanitation-certified. This is what makes the eligibility demo meaningful.
  await tx
    .insert(staffSkills)
    .values([
      { tenantId, staffId: ids.alex, skillId: ids.skillAcrylic },
      { tenantId, staffId: ids.alex, skillId: ids.skillGel },
      { tenantId, staffId: ids.alex, skillId: ids.skillSanitation },
      { tenantId, staffId: ids.jamie, skillId: ids.skillPedicure },
      { tenantId, staffId: ids.jamie, skillId: ids.skillArt },
      { tenantId, staffId: ids.jamie, skillId: ids.skillSanitation },
    ])
    .onConflictDoNothing();
  await tx
    .insert(services)
    .values([
      {
        id: ids.svcGelMani,
        tenantId,
        categoryId: ids.catManicures,
        name: 'Gel Manicure',
        description: 'Shaping, cuticle care, and a long-wearing gel colour.',
        basePrice: 5500,
        baseDurationMinutes: 60,
        sortOrder: 0,
      },
      {
        id: ids.svcPedicure,
        tenantId,
        categoryId: ids.catPedicures,
        name: 'Signature Pedicure',
        description: 'Soak, exfoliation, massage, and polish.',
        basePrice: 6500,
        baseDurationMinutes: 75,
        // Unattended soak time; reserved for Milestone 3 intelligent overlap.
        activeTimeMinutes: 55,
        processingTimeMinutes: 20,
        bufferAfterMinutes: 15,
        sortOrder: 1,
      },
      {
        id: ids.svcFullSet,
        tenantId,
        categoryId: ids.catAcrylics,
        name: 'Acrylic Full Set',
        description: 'A full set of acrylic extensions, shaped to request.',
        basePrice: 7500,
        baseDurationMinutes: 90,
        sortOrder: 2,
      },
      {
        id: ids.svcNailArt,
        tenantId,
        categoryId: ids.catNailArt,
        name: 'Custom Nail Art',
        description: 'Freehand art priced from a starting rate.',
        basePrice: 3000,
        baseDurationMinutes: 45,
        priceDisplayMode: 'starting_at',
        durationDisplayMode: 'starting_at',
        sortOrder: 3,
      },
    ])
    .onConflictDoNothing();
  // Gel manicure and nail art at both locations; the rest Downtown only.
  await tx
    .insert(serviceLocations)
    .values([
      { tenantId, serviceId: ids.svcGelMani, locationId: ids.downtown },
      { tenantId, serviceId: ids.svcGelMani, locationId: ids.north },
      { tenantId, serviceId: ids.svcPedicure, locationId: ids.downtown },
      { tenantId, serviceId: ids.svcFullSet, locationId: ids.downtown },
      { tenantId, serviceId: ids.svcFullSet, locationId: ids.north },
      { tenantId, serviceId: ids.svcNailArt, locationId: ids.downtown },
    ])
    .onConflictDoNothing();
  await tx
    .insert(serviceSkillRequirements)
    .values([
      { tenantId, serviceId: ids.svcGelMani, skillId: ids.skillGel },
      { tenantId, serviceId: ids.svcPedicure, skillId: ids.skillPedicure },
      { tenantId, serviceId: ids.svcFullSet, skillId: ids.skillAcrylic },
      { tenantId, serviceId: ids.svcNailArt, skillId: ids.skillArt },
    ])
    .onConflictDoNothing();
  // Variants carry explicit effective price and duration, not adjustments.
  await tx
    .insert(serviceVariants)
    .values([
      {
        id: ids.varShort,
        tenantId,
        serviceId: ids.svcFullSet,
        name: 'Short',
        price: 7500,
        durationMinutes: 90,
        sortOrder: 0,
      },
      {
        id: ids.varLong,
        tenantId,
        serviceId: ids.svcFullSet,
        name: 'Long',
        price: 8500,
        durationMinutes: 105,
        sortOrder: 1,
      },
      {
        id: ids.varXl,
        tenantId,
        serviceId: ids.svcFullSet,
        name: 'XL',
        price: 9500,
        durationMinutes: 120,
        sortOrder: 2,
      },
    ])
    .onConflictDoNothing();
  // The XL set additionally demands advanced nail art, which Alex does not hold —
  // so the eligibility screen has something real to show.
  await tx
    .insert(variantSkillRequirements)
    .values({ tenantId, variantId: ids.varXl, skillId: ids.skillArt })
    .onConflictDoNothing();
  await tx
    .insert(addOns)
    .values([
      {
        id: ids.addOnRemoval,
        tenantId,
        name: 'Soak-off removal',
        price: 1500,
        durationMinutes: 20,
        globallyAvailable: true,
        sortOrder: 0,
      },
      {
        id: ids.addOnFrench,
        tenantId,
        name: 'French tips',
        price: 1000,
        durationMinutes: 15,
        sortOrder: 1,
      },
      {
        id: ids.addOnMassage,
        tenantId,
        name: 'Extended massage',
        price: 1200,
        durationMinutes: 15,
        sortOrder: 2,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(serviceAddOns)
    .values([
      { tenantId, serviceId: ids.svcGelMani, addOnId: ids.addOnFrench },
      { tenantId, serviceId: ids.svcFullSet, addOnId: ids.addOnFrench },
      { tenantId, serviceId: ids.svcPedicure, addOnId: ids.addOnMassage },
    ])
    .onConflictDoNothing();
  // Alex charges more and needs no lead-in buffer for a full set.
  await tx
    .insert(staffServiceOverrides)
    .values({
      tenantId,
      staffId: ids.alex,
      serviceId: ids.svcFullSet,
      priceOverride: 9000,
      durationOverrideMinutes: 105,
      bufferBeforeOverrideMinutes: 0,
    })
    .onConflictDoNothing();
  /**
   * Weekly schedules. Alex works a SPLIT SHIFT on Monday (09:00-13:00 and
   * 16:00-20:00) with a recurring lunch break; Jamie works straight days.
   */
  await tx
    .insert(staffScheduleBlocks)
    .values([
      // Alex, Downtown: Monday split shift.
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        weekday: 1,
        startMinute: at(9),
        endMinute: at(13),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        weekday: 1,
        startMinute: at(16),
        endMinute: at(20),
        kind: 'work',
      },
      // Alex, Downtown: straight Tuesday and Wednesday with a lunch break.
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        weekday: 2,
        startMinute: at(9),
        endMinute: at(17),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        weekday: 2,
        startMinute: at(12, 30),
        endMinute: at(13),
        kind: 'break',
      },
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        weekday: 3,
        startMinute: at(9),
        endMinute: at(17),
        kind: 'work',
      },
      // Alex, North: Thursday and Friday.
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.north,
        weekday: 4,
        startMinute: at(10),
        endMinute: at(18),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.alex,
        locationId: ids.north,
        weekday: 5,
        startMinute: at(10),
        endMinute: at(18),
        kind: 'work',
      },
      // Jamie, Downtown: Wednesday to Saturday with a lunch break.
      {
        tenantId,
        staffId: ids.jamie,
        locationId: ids.downtown,
        weekday: 3,
        startMinute: at(10),
        endMinute: at(18),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.jamie,
        locationId: ids.downtown,
        weekday: 3,
        startMinute: at(13),
        endMinute: at(13, 30),
        kind: 'break',
      },
      {
        tenantId,
        staffId: ids.jamie,
        locationId: ids.downtown,
        weekday: 4,
        startMinute: at(10),
        endMinute: at(18),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.jamie,
        locationId: ids.downtown,
        weekday: 5,
        startMinute: at(10),
        endMinute: at(18),
        kind: 'work',
      },
      {
        tenantId,
        staffId: ids.jamie,
        locationId: ids.downtown,
        weekday: 6,
        startMinute: at(9),
        endMinute: at(15),
        kind: 'work',
      },
    ])
    .onConflictDoNothing();
  // One dated absence, stored as absolute instants.
  await tx
    .insert(staffTimeOff)
    .values({
      id: ids.timeOff,
      tenantId,
      staffId: ids.jamie,
      locationId: ids.downtown,
      startsAt: new Date('2026-10-14T14:00:00Z'),
      endsAt: new Date('2026-10-16T22:00:00Z'),
      allDay: true,
      locationTimezone: 'America/Chicago',
      reason: 'Family holiday',
      createdBy: ownerUserId,
    })
    .onConflictDoNothing();
  // Dated exceptions: an extra Sunday shift, and an early finish.
  await tx
    .insert(staffAvailabilityOverrides)
    .values([
      {
        id: ids.overrideAdded,
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        kind: 'added',
        localDate: '2026-10-18',
        startMinute: at(11),
        endMinute: at(16),
        reason: 'Extra Sunday for the holiday rush',
      },
      {
        id: ids.overrideRemoved,
        tenantId,
        staffId: ids.alex,
        locationId: ids.downtown,
        kind: 'removed',
        localDate: '2026-10-20',
        startMinute: at(15),
        endMinute: at(17),
        reason: 'Leaving early for an appointment',
      },
    ])
    .onConflictDoNothing();
}
export const demoIds = ids;
