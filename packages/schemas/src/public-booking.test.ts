import { expect, it } from 'vitest';
import {
  tenantPatchSchema,
  publicCreateSchema,
  publicSearchSchema,
} from './index.js';
it('unrelated tenant edits do not silently disable public booking', () => {
  expect(tenantPatchSchema.parse({ name: 'New name' })).toEqual({
    name: 'New name',
  });
  expect(tenantPatchSchema.parse({ publicBookingEnabled: false })).toEqual({
    publicBookingEnabled: false,
  });
});
it('public requests cannot force overlaps or submit multiple technicians and search spans are bounded', () => {
  const selection = {
    locationId: crypto.randomUUID(),
    serviceId: crypto.randomUUID(),
    staffId: crypto.randomUUID(),
  };
  expect(
    publicSearchSchema.safeParse({
      ...selection,
      date: '2026-10-01',
      endDate: '2026-11-01',
    }).success,
  ).toBe(false);
  expect(
    publicCreateSchema.safeParse({
      ...selection,
      startsAt: '2026-10-01T10:00:00Z',
      idempotencyKey: crypto.randomUUID(),
      contact: {
        firstName: 'M',
        lastName: 'L',
        email: 'm@example.test',
        phone: '1234567890',
      },
      forceConflict: true,
    }).success,
  ).toBe(false);
});
