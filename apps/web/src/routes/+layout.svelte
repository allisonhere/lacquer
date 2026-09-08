<script lang="ts">
  import { resolve } from '$app/paths';
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head
  ><title>Lacquer · Salon workspace</title><meta
    name="description"
    content="Your salon, thoughtfully organized. Lacquer open-source salon management."
  /></svelte:head
>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <a class="wordmark" href={resolve('/')}>lacquer<span>.</span></a><span
    class="edition">Your salon workspace</span
  >
</header>
<main id="main">{@render children()}</main>
<footer>
  Lacquer · Open-source salon software <span>Foundation preview</span>
</footer>
