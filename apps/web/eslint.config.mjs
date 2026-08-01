import config from '@capella/eslint-config/next';

const webConfig = [
  ...config,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^(?:\\.\\./)+pos/',
            message: 'apps/web must not import from apps/pos; the two are independently deployed frontends.',
          },
        ],
      }],
    },
  },
];

export default webConfig;
