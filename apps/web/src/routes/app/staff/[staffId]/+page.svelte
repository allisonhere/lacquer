<script lang="ts">
  import { z } from 'zod';
  import { page } from '$app/state';
  import { Button, Notice } from '@lacquer/ui';
  import {
    staffDetailSchema,
    staffSchema,
    locationSchema,
    skillSchema,
    serviceListItemSchema,
    scheduleBlockSchema,
    timeOffSchema,
    availabilityOverrideSchema,
    okSchema,
    type StaffDetail,
    type Location,
    type Skill,
    type ServiceListItem,
    type ScheduleBlock,
    type TimeOff,
    type AvailabilityOverride,
  } from '@lacquer/schemas';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  import ScheduleEditor from '$lib/ScheduleEditor.svelte';
  import {
    formatMoneyInput,
    parseMoney,
    formatInstant,
    formatLocalDateLabel,
    formatMinutes,
    noticeOptions,
    MoneyParseError,
  } from '$lib/format';
  /**
   * Staff editor. Settings are split across tabs rather than one enormous form,
   * so a salon manager can find the thing they came to change.
   */
  const tabs = [
    { id: 'profile', label: 'Profile' },
    { id: 'locations', label: 'Locations' },
    { id: 'skills', label: 'Skills' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'timeoff', label: 'Time off' },
    { id: 'booking', label: 'Booking rules' },
    { id: 'services', label: 'Service pricing' },
  ] as const;
  let tab = $state<(typeof tabs)[number]['id']>('profile');
  let staffId = $derived(page.params.staffId ?? '');
  let staff = $state<StaffDetail | null>(null);
  let locations = $state<Location[]>([]);
  let skills = $state<Skill[]>([]);
  let services = $state<ServiceListItem[]>([]);
  let schedule = $state<ScheduleBlock[]>([]);
  let timeOff = $state<TimeOff[]>([]);
  let overrides = $state<AvailabilityOverride[]>([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let scheduleLocationId = $state('');
  let canManage = $derived(workspace.can('manage_staff'));
  let currency = $state('USD');
  // Time-off form
  let offStart = $state('');
  let offEnd = $state('');
  let offReason = $state('');
  let offLocationId = $state('');
  // Availability override form
  let ovKind = $state<'added' | 'removed'>('added');
  let ovDate = $state('');
  let ovStart = $state('10:00');
  let ovEnd = $state('16:00');
  let ovLocationId = $state('');
  async function load() {
    if (!workspace.tenantId || !staffId) return;
    loading = true;
    error = '';
    try {
      const [detail, places, allSkills, allServices, blocks, off, exceptions] =
        await Promise.all([
          api(tenantPath(`/staff/${staffId}`), staffDetailSchema),
          api(tenantPath('/locations'), z.array(locationSchema)),
          api(tenantPath('/skills'), z.array(skillSchema)),
          api(tenantPath('/services'), z.array(serviceListItemSchema)),
          api(
            tenantPath(`/staff/${staffId}/schedule`),
            z.array(scheduleBlockSchema),
          ),
          api(tenantPath(`/staff/${staffId}/time-off`), z.array(timeOffSchema)),
          api(
            tenantPath(`/staff/${staffId}/availability-overrides`),
            z.array(availabilityOverrideSchema),
          ),
        ]);
      staff = detail;
      locations = places;
      skills = allSkills;
      services = allServices;
      schedule = blocks;
      timeOff = off;
      overrides = exceptions;
      const assigned = places.filter((p) => detail.locationIds.includes(p.id));
      scheduleLocationId = assigned[0]?.id ?? '';
      offLocationId = assigned[0]?.id ?? '';
      ovLocationId = assigned[0]?.id ?? '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load this profile.';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void workspace.tenantId;
    void staffId;
    void load();
  });
  async function act(work: () => Promise<unknown>, success: string) {
    busy = true;
    error = '';
    notice = '';
    try {
      await work();
      await load();
      notice = success;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the change.';
    } finally {
      busy = false;
    }
  }
  function patchStaff(body: Record<string, unknown>, success: string) {
    return act(
      () =>
        api(tenantPath(`/staff/${staffId}`), staffSchema, {
          method: 'PATCH',
          body,
        }),
      success,
    );
  }
  let assignedLocations = $derived(
    locations.filter((location) => staff?.locationIds.includes(location.id)),
  );
  function toggleLocation(locationId: string, checked: boolean) {
    const next = checked
      ? [...(staff?.locationIds ?? []), locationId]
      : (staff?.locationIds ?? []).filter((id) => id !== locationId);
    return act(
      () =>
        api(tenantPath(`/staff/${staffId}/locations`), okSchema, {
          method: 'PUT',
          body: { locationIds: next },
        }),
      'Locations updated.',
    );
  }
  function toggleSkill(skillId: string, checked: boolean) {
    const next = checked
      ? [...(staff?.skillIds ?? []), skillId]
      : (staff?.skillIds ?? []).filter((id) => id !== skillId);
    return act(
      () =>
        api(tenantPath(`/staff/${staffId}/skills`), okSchema, {
          method: 'PUT',
          body: { skillIds: next },
        }),
      'Skills updated.',
    );
  }
  function saveSchedule(
    locationId: string,
    blocks: {
      kind: 'work' | 'break';
      weekday: number;
      startMinute: number;
      endMinute: number;
    }[],
  ) {
    return api(
      tenantPath(`/staff/${staffId}/schedule`),
      z.array(scheduleBlockSchema),
      { method: 'PUT', body: { locationId, blocks } },
    ).then(async (result) => {
      schedule = result;
      notice = 'Schedule saved.';
    });
  }
  function addTimeOff(event: SubmitEvent) {
    event.preventDefault();
    return act(
      () =>
        api(tenantPath(`/staff/${staffId}/time-off`), timeOffSchema, {
          method: 'POST',
          body: {
            locationId: offLocationId || null,
            startsAt: new Date(offStart).toISOString(),
            endsAt: new Date(offEnd).toISOString(),
            reason: offReason || null,
          },
        }),
      'Time off recorded.',
    ).then(() => {
      offStart = '';
      offEnd = '';
      offReason = '';
    });
  }
  function cancelTimeOff(id: string) {
    return act(
      () =>
        api(tenantPath(`/staff/${staffId}/time-off/${id}`), timeOffSchema, {
          method: 'PATCH',
          body: { status: 'cancelled' },
        }),
      'Time off cancelled.',
    );
  }
  function addOverride(event: SubmitEvent) {
    event.preventDefault();
    return act(
      () =>
        api(
          tenantPath(`/staff/${staffId}/availability-overrides`),
          availabilityOverrideSchema,
          {
            method: 'POST',
            body: {
              locationId: ovLocationId,
              kind: ovKind,
              localDate: ovDate,
              startMinute:
                Number(ovStart.split(':')[0]) * 60 +
                Number(ovStart.split(':')[1]),
              endMinute:
                Number(ovEnd.split(':')[0]) * 60 + Number(ovEnd.split(':')[1]),
            },
          },
        ),
      'Availability exception added.',
    ).then(() => {
      ovDate = '';
    });
  }
  function removeOverride(id: string) {
    return act(
      () =>
        api(
          tenantPath(`/staff/${staffId}/availability-overrides/${id}`),
          okSchema,
          { method: 'DELETE' },
        ),
      'Exception removed.',
    );
  }
  function overrideFor(serviceId: string) {
    return staff?.serviceOverrides.find((row) => row.serviceId === serviceId);
  }
  async function saveServiceOverride(serviceId: string, form: HTMLFormElement) {
    const data = new FormData(form);
    const priceText = String(data.get('price') ?? '').trim();
    const durationText = String(data.get('duration') ?? '').trim();
    let priceOverride: number | null = null;
    try {
      priceOverride = priceText ? parseMoney(priceText, currency) : null;
    } catch (e) {
      error = e instanceof MoneyParseError ? e.message : 'Invalid price.';
      return;
    }
    await act(
      () =>
        api(
          tenantPath(`/staff/${staffId}/services/${serviceId}/override`),
          okSchema,
          {
            method: 'PUT',
            body: {
              priceOverride,
              durationOverrideMinutes: durationText
                ? Number(durationText)
                : null,
              bufferBeforeOverrideMinutes: null,
              bufferAfterOverrideMinutes: null,
            },
          },
        ),
      'Pricing override saved.',
    );
  }
</script>

<svelte:head
  ><title>{staff?.displayName ?? 'Staff'} · Lacquer</title></svelte:head
>
<p class="breadcrumb"><a href={resolve('/app/staff')}>← All staff</a></p>
{#if loading}
  <p role="status">Loading profile…</p>
{:else if !staff}
  <Notice message={error || 'This team member could not be found.'} />
{:else}
  <div class="page-heading">
    <div>
      <p class="eyebrow">Team member</p>
      <h1>{staff.displayName}</h1>
      <p class="muted">
        {staff.active ? 'Active' : 'Inactive'} ·
        {staff.acceptsOnlineBookings
          ? 'Accepts online bookings'
          : 'In-salon bookings only'}
      </p>
    </div>
  </div>
  {#if error}<Notice message={error} />{/if}
  {#if notice}<p class="success" role="status">{notice}</p>{/if}
  <div class="tabs" role="tablist" aria-label="Staff settings">
    {#each tabs as entry (entry.id)}
      <button
        role="tab"
        type="button"
        id="tab-{entry.id}"
        aria-selected={tab === entry.id}
        aria-controls="panel-{entry.id}"
        class:active={tab === entry.id}
        onclick={() => (tab = entry.id)}>{entry.label}</button
      >
    {/each}
  </div>

  {#if tab === 'profile'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-profile"
      aria-labelledby="tab-profile"
    >
      <h2>Profile</h2>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget as HTMLFormElement);
          void patchStaff(
            {
              displayName: String(data.get('displayName')),
              firstName: String(data.get('firstName') || '') || null,
              lastName: String(data.get('lastName') || '') || null,
              email: String(data.get('email') || '') || null,
              phone: String(data.get('phone') || '') || null,
              bio: String(data.get('bio') || '') || null,
            },
            'Profile saved.',
          );
        }}
        aria-busy={busy}
      >
        <div class="form-grid">
          <label
            >Display name<input
              name="displayName"
              value={staff.displayName}
              required
              maxlength="160"
              disabled={!canManage}
            /></label
          >
          <label
            >First name<input
              name="firstName"
              value={staff.firstName ?? ''}
              maxlength="120"
              disabled={!canManage}
            /></label
          >
          <label
            >Last name<input
              name="lastName"
              value={staff.lastName ?? ''}
              maxlength="120"
              disabled={!canManage}
            /></label
          >
          <label
            >Email<input
              name="email"
              type="email"
              value={staff.email ?? ''}
              maxlength="254"
              disabled={!canManage}
            /></label
          >
          <label
            >Phone<input
              name="phone"
              type="tel"
              value={staff.phone ?? ''}
              maxlength="40"
              disabled={!canManage}
            /></label
          >
        </div>
        <label
          >About<textarea
            name="bio"
            rows="3"
            maxlength="2000"
            disabled={!canManage}>{staff.bio ?? ''}</textarea
          ></label
        >
        {#if canManage}
          <div class="form-footer">
            <Button type="submit" disabled={busy}>Save profile</Button>
            <button
              type="button"
              class="text-button"
              disabled={busy}
              onclick={() =>
                patchStaff(
                  { active: !staff?.active },
                  staff?.active
                    ? 'Team member deactivated.'
                    : 'Team member reactivated.',
                )}>{staff.active ? 'Deactivate' : 'Reactivate'}</button
            >
          </div>
          <p class="hint">
            Deactivating keeps their history and removes them from new bookings.
            Team members are never deleted.
          </p>
        {/if}
      </form>
    </div>
  {:else if tab === 'locations'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-locations"
      aria-labelledby="tab-locations"
    >
      <h2>Locations</h2>
      <p class="muted">
        Where this person works. A schedule is built per location.
      </p>
      {#if !locations.length}
        <div class="empty-state">
          <h3>No locations yet.</h3>
          <p>Add one from the Overview screen.</p>
        </div>
      {:else}
        <ul class="check-list">
          {#each locations as location (location.id)}
            <li>
              <label
                ><input
                  type="checkbox"
                  checked={staff.locationIds.includes(location.id)}
                  disabled={!canManage || busy}
                  onchange={(e) =>
                    toggleLocation(location.id, e.currentTarget.checked)}
                />
                {location.name}
                <span class="muted">{location.timezone}</span></label
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if tab === 'skills'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-skills"
      aria-labelledby="tab-skills"
    >
      <h2>Skills and certifications</h2>
      <p class="muted">
        Services can require a skill. Someone without it will not be offered for
        that service.
      </p>
      {#if !skills.length}
        <div class="empty-state">
          <h3>No skills defined.</h3>
          <p>Add them under Services.</p>
        </div>
      {:else}
        <ul class="check-list">
          {#each skills as skill (skill.id)}
            <li>
              <label
                ><input
                  type="checkbox"
                  checked={staff.skillIds.includes(skill.id)}
                  disabled={!canManage || busy}
                  onchange={(e) =>
                    toggleSkill(skill.id, e.currentTarget.checked)}
                />
                {skill.name}
                {#if skill.description}<span class="muted"
                    >{skill.description}</span
                  >{/if}</label
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if tab === 'schedule'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-schedule"
      aria-labelledby="tab-schedule"
    >
      <h2>Weekly schedule</h2>
      <p class="muted">
        Add more than one shift on a day for a split shift, and breaks for
        regular downtime.
      </p>
      <ScheduleEditor
        blocks={schedule}
        locations={assignedLocations}
        bind:locationId={scheduleLocationId}
        readonly={!canManage}
        onsave={saveSchedule}
      />
    </div>
  {:else if tab === 'timeoff'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-timeoff"
      aria-labelledby="tab-timeoff"
    >
      <h2>Time off</h2>
      {#if canManage}
        <form onsubmit={addTimeOff} aria-busy={busy}>
          <div class="form-grid">
            <label
              >Starts<input
                type="datetime-local"
                bind:value={offStart}
                required
              /></label
            >
            <label
              >Ends<input
                type="datetime-local"
                bind:value={offEnd}
                required
              /></label
            >
            <label
              >Location<select bind:value={offLocationId}>
                <option value="">All locations</option>
                {#each assignedLocations as location (location.id)}
                  <option value={location.id}>{location.name}</option>
                {/each}
              </select></label
            >
            <label
              >Reason<input
                bind:value={offReason}
                maxlength="500"
                placeholder="Vacation"
              /></label
            >
          </div>
          <Button type="submit" disabled={busy}>Add time off</Button>
        </form>
      {/if}
      {#if !timeOff.length}
        <div class="empty-state"><h3>No time off booked.</h3></div>
      {:else}
        <ul class="record-list plain">
          {#each timeOff as entry (entry.id)}
            <li class="record" class:cancelled={entry.status === 'cancelled'}>
              <span class="record-main">
                <strong
                  >{formatInstant(entry.startsAt, entry.locationTimezone)} → {formatInstant(
                    entry.endsAt,
                    entry.locationTimezone,
                  )}</strong
                >
                <span class="muted"
                  >{entry.reason ?? 'No reason given'} · {entry.locationTimezone}</span
                >
              </span>
              <span class="record-meta">
                <span class="status">{entry.status}</span>
                {#if canManage && entry.status === 'scheduled'}
                  <button
                    type="button"
                    class="text-button"
                    disabled={busy}
                    onclick={() => cancelTimeOff(entry.id)}>Cancel</button
                  >
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <h3>Dated exceptions</h3>
      <p class="muted">
        One-off changes to the weekly schedule: an extra Sunday, or an early
        finish.
      </p>
      {#if canManage}
        <form onsubmit={addOverride} aria-busy={busy}>
          <div class="form-grid">
            <label
              >Kind<select bind:value={ovKind}>
                <option value="added">Extra availability</option>
                <option value="removed">Unavailable</option>
              </select></label
            >
            <label>Date<input type="date" bind:value={ovDate} required /></label
            >
            <label
              >From<input type="time" bind:value={ovStart} required /></label
            >
            <label>To<input type="time" bind:value={ovEnd} required /></label>
            <label
              >Location<select bind:value={ovLocationId} required>
                {#each assignedLocations as location (location.id)}
                  <option value={location.id}>{location.name}</option>
                {/each}
              </select></label
            >
          </div>
          <Button type="submit" disabled={busy || !assignedLocations.length}
            >Add exception</Button
          >
        </form>
      {/if}
      {#if overrides.length}
        <ul class="record-list plain">
          {#each overrides as entry (entry.id)}
            <li class="record">
              <span class="record-main">
                <strong
                  >{formatLocalDateLabel(entry.localDate)} · {formatMinutes(
                    entry.startMinute,
                  )}–{formatMinutes(entry.endMinute)}</strong
                >
                <span class="muted"
                  >{entry.kind === 'added'
                    ? 'Extra availability'
                    : 'Unavailable'}</span
                >
              </span>
              {#if canManage}
                <button
                  type="button"
                  class="text-button"
                  disabled={busy}
                  onclick={() => removeOverride(entry.id)}>Remove</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if tab === 'booking'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-booking"
      aria-labelledby="tab-booking"
    >
      <h2>Booking rules</h2>
      <p class="muted">
        Leave anything blank to follow the salon-wide setting under Scheduling.
      </p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget as HTMLFormElement);
          const num = (key: string) => {
            const raw = String(data.get(key) ?? '').trim();
            return raw === '' ? null : Number(raw);
          };
          const breakChoice = String(data.get('autoBreak'));
          void patchStaff(
            {
              acceptsOnlineBookings: data.get('acceptsOnlineBookings') === 'on',
              minimumBookingNoticeOverrideMinutes: num('notice'),
              maxAppointmentsPerDay: num('maxAppointments'),
              maxBookedMinutesPerDay: num('maxMinutes'),
              autoBreakEnabled:
                breakChoice === 'inherit' ? null : breakChoice === 'on',
              autoBreakDurationMinutes: num('breakDuration'),
            },
            'Booking rules saved.',
          );
        }}
        aria-busy={busy}
      >
        <label class="inline-check"
          ><input
            type="checkbox"
            name="acceptsOnlineBookings"
            checked={staff.acceptsOnlineBookings}
            disabled={!canManage}
          /> Accepts online bookings</label
        >
        <div class="form-grid">
          <label
            >Minimum booking notice<select
              name="notice"
              disabled={!canManage}
              value={String(staff.minimumBookingNoticeOverrideMinutes ?? '')}
            >
              <option value="">Use salon default</option>
              {#each noticeOptions as option (option.minutes)}
                <option value={String(option.minutes)}>{option.label}</option>
              {/each}
            </select></label
          >
          <label
            >Maximum appointments per day<input
              name="maxAppointments"
              type="number"
              min="1"
              max="100"
              value={staff.maxAppointmentsPerDay ?? ''}
              placeholder="No limit"
              disabled={!canManage}
            /></label
          >
          <label
            >Maximum booked minutes per day<input
              name="maxMinutes"
              type="number"
              min="1"
              max="1440"
              value={staff.maxBookedMinutesPerDay ?? ''}
              placeholder="No limit"
              disabled={!canManage}
            /></label
          >
          <label
            >Automatic breaks<select
              name="autoBreak"
              disabled={!canManage}
              value={staff.autoBreakEnabled === null
                ? 'inherit'
                : staff.autoBreakEnabled
                  ? 'on'
                  : 'off'}
            >
              <option value="inherit">Use salon default</option>
              <option value="on">On for this person</option>
              <option value="off">Off for this person</option>
            </select></label
          >
          <label
            >Break length (minutes)<input
              name="breakDuration"
              type="number"
              min="1"
              max="1440"
              value={staff.autoBreakDurationMinutes ?? ''}
              placeholder="Use salon default"
              disabled={!canManage}
            /></label
          >
        </div>
        {#if canManage}<Button type="submit" disabled={busy}
            >Save booking rules</Button
          >{/if}
      </form>
    </div>
  {:else}
    <div
      class="panel"
      role="tabpanel"
      id="panel-services"
      aria-labelledby="tab-services"
    >
      <h2>Service pricing</h2>
      <p class="muted">
        Override what this person charges or how long they take. Blank means the
        service default applies.
      </p>
      {#if !services.length}
        <div class="empty-state"><h3>No services yet.</h3></div>
      {:else}
        <ul class="record-list plain">
          {#each services as service (service.id)}
            {@const existing = overrideFor(service.id)}
            <li class="record override-row">
              <span class="record-main">
                <strong>{service.name}</strong>
                <span class="muted"
                  >Default {formatMoneyInput(service.basePrice, currency)} ·
                  {service.baseDurationMinutes} min</span
                >
              </span>
              <form
                class="override-form"
                onsubmit={(e) => {
                  e.preventDefault();
                  void saveServiceOverride(
                    service.id,
                    e.currentTarget as HTMLFormElement,
                  );
                }}
              >
                <label
                  >Price<input
                    name="price"
                    inputmode="decimal"
                    placeholder="Default"
                    value={existing?.priceOverride != null
                      ? formatMoneyInput(existing.priceOverride, currency)
                      : ''}
                    disabled={!canManage}
                  /></label
                >
                <label
                  >Minutes<input
                    name="duration"
                    type="number"
                    min="1"
                    max="1440"
                    placeholder="Default"
                    value={existing?.durationOverrideMinutes ?? ''}
                    disabled={!canManage}
                  /></label
                >
                {#if canManage}
                  <Button type="submit" disabled={busy}>Save</Button>
                {/if}
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
{/if}
