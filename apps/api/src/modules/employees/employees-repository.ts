import { type createDatabase } from '@capella/database';
import { authSessions, branches, employeeBranchAssignments, employeeCodeSequence, employeeEmploymentPeriods, employeeImages, employeePendingDeactivations, employeePhoneReservations, employees } from '@capella/database/schema';
import { and, asc, count, eq, isNull, max, ne, or, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/index.js';
import type { EmployeeDeactivationDecisions, EmployeeImages, EmployeeRecord, EmployeeRepository, ImageKind } from './employees-service.js';
type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type EmployeeBeforeDurationChange = (
  employeeId: number,
  previousDurationMinutes: number,
  context: Transaction,
) => Promise<unknown>;

const hydrate = async (db: Database | Parameters<Parameters<Database['transaction']>[0]>[0], employee: typeof employees.$inferSelect): Promise<EmployeeRecord> => {
  const files = await db.select().from(employeeImages).where(eq(employeeImages.employeeId, employee.id));
  return { ...employee, images: Object.fromEntries(files.map((file) => [file.kind, { storagePath: file.storagePath, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes }])) };
};
/**
 * The irreversible half of a deactivation, shared by the immediate path and the replay that runs
 * when a checked-in employee finally clocks out, so both settle money and credentials identically.
 */
const commitDeactivation = async (
  tx: Transaction,
  current: typeof employees.$inferSelect,
  at: Date,
  decisions: EmployeeDeactivationDecisions,
  prepareFinancials?: (
    id: number, at: Date, decisions: EmployeeDeactivationDecisions, context: Transaction,
  ) => Promise<void>,
) => {
  const id = current.id;
  const before = await hydrate(tx, current);
  if (prepareFinancials) await prepareFinancials(id, at, decisions, tx);
  await tx.update(employeeEmploymentPeriods).set({ activeTo: at })
    .where(and(eq(employeeEmploymentPeriods.employeeId, id), isNull(employeeEmploymentPeriods.activeTo)));
  // Inactive employees are only filtered out of session lookups, so without bumping the
  // credential version a later reactivation would make pre-deactivation tokens valid again.
  const sessions = await tx.select({ id: authSessions.id }).from(authSessions)
    .where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt))).for('update');
  await tx.update(employees)
    .set({ employmentStatus: 'inactive', credentialVersion: sql`${employees.credentialVersion} + 1`, updatedAt: at })
    .where(eq(employees.id, id));
  await tx.update(authSessions).set({ revokedAt: at })
    .where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt)));
  for (const session of sessions) await writeAudit(tx, {
    module: 'auth', action: 'session_revoke', entityType: 'session', entityId: session.id,
    relatedIds: { employeeId: id }, createdAt: at,
  });
  const record = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
  await writeAudit(tx, {
    module: 'employees', action: 'deactivate', entityType: 'employee', entityId: id,
    beforeState: before,
    afterState: {
      ...record,
      advanceDecision: decisions.advanceDecision,
      negativeBalanceDecision: decisions.negativeBalanceDecision ?? null,
    },
    relatedIds: { branchId: current.branchId }, createdAt: at,
  });
  return record;
};

export const createDrizzleEmployeeRepository = (
  database: Database,
  now: () => Date = () => new Date(),
  beforeDurationChange?: EmployeeBeforeDurationChange,
): EmployeeRepository => ({
  async create(input) {
    return database.transaction(async (tx) => {
      const branch = await tx.select({
        id: branches.id,
        hasEverBeenReferenced: branches.hasEverBeenReferenced,
      }).from(branches)
        .where(eq(branches.id, input.branchId)).for('update').limit(1);
      if (!branch[0]) return 'branch_not_found' as const;
      await tx.insert(employeeCodeSequence).values({ id: 1, nextCode: 1 }).onDuplicateKeyUpdate({ set: { id: 1 } });
      const sequence = await tx.select().from(employeeCodeSequence).where(eq(employeeCodeSequence.id, 1)).for('update');
      const highest = await tx.select({ value: max(employees.employeeCode) }).from(employees);
      const code = Math.max(sequence[0]!.nextCode, (highest[0]?.value ?? 0) + 1);
      await tx.update(employeeCodeSequence).set({ nextCode: code + 1 }).where(eq(employeeCodeSequence.id, 1));
      const createdAt = now(); const { images, ...fields } = input;
      const result = await tx.insert(employees).values({ ...fields, employeeCode: code, createdAt, updatedAt: createdAt });
      const id = Number(result[0].insertId);
      await tx.insert(employeePhoneReservations).values([...new Set([fields.personalPhone, fields.whatsappPhone])].map((phone) => ({ phone, employeeId: id })));
      const imageValues = (Object.entries(images) as [ImageKind, NonNullable<EmployeeImages[ImageKind]>][])
        .map(([kind, image]) => ({ employeeId: id, kind, ...image, createdAt, updatedAt: createdAt }));
      if (imageValues.length > 0) await tx.insert(employeeImages).values(imageValues);
      await tx.insert(employeeBranchAssignments).values({ employeeId: id, branchId: fields.branchId, effectiveFrom: createdAt, createdAt });
      await tx.insert(employeeEmploymentPeriods).values({ employeeId: id, activeFrom: createdAt, createdAt });
      await tx.update(branches).set({ hasEverBeenReferenced: true, updatedAt: createdAt }).where(eq(branches.id, fields.branchId));
      if (!branch[0].hasEverBeenReferenced) {
        await writeAudit(tx, {
          module: 'branches', action: 'reference_lock', entityType: 'branch', entityId: fields.branchId,
          beforeState: { hasEverBeenReferenced: false }, afterState: { hasEverBeenReferenced: true },
          relatedIds: { employeeId: id }, createdAt,
        });
      }
      const record = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
      await writeAudit(tx, {
        module: 'employees', action: 'create', entityType: 'employee', entityId: id,
        afterState: record, relatedIds: { branchId: fields.branchId }, createdAt,
      });
      return record;
    });
  },
  async findActiveById(id) { const row = (await database.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).limit(1))[0]; return row ? hydrate(database, row) : null; },
  async findIdentityByCode(code) { const row = (await database.select().from(employees).where(eq(employees.employeeCode, code)).limit(1))[0]; return row ? { id: row.id, code: row.employeeCode, personalPhone: row.personalPhone, pinHash: row.pinHash, credentialVersion: row.credentialVersion, employmentStatus: row.employmentStatus, deletedAt: row.deletedAt } : null; },
  async findPhoneOwner(phone, excludeId) { const conditions = [eq(employeePhoneReservations.phone, phone)]; if (excludeId) conditions.push(ne(employeePhoneReservations.employeeId, excludeId)); return (await database.select({ id: employeePhoneReservations.employeeId }).from(employeePhoneReservations).where(and(...conditions)).limit(1))[0] ?? null; },
  async branchExists(id) { return Boolean((await database.select({ id: branches.id }).from(branches).where(eq(branches.id, id)).limit(1))[0]); },
  async list(query) {
    const filters = [isNull(employees.deletedAt)]; if (query.branchId) filters.push(eq(employees.branchId, query.branchId));
    if (query.status !== 'all') filters.push(eq(employees.employmentStatus, query.status ?? 'active'));
    if (query.search) { filters.push(or(sql`locate(${query.search}, ${employees.fullName}) > 0`, sql`locate(${query.search}, ${employees.personalPhone}) > 0`, sql`locate(${query.search}, ${employees.whatsappPhone}) > 0`, sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`)!); }
    const where = and(...filters); const rows = await database.select().from(employees).where(where).orderBy(asc(employees.employeeCode)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const totals = await database.select({ value: count() }).from(employees).where(where);
    return { items: await Promise.all(rows.map((row) => hydrate(database, row))), total: totals[0]?.value ?? 0 };
  },
  async update(id, changes, revokeSessions = false, hasOpenSession) {
    return database.transaction(async (tx) => {
      const current = (await tx.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1))[0]; if (!current) return null;
      const before = await hydrate(tx, current);
      const { images, ...fields } = changes;
      const updatedAt = now();
      const branchChanged = fields.branchId !== undefined && fields.branchId !== current.branchId;
      if (branchChanged) {
        const destination = (await tx.select({
          id: branches.id,
          hasEverBeenReferenced: branches.hasEverBeenReferenced,
        }).from(branches).where(eq(branches.id, fields.branchId!)).for('update').limit(1))[0];
        if (!destination) return 'branch_not_found' as const;
        if (!hasOpenSession || await hasOpenSession(id, tx)) return 'checked_in' as const;
        await tx.update(employeeBranchAssignments).set({ effectiveTo: updatedAt })
          .where(and(eq(employeeBranchAssignments.employeeId, id), isNull(employeeBranchAssignments.effectiveTo)));
        await tx.insert(employeeBranchAssignments).values({
          employeeId: id, branchId: fields.branchId!, effectiveFrom: updatedAt, createdAt: updatedAt,
        });
        await tx.update(branches).set({ hasEverBeenReferenced: true, updatedAt })
          .where(eq(branches.id, fields.branchId!));
        if (!destination.hasEverBeenReferenced) await writeAudit(tx, {
          module: 'branches', action: 'reference_lock', entityType: 'branch', entityId: fields.branchId!,
          beforeState: { hasEverBeenReferenced: false }, afterState: { hasEverBeenReferenced: true },
          relatedIds: { employeeId: id }, createdAt: updatedAt,
        });
      }
      if (fields.shiftDurationMinutes !== undefined
        && fields.shiftDurationMinutes !== current.shiftDurationMinutes) {
        await beforeDurationChange?.(id, current.shiftDurationMinutes, tx);
      }
      if (fields.personalPhone || fields.whatsappPhone) {
        const personalPhone = fields.personalPhone ?? current.personalPhone; const whatsappPhone = fields.whatsappPhone ?? current.whatsappPhone;
        await tx.delete(employeePhoneReservations).where(eq(employeePhoneReservations.employeeId, id));
        await tx.insert(employeePhoneReservations).values([...new Set([personalPhone, whatsappPhone])].map((phone) => ({ phone, employeeId: id })));
      }
      const sessions = revokeSessions
        ? await tx.select({ id: authSessions.id }).from(authSessions)
          .where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt))).for('update')
        : [];
      await tx.update(employees).set({ ...fields, ...(revokeSessions ? { credentialVersion: sql`${employees.credentialVersion} + 1` } : {}), updatedAt }).where(and(eq(employees.id, id), isNull(employees.deletedAt)));
      if (revokeSessions) await tx.update(authSessions).set({ revokedAt: updatedAt }).where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt)));
      for (const session of sessions) await writeAudit(tx, {
        module: 'auth', action: 'session_revoke', entityType: 'session', entityId: session.id,
        relatedIds: { employeeId: id }, createdAt: updatedAt,
      });
      if (images) for (const [kind, image] of Object.entries(images) as [ImageKind, EmployeeImages[ImageKind]][]) await tx.update(employeeImages).set({ ...image, updatedAt }).where(and(eq(employeeImages.employeeId, id), eq(employeeImages.kind, kind)));
      const record = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
      const replacedImages = Object.fromEntries(Object.keys(images ?? {}).map((kind) => [kind, before.images[kind as ImageKind]])) as Partial<EmployeeImages>;
      await writeAudit(tx, {
        module: 'employees', action: branchChanged ? 'branch_reassign' : revokeSessions ? 'pin_reset' : 'update',
        entityType: 'employee', entityId: id,
        beforeState: before, afterState: record,
        relatedIds: branchChanged
          ? { previousBranchId: before.branchId, branchId: record.branchId }
          : { branchId: record.branchId },
        createdAt: updatedAt,
      });
      return { record, replacedImages };
    });
  },
  async softDeleteIfAttendanceClosed(id, revokeSessions, hasOpenSession, cleanupDevices, prepareFinancials) {
    return database.transaction(async (tx) => {
      const current = await tx.select().from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1);
      if (!current[0]) return 'not_found';
      const before = await hydrate(tx, current[0]);
      if (await hasOpenSession(id, tx)) return 'checked_in';
      const at = now();
      if (prepareFinancials) await prepareFinancials(id, at, tx);
      await tx.update(employeeEmploymentPeriods).set({ activeTo: at })
        .where(and(eq(employeeEmploymentPeriods.employeeId, id), isNull(employeeEmploymentPeriods.activeTo)));
      const result = await tx.update(employees).set({ deletedAt: at, credentialVersion: sql`${employees.credentialVersion} + 1`, updatedAt: at }).where(and(eq(employees.id, id), isNull(employees.deletedAt)));
      if (result[0].affectedRows !== 1) return 'not_found';
      await tx.delete(employeePhoneReservations).where(eq(employeePhoneReservations.employeeId, id));
      const sessions = revokeSessions
        ? await tx.select({ id: authSessions.id }).from(authSessions)
          .where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt))).for('update')
        : [];
      if (revokeSessions) await tx.update(authSessions).set({ revokedAt: at }).where(and(eq(authSessions.employeeId, id), isNull(authSessions.revokedAt)));
      for (const session of sessions) await writeAudit(tx, {
        module: 'auth', action: 'session_revoke', entityType: 'session', entityId: session.id,
        relatedIds: { employeeId: id }, createdAt: at,
      });
      if (cleanupDevices) await cleanupDevices(id, tx);
      const after = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
      await writeAudit(tx, {
        module: 'employees', action: 'delete', entityType: 'employee', entityId: id,
        beforeState: before, afterState: after,
        relatedIds: { branchId: before.branchId }, createdAt: at,
      });
      return 'deleted';
    });
  },
  async previewDeactivation(id) {
    const employee = (await database.select({
      id: employees.id,
      employmentStatus: employees.employmentStatus,
    }).from(employees).where(and(eq(employees.id, id), isNull(employees.deletedAt))).limit(1))[0];
    if (!employee) return { kind: 'not_found' };
    if (employee.employmentStatus === 'inactive') return { kind: 'already_inactive' };
    // Eligibility only: the amounts come from the financial lifecycle, which can see payroll.
    return { kind: 'success' };
  },
  deactivate(id, input, prepareFinancials, hasOpenSession) {
    return database.transaction(async (tx) => {
      const current = (await tx.select().from(employees)
        .where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1))[0];
      if (!current) return { kind: 'not_found' as const };
      if (current.employmentStatus === 'inactive') return { kind: 'already_inactive' as const };
      const at = now();
      if (hasOpenSession && await hasOpenSession(id, tx)) {
        // Deliberately does not touch employment state: he finishes the shift he is on, and the
        // amounts are recomputed at check-out because that shift can still move them.
        await tx.insert(employeePendingDeactivations).values({
          employeeId: id,
          advanceDecision: input.advanceDecision,
          negativeBalanceDecision: input.negativeBalanceDecision ?? null,
          requestedAt: at,
          createdAt: at,
        }).onDuplicateKeyUpdate({
          set: {
            advanceDecision: input.advanceDecision,
            negativeBalanceDecision: input.negativeBalanceDecision ?? null,
            requestedAt: at,
          },
        });
        await writeAudit(tx, {
          module: 'employees', action: 'deactivate_scheduled', entityType: 'employee', entityId: id,
          afterState: {
            advanceDecision: input.advanceDecision,
            negativeBalanceDecision: input.negativeBalanceDecision ?? null,
          },
          relatedIds: { branchId: current.branchId }, createdAt: at,
        });
        return { kind: 'pending' as const, record: await hydrate(tx, current) };
      }
      return { kind: 'success' as const, record: await commitDeactivation(tx, current, at, input, prepareFinancials) };
    });
  },
  async applyPendingDeactivation(id, at, transactionContext, prepareFinancials) {
    const tx = transactionContext as Transaction;
    const pending = (await tx.select().from(employeePendingDeactivations)
      .where(eq(employeePendingDeactivations.employeeId, id)).for('update').limit(1))[0];
    if (!pending) return false;
    const current = (await tx.select().from(employees)
      .where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1))[0];
    if (!current || current.employmentStatus === 'inactive') {
      await tx.delete(employeePendingDeactivations)
        .where(eq(employeePendingDeactivations.employeeId, id));
      return false;
    }
    const decisions: EmployeeDeactivationDecisions = {
      advanceDecision: pending.advanceDecision,
      ...(pending.negativeBalanceDecision === null
        ? {}
        : { negativeBalanceDecision: pending.negativeBalanceDecision }),
    };
    try {
      // A savepoint, because this replay is a passenger on the employee's check-out: a payroll
      // month finalized since the request must not stop them from clocking out.
      // Replayed without expectations: the shift that just ended is exactly what the admin was
      // warned could move the amounts, so re-checking them here would only ever fail.
      await tx.transaction((nested) => commitDeactivation(nested, current, at, decisions, prepareFinancials));
    }
    catch (error) {
      // The row survives so the next close — or a retried deactivation — can settle it.
      await writeAudit(tx, {
        module: 'employees', action: 'deactivate_deferred_failed', entityType: 'employee', entityId: id,
        afterState: {
          ...decisions,
          negativeBalanceDecision: decisions.negativeBalanceDecision ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
        relatedIds: { branchId: current.branchId }, createdAt: at,
      });
      return false;
    }
    await tx.delete(employeePendingDeactivations)
      .where(eq(employeePendingDeactivations.employeeId, id));
    return true;
  },
  activate(id) {
    return database.transaction(async (tx) => {
      const current = (await tx.select().from(employees)
        .where(and(eq(employees.id, id), isNull(employees.deletedAt))).for('update').limit(1))[0];
      if (!current) return { kind: 'not_found' as const };
      if (current.employmentStatus === 'active') return { kind: 'already_active' as const };
      const at = now();
      await tx.insert(employeeEmploymentPeriods).values({ employeeId: id, activeFrom: at, createdAt: at });
      await tx.update(employees).set({ employmentStatus: 'active', updatedAt: at })
        .where(eq(employees.id, id));
      const record = await hydrate(tx, (await tx.select().from(employees).where(eq(employees.id, id)).limit(1))[0]!);
      await writeAudit(tx, {
        module: 'employees', action: 'activate', entityType: 'employee', entityId: id,
        beforeState: await hydrate(tx, current), afterState: record,
        relatedIds: { branchId: current.branchId }, createdAt: at,
      });
      return { kind: 'success' as const, record };
    });
  },
});
