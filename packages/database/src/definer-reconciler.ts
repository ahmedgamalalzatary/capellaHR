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

/** Says whether the dropped original was put back, so a failure can report which happened. */
type Restore = () => Promise<'restored' | 'untouched'>;

const definerClause = /DEFINER\s*=\s*(`[^`]*`|'[^']*')@(`[^`]*`|'[^']*')\s*/;

const quoted = (value: string) => `\`${value.replace(/`/g, '``')}\``;

/** `user@host` as information_schema reports it, back into a DEFINER clause. */
const accountClause = (definer: string) => {
  const separator = definer.lastIndexOf('@');
  return separator === -1
    ? `DEFINER=${quoted(definer)}@\`%\``
    : `DEFINER=${quoted(definer.slice(0, separator))}@${quoted(definer.slice(separator + 1))}`;
};

const triggerGroup = (row: TriggerRow) => [
  row.EVENT_OBJECT_TABLE, row.ACTION_TIMING, row.EVENT_MANIPULATION,
].join('\u0000');

const triggerOrder = (left: TriggerRow, right: TriggerRow) => (
  triggerGroup(left).localeCompare(triggerGroup(right))
  || Number(left.ACTION_ORDER) - Number(right.ACTION_ORDER)
);

async function restoreNote(restore: Restore): Promise<string> {
  try {
    return await restore() === 'restored' ? '; the original definition was put back' : '';
  } catch (failure) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    return `; the original definition could not be put back either, so the object is now`
      + ` missing: ${reason}`;
  }
}

async function repair(label: string, steps: () => Promise<void>, restore: Restore): Promise<string> {
  try {
    await steps();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not reassign ${label}: ${reason}${await restoreNote(restore)}`, { cause });
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

  /**
   * A trigger recreated without an ordering clause is appended to the end of its activation
   * group. Repairs run in recorded order, so every trigger below this one still exists and
   * can anchor it; only the first of a group has to anchor itself above the one after it.
   */
  const siblings = [...triggers].sort(triggerOrder);
  const orderClause = (row: TriggerRow) => {
    const group = siblings.filter((entry) => triggerGroup(entry) === triggerGroup(row));
    const position = group.findIndex((entry) => entry.TRIGGER_NAME === row.TRIGGER_NAME);
    const before = group[position - 1];
    if (before) return ` FOLLOWS ${quoted(before.TRIGGER_NAME)}`;
    const after = group[position + 1];
    return after ? ` PRECEDES ${quoted(after.TRIGGER_NAME)}` : '';
  };

  for (const row of siblings.filter((entry) => isBroken(entry.DEFINER))) {
    let dropped = false;
    const create = (definer = '') => query(
      `CREATE ${definer}TRIGGER ${quoted(row.TRIGGER_NAME)} ${row.ACTION_TIMING}`
      + ` ${row.EVENT_MANIPULATION} ON ${quoted(row.EVENT_OBJECT_TABLE)} FOR EACH ROW`
      + `${orderClause(row)}\n${row.ACTION_STATEMENT}`,
    );
    repaired.push(await repair(`trigger ${row.TRIGGER_NAME}`, async () => {
      await query(`SET sql_mode = '${row.SQL_MODE}'`);
      await query(`SET NAMES ${row.CHARACTER_SET_CLIENT} COLLATE ${row.COLLATION_CONNECTION}`);
      await query(`DROP TRIGGER IF EXISTS ${quoted(row.TRIGGER_NAME)}`);
      dropped = true;
      await create();
    }, async () => {
      if (!dropped) return 'untouched';
      await create(`${accountClause(row.DEFINER)} `);
      return 'restored';
    }));
  }

  for (const row of routines.filter((entry) => isBroken(entry.DEFINER))) {
    const kind = row.ROUTINE_TYPE.toUpperCase() === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
    let original: string | undefined;
    repaired.push(await repair(`${kind.toLowerCase()} ${row.ROUTINE_NAME}`, async () => {
      const [definition] = await query(
        `SHOW CREATE ${kind} ${quoted(row.ROUTINE_NAME)}`,
      ) as Record<string, string>[];
      const body = definition?.[`Create ${kind === 'FUNCTION' ? 'Function' : 'Procedure'}`];
      if (!body) throw new Error('MySQL returned no definition');

      await query(`SET sql_mode = '${definition?.sql_mode ?? ''}'`);
      // A routine body is parsed under the connection character set it was written with.
      if (definition?.character_set_client && definition.collation_connection) {
        await query(
          `SET NAMES ${definition.character_set_client}`
          + ` COLLATE ${definition.collation_connection}`,
        );
      }
      await query(`DROP ${kind} IF EXISTS ${quoted(row.ROUTINE_NAME)}`);
      original = body;
      await query(body.replace(definerClause, ''));
    }, async () => {
      if (original === undefined) return 'untouched';
      await query(original);
      return 'restored';
    }));
  }

  return { account, repaired };
}
