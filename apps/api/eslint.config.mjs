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
  {
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/erp/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/erp/**'],
          message: 'HR and core modules must not import ERP modules.',
        }],
      }],
    },
  },
  {
    files: ['src/modules/erp/**/*.ts'],
    ignores: ['src/modules/erp/hr-capabilities.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^(?:(?:\\.\\./)+|@/modules/)(?:advances|attendance|audit|auth|bonuses|branches|dashboard|deductions|devices|employees|payroll|reports|self-service|shifts|weekly-day-off)(?:/|$)',
            message: 'ERP modules must consume HR through the public capability bridge.',
          },
          {
            regex: '^(?:(?:\\.\\./)+|@/modules/erp/)(?:catalog|clients|erp-reports|expenses|sales|stock|suppliers)/(?!index\\.js$).+',
            message: 'ERP modules must import another ERP module through its public index.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/modules/erp/hr-capabilities.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(?:(?:\\.\\./)+|@/modules/)(?:advances|attendance|audit|auth|bonuses|branches|dashboard|deductions|devices|employees|payroll|reports|self-service|shifts|weekly-day-off)/(?!index\\.js$).+',
          message: 'ERP capabilities may import only public HR module indexes.',
        }],
      }],
    },
  },
  {
    files: ['src/modules/erp/index.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^(?:(?:\\.\\./)+|@/modules/)(?:advances|attendance|audit|auth|bonuses|branches|dashboard|deductions|devices|employees|payroll|reports|self-service|shifts|weekly-day-off)(?:/|$)',
            message: 'ERP modules must consume HR through the public capability bridge.',
          },
          {
            regex: '^\\./(?:catalog|clients|erp-reports|expenses|sales|stock|suppliers)(?!/index\\.js$)(?:/.*|\\.js)?$',
            message: 'The ERP root must import submodules through their public indexes.',
          },
        ],
      }],
    },
  },
];
