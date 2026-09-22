<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Notice } from '@lacquer/ui';
  import { userSchema, okSchema, type User } from '@lacquer/schemas';
  import { api, ApiRequestError } from '$lib/api';
  import { workspace } from '$lib/workspace.svelte';
  let { children } = $props();
  let user = $state<User | null>(null);
  let busy = $state(false);
  /**
   * Admin sections. The server re-checks permissions on every request; this
   * navigation is only a convenience for finding the right screen.
   */
  const sections = [
    { href: '/app', label: 'Overview', exact: true },
    { href: '/app/staff', label: 'Staff', exact: false },
    { href: '/app/services', label: 'Services', exact: false },
    { href: '/app/scheduling', label: 'Scheduling', exact: false },
    // `as const` keeps each href a literal so `resolve()` can typecheck it
    // against SvelteKit's generated route table.
  ] as const;
  function isCurrent(href: string, exact: boolean, pathname: string) {
    return exact ? pathname === href : pathname.startsWith(href);
  }
  onMount(() => {
    void (async () => {
      try {
        user = await api('/me', userSchema);
        await workspace.load();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401)
          await goto(resolve('/login'));
        else
          workspace.error =
            e instanceof Error ? e.message : 'Could not load your workspace.';
      }
    })();
  });
  async function switchTenant(event: Event) {
    workspace.select((event.currentTarget as HTMLSelectElement).value);
    // Leaving a detail screen: its record belongs to the salon we just left.
    const section = /^\/app\/(staff|services)\//.exec(page.url.pathname);
    if (section)
      await goto(
        section[1] === 'staff'
          ? resolve('/app/staff')
          : resolve('/app/services'),
      );
  }
  async function logout() {
    busy = true;
    try {
      await api('/auth/logout', okSchema, { method: 'POST' });
      await goto(resolve('/login'));
    } catch (e) {
      workspace.error = e instanceof Error ? e.message : 'Could not sign out.';
    } finally {
      busy = false;
    }
  }
</script>

{#if workspace.loading}
  <p class="loading" role="status">Opening your workspace…</p>
{:else}
  <div class="admin">
    <aside class="admin-nav">
      <label class="tenant-picker">
        Active salon
        <select
          value={workspace.tenantId}
          onchange={switchTenant}
          disabled={!workspace.memberships.length}
        >
          {#each workspace.memberships as membership (membership.tenant.id)}
            <option value={membership.tenant.id}
              >{membership.tenant.name}</option
            >
          {/each}
        </select>
      </label>
      <nav aria-label="Salon administration">
        <ul>
          {#each sections as section (section.href)}
            <li>
              <a
                href={resolve(section.href)}
                aria-current={isCurrent(
                  section.href,
                  section.exact,
                  page.url.pathname,
                )
                  ? 'page'
                  : undefined}>{section.label}</a
              >
            </li>
          {/each}
        </ul>
      </nav>
      <div class="aside-user">
        <strong>{user?.name}</strong>
        <span class="muted">{user?.email}</span>
        {#if workspace.current}
          <span class="role-badge"
            >{workspace.current.role.replace('_', ' ')}</span
          >
        {/if}
        <button class="text-button" disabled={busy} onclick={logout}
          >Sign out</button
        >
      </div>
    </aside>
    <div class="admin-content">
      {#if workspace.error}<Notice message={workspace.error} />{/if}
      {@render children()}
    </div>
  </div>
{/if}
