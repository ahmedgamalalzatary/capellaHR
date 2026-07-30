export type ErpAccountIdentity =
  | { role: 'admin'; accountId: number }
  | { role: 'cashier'; accountId: number; employeeId: number };

type ErpSessionReader = {
  authenticate(token: string): Promise<{
    actorType: 'admin' | 'employee' | 'account';
    accountId?: number | null;
    accountRole?: 'admin' | 'cashier' | null;
    employeeId: number | null;
  } | null>;
};

export const createErpAuthCapability = (sessions: ErpSessionReader) => ({
  async authenticateAccount(token: string): Promise<ErpAccountIdentity | null> {
    const session = await sessions.authenticate(token);
    if (session?.actorType !== 'account' || !session.accountId) return null;
    if (session.accountRole === 'admin') {
      return { role: 'admin', accountId: session.accountId };
    }
    if (session.accountRole === 'cashier' && session.employeeId) {
      return {
        role: 'cashier',
        accountId: session.accountId,
        employeeId: session.employeeId,
      };
    }
    return null;
  },
});

export type ErpAuthCapability = ReturnType<typeof createErpAuthCapability>;
