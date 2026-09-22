export const roles = ['owner', 'manager', 'front_desk', 'technician'] as const;
export type Role = (typeof roles)[number];
export const permissions = [
  'manage_business',
  'manage_locations',
  'manage_staff',
  'manage_services',
  'manage_calendar',
  'manage_clients',
  'manage_payments',
  'manage_reports',
  'manage_settings',
  'view_audit_log',
] as const;
export type Permission = (typeof permissions)[number];
export type PermissionOverrides = Partial<Record<Permission, boolean>>;
const rolePermissions: Record<Role, readonly Permission[]> = {
  owner: permissions,
  manager: permissions.filter((p) => p !== 'manage_business'),
  front_desk: ['manage_calendar', 'manage_clients'],
  technician: [],
};
export function hasPermission(
  role: Role,
  permission: Permission,
  overrides: PermissionOverrides = {},
): boolean {
  return (
    role === 'owner' ||
    (overrides[permission] ?? rolePermissions[role].includes(permission))
  );
}
export interface ApiError {
  error: { code: string; message: string; requestId: string };
}
/**
 * Milestone 2 salon-operations domain constants.
 *
 * These are shared by the Drizzle enums, the Zod request/response contracts,
 * and the admin UI so a value can never drift between layers.
 */
/** ISO-8601 weekday numbering: 1 = Monday through 7 = Sunday. */
export const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof weekdays)[number];
export const weekdayNames: Record<Weekday, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};
/** Minutes in a day. Recurring schedule times are minutes after local midnight. */
export const minutesPerDay = 1440;
/** How a price is shown to clients. The exact value always remains internally available. */
export const priceDisplayModes = ['exact', 'starting_at', 'hidden'] as const;
export type PriceDisplayMode = (typeof priceDisplayModes)[number];
/** How a duration is shown to clients. The exact value always remains internally available. */
export const durationDisplayModes = ['exact', 'starting_at', 'hidden'] as const;
export type DurationDisplayMode = (typeof durationDisplayModes)[number];
/**
 * Which technicians may perform a service.
 *
 * `all_qualified` — anyone holding the service's required skills.
 * `explicit_only` — only technicians with an explicit eligible assignment,
 *   who must still hold the required skills.
 *
 * Skill requirements are authoritative in both modes; an explicit assignment
 * never bypasses them. See `isStaffQualifiedForService`.
 */
export const staffEligibilityModes = [
  'all_qualified',
  'explicit_only',
] as const;
export type StaffEligibilityMode = (typeof staffEligibilityModes)[number];
/** Explicit per-technician decisions layered on top of the service's eligibility mode. */
export const staffServiceEligibility = ['eligible', 'ineligible'] as const;
export type StaffServiceEligibility = (typeof staffServiceEligibility)[number];
/** Recurring weekly blocks are either working time or a recurring break subtracted from it. */
export const scheduleBlockKinds = ['work', 'break'] as const;
export type ScheduleBlockKind = (typeof scheduleBlockKinds)[number];
/** Dated exceptions either add availability or remove it for a specific local date. */
export const availabilityOverrideKinds = ['added', 'removed'] as const;
export type AvailabilityOverrideKind =
  (typeof availabilityOverrideKinds)[number];
export const timeOffStatuses = ['scheduled', 'cancelled'] as const;
export type TimeOffStatus = (typeof timeOffStatuses)[number];
/**
 * Salon-wide double-booking policy. Milestone 2 stores the configuration only;
 * Milestone 3's availability engine consumes it.
 *
 * `disabled` — never overlap appointments for one technician.
 * `manual_override` — staff may deliberately overlap from the calendar.
 * `intelligent_overlap` — the engine may start a second client during a
 *   service's processing time, using the service's active/processing split.
 */
export const doubleBookingModes = [
  'disabled',
  'manual_override',
  'intelligent_overlap',
] as const;
export type DoubleBookingMode = (typeof doubleBookingModes)[number];
