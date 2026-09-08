<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<p role="alert">{message}</p>

<style>
  p {
    padding: 0.85rem 1rem;
    background: #fff0ef;
    border: 1px solid #d8b5b2;
    border-radius: 0.6rem;
    color: #832d2d;
  }
</style>
