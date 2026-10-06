import { type createDatabase } from '@capella/database';
import {
  accounts,
  authSessions,
  branches,
  cashierSessions,
  clients,
  erpBookingPayments,
  erpBookings,
  erpExpenses,
  invoicePayments,
  invoiceReversalPayments,
  invoiceReversals,
  invoices,
  serviceQueueEntries,
} from '@capella/database/schema';
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';

import { signedMoney } from './sale-repository-money.js';
import type { ErpAuditCapability } from '../hr-capabilities.js';
import {
  CASHIER_SESSION_MAX_DURATION_MS,
  type CashierSessionBookingMoneyBlock,
  type CashierSessionBookingMoneyLine,
  type CashierSessionInvoiceRecord,
  type CashierSessionMoneyByMethod,
  type CashierSessionMoneyRecord,
  type CashierSessionRecord,
  type CashierSessionReportAccountingRecord,
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


const paymentMethods = ['cash', 'visa', 'instapay', 'vodafone_cash'] as const;
const noMoney = (): CashierSessionMoneyByMethod => ({
  cash: '0.00', visa: '0.00', instapay: '0.00', vodafone_cash: '0.00',
});

const toCents = (value: string) => {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
};

const fromCents = (value: bigint) => {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, '0')}`;
};

const sumMethods = (money: CashierSessionMoneyByMethod) => paymentMethods
  .reduce((total, method) => total + toCents(money[method]), BigInt(0));

/**
 * Money is counted from the payment rows keyed to the shift, never from the
 * invoices raised in it: an invoice paid in instalments spends its money across
 * however many shifts took the instalments.
 */
const moneyBySession = async (executor: Executor, sessions: CashierSessionRecord[]) => {
  const sessionIds = sessions.map(({ id }) => id);
  const taken = new Map<number, CashierSessionMoneyByMethod>();
  const refunded = new Map<number, CashierSessionMoneyByMethod>();
  const saleCounts = new Map<number, number>();
  const expenses = new Map<number, bigint>();
  if (sessionIds.length === 0) return { taken, refunded, saleCounts, expenses };

  for (const id of sessionIds) {
    taken.set(id, noMoney());
    refunded.set(id, noMoney());
    saleCounts.set(id, 0);
    expenses.set(id, BigInt(0));
  }

  const takenRows = await executor.select({
    sessionId: invoicePayments.cashierSessionId,
    method: invoicePayments.method,
    amount: sql<string>`sum(${invoicePayments.amount})`,
  }).from(invoicePayments)
    .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(and(
      inArray(invoicePayments.cashierSessionId, sessionIds),
      eq(invoices.kind, 'sale'),
      // Held booking money was already taken at the booking; it is not drawer income.
      ne(invoicePayments.method, 'booking_credit'),
    ))
    .groupBy(invoicePayments.cashierSessionId, invoicePayments.method);
  for (const row of takenRows) {
    if (row.method !== 'booking_credit') taken.get(row.sessionId)![row.method] = row.amount;
  }

  // Up-front booking payments count in the drawers by the method they were taken on.
  const bookingPaymentRows = await executor.select({
    sessionId: erpBookingPayments.cashierSessionId,
    method: erpBookingPayments.method,
    amount: sql<string>`sum(${erpBookingPayments.amount})`,
  }).from(erpBookingPayments)
    .where(and(
      inArray(erpBookingPayments.cashierSessionId, sessionIds),
      eq(erpBookingPayments.kind, 'payment'),
    ))
    .groupBy(erpBookingPayments.cashierSessionId, erpBookingPayments.method);
  for (const row of bookingPaymentRows) {
    const drawer = taken.get(row.sessionId)!;
    drawer[row.method] = signedMoney(toCents(drawer[row.method]) + toCents(row.amount));
  }

  // Voids hand money back exactly as refunds do, so both count against the till.
  const refundedRows = await executor.select({
    sessionId: invoiceReversals.cashierSessionId,
    method: invoiceReversalPayments.methodSnapshot,
    amount: sql<string>`sum(${invoiceReversalPayments.cashAmount})`,
  }).from(invoiceReversalPayments)
    .innerJoin(invoiceReversals, eq(invoiceReversals.id, invoiceReversalPayments.reversalId))
    .where(and(
      inArray(invoiceReversals.cashierSessionId, sessionIds),
      eq(invoiceReversals.status, 'finalized'),
    ))
    .groupBy(invoiceReversals.cashierSessionId, invoiceReversalPayments.methodSnapshot);
  for (const row of refundedRows) refunded.get(row.sessionId!)![row.method] = row.amount;

  // Booking refunds leave the drawer on the method they were handed back on.
  const bookingRefundRows = await executor.select({
    sessionId: erpBookingPayments.cashierSessionId,
    method: erpBookingPayments.method,
    amount: sql<string>`sum(${erpBookingPayments.amount})`,
  }).from(erpBookingPayments)
    .where(and(
      inArray(erpBookingPayments.cashierSessionId, sessionIds),
      eq(erpBookingPayments.kind, 'refund'),
    ))
    .groupBy(erpBookingPayments.cashierSessionId, erpBookingPayments.method);
  for (const row of bookingRefundRows) {
    const drawer = refunded.get(row.sessionId)!;
    drawer[row.method] = signedMoney(toCents(drawer[row.method]) + toCents(row.amount));
  }

  // Sales are counted where they were rung up, which answers "how busy was this
  // shift" rather than "whose money was it".
  const saleRows = await executor.select({
    sessionId: invoices.cashierSessionId,
    count: sql<number>`count(*)`,
  }).from(invoices)
    .where(and(
      inArray(invoices.cashierSessionId, sessionIds),
      eq(invoices.kind, 'sale'),
    ))
    .groupBy(invoices.cashierSessionId);
  for (const row of saleRows) saleCounts.set(row.sessionId, Number(row.count));

  const expenseRows = await executor.select({
    branchId: erpExpenses.branchId,
    amount: erpExpenses.amount,
    kind: erpExpenses.kind,
    createdAt: erpExpenses.createdAt,
  }).from(erpExpenses).where(or(...sessions.map((session) => and(
    eq(erpExpenses.branchId, session.branchId),
    gte(erpExpenses.createdAt, session.openedAt),
    ...(session.closedAt ? [lt(erpExpenses.createdAt, session.closedAt)] : []),
  ))));
  for (const row of expenseRows) {
    const session = sessions.find((candidate) => candidate.branchId === row.branchId
      && row.createdAt >= candidate.openedAt
      && (candidate.closedAt === null || row.createdAt < candidate.closedAt));
    if (session) {
      const amount = toCents(row.amount) * (row.kind === 'reversal' ? BigInt(-1) : BigInt(1));
      expenses.set(session.id, expenses.get(session.id)! + amount);
    }
  }

  return { taken, refunded, saleCounts, expenses };
};

const withMoney = (
  sessions: CashierSessionRecord[],
  money: Awaited<ReturnType<typeof moneyBySession>>,
): CashierSessionMoneyRecord[] => sessions.map((session) => {
  const taken = money.taken.get(session.id) ?? noMoney();
  const refunded = money.refunded.get(session.id) ?? noMoney();
  const takenTotal = sumMethods(taken);
  const refundedTotal = sumMethods(refunded);
  const expenses = money.expenses.get(session.id) ?? BigInt(0);
  return {
    ...session,
    saleCount: money.saleCounts.get(session.id) ?? 0,
    taken,
    refunded,
    takenTotal: fromCents(takenTotal),
    refundedTotal: fromCents(refundedTotal),
    expenses: fromCents(expenses),
    net: fromCents(takenTotal - refundedTotal - expenses),
  };
});

const isDuplicateOpenError = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return false;
  const duplicate = (value: object) => 'code' in value && value.code === 'ER_DUP_ENTRY';
  const cause: unknown = 'cause' in error ? error.cause : undefined;
  return duplicate(error)
    || (typeof cause === 'object' && cause !== null && duplicate(cause));
};

const emptyBookingBlock = (): CashierSessionBookingMoneyBlock => ({ total: '0.00', lines: [] });

const bookingMoneyFor = async (
  executor: Executor,
  sessionIds: number[],
): Promise<{ payments: CashierSessionBookingMoneyBlock; refunds: CashierSessionBookingMoneyBlock }> => {
  if (sessionIds.length === 0) {
    return { payments: emptyBookingBlock(), refunds: emptyBookingBlock() };
  }
  const rows = await executor.select({
    bookingId: erpBookingPayments.bookingId,
    kind: erpBookingPayments.kind,
    method: erpBookingPayments.method,
    amount: erpBookingPayments.amount,
    at: erpBookingPayments.createdAt,
    clientId: clients.id,
    clientName: clients.fullName,
    clientPhone: clients.phone,
  }).from(erpBookingPayments)
    .innerJoin(erpBookings, eq(erpBookings.id, erpBookingPayments.bookingId))
    .innerJoin(clients, eq(clients.id, erpBookings.clientId))
    .where(inArray(erpBookingPayments.cashierSessionId, sessionIds))
    .orderBy(erpBookingPayments.createdAt, erpBookingPayments.id);
  const blocks = {
    payment: emptyBookingBlock(),
    refund: emptyBookingBlock(),
  };
  for (const row of rows) {
    const block = blocks[row.kind];
    block.lines.push({
      bookingId: row.bookingId,
      client: { id: row.clientId, name: row.clientName, phone: row.clientPhone },
      method: row.method,
      amount: row.amount,
      at: row.at,
    } satisfies CashierSessionBookingMoneyLine);
  }
  for (const block of Object.values(blocks)) {
    block.total = fromCents(block.lines.reduce(
      (total, line) => total + toCents(line.amount),
      BigInt(0),
    ));
  }
  return { payments: blocks.payment, refunds: blocks.refund };
};

// A shift cannot end while the branch still owes a booking resolution: an
// arrived client nobody handled, an appointment whose time has passed with
// services nobody sold or cancelled, or money held above what is still pending
// (a checkout discount or price change can leave that behind).
//
// The two halves are asked separately so each can start from an index. The first
// walks only the branch's still-open bookings, which the branch/status index
// narrows on its own. The second starts from this branch's booking ledger, so it
// only ever looks at bookings that took or gave back money at all, instead of
// every booking the branch has ever had.
const unresolvedWaitingCount = (executor: Transaction, input: {
  branchId: number;
  closedAt: Date;
}) => executor.select({ value: sql<number>`count(*)` }).from(erpBookings).where(and(
  eq(erpBookings.branchId, input.branchId),
  inArray(erpBookings.status, ['booked', 'arrived']),
  sql`exists (
    select 1 from erp_booking_services pending
    where pending.booking_id = ${erpBookings.id} and pending.status = 'pending'
  )`,
  sql`(${erpBookings.status} = 'arrived' or ${erpBookings.scheduledAt} <= ${input.closedAt})`,
));

const moneyHoldingUnresolvedCount = (executor: Transaction, input: { branchId: number }) => (
  executor.select({ value: sql<number>`count(*)` }).from(sql`
    (
      select p.booking_id
      from erp_booking_payments p
      join erp_bookings b on b.id = p.booking_id and b.branch_id = p.branch_id
      where p.branch_id = ${input.branchId}
        -- A booking the waiting half already counts must not be counted twice.
        and not (
          b.status in ('booked', 'arrived')
          and exists (
            select 1 from erp_booking_services waiting
            where waiting.booking_id = p.booking_id and waiting.status = 'pending'
          )
        )
      group by p.booking_id
      having sum(case when p.kind = 'payment' then p.amount else -p.amount end)
        - (select coalesce(sum(ip.amount), 0)
          from erp_invoice_payments ip where ip.booking_id = p.booking_id)
        > (select coalesce(sum(s.price), 0)
          from erp_booking_services pending
          join erp_services s on s.id = pending.service_id
          where pending.booking_id = p.booking_id and pending.status = 'pending')
    ) holders
  `)
);

const unresolvedBookingsCount = async (executor: Transaction, input: {
  branchId: number;
  closedAt: Date;
}) => {
  const [waiting] = await unresolvedWaitingCount(executor, input);
  const [holding] = await moneyHoldingUnresolvedCount(executor, input);
  return Number(waiting?.value ?? 0) + Number(holding?.value ?? 0);
};

export const createDrizzleCashierSessionRepository = (
  database: Database,
  audit: ErpAuditCapability,
): CashierSessionRepository => ({
  async list(input) {
    const scope = and(
      eq(cashierSessions.branchId, input.branchId),
      ...(input.openedByAccountId === undefined
        ? []
        : [eq(cashierSessions.openedByAccountId, input.openedByAccountId)]),
    );
    const rows = await database.select(sessionFields).from(cashierSessions)
      .innerJoin(branches, eq(branches.id, cashierSessions.branchId))
      .innerJoin(openedAccounts, eq(openedAccounts.id, cashierSessions.openedByAccountId))
      .leftJoin(closedAccounts, eq(closedAccounts.id, cashierSessions.closedByAccountId))
      .where(scope)
      // Newest first: the shift a Cashier just closed is the one they look for.
      .orderBy(desc(cashierSessions.openedAt), desc(cashierSessions.id))
      .limit(input.pageSize).offset((input.page - 1) * input.pageSize);
    const [counted] = await database.select({ total: sql<number>`count(*)` })
      .from(cashierSessions).where(scope);
    const money = await moneyBySession(database, rows);
    return { items: withMoney(rows, money), total: Number(counted?.total ?? 0) };
  },

  async findMoneyById(sessionId) {
    const session = await findById(database, sessionId);
    if (!session) return null;
    return withMoney([session], await moneyBySession(database, [session]))[0]!;
  },

  async readReportAccounting(input) {
    const [salesRow] = await database.select({
      gross: sql<string>`coalesce(sum(${invoices.subtotal}), 0)`,
      discount: sql<string>`coalesce(sum(${invoices.discountAmount}), 0)`,
      tax: sql<string>`coalesce(sum(${invoices.taxAmount}), 0)`,
      creditSales: sql<string>`coalesce(sum(
        ${invoices.total} - ${invoices.creditedAmount} - coalesce((
          select sum(p.amount) from erp_invoice_payments p
          where p.invoice_id = ${invoices.id} and p.is_initial = true
        ), 0)
      ), 0)`,
    }).from(invoices).where(and(
      eq(invoices.cashierSessionId, input.sessionId),
      eq(invoices.kind, 'sale'),
    ));

    const [returnsRow] = await database.select({
      gross: sql<string>`coalesce(sum(${invoiceReversals.grossAmount}), 0)`,
      discount: sql<string>`coalesce(sum(${invoiceReversals.discountAmount}), 0)`,
      tax: sql<string>`coalesce(sum(${invoiceReversals.taxAmount}), 0)`,
    }).from(invoiceReversals).where(and(
      eq(invoiceReversals.cashierSessionId, input.sessionId),
      eq(invoiceReversals.status, 'finalized'),
    ));

    const [expenseRow] = await database.select({
      amount: sql<string>`coalesce(sum(case
        when ${erpExpenses.kind} = 'reversal' then -${erpExpenses.amount}
        else ${erpExpenses.amount}
      end), 0)`,
    }).from(erpExpenses).where(and(
      eq(erpExpenses.branchId, input.branchId),
      gte(erpExpenses.createdAt, input.openedAt),
      lt(erpExpenses.createdAt, input.closedAt),
    ));

    const [collectedRow] = await database.select({
      amount: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)`,
    }).from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(and(
        eq(invoicePayments.cashierSessionId, input.sessionId),
        eq(invoicePayments.isInitial, false),
        eq(invoices.kind, 'sale'),
      ));
    const collectedPaymentLines = await database.select({
      invoiceNumber: invoices.invoiceNumber,
      clientId: invoices.clientId,
      clientName: invoices.clientNameSnapshot,
      clientPhone: invoices.clientPhoneSnapshot,
      method: invoicePayments.method,
      amount: invoicePayments.amount,
      paidAt: invoicePayments.paidAt,
    }).from(invoicePayments)
      .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(and(
        eq(invoicePayments.cashierSessionId, input.sessionId),
        eq(invoicePayments.isInitial, false),
        eq(invoices.kind, 'sale'),
        ne(invoicePayments.method, 'booking_credit'),
      ))
      .orderBy(invoicePayments.paidAt, invoicePayments.id);

    const gross = toCents(salesRow?.gross ?? '0.00');
    const returns = toCents(returnsRow?.gross ?? '0.00');
    const discount = toCents(salesRow?.discount ?? '0.00')
      - toCents(returnsRow?.discount ?? '0.00');
    const tax = toCents(salesRow?.tax ?? '0.00') - toCents(returnsRow?.tax ?? '0.00');
    const total = gross - returns;
    const bookingMoney = await bookingMoneyFor(database, [input.sessionId]);
    return {
      sales: {
        gross: fromCents(gross),
        returns: fromCents(returns),
        total: fromCents(total),
        discount: fromCents(discount),
        tax: fromCents(tax),
        net: fromCents(total - discount + tax),
      },
      expenses: fromCents(toCents(expenseRow?.amount ?? '0.00')),
      collectedPayments: fromCents(toCents(collectedRow?.amount ?? '0.00')),
      collectedPaymentLines: collectedPaymentLines
        .filter((payment): payment is typeof payment & { method: 'cash' | 'visa' | 'instapay' | 'vodafone_cash' } => payment.method !== 'booking_credit')
        .map((payment) => ({
        invoiceNumber: payment.invoiceNumber,
        client: { id: payment.clientId, name: payment.clientName, phone: payment.clientPhone },
        method: payment.method,
        amount: payment.amount,
        paidAt: payment.paidAt,
      })),
      creditSales: fromCents(toCents(salesRow?.creditSales ?? '0.00')),
      bookingPayments: bookingMoney.payments,
      bookingRefunds: bookingMoney.refunds,
    } satisfies CashierSessionReportAccountingRecord;
  },

  async listInvoices(sessionId) {
    // An invoice belongs to a shift's list when the shift rang it up, took money
    // on it, or handed money back on it -- three different things once an
    // invoice can be paid across shifts.
    // Written out rather than interpolated: drizzle drops the table qualifier
    // from a column used inside a selected expression, which reads as ambiguous.
    const invoiceId = sql`\`erp_invoices\`.\`id\``;
    // Held booking money is not drawer income, so it never counts as taken here.
    const takenInShift = sql<string | null>`(
      select sum(p.amount) from erp_invoice_payments p
      where p.invoice_id = ${invoiceId} and p.cashier_session_id = ${sessionId}
        and p.method <> 'booking_credit'
    )`;
    const refundedInShift = sql<string | null>`(
      select sum(rp.amount) from erp_invoice_reversal_payments rp
      join erp_invoice_reversals r on r.id = rp.reversal_id
      where r.invoice_id = ${invoiceId} and r.status = 'finalized'
        and r.cashier_session_id = ${sessionId}
    )`;
    const rows = await database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      clientId: invoices.clientId,
      clientName: invoices.clientNameSnapshot,
      clientPhone: invoices.clientPhoneSnapshot,
      total: invoices.total,
      soldAt: invoices.soldAt,
      takenInShift,
      refundedInShift,
    }).from(invoices).where(and(
      eq(invoices.kind, 'sale'),
      sql`(
      ${invoices.cashierSessionId} = ${sessionId}
      or exists (
        select 1 from erp_invoice_payments p
        where p.invoice_id = ${invoices.id} and p.cashier_session_id = ${sessionId}
      )
      or exists (
        select 1 from erp_invoice_reversals r
        where r.invoice_id = ${invoices.id} and r.status = 'finalized'
          and r.cashier_session_id = ${sessionId}
      )
    )`,
    )).orderBy(desc(invoices.soldAt), desc(invoices.id));

    return rows.map((row): CashierSessionInvoiceRecord => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.status as CashierSessionInvoiceRecord['status'],
      client: { id: row.clientId, name: row.clientName, phone: row.clientPhone },
      total: row.total,
      takenInShift: row.takenInShift ?? '0.00',
      refundedInShift: row.refundedInShift ?? '0.00',
      soldAt: row.soldAt,
    }));
  },

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

  bookingMoney(sessionId) {
    return bookingMoneyFor(database, [sessionId]);
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
      const unfinished = await transaction.select({ value: sql<number>`count(*)` })
        .from(serviceQueueEntries).where(and(
          eq(serviceQueueEntries.cashierSessionId, current.id),
          inArray(serviceQueueEntries.status, ['pending', 'in_progress', 'overdue']),
        ));
      const unfinishedCount = Number(unfinished[0]?.value ?? 0);
      if (unfinishedCount > 0) return { kind: 'unfinished_services' as const, count: unfinishedCount };
      const unresolvedCount = await unresolvedBookingsCount(transaction, {
        branchId: input.branchId,
        closedAt: input.closedAt,
      });
      if (unresolvedCount > 0) return { kind: 'unresolved_bookings' as const, count: unresolvedCount };
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
        await transaction.update(serviceQueueEntries).set({ status: 'overdue' }).where(and(
          eq(serviceQueueEntries.cashierSessionId, current.id),
          inArray(serviceQueueEntries.status, ['pending', 'in_progress']),
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
      await transaction.update(serviceQueueEntries).set({ status: 'overdue' }).where(and(
        eq(serviceQueueEntries.cashierSessionId, current.id),
        inArray(serviceQueueEntries.status, ['pending', 'in_progress']),
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
