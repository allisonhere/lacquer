<script lang="ts">
  import { z } from 'zod';
  import { resolve } from '$app/paths';
  import { Button, Notice } from '@lacquer/ui';
  import {
    tenantSchema,
    locationSchema,
    type Location,
  } from '@lacquer/schemas';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  import LocationForm from '$lib/LocationForm.svelte';
  let locations = $state<Location[]>([]);
  let loading = $state(false);
  let error = $state('');
  let showTenantForm = $state(false);
  let showLocationForm = $state(false);
  let busy = $state(false);
  let name = $state('');
  let slug = $state('');
  let canManageLocations = $derived(workspace.can('manage_locations'));
  let loadVersion = 0;
  async function loadLocations() {
    if (!workspace.tenantId) return;
    const version = ++loadVersion;
    locations = [];
    loading = true;
    showLocationForm = false;
    error = '';
    try {
      const result = await api(
        tenantPath('/locations'),
        z.array(locationSchema),
      );
      if (version === loadVersion) locations = result;
    } catch (e) {
      if (version === loadVersion)
        error = e instanceof Error ? e.message : 'Could not load locations.';
    } finally {
      if (version === loadVersion) loading = false;
    }
  }
  // Reload whenever the active salon changes.
  $effect(() => {
    void workspace.tenantId;
    void loadLocations();
  });
  async function togglePublicBooking() {
    if (!workspace.current) return;
    busy = true;
    error = '';
    try {
      await api(tenantPath(''), tenantSchema, {
        method: 'PATCH',
        body: {
          publicBookingEnabled: !workspace.current.tenant.publicBookingEnabled,
        },
      });
      await workspace.load(workspace.tenantId);
    } catch (e) {
      error =
        e instanceof Error ? e.message : 'Could not update online booking.';
    } finally {
      busy = false;
    }
  }
  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const tenant = await api('/tenants', tenantSchema, {
        method: 'POST',
        body: { name, slug },
      });
      await workspace.load(tenant.id);
      showTenantForm = false;
      name = '';
      slug = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create salon.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Overview · Lacquer</title></svelte:head>
{#if error}<Notice message={error} />{/if}
{#if showTenantForm || !workspace.memberships.length}
  <section class="panel">
    <p class="eyebrow">Start here</p>
    <h1>Create your salon</h1>
    <p class="muted">
      One workspace for your business, with room for every location.
    </p>
    <form onsubmit={createTenant} aria-busy={busy}>
      <label
        >Salon name<input bind:value={name} required maxlength="160" /></label
      >
      <label
        >Salon slug<input
          aria-label="Salon slug"
          aria-describedby="salon-slug-hint"
          bind:value={slug}
          required
          minlength="2"
          maxlength="80"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="your-salon"
        /><span class="hint" id="salon-slug-hint"
          >Lowercase letters, numbers, and hyphens.</span
        ></label
      >
      <Button type="submit" disabled={busy}
        >{busy ? 'Creating…' : 'Create salon'}</Button
      >
    </form>
  </section>
{/if}
{#if workspace.current}
  <div class="page-heading">
    <div>
      <p class="eyebrow">Salon overview</p>
      <h1>{workspace.current.tenant.name}</h1>
      <p class="muted">Your locations, together in one place.</p>
    </div>
    <button
      class="text-button"
      onclick={() => (showTenantForm = !showTenantForm)}>+ Create salon</button
    >
  </div>
  {#if workspace.can('manage_business')}
    <section class="panel" aria-labelledby="public-booking-heading">
      <h2 id="public-booking-heading">Customer booking</h2>
      <p>
        Let customers book without an account using your salon’s public page.
      </p>
      <Button disabled={busy} onclick={togglePublicBooking}
        >{workspace.current.tenant.publicBookingEnabled
          ? 'Disable online booking'
          : 'Enable online booking'}</Button
      >
      {#if workspace.current.tenant.publicBookingEnabled}<p>
          <a
            href={resolve('/book/[tenantSlug]', {
              tenantSlug: workspace.current.tenant.slug,
            })}>Open customer booking page</a
          >
        </p>{/if}
    </section>
  {/if}
  <section aria-labelledby="locations-heading">
    <div class="section-heading">
      <h2 id="locations-heading">
        Locations <span class="count">{locations.length}</span>
      </h2>
      {#if canManageLocations}
        <Button
          onclick={() => (showLocationForm = !showLocationForm)}
          disabled={loading}
          >{showLocationForm ? 'Cancel' : '+ Add location'}</Button
        >
      {/if}
    </div>
    {#if loading}
      <p role="status">Loading locations…</p>
    {:else if !locations.length}
      <div class="empty-state">
        <h3>A place to make people feel good.</h3>
        <p>Add your first location to get your salon set up.</p>
      </div>
    {:else}
      <div class="location-grid">
        {#each locations as location (location.id)}
          <article class="location-card">
            <div class="section-heading">
              <h3>{location.name}</h3>
              <span class="status"
                >{location.active ? 'Active' : 'Inactive'}</span
              >
            </div>
            <p class="muted">
              {[location.addressLine1, location.city, location.region]
                .filter(Boolean)
                .join(', ') || 'No address added'}
            </p>
            <p class="timezone">{location.timezone}</p>
            {#if location.phone}<p>{location.phone}</p>{/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
  {#if showLocationForm && canManageLocations}
    {#key workspace.tenantId}
      <LocationForm tenantId={workspace.tenantId} oncreated={loadLocations} />
    {/key}
  {/if}
{/if}
