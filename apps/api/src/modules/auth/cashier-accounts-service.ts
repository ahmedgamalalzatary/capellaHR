export type CashierAccountInput = {
  username: string;
  passwordHash: string;
  role: 'cashier';
  employeeId: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicCashierAccount = {
  id: number;
  username: string;
  role: 'cashier';
  employeeId: number;
  branchId: number;
  active: boolean;
};

export class CashierAccountError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CashierAccountError';
  }
}

export interface CashierAccountRepository {
  promoteEmployeeToCashier(input: CashierAccountInput): Promise<
    | { kind: 'created'; account: PublicCashierAccount }
    | { kind: 'employee_not_found' }
    | { kind: 'employee_inactive' }
    | { kind: 'username_taken' }
    | { kind: 'employee_already_has_account' }
  >;
  listCashiers(query: { page: number; pageSize: number }): Promise<{
    items: PublicCashierAccount[];
    total: number;
  }>;
  setCashierActive(input: { accountId: number; active: boolean; updatedAt: Date }): Promise<
    | { kind: 'updated'; account: PublicCashierAccount }
    | { kind: 'not_found' }
    | { kind: 'employee_inactive' }
  >;
  updateCashierPassword(input: {
    accountId: number;
    passwordHash: string;
    updatedAt: Date;
  }): Promise<
    | { kind: 'updated'; account: PublicCashierAccount }
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
      | { kind: 'updated'; account: PublicCashierAccount }
      | { kind: 'not_found' }
      | { kind: 'employee_inactive' },
  ) => {
    if (result.kind === 'not_found') {
      throw new CashierAccountError('ACCOUNT_NOT_FOUND', 'حساب الكاشير غير موجود');
    }
    if (result.kind === 'employee_inactive') {
      throw new CashierAccountError('EMPLOYEE_INACTIVE', 'الموظف غير نشط');
    }
    return result.account;
  };

  return {
  async promote(input: { employeeId: number; username: string; password: string }) {
    const timestamp = (dependencies.now ?? (() => new Date()))();
    const result = await dependencies.accounts.promoteEmployeeToCashier({
      username: input.username.trim().toLowerCase(),
      passwordHash: await dependencies.hashPassword(input.password),
      role: 'cashier',
      employeeId: input.employeeId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (result.kind === 'employee_not_found') {
      throw new CashierAccountError('EMPLOYEE_NOT_FOUND', 'الموظف غير موجود');
    }
    if (result.kind === 'employee_inactive') {
      throw new CashierAccountError('EMPLOYEE_INACTIVE', 'الموظف غير نشط');
    }
    if (result.kind === 'username_taken') {
      throw new CashierAccountError('USERNAME_TAKEN', 'اسم المستخدم مستخدم بالفعل');
    }
    if (result.kind === 'employee_already_has_account') {
      throw new CashierAccountError('EMPLOYEE_ALREADY_HAS_ACCOUNT', 'يمتلك الموظف حسابًا بالفعل');
    }
    const { id, username, role, employeeId, branchId, active } = result.account;
    return { id, username, role, employeeId, branchId, active };
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
