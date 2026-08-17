import type { ErpBranchContext } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

/**
 * A till is never left open overnight and forgotten: sixteen hours after it was
 * opened the system ends the shift itself, matching the automatic timeout the HR
 * attendance module already applies to a working day.
 */
export const CASHIER_SESSION_MAX_DURATION_MS = 16 * 60 * 60_000;

export type CashierSessionRecord = {
  id: number;
  branchId: number;
  branchName: string;
  openedByAccountId: number;
  openedByUsername: string;
  openedAt: Date;
  closedAt: Date | null;
  closedByAccountId: number | null;
  closedByUsername: string | null;
  /** Set when the system, not a person, ended the shift at the limit. */
  autoClosedAt: Date | null;
};

export interface CashierSessionRepository {
  open(input: {
    branchId: number;
    openedByAccountId: number;
    openedAt: Date;
  }): Promise<
    | { kind: 'success'; session: CashierSessionRecord }
    | { kind: 'already_open'; session: CashierSessionRecord }
  >;
  findOpenByBranch(branchId: number): Promise<CashierSessionRecord | null>;
  close(input: {
    branchId: number;
    closedByAccountId: number;
    closedAt: Date;
  }): Promise<
    | { kind: 'success'; session: CashierSessionRecord }
    | { kind: 'not_open' }
    | { kind: 'not_owner'; session: CashierSessionRecord }
  >;
  recoveryClose(input: {
    sessionId: number;
    closedByAccountId: number;
    closedAt: Date;
    reason: string;
  }): Promise<
    | { kind: 'success'; session: CashierSessionRecord }
    | { kind: 'not_found' }
    | { kind: 'already_closed'; session: CashierSessionRecord }
  >;
  /**
   * Ends every shift opened before the given instant, stamping each one at the
   * moment its own sixteen hours ran out, and signs the till out.
   */
  autoCloseExpired(input: { openedBefore: Date }): Promise<CashierSessionRecord[]>;
}

export type CashierSessionErrorCode =
  | 'ERP_CASHIER_SESSION_CASHIER_REQUIRED'
  | 'ERP_CASHIER_SESSION_ADMIN_REQUIRED'
  | 'ERP_CASHIER_SESSION_ALREADY_OPEN'
  | 'ERP_CASHIER_SESSION_NOT_OPEN'
  | 'ERP_CASHIER_SESSION_NOT_OWNER'
  | 'ERP_CASHIER_SESSION_NOT_FOUND'
  | 'ERP_CASHIER_SESSION_ALREADY_CLOSED'
  | 'ERP_CASHIER_SESSION_INVALID_RECOVERY_REASON';

export class CashierSessionError extends Error {
  constructor(
    public readonly code: CashierSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CashierSessionError';
  }
}

type BranchContextResolver = (
  actor: ErpAccountIdentity,
  requestedBranchId?: number,
) => Promise<ErpBranchContext>;

const requireCashier = (actor: ErpAccountIdentity) => {
  if (actor.role !== 'cashier') {
    throw new CashierSessionError(
      'ERP_CASHIER_SESSION_CASHIER_REQUIRED',
      'فتح وإغلاق وردية الكاشير العادية متاح للكاشير فقط',
    );
  }
  return actor;
};

export const createCashierSessionService = (dependencies: {
  repository: CashierSessionRepository;
  resolveBranchContext: BranchContextResolver;
  now?: () => Date;
}) => {
  const now = dependencies.now ?? (() => new Date());

  /**
   * Runs before every read and write of a shift so the answer never depends on
   * the background worker having got there first.
   */
  const closeExpired = () => dependencies.repository.autoCloseExpired({
    openedBefore: new Date(now().getTime() - CASHIER_SESSION_MAX_DURATION_MS),
  });

  return {
    closeExpired,

    async open(actor: ErpAccountIdentity) {
      const cashier = requireCashier(actor);
      const context = await dependencies.resolveBranchContext(cashier, undefined);
      await closeExpired();
      const result = await dependencies.repository.open({
        branchId: context.branchId,
        openedByAccountId: context.accountId,
        openedAt: now(),
      });
      if (result.kind === 'already_open') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_ALREADY_OPEN',
          'توجد وردية كاشير مفتوحة بالفعل لهذا الفرع',
        );
      }
      return result.session;
    },

    async current(actor: ErpAccountIdentity, requestedBranchId?: number) {
      const context = await dependencies.resolveBranchContext(actor, requestedBranchId);
      await closeExpired();
      return dependencies.repository.findOpenByBranch(context.branchId);
    },

    async close(actor: ErpAccountIdentity) {
      const cashier = requireCashier(actor);
      const context = await dependencies.resolveBranchContext(cashier, undefined);
      await closeExpired();
      const result = await dependencies.repository.close({
        branchId: context.branchId,
        closedByAccountId: context.accountId,
        closedAt: now(),
      });
      if (result.kind === 'not_open') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_NOT_OPEN',
          'لا توجد وردية كاشير مفتوحة لهذا الفرع',
        );
      }
      if (result.kind === 'not_owner') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_NOT_OWNER',
          'لا يمكن إغلاق وردية فتحها حساب كاشير آخر',
        );
      }
      return result.session;
    },

    async recoveryClose(actor: ErpAccountIdentity, sessionId: number, reason: string) {
      if (actor.role !== 'admin') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_ADMIN_REQUIRED',
          'الإغلاق الاستثنائي متاح للمسؤول فقط',
        );
      }
      const normalizedReason = reason.trim();
      if (!normalizedReason || normalizedReason.length > 1000) {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_INVALID_RECOVERY_REASON',
          normalizedReason ? 'سبب الإغلاق الاستثنائي طويل جدًا' : 'سبب الإغلاق الاستثنائي مطلوب',
        );
      }
      const result = await dependencies.repository.recoveryClose({
        sessionId,
        closedByAccountId: actor.accountId,
        closedAt: now(),
        reason: normalizedReason,
      });
      if (result.kind === 'not_found') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_NOT_FOUND',
          'وردية الكاشير غير موجودة',
        );
      }
      if (result.kind === 'already_closed') {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_ALREADY_CLOSED',
          'وردية الكاشير مغلقة بالفعل',
        );
      }
      return result.session;
    },
  };
};

export type CashierSessionService = ReturnType<typeof createCashierSessionService>;
