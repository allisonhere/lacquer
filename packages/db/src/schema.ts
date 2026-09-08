import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { roles, permissions } from '@lacquer/types';
export const membershipRole = pgEnum('membership_role', roles);
export const permissionName = pgEnum('permission_name', permissions);
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
