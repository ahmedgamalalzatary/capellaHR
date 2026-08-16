import { type createDatabase } from '@capella/database';
import { accounts, authSessions, branches } from '@capella/database/schema';
import { and, count, eq, isNull, ne } from 'drizzle-orm';

import { writeAudit } from '../audit/index.js';
import type { CashierAccountRepository } from './cashier-accounts-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const errorCode = (error: unknown): string | undefined => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

// Branch logins only; legacy employee-linked cashier rows stay hidden history.
const branchCashier = and(eq(accounts.role, 'cashier'), isNull(accounts.employeeId));

const selectPublic = async (executor: Executor, accountId: number) => {
  const row = (await executor.select({
    id: accounts.id,
    username: accounts.username,
    role: accounts.role,
    branchId: accounts.branchId,
    branchName: branches.name,
    active: accounts.active,
  }).from(accounts).innerJoin(branches, eq(branches.id, accounts.branchId))
    .where(and(eq(accounts.id, accountId), branchCashier)).limit(1))[0];
  return row?.role === 'cashier' && row.branchId !== null
    ? { ...row, role: 'cashier' as const, branchId: row.branchId }
    : null;
};

export const createDrizzleCashierAccountRepository = (
  database: Database,
): CashierAccountRepository => ({
  upsert(input) {
    return database.transaction(async (tx) => {
      const branch = (await tx.select({ id: branches.id }).from(branches)
        .where(eq(branches.id, input.branchId)).for('update').limit(1))[0];
      if (!branch) return { kind: 'branch_not_found' as const };

      const current = (await tx.select({
        id: accounts.id,
        username: accounts.username,
        active: accounts.active,
      }).from(accounts).where(and(branchCashier, eq(accounts.branchId, input.branchId)))
        .for('update').limit(1))[0];

      const usernameOwner = (await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.username, input.username),
        ...(current ? [ne(accounts.id, current.id)] : []),
      )).limit(1))[0];
      if (usernameOwner) return { kind: 'username_taken' as const };

      const persist = async (kind: 'created' | 'updated', accountId: number) => {
        const account = await selectPublic(tx, accountId);
        await writeAudit(tx, {
          module: 'auth',
          action: 'branch_cashier_upsert',
          entityType: 'account',
          entityId: accountId,
          ...(current ? { beforeState: { username: current.username, active: current.active } } : {}),
          afterState: account,
          relatedIds: { accountId, branchId: input.branchId },
          createdAt: input.updatedAt,
        });
        return { kind, account: account! };
      };

      if (current) {
        await tx.update(accounts).set({
          username: input.username,
          passwordHash: input.passwordHash,
          active: true,
          updatedAt: input.updatedAt,
        }).where(eq(accounts.id, current.id));
        await tx.update(authSessions).set({ revokedAt: input.updatedAt }).where(and(
          eq(authSessions.accountId, current.id),
          isNull(authSessions.revokedAt),
        ));
        return persist('updated', current.id);
      }

      try {
        const inserted = await tx.insert(accounts).values(input);
        return persist('created', Number(inserted[0].insertId));
      } catch (error) {
        // A concurrent upsert for the same branch or username landed first; both
        // manifest as a taken username and a retry converges on one account.
        if (errorCode(error) !== 'ER_DUP_ENTRY') throw error;
        return { kind: 'username_taken' as const };
      }
    });
  },
    async listCashiers(query) {
      const [items, totals] = await Promise.all([
        database.select({
          id: accounts.id, username: accounts.username, role: accounts.role,
          branchId: accounts.branchId, branchName: branches.name, active: accounts.active,
        }).from(accounts).innerJoin(branches, eq(branches.id, accounts.branchId))
          .where(branchCashier).orderBy(accounts.branchId)
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        database.select({ total: count() }).from(accounts).where(branchCashier),
      ]);
      return {
        items: items.flatMap((row) => row.role === 'cashier' && row.branchId !== null
          ? [{ ...row, role: 'cashier' as const, branchId: row.branchId }]
          : []),
        total: totals[0]?.total ?? 0,
      };
    },
    setCashierActive(input) {
      return database.transaction(async (tx) => {
        const before = await selectPublic(tx, input.accountId);
        if (!before) return { kind: 'not_found' as const };
        await tx.update(accounts).set({ active: input.active, updatedAt: input.updatedAt })
          .where(eq(accounts.id, input.accountId));
        if (!input.active) {
          await tx.update(authSessions).set({ revokedAt: input.updatedAt }).where(and(
            eq(authSessions.accountId, input.accountId),
            isNull(authSessions.revokedAt),
          ));
        }
        const account = { ...before, active: input.active };
        await writeAudit(tx, {
          module: 'auth', action: input.active ? 'branch_cashier_enable' : 'branch_cashier_disable',
          entityType: 'account', entityId: input.accountId,
          beforeState: before, afterState: account,
          relatedIds: { accountId: input.accountId, branchId: before.branchId },
          createdAt: input.updatedAt,
        });
        return { kind: 'updated' as const, account };
      });
    },
    updateCashierPassword(input) {
      return database.transaction(async (tx) => {
        const account = await selectPublic(tx, input.accountId);
        if (!account) return { kind: 'not_found' as const };
        await tx.update(accounts).set({
          passwordHash: input.passwordHash,
          updatedAt: input.updatedAt,
        }).where(eq(accounts.id, input.accountId));
        await tx.update(authSessions).set({ revokedAt: input.updatedAt }).where(and(
          eq(authSessions.accountId, input.accountId),
          isNull(authSessions.revokedAt),
        ));
        await writeAudit(tx, {
          module: 'auth', action: 'branch_cashier_password_reset',
          entityType: 'account', entityId: input.accountId,
          beforeState: { credentialsChanged: false },
          afterState: { credentialsChanged: true },
          relatedIds: { accountId: input.accountId, branchId: account.branchId },
          createdAt: input.updatedAt,
        });
        return { kind: 'updated' as const, account };
      });
    },
  });
