import { type createDatabase } from '@capella/database';
import { accounts, authSessions, branches, cashierSessions } from '@capella/database/schema';
import { and, eq, isNull, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import type { ErpAuditCapability } from '../hr-capabilities.js';
import {
  CASHIER_SESSION_MAX_DURATION_MS,
  type CashierSessionRecord,
  type CashierSessionRepository,
} from './cashier-sessions-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const openedAccounts = alias(accounts, 'erp_cashier_session_opened_accounts');
const closedAccounts = alias(accounts, 'erp_cashier_session_closed_accounts');

const sessionFields = {
  id: cashierSessions.id,
  branchId: cashierSessions.branchId,
  branchName: branches.name,
  openedByAccountId: cashierSessions.openedByAccountId,
  openedByUsername: openedAccounts.username,
  openedAt: cashierSessions.openedAt,
  closedAt: cashierSessions.closedAt,
  closedByAccountId: cashierSessions.closedByAccountId,
  closedByUsername: closedAccounts.username,
  autoClosedAt: cashierSessions.autoClosedAt,
};

const findById = async (executor: Executor, id: number): Promise<CashierSessionRecord | null> => (
  (await executor.select(sessionFields).from(cashierSessions)
    .innerJoin(branches, eq(branches.id, cashierSessions.branchId))
    .innerJoin(openedAccounts, eq(openedAccounts.id, cashierSessions.openedByAccountId))
    .leftJoin(closedAccounts, eq(closedAccounts.id, cashierSessions.closedByAccountId))
    .where(eq(cashierSessions.id, id)).limit(1))[0] ?? null
);

const findOpenByBranch = async (
  executor: Executor,
  branchId: number,
): Promise<CashierSessionRecord | null> => (
  (await executor.select(sessionFields).from(cashierSessions)
    .innerJoin(branches, eq(branches.id, cashierSessions.branchId))
    .innerJoin(openedAccounts, eq(openedAccounts.id, cashierSessions.openedByAccountId))
    .leftJoin(closedAccounts, eq(closedAccounts.id, cashierSessions.closedByAccountId))
    .where(and(
      eq(cashierSessions.branchId, branchId),
      isNull(cashierSessions.closedAt),
    )).limit(1))[0] ?? null
);

const isDuplicateOpenError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  const duplicate = (value: object) => 'code' in value && value.code === 'ER_DUP_ENTRY';
  const cause: unknown = 'cause' in error ? error.cause : undefined;
  return duplicate(error)
    || (typeof cause === 'object' && cause !== null && duplicate(cause));
};

export const createDrizzleCashierSessionRepository = (
  database: Database,
  audit: ErpAuditCapability,
): CashierSessionRepository => ({
  async open(input) {
    try {
      return await database.transaction(async (transaction) => {
        const inserted = await transaction.insert(cashierSessions).values(input);
        const id = Number(inserted[0].insertId);
        const session = (await findById(transaction, id))!;
        await audit.record(transaction, {
          module: 'erp_cashier_sessions',
          action: 'open',
          entityType: 'cashier_session',
          entityId: id,
          afterState: session,
          relatedIds: {
            branchId: input.branchId,
            openedByAccountId: input.openedByAccountId,
          },
          createdAt: input.openedAt,
        });
        return { kind: 'success' as const, session };
      });
    } catch (error) {
      if (!isDuplicateOpenError(error)) throw error;
      const session = await findOpenByBranch(database, input.branchId);
      if (!session) throw error;
      return { kind: 'already_open' as const, session };
    }
  },

  findOpenByBranch(branchId) {
    return findOpenByBranch(database, branchId);
  },

  close(input) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select().from(cashierSessions).where(and(
        eq(cashierSessions.branchId, input.branchId),
        isNull(cashierSessions.closedAt),
      )).for('update').limit(1))[0];
      if (!current) return { kind: 'not_open' as const };
      const before = (await findById(transaction, current.id))!;
      if (current.openedByAccountId !== input.closedByAccountId) {
        return { kind: 'not_owner' as const, session: before };
      }
      await transaction.update(cashierSessions).set({
        closedAt: input.closedAt,
        closedByAccountId: input.closedByAccountId,
      }).where(and(
        eq(cashierSessions.id, current.id),
        isNull(cashierSessions.closedAt),
      ));
      const session = (await findById(transaction, current.id))!;
      await audit.record(transaction, {
        module: 'erp_cashier_sessions',
        action: 'close',
        entityType: 'cashier_session',
        entityId: current.id,
        beforeState: before,
        afterState: session,
        relatedIds: {
          branchId: input.branchId,
          closedByAccountId: input.closedByAccountId,
        },
        createdAt: input.closedAt,
      });
      return { kind: 'success' as const, session };
    });
  },

  autoCloseExpired(input) {
    return database.transaction(async (transaction) => {
      const expired = await transaction.select({
        id: cashierSessions.id,
        branchId: cashierSessions.branchId,
        openedByAccountId: cashierSessions.openedByAccountId,
        openedAt: cashierSessions.openedAt,
      }).from(cashierSessions).where(and(
        isNull(cashierSessions.closedAt),
        lte(cashierSessions.openedAt, input.openedBefore),
      )).for('update');

      const closed: CashierSessionRecord[] = [];
      for (const current of expired) {
        const before = (await findById(transaction, current.id))!;
        // Stamped at the instant this shift ran out, not at the sweep, so the
        // record reads the same whenever the sweep happens to run.
        const closedAt = new Date(
          current.openedAt.getTime() + CASHIER_SESSION_MAX_DURATION_MS,
        );
        await transaction.update(cashierSessions).set({
          closedAt,
          autoClosedAt: closedAt,
          closedByAccountId: null,
        }).where(and(
          eq(cashierSessions.id, current.id),
          isNull(cashierSessions.closedAt),
        ));
        // The till is signed out with the shift; whoever comes next logs in again.
        await transaction.update(authSessions).set({ revokedAt: closedAt }).where(and(
          eq(authSessions.accountId, current.openedByAccountId),
          isNull(authSessions.revokedAt),
        ));
        const session = (await findById(transaction, current.id))!;
        await audit.record(transaction, {
          module: 'erp_cashier_sessions',
          action: 'automatic_close',
          entityType: 'cashier_session',
          entityId: current.id,
          beforeState: before,
          afterState: session,
          relatedIds: {
            branchId: current.branchId,
            openedByAccountId: current.openedByAccountId,
          },
          createdAt: closedAt,
        });
        closed.push(session);
      }
      return closed;
    });
  },

  recoveryClose(input) {
    return database.transaction(async (transaction) => {
      const current = (await transaction.select().from(cashierSessions)
        .where(eq(cashierSessions.id, input.sessionId)).for('update').limit(1))[0];
      if (!current) return { kind: 'not_found' as const };
      const before = (await findById(transaction, current.id))!;
      if (current.closedAt) return { kind: 'already_closed' as const, session: before };
      await transaction.update(cashierSessions).set({
        closedAt: input.closedAt,
        closedByAccountId: input.closedByAccountId,
      }).where(and(
        eq(cashierSessions.id, current.id),
        isNull(cashierSessions.closedAt),
      ));
      const session = (await findById(transaction, current.id))!;
      await audit.record(transaction, {
        module: 'erp_cashier_sessions',
        action: 'recovery_close',
        entityType: 'cashier_session',
        entityId: current.id,
        beforeState: before,
        afterState: { ...session, recoveryReason: input.reason },
        relatedIds: {
          branchId: current.branchId,
          closedByAccountId: input.closedByAccountId,
        },
        createdAt: input.closedAt,
      });
      return { kind: 'success' as const, session };
    });
  },
});
