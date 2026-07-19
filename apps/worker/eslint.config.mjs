import config from '@capella/eslint-config/node';

export default [
  ...config,
  { ignores: ['vitest.config.ts'] },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
];
