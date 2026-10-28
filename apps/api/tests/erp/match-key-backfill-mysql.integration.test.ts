import { describe, expect, it } from 'vitest';

import { matchKeyFor } from '../../src/modules/erp/catalog/index.js';
import { createMysqlIntegrationDatabase, prepareMysqlIntegrationDatabase } from '../mysql-integration-database.js';

const database = createMysqlIntegrationDatabase();

/**
 * The migration backfills `match_key` in SQL, while the application computes it
 * in JavaScript. If the two ever disagree, a transfer would stop finding the
 * product it used to. This locks them together.
 */
describe('match_key SQL backfill', () => {
  it('produces the same key the helper does', async () => {
    await prepareMysqlIntegrationDatabase(database);
    const names = [
      '  SHAMPOO  ',
      'Hair   Oil',
      'شَامْبُو',
      'الأرْغَان',
      'أحمد',
      'إحمد',
      'آحمد',
      'دهانة',
      'مصطفى',
      'بلسم',
      'Hair\tOil',
    ];
    const connection = await database.$client.promise().getConnection();
    try {
      const [rows] = await connection.query(
        `SELECT n, SHA2(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
          LOWER(TRIM(n)),
          '[\\\\u0610-\\\\u061A\\\\u064B-\\\\u065F\\\\u0670\\\\u06D6-\\\\u06ED]', ''), '[أإآ]', 'ا'), 'ة', 'ه'), 'ى', 'ي'),
          '[[:space:]]+', ' ')), 256) AS k FROM (
          SELECT ? AS n UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ?
          UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ?
          UNION ALL SELECT ?
        ) t`,
        names,
      );
      const byName = new Map((rows as Array<{ n: string; k: string }>).map((row) => [row.n, row.k]));
      for (const name of names) expect(byName.get(name)).toBe(matchKeyFor(name));
    } finally {
      connection.release();
      await database.$client.promise().end();
    }
  });
});
