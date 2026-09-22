<script lang="ts">
  import { page } from '$app/state';
  import BookingFlow from '$lib/BookingFlow.svelte';
</script>

{#key page.params.tenantSlug}<BookingFlow
    slug={page.params.tenantSlug!}
  />{/key}
