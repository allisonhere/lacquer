<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<section class="welcome">
  <p class="eyebrow">A little more room to grow</p>
  <h1>Your business.<br />Beautifully organized.</h1>
  <p class="lede">
    A simple home for your salon and its locations. Built to grow with you.
  </p>
  <div class="actions">
    <a class="primary-link" href={resolve('/register')}>Create your account</a
    ><a href={resolve('/login')}>Sign in →</a>
  </div>
  <div class="preview-note">Milestone 1 · Business and location setup</div>
</section>
