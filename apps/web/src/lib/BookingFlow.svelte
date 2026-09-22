<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { z } from 'zod';
  import { Button, Notice } from '@lacquer/ui';
  import {
    publicSalonSchema,
    publicServiceSchema,
    publicStaffSchema,
    publicSlotSchema,
    publicCreatedSchema,
    guestContactSchema,
    type PublicSalon,
    type PublicService,
    type PublicStaff,
    type PublicSlot,
  } from '@lacquer/schemas';
  import { addLocalDays, localDateAt } from '@lacquer/booking-engine';
  import {
    formatMoney,
    formatInstant,
    formatLocalDateLabel,
  } from '$lib/format';
  import {
    publicApi,
    PublicRequestError,
    bookingDraftSchema,
    bookingSteps,
    invalidateBooking,
    validContact,
    type BookingStep,
  } from '$lib/public-booking';
  let { slug }: { slug: string } = $props();
  let salon = $state<PublicSalon | null>(null),
    catalog = $state<PublicService[]>([]),
    people = $state<PublicStaff[]>([]),
    slots = $state<PublicSlot[]>([]);
  let draft = $state(bookingDraftSchema.parse({})),
    ready = $state(false),
    busy = $state(false),
    submitting = $state(false),
    error = $state(''),
    fieldErrors = $state<Record<string, string>>({});
  let category = $state('All services'),
    requestVersion = 0;
  const labels: Record<BookingStep, string> = {
    location: 'Location',
    service: 'Service',
    technician: 'Technician',
    time: 'Date & time',
    details: 'Your details',
    review: 'Review',
  };
  const titles: Record<BookingStep, string> = {
    location: 'Find your little escape.',
    service: 'A little time, just for you.',
    technician: 'You’re in good hands.',
    time: 'Make room for yourself.',
    details: 'Let’s make it yours.',
    review: 'Your next good nail day.',
  };
  let location = $derived(
    salon?.locations.find((l) => l.id === draft.locationId),
  );
  let service = $derived(catalog.find((s) => s.id === draft.serviceId));
  let steps = $derived(
    bookingSteps.filter(
      (s) => s !== 'location' || (salon?.locations.length ?? 0) > 1,
    ),
  );
  let requested = $derived(
    page.url.searchParams.get('step') as BookingStep | null,
  );
  let step = $derived(steps.includes(requested!) ? requested! : steps[0]!);
  let index = $derived(steps.indexOf(step));
  let categories = $derived([
    'All services',
    ...new Set(
      catalog.map((s) => s.category).filter((c): c is string => Boolean(c)),
    ),
  ]);
  let today = $derived(
    location
      ? localDateAt(location.timezone, Date.now())
      : (salon?.today ?? ''),
  );
  let lastDate = $derived(
    today ? addLocalDays(today, salon?.maximumBookingHorizonDays ?? 60) : '',
  );
  let storageKey = $derived(`lacquer.public-booking.v1.${slug}`);
  let canContinue = $derived(
    !busy &&
      !submitting &&
      (step === 'location'
        ? Boolean(location)
        : step === 'service'
          ? Boolean(service)
          : step === 'technician'
            ? people.length > 0 &&
              (draft.technician === 'any' ||
                people.some((p) => p.id === draft.technician))
            : step === 'time'
              ? Boolean(draft.slot)
              : true),
  );
  const selection = () => ({
    locationId: draft.locationId,
    serviceId: draft.serviceId,
    variantId: draft.variantId,
    addOnIds: [...draft.addOnIds],
  });
  $effect(() => {
    if (!ready || busy || submitting) return;
    let allowed = step;
    if (!location) allowed = 'location';
    else if (step !== 'location' && !service) allowed = 'service';
    else if (['details', 'review'].includes(step) && !draft.slot)
      allowed = 'time';
    else if (step === 'review' && !validContact(draft.contact))
      allowed = 'details';
    if (allowed !== step) void navigate(allowed, true);
  });
  function save() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* Private mode: in-memory state still works. */
    }
  }
  $effect(() => {
    if (ready) {
      JSON.stringify(draft);
      save();
    }
  });
  function change(kind: Parameters<typeof invalidateBooking>[1]) {
    draft = invalidateBooking(draft, kind);
    slots = [];
    error = '';
    requestVersion++;
  }
  async function navigate(next: BookingStep, replace = false) {
    save();
    await goto(
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- Resolve the path before appending the step query.
      resolve('/book/[tenantSlug]', { tenantSlug: slug }) + `?step=${next}`,
      { replaceState: replace, keepFocus: true, noScroll: true },
    );
    await tick();
    document.getElementById('booking-title')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function loadCatalog() {
    const version = ++requestVersion;
    busy = true;
    try {
      const rows = await publicApi(
        `/${slug}/services?locationId=${draft.locationId}`,
        z.array(publicServiceSchema),
      );
      if (version === requestVersion) {
        catalog = rows;
        if (draft.serviceId && !rows.some((s) => s.id === draft.serviceId))
          change('location');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to load services.';
    } finally {
      busy = false;
    }
  }
  async function loadPeople() {
    const version = ++requestVersion;
    busy = true;
    try {
      const rows = await publicApi(
        `/${slug}/staff`,
        z.array(publicStaffSchema),
        selection(),
      );
      if (version === requestVersion) {
        people = rows;
        if (
          draft.technician !== 'any' &&
          !rows.some((p) => p.id === draft.technician)
        ) {
          change('technician');
          draft.technician = 'any';
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to load technicians.';
    } finally {
      busy = false;
    }
  }
  async function search() {
    if (!location || !service || !draft.date) return;
    const version = ++requestVersion;
    busy = true;
    slots = [];
    try {
      const rows = await publicApi(
        `/${slug}/availability/search`,
        z.array(publicSlotSchema),
        {
          ...selection(),
          ...(draft.technician === 'any'
            ? { anyAvailable: true }
            : { staffId: draft.technician }),
          date: draft.date,
        },
      );
      if (version === requestVersion) slots = rows;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to find times.';
    } finally {
      busy = false;
    }
  }
  function chooseService(s: PublicService) {
    change('service');
    draft.serviceId = s.id;
    draft.addOnIds = s.addons.filter((a) => a.required).map((a) => a.id);
  }
  function toggleAddon(id: string, checked: boolean) {
    change('addons');
    const addon = service?.addons.find((a) => a.id === id);
    draft.addOnIds = checked
      ? [
          ...draft.addOnIds.filter(
            (other) =>
              other !== id &&
              (!addon?.exclusiveGroup ||
                service?.addons.find((a) => a.id === other)?.exclusiveGroup !==
                  addon.exclusiveGroup),
          ),
          id,
        ]
      : draft.addOnIds.filter((other) => other !== id);
  }
  function price(value: number | null, mode: string) {
    return value === null
      ? 'Price available at the salon'
      : `${mode === 'starting_at' ? 'From ' : ''}${formatMoney(value, salon?.currency ?? 'USD')}`;
  }
  function duration(value: number | null, mode: string) {
    return value === null
      ? ''
      : `${mode === 'starting_at' ? 'From ' : ''}${value} min`;
  }
  async function continueFlow() {
    const startingStep = step;
    error = '';
    if (step === 'details') {
      const parsed = guestContactSchema.safeParse(draft.contact);
      fieldErrors = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          fieldErrors[String(issue.path[0])] = issue.message;
        error = 'Please check the highlighted contact details.';
        await tick();
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        return;
      }
      draft.contact = parsed.data;
      // Refresh the exact selected technician/slot for a server-authoritative review.
      const chosen = draft.slot;
      await search();
      const fresh = slots.find(
        (s) => s.staffId === chosen?.staffId && s.startsAt === chosen?.startsAt,
      );
      if (!fresh) {
        draft.slot = null;
        draft.idempotencyKey = '';
        error = 'That time is no longer available. Please choose another time.';
        await navigate('time');
        return;
      }
      draft.slot = fresh;
    }
    if (step === 'location') await loadCatalog();
    if (step === 'service') await loadPeople();
    if (step === 'technician') {
      draft.date ||= today;
      await search();
    }
    if (step === startingStep) await navigate(steps[index + 1]!);
  }
  async function submit() {
    if (submitting || !draft.slot || !validContact(draft.contact)) return;
    submitting = true;
    error = '';
    draft.idempotencyKey ||= crypto.randomUUID();
    save();
    try {
      const result = await publicApi(`/${slug}/bookings`, publicCreatedSchema, {
        ...selection(),
        staffId: draft.slot.staffId,
        startsAt: draft.slot.startsAt,
        idempotencyKey: draft.idempotencyKey,
        contact: draft.contact,
      });
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Nothing to clear. */
      }
      ready = false;
      await goto(
        // eslint-disable-next-line svelte/no-navigation-without-resolve -- Resolve the path before appending the confirmation query.
        resolve('/book/manage/[token]', { token: result.token }) +
          '?confirmed=1',
        { replaceState: true },
      );
    } catch (e) {
      error =
        e instanceof Error
          ? e.message
          : 'We couldn’t confirm the booking. Please retry; your booking will not be duplicated.';
      if (e instanceof PublicRequestError && e.status === 409) {
        draft.idempotencyKey = '';
        draft.slot = null;
        await search();
        await navigate('time');
      }
      if (e instanceof PublicRequestError && e.status === 404) {
        change('service');
        error =
          'This selection is no longer available. Please choose a service again.';
        await loadCatalog();
        await navigate('service');
      }
    } finally {
      submitting = false;
    }
  }
  onMount(() => {
    void (async () => {
      busy = true;
      try {
        salon = await publicApi(`/${slug}`, publicSalonSchema);
        try {
          const saved = sessionStorage.getItem(storageKey);
          if (saved) draft = bookingDraftSchema.parse(JSON.parse(saved));
        } catch {
          /* Ignore an obsolete draft. */
        }
        if (!salon.locations.some((l) => l.id === draft.locationId)) {
          draft = invalidateBooking(draft, 'location');
          draft.locationId =
            salon.locations.length === 1 ? salon.locations[0]!.id : '';
        }
        if (draft.locationId) await loadCatalog();
        if (service) {
          if (
            draft.variantId &&
            !service.variants.some((v) => v.id === draft.variantId)
          ) {
            change('variant');
            draft.variantId = null;
          }
          const restoredAddons = [
            ...new Set([
              ...draft.addOnIds.filter((id) =>
                service!.addons.some((a) => a.id === id),
              ),
              ...service.addons.filter((a) => a.required).map((a) => a.id),
            ]),
          ];
          if (
            JSON.stringify(restoredAddons) !== JSON.stringify(draft.addOnIds)
          ) {
            change('addons');
            draft.addOnIds = restoredAddons;
          }
          await loadPeople();
        }
        ready = true;
        let target = step;
        if (!draft.locationId) target = 'location';
        else if (!service) target = 'service';
        else if (['details', 'review'].includes(step) && !draft.slot)
          target = 'time';
        else if (step === 'review' && !validContact(draft.contact))
          target = 'details';
        if (target !== step) await navigate(target, true);
        // Never create on load/back/forward. Submission is only the explicit review action.
        if (step === 'time') {
          draft.date ||= today;
          await search();
        }
      } catch (e) {
        error =
          e instanceof Error
            ? e.message
            : 'This salon is not available for booking.';
      } finally {
        busy = false;
      }
    })();
  });
</script>

<svelte:head
  ><title>{salon?.name ?? 'Your appointment'} · Book with Lacquer</title><meta
    name="robots"
    content="noindex"
  /><meta name="referrer" content="no-referrer" /></svelte:head
>
<div class="booking-shell">
  <header class="booking-header">
    <a
      class="salon-wordmark"
      href={resolve('/book/[tenantSlug]', { tenantSlug: slug })}
      >{salon?.name ?? 'A moment for you'}</a
    ><span class="booking-label">BOOK AN APPOINTMENT</span>
  </header>
  {#if ready && salon}
    <nav class="booking-progress" aria-label="Booking progress">
      <ol>
        {#each steps as s, i}<li aria-current={s === step ? 'step' : undefined}>
            <span>{i + 1}</span><span class="step-label">{labels[s]}</span>
          </li>{/each}
      </ol>
      <p>Step {index + 1} of {steps.length} · {labels[step]}</p>
    </nav>
    <div class="booking-layout">
      <section class="booking-content" aria-busy={busy || submitting}>
        <p class="booking-eyebrow">
          {location?.name ?? 'YOUR SALON, YOUR MOMENT'}
        </p>
        <h1 id="booking-title" tabindex="-1">{titles[step]}</h1>
        {#if error}<Notice message={error} />{/if}
        {#if step === 'location'}
          <p class="booking-intro">Choose the studio you’d love to visit.</p>
          <div class="booking-options">
            {#each salon.locations as l}<button
                class:selected={draft.locationId === l.id}
                class="booking-option"
                disabled={busy || submitting}
                aria-pressed={draft.locationId === l.id}
                onclick={() => {
                  change('location');
                  draft.locationId = l.id;
                  draft.date = localDateAt(l.timezone, Date.now());
                }}
                ><span
                  ><strong>{l.name}</strong><small
                    >{[l.addressLine1, l.city, l.region]
                      .filter(Boolean)
                      .join(', ')}</small
                  >{#if l.phone}<small>{l.phone}</small>{/if}</span
                ><span aria-hidden="true"
                  >{draft.locationId === l.id ? '✓' : '↗'}</span
                ></button
              >{/each}
          </div>
          {#if !salon.locations.length}<p>
              Online booking is not available at this salon just yet. Please
              contact the salon.
            </p>{/if}
        {:else if step === 'service'}
          <p class="booking-intro">
            Thoughtful care. A beautiful finish. Choose your treatment.
          </p>
          <div class="category-tabs" aria-label="Service categories">
            {#each categories as c}<button
                class:active={category === c}
                aria-pressed={category === c}
                onclick={() => (category = c)}>{c}</button
              >{/each}
          </div>
          {#each catalog.filter((s) => category === 'All services' || s.category === category) as s}<button
              class="service-row"
              disabled={busy || submitting}
              class:selected={s.id === draft.serviceId}
              aria-pressed={s.id === draft.serviceId}
              onclick={() => chooseService(s)}
              ><span
                ><small class="booking-eyebrow"
                  >{s.category ?? 'TREATMENTS'}</small
                ><strong>{s.name}</strong>{#if s.description}<span
                    class="service-description">{s.description}</span
                  >{/if}<small
                  >{duration(s.durationMinutes, s.durationMode)}</small
                ></span
              ><span class="service-price"
                >{price(s.priceMinorUnits, s.priceMode)}<span
                  class="select-circle"
                  aria-hidden="true"
                  >{s.id === draft.serviceId ? '✓' : '+'}</span
                ></span
              ></button
            >{/each}
          {#if !catalog.length && !busy}<p>
              No online services are available here. Try another location or
              contact the salon.
            </p>{/if}
          {#if service}<div class="service-customization">
              {#if service.variants.length}<label for="variant"
                  >Make it your own</label
                ><select
                  disabled={busy}
                  id="variant"
                  value={draft.variantId ?? ''}
                  onchange={(e) => {
                    change('variant');
                    draft.variantId = e.currentTarget.value || null;
                  }}
                  ><option value=""
                    >Standard · {price(
                      service.priceMinorUnits,
                      service.priceMode,
                    )}</option
                  >{#each service.variants as v}<option value={v.id}
                      >{v.name} · {price(v.priceMinorUnits, service.priceMode)}
                      {duration(
                        v.durationMinutes,
                        service.durationMode,
                      )}</option
                    >{/each}</select
                >{/if}
              {#if service.addons.length}<fieldset>
                  <legend>A little extra</legend
                  >{#each service.addons as a}<label class="addon-option"
                      ><input
                        type="checkbox"
                        checked={draft.addOnIds.includes(a.id)}
                        disabled={busy ||
                          a.required ||
                          Boolean(
                            a.exclusiveGroup &&
                            service.addons.some(
                              (other) =>
                                other.id !== a.id &&
                                other.required &&
                                other.exclusiveGroup === a.exclusiveGroup,
                            ),
                          )}
                        onchange={(e) =>
                          toggleAddon(a.id, e.currentTarget.checked)}
                      /><span
                        >{a.name}{a.required ? ' · Required' : ''}<small
                          >{a.description ?? ''}</small
                        ></span
                      ><span
                        >{a.priceMinorUnits === null
                          ? ''
                          : formatMoney(a.priceMinorUnits, salon.currency)}
                        {duration(a.durationMinutes, 'exact')}</span
                      ></label
                    >{/each}
                </fieldset>{/if}
              <p class="booking-hint">
                Your chosen technician’s price and appointment length are shown
                next.
              </p>
            </div>{/if}
        {:else if step === 'technician'}
          <p class="booking-intro">
            Choose a familiar face, or let us find your perfect time.
          </p>
          <div class="booking-options">
            <button
              class="booking-option"
              disabled={busy || submitting}
              class:selected={draft.technician === 'any'}
              aria-pressed={draft.technician === 'any'}
              onclick={() => {
                change('technician');
                draft.technician = 'any';
              }}
              ><span class="person-mark" aria-hidden="true">✧</span><span
                ><strong>Any Available Technician</strong><small
                  >More possibilities. The same thoughtful care.</small
                ></span
              ><span aria-hidden="true"
                >{draft.technician === 'any' ? '✓' : '+'}</span
              ></button
            >
            {#each people as p}<button
                class="booking-option"
                disabled={busy || submitting}
                class:selected={draft.technician === p.id}
                aria-pressed={draft.technician === p.id}
                onclick={() => {
                  change('technician');
                  draft.technician = p.id;
                }}
                ><span class="person-mark" aria-hidden="true"
                  >{p.name.charAt(0)}</span
                ><span
                  ><strong>{p.name}</strong><small
                    >{price(p.priceMinorUnits, p.priceMode)} · {duration(
                      p.durationMinutes,
                      p.durationMode,
                    )}</small
                  ></span
                ><span aria-hidden="true"
                  >{draft.technician === p.id ? '✓' : '+'}</span
                ></button
              >{/each}
          </div>
          {#if !people.length && !busy}<p>
              No technicians are available for this selection. Please go back
              and choose another service or option.
            </p>{/if}
        {:else if step === 'time'}
          <p class="booking-intro">
            A time that fits your day. All times in {location?.timezone}.
          </p>
          <label for="booking-date">Choose a date</label>
          <div class="date-navigation">
            <button
              aria-label="Previous day"
              disabled={draft.date <= today || busy}
              onclick={() => {
                change('date');
                draft.date = addLocalDays(draft.date, -1);
                void search();
              }}>←</button
            ><input
              id="booking-date"
              type="date"
              min={today}
              max={lastDate}
              value={draft.date}
              onchange={(e) => {
                change('date');
                draft.date = e.currentTarget.value;
                void search();
              }}
            /><button
              aria-label="Next day"
              disabled={draft.date >= lastDate || busy}
              onclick={() => {
                change('date');
                draft.date = addLocalDays(draft.date, 1);
                void search();
              }}>→</button
            >
          </div>
          {#if busy}<p role="status">
              Finding your next moment…
            </p>{:else if slots.length}<p class="booking-hint">
              {slots.length} available appointments · {formatLocalDateLabel(
                draft.date,
              )}
            </p>
            <div class="time-slots" aria-label="Available appointments">
              {#each slots as s}<button
                  class:selected={draft.slot?.startsAt === s.startsAt &&
                    draft.slot?.staffId === s.staffId}
                  aria-pressed={draft.slot?.startsAt === s.startsAt &&
                    draft.slot?.staffId === s.staffId}
                  onclick={() => {
                    draft.slot = s;
                    draft.idempotencyKey = '';
                  }}
                  ><strong
                    >{new Intl.DateTimeFormat('en-US', {
                      timeZone: location!.timezone,
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(s.startsAt))}</strong
                  ><small>{s.staffName}</small></button
                >{/each}
            </div>{:else}<div class="booking-empty">
              <h2>A little more room on another day.</h2>
              <p>
                No appointments are available for this date. Try another day or
                technician.
              </p>
              <button
                class="booking-text-button"
                onclick={() => void navigate('technician')}
                >Choose another technician</button
              ><button
                class="booking-text-button"
                onclick={() => void navigate('service')}
                >Explore other services</button
              >{#if salon.locations.length > 1}<button
                  class="booking-text-button"
                  onclick={() => void navigate('location')}
                  >Try another location</button
                >{/if}<button
                class="booking-text-button"
                onclick={() => void search()}>Refresh available times</button
              >
            </div>{/if}
        {:else if step === 'details'}
          <p class="booking-intro">
            Just the essentials, so the salon can get in touch. No account
            needed.
          </p>
          <form
            id="guest-details"
            onsubmit={(e) => {
              e.preventDefault();
              void continueFlow();
            }}
            novalidate
          >
            <div class="name-fields">
              {#each ['firstName', 'lastName'] as name}{@const key = name as
                  'firstName' | 'lastName'}<label for={key}
                  >{key === 'firstName' ? 'First name' : 'Last name'}<input
                    id={key}
                    autocomplete={key === 'firstName'
                      ? 'given-name'
                      : 'family-name'}
                    bind:value={draft.contact[key]}
                    oninput={() => (draft.idempotencyKey = '')}
                    required
                    maxlength="80"
                    aria-invalid={Boolean(fieldErrors[key])}
                    aria-describedby={fieldErrors[key]
                      ? `${key}-error`
                      : undefined}
                  />{#if fieldErrors[key]}<small
                      class="field-error"
                      id={`${key}-error`}>{fieldErrors[key]}</small
                    >{/if}</label
                >{/each}
            </div>
            <label for="email"
              >Email<input
                id="email"
                type="email"
                autocomplete="email"
                bind:value={draft.contact.email}
                oninput={() => (draft.idempotencyKey = '')}
                required
                maxlength="254"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              />{#if fieldErrors.email}<small
                  class="field-error"
                  id="email-error">Enter a valid email address.</small
                >{/if}</label
            >
            <label for="phone"
              >Phone<input
                id="phone"
                type="tel"
                autocomplete="tel"
                bind:value={draft.contact.phone}
                oninput={() => (draft.idempotencyKey = '')}
                required
                maxlength="30"
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'phone-error' : undefined}
              />{#if fieldErrors.phone}<small
                  class="field-error"
                  id="phone-error">Enter a valid phone number.</small
                >{/if}</label
            >
            <label for="note"
              >Anything you’d like us to know? <span class="booking-hint"
                >Optional</span
              ><textarea
                id="note"
                bind:value={draft.contact.customerNote}
                oninput={() => (draft.idempotencyKey = '')}
                maxlength="2000"
                rows="3"
                placeholder="Your current nails, a shape you love, or a little detail for your visit."
              ></textarea></label
            >
            <p class="booking-hint">
              Your contact details are shared only with the salon for your
              appointment.
            </p>
          </form>
        {:else if step === 'review' && draft.slot && service}
          <p class="booking-intro">One last look before we save your place.</p>
          <div class="review-treatment">
            <p class="booking-eyebrow">YOUR TREATMENT</p>
            <h2>{service.name}</h2>
            {#if draft.variantId}<p>
                {service.variants.find((v) => v.id === draft.variantId)?.name}
              </p>{/if}{#if draft.addOnIds.length}<p>
                {service.addons
                  .filter((a) => draft.addOnIds.includes(a.id))
                  .map((a) => a.name)
                  .join(' · ')}
              </p>{/if}
            <dl>
              <div>
                <dt>With</dt>
                <dd>{draft.slot.staffName}</dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>
                  {formatInstant(draft.slot.startsAt, location!.timezone)}<small
                    >{location!.timezone}</small
                  >
                </dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{location?.name}<small>{location?.addressLine1}</small></dd>
              </div>
              {#if draft.slot.durationMinutes !== null}<div>
                  <dt>Appointment length</dt>
                  <dd>
                    {duration(
                      draft.slot.durationMinutes,
                      draft.slot.durationMode,
                    )}
                  </dd>
                </div>{/if}
              <div class="review-total">
                <dt>
                  {draft.slot.priceMode === 'starting_at'
                    ? 'Starting at'
                    : 'Subtotal'}
                </dt>
                <dd>{price(draft.slot.priceMinorUnits, 'exact')}</dd>
              </div>
            </dl>
          </div>
          <div class="review-contact">
            <h2>Your details</h2>
            <p>
              {draft.contact.firstName}
              {draft.contact.lastName}<br />{draft.contact.email}<br />{draft
                .contact.phone}
            </p>
            {#if draft.contact.customerNote}<p class="customer-note">
                {draft.contact.customerNote}
              </p>{/if}<button
              class="booking-text-button"
              onclick={() => void navigate('details')}>Edit details</button
            >
          </div>
          <p class="booking-hint">
            Your appointment is confirmed only after you select “Confirm
            booking”.
          </p>
        {/if}
        <div class="booking-actions">
          <button
            class="booking-back"
            disabled={index === 0 || busy || submitting}
            onclick={() => void navigate(steps[index - 1]!)}>← Back</button
          >{#if step === 'review'}<Button
              onclick={() => void submit()}
              disabled={busy || submitting || !draft.slot}
              >{submitting ? 'Confirming…' : 'Confirm booking'}</Button
            >{:else if step === 'details'}<Button
              type="submit"
              form="guest-details"
              disabled={busy}>Review booking →</Button
            >{:else}<Button
              disabled={!canContinue}
              onclick={() => void continueFlow()}
              >{busy ? 'Just a moment…' : 'Continue →'}</Button
            >{/if}
        </div>
      </section>
      <aside class="booking-aside" aria-label="Your visit">
        <div class="aside-art" aria-hidden="true">
          <span>Time<br />well spent.</span>
        </div>
        <p class="booking-eyebrow">YOUR VISIT</p>
        <h2>{service?.name ?? 'Something lovely awaits.'}</h2>
        <p>{location?.name ?? salon.name}</p>
        {#if draft.slot}<p>
            {draft.slot.staffName}<br />{formatInstant(
              draft.slot.startsAt,
              location!.timezone,
            )}
          </p>
          <p>
            {price(draft.slot.priceMinorUnits, draft.slot.priceMode)}
          </p>{:else}<p class="booking-hint">
            A fresh finish.<br />A moment to slow down.
          </p>{/if}<span class="booking-hint"
          >Thoughtfully booked with Lacquer</span
        >
      </aside>
    </div>
  {:else}<section class="booking-loading">
      {#if error}<h1>We couldn’t open this salon.</h1>
        <Notice message={error} /><button
          class="booking-text-button"
          onclick={() => window.location.reload()}>Try again</button
        >{:else}<p role="status">A moment, while we get things ready…</p>{/if}
    </section>{/if}
  <footer class="booking-footer">
    A little care goes a long way. <span>Booking by Lacquer</span>
  </footer>
</div>
