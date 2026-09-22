<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { Notice } from '@lacquer/ui';
  import { publicBookingSchema, type PublicBooking } from '@lacquer/schemas';
  import { publicApi } from '$lib/public-booking';
  import { formatMoney, formatInstant } from '$lib/format';
  let booking = $state<PublicBooking | null>(null),
    error = $state('');
  onMount(() => {
    void publicApi(`/bookings/${page.params.token}`, publicBookingSchema)
      .then((b) => (booking = b))
      .catch(
        () =>
          (error =
            'This booking link is invalid or is no longer available. Please contact the salon.'),
      );
  });
</script>

<svelte:head
  ><title>{booking ? 'Your appointment' : 'Booking details'} · Lacquer</title
  ><meta name="robots" content="noindex" /><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>
<div class="booking-shell">
  <header class="booking-header">
    <span class="salon-wordmark"
      >{booking?.salonName ?? 'Your appointment'}</span
    ><span class="booking-label">A LITTLE TIME FOR YOU</span>
  </header>
  <section class="confirmation-wrap">
    {#if error}<h1>We couldn’t find your booking.</h1>
      <Notice message={error} />{:else if booking}<div
        class="confirmation-mark"
        aria-hidden="true"
      >
        {booking.status === 'booked' ? '✓' : '—'}
      </div>
      <p class="booking-eyebrow">BOOKING {booking.reference}</p>
      <h1>
        {booking.status === 'cancelled'
          ? 'Your appointment is cancelled.'
          : page.url.searchParams.has('confirmed')
            ? 'You’re booked. Beautiful.'
            : 'Your next good nail day.'}
      </h1>
      <p class="booking-intro">
        {booking.status === 'booked'
          ? `We look forward to seeing you, ${booking.contact.firstName}. Your appointment is confirmed.`
          : 'Please contact the salon if you would like to arrange another visit.'}
      </p>
      <div class="review-treatment">
        <h2>{booking.serviceName}</h2>
        {#if booking.variantName}<p>
            {booking.variantName}
          </p>{/if}{#if booking.addons.length}<p>
            {booking.addons.join(' · ')}
          </p>{/if}
        <dl>
          <div>
            <dt>With</dt>
            <dd>{booking.staffName}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              {formatInstant(booking.startsAt, booking.timezone)}<small
                >{booking.timezone}</small
              >
            </dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>
              {booking.location.name}<small
                >{[
                  booking.location.addressLine1,
                  booking.location.city,
                  booking.location.region,
                ]
                  .filter(Boolean)
                  .join(', ')}</small
              >
            </dd>
          </div>
          {#if booking.durationMinutes !== null}<div>
              <dt>Appointment length</dt>
              <dd>
                {booking.durationMode === 'starting_at'
                  ? 'From '
                  : ''}{booking.durationMinutes} min
              </dd>
            </div>{/if}{#if booking.priceMinorUnits !== null}<div
              class="review-total"
            >
              <dt>
                {booking.priceMode === 'starting_at'
                  ? 'Starting at'
                  : 'Subtotal'}
              </dt>
              <dd>{formatMoney(booking.priceMinorUnits, booking.currency)}</dd>
            </div>{/if}
        </dl>
      </div>
      <div class="review-contact">
        <h2>Your details</h2>
        <p>
          {booking.contact.firstName}
          {booking.contact.lastName}<br />{booking.contact.email}<br />{booking
            .contact.phone}
        </p>
        {#if booking.contact.customerNote}<p class="customer-note">
            {booking.contact.customerNote}
          </p>{/if}
      </div>
      <a
        class="confirmation-link"
        href={resolve('/book/manage/[token]', { token: page.params.token! })}
        >Your secure booking link</a
      >
      <p class="booking-hint">
        Save this link to revisit your appointment. Keep it private: anyone with
        the link can view your booking details. Confirmation emails are not sent
        yet.
      </p>
      <section aria-label="Appointment changes">
        <h2>Need to change your visit?</h2>
        <p>Contact the salon to cancel or reschedule.</p>
        {#if booking.location.phone}<a
            class="booking-text-button"
            href={`tel:${booking.location.phone}`}>{booking.location.phone}</a
          >{/if}
      </section>
      <a
        class="booking-text-button"
        href={resolve('/book/[tenantSlug]', { tenantSlug: booking.salonSlug })}
        >Back to {booking.salonName}</a
      >
    {:else}<p role="status">Opening your appointment…</p>{/if}
  </section>
  <footer class="booking-footer">
    Thoughtfully booked. <span>Booking by Lacquer</span>
  </footer>
</div>
