<script lang="ts">
  import { Button, Notice } from '@lacquer/ui';
  import { locationSchema } from '@lacquer/schemas';
  import { api } from './api';
  let {
    tenantId,
    oncreated,
  }: { tenantId: string; oncreated: () => Promise<void> } = $props();
  let name = $state(''),
    slug = $state(''),
    timezone = $state('America/Chicago'),
    addressLine1 = $state(''),
    city = $state(''),
    region = $state(''),
    postalCode = $state(''),
    country = $state('US'),
    phone = $state(''),
    busy = $state(false),
    error = $state('');
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await api(`/tenants/${tenantId}/locations`, locationSchema, {
        method: 'POST',
        body: {
          name,
          slug,
          timezone,
          addressLine1: addressLine1 || null,
          city: city || null,
          region: region || null,
          postalCode: postalCode || null,
          country: country || null,
          phone: phone || null,
        },
      });
      await oncreated();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create location.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="panel">
  <h2>Add a location</h2>
  <p class="muted">Each location has its own timezone.</p>
  {#if error}<Notice message={error} />{/if}
  <form onsubmit={submit} aria-busy={busy}>
    <div class="form-grid">
      <label
        >Location name<input
          bind:value={name}
          required
          maxlength="160"
          autocomplete="organization"
        /></label
      >
      <label
        >Location slug<input
          aria-label="Location slug"
          aria-describedby="location-slug-hint"
          bind:value={slug}
          required
          minlength="2"
          maxlength="80"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="downtown"
        /><span class="hint" id="location-slug-hint"
          >Lowercase letters, numbers, and hyphens.</span
        ></label
      >
      <label
        >Timezone<input
          aria-label="Timezone"
          aria-describedby="location-timezone-hint"
          bind:value={timezone}
          required
          placeholder="America/Chicago"
        /><span class="hint" id="location-timezone-hint"
          >IANA timezone, such as America/New_York.</span
        ></label
      >
      <label
        >Phone<input
          bind:value={phone}
          type="tel"
          autocomplete="tel"
          maxlength="40"
        /></label
      >
      <label
        >Street address<input
          bind:value={addressLine1}
          autocomplete="address-line1"
          maxlength="200"
        /></label
      >
      <label
        >City<input
          bind:value={city}
          autocomplete="address-level2"
          maxlength="100"
        /></label
      >
      <label
        >State / region<input
          bind:value={region}
          autocomplete="address-level1"
          maxlength="100"
        /></label
      >
      <label
        >Postal code<input
          bind:value={postalCode}
          autocomplete="postal-code"
          maxlength="24"
        /></label
      >
      <label
        >Country code<input
          aria-label="Country code"
          aria-describedby="location-country-hint"
          bind:value={country}
          maxlength="2"
          pattern="[A-Z][A-Z]"
          autocomplete="country"
        /><span class="hint" id="location-country-hint"
          >Two uppercase letters, such as US.</span
        ></label
      >
    </div>
    <Button type="submit" disabled={busy}
      >{busy ? 'Creating…' : 'Create location'}</Button
    >
  </form>
</section>
