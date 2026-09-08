<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { z } from 'zod';
  import { Button, Notice } from '@lacquer/ui';
  import {
    userSchema,
    membershipSchema,
    tenantSchema,
    locationSchema,
    okSchema,
    type User,
    type Membership,
    type Location,
  } from '@lacquer/schemas';
  import { api, ApiRequestError } from '$lib/api';
  import LocationForm from '$lib/LocationForm.svelte';
  let user = $state<User | null>(null),
    memberships = $state<Membership[]>([]),
    tenantId = $state(''),
    locations = $state<Location[]>([]);
  let loading = $state(true),
    locationsLoading = $state(false),
    error = $state(''),
    busy = $state(false),
    showTenantForm = $state(false),
    showLocationForm = $state(false),
    name = $state(''),
    slug = $state('');
  let current = $derived(memberships.find((m) => m.tenant.id === tenantId));
  let canManageLocations = $derived(
    current?.permissions.includes('manage_locations') ?? false,
  );
  let loadVersion = 0;
  async function loadLocations() {
    const version = ++loadVersion;
    const selected = tenantId;
    locations = [];
    locationsLoading = true;
    showLocationForm = false;
    error = '';
    try {
      const result = await api(
        `/tenants/${selected}/locations`,
        z.array(locationSchema),
      );
      if (version === loadVersion) locations = result;
    } catch (e) {
      if (version === loadVersion)
        error = e instanceof Error ? e.message : 'Could not load locations.';
    } finally {
      if (version === loadVersion) locationsLoading = false;
    }
  }
  async function loadMemberships(preferred?: string) {
    memberships = await api('/tenants', z.array(membershipSchema));
    tenantId =
      memberships.find((m) => m.tenant.id === preferred)?.tenant.id ??
      memberships[0]?.tenant.id ??
      '';
    if (tenantId) await loadLocations();
  }
  onMount(() => {
    void (async () => {
      try {
        user = await api('/me', userSchema);
        await loadMemberships();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401)
          await goto(resolve('/login'));
        else
          error =
            e instanceof Error ? e.message : 'Could not load your workspace.';
      } finally {
        loading = false;
      }
    })();
  });
  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const tenant = await api('/tenants', tenantSchema, {
        method: 'POST',
        body: { name, slug },
      });
      await loadMemberships(tenant.id);
      showTenantForm = false;
      name = '';
      slug = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create salon.';
    } finally {
      busy = false;
    }
  }
  async function logout() {
    busy = true;
    error = '';
    try {
      await api('/auth/logout', okSchema, { method: 'POST' });
      await goto(resolve('/login'));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign out.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Workspace · Lacquer</title></svelte:head>
{#if loading}<p class="loading" role="status">Opening your workspace…</p>{:else}
  <div class="workspace">
    <aside>
      <p class="eyebrow">Workspace</p>
      <label
        >Active salon<select
          bind:value={tenantId}
          onchange={() => void loadLocations()}
          disabled={!memberships.length}
          >{#each memberships as membership}<option value={membership.tenant.id}
              >{membership.tenant.name}</option
            >{/each}</select
        ></label
      ><button
        class="text-button"
        onclick={() => (showTenantForm = !showTenantForm)}
        >+ Create salon</button
      >
      <div class="aside-user">
        <strong>{user?.name}</strong><span class="muted">{user?.email}</span
        ><button class="text-button" disabled={busy} onclick={logout}
          >Sign out</button
        >
      </div>
    </aside>
    <div class="workspace-content">
      {#if error}<Notice message={error} />{/if}
      {#if showTenantForm || !memberships.length}<section class="panel">
          <p class="eyebrow">Start here</p>
          <h1>Create your salon</h1>
          <p class="muted">
            One workspace for your business, with room for every location.
          </p>
          <form onsubmit={createTenant} aria-busy={busy}>
            <label
              >Salon name<input
                bind:value={name}
                required
                maxlength="160"
              /></label
            ><label
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
            ><Button type="submit" disabled={busy}
              >{busy ? 'Creating…' : 'Create salon'}</Button
            >
          </form>
        </section>{/if}
      {#if current}<div class="page-heading">
          <div>
            <p class="eyebrow">Salon overview</p>
            <h1>{current.tenant.name}</h1>
            <p class="muted">Your locations, together in one place.</p>
          </div>
          <span class="role-badge">{current.role.replace('_', ' ')}</span>
        </div>
        <section aria-labelledby="locations-heading">
          <div class="section-heading">
            <h2 id="locations-heading">
              Locations <span class="count">{locations.length}</span>
            </h2>
            {#if canManageLocations}<Button
                onclick={() => (showLocationForm = !showLocationForm)}
                disabled={locationsLoading}
                >{showLocationForm ? 'Cancel' : '+ Add location'}</Button
              >{/if}
          </div>
          {#if locationsLoading}<p role="status">
              Loading locations…
            </p>{:else if !locations.length}<div class="empty-state">
              <h3>A place to make people feel good.</h3>
              <p>Add your first location to get your salon set up.</p>
            </div>{:else}<div class="location-grid">
              {#each locations as location}<article class="location-card">
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
                </article>{/each}
            </div>{/if}
        </section>
        {#if showLocationForm && canManageLocations}{#key tenantId}<LocationForm
              {tenantId}
              oncreated={loadLocations}
            />{/key}{/if}
      {/if}
    </div>
  </div>
{/if}
