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

/** One drawer per payment method, always all four, in exact-cent strings. */
export type CashierSessionMoneyByMethod = {
  cash: string;
  visa: string;
  instapay: string;
  vodafone_cash: string;
};

const toMoneyCents = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

const fromMoneyCents = (value: bigint) => {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, '0')}`;
};

/** A shift with the money it moved, counted from the payment rows keyed to it. */
export type CashierSessionMoneyRecord = CashierSessionRecord & {
  saleCount: number;
  taken: CashierSessionMoneyByMethod;
  refunded: CashierSessionMoneyByMethod;
  takenTotal: string;
  refundedTotal: string;
  net: string;
};

export type CashierSessionSummaryRecord = CashierSessionMoneyRecord & {
  /** Elapsed so far while the shift is open, total once it has closed. */
  durationMinutes: number;
};

export type CashierSessionReportAccountingRecord = {
  sales: {
    gross: string;
    returns: string;
    total: string;
    discount: string;
    tax: string;
    net: string;
  };
  expenses: string;
  collectedPayments: string;
  creditSales: string;
};

export type CashierSessionInvoiceRecord = {
  id: number;
  invoiceNumber: string;
  status: 'completed' | 'partially_refunded' | 'refunded' | 'voided';
  client: { id: number; name: string | null; phone: string | null };
  total: string;
  takenInShift: string;
  refundedInShift: string;
  soldAt: Date;
};

export interface CashierSessionListQueryInput {
  page: number;
  pageSize: number;
  branchId?: number | undefined;
}

export interface CashierSessionRepository {
  list(input: {
    branchId: number;
    /** Set for a Cashier, who may only read the shifts they opened themselves. */
    openedByAccountId: number | undefined;
    page: number;
    pageSize: number;
  }): Promise<{ items: CashierSessionMoneyRecord[]; total: number }>;
  findMoneyById(sessionId: number): Promise<CashierSessionMoneyRecord | null>;
  readReportAccounting(input: {
    sessionId: number;
    branchId: number;
    openedAt: Date;
    closedAt: Date;
  }): Promise<CashierSessionReportAccountingRecord>;
  listInvoices(sessionId: number): Promise<CashierSessionInvoiceRecord[]>;
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
  | 'ERP_CASHIER_SESSION_NOT_CLOSED'
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

  const withDuration = (record: CashierSessionMoneyRecord): CashierSessionSummaryRecord => ({
    ...record,
    durationMinutes: Math.max(0, Math.floor(
      ((record.closedAt ?? now()).getTime() - record.openedAt.getTime()) / 60_000,
    )),
  });

  /**
   * A Cashier sees only the shifts they opened, and only in their own branch; an
   * Admin sees whatever branch they asked for.
   */
  const readable = async (actor: ErpAccountIdentity, sessionId: number) => {
    await closeExpired();
    const record = await dependencies.repository.findMoneyById(sessionId);
    if (!record) {
      throw new CashierSessionError('ERP_CASHIER_SESSION_NOT_FOUND', 'وردية الكاشير غير موجودة');
    }
    if (actor.role === 'cashier') {
      if (record.branchId !== actor.branchId) {
        throw new CashierSessionError('ERP_CASHIER_SESSION_NOT_FOUND', 'وردية الكاشير غير موجودة');
      }
      if (record.openedByAccountId !== actor.accountId) {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_NOT_OWNER',
          'لا يمكن عرض وردية فتحها حساب كاشير آخر',
        );
      }
    }
    return withDuration(record);
  };

  return {
    closeExpired,

    async list(actor: ErpAccountIdentity, query: CashierSessionListQueryInput) {
      const context = await dependencies.resolveBranchContext(actor, query.branchId);
      await closeExpired();
      const { items, total } = await dependencies.repository.list({
        branchId: context.branchId,
        openedByAccountId: actor.role === 'cashier' ? actor.accountId : undefined,
        page: query.page,
        pageSize: query.pageSize,
      });
      return { items: items.map(withDuration), total, page: query.page, pageSize: query.pageSize };
    },

    summary(actor: ErpAccountIdentity, sessionId: number) {
      return readable(actor, sessionId);
    },

    async detail(actor: ErpAccountIdentity, sessionId: number) {
      const summary = await readable(actor, sessionId);
      return { summary, invoices: await dependencies.repository.listInvoices(sessionId) };
    },

    async report(actor: ErpAccountIdentity, sessionId: number) {
      const summary = await readable(actor, sessionId);
      if (!summary.closedAt) {
        throw new CashierSessionError(
          'ERP_CASHIER_SESSION_NOT_CLOSED',
          'يجب إغلاق وردية الكاشير قبل عرض التقرير',
        );
      }
      const accounting = await dependencies.repository.readReportAccounting({
        sessionId,
        branchId: summary.branchId,
        openedAt: summary.openedAt,
        closedAt: summary.closedAt,
      });
      const netByMethod = Object.fromEntries(Object.keys(summary.taken).map((method) => [
        method,
        fromMoneyCents(
          toMoneyCents(summary.taken[method as keyof CashierSessionMoneyByMethod])
          - toMoneyCents(summary.refunded[method as keyof CashierSessionMoneyByMethod]),
        ),
      ])) as CashierSessionMoneyByMethod;
      return { summary, ...accounting, netByMethod };
    },

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
