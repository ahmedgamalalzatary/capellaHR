import { FlatCompat } from '@eslint/eslintrc';

// eslint-config-next still ships a legacy (eslintrc) config; adapt it to flat config.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  { ignores: ['.next/**', 'out/**', 'coverage/**'] },
  ...compat.extends('next/core-web-vitals'),
];
