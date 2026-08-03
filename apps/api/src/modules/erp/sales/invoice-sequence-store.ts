import { type createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';

import type { InvoiceSequenceStore } from './services/invoice-number.js';

type Database = ReturnType<typeof createDatabase>;

/**
 * This executes through the database, never through the future sale
 * transaction. The atomic statement commits independently, preserving gaps
 * and preventing reuse if invoice persistence later rolls back.
 */
export const createDrizzleInvoiceSequenceStore = (
  database: Pick<Database, 'execute'>,
): InvoiceSequenceStore => ({
  async allocate(businessDate, allocatedAt) {
    const result = await database.execute(sql`
      INSERT INTO erp_invoice_daily_sequences (business_date, \`last_value\`, updated_at)
      VALUES (${businessDate}, LAST_INSERT_ID(1), ${allocatedAt})
      ON DUPLICATE KEY UPDATE
        \`last_value\` = LAST_INSERT_ID(\`last_value\` + 1),
        updated_at = VALUES(updated_at)
    `);
    const sequence = Number(result[0].insertId);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 2_147_483_647) {
      throw new Error('Invoice sequence allocation returned an invalid value');
    }
    return sequence;
  },
});
