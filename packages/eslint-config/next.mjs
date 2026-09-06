import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  { ignores: ['.next/**', 'out/**', 'coverage/**'] },
  ...nextVitals,
  {
    rules: {
      // Existing patterns should be reviewed independently before enabling React Compiler rules.
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
];
