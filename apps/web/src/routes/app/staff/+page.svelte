<script lang="ts">
  import { z } from 'zod';
  import { Button, Notice } from '@lacquer/ui';
  import {
    staffListItemSchema,
    staffSchema,
    locationSchema,
    type StaffListItem,
    type Location,
  } from '@lacquer/schemas';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  let staff = $state<StaffListItem[]>([]);
  let locations = $state<Location[]>([]);
  let loading = $state(false);
  let error = $state('');
  let showForm = $state(false);
  let busy = $state(false);
  let displayName = $state('');
  let email = $state('');
  let phone = $state('');
  let showInactive = $state(false);
  let canManage = $derived(workspace.can('manage_staff'));
  let visible = $derived(
    showInactive ? staff : staff.filter((member) => member.active),
  );
  let locationNames = $derived(
    new Map(locations.map((location) => [location.id, location.name])),
  );
  let version = 0;
  async function load() {
    if (!workspace.tenantId) return;
    const current = ++version;
    loading = true;
    error = '';
    try {
      const [people, places] = await Promise.all([
        api(tenantPath('/staff'), z.array(staffListItemSchema)),
        api(tenantPath('/locations'), z.array(locationSchema)),
      ]);
      if (current === version) {
        staff = people;
        locations = places;
      }
    } catch (e) {
      if (current === version)
        error = e instanceof Error ? e.message : 'Could not load the team.';
    } finally {
      if (current === version) loading = false;
    }
  }
  $effect(() => {
    void workspace.tenantId;
    void load();
  });
  async function create(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await api(tenantPath('/staff'), staffSchema, {
        method: 'POST',
        body: {
          displayName,
          email: email || null,
          phone: phone || null,
        },
      });
      displayName = '';
      email = '';
      phone = '';
      showForm = false;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not add the team member.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Staff · Lacquer</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">Your team</p>
    <h1>Staff</h1>
    <p class="muted">
      Add someone before they accept an invitation, then build their schedule.
    </p>
  </div>
  {#if canManage}
    <Button onclick={() => (showForm = !showForm)}
      >{showForm ? 'Cancel' : '+ Add team member'}</Button
    >
  {/if}
</div>
{#if error}<Notice message={error} />{/if}
{#if showForm && canManage}
  <section class="panel">
    <h2>Add a team member</h2>
    <p class="muted">
      Only a name is required. You can link their account and fill in the rest
      later.
    </p>
    <form onsubmit={create} aria-busy={busy}>
      <div class="form-grid">
        <label
          >Display name<input
            bind:value={displayName}
            required
            maxlength="160"
            autocomplete="name"
          /></label
        >
        <label
          >Email<input
            bind:value={email}
            type="email"
            maxlength="254"
            autocomplete="email"
          /></label
        >
        <label
          >Phone<input
            bind:value={phone}
            type="tel"
            maxlength="40"
            autocomplete="tel"
          /></label
        >
      </div>
      <Button type="submit" disabled={busy}
        >{busy ? 'Adding…' : 'Add team member'}</Button
      >
    </form>
  </section>
{/if}
<section aria-labelledby="staff-heading">
  <div class="section-heading">
    <h2 id="staff-heading">
      Team <span class="count">{visible.length}</span>
    </h2>
    <label class="inline-check"
      ><input type="checkbox" bind:checked={showInactive} /> Show inactive</label
    >
  </div>
  {#if loading}
    <p role="status">Loading the team…</p>
  {:else if !visible.length}
    <div class="empty-state">
      <h3>No one here yet.</h3>
      <p>Add your first team member to start building schedules.</p>
    </div>
  {:else}
    <ul class="record-list">
      {#each visible as member (member.id)}
        <li>
          <a
            class="record"
            href={resolve('/app/staff/[staffId]', { staffId: member.id })}
          >
            <span class="record-main">
              <strong>{member.displayName}</strong>
              <span class="muted"
                >{member.locationIds.length
                  ? member.locationIds
                      .map((id) => locationNames.get(id) ?? 'Unknown')
                      .join(', ')
                  : 'No locations assigned'}</span
              >
            </span>
            <span class="record-meta">
              {#if !member.active}<span class="status">Inactive</span>{/if}
              {#if !member.acceptsOnlineBookings}<span class="status"
                  >Offline only</span
                >{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
