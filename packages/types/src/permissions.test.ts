import { describe, it, expect } from 'vitest';
import { hasPermission, permissions } from './index.js';
describe('fixed roles and permission toggles', () => {
  it('owners retain all permissions', () => {
    for (const permission of permissions)
      expect(hasPermission('owner', permission, { [permission]: false })).toBe(
        true,
      );
  });
  it('managers cannot manage the business by default', () => {
    expect(hasPermission('manager', 'manage_business')).toBe(false);
    expect(hasPermission('manager', 'manage_locations')).toBe(true);
  });
  it('front desk and technicians have limited defaults', () => {
    expect(hasPermission('front_desk', 'manage_calendar')).toBe(true);
    expect(hasPermission('front_desk', 'manage_locations')).toBe(false);
    expect(hasPermission('technician', 'manage_locations')).toBe(false);
  });
  it('honors explicit grants and revocations', () => {
    expect(
      hasPermission('technician', 'manage_locations', {
        manage_locations: true,
      }),
    ).toBe(true);
    expect(
      hasPermission('manager', 'manage_locations', { manage_locations: false }),
    ).toBe(false);
  });
});
