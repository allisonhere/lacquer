import { expect, it } from 'vitest';
import { bookingDraftSchema, invalidateBooking } from './public-booking';
it('upstream changes clear incompatible selections while preserving guest details', () => {
  const draft = bookingDraftSchema.parse({
    locationId: 'location',
    serviceId: 'service',
    variantId: 'variant',
    addOnIds: ['addon'],
    technician: 'staff',
    idempotencyKey: 'key',
    contact: {
      firstName: 'Morgan',
      lastName: 'Lee',
      email: 'm@example.test',
      phone: '1234567890',
      customerNote: 'Short',
    },
  });
  const changed = invalidateBooking(draft, 'service');
  expect(changed.variantId).toBeNull();
  expect(changed.addOnIds).toEqual([]);
  expect(changed.technician).toBe('any');
  expect(changed.idempotencyKey).toBe('');
  expect(changed.contact).toEqual(draft.contact);
  expect(invalidateBooking(draft, 'technician').addOnIds).toEqual(['addon']);
  expect(invalidateBooking(draft, 'location').serviceId).toBe('');
});
