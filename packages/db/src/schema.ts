import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  date,
  uniqueIndex,
  unique,
  index,
  check,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import {
  roles,
  permissions,
  priceDisplayModes,
  durationDisplayModes,
  staffEligibilityModes,
  staffServiceEligibility,
  scheduleBlockKinds,
  availabilityOverrideKinds,
  timeOffStatuses,
  doubleBookingModes,
} from '@lacquer/types';
export const membershipRole = pgEnum('membership_role', roles);
export const permissionName = pgEnum('permission_name', permissions);
export const priceDisplayMode = pgEnum('price_display_mode', priceDisplayModes);
export const durationDisplayMode = pgEnum(
  'duration_display_mode',
  durationDisplayModes,
);
export const staffEligibilityMode = pgEnum(
  'staff_eligibility_mode',
  staffEligibilityModes,
);
export const staffServiceEligibilityMode = pgEnum(
  'staff_service_eligibility',
  staffServiceEligibility,
);
export const scheduleBlockKind = pgEnum(
  'schedule_block_kind',
  scheduleBlockKinds,
);
export const availabilityOverrideKind = pgEnum(
  'availability_override_kind',
  availabilityOverrideKinds,
);
export const timeOffStatus = pgEnum('time_off_status', timeOffStatuses);
export const doubleBookingMode = pgEnum(
  'double_booking_mode',
  doubleBookingModes,
);
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const authTokenPurpose = pgEnum('auth_token_purpose', [
  'magic_link',
  'email_verification',
  'password_reset',
]);
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    check('users_email_normalized', sql`${t.email} = lower(trim(${t.email}))`),
  ],
);
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: tenantStatus('status').default('active').notNull(),
    publicBookingEnabled: boolean('public_booking_enabled')
      .default(false)
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('tenants_slug_unique').on(t.slug),
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);
export const membershipPermissions = pgTable(
  'membership_permissions',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => tenantMemberships.id, { onDelete: 'cascade' }),
    permission: permissionName('permission').notNull(),
    allowed: boolean('allowed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.permission] })],
);
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    addressLine1: text('address_line_1'),
    addressLine2: text('address_line_2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country'),
    phone: text('phone'),
    timezone: text('timezone').notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('locations_tenant_slug_unique').on(t.tenantId, t.slug),
    // Target for composite foreign keys: children carry tenant_id so a
    // cross-tenant location reference cannot be represented at all.
    unique('locations_id_tenant_unique').on(t.id, t.tenantId),
    check('locations_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'locations_country_format',
      sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`,
    ),
  ],
);
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expiry_idx').on(t.expiresAt),
    check('sessions_expiry_order', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_unique').on(t.tokenHash),
    index('auth_tokens_user_idx').on(t.userId),
    index('auth_tokens_expiry_idx').on(t.expiresAt),
    check('auth_tokens_expiry_order', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
/* ---------------------------------------------------------------------------
 * Milestone 2: salon operations foundation.
 *
 * Conventions used throughout this section:
 *
 * - Money is an integer count of minor currency units ($75.00 => 7500). Never
 *   a float. The installation currency comes from configuration.
 * - Durations and buffers are whole minutes.
 * - Recurring weekly schedules store LOCAL wall-clock minutes after midnight
 *   (0..1440) plus an ISO weekday, never a UTC instant. A 9am shift stays 9am
 *   local across daylight-saving transitions.
 * - Dated events (time off) store absolute `timestamptz`. Dated availability
 *   exceptions store a local calendar `date` plus local minutes, resolved
 *   against the location timezone.
 * - Every tenant-owned child carries `tenant_id` and references its parent
 *   with a COMPOSITE foreign key including that column. A row referencing
 *   another tenant's record is therefore not representable in the database,
 *   independent of any application-layer check.
 * - Catalog entities (staff, categories, services, variants, add-ons, skills)
 *   are deactivated, never hard-deleted, because future appointments will
 *   reference them. Pure configuration joins may be deleted outright.
 * ------------------------------------------------------------------------- */
export const staffProfiles = pgTable(
  'staff_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Null until an invited technician claims an account. Identity of record
    // stays on `users`; these columns describe the salon-facing profile.
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    bio: text('bio'),
    active: boolean('active').default(true).notNull(),
    acceptsOnlineBookings: boolean('accepts_online_bookings')
      .default(true)
      .notNull(),
    // Null means "inherit the salon-wide value" for every override below.
    minimumBookingNoticeOverrideMinutes: integer(
      'minimum_booking_notice_override_minutes',
    ),
    maxAppointmentsPerDay: integer('max_appointments_per_day'),
    maxBookedMinutesPerDay: integer('max_booked_minutes_per_day'),
    autoBreakEnabled: boolean('auto_break_enabled'),
    autoBreakThresholdMinutes: integer('auto_break_threshold_minutes'),
    autoBreakDurationMinutes: integer('auto_break_duration_minutes'),
    ...timestamps(),
  },
  (t) => [
    unique('staff_profiles_id_tenant_unique').on(t.id, t.tenantId),
    uniqueIndex('staff_profiles_tenant_user_unique')
      .on(t.tenantId, t.userId)
      .where(sql`${t.userId} is not null`),
    index('staff_profiles_tenant_idx').on(t.tenantId, t.active),
    check(
      'staff_profiles_notice_range',
      sql`${t.minimumBookingNoticeOverrideMinutes} IS NULL OR (${t.minimumBookingNoticeOverrideMinutes} >= 0 AND ${t.minimumBookingNoticeOverrideMinutes} <= 525600)`,
    ),
    check(
      'staff_profiles_max_appointments_positive',
      sql`${t.maxAppointmentsPerDay} IS NULL OR ${t.maxAppointmentsPerDay} > 0`,
    ),
    check(
      'staff_profiles_max_minutes_range',
      sql`${t.maxBookedMinutesPerDay} IS NULL OR (${t.maxBookedMinutesPerDay} > 0 AND ${t.maxBookedMinutesPerDay} <= 1440)`,
    ),
    check(
      'staff_profiles_auto_break_threshold_positive',
      sql`${t.autoBreakThresholdMinutes} IS NULL OR ${t.autoBreakThresholdMinutes} > 0`,
    ),
    check(
      'staff_profiles_auto_break_duration_positive',
      sql`${t.autoBreakDurationMinutes} IS NULL OR ${t.autoBreakDurationMinutes} > 0`,
    ),
    check(
      'staff_profiles_email_normalized',
      sql`${t.email} IS NULL OR ${t.email} = lower(trim(${t.email}))`,
    ),
  ],
);
export const staffLocationAssignments = pgTable(
  'staff_location_assignments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    locationId: uuid('location_id').notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.locationId] }),
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_location_assignments_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
      name: 'staff_location_assignments_location_fk',
    }).onDelete('cascade'),
    index('staff_location_assignments_location_idx').on(t.locationId, t.active),
  ],
);
export const serviceCategories = pgTable(
  'service_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('service_categories_id_tenant_unique').on(t.id, t.tenantId),
    uniqueIndex('service_categories_tenant_slug_unique').on(t.tenantId, t.slug),
    index('service_categories_tenant_order_idx').on(t.tenantId, t.sortOrder),
    check(
      'service_categories_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('service_categories_sort_order_range', sql`${t.sortOrder} >= 0`),
  ],
);
export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id'),
    name: text('name').notNull(),
    description: text('description'),
    // Never shown to clients; notes for the salon team.
    internalDescription: text('internal_description'),
    basePrice: integer('base_price').notNull(),
    baseDurationMinutes: integer('base_duration_minutes').notNull(),
    // Split of the total duration for `intelligent_overlap`. `activeTimeMinutes`
    // is hands-on technician time; `processingTimeMinutes` is unattended time
    // (curing, soaking) another client may be started during. Null means the
    // whole duration is active. Milestone 3 consumes these; nothing reads them
    // for slot generation yet.
    activeTimeMinutes: integer('active_time_minutes'),
    processingTimeMinutes: integer('processing_time_minutes'),
    active: boolean('active').default(true).notNull(),
    visibleOnline: boolean('visible_online').default(true).notNull(),
    acceptsOnlineBooking: boolean('accepts_online_booking')
      .default(true)
      .notNull(),
    priceDisplayMode: priceDisplayMode('price_display_mode')
      .default('exact')
      .notNull(),
    durationDisplayMode: durationDisplayMode('duration_display_mode')
      .default('exact')
      .notNull(),
    // Null falls through to the salon-wide scheduling default.
    bufferBeforeMinutes: integer('buffer_before_minutes'),
    bufferAfterMinutes: integer('buffer_after_minutes'),
    staffEligibilityMode: staffEligibilityMode('staff_eligibility_mode')
      .default('all_qualified')
      .notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('services_id_tenant_unique').on(t.id, t.tenantId),
    foreignKey({
      columns: [t.categoryId, t.tenantId],
      foreignColumns: [serviceCategories.id, serviceCategories.tenantId],
      name: 'services_category_fk',
    }).onDelete('set null'),
    index('services_tenant_order_idx').on(t.tenantId, t.sortOrder),
    index('services_tenant_category_idx').on(t.tenantId, t.categoryId),
    check('services_base_price_non_negative', sql`${t.basePrice} >= 0`),
    check(
      'services_base_duration_positive',
      sql`${t.baseDurationMinutes} > 0 AND ${t.baseDurationMinutes} <= 1440`,
    ),
    check(
      'services_buffer_before_range',
      sql`${t.bufferBeforeMinutes} IS NULL OR (${t.bufferBeforeMinutes} >= 0 AND ${t.bufferBeforeMinutes} <= 1440)`,
    ),
    check(
      'services_buffer_after_range',
      sql`${t.bufferAfterMinutes} IS NULL OR (${t.bufferAfterMinutes} >= 0 AND ${t.bufferAfterMinutes} <= 1440)`,
    ),
    check(
      'services_active_time_range',
      sql`${t.activeTimeMinutes} IS NULL OR (${t.activeTimeMinutes} > 0 AND ${t.activeTimeMinutes} <= ${t.baseDurationMinutes})`,
    ),
    check(
      'services_processing_time_range',
      sql`${t.processingTimeMinutes} IS NULL OR (${t.processingTimeMinutes} >= 0 AND ${t.processingTimeMinutes} <= ${t.baseDurationMinutes})`,
    ),
    check('services_sort_order_range', sql`${t.sortOrder} >= 0`),
  ],
);
export const serviceLocations = pgTable(
  'service_locations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull(),
    locationId: uuid('location_id').notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.locationId] }),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_locations_service_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
      name: 'service_locations_location_fk',
    }).onDelete('cascade'),
    index('service_locations_location_idx').on(t.locationId, t.active),
  ],
);
/**
 * Variants store EXPLICIT effective values rather than deltas against the
 * parent service. A future price change to "Acrylic Full Set" must not
 * silently re-price its "XL" variant, and a historical appointment must be
 * reconstructable from the variant row alone.
 */
export const serviceVariants = pgTable(
  'service_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    active: boolean('active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('service_variants_id_tenant_unique').on(t.id, t.tenantId),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_variants_service_fk',
    }).onDelete('cascade'),
    index('service_variants_service_order_idx').on(t.serviceId, t.sortOrder),
    check('service_variants_price_non_negative', sql`${t.price} >= 0`),
    check(
      'service_variants_duration_positive',
      sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 1440`,
    ),
    check('service_variants_sort_order_range', sql`${t.sortOrder} >= 0`),
  ],
);
export const addOns = pgTable(
  'add_ons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    price: integer('price').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    // True: offered with every service unless a service row overrides it.
    // False: offered only for services listed in `service_add_ons`.
    globallyAvailable: boolean('globally_available').default(false).notNull(),
    active: boolean('active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('add_ons_id_tenant_unique').on(t.id, t.tenantId),
    index('add_ons_tenant_idx').on(t.tenantId, t.active),
    check('add_ons_price_non_negative', sql`${t.price} >= 0`),
    check(
      'add_ons_duration_range',
      sql`${t.durationMinutes} >= 0 AND ${t.durationMinutes} <= 1440`,
    ),
    check('add_ons_sort_order_range', sql`${t.sortOrder} >= 0`),
  ],
);
/**
 * Service-specific add-on availability.
 *
 * Milestone 2 deliberately stops short of the PRD's add-on rules engine. The
 * columns below are the smallest set that lets Milestone 3 grow mutually
 * exclusive groups, conditional visibility, and required combinations without
 * a destructive rewrite: `exclusiveGroup` names a set within which at most one
 * add-on may be chosen, and `required` marks an add-on the service always
 * includes. No expression language is introduced.
 */
export const serviceAddOns = pgTable(
  'service_add_ons',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull(),
    addOnId: uuid('add_on_id').notNull(),
    exclusiveGroup: text('exclusive_group'),
    required: boolean('required').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.addOnId] }),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_add_ons_service_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.addOnId, t.tenantId],
      foreignColumns: [addOns.id, addOns.tenantId],
      name: 'service_add_ons_add_on_fk',
    }).onDelete('cascade'),
    index('service_add_ons_add_on_idx').on(t.addOnId),
    check('service_add_ons_sort_order_range', sql`${t.sortOrder} >= 0`),
  ],
);
/** One unified concept for skills and certifications; see docs/architecture.md. */
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('skills_id_tenant_unique').on(t.id, t.tenantId),
    uniqueIndex('skills_tenant_name_unique').on(t.tenantId, t.name),
    index('skills_tenant_idx').on(t.tenantId, t.active),
  ],
);
export const staffSkills = pgTable(
  'staff_skills',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.skillId] }),
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_skills_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.skillId, t.tenantId],
      foreignColumns: [skills.id, skills.tenantId],
      name: 'staff_skills_skill_fk',
    }).onDelete('cascade'),
    index('staff_skills_skill_idx').on(t.skillId),
  ],
);
export const serviceSkillRequirements = pgTable(
  'service_skill_requirements',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.skillId] }),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_skill_requirements_service_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.skillId, t.tenantId],
      foreignColumns: [skills.id, skills.tenantId],
      name: 'service_skill_requirements_skill_fk',
    }).onDelete('cascade'),
    index('service_skill_requirements_skill_idx').on(t.skillId),
  ],
);
/** Additional skills a specific variant demands beyond its service's requirements. */
export const variantSkillRequirements = pgTable(
  'variant_skill_requirements',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull(),
    skillId: uuid('skill_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.skillId] }),
    foreignKey({
      columns: [t.variantId, t.tenantId],
      foreignColumns: [serviceVariants.id, serviceVariants.tenantId],
      name: 'variant_skill_requirements_variant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.skillId, t.tenantId],
      foreignColumns: [skills.id, skills.tenantId],
      name: 'variant_skill_requirements_skill_fk',
    }).onDelete('cascade'),
    index('variant_skill_requirements_skill_idx').on(t.skillId),
  ],
);
/**
 * Explicit per-technician decisions for a service. Absence of a row means
 * "decide from the service's eligibility mode and skill requirements".
 * An `ineligible` row is an unconditional deny; an `eligible` row opts a
 * technician into an `explicit_only` service but never waives skills.
 */
export const staffServices = pgTable(
  'staff_services',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    eligibility: staffServiceEligibilityMode('eligibility').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.serviceId] }),
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_services_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'staff_services_service_fk',
    }).onDelete('cascade'),
    index('staff_services_service_idx').on(t.serviceId, t.eligibility),
  ],
);
/** Per-technician price, duration, and buffer overrides. Each column is independently nullable. */
export const staffServiceOverrides = pgTable(
  'staff_service_overrides',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    priceOverride: integer('price_override'),
    durationOverrideMinutes: integer('duration_override_minutes'),
    bufferBeforeOverrideMinutes: integer('buffer_before_override_minutes'),
    bufferAfterOverrideMinutes: integer('buffer_after_override_minutes'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.serviceId] }),
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_service_overrides_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'staff_service_overrides_service_fk',
    }).onDelete('cascade'),
    index('staff_service_overrides_service_idx').on(t.serviceId),
    check(
      'staff_service_overrides_price_non_negative',
      sql`${t.priceOverride} IS NULL OR ${t.priceOverride} >= 0`,
    ),
    check(
      'staff_service_overrides_duration_range',
      sql`${t.durationOverrideMinutes} IS NULL OR (${t.durationOverrideMinutes} > 0 AND ${t.durationOverrideMinutes} <= 1440)`,
    ),
    check(
      'staff_service_overrides_buffer_before_range',
      sql`${t.bufferBeforeOverrideMinutes} IS NULL OR (${t.bufferBeforeOverrideMinutes} >= 0 AND ${t.bufferBeforeOverrideMinutes} <= 1440)`,
    ),
    check(
      'staff_service_overrides_buffer_after_range',
      sql`${t.bufferAfterOverrideMinutes} IS NULL OR (${t.bufferAfterOverrideMinutes} >= 0 AND ${t.bufferAfterOverrideMinutes} <= 1440)`,
    ),
  ],
);
/** One row per tenant. Created lazily with strong defaults on first read. */
export const tenantSchedulingSettings = pgTable(
  'tenant_scheduling_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    defaultBufferBeforeMinutes: integer('default_buffer_before_minutes')
      .default(0)
      .notNull(),
    defaultBufferAfterMinutes: integer('default_buffer_after_minutes')
      .default(10)
      .notNull(),
    minimumBookingNoticeMinutes: integer('minimum_booking_notice_minutes')
      .default(120)
      .notNull(),
    maximumBookingHorizonDays: integer('maximum_booking_horizon_days')
      .default(60)
      .notNull(),
    doubleBookingMode: doubleBookingMode('double_booking_mode')
      .default('disabled')
      .notNull(),
    autoBreakEnabled: boolean('auto_break_enabled').default(false).notNull(),
    autoBreakThresholdMinutes: integer('auto_break_threshold_minutes')
      .default(240)
      .notNull(),
    autoBreakDurationMinutes: integer('auto_break_duration_minutes')
      .default(30)
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    check(
      'scheduling_settings_buffer_before_range',
      sql`${t.defaultBufferBeforeMinutes} >= 0 AND ${t.defaultBufferBeforeMinutes} <= 1440`,
    ),
    check(
      'scheduling_settings_buffer_after_range',
      sql`${t.defaultBufferAfterMinutes} >= 0 AND ${t.defaultBufferAfterMinutes} <= 1440`,
    ),
    check(
      'scheduling_settings_notice_range',
      sql`${t.minimumBookingNoticeMinutes} >= 0 AND ${t.minimumBookingNoticeMinutes} <= 525600`,
    ),
    check(
      'scheduling_settings_horizon_range',
      sql`${t.maximumBookingHorizonDays} >= 1 AND ${t.maximumBookingHorizonDays} <= 730`,
    ),
    check(
      'scheduling_settings_auto_break_threshold_positive',
      sql`${t.autoBreakThresholdMinutes} > 0`,
    ),
    check(
      'scheduling_settings_auto_break_duration_positive',
      sql`${t.autoBreakDurationMinutes} > 0`,
    ),
  ],
);
/**
 * Recurring weekly availability, in LOCAL minutes after midnight at the
 * assigned location. Multiple `work` rows on one weekday express a split
 * shift; `break` rows are recurring breaks subtracted from working time.
 * Overlap within the same kind is rejected by the service layer, which also
 * requires the staff member to be assigned to the location.
 */
export const staffScheduleBlocks = pgTable(
  'staff_schedule_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    locationId: uuid('location_id').notNull(),
    kind: scheduleBlockKind('kind').default('work').notNull(),
    weekday: integer('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_schedule_blocks_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
      name: 'staff_schedule_blocks_location_fk',
    }).onDelete('cascade'),
    uniqueIndex('staff_schedule_blocks_no_duplicates').on(
      t.staffId,
      t.locationId,
      t.kind,
      t.weekday,
      t.startMinute,
      t.endMinute,
    ),
    index('staff_schedule_blocks_lookup_idx').on(
      t.staffId,
      t.weekday,
      t.active,
    ),
    check(
      'staff_schedule_blocks_weekday_range',
      sql`${t.weekday} BETWEEN 1 AND 7`,
    ),
    check(
      'staff_schedule_blocks_bounds',
      sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);
/**
 * Dated absence. Absolute instants in UTC; `locationTimezone` records the zone
 * the salon entered them in so an all-day entry can be rendered and audited
 * without re-deriving it after a location's timezone changes.
 */
export const staffTimeOff = pgTable(
  'staff_time_off',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    // Null scopes the absence to every location the technician works at.
    locationId: uuid('location_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').default(false).notNull(),
    locationTimezone: text('location_timezone').notNull(),
    reason: text('reason'),
    status: timeOffStatus('status').default('scheduled').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_time_off_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
      name: 'staff_time_off_location_fk',
    }).onDelete('cascade'),
    index('staff_time_off_lookup_idx').on(t.staffId, t.startsAt, t.endsAt),
    index('staff_time_off_tenant_idx').on(t.tenantId, t.startsAt),
    check('staff_time_off_order', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
/**
 * Dated exception to the recurring weekly schedule for one local calendar day.
 * `added` opens availability that the weekly schedule does not contain;
 * `removed` closes part of a day without creating a time-off record.
 * Kept as first-class rows, never JSON, because Milestone 3 must distinguish
 * recurring schedule, recurring break, dated absence, dated addition, and
 * dated removal from one another.
 */
export const staffAvailabilityOverrides = pgTable(
  'staff_availability_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull(),
    locationId: uuid('location_id').notNull(),
    kind: availabilityOverrideKind('kind').notNull(),
    // Local calendar date at the location, not an instant.
    localDate: date('local_date').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    reason: text('reason'),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
      name: 'staff_availability_overrides_staff_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
      name: 'staff_availability_overrides_location_fk',
    }).onDelete('cascade'),
    uniqueIndex('staff_availability_overrides_no_duplicates').on(
      t.staffId,
      t.locationId,
      t.kind,
      t.localDate,
      t.startMinute,
      t.endMinute,
    ),
    index('staff_availability_overrides_lookup_idx').on(t.staffId, t.localDate),
    check(
      'staff_availability_overrides_bounds',
      sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);
/**
 * Prerequisite relationships between services (for example, a fill requires a
 * prior full set). Milestone 2 stores and administers these; no public
 * behavior is built on them yet and no expression language is introduced.
 */
export const servicePrerequisites = pgTable(
  'service_prerequisites',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull(),
    prerequisiteServiceId: uuid('prerequisite_service_id').notNull(),
    mayBeSameBooking: boolean('may_be_same_booking').default(true).notNull(),
    minimumElapsedMinutes: integer('minimum_elapsed_minutes'),
    maximumElapsedMinutes: integer('maximum_elapsed_minutes'),
    // When true the prerequisite applies only to clients with no prior visit.
    firstTimeClientOnly: boolean('first_time_client_only')
      .default(false)
      .notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.prerequisiteServiceId] }),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_prerequisites_service_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.prerequisiteServiceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
      name: 'service_prerequisites_prerequisite_fk',
    }).onDelete('cascade'),
    check(
      'service_prerequisites_not_self',
      sql`${t.serviceId} <> ${t.prerequisiteServiceId}`,
    ),
    check(
      'service_prerequisites_minimum_non_negative',
      sql`${t.minimumElapsedMinutes} IS NULL OR ${t.minimumElapsedMinutes} >= 0`,
    ),
    check(
      'service_prerequisites_elapsed_order',
      sql`${t.minimumElapsedMinutes} IS NULL OR ${t.maximumElapsedMinutes} IS NULL OR ${t.maximumElapsedMinutes} >= ${t.minimumElapsedMinutes}`,
    ),
  ],
);

/* Milestone 3: transactional snapshots; catalog references are never hard-deleted. */
export const appointmentStatus = pgEnum('appointment_status', [
  'booked',
  'cancelled',
]);
export const appointmentSource = pgEnum('appointment_source', [
  'staff',
  'online',
]);
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull(),
    primaryStaffId: uuid('primary_staff_id').notNull(),
    // CRM is out of scope: reserved, always null until a tenant-safe client FK exists.
    clientId: uuid('client_id'),
    status: appointmentStatus('status').default('booked').notNull(),
    source: appointmentSource('source').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    locationTimezone: text('location_timezone').notNull(),
    totalServiceMinutes: integer('total_service_minutes').notNull(),
    totalOccupancyMinutes: integer('total_occupancy_minutes').notNull(),
    subtotalMinorUnits: integer('subtotal_minor_units').notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('appointments_id_tenant_unique').on(t.id, t.tenantId),
    foreignKey({
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      columns: [t.primaryStaffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
    }),
    index('appointments_tenant_start_idx').on(t.tenantId, t.startsAt),
    index('appointments_staff_status_idx').on(
      t.tenantId,
      t.primaryStaffId,
      t.status,
    ),
    check('appointments_time_order', sql`${t.startsAt} < ${t.endsAt}`),
    check(
      'appointments_totals',
      sql`${t.totalServiceMinutes} > 0 AND ${t.totalOccupancyMinutes} >= ${t.totalServiceMinutes} AND ${t.subtotalMinorUnits} >= 0`,
    ),
    check('appointments_client_reserved', sql`${t.clientId} IS NULL`),
    check(
      'appointments_cancel_state',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`,
    ),
  ],
);
export const appointmentServices = pgTable(
  'appointment_services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    variantId: uuid('variant_id'),
    position: integer('position').notNull(),
    serviceName: text('service_name').notNull(),
    variantName: text('variant_name'),
    priceMinorUnits: integer('price_minor_units').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    activeMinutes: integer('active_minutes').notNull(),
    processingMinutes: integer('processing_minutes').notNull(),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull(),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull(),
  },
  (t) => [
    unique('appointment_services_id_tenant_unique').on(t.id, t.tenantId),
    unique('appointment_services_position_unique').on(
      t.appointmentId,
      t.position,
    ),
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_services_appointment_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.serviceId, t.tenantId],
      foreignColumns: [services.id, services.tenantId],
    }),
    foreignKey({
      columns: [t.variantId, t.tenantId],
      foreignColumns: [serviceVariants.id, serviceVariants.tenantId],
    }),
    check(
      'appointment_services_values',
      sql`${t.position} >= 0 AND ${t.priceMinorUnits} >= 0 AND ${t.durationMinutes} > 0 AND ${t.activeMinutes} > 0 AND ${t.processingMinutes} >= 0 AND ${t.activeMinutes} + ${t.processingMinutes} = ${t.durationMinutes} AND ${t.bufferBeforeMinutes} >= 0 AND ${t.bufferAfterMinutes} >= 0`,
    ),
  ],
);
export const appointmentAddons = pgTable(
  'appointment_addons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentServiceId: uuid('appointment_service_id').notNull(),
    addOnId: uuid('add_on_id').notNull(),
    name: text('name').notNull(),
    priceMinorUnits: integer('price_minor_units').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.appointmentServiceId, t.tenantId],
      foreignColumns: [appointmentServices.id, appointmentServices.tenantId],
      name: 'appointment_addons_service_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.addOnId, t.tenantId],
      foreignColumns: [addOns.id, addOns.tenantId],
    }),
    unique('appointment_addons_unique').on(t.appointmentServiceId, t.addOnId),
    check(
      'appointment_addons_values',
      sql`${t.priceMinorUnits} >= 0 AND ${t.durationMinutes} >= 0`,
    ),
  ],
);
export const appointmentStaffAssignments = pgTable(
  'appointment_staff_assignments',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    staffId: uuid('staff_id').notNull(),
    staffName: text('staff_name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.staffId] }),
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_staff_appointment_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staffProfiles.id, staffProfiles.tenantId],
    }),
  ],
);
export const appointmentStatusHistory = pgTable(
  'appointment_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    action: text('action').notNull(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    previousStartsAt: timestamp('previous_starts_at', { withTimezone: true }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    forcedConflict: boolean('forced_conflict').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_history_appointment_fk',
    }).onDelete('cascade'),
    index('appointment_history_lookup_idx').on(
      t.tenantId,
      t.appointmentId,
      t.createdAt,
    ),
    check(
      'appointment_history_action',
      sql`${t.action} IN ('created', 'rescheduled', 'cancelled')`,
    ),
  ],
);
export const appointmentIdempotency = pgTable(
  'appointment_idempotency',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    appointmentId: uuid('appointment_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_idempotency_appointment_fk',
    }).onDelete('cascade'),
  ],
);

/** Guest snapshots remain separate from any future mutable CRM client. */
export const appointmentContacts = pgTable(
  'appointment_contacts',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    customerNote: text('customer_note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.tenantId] }),
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_contacts_appointment_fk',
    }).onDelete('cascade'),
  ],
);
export const appointmentPublicAccess = pgTable(
  'appointment_public_access',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    appointmentId: uuid('appointment_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    priceMode: priceDisplayMode('price_mode').notNull(),
    durationMode: durationDisplayMode('duration_mode').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.tenantId] }),
    uniqueIndex('appointment_public_token_unique').on(t.tokenHash),
    foreignKey({
      columns: [t.appointmentId, t.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
      name: 'appointment_public_access_appointment_fk',
    }).onDelete('cascade'),
  ],
);
