<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  let { children, ...props }: HTMLButtonAttributes & { children?: Snippet } =
    $props();
</script>

<button {...props}>{@render children?.()}</button>

<style>
  button {
    font: inherit;
    font-weight: 600;
    background: var(--accent, #563546);
    color: white;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    padding: 0.7rem 1rem;
    cursor: pointer;
    min-height: 44px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  button:focus-visible {
    outline: 3px solid #ba849e;
    outline-offset: 3px;
  }
  button:hover:not(:disabled) {
    filter: brightness(1.15);
  }
</style>
