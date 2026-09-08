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
