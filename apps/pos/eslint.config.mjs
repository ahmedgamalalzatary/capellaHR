import config from '@capella/eslint-config/next';

const posConfig = [
  ...config,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^@/features/[^/]+/.+',
            message: 'Import features only through their public index (e.g. `@/features/auth`), not their internals.',
          },
          {
            regex: '^(?:\\.\\./)+web/',
            message: 'apps/pos must not import from apps/web; the two are independently deployed frontends.',
          },
        ],
      }],
    },
  },
];

export default posConfig;
