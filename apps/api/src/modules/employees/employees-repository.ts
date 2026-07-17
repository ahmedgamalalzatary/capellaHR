import { type createDatabase } from '@capella/database';
import { authSessions, branches, employeeCodeSequence, employeeImages, employeePhoneReservations, employees } from '@capella/database/schema';
import { and, asc, count, eq, isNull, like, max, ne, or, sql } from 'drizzle-orm';
import type { EmployeeImages, EmployeeRecord, EmployeeRepository, ImageKind } from './employees-service.js';
type Database = ReturnType<typeof createDatabase>;

const hydrate = async (db: Database | Parameters<Parameters<Database['transaction']>[0]>[0], employee: typeof employees.$inferSelect): Promise<EmployeeRecord> => {
  const files = await db.select().from(employeeImages).where(eq(employeeImages.employeeId, employee.id));
  return { ...employee, images: Object.fromEntries(files.map((file) => [file.kind, { storagePath: file.storagePath, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }])) as EmployeeImages };
};
export const createDrizzleEmployeeRepository = (database: Database, now: () => Date = () => new Date()): EmployeeRepository => ({
  async create(input) {
    return database.transaction(async (tx) => {
      await tx.insert(employeeCodeSequence).values({ id: 1, nextCode: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
      const sequence = await tx.select().from(employeeCodeSequence).where(eq(employeeCodeSequence.id, 1)).for('update');
      const highest = await tx.select({ value: max(employees.employeeCode) }).from(employees);
      const code = Math.max(sequence[0]!.nextCode, (highest[0]?.value ?? 0) + 1);
      await tx.update(employeeCodeSequence).set({ nextCode: code + 1 }).where(eq(employeeCodeSequence.id, 1));
      const createdAt = now(); const { images, ...fields } = input;
      const result = await tx.insert(employees).values({ ...fields, employeeCode: code, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      await tx.insert(employeePhoneReservations).values([...new Set([fields.personalPhone, fields.whatsappPhone])].map((phone) => ({ phone, employeeId: id })));
      await tx.insert(employeeImages).values((Object.entries(images) as [ImageKind, EmployeeImages[ImageKind]][]).map(([kind, image]) => ({ employeeId: id, kind, ...image, createdAt, updatedAt: createdAt })));
      await tx.update(branches).set({ hasEverBeenReferenced: true, updatedAt: createdAt }).where(eq(branches.id, fields.branchId));
      return hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
    });
  },
  async findActiveById(id) { const row = (await database.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).limit(1))[0]; return row ? hydrate(database, row) : null; },
  async findIdentityByCode(code) { const row = (await database.select().from(employees).where(eq(employees.employeeCode, code)).limit(1))[0]; return row ? { id: row.id, code: row.employeeCode, personalPhone: row.personalPhone, pinHash: row.pinHash, credentialVersion: row.credentialVersion, deletedAt: row.deletedAt } : null; },
  async findPhoneOwner(phone, excludeId) { const conditions = [eq(employeePhoneReservations.phone, phone)]; if (excludeId) conditions.push(ne(employeePhoneReservations.employeeId, excludeId)); return (await database.select({ id: employeePhoneReservations.employeeId }).from(employeePhoneReservations).where(and(...conditions)).limit(1))[0] ?? null; },
  async branchExists(id) { return Boolean((await database.select({ id: branches.id }).from(branches).where(eq(branches.id, id)).limit(1))[0]); },
  async list(query) {
    const filters = [isNull(employees.deletedAt)]; if (query.branchId) filters.push(eq(employees.branchId, query.branchId));
    if (query.search) { const pattern = `%${query.search}%`; filters.push(or(like(employees.fullName, pattern), like(employees.personalPhone, pattern), like(employees.whatsappPhone, pattern), sql`cast(${employees.employeeCode} as char) like ${pattern}`)!); }
    const where = and(...filters); const rows = await database.select().from(employees).where(where).orderBy(asc(employees.employeeCode)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(employees).where(where);
    return { items: await Promise.all(rows.map((row) => hydrate(database, row))), total: totals[0]?.value ?? 0 };
  },
  async update(id, changes, revokeSessions = false) {
    return database.transaction(async (tx) => {
      const current = (await tx.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1))[0]; if (!current) return null;
      const before = await hydrate(tx, current);
      const { images, ...fields } = changes;
      if (fields.personalPhone || fields.whatsappPhone) {
        const personalPhone = fields.personalPhone ?? current.personalPhone; const whatsappPhone = fields.whatsappPhone ?? current.whatsappPhone;
        await tx.delete(employeePhoneReservations).where(eq(employeePhoneReservations.employeeId, id));
        await tx.insert(employeePhoneReservations).values([...new Set([personalPhone, whatsappPhone])].map((phone) => ({ phone, employeeId: id })));
      }
      await tx.update(employees).set({ ...fields, ...(revokeSessions ? { credentialVersion: sql`${employees.credentialVersion} + 1` } : {}), updatedAt: now() }).where(and(eq(employees.id, id), isNull(employees.deletedAt)));
      if (revokeSessions) await tx.update(authSessions).set({ revokedAt: now() }).where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt)));
      if (images) for (const [kind, image] of Object.entries(images) as [ImageKind, EmployeeImages[ImageKind]][]) await tx.update(employeeImages).set({ ...image, updatedAt: now() }).where(and(eq(employeeImages.employeeId, id), eq(employeeImages.kind, kind)));
      const record = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
      const replacedImages = Object.fromEntries(Object.keys(images ?? {}).map((kind) => [kind, before.images[kind as ImageKind]])) as Partial<EmployeeImages>;
      return { record, replacedImages };
    });
  },
  async softDelete(id, revokeSessions) {
    return database.transaction(async (tx) => {
      await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1);
      const at = now(); const result = await tx.update(employees).set({ deletedAt: at, credentialVersion: sql`${employees.credentialVersion} + 1`, updatedAt: at }).where(and(eq(employees.id, id), isNull(employees.deletedAt)));
      if (result[0].affectedRows !== 1) return false;
      if (revokeSessions) await tx.update(authSessions).set({ revokedAt: at }).where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt)));
      return true;
    });
  },
});
