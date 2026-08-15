import { describe, expect, it, vi } from 'vitest';

import { reconcileDefiners } from './definer-reconciler.js';

const appAccount = 'capella_app@%';

const trigger = (overrides: Record<string, unknown> = {}) => ({
  TRIGGER_NAME: 'erp_expenses_guard_insert',
  DEFINER: appAccount,
  EVENT_MANIPULATION: 'INSERT',
  EVENT_OBJECT_TABLE: 'erp_expenses',
  ACTION_TIMING: 'BEFORE',
  ACTION_ORDER: 1,
  SQL_MODE: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
  CHARACTER_SET_CLIENT: 'utf8mb4',
  COLLATION_CONNECTION: 'utf8mb4_unicode_ci',
  ACTION_STATEMENT: 'BEGIN\n  SIGNAL SQLSTATE \'45000\' SET MESSAGE_TEXT = \'nope\';\nEND',
  ...overrides,
});

const routine = (overrides: Record<string, unknown> = {}) => ({
  ROUTINE_NAME: 'correct_erp_expense',
  ROUTINE_TYPE: 'PROCEDURE',
  DEFINER: appAccount,
  ...overrides,
});

/** Records every statement while answering the reconciler's lookups. */
const fakeDatabase = ({
  triggers = [] as ReturnType<typeof trigger>[],
  routines = [] as ReturnType<typeof routine>[],
  accounts = [appAccount, 'root@localhost'] as string[],
  createProcedure = 'CREATE DEFINER=`capella_hr`@`%` PROCEDURE `correct_erp_expense`()\nBEGIN\n  SELECT 1;\nEND',
} = {}) => {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes('CURRENT_USER()')) return [{ account: appAccount }];
    if (sql.includes('mysql.user')) return accounts.map((account) => ({ account }));
    if (sql.includes('information_schema.TRIGGERS')) return triggers;
    if (sql.includes('information_schema.ROUTINES')) return routines;
    if (sql.includes('SHOW CREATE PROCEDURE')) {
      return [{ 'Create Procedure': createProcedure, sql_mode: 'STRICT_TRANS_TABLES' }];
    }
    if (sql.includes('SHOW CREATE FUNCTION')) {
      return [{ 'Create Function': createProcedure, sql_mode: 'STRICT_TRANS_TABLES' }];
    }
    return [];
  });
  return { query, statements };
};

const ddl = (statements: string[]) => statements.filter(
  (sql) => /^(DROP|CREATE)\s/.test(sql.trim()),
);

describe('definer reconciler', () => {
  it('leaves a database whose objects already belong to the app account untouched', async () => {
    const database = fakeDatabase({ triggers: [trigger()], routines: [routine()] });

    const report = await reconcileDefiners(database.query);

    expect(report).toEqual({ account: appAccount, repaired: [] });
    expect(ddl(database.statements)).toEqual([]);
  });

  /**
   * A working server may migrate under an admin login while the API connects as someone
   * else. Rewriting those objects would drop live guards for no reason, so only a definer
   * naming an account the server does not have is repaired.
   */
  it('leaves objects owned by a different but existing account alone', async () => {
    const database = fakeDatabase({
      triggers: [trigger({ DEFINER: 'capella_api@%' })],
      routines: [routine({ DEFINER: 'capella_api@%' })],
      accounts: [appAccount, 'capella_api@%'],
    });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual([]);
    expect(ddl(database.statements)).toEqual([]);
  });

  it('does nothing but warn when it cannot read the server account list', async () => {
    const database = fakeDatabase({ triggers: [trigger({ DEFINER: 'capella_hr@%' })] });
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CURRENT_USER()')) return [{ account: appAccount }];
      if (sql.includes('mysql.user')) throw new Error('SELECT command denied');
      return [];
    });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual([]);
    expect(report.warning).toMatch(/account list/i);
  });

  it('recreates a trigger left behind by another account under the app account', async () => {
    const database = fakeDatabase({
      triggers: [trigger({ DEFINER: 'capella_hr@%' })],
    });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual(['trigger erp_expenses_guard_insert']);
    const statements = database.statements.join('\n');
    expect(statements).toContain("SET sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
    expect(statements).toContain('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
    expect(statements).toContain('DROP TRIGGER IF EXISTS `erp_expenses_guard_insert`');
    expect(statements).toContain(
      'CREATE TRIGGER `erp_expenses_guard_insert` BEFORE INSERT ON `erp_expenses` FOR EACH ROW',
    );
    expect(statements).toContain("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'nope'");
  });

  it('never writes an explicit definer, so the recreating account owns the object', async () => {
    const database = fakeDatabase({
      triggers: [trigger({ DEFINER: 'capella_hr@%' })],
      routines: [routine({ DEFINER: 'capella_hr@%' })],
    });

    await reconcileDefiners(database.query);

    for (const statement of ddl(database.statements)) {
      expect(statement).not.toMatch(/DEFINER\s*=/);
    }
  });

  it('repairs only the mismatched trigger and leaves the healthy one in place', async () => {
    const database = fakeDatabase({
      triggers: [
        trigger({ TRIGGER_NAME: 'healthy_guard' }),
        trigger({ TRIGGER_NAME: 'stale_guard', DEFINER: 'capella_hr@%' }),
      ],
    });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual(['trigger stale_guard']);
    const statements = database.statements.join('\n');
    expect(statements).toContain('DROP TRIGGER IF EXISTS `stale_guard`');
    expect(statements).not.toContain('healthy_guard');
  });

  it('recreates triggers in their recorded firing order', async () => {
    const database = fakeDatabase({
      triggers: [
        trigger({ TRIGGER_NAME: 'second_guard', ACTION_ORDER: 2, DEFINER: 'capella_hr@%' }),
        trigger({ TRIGGER_NAME: 'first_guard', ACTION_ORDER: 1, DEFINER: 'capella_hr@%' }),
      ],
    });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual(['trigger first_guard', 'trigger second_guard']);
  });

  it('recreates a stored routine with the stale definer clause stripped', async () => {
    const database = fakeDatabase({ routines: [routine({ DEFINER: 'capella_hr@%' })] });

    const report = await reconcileDefiners(database.query);

    expect(report.repaired).toEqual(['procedure correct_erp_expense']);
    const statements = database.statements.join('\n');
    expect(statements).toContain('DROP PROCEDURE IF EXISTS `correct_erp_expense`');
    expect(statements).toContain('CREATE PROCEDURE `correct_erp_expense`()');
    expect(statements).toContain('SELECT 1;');
  });

  it('surfaces the object it could not repair instead of reporting success', async () => {
    const database = fakeDatabase({ triggers: [trigger({ DEFINER: 'capella_hr@%' })] });
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CURRENT_USER()')) return [{ account: appAccount }];
      if (sql.includes('mysql.user')) return [{ account: appAccount }];
      if (sql.includes('information_schema.TRIGGERS')) return [trigger({ DEFINER: 'capella_hr@%' })];
      if (sql.includes('information_schema.ROUTINES')) return [];
      if (sql.startsWith('CREATE TRIGGER')) throw new Error('syntax error');
      return [];
    });

    await expect(reconcileDefiners(database.query)).rejects.toThrow(
      /erp_expenses_guard_insert/,
    );
  });
});
