import config from '@capella/eslint-config/node';

export default [
  ...config,
  { ignores: ['vitest.config.ts'] },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];
