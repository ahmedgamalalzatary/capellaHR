import config from '@capella/eslint-config/node';

export default [
  ...config,
  { ignores: ['vitest.config.ts'] },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];
