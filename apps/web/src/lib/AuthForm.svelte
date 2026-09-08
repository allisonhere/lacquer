<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { Button, Notice } from '@lacquer/ui';
  import { userSchema } from '@lacquer/schemas';
  import { api } from './api';
  let { register = false }: { register?: boolean } = $props();
  let name = $state(''),
    email = $state(''),
    password = $state(''),
    busy = $state(false),
    error = $state('');
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await api(register ? '/auth/register' : '/auth/login', userSchema, {
        method: 'POST',
        body: register ? { name, email, password } : { email, password },
      });
      await goto(resolve('/app'));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unable to sign in.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="auth-card">
  <p class="eyebrow">Welcome to Lacquer</p>
  <h1>{register ? 'Make yourself at home.' : 'Good to see you.'}</h1>
  <p class="muted">
    {register
      ? 'Start with an account. Add your salon next.'
      : 'Sign in to your salon workspace.'}
  </p>
  {#if error}<Notice message={error} />{/if}
  <form onsubmit={submit} aria-busy={busy}>
    {#if register}<label
        >Your name<input
          name="name"
          autocomplete="name"
          bind:value={name}
          required
          maxlength="120"
        /></label
      >{/if}
    <label
      >Email<input
        name="email"
        type="email"
        autocomplete="email"
        bind:value={email}
        required
        maxlength="254"
      /></label
    >
    <label
      >Password<input
        name="password"
        type="password"
        autocomplete={register ? 'new-password' : 'current-password'}
        bind:value={password}
        required
        minlength={register ? 12 : 1}
        maxlength="128"
      /></label
    >
    {#if register}<p class="hint">Use at least 12 characters.</p>{/if}
    <Button type="submit" disabled={busy}
      >{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button
    >
  </form>
  <p class="form-footer">
    {register ? 'Already have an account?' : 'New to Lacquer?'}
    <a href={resolve(register ? '/login' : '/register')}
      >{register ? 'Sign in' : 'Create an account'}</a
    >
  </p>
</section>
