import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/build/**',
      '**/migrations/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    // `.svelte.ts` modules carry runes and need the Svelte parser too.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'svelte/require-each-key': 'off',
    },
  },
);
