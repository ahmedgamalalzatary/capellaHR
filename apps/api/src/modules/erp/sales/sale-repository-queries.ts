import { type createDatabase } from '@capella/database';
import { clients, invoices } from '@capella/database/schema';
import { and, count, desc, eq, like, ne, or } from 'drizzle-orm';
import { hydrateInvoice } from './sale-repository-read.js';
import { SaleError, type SaleRepository } from './sale-service.js';

type Database = ReturnType<typeof createDatabase>;
type InvoiceEmployees = Map<number, Array<{ id: number; name: string }>>;

const asIso = (value: Date) => value.toISOString();

export const createSaleRepositoryQueries = (
  database: Database,
  listInvoiceEmployees: (invoiceIds: number[]) => Promise<InvoiceEmployees>,
): Pick<SaleRepository, 'listClientVisits' | 'listInvoices' | 'findInvoiceById'> => ({
  async listClientVisits(branchId, clientId, query) {
    const client = (await database.select({ id: clients.id }).from(clients).where(and(
      eq(clients.id, clientId),
      eq(clients.branchId, branchId),
    )).limit(1))[0];
    if (!client) throw new SaleError('CLIENT_NOT_FOUND');
    const where = and(
      eq(invoices.branchId, branchId),
      eq(invoices.clientId, clientId),
      ne(invoices.status, 'draft'),
    );
    const [{ total = 0 } = { total: 0 }] = await database.select({ total: count() })
      .from(invoices).where(where);
    const rows = await database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      soldAt: invoices.soldAt,
    }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const employeesByInvoice = await listInvoiceEmployees(rows.map(({ id }) => id));
    return {
      items: rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status as Exclude<typeof row.status, 'draft'>,
        total: row.total,
        employees: employeesByInvoice.get(row.id) ?? [],
        soldAt: asIso(row.soldAt),
      })),
      total,
    };
  },

  async listInvoices(branchId, query) {
    const escapedSearch = query.search?.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    const where = and(
      eq(invoices.branchId, branchId),
      ne(invoices.status, 'draft'),
      escapedSearch ? or(
        like(invoices.invoiceNumber, `%${escapedSearch}%`),
        like(invoices.clientNameSnapshot, `%${escapedSearch}%`),
        like(invoices.clientPhoneSnapshot, `%${escapedSearch}%`),
      ) : undefined,
    );
    const [{ total = 0 } = { total: 0 }] = await database.select({ total: count() })
      .from(invoices).where(where);
    const rows = await database.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      balanceDue: invoices.balanceDue,
      settlementStatus: invoices.settlementStatus,
      clientId: invoices.clientId,
      clientName: invoices.clientNameSnapshot,
      clientPhone: invoices.clientPhoneSnapshot,
      soldAt: invoices.soldAt,
    }).from(invoices).where(where).orderBy(desc(invoices.soldAt), desc(invoices.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const employeesByInvoice = await listInvoiceEmployees(rows.map(({ id }) => id));
    return {
      items: rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status as Exclude<typeof row.status, 'draft'>,
        total: row.total,
        amountPaid: row.amountPaid,
        balanceDue: row.balanceDue!,
        settlementStatus: row.settlementStatus,
        client: { id: row.clientId, name: row.clientName, phone: row.clientPhone },
        employees: employeesByInvoice.get(row.id) ?? [],
        soldAt: asIso(row.soldAt),
      })),
      total,
    };
  },

  async findInvoiceById(branchId, invoiceId) {
    const row = (await database.select({ id: invoices.id }).from(invoices).where(and(
      eq(invoices.id, invoiceId),
      eq(invoices.branchId, branchId),
      ne(invoices.status, 'draft'),
    )).limit(1))[0];
    return row ? hydrateInvoice(database, row.id) : null;
  },
});
