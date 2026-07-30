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
}

export const createCashierAccountsService = (dependencies: {
  accounts: CashierAccountRepository;
  hashPassword(password: string): Promise<string>;
  now?: () => Date;
}) => ({
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
      throw new CashierAccountError('EMPLOYEE_NOT_FOUND', 'Employee not found');
    }
    if (result.kind === 'employee_inactive') {
      throw new CashierAccountError('EMPLOYEE_INACTIVE', 'Employee is inactive');
    }
    if (result.kind === 'username_taken') {
      throw new CashierAccountError('USERNAME_TAKEN', 'Username is already in use');
    }
    if (result.kind === 'employee_already_has_account') {
      throw new CashierAccountError('EMPLOYEE_ALREADY_HAS_ACCOUNT', 'Employee already has an account');
    }
    const { id, username, role, employeeId, branchId, active } = result.account;
    return { id, username, role, employeeId, branchId, active };
  },
});

export type CashierAccountsService = ReturnType<typeof createCashierAccountsService>;
