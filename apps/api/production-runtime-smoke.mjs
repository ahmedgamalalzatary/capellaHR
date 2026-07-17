const runtimePackages = [
  '@capella/config/server',
  '@capella/contracts',
  '@capella/database',
  '@capella/database/schema',
  '@capella/shared',
];

await Promise.all(runtimePackages.map((packageName) => import(packageName)));
