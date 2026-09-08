import { z } from 'zod';
import { roles, permissions } from '@lacquer/types';
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
  .object({ name: z.string().trim().min(1).max(160), slug: slugSchema })
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
