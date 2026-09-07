import { saveCashierAccountSchema, type SaveCashierAccountInput } from '@capella/contracts';

export type CashierAccountInput = {
  username: string;
  passwordHash?: string;
  employeeIds?: number[];
  management?: { mode: 'create' } | { mode: 'edit'; accountId: number };
  role: 'cashier';
  branchId: number;
  employeeId: null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicCashierAccount = {
  id: number;
  username: string;
  role: 'cashier';
  branchId: number;
  branchName: string;
  active: boolean;
};

export class CashierAccountError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CashierAccountError';
  }
}

export interface CashierAccountRepository {
  /** Exactly one login per branch: creates it or rewrites the existing one. */
  upsert(input: CashierAccountInput): Promise<
    | { kind: 'created'; account: PublicCashierAccount }
    | { kind: 'updated'; account: PublicCashierAccount }
    | { kind: 'branch_not_found' }
    | { kind: 'username_taken' }
    | { kind: 'branch_has_account' }
    | { kind: 'not_found' }
    | { kind: 'employee_not_in_branch' }
  >;
  listCashiers(query: { page: number; pageSize: number }): Promise<{
    items: PublicCashierAccount[];
    total: number;
  }>;
  setCashierActive(input: { accountId: number; active: boolean; updatedAt: Date }): Promise<
    | { kind: 'updated'; account: PublicCashierAccount }
    | { kind: 'not_found' }
  >;
  updateCashierPassword(input: {
    accountId: number;
    passwordHash: string;
    updatedAt: Date;
  }): Promise<
    | { kind: 'updated'; account: PublicCashierAccount }
    | { kind: 'not_found' }
  >;
  /**
   * Retires a branch login for good. The row survives because invoices, shifts
   * and audit events point at it, but the login stops working, its sessions end
   * and the username it held becomes available again.
   */
  archiveCashier(input: { accountId: number; archivedAt: Date }): Promise<
    | { kind: 'archived'; account: PublicCashierAccount }
    | { kind: 'not_found' }
  >;
}

export const createCashierAccountsService = (dependencies: {
  accounts: CashierAccountRepository;
  hashPassword(password: string): Promise<string>;
  now?: () => Date;
}) => {
  const unwrap = (
    result:
      | { kind: 'updated' | 'archived'; account: PublicCashierAccount }
      | { kind: 'not_found' },
  ) => {
    if (result.kind === 'not_found') {
      throw new CashierAccountError('ACCOUNT_NOT_FOUND', 'حساب الكاشير غير موجود');
    }
    return result.account;
  };

  const saveAccount = async (input: CashierAccountInput) => {
    const result = await dependencies.accounts.upsert(input);
    if (result.kind === 'branch_not_found') {
      throw new CashierAccountError('BRANCH_NOT_FOUND', 'الفرع غير موجود');
    }
    if (result.kind === 'username_taken') {
      throw new CashierAccountError('USERNAME_TAKEN', 'اسم المستخدم مستخدم بالفعل');
    }
    if (result.kind === 'branch_has_account') {
      throw new CashierAccountError('BRANCH_HAS_ACCOUNT', 'يوجد حساب كاشير لهذا الفرع بالفعل. يمكنك تعديله من الجدول.');
    }
    if (result.kind === 'not_found') {
      throw new CashierAccountError('ACCOUNT_NOT_FOUND', 'حساب الكاشير غير موجود في هذا الفرع. أعد تحميل الحسابات.');
    }
    if (result.kind === 'employee_not_in_branch') {
      throw new CashierAccountError('ERP_ROSTER_EMPLOYEE_INVALID', 'أحد الموظفين غير نشط أو لا ينتمي إلى هذا الفرع');
    }
    return result.account;
  };

  return {
    async save(values: SaveCashierAccountInput) {
      const input = saveCashierAccountSchema.parse(values);
      const timestamp = (dependencies.now ?? (() => new Date()))();
      return saveAccount({
        username: input.username,
        ...(input.password === undefined ? {} : { passwordHash: await dependencies.hashPassword(input.password) }),
        role: 'cashier', branchId: input.branchId, employeeId: null,
        employeeIds: input.employeeIds,
        management: input.mode === 'edit' ? { mode: 'edit', accountId: input.accountId } : { mode: 'create' },
        createdAt: timestamp, updatedAt: timestamp,
      });
    },
    async upsert(input: { branchId: number; username: string; password: string }) {
      const timestamp = (dependencies.now ?? (() => new Date()))();
      return saveAccount({
        username: input.username.trim().toLowerCase(),
        passwordHash: await dependencies.hashPassword(input.password),
        role: 'cashier',
        branchId: input.branchId,
        employeeId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },
    list(query: { page: number; pageSize: number }) {
      return dependencies.accounts.listCashiers(query);
    },
    async setActive(accountId: number, active: boolean) {
      return unwrap(await dependencies.accounts.setCashierActive({
        accountId,
        active,
        updatedAt: (dependencies.now ?? (() => new Date()))(),
      }));
    },
    async archive(accountId: number) {
      return unwrap(await dependencies.accounts.archiveCashier({
        accountId,
        archivedAt: (dependencies.now ?? (() => new Date()))(),
      }));
    },
    async resetPassword(accountId: number, password: string) {
      return unwrap(await dependencies.accounts.updateCashierPassword({
        accountId,
        passwordHash: await dependencies.hashPassword(password),
        updatedAt: (dependencies.now ?? (() => new Date()))(),
      }));
    },
  };
};

export type CashierAccountsService = ReturnType<typeof createCashierAccountsService>;
