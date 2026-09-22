import { z } from 'zod';
import { membershipSchema, type Membership } from '@lacquer/schemas';
import type { Permission } from '@lacquer/types';
import { api } from './api';
/**
 * The salon the admin screens are currently acting on.
 *
 * Every admin route needs the same three things: which salons the signed-in
 * user belongs to, which one is selected, and what they may do there. Holding
 * that in one shared rune avoids each page refetching memberships and lets the
 * selection survive navigation between Staff, Services, and Settings.
 *
 * The selection is a convenience only. It is echoed into the URL of every
 * request, and the API re-derives permissions from the session on each call —
 * nothing here is trusted for authorization.
 */
const storageKey = 'lacquer.tenant';
class Workspace {
  memberships = $state<Membership[]>([]);
  tenantId = $state('');
  loading = $state(true);
  error = $state('');
  current = $derived(
    this.memberships.find((m) => m.tenant.id === this.tenantId) ?? null,
  );
  /** True when the signed-in user holds this permission in the selected salon. */
  can(permission: Permission): boolean {
    return this.current?.permissions.includes(permission) ?? false;
  }
  select(tenantId: string) {
    this.tenantId = tenantId;
    try {
      localStorage.setItem(storageKey, tenantId);
    } catch {
      // Private browsing or blocked storage: the selection simply does not persist.
    }
  }
  private remembered(): string {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  }
  async load(preferred?: string) {
    this.loading = true;
    this.error = '';
    try {
      this.memberships = await api('/tenants', z.array(membershipSchema));
      const wanted = preferred ?? this.tenantId ?? this.remembered();
      const found =
        this.memberships.find((m) => m.tenant.id === wanted)?.tenant.id ??
        this.memberships[0]?.tenant.id ??
        '';
      if (found) this.select(found);
      else this.tenantId = '';
    } finally {
      this.loading = false;
    }
  }
}
export const workspace = new Workspace();
/** Prefix for every tenant-scoped admin request. */
export const tenantPath = (path: string) =>
  `/tenants/${workspace.tenantId}${path}`;
