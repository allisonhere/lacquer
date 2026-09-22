import { z } from 'zod';
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
export * from './config.js';
export const idSchema = z.uuid();
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase().trim());
export const passwordSchema = z.string().min(12).max(128);
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(1).max(120),
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const tenantCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: slugSchema,
    publicBookingEnabled: z.boolean().optional(),
  })
  .strict();
export const tenantPatchSchema = tenantCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const tenantParamsSchema = z.object({ tenantId: idSchema });
export const locationParamsSchema = tenantParamsSchema.extend({
  locationId: idSchema,
});
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');
export const locationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: slugSchema,
    addressLine1: z.string().max(200).nullable().default(null),
    addressLine2: z.string().max(200).nullable().default(null),
    city: z.string().max(100).nullable().default(null),
    region: z.string().max(100).nullable().default(null),
    postalCode: z.string().max(24).nullable().default(null),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .default(null),
    phone: z.string().max(40).nullable().default(null),
    timezone: timezoneSchema,
    active: z.boolean().default(true),
  })
  .strict();
export const locationPatchSchema = locationCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
const timestamps = { createdAt: z.string(), updatedAt: z.string() };
export const userSchema = z.object({
  id: idSchema,
  email: z.email(),
  name: z.string(),
  emailVerifiedAt: z.string().nullable(),
});
export const tenantSchema = tenantCreateSchema.extend({
  publicBookingEnabled: z.boolean(),
  id: idSchema,
  status: z.enum(['active', 'suspended']),
  ...timestamps,
});
export const locationSchema = locationCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
export const membershipSchema = z.object({
  tenant: tenantSchema,
  role: z.enum(roles),
  permissions: z.array(z.enum(permissions)),
});
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
export const okSchema = z.object({ ok: z.boolean() });
export type User = z.infer<typeof userSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Location = z.infer<typeof locationSchema>;
export type LocationInput = z.infer<typeof locationCreateSchema>;
export type LocationPatch = z.infer<typeof locationPatchSchema>;
export type TenantInput = z.infer<typeof tenantCreateSchema>;
/* ---------------------------------------------------------------------------
 * Milestone 2: salon operations contracts.
 *
 * Every create schema is `.strict()`, so a client cannot smuggle `tenantId`
 * (or any other ownership field) into a request body — ownership always comes
 * from the authenticated tenant context. Patch schemas are the create schema
 * partialled, plus a refinement rejecting an empty body.
 *
 * Money fields are integers of minor currency units; duration fields are whole
 * minutes; recurring times are minutes after LOCAL midnight.
 * ------------------------------------------------------------------------- */
const minutesInDay = 1440;
/** Minutes after local midnight. 1440 is permitted as an exclusive end-of-day. */
export const dayMinuteSchema = z.coerce.number().int().min(0).max(minutesInDay);
export const durationMinutesSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(minutesInDay);
export const bufferMinutesSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(minutesInDay);
/** Integer minor currency units. Never a float; see @lacquer/booking-engine money helpers. */
export const moneySchema = z.coerce.number().int().min(0).max(100_000_000);
export const weekdaySchema = z.coerce.number().int().min(1).max(7);
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: 'Not a real calendar date',
  });
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().default(null);
/* --- Staff ---------------------------------------------------------------- */
export const staffParamsSchema = tenantParamsSchema.extend({
  staffId: idSchema,
});
export const staffCreateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    firstName: optionalText(120),
    lastName: optionalText(120),
    email: emailSchema.nullable().default(null),
    phone: optionalText(40),
    bio: z.string().trim().max(2000).nullable().default(null),
    active: z.boolean().default(true),
    acceptsOnlineBookings: z.boolean().default(true),
    /** Null inherits the salon-wide minimum booking notice. */
    minimumBookingNoticeOverrideMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(525600)
      .nullable()
      .default(null),
    maxAppointmentsPerDay: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .default(null),
    maxBookedMinutesPerDay: z.coerce
      .number()
      .int()
      .min(1)
      .max(minutesInDay)
      .nullable()
      .default(null),
    autoBreakEnabled: z.boolean().nullable().default(null),
    autoBreakThresholdMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(minutesInDay)
      .nullable()
      .default(null),
    autoBreakDurationMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(minutesInDay)
      .nullable()
      .default(null),
    /** Optional link to an existing member of this salon. */
    userId: idSchema.nullable().default(null),
  })
  .strict();
export const staffPatchSchema = staffCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const staffSchema = staffCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
/** List rows carry the technician's active locations; the detail adds the rest. */
export const staffListItemSchema = staffSchema.extend({
  locationIds: z.array(idSchema),
});
export const staffDetailSchema = staffSchema.extend({
  locationIds: z.array(idSchema),
  skillIds: z.array(idSchema),
  serviceOverrides: z.array(
    z.object({
      tenantId: idSchema,
      staffId: idSchema,
      serviceId: idSchema,
      priceOverride: z.coerce.number().int().nullable(),
      durationOverrideMinutes: z.coerce.number().int().nullable(),
      bufferBeforeOverrideMinutes: z.coerce.number().int().nullable(),
      bufferAfterOverrideMinutes: z.coerce.number().int().nullable(),
      ...timestamps,
    }),
  ),
  serviceEligibility: z.array(
    z.object({
      serviceId: idSchema,
      eligibility: z.enum(staffServiceEligibility),
    }),
  ),
});
export const staffLocationParamsSchema = staffParamsSchema.extend({
  locationId: idSchema,
});
export const staffLocationAssignmentSchema = z.object({
  tenantId: idSchema,
  staffId: idSchema,
  locationId: idSchema,
  active: z.boolean(),
  ...timestamps,
});
export const staffLocationAssignmentInputSchema = z
  .object({ locationId: idSchema, active: z.boolean().default(true) })
  .strict();
/* --- Service categories --------------------------------------------------- */
export const categoryParamsSchema = tenantParamsSchema.extend({
  categoryId: idSchema,
});
export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: slugSchema,
    description: z.string().trim().max(2000).nullable().default(null),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const categoryPatchSchema = categoryCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const categorySchema = categoryCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
/** Explicit ordering payload so a salon can drag categories into place in one request. */
export const categoryReorderSchema = z
  .object({
    order: z
      .array(
        z.object({
          id: idSchema,
          sortOrder: z.coerce.number().int().min(0).max(10000),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict();
/* --- Services ------------------------------------------------------------- */
export const serviceParamsSchema = tenantParamsSchema.extend({
  serviceId: idSchema,
});
/**
 * Base field set. The create, patch, and response schemas are all derived from
 * it so a field is declared exactly once; cross-field rules are attached
 * separately because `.partial()` does not carry refinements.
 */
const serviceFields = z
  .object({
    categoryId: idSchema.nullable().default(null),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4000).nullable().default(null),
    internalDescription: z.string().trim().max(4000).nullable().default(null),
    /** Minor currency units: 7500 is $75.00. */
    basePrice: moneySchema,
    baseDurationMinutes: durationMinutesSchema,
    /** Hands-on time; null means the whole duration is active. Reserved for intelligent overlap. */
    activeTimeMinutes: durationMinutesSchema.nullable().default(null),
    /** Unattended processing time within the duration. Reserved for intelligent overlap. */
    processingTimeMinutes: bufferMinutesSchema.nullable().default(null),
    active: z.boolean().default(true),
    visibleOnline: z.boolean().default(true),
    acceptsOnlineBooking: z.boolean().default(true),
    priceDisplayMode: z.enum(priceDisplayModes).default('exact'),
    durationDisplayMode: z.enum(durationDisplayModes).default('exact'),
    /** Null inherits the salon-wide default buffer. */
    bufferBeforeMinutes: bufferMinutesSchema.nullable().default(null),
    bufferAfterMinutes: bufferMinutesSchema.nullable().default(null),
    staffEligibilityMode: z
      .enum(staffEligibilityModes)
      .default('all_qualified'),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
/**
 * The active/processing split must fit inside the service duration. On a patch
 * the comparison only applies when both sides are present in the request; the
 * database `services_active_time_range` and `services_processing_time_range`
 * checks remain the authority for a partial update against a stored duration.
 */
const withinDuration = <
  T extends {
    activeTimeMinutes?: number | null;
    processingTimeMinutes?: number | null;
    baseDurationMinutes?: number;
  },
>(
  value: T,
  field: 'activeTimeMinutes' | 'processingTimeMinutes',
) => {
  const part = value[field];
  return (
    part === null ||
    part === undefined ||
    value.baseDurationMinutes === undefined ||
    part <= value.baseDurationMinutes
  );
};
export const serviceCreateSchema = serviceFields
  .refine((v) => withinDuration(v, 'activeTimeMinutes'), {
    message: 'Active time cannot exceed the service duration',
    path: ['activeTimeMinutes'],
  })
  .refine((v) => withinDuration(v, 'processingTimeMinutes'), {
    message: 'Processing time cannot exceed the service duration',
    path: ['processingTimeMinutes'],
  });
export const servicePatchSchema = serviceFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update')
  .refine((v) => withinDuration(v, 'activeTimeMinutes'), {
    message: 'Active time cannot exceed the service duration',
    path: ['activeTimeMinutes'],
  })
  .refine((v) => withinDuration(v, 'processingTimeMinutes'), {
    message: 'Processing time cannot exceed the service duration',
    path: ['processingTimeMinutes'],
  });
export const serviceSchema = serviceFields.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
/** List rows stay shallow; the detail endpoint carries relationships. */
export const serviceListItemSchema = serviceSchema.extend({
  categoryName: z.string().nullable(),
  locationIds: z.array(idSchema),
  variantCount: z.coerce.number().int(),
});
export const serviceDetailSchema = serviceSchema.extend({
  categoryName: z.string().nullable(),
  locationIds: z.array(idSchema),
  requiredSkillIds: z.array(idSchema),
  eligibleStaffIds: z.array(idSchema),
  variants: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string().nullable(),
      price: z.coerce.number().int(),
      durationMinutes: z.coerce.number().int(),
      active: z.boolean(),
      sortOrder: z.coerce.number().int(),
      requiredSkillIds: z.array(idSchema),
    }),
  ),
  addOnIds: z.array(idSchema),
});
export const serviceLocationParamsSchema = serviceParamsSchema.extend({
  locationId: idSchema,
});
export const serviceLocationInputSchema = z
  .object({ locationId: idSchema, active: z.boolean().default(true) })
  .strict();
export const serviceLocationSchema = z.object({
  tenantId: idSchema,
  serviceId: idSchema,
  locationId: idSchema,
  active: z.boolean(),
  ...timestamps,
});
/* --- Variants ------------------------------------------------------------- */
export const variantParamsSchema = serviceParamsSchema.extend({
  variantId: idSchema,
});
export const variantCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().default(null),
    /** Explicit effective price, not an adjustment. */
    price: moneySchema,
    /** Explicit effective duration, not an adjustment. */
    durationMinutes: durationMinutesSchema,
    active: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const variantPatchSchema = variantCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const variantSchema = variantCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  serviceId: idSchema,
  ...timestamps,
});
/* --- Add-ons -------------------------------------------------------------- */
export const addOnParamsSchema = tenantParamsSchema.extend({
  addOnId: idSchema,
});
export const addOnCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().default(null),
    price: moneySchema,
    durationMinutes: bufferMinutesSchema,
    globallyAvailable: z.boolean().default(false),
    active: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const addOnPatchSchema = addOnCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const addOnSchema = addOnCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
export const serviceAddOnInputSchema = z
  .object({
    addOnId: idSchema,
    /** At most one add-on from a named group may be chosen. Reserved for Milestone 3. */
    exclusiveGroup: z.string().trim().max(80).nullable().default(null),
    required: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
/* --- Skills --------------------------------------------------------------- */
export const skillParamsSchema = tenantParamsSchema.extend({
  skillId: idSchema,
});
export const skillCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();
export const skillPatchSchema = skillCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const skillSchema = skillCreateSchema.extend({
  id: idSchema,
  tenantId: idSchema,
  ...timestamps,
});
/** Whole-set replacement: simpler and more predictable than per-row add/remove. */
export const skillIdsSchema = z
  .object({ skillIds: z.array(idSchema).max(100) })
  .strict();
/* --- Staff/service eligibility and overrides ------------------------------ */
export const staffServiceParamsSchema = staffParamsSchema.extend({
  serviceId: idSchema,
});
export const staffServiceEligibilitySchema = z
  .object({ eligibility: z.enum(staffServiceEligibility).nullable() })
  .strict();
export const staffServiceOverrideInputSchema = z
  .object({
    priceOverride: moneySchema.nullable().default(null),
    durationOverrideMinutes: durationMinutesSchema.nullable().default(null),
    bufferBeforeOverrideMinutes: bufferMinutesSchema.nullable().default(null),
    bufferAfterOverrideMinutes: bufferMinutesSchema.nullable().default(null),
  })
  .strict();
export const staffServiceOverrideSchema =
  staffServiceOverrideInputSchema.extend({
    tenantId: idSchema,
    staffId: idSchema,
    serviceId: idSchema,
    ...timestamps,
  });
/** Resolved effective values for one technician performing one service. */
export const effectiveServiceValuesSchema = z.object({
  staffId: idSchema,
  serviceId: idSchema,
  variantId: idSchema.nullable(),
  price: z.coerce.number().int(),
  durationMinutes: z.coerce.number().int(),
  bufferBeforeMinutes: z.coerce.number().int(),
  bufferAfterMinutes: z.coerce.number().int(),
  totalMinutes: z.coerce.number().int(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
});
/* --- Scheduling settings -------------------------------------------------- */
export const schedulingSettingsInputSchema = z
  .object({
    defaultBufferBeforeMinutes: bufferMinutesSchema.default(0),
    defaultBufferAfterMinutes: bufferMinutesSchema.default(10),
    minimumBookingNoticeMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(525600)
      .default(120),
    maximumBookingHorizonDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(730)
      .default(60),
    doubleBookingMode: z.enum(doubleBookingModes).default('disabled'),
    autoBreakEnabled: z.boolean().default(false),
    autoBreakThresholdMinutes: durationMinutesSchema.default(240),
    autoBreakDurationMinutes: durationMinutesSchema.default(30),
  })
  .strict();
export const schedulingSettingsPatchSchema = schedulingSettingsInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
export const schedulingSettingsSchema = schedulingSettingsInputSchema.extend({
  tenantId: idSchema,
  ...timestamps,
});
/* --- Recurring weekly schedule -------------------------------------------- */
export const scheduleBlockParamsSchema = staffParamsSchema.extend({
  blockId: idSchema,
});
const scheduleBlockFields = z
  .object({
    locationId: idSchema,
    kind: z.enum(scheduleBlockKinds).default('work'),
    /** ISO weekday: 1 = Monday through 7 = Sunday. */
    weekday: weekdaySchema,
    /** Minutes after LOCAL midnight at the location. */
    startMinute: dayMinuteSchema,
    endMinute: dayMinuteSchema,
    active: z.boolean().default(true),
  })
  .strict();
/** Shared by recurring blocks and dated overrides; tolerant of a partial patch. */
const startsBeforeEnd = (v: { startMinute?: number; endMinute?: number }) =>
  v.startMinute === undefined ||
  v.endMinute === undefined ||
  v.startMinute < v.endMinute;
export const scheduleBlockCreateSchema = scheduleBlockFields.refine(
  startsBeforeEnd,
  { message: 'Shift must start before it ends', path: ['endMinute'] },
);
export const scheduleBlockPatchSchema = scheduleBlockFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update')
  .refine(startsBeforeEnd, {
    message: 'Shift must start before it ends',
    path: ['endMinute'],
  });
export const scheduleBlockSchema = scheduleBlockFields.extend({
  id: idSchema,
  tenantId: idSchema,
  staffId: idSchema,
  ...timestamps,
});
/** Replace a technician's whole week in one request, as the schedule editor does. */
export const scheduleReplaceSchema = z
  .object({
    locationId: idSchema,
    blocks: z
      .array(
        z.object({
          kind: z.enum(scheduleBlockKinds).default('work'),
          weekday: weekdaySchema,
          startMinute: dayMinuteSchema,
          endMinute: dayMinuteSchema,
        }),
      )
      .max(200),
  })
  .strict();
/* --- Time off ------------------------------------------------------------- */
export const timeOffParamsSchema = staffParamsSchema.extend({
  timeOffId: idSchema,
});
const timeOffFields = z
  .object({
    /** Null applies the absence to every location the technician works at. */
    locationId: idSchema.nullable().default(null),
    /** Absolute instants, ISO-8601 with an offset or Z. */
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    allDay: z.boolean().default(false),
    reason: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
export const timeOffCreateSchema = timeOffFields.refine(
  (v) => Date.parse(v.endsAt) > Date.parse(v.startsAt),
  { message: 'Time off must end after it starts', path: ['endsAt'] },
);
export const timeOffSchema = timeOffFields.extend({
  id: idSchema,
  tenantId: idSchema,
  staffId: idSchema,
  locationTimezone: z.string(),
  status: z.enum(timeOffStatuses),
  createdBy: idSchema.nullable(),
  ...timestamps,
});
export const timeOffPatchSchema = z
  .object({
    status: z.enum(timeOffStatuses).optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide a field to update');
/* --- Dated availability overrides ----------------------------------------- */
export const availabilityOverrideParamsSchema = staffParamsSchema.extend({
  overrideId: idSchema,
});
const availabilityOverrideFields = z
  .object({
    locationId: idSchema,
    kind: z.enum(availabilityOverrideKinds),
    /** Local calendar date at the location. */
    localDate: localDateSchema,
    startMinute: dayMinuteSchema,
    endMinute: dayMinuteSchema,
    reason: z.string().trim().max(500).nullable().default(null),
  })
  .strict();
export const availabilityOverrideCreateSchema =
  availabilityOverrideFields.refine(startsBeforeEnd, {
    message: 'Override must start before it ends',
    path: ['endMinute'],
  });
export const availabilityOverrideSchema = availabilityOverrideFields.extend({
  id: idSchema,
  tenantId: idSchema,
  staffId: idSchema,
  ...timestamps,
});
/* --- Service prerequisites ------------------------------------------------ */
const servicePrerequisiteFields = z
  .object({
    prerequisiteServiceId: idSchema,
    mayBeSameBooking: z.boolean().default(true),
    minimumElapsedMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(525600)
      .nullable()
      .default(null),
    maximumElapsedMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(525600)
      .nullable()
      .default(null),
    firstTimeClientOnly: z.boolean().default(false),
  })
  .strict();
export const servicePrerequisiteInputSchema = servicePrerequisiteFields.refine(
  (v) =>
    v.minimumElapsedMinutes === null ||
    v.maximumElapsedMinutes === null ||
    v.maximumElapsedMinutes >= v.minimumElapsedMinutes,
  {
    message: 'Maximum elapsed time must not be less than the minimum',
    path: ['maximumElapsedMinutes'],
  },
);
export const servicePrerequisiteSchema = servicePrerequisiteFields.extend({
  tenantId: idSchema,
  serviceId: idSchema,
  ...timestamps,
});
/* --- Inferred types ------------------------------------------------------- */
export type Staff = z.infer<typeof staffSchema>;
export type StaffListItem = z.infer<typeof staffListItemSchema>;
export type StaffDetail = z.infer<typeof staffDetailSchema>;
export type StaffInput = z.infer<typeof staffCreateSchema>;
export type StaffPatch = z.infer<typeof staffPatchSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CategoryInput = z.infer<typeof categoryCreateSchema>;
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type ServiceInput = z.infer<typeof serviceCreateSchema>;
export type ServicePatch = z.infer<typeof servicePatchSchema>;
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;
export type ServiceListItem = z.infer<typeof serviceListItemSchema>;
export type Variant = z.infer<typeof variantSchema>;
export type VariantInput = z.infer<typeof variantCreateSchema>;
export type AddOn = z.infer<typeof addOnSchema>;
export type AddOnInput = z.infer<typeof addOnCreateSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SkillInput = z.infer<typeof skillCreateSchema>;
export type SchedulingSettings = z.infer<typeof schedulingSettingsSchema>;
export type SchedulingSettingsPatch = z.infer<
  typeof schedulingSettingsPatchSchema
>;
export type ScheduleBlock = z.infer<typeof scheduleBlockSchema>;
export type ScheduleBlockInput = z.infer<typeof scheduleBlockCreateSchema>;
export type TimeOff = z.infer<typeof timeOffSchema>;
export type TimeOffInput = z.infer<typeof timeOffCreateSchema>;
export type AvailabilityOverride = z.infer<typeof availabilityOverrideSchema>;
export type AvailabilityOverrideInput = z.infer<
  typeof availabilityOverrideCreateSchema
>;
export type StaffServiceOverride = z.infer<typeof staffServiceOverrideSchema>;
export type StaffLocationAssignment = z.infer<
  typeof staffLocationAssignmentSchema
>;
export type EffectiveServiceValues = z.infer<
  typeof effectiveServiceValuesSchema
>;
export type ServicePrerequisite = z.infer<typeof servicePrerequisiteSchema>;

/* Core booking contracts. Public booking routes are deliberately not provided. */
const bookingSelectionFields = z
  .object({
    locationId: idSchema,
    staffId: idSchema.optional(),
    anyAvailable: z.boolean().default(false),
    source: z.enum(['staff', 'online']).default('staff'),
    services: z
      .array(
        z
          .object({
            serviceId: idSchema,
            variantId: idSchema.nullable().default(null),
            addOnIds: z
              .array(idSchema)
              .max(20)
              .default([])
              .refine(
                (ids) => new Set(ids).size === ids.length,
                'Duplicate add-on',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
const selectsStaff = (v: { staffId?: string; anyAvailable: boolean }) =>
  Boolean(v.staffId) !== v.anyAvailable;
export const availabilitySearchSchema = bookingSelectionFields
  .extend({
    date: z.iso.date(),
    endDate: z.iso.date().optional(),
  })
  .refine(selectsStaff, 'Select a staffId or anyAvailable')
  .refine(
    (v) =>
      !v.endDate ||
      (v.endDate >= v.date &&
        Date.parse(v.endDate) - Date.parse(v.date) <= 30 * 86400000),
    'Search at most 31 local dates',
  );
export const appointmentCreateSchema = bookingSelectionFields
  .extend({
    startsAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString()),
    idempotencyKey: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullable().default(null),
    forceConflict: z.boolean().default(false),
    reason: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .refine(selectsStaff, 'Select a staffId or anyAvailable')
  .refine(
    (v) => !v.forceConflict || (v.source === 'staff' && v.reason !== null),
    'A staff override requires a reason',
  );
export const appointmentRescheduleSchema = z
  .object({
    startsAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString()),
    forceConflict: z.boolean().default(false),
    reason: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict()
  .refine(
    (v) => !v.forceConflict || v.reason !== null,
    'An override requires a reason',
  );
export const appointmentCancelSchema = z
  .object({ reason: z.string().trim().max(500).nullable().default(null) })
  .strict();
export const appointmentParamsSchema = tenantParamsSchema.extend({
  appointmentId: idSchema,
});
export const appointmentListQuerySchema = paginationSchema.extend({
  locationId: idSchema.optional(),
  staffId: idSchema.optional(),
  status: z.enum(['booked', 'cancelled']).optional(),
  startsAfter: z.iso.datetime({ offset: true }).optional(),
  startsBefore: z.iso.datetime({ offset: true }).optional(),
});
export const availableSlotSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  staffId: idSchema,
  locationId: idSchema,
  totalServiceMinutes: z.number().int(),
  totalOccupancyMinutes: z.number().int(),
  subtotalMinorUnits: z.number().int(),
});
export const appointmentResponseSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  locationId: idSchema,
  primaryStaffId: idSchema,
  clientId: idSchema.nullable(),
  status: z.enum(['booked', 'cancelled']),
  source: z.enum(['staff', 'online']),
  startsAt: z.string(),
  endsAt: z.string(),
  locationTimezone: z.string(),
  totalServiceMinutes: z.number().int(),
  totalOccupancyMinutes: z.number().int(),
  subtotalMinorUnits: z.number().int(),
  notes: z.string().nullable(),
  createdBy: idSchema.nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const appointmentServiceSnapshotSchema = z.object({
  id: idSchema,
  tenantId: idSchema,
  appointmentId: idSchema,
  serviceId: idSchema,
  variantId: idSchema.nullable(),
  position: z.number().int(),
  serviceName: z.string(),
  variantName: z.string().nullable(),
  priceMinorUnits: z.number().int(),
  durationMinutes: z.number().int(),
  activeMinutes: z.number().int(),
  processingMinutes: z.number().int(),
  bufferBeforeMinutes: z.number().int(),
  bufferAfterMinutes: z.number().int(),
});
export const appointmentDetailSchema = appointmentResponseSchema.extend({
  contact: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string(),
      customerNote: z.string().nullable(),
    })
    .nullable(),
  services: z.array(appointmentServiceSnapshotSchema),
  addons: z.array(
    z.object({
      id: idSchema,
      tenantId: idSchema,
      appointmentServiceId: idSchema,
      addOnId: idSchema,
      name: z.string(),
      priceMinorUnits: z.number().int(),
      durationMinutes: z.number().int(),
    }),
  ),
  staffAssignments: z.array(
    z.object({
      tenantId: idSchema,
      appointmentId: idSchema,
      staffId: idSchema,
      staffName: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      id: idSchema,
      tenantId: idSchema,
      appointmentId: idSchema,
      action: z.string(),
      actorId: idSchema.nullable(),
      reason: z.string().nullable(),
      previousStartsAt: z.string().nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      forcedConflict: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});
export type AvailabilitySearchInput = z.infer<typeof availabilitySearchSchema>;
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;
export type AppointmentRescheduleInput = z.infer<
  typeof appointmentRescheduleSchema
>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

/* Narrow guest booking contracts: no source, force-conflict, tenant ID or actor. */
export const guestContactSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.email().trim().toLowerCase().max(254),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(30)
      .regex(/^\+?[0-9 ()-]+$/)
      .refine((v) => v.replace(/\D/g, '').length >= 7, 'Enter a phone number'),
    customerNote: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();
export const publicSelectionSchema = z
  .object({
    locationId: idSchema,
    serviceId: idSchema,
    variantId: idSchema.nullable().default(null),
    addOnIds: z
      .array(idSchema)
      .max(20)
      .default([])
      .refine((v) => new Set(v).size === v.length, 'Duplicate add-on'),
  })
  .strict();
export const publicSearchSchema = publicSelectionSchema
  .extend({
    staffId: idSchema.optional(),
    anyAvailable: z.boolean().default(false),
    date: z.iso.date(),
    endDate: z.iso.date().optional(),
  })
  .refine(selectsStaff, 'Select a technician or Any Available')
  .refine(
    (v) =>
      !v.endDate ||
      (v.endDate >= v.date &&
        Date.parse(v.endDate) - Date.parse(v.date) <= 30 * 86400000),
    'Search at most 31 dates',
  );
export const publicCreateSchema = publicSelectionSchema
  .extend({
    staffId: idSchema,
    startsAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString()),
    idempotencyKey: z.uuid(),
    contact: guestContactSchema,
  })
  .strict();
export const publicTenantParamsSchema = z.object({ tenantSlug: slugSchema });
export const bookingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const publicLocationSchema = locationSchema
  .pick({
    id: true,
    name: true,
    addressLine1: true,
    addressLine2: true,
    city: true,
    region: true,
    postalCode: true,
    country: true,
    phone: true,
    timezone: true,
  })
  .strip();
export const publicSalonSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  currency: z.string(),
  locations: z.array(publicLocationSchema),
  today: z.iso.date(),
  maximumBookingHorizonDays: z.number().int(),
});
const publicDisplayFields = {
  priceMode: z.enum(['exact', 'starting_at', 'hidden']),
  durationMode: z.enum(['exact', 'starting_at', 'hidden']),
  priceMinorUnits: z.number().int().nullable(),
  durationMinutes: z.number().int().nullable(),
};
export const publicServiceSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  ...publicDisplayFields,
  variants: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string().nullable(),
      priceMinorUnits: z.number().int().nullable(),
      durationMinutes: z.number().int().nullable(),
    }),
  ),
  addons: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      description: z.string().nullable(),
      priceMinorUnits: z.number().int().nullable(),
      durationMinutes: z.number().int().nullable(),
      required: z.boolean(),
      exclusiveGroup: z.string().nullable(),
    }),
  ),
});
export const publicStaffSchema = z.object({
  id: idSchema,
  name: z.string(),
  ...publicDisplayFields,
});
export const publicSlotSchema = z.object({
  startsAt: z.string(),
  staffId: idSchema,
  staffName: z.string(),
  ...publicDisplayFields,
});
export const publicBookingSchema = z.object({
  reference: z.string(),
  status: z.enum(['booked', 'cancelled']),
  salonName: z.string(),
  salonSlug: z.string(),
  location: publicLocationSchema,
  startsAt: z.string(),
  timezone: z.string(),
  serviceName: z.string(),
  variantName: z.string().nullable(),
  addons: z.array(z.string()),
  staffName: z.string(),
  ...publicDisplayFields,
  currency: z.string(),
  contact: guestContactSchema,
});
export const publicCreatedSchema = z.object({
  token: bookingTokenSchema,
  booking: publicBookingSchema,
});
export type PublicSelection = z.infer<typeof publicSelectionSchema>;
export type PublicCreate = z.infer<typeof publicCreateSchema>;
export type PublicSalon = z.infer<typeof publicSalonSchema>;
export type PublicService = z.infer<typeof publicServiceSchema>;
export type PublicStaff = z.infer<typeof publicStaffSchema>;
export type PublicSlot = z.infer<typeof publicSlotSchema>;
export type PublicBooking = z.infer<typeof publicBookingSchema>;
