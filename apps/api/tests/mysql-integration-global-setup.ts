import { createDatabase } from '@capella/database';

export default function setup() {
  return async () => {
    const sourceUrl = process.env.DATABASE_URL;
    const sharedUrl = process.env.CAPELLA_MYSQL_INTEGRATION_DATABASE_URL;
    if (!sourceUrl || !sharedUrl) return;

    const databaseName = new URL(sharedUrl).pathname.slice(1);
    if (!/^capella_hr_test_shared_\d+_\d+$/u.test(databaseName)) {
      throw new Error('Unsafe shared MySQL integration database name');
    }

    const control = createDatabase(sourceUrl);
    try {
      await control.$client.promise().query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await control.$client.promise().end();
    }
  };
}
