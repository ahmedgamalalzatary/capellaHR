const runtimePackages = [
  '@capella/config/server',
  '@capella/config/edition',
  '@capella/contracts',
  '@capella/database',
  '@capella/database/schema',
];

await Promise.all(runtimePackages.map((packageName) => import(packageName)));
