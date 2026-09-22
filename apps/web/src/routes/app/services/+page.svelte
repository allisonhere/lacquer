<script lang="ts">
  import { z } from 'zod';
  import { Button, Notice } from '@lacquer/ui';
  import {
    categorySchema,
    serviceListItemSchema,
    serviceSchema,
    skillSchema,
    addOnSchema,
    type Category,
    type ServiceListItem,
    type Skill,
    type AddOn,
  } from '@lacquer/schemas';
  import { resolve } from '$app/paths';
  import { api } from '$lib/api';
  import { workspace, tenantPath } from '$lib/workspace.svelte';
  import { formatMoney, parseMoney, MoneyParseError } from '$lib/format';
  /** Catalog home: categories with ordering, services, add-ons, and skills. */
  const tabs = [
    { id: 'services', label: 'Services' },
    { id: 'categories', label: 'Categories' },
    { id: 'addons', label: 'Add-ons' },
    { id: 'skills', label: 'Skills' },
  ] as const;
  let tab = $state<(typeof tabs)[number]['id']>('services');
  let categories = $state<Category[]>([]);
  let services = $state<ServiceListItem[]>([]);
  let skills = $state<Skill[]>([]);
  let addOns = $state<AddOn[]>([]);
  let loading = $state(true);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let currency = $state('USD');
  let canManage = $derived(workspace.can('manage_services'));
  async function load() {
    if (!workspace.tenantId) return;
    loading = true;
    error = '';
    try {
      const [cats, svcs, sk, ad] = await Promise.all([
        api(tenantPath('/categories'), z.array(categorySchema)),
        api(tenantPath('/services'), z.array(serviceListItemSchema)),
        api(tenantPath('/skills'), z.array(skillSchema)),
        api(tenantPath('/add-ons'), z.array(addOnSchema)),
      ]);
      categories = cats;
      services = svcs;
      skills = sk;
      addOns = ad;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load the catalog.';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void workspace.tenantId;
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
  function slugify(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }
  function createCategory(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get('name'));
    return act(
      () =>
        api(tenantPath('/categories'), categorySchema, {
          method: 'POST',
          body: {
            name,
            slug: slugify(name),
            sortOrder: categories.length,
          },
        }),
      'Category added.',
    ).then(() => form.reset());
  }
  /** Move a category up or down and persist the whole order in one request. */
  function move(index: number, delta: number) {
    const next = [...categories];
    const target = index + delta;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    return act(
      () =>
        api(tenantPath('/categories/order'), z.array(categorySchema), {
          method: 'PUT',
          body: {
            order: next.map((category, position) => ({
              id: category.id,
              sortOrder: position,
            })),
          },
        }),
      'Order saved.',
    );
  }
  function createService(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    let basePrice: number;
    try {
      basePrice = parseMoney(String(data.get('price') ?? ''), currency);
    } catch (e) {
      error = e instanceof MoneyParseError ? e.message : 'Invalid price.';
      return;
    }
    return act(
      () =>
        api(tenantPath('/services'), serviceSchema, {
          method: 'POST',
          body: {
            name: String(data.get('name')),
            categoryId: String(data.get('categoryId') || '') || null,
            basePrice,
            baseDurationMinutes: Number(data.get('duration')),
            sortOrder: services.length,
          },
        }),
      'Service added.',
    ).then(() => form.reset());
  }
  function createSimple(
    event: SubmitEvent,
    path: string,
    schema: typeof skillSchema | typeof addOnSchema,
    build: (data: FormData) => Record<string, unknown> | null,
    success: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = build(new FormData(form));
    if (!body) return;
    return act(
      () => api(tenantPath(path), schema, { method: 'POST', body }),
      success,
    ).then(() => form.reset());
  }
</script>

<svelte:head><title>Services · Lacquer</title></svelte:head>
<div class="page-heading">
  <div>
    <p class="eyebrow">Your menu</p>
    <h1>Services</h1>
    <p class="muted">What you offer, what it costs, and who can do it.</p>
  </div>
</div>
{#if error}<Notice message={error} />{/if}
{#if notice}<p class="success" role="status">{notice}</p>{/if}
<div class="tabs" role="tablist" aria-label="Catalog sections">
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
{#if loading}
  <p role="status">Loading the catalog…</p>
{:else if tab === 'services'}
  <div role="tabpanel" id="panel-services" aria-labelledby="tab-services">
    {#if canManage}
      <div class="panel">
        <h2>Add a service</h2>
        <form onsubmit={createService} aria-busy={busy}>
          <div class="form-grid">
            <label>Name<input name="name" required maxlength="160" /></label>
            <label
              >Category<select name="categoryId">
                <option value="">Uncategorised</option>
                {#each categories as category (category.id)}
                  <option value={category.id}>{category.name}</option>
                {/each}
              </select></label
            >
            <label
              >Price<input
                name="price"
                inputmode="decimal"
                required
                placeholder="75.00"
                aria-label="Price"
                aria-describedby="price-hint"
              /><span class="hint" id="price-hint">In {currency}.</span></label
            >
            <label
              >Length (minutes)<input
                name="duration"
                type="number"
                min="1"
                max="1440"
                required
                value="60"
              /></label
            >
          </div>
          <Button type="submit" disabled={busy}>Add service</Button>
        </form>
      </div>
    {/if}
    {#if !services.length}
      <div class="empty-state">
        <h3>Your menu is empty.</h3>
        <p>Add your first service to get started.</p>
      </div>
    {:else}
      <ul class="record-list">
        {#each services as service (service.id)}
          <li>
            <a
              class="record"
              href={resolve('/app/services/[serviceId]', {
                serviceId: service.id,
              })}
            >
              <span class="record-main">
                <strong>{service.name}</strong>
                <span class="muted"
                  >{service.categoryName ?? 'Uncategorised'} ·
                  {service.baseDurationMinutes} min
                  {#if service.variantCount}· {service.variantCount} options{/if}</span
                >
              </span>
              <span class="record-meta">
                <strong>{formatMoney(service.basePrice, currency)}</strong>
                {#if !service.active}<span class="status">Inactive</span>{/if}
                {#if !service.visibleOnline}<span class="status">Hidden</span
                  >{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else if tab === 'categories'}
  <div
    class="panel"
    role="tabpanel"
    id="panel-categories"
    aria-labelledby="tab-categories"
  >
    <h2>Categories</h2>
    <p class="muted">Clients see your menu in this order.</p>
    {#if canManage}
      <form onsubmit={createCategory} aria-busy={busy} class="inline-form">
        <label>New category<input name="name" required maxlength="160" /></label
        >
        <Button type="submit" disabled={busy}>Add</Button>
      </form>
    {/if}
    {#if !categories.length}
      <div class="empty-state"><h3>No categories yet.</h3></div>
    {:else}
      <ol class="record-list plain">
        {#each categories as category, index (category.id)}
          <li class="record">
            <span class="record-main">
              <strong>{category.name}</strong>
              <span class="muted"
                >{services.filter((s) => s.categoryId === category.id).length} services</span
              >
            </span>
            {#if canManage}
              <span class="record-meta">
                <button
                  type="button"
                  class="text-button"
                  disabled={busy || index === 0}
                  aria-label="Move {category.name} up"
                  onclick={() => move(index, -1)}>↑</button
                >
                <button
                  type="button"
                  class="text-button"
                  disabled={busy || index === categories.length - 1}
                  aria-label="Move {category.name} down"
                  onclick={() => move(index, 1)}>↓</button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ol>
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
    <p class="muted">Extras a client can add to a service.</p>
    {#if canManage}
      <form
        onsubmit={(e) =>
          createSimple(
            e,
            '/add-ons',
            addOnSchema,
            (data) => {
              try {
                return {
                  name: String(data.get('name')),
                  price: parseMoney(String(data.get('price') ?? ''), currency),
                  durationMinutes: Number(data.get('duration')),
                };
              } catch (err) {
                error =
                  err instanceof MoneyParseError
                    ? err.message
                    : 'Invalid price.';
                return null;
              }
            },
            'Add-on created.',
          )}
        aria-busy={busy}
      >
        <div class="form-grid">
          <label>Name<input name="name" required maxlength="160" /></label>
          <label
            >Price<input
              name="price"
              inputmode="decimal"
              required
              placeholder="15.00"
            /></label
          >
          <label
            >Extra minutes<input
              name="duration"
              type="number"
              min="0"
              max="1440"
              required
              value="15"
            /></label
          >
        </div>
        <Button type="submit" disabled={busy}>Add add-on</Button>
      </form>
    {/if}
    {#if !addOns.length}
      <div class="empty-state"><h3>No add-ons yet.</h3></div>
    {:else}
      <ul class="record-list plain">
        {#each addOns as addOn (addOn.id)}
          <li class="record">
            <span class="record-main">
              <strong>{addOn.name}</strong>
              <span class="muted"
                >{addOn.durationMinutes} min
                {#if addOn.globallyAvailable}· available on every service{/if}</span
              >
            </span>
            <strong>{formatMoney(addOn.price, currency)}</strong>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <div
    class="panel"
    role="tabpanel"
    id="panel-skills"
    aria-labelledby="tab-skills"
  >
    <h2>Skills and certifications</h2>
    <p class="muted">
      Require a skill on a service and only qualified team members will be
      offered for it.
    </p>
    {#if canManage}
      <form
        onsubmit={(e) =>
          createSimple(
            e,
            '/skills',
            skillSchema,
            (data) => ({
              name: String(data.get('name')),
              description: String(data.get('description') || '') || null,
            }),
            'Skill created.',
          )}
        aria-busy={busy}
        class="inline-form"
      >
        <label>Name<input name="name" required maxlength="160" /></label>
        <label>Description<input name="description" maxlength="2000" /></label>
        <Button type="submit" disabled={busy}>Add</Button>
      </form>
    {/if}
    {#if !skills.length}
      <div class="empty-state"><h3>No skills yet.</h3></div>
    {:else}
      <ul class="record-list plain">
        {#each skills as skill (skill.id)}
          <li class="record">
            <span class="record-main">
              <strong>{skill.name}</strong>
              {#if skill.description}<span class="muted"
                  >{skill.description}</span
                >{/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
