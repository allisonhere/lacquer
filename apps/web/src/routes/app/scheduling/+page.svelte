<script lang="ts">
  import { Button, Notice } from '@lacquer/ui';
  import {
    schedulingSettingsSchema,
    type SchedulingSettings,
  } from '@lacquer/schemas';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  import {
    formatDuration,
    noticeOptions,
    horizonOptions,
    doubleBookingLabels,
  } from '$lib/format';
  /**
   * Salon-wide scheduling defaults. Human units in the controls, normalized
   * minutes and days on the wire.
   */
  let settings = $state<SchedulingSettings | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let canManage = $derived(workspace.can('manage_settings'));
  async function load() {
    if (!workspace.tenantId) return;
    loading = true;
    error = '';
    try {
      settings = await api(
        tenantPath('/scheduling-settings'),
        schedulingSettingsSchema,
      );
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load settings.';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void workspace.tenantId;
    void load();
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    busy = true;
    error = '';
    notice = '';
    try {
      settings = await api(
        tenantPath('/scheduling-settings'),
        schedulingSettingsSchema,
        {
          method: 'PATCH',
          body: {
            defaultBufferBeforeMinutes: Number(data.get('bufferBefore')),
            defaultBufferAfterMinutes: Number(data.get('bufferAfter')),
            minimumBookingNoticeMinutes: Number(data.get('notice')),
            maximumBookingHorizonDays: Number(data.get('horizon')),
            doubleBookingMode: String(data.get('doubleBooking')),
            autoBreakEnabled: data.get('autoBreak') === 'on',
            autoBreakThresholdMinutes: Number(data.get('breakThreshold')),
            autoBreakDurationMinutes: Number(data.get('breakDuration')),
          },
        },
      );
      notice = 'Scheduling settings saved.';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save settings.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Scheduling · Lacquer</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">Salon settings</p>
    <h1>Scheduling</h1>
    <p class="muted">
      Defaults for the whole salon. Individual team members and services can
      override most of these.
    </p>
  </div>
</div>
{#if error}<Notice message={error} />{/if}
{#if notice}<p class="success" role="status">{notice}</p>{/if}
{#if loading}
  <p role="status">Loading settings…</p>
{:else if settings}
  <form class="panel" onsubmit={save} aria-busy={busy}>
    <h2>Appointment timing</h2>
    <div class="form-grid">
      <label
        >Setup time before each appointment<input
          name="bufferBefore"
          type="number"
          min="0"
          max="1440"
          value={settings.defaultBufferBeforeMinutes}
          disabled={!canManage}
          aria-label="Setup time before each appointment"
          aria-describedby="buffer-before-hint"
        /><span class="hint" id="buffer-before-hint"
          >Minutes. Currently {formatDuration(
            settings.defaultBufferBeforeMinutes,
          )}.</span
        ></label
      >
      <label
        >Clean-up time after each appointment<input
          name="bufferAfter"
          type="number"
          min="0"
          max="1440"
          value={settings.defaultBufferAfterMinutes}
          disabled={!canManage}
          aria-label="Clean-up time after each appointment"
          aria-describedby="buffer-after-hint"
        /><span class="hint" id="buffer-after-hint"
          >Minutes. Currently {formatDuration(
            settings.defaultBufferAfterMinutes,
          )}.</span
        ></label
      >
      <label
        >How far ahead clients must book<select
          name="notice"
          value={String(settings.minimumBookingNoticeMinutes)}
          disabled={!canManage}
        >
          {#each noticeOptions as option (option.minutes)}
            <option value={String(option.minutes)}>{option.label}</option>
          {/each}
        </select></label
      >
      <label
        >How far ahead clients can book<select
          name="horizon"
          value={String(settings.maximumBookingHorizonDays)}
          disabled={!canManage}
        >
          {#each horizonOptions as option (option.days)}
            <option value={String(option.days)}>{option.label}</option>
          {/each}
        </select></label
      >
    </div>
    <h2>Double booking</h2>
    <label
      >Overlapping appointments<select
        name="doubleBooking"
        aria-label="Overlapping appointments"
        value={settings.doubleBookingMode}
        disabled={!canManage}
      >
        {#each Object.entries(doubleBookingLabels) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select><span class="hint"
        >Overlapping during processing time uses each service's hands-on and
        waiting split.</span
      ></label
    >
    <h2>Automatic breaks</h2>
    <label class="inline-check"
      ><input
        type="checkbox"
        name="autoBreak"
        checked={settings.autoBreakEnabled}
        disabled={!canManage}
      /> Add a break after a long stretch of appointments</label
    >
    <div class="form-grid">
      <label
        >After this much booked time<input
          name="breakThreshold"
          type="number"
          min="1"
          max="1440"
          value={settings.autoBreakThresholdMinutes}
          disabled={!canManage}
          aria-label="After this much booked time"
          aria-describedby="threshold-hint"
        /><span class="hint" id="threshold-hint"
          >Minutes. Currently {formatDuration(
            settings.autoBreakThresholdMinutes,
          )}.</span
        ></label
      >
      <label
        >Break length<input
          name="breakDuration"
          type="number"
          min="1"
          max="1440"
          value={settings.autoBreakDurationMinutes}
          disabled={!canManage}
          aria-label="Break length"
          aria-describedby="duration-hint"
        /><span class="hint" id="duration-hint"
          >Minutes. Currently {formatDuration(
            settings.autoBreakDurationMinutes,
          )}.</span
        ></label
      >
    </div>
    {#if canManage}
      <Button type="submit" disabled={busy}
        >{busy ? 'Saving…' : 'Save settings'}</Button
      >
    {:else}
      <p class="hint">You do not have permission to change these settings.</p>
    {/if}
  </form>
{/if}
