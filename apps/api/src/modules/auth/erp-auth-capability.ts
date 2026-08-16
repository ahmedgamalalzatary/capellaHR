export type ErpAccountIdentity =
  | { role: 'admin'; accountId: number }
  | { role: 'cashier'; accountId: number; branchId: number };

type ErpSessionReader = {
  authenticate(token: string): Promise<{
    actorType: 'admin' | 'employee' | 'account';
    accountId?: number | null;
    accountRole?: 'admin' | 'cashier' | null;
    employeeId: number | null;
    branchId?: number | null;
  } | null>;
};

export const createErpAuthCapability = (sessions: ErpSessionReader) => ({
  async authenticateAccount(token: string): Promise<ErpAccountIdentity | null> {
    const session = await sessions.authenticate(token);
    if (session?.actorType !== 'account' || !session.accountId) return null;
    if (session.accountRole === 'admin') {
      return { role: 'admin', accountId: session.accountId };
    }
    if (session.accountRole === 'cashier' && typeof session.branchId === 'number') {
      return {
        role: 'cashier',
        accountId: session.accountId,
        branchId: session.branchId,
      };
    }
    return null;
  },
});

export type ErpAuthCapability = ReturnType<typeof createErpAuthCapability>;
