/**
 * MySQL stamps the creating account into every trigger and routine as its DEFINER and
 * resolves that account at execution time. A schema imported from another server — or
 * migrated by a different login — therefore carries definers that do not exist here, and
 * every insert those guards protect fails with ER_NO_SUCH_USER. Recreating the objects
 * without a DEFINER clause hands them to the account running the migration, which is the
 * account the application connects with.
 */

export type DefinerQuery = (sql: string) => Promise<unknown[]>;

export interface DefinerReport {
  account: string;
  repaired: string[];
  warning?: string;
}

interface TriggerRow {
  TRIGGER_NAME: string;
  DEFINER: string;
  EVENT_MANIPULATION: string;
  EVENT_OBJECT_TABLE: string;
  ACTION_TIMING: string;
  ACTION_ORDER: number;
  SQL_MODE: string;
  CHARACTER_SET_CLIENT: string;
  COLLATION_CONNECTION: string;
  ACTION_STATEMENT: string;
}

interface RoutineRow {
  ROUTINE_NAME: string;
  ROUTINE_TYPE: string;
  DEFINER: string;
}

const definerClause = /DEFINER\s*=\s*(`[^`]*`|'[^']*')@(`[^`]*`|'[^']*')\s*/;

const triggerOrder = (left: TriggerRow, right: TriggerRow) => (
  left.EVENT_OBJECT_TABLE.localeCompare(right.EVENT_OBJECT_TABLE)
  || left.ACTION_TIMING.localeCompare(right.ACTION_TIMING)
  || left.EVENT_MANIPULATION.localeCompare(right.EVENT_MANIPULATION)
  || Number(left.ACTION_ORDER) - Number(right.ACTION_ORDER)
);

async function repair(label: string, steps: () => Promise<void>): Promise<string> {
  try {
    await steps();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not reassign ${label}: ${reason}`, { cause });
  }
  return label;
}

export async function reconcileDefiners(query: DefinerQuery): Promise<DefinerReport> {
  const [owner] = await query('SELECT CURRENT_USER() AS account') as { account: string }[];
  const account = owner?.account ?? '';

  /**
   * Only a definer naming an account this server does not have is broken. An object owned
   * by another *existing* account works fine, and rewriting it would drop a live guard
   * during a deployment for no reason.
   */
  let accounts: Set<string>;
  try {
    const rows = await query(
      "SELECT CONCAT(`user`, '@', `host`) AS account FROM mysql.user",
    ) as { account: string }[];
    accounts = new Set(rows.map((row) => row.account));
  } catch {
    return {
      account,
      repaired: [],
      warning: 'could not read the server account list, so object ownership was left untouched',
    };
  }

  const isBroken = (definer: string) => !accounts.has(definer);

  const triggers = await query(`
    SELECT TRIGGER_NAME, DEFINER, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING,
      ACTION_ORDER, SQL_MODE, CHARACTER_SET_CLIENT, COLLATION_CONNECTION, ACTION_STATEMENT
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
  `) as TriggerRow[];
  const routines = await query(`
    SELECT ROUTINE_NAME, ROUTINE_TYPE, DEFINER
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = DATABASE()
  `) as RoutineRow[];

  const repaired: string[] = [];

  for (const row of triggers.filter((entry) => isBroken(entry.DEFINER)).sort(triggerOrder)) {
    repaired.push(await repair(`trigger ${row.TRIGGER_NAME}`, async () => {
      await query(`SET sql_mode = '${row.SQL_MODE}'`);
      await query(`SET NAMES ${row.CHARACTER_SET_CLIENT} COLLATE ${row.COLLATION_CONNECTION}`);
      await query(`DROP TRIGGER IF EXISTS \`${row.TRIGGER_NAME}\``);
      await query(
        `CREATE TRIGGER \`${row.TRIGGER_NAME}\` ${row.ACTION_TIMING} ${row.EVENT_MANIPULATION}`
        + ` ON \`${row.EVENT_OBJECT_TABLE}\` FOR EACH ROW\n${row.ACTION_STATEMENT}`,
      );
    }));
  }

  for (const row of routines.filter((entry) => isBroken(entry.DEFINER))) {
    const kind = row.ROUTINE_TYPE.toUpperCase() === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
    repaired.push(await repair(`${kind.toLowerCase()} ${row.ROUTINE_NAME}`, async () => {
      const [definition] = await query(
        `SHOW CREATE ${kind} \`${row.ROUTINE_NAME}\``,
      ) as Record<string, string>[];
      const body = definition?.[`Create ${kind === 'FUNCTION' ? 'Function' : 'Procedure'}`];
      if (!body) throw new Error('MySQL returned no definition');

      await query(`SET sql_mode = '${definition?.sql_mode ?? ''}'`);
      await query(`DROP ${kind} IF EXISTS \`${row.ROUTINE_NAME}\``);
      await query(body.replace(definerClause, ''));
    }));
  }

  return { account, repaired };
}
