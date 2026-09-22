<script lang="ts">
  import { z } from 'zod';
  import { page } from '$app/state';
  import { Button, Notice } from '@lacquer/ui';
  import {
    serviceDetailSchema,
    serviceSchema,
    variantSchema,
    locationSchema,
    skillSchema,
    addOnSchema,
    effectiveServiceValuesSchema,
    okSchema,
    type ServiceDetail,
    type Location,
    type Skill,
    type AddOn,
    type StaffListItem,
    type EffectiveServiceValues,
  } from '@lacquer/schemas';
  import { staffListItemSchema } from '@lacquer/schemas';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  import {
    formatMoney,
    formatMoneyInput,
    parseMoney,
    MoneyParseError,
    priceDisplayLabels,
    durationDisplayLabels,
    eligibilityModeLabels,
    eligibilityReasons,
  } from '$lib/format';
  const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'locations', label: 'Locations' },
    { id: 'options', label: 'Options' },
    { id: 'addons', label: 'Add-ons' },
    { id: 'staff', label: 'Who can do it' },
  ] as const;
  let tab = $state<(typeof tabs)[number]['id']>('details');
  let serviceId = $derived(page.params.serviceId ?? '');
  let service = $state<ServiceDetail | null>(null);
  let locations = $state<Location[]>([]);
  let skills = $state<Skill[]>([]);
  let addOns = $state<AddOn[]>([]);
  let staff = $state<StaffListItem[]>([]);
  let eligibility = $state<EffectiveServiceValues[]>([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let currency = $state('USD');
  let canManage = $derived(workspace.can('manage_services'));
  let staffNames = $derived(
    new Map(staff.map((member) => [member.id, member.displayName])),
  );
  async function load() {
    if (!workspace.tenantId || !serviceId) return;
    loading = true;
    error = '';
    try {
      const [detail, places, sk, ad, people, elig] = await Promise.all([
        api(tenantPath(`/services/${serviceId}`), serviceDetailSchema),
        api(tenantPath('/locations'), z.array(locationSchema)),
        api(tenantPath('/skills'), z.array(skillSchema)),
        api(tenantPath('/add-ons'), z.array(addOnSchema)),
        api(tenantPath('/staff'), z.array(staffListItemSchema)),
        api(
          tenantPath(`/services/${serviceId}/staff`),
          z.array(effectiveServiceValuesSchema),
        ),
      ]);
      service = detail;
      locations = places;
      skills = sk;
      addOns = ad;
      staff = people;
      eligibility = elig;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load this service.';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void workspace.tenantId;
    void serviceId;
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
  function patchService(body: Record<string, unknown>, success: string) {
    return act(
      () =>
        api(tenantPath(`/services/${serviceId}`), serviceSchema, {
          method: 'PATCH',
          body,
        }),
      success,
    );
  }
  function replaceSet(
    path: string,
    key: string,
    ids: string[],
    success: string,
  ) {
    return act(
      () =>
        api(tenantPath(`/services/${serviceId}/${path}`), okSchema, {
          method: 'PUT',
          body: { [key]: ids },
        }),
      success,
    );
  }
  function toggle(list: string[], id: string, checked: boolean) {
    return checked ? [...list, id] : list.filter((entry) => entry !== id);
  }
  function saveDetails(event: SubmitEvent) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    let basePrice: number;
    try {
      basePrice = parseMoney(String(data.get('price') ?? ''), currency);
    } catch (e) {
      error = e instanceof MoneyParseError ? e.message : 'Invalid price.';
      return;
    }
    const optionalNumber = (key: string) => {
      const raw = String(data.get(key) ?? '').trim();
      return raw === '' ? null : Number(raw);
    };
    void patchService(
      {
        name: String(data.get('name')),
        description: String(data.get('description') || '') || null,
        internalDescription:
          String(data.get('internalDescription') || '') || null,
        basePrice,
        baseDurationMinutes: Number(data.get('duration')),
        priceDisplayMode: String(data.get('priceDisplayMode')),
        durationDisplayMode: String(data.get('durationDisplayMode')),
        bufferBeforeMinutes: optionalNumber('bufferBefore'),
        bufferAfterMinutes: optionalNumber('bufferAfter'),
        staffEligibilityMode: String(data.get('staffEligibilityMode')),
        visibleOnline: data.get('visibleOnline') === 'on',
        acceptsOnlineBooking: data.get('acceptsOnlineBooking') === 'on',
      },
      'Service saved.',
    );
  }
  function addVariant(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    let price: number;
    try {
      price = parseMoney(String(data.get('price') ?? ''), currency);
    } catch (e) {
      error = e instanceof MoneyParseError ? e.message : 'Invalid price.';
      return;
    }
    void act(
      () =>
        api(tenantPath(`/services/${serviceId}/variants`), variantSchema, {
          method: 'POST',
          body: {
            name: String(data.get('name')),
            price,
            durationMinutes: Number(data.get('duration')),
            sortOrder: service?.variants.length ?? 0,
          },
        }),
      'Option added.',
    ).then(() => form.reset());
  }
</script>

<svelte:head><title>{service?.name ?? 'Service'} · Lacquer</title></svelte:head>
<p class="breadcrumb"><a href={resolve('/app/services')}>← All services</a></p>
{#if loading}
  <p role="status">Loading service…</p>
{:else if !service}
  <Notice message={error || 'This service could not be found.'} />
{:else}
  <div class="page-heading">
    <div>
      <p class="eyebrow">{service.categoryName ?? 'Uncategorised'}</p>
      <h1>{service.name}</h1>
      <p class="muted">
        {formatMoney(service.basePrice, currency)} · {service.baseDurationMinutes}
        minutes
        {#if !service.active}· Inactive{/if}
      </p>
    </div>
  </div>
  {#if error}<Notice message={error} />{/if}
  {#if notice}<p class="success" role="status">{notice}</p>{/if}
  <div class="tabs" role="tablist" aria-label="Service settings">
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
  {#if tab === 'details'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-details"
      aria-labelledby="tab-details"
    >
      <h2>Details</h2>
      <form onsubmit={saveDetails} aria-busy={busy}>
        <div class="form-grid">
          <label
            >Name<input
              name="name"
              value={service.name}
              required
              maxlength="160"
              disabled={!canManage}
            /></label
          >
          <label
            >Price<input
              name="price"
              inputmode="decimal"
              value={formatMoneyInput(service.basePrice, currency)}
              required
              disabled={!canManage}
            /></label
          >
          <label
            >Length (minutes)<input
              name="duration"
              type="number"
              min="1"
              max="1440"
              value={service.baseDurationMinutes}
              required
              disabled={!canManage}
            /></label
          >
          <label
            >Show price as<select
              name="priceDisplayMode"
              value={service.priceDisplayMode}
              disabled={!canManage}
            >
              {#each Object.entries(priceDisplayLabels) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select></label
          >
          <label
            >Show length as<select
              name="durationDisplayMode"
              value={service.durationDisplayMode}
              disabled={!canManage}
            >
              {#each Object.entries(durationDisplayLabels) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select></label
          >
          <label
            >Who can perform it<select
              name="staffEligibilityMode"
              value={service.staffEligibilityMode}
              disabled={!canManage}
            >
              {#each Object.entries(eligibilityModeLabels) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select></label
          >
          <label
            >Setup time before (minutes)<input
              name="bufferBefore"
              type="number"
              min="0"
              max="1440"
              value={service.bufferBeforeMinutes ?? ''}
              placeholder="Salon default"
              disabled={!canManage}
            /></label
          >
          <label
            >Clean-up time after (minutes)<input
              name="bufferAfter"
              type="number"
              min="0"
              max="1440"
              value={service.bufferAfterMinutes ?? ''}
              placeholder="Salon default"
              disabled={!canManage}
            /></label
          >
        </div>
        <label
          >Client description<textarea
            name="description"
            rows="2"
            maxlength="4000"
            disabled={!canManage}>{service.description ?? ''}</textarea
          ></label
        >
        <label
          >Internal notes<textarea
            name="internalDescription"
            rows="2"
            maxlength="4000"
            aria-label="Internal notes"
            disabled={!canManage}>{service.internalDescription ?? ''}</textarea
          ><span class="hint">Only your team sees this.</span></label
        >
        <label class="inline-check"
          ><input
            type="checkbox"
            name="visibleOnline"
            checked={service.visibleOnline}
            disabled={!canManage}
          />
          Show on the public menu</label
        >
        <label class="inline-check"
          ><input
            type="checkbox"
            name="acceptsOnlineBooking"
            checked={service.acceptsOnlineBooking}
            disabled={!canManage}
          /> Clients can book this online</label
        >
        {#if canManage}
          <div class="form-footer">
            <Button type="submit" disabled={busy}>Save service</Button>
            <button
              type="button"
              class="text-button"
              disabled={busy}
              onclick={() =>
                patchService(
                  { active: !service?.active },
                  service?.active
                    ? 'Service deactivated.'
                    : 'Service reactivated.',
                )}>{service.active ? 'Deactivate' : 'Reactivate'}</button
            >
          </div>
          <p class="hint">
            Deactivating hides the service from new bookings but keeps its
            history. Services are never deleted.
          </p>
        {/if}
      </form>
      <h3>Photos</h3>
      <div class="image-placeholder">
        <p class="muted">
          Service photos are not available yet. This is where they will go.
        </p>
      </div>
      <h3>Required skills</h3>
      {#if !skills.length}
        <p class="muted">No skills defined yet.</p>
      {:else}
        <ul class="check-list">
          {#each skills as skill (skill.id)}
            <li>
              <label
                ><input
                  type="checkbox"
                  checked={service.requiredSkillIds.includes(skill.id)}
                  disabled={!canManage || busy}
                  onchange={(e) =>
                    replaceSet(
                      'skills',
                      'skillIds',
                      toggle(
                        service?.requiredSkillIds ?? [],
                        skill.id,
                        e.currentTarget.checked,
                      ),
                      'Required skills updated.',
                    )}
                />
                {skill.name}</label
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if tab === 'locations'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-locations"
      aria-labelledby="tab-locations"
    >
      <h2>Where it is offered</h2>
      <p class="muted">A service does not have to be available everywhere.</p>
      <ul class="check-list">
        {#each locations as location (location.id)}
          <li>
            <label
              ><input
                type="checkbox"
                checked={service.locationIds.includes(location.id)}
                disabled={!canManage || busy}
                onchange={(e) =>
                  replaceSet(
                    'locations',
                    'locationIds',
                    toggle(
                      service?.locationIds ?? [],
                      location.id,
                      e.currentTarget.checked,
                    ),
                    'Locations updated.',
                  )}
              />
              {location.name}</label
            >
          </li>
        {/each}
      </ul>
    </div>
  {:else if tab === 'options'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-options"
      aria-labelledby="tab-options"
    >
      <h2>Options</h2>
      <p class="muted">
        Sizes or tiers such as Short, Long, and XL. Each carries its own full
        price and length, not a difference from the base.
      </p>
      {#if canManage}
        <form onsubmit={addVariant} aria-busy={busy} class="inline-form">
          <label
            >Name<input
              name="name"
              required
              maxlength="160"
              placeholder="XL"
            /></label
          >
          <label
            >Price<input
              name="price"
              inputmode="decimal"
              required
              placeholder="95.00"
            /></label
          >
          <label
            >Minutes<input
              name="duration"
              type="number"
              min="1"
              max="1440"
              required
              value="120"
            /></label
          >
          <Button type="submit" disabled={busy}>Add option</Button>
        </form>
      {/if}
      {#if !service.variants.length}
        <div class="empty-state"><h3>No options yet.</h3></div>
      {:else}
        <ul class="record-list plain">
          {#each service.variants as variant (variant.id)}
            <li class="record">
              <span class="record-main">
                <strong>{variant.name}</strong>
                <span class="muted"
                  >{variant.durationMinutes} min
                  {#if variant.requiredSkillIds.length}· needs
                    {variant.requiredSkillIds
                      .map(
                        (id) =>
                          skills.find((s) => s.id === id)?.name ?? 'a skill',
                      )
                      .join(', ')}{/if}</span
                >
              </span>
              <strong>{formatMoney(variant.price, currency)}</strong>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if tab === 'addons'}
    <div
      class="panel"
      role="tabpanel"
      id="panel-addons"
      aria-labelledby="tab-addons"
    >
      <h2>Add-ons</h2>
      <p class="muted">Extras a client can add to this service.</p>
      {#if !addOns.length}
        <div class="empty-state"><h3>No add-ons defined.</h3></div>
      {:else}
        <ul class="check-list">
          {#each addOns as addOn (addOn.id)}
            <li>
              <label
                ><input
                  type="checkbox"
                  checked={service.addOnIds.includes(addOn.id)}
                  disabled={!canManage || busy}
                  onchange={(e) =>
                    replaceSet(
                      'add-ons',
                      'addOnIds',
                      toggle(
                        service?.addOnIds ?? [],
                        addOn.id,
                        e.currentTarget.checked,
                      ),
                      'Add-ons updated.',
                    )}
                />
                {addOn.name}
                <span class="muted"
                  >{formatMoney(addOn.price, currency)} · {addOn.durationMinutes}
                  min</span
                ></label
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <div
      class="panel"
      role="tabpanel"
      id="panel-staff"
      aria-labelledby="tab-staff"
    >
      <h2>Who can do it</h2>
      <p class="muted">
        Based on required skills, location assignments, and any explicit
        decisions. Prices shown are what each person charges.
      </p>
      {#if !eligibility.length}
        <div class="empty-state"><h3>No team members yet.</h3></div>
      {:else}
        <ul class="record-list plain">
          {#each eligibility as row (row.staffId)}
            <li class="record" class:ineligible={!row.eligible}>
              <span class="record-main">
                <strong>{staffNames.get(row.staffId) ?? 'Unknown'}</strong>
                <span class="muted">
                  {#if row.eligible}
                    {row.durationMinutes} min ({row.totalMinutes} min booked with
                    buffers)
                  {:else}
                    {row.reasons
                      .map((reason) => eligibilityReasons[reason] ?? reason)
                      .join(' · ')}
                  {/if}
                </span>
              </span>
              <span class="record-meta">
                <strong>{formatMoney(row.price, currency)}</strong>
                <span class="status"
                  >{row.eligible ? 'Eligible' : 'Not eligible'}</span
                >
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
{/if}
