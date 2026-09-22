<script lang="ts">
  import { Button, Notice } from '@lacquer/ui';
  import { weekdayNames, formatMinutes, parseMinutes } from '$lib/format';
  import type { ScheduleBlock, Location } from '@lacquer/schemas';
  import type { Weekday } from '@lacquer/types';
  /**
   * Recurring weekly schedule editor.
   *
   * Times are LOCAL wall-clock at the chosen location and are entered with
   * ordinary `<input type="time">` controls — never cron, never a raw
   * timestamp. Everything is reachable by keyboard; nothing depends on drag
   * and drop. A weekday may hold several shifts, which is how a split shift is
   * expressed.
   *
   * The whole week is submitted at once so the API can validate it as a unit.
   */
  type Draft = { start: string; end: string; kind: 'work' | 'break' };
  let {
    blocks,
    locations,
    locationId = $bindable(),
    readonly = false,
    onsave,
  }: {
    blocks: ScheduleBlock[];
    locations: Location[];
    locationId: string;
    readonly?: boolean;
    onsave: (
      locationId: string,
      blocks: {
        kind: 'work' | 'break';
        weekday: number;
        startMinute: number;
        endMinute: number;
      }[],
    ) => Promise<void>;
  } = $props();
  const weekdays = [1, 2, 3, 4, 5, 6, 7] as const;
  let week = $state<Record<number, Draft[]>>(emptyWeek());
  let busy = $state(false);
  let error = $state('');
  let copySource = $state<number>(1);
  let dirty = $state(false);
  let timezone = $derived(
    locations.find((location) => location.id === locationId)?.timezone ?? '',
  );
  function emptyWeek(): Record<number, Draft[]> {
    return Object.fromEntries(weekdays.map((day) => [day, [] as Draft[]]));
  }
  /** Rebuild the editable draft whenever the saved schedule or location changes. */
  /**
   * A stable description of the saved schedule at the chosen location. The
   * parent refetches after every unrelated save and hands back a new array
   * each time; comparing content rather than identity keeps those refreshes
   * from rebuilding — and discarding — a half-typed week.
   */
  let savedSignature = $derived(
    JSON.stringify([
      locationId,
      blocks
        .filter((block) => block.locationId === locationId)
        .map((block) => [
          block.kind,
          block.weekday,
          block.startMinute,
          block.endMinute,
        ])
        .sort(),
    ]),
  );
  let loadedSignature = '';
  $effect(() => {
    // Never clobber unsaved edits: only adopt the server's version when the
    // saved schedule genuinely changed and the manager has nothing pending.
    if (savedSignature === loadedSignature) return;
    if (dirty && loadedSignature !== '') return;
    const next = emptyWeek();
    for (const block of blocks)
      if (block.locationId === locationId)
        next[block.weekday]?.push({
          start: formatMinutes(block.startMinute),
          end: formatMinutes(block.endMinute),
          kind: block.kind,
        });
    for (const day of weekdays)
      next[day]?.sort((a, b) => a.start.localeCompare(b.start));
    week = next;
    loadedSignature = savedSignature;
    dirty = false;
    error = '';
  });
  function addShift(day: number, kind: 'work' | 'break' = 'work') {
    const existing = week[day] ?? [];
    const last = existing.at(-1);
    week[day] = [
      ...existing,
      kind === 'break'
        ? { start: '12:30', end: '13:00', kind }
        : {
            start: last ? last.end : '09:00',
            end: last ? '20:00' : '17:00',
            kind,
          },
    ];
    dirty = true;
  }
  function removeShift(day: number, index: number) {
    week[day] = (week[day] ?? []).filter((_, position) => position !== index);
    dirty = true;
  }
  /** Copy one day's shifts onto every other weekday that currently has none. */
  function copyToEmptyDays(source: number) {
    const template = week[source] ?? [];
    for (const day of weekdays)
      if (day !== source && !(week[day] ?? []).length)
        week[day] = template.map((entry) => ({ ...entry }));
    dirty = true;
  }
  function copyToWeekdays(source: number) {
    const template = week[source] ?? [];
    for (const day of [1, 2, 3, 4, 5] as const)
      if (day !== source) week[day] = template.map((entry) => ({ ...entry }));
    dirty = true;
  }
  function clearDay(day: number) {
    week[day] = [];
    dirty = true;
  }
  /** Client-side check mirroring the server's; the API remains authoritative. */
  function validate(): string {
    for (const day of weekdays) {
      const entries = week[day] ?? [];
      for (const entry of entries) {
        let start: number, end: number;
        try {
          start = parseMinutes(entry.start);
          end = parseMinutes(entry.end);
        } catch {
          return `${weekdayNames[day as Weekday]}: enter a valid time.`;
        }
        if (start >= end)
          return `${weekdayNames[day as Weekday]}: a shift must start before it ends.`;
      }
      for (const kind of ['work', 'break'] as const) {
        const sorted = entries
          .filter((entry) => entry.kind === kind)
          .map((entry) => ({
            start: parseMinutes(entry.start),
            end: parseMinutes(entry.end),
          }))
          .sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i += 1) {
          const previous = sorted[i - 1];
          const current = sorted[i];
          if (previous && current && current.start < previous.end)
            return `${weekdayNames[day as Weekday]}: two ${kind === 'break' ? 'breaks' : 'shifts'} overlap.`;
        }
      }
    }
    return '';
  }
  async function save() {
    const problem = validate();
    error = problem;
    if (problem) return;
    busy = true;
    try {
      await onsave(
        locationId,
        weekdays.flatMap((day) =>
          (week[day] ?? []).map((entry) => ({
            kind: entry.kind,
            weekday: day,
            startMinute: parseMinutes(entry.start),
            endMinute: parseMinutes(entry.end),
          })),
        ),
      );
      dirty = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the schedule.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="schedule-editor">
  <div class="schedule-toolbar">
    <label
      >Location<select bind:value={locationId} disabled={busy}>
        {#each locations as location (location.id)}
          <option value={location.id}>{location.name}</option>
        {/each}
      </select></label
    >
    {#if timezone}
      <p class="hint schedule-timezone">
        Times are local to this location ({timezone}). A 9:00 AM shift stays
        9:00 AM through daylight saving changes.
      </p>
    {/if}
  </div>
  {#if error}<Notice message={error} />{/if}
  {#if !locations.length}
    <div class="empty-state">
      <h3>Assign a location first.</h3>
      <p>A schedule belongs to a location, so pick one on the Locations tab.</p>
    </div>
  {:else}
    <ul class="week">
      {#each weekdays as day (day)}
        <li class="week-day">
          <div class="week-day-header">
            <h3>{weekdayNames[day]}</h3>
            {#if !readonly}
              <div class="week-day-actions">
                <button
                  type="button"
                  class="text-button"
                  onclick={() => addShift(day)}>+ Shift</button
                >
                <button
                  type="button"
                  class="text-button"
                  onclick={() => addShift(day, 'break')}>+ Break</button
                >
                {#if (week[day] ?? []).length}
                  <button
                    type="button"
                    class="text-button"
                    onclick={() => clearDay(day)}>Clear</button
                  >
                {/if}
              </div>
            {/if}
          </div>
          {#if !(week[day] ?? []).length}
            <p class="muted day-off">Off</p>
          {:else}
            <ul class="shifts">
              {#each week[day] ?? [] as entry, index (index)}
                <li class="shift" class:is-break={entry.kind === 'break'}>
                  <span class="shift-kind"
                    >{entry.kind === 'break' ? 'Break' : 'Shift'}</span
                  >
                  <label class="visually-hidden" for="start-{day}-{index}"
                    >{weekdayNames[day]} {entry.kind} start</label
                  >
                  <input
                    id="start-{day}-{index}"
                    type="time"
                    bind:value={entry.start}
                    disabled={readonly || busy}
                    oninput={() => (dirty = true)}
                  />
                  <span aria-hidden="true">–</span>
                  <label class="visually-hidden" for="end-{day}-{index}"
                    >{weekdayNames[day]} {entry.kind} end</label
                  >
                  <input
                    id="end-{day}-{index}"
                    type="time"
                    bind:value={entry.end}
                    disabled={readonly || busy}
                    oninput={() => (dirty = true)}
                  />
                  {#if !readonly}
                    <button
                      type="button"
                      class="text-button remove"
                      onclick={() => removeShift(day, index)}
                      aria-label="Remove the {entry.kind === 'break'
                        ? 'break'
                        : 'shift'} on {weekdayNames[day]} at {entry.start}"
                      >Remove</button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !readonly}
      <div class="schedule-footer">
        <div class="copy-controls">
          <label
            >Copy<select bind:value={copySource}>
              {#each weekdays as day (day)}
                <option value={day}>{weekdayNames[day]}</option>
              {/each}
            </select></label
          >
          <button
            type="button"
            class="text-button"
            onclick={() => copyToWeekdays(copySource)}>to Mon–Fri</button
          >
          <button
            type="button"
            class="text-button"
            onclick={() => copyToEmptyDays(copySource)}>to empty days</button
          >
        </div>
        <Button onclick={save} disabled={busy || !dirty}
          >{busy ? 'Saving…' : dirty ? 'Save schedule' : 'Saved'}</Button
        >
      </div>
    {/if}
  {/if}
</div>
