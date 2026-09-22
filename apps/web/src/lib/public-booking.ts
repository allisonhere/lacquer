import { z } from 'zod';
import { publicSlotSchema, guestContactSchema } from '@lacquer/schemas';
export const bookingSteps = [
  'location',
  'service',
  'technician',
  'time',
  'details',
  'review',
] as const;
export type BookingStep = (typeof bookingSteps)[number];
export const bookingDraftSchema = z.object({
  locationId: z.string().default(''),
  serviceId: z.string().default(''),
  variantId: z.string().nullable().default(null),
  addOnIds: z.array(z.string()).default([]),
  technician: z.string().default('any'),
  date: z.string().default(''),
  slot: publicSlotSchema.nullable().default(null),
  contact: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      phone: z.string(),
      customerNote: z.string().nullable(),
    })
    .default({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      customerNote: '',
    }),
  idempotencyKey: z.string().default(''),
});
export type BookingDraft = z.infer<typeof bookingDraftSchema>;
export function invalidateBooking(
  draft: BookingDraft,
  change:
    | 'location'
    | 'service'
    | 'variant'
    | 'addons'
    | 'technician'
    | 'date'
    | 'contact',
): BookingDraft {
  const next = { ...draft, idempotencyKey: '' };
  if (change === 'contact') return next;
  next.slot = null;
  if (change === 'location') next.serviceId = '';
  if (change === 'location' || change === 'service') {
    next.variantId = null;
    next.addOnIds = [];
  }
  if (['location', 'service', 'variant', 'addons'].includes(change))
    next.technician = 'any';
  return next;
}
export const validContact = (contact: BookingDraft['contact']) =>
  guestContactSchema.safeParse(contact).success;
export class PublicRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  SLOT_UNAVAILABLE:
    'That time was just booked or is no longer available. Please choose another available time.',
  OUTSIDE_BOOKING_HORIZON: 'That date isn’t available for online booking yet.',
  MINIMUM_NOTICE_NOT_MET:
    'That time is too soon to book online. Please choose a later time.',
  STAFF_NOT_QUALIFIED:
    'This technician is no longer available for your selection. Please choose another technician.',
  SERVICE_NOT_AVAILABLE_AT_LOCATION:
    'This service is no longer available at this location.',
  DAILY_APPOINTMENT_LIMIT_REACHED:
    'This technician is fully booked for the day. Please try another day or technician.',
  DAILY_BOOKED_MINUTES_LIMIT_REACHED:
    'Please choose another day or technician for this appointment.',
  AUTOMATIC_BREAK_REQUIRED:
    'That time is no longer available. Please choose another time.',
  IDEMPOTENCY_CONFLICT:
    'Your booking details changed. Please review them before trying again.',
  RATE_LIMITED: 'Please pause for a moment, then try again.',
};
export async function publicApi<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1/public${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    headers: {
      'X-Lacquer-Request': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new PublicRequestError(
      data.error?.code ?? 'REQUEST_FAILED',
      response.status,
      messages[data.error?.code] ??
        (response.status === 404
          ? 'This booking page or selection is no longer available.'
          : 'We couldn’t complete that request. Please check your details and try again.'),
    );
  return schema.parse(data);
}
