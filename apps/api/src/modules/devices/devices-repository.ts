import type { createDatabase } from '@capella/database';
import { branches, deviceHistory, devicePairingRequests, devices, employees } from '@capella/database/schema';
import { and, asc, count, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/index.js';
import type { DeviceRepository, PublicDevice } from './devices-service.js';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

const publicDevice = (row: typeof devices.$inferSelect, assignmentName: string | null = null): PublicDevice => ({
  id: row.id,
  assignmentType: row.assignmentType,
  assignmentId: row.assignmentType === 'employee' ? row.employeeId! : row.branchId!,
  assignmentName,
  status: row.status,
  browser: row.browser,
  platform: row.platform,
  pairedAt: row.pairedAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
});

const findPublicDevice = async (executor: Executor, id: number): Promise<PublicDevice | null> => {
  const result = (await executor.select({ ...getTableColumns(devices), employeeName: employees.fullName, branchName: branches.name })
    .from(devices)
    .leftJoin(employees, eq(devices.employeeId, employees.id))
    .leftJoin(branches, eq(devices.branchId, branches.id))
    .where(eq(devices.id, id))
    .limit(1))[0];
  if (!result) return null;
  const { employeeName, branchName, ...row } = result;
  return publicDevice(row, employeeName ?? branchName);
};

const duplicate = (error: unknown) => typeof error === 'object' && error !== null
  && (Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
    || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY');
const assignmentFilter = (type: 'employee' | 'branch', id: number) => type === 'employee'
  ? eq(devices.employeeId, id)
  : eq(devices.branchId, id);

export const createDeviceLoginEligibility = () => ({
  isActiveEmployeeDevice: async (deviceId: number, employeeId: number, context: unknown) => {
    const transaction = context as Transaction;
    return (await transaction.select({ id: devices.id }).from(devices).where(and(
      eq(devices.id, deviceId),
      eq(devices.assignmentType, 'employee'),
      eq(devices.employeeId, employeeId),
      eq(devices.status, 'active'),
    )).for('update').limit(1))[0] !== undefined;
  },
});

export const createDrizzleDeviceRepository = (database: Database, now: () => Date = () => new Date()): DeviceRepository => ({
  async assignmentExists(input) {
    if (input.assignmentType === 'branch') return Boolean((await database.select({ id: branches.id }).from(branches).where(eq(branches.id, input.assignmentId)).limit(1))[0]);
    return Boolean((await database.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.assignmentId), isNull(employees.deletedAt))).limit(1))[0]);
  },
  async createPairing(input) {
    return database.transaction(async (tx) => {
      if (input.assignmentType === 'employee') {
        const employee = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.assignmentId), isNull(employees.deletedAt))).for('update').limit(1);
        if (!employee[0]) return 'assignment_not_found' as const;
      } else {
        const branch = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, input.assignmentId)).for('update').limit(1);
        if (!branch[0]) return 'assignment_not_found' as const;
      }
      const target = input.assignmentType === 'employee'
        ? eq(devicePairingRequests.employeeId, input.assignmentId)
        : eq(devicePairingRequests.branchId, input.assignmentId);
      const pending = await tx.select({ id: devicePairingRequests.id }).from(devicePairingRequests)
        .where(and(target, eq(devicePairingRequests.status, 'pending'))).for('update');
      const at = now();
      await tx.update(devicePairingRequests).set({ status: 'cancelled', cancelledAt: at })
        .where(and(target, eq(devicePairingRequests.status, 'pending')));
      for (const prior of pending) await writeAudit(tx, {
        module: 'devices', action: 'pairing_cancel', entityType: 'device_pairing', entityId: prior.id,
        beforeState: { status: 'pending' }, afterState: { status: 'cancelled' },
        relatedIds: { assignmentId: input.assignmentId }, createdAt: at,
      });
      const result = await tx.insert(devicePairingRequests).values({
        assignmentType: input.assignmentType,
        employeeId: input.assignmentType === 'employee' ? input.assignmentId : null,
        branchId: input.assignmentType === 'branch' ? input.assignmentId : null,
        tokenHash: input.tokenHash,
        status: 'pending',
        createdAt: at,
      });
      const id = Number(result[0].insertId);
      await writeAudit(tx, {
        module: 'devices', action: 'pairing_create', entityType: 'device_pairing', entityId: id,
        afterState: { assignmentType: input.assignmentType, assignmentId: input.assignmentId, status: 'pending' },
        relatedIds: { assignmentId: input.assignmentId }, createdAt: at,
      });
      return { id };
    });
  },
  async activatePairing(input) {
    try {
      return await database.transaction(async (tx) => {
        const candidate = (await tx.select().from(devicePairingRequests)
          .where(eq(devicePairingRequests.tokenHash, input.tokenHash)).limit(1))[0];
        if (!candidate) return 'invalid' as const;
        const assignmentId = candidate.assignmentType === 'employee' ? candidate.employeeId! : candidate.branchId!;
        if (candidate.assignmentType === 'employee') {
          const employee = await tx.select({ id: employees.id }).from(employees)
            .where(and(eq(employees.id, assignmentId), isNull(employees.deletedAt))).for('update').limit(1);
          if (!employee[0]) return 'invalid' as const;
        } else {
          const branch = await tx.select({ id: branches.id }).from(branches)
            .where(eq(branches.id, assignmentId)).for('update').limit(1);
          if (!branch[0]) return 'invalid' as const;
        }
        const pairing = (await tx.select().from(devicePairingRequests)
          .where(eq(devicePairingRequests.id, candidate.id)).for('update').limit(1))[0];
        if (!pairing || pairing.status !== 'pending') return 'invalid' as const;

        const markerOwner = (await tx.select().from(devices)
          .where(eq(devices.installationMarkerHash, input.installationMarkerHash)).for('update').limit(1))[0];
        if (markerOwner) {
          const sameAssignment = markerOwner.assignmentType === pairing.assignmentType
            && (markerOwner.assignmentType === 'employee' ? markerOwner.employeeId : markerOwner.branchId) === assignmentId;
          if (markerOwner.status !== 'revoked' && !sameAssignment) return 'conflict' as const;
          await tx.update(devices).set({ installationMarkerHash: null }).where(eq(devices.id, markerOwner.id));
          await writeAudit(tx, {
            module: 'devices', action: 'installation_marker_release', entityType: 'device', entityId: markerOwner.id,
            beforeState: { assigned: true }, afterState: { assigned: false },
            relatedIds: { assignmentId, pairingId: pairing.id }, createdAt: now(),
          });
        }

        const at = now();
        const target = assignmentFilter(pairing.assignmentType, assignmentId);
        const old = await tx.select({ id: devices.id }).from(devices)
          .where(and(target, eq(devices.status, 'active'))).for('update');
        const oldPublic = await Promise.all(old.map(({ id }) => findPublicDevice(tx, id)));
        if (old.length) {
          await tx.update(devices).set({ status: 'revoked', revokedAt: at })
            .where(and(target, eq(devices.status, 'active')));
          await tx.insert(deviceHistory).values(old.map(({ id }) => ({ deviceId: id, event: 'revoked' as const, createdAt: at })));
          for (const [index, prior] of old.entries()) await writeAudit(tx, {
            module: 'devices', action: 'replace', entityType: 'device', entityId: prior.id,
            beforeState: oldPublic[index], afterState: await findPublicDevice(tx, prior.id),
            relatedIds: { pairingId: pairing.id, assignmentId }, createdAt: at,
          });
        }
        const result = await tx.insert(devices).values({
          assignmentType: pairing.assignmentType,
          employeeId: pairing.employeeId,
          branchId: pairing.branchId,
          installationMarkerHash: input.installationMarkerHash,
          browser: input.browser,
          platform: input.platform,
          status: 'active',
          pairedAt: at,
        });
        const id = Number(result[0].insertId);
        await tx.insert(deviceHistory).values({ deviceId: id, event: 'paired', createdAt: at });
        await tx.update(devicePairingRequests).set({ status: 'used', consumedAt: at })
          .where(eq(devicePairingRequests.id, pairing.id));
        const record = (await findPublicDevice(tx, id))!;
        await writeAudit(tx, {
          module: 'devices', action: 'pairing_complete', entityType: 'device', entityId: id,
          afterState: record, relatedIds: { pairingId: pairing.id, assignmentId }, createdAt: at,
        });
        return record;
      });
    } catch (error) {
      if (duplicate(error)) return 'conflict';
      throw error;
    }
  },
  async findActiveDevice(input) {
    const row = (await database.select({ id: devices.id }).from(devices).where(and(
      assignmentFilter(input.assignmentType, input.assignmentId),
      eq(devices.installationMarkerHash, input.installationMarkerHash),
    )).limit(1))[0];
    if (!row) return 'invalid';
    const found = await findPublicDevice(database, row.id);
    if (!found) return 'invalid';
    if (found.status === 'revoked') return 'revoked';
    return found;
  },
  async recordSuccessfulVerification(deviceId) {
    return database.transaction(async (tx) => {
      const row = (await tx.select().from(devices).where(eq(devices.id, deviceId)).for('update').limit(1))[0];
      if (!row) return 'invalid' as const;
      if (row.status === 'revoked') return 'revoked' as const;
      const before = await findPublicDevice(tx, deviceId);
      const at = now();
      await tx.update(devices).set({ lastUsedAt: at }).where(eq(devices.id, deviceId));
      await tx.insert(deviceHistory).values({ deviceId, event: 'verified', createdAt: at });
      const after = (await findPublicDevice(tx, deviceId))!;
      await writeAudit(tx, {
        module: 'devices', action: 'verify', entityType: 'device', entityId: deviceId,
        beforeState: before, afterState: after,
        relatedIds: { assignmentId: after.assignmentId }, createdAt: at,
      });
      return after;
    });
  },
  async cancelPairing(id) {
    return database.transaction(async (tx) => {
      const pairing = (await tx.select().from(devicePairingRequests)
        .where(and(eq(devicePairingRequests.id, id), eq(devicePairingRequests.status, 'pending'))).for('update').limit(1))[0];
      if (!pairing) return false;
      const at = now();
      const result = await tx.update(devicePairingRequests).set({ status: 'cancelled', cancelledAt: at })
        .where(eq(devicePairingRequests.id, id));
      if (result[0].affectedRows !== 1) return false;
      await writeAudit(tx, {
        module: 'devices', action: 'pairing_cancel', entityType: 'device_pairing', entityId: id,
        beforeState: { status: 'pending' }, afterState: { status: 'cancelled' },
        relatedIds: { assignmentId: pairing.employeeId ?? pairing.branchId! }, createdAt: at,
      });
      return true;
    });
  },
  async revoke(id) {
    return database.transaction(async (tx) => {
      const before = await findPublicDevice(tx, id);
      if (!before || before.status !== 'active') return false;
      const at = now();
      const result = await tx.update(devices).set({ status: 'revoked', revokedAt: at })
        .where(and(eq(devices.id, id), eq(devices.status, 'active')));
      if (result[0].affectedRows !== 1) return false;
      await tx.insert(deviceHistory).values({ deviceId: id, event: 'revoked', createdAt: at });
      await writeAudit(tx, {
        module: 'devices', action: 'revoke', entityType: 'device', entityId: id,
        beforeState: before, afterState: await findPublicDevice(tx, id),
        relatedIds: { assignmentId: before.assignmentId }, createdAt: at,
      });
      return true;
    });
  },
  async list(query) {
    const filters = [];
    if (query.status) filters.push(eq(devices.status, query.status));
    if (query.assignmentType) filters.push(eq(devices.assignmentType, query.assignmentType));
    if (query.assignmentId) filters.push(query.assignmentType === 'branch' ? eq(devices.branchId, query.assignmentId) : eq(devices.employeeId, query.assignmentId));
    if (query.search) filters.push(or(
      sql`locate(${query.search}, ${devices.browser}) > 0`,
      sql`locate(${query.search}, ${devices.platform}) > 0`,
      sql`locate(${query.search}, ${employees.fullName}) > 0`,
      sql`locate(${query.search}, cast(${employees.employeeCode} as char)) > 0`,
      sql`locate(${query.search}, ${branches.name}) > 0`,
    )!);
    const where = filters.length ? and(...filters) : undefined;
    const rows = await database.select({ ...getTableColumns(devices), employeeName: employees.fullName, branchName: branches.name })
      .from(devices)
      .leftJoin(employees, eq(devices.employeeId, employees.id))
      .leftJoin(branches, eq(devices.branchId, branches.id))
      .where(where).orderBy(asc(devices.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const total = (await database.select({ value: count() }).from(devices)
      .leftJoin(employees, eq(devices.employeeId, employees.id))
      .leftJoin(branches, eq(devices.branchId, branches.id))
      .where(where))[0]?.value ?? 0;
    return { items: rows.map(({ employeeName, branchName, ...row }) => publicDevice(row, employeeName ?? branchName)), total };
  },
  findById(id) { return findPublicDevice(database, id); },
  async history(id) {
    return database.select({ event: deviceHistory.event, createdAt: deviceHistory.createdAt })
      .from(deviceHistory).where(eq(deviceHistory.deviceId, id)).orderBy(asc(deviceHistory.id));
  },
});

export const createDeviceLifecycle = (database: Database, now: () => Date = () => new Date()) => ({
  async revokeEmployee(employeeId: number, context?: unknown) {
    const execute = async (tx: Transaction) => {
      const at = now();
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).for('update').limit(1);
      const active = await tx.select({ id: devices.id }).from(devices)
        .where(and(eq(devices.employeeId, employeeId), eq(devices.status, 'active'))).for('update');
      const before = await Promise.all(active.map(({ id }) => findPublicDevice(tx, id)));
      const pending = await tx.select({ id: devicePairingRequests.id }).from(devicePairingRequests)
        .where(and(eq(devicePairingRequests.employeeId, employeeId), eq(devicePairingRequests.status, 'pending'))).for('update');
      let revoked: Array<{ id: number }> = [];
      if (active.length) {
        const result = await tx.update(devices).set({ status: 'revoked', revokedAt: at })
          .where(and(eq(devices.employeeId, employeeId), eq(devices.status, 'active')));
        if (result[0].affectedRows) {
          revoked = await tx.select({ id: devices.id }).from(devices).where(and(
            inArray(devices.id, active.map(({ id }) => id)),
            eq(devices.status, 'revoked'),
            eq(devices.revokedAt, at),
          ));
        }
      }
      if (revoked.length) await tx.insert(deviceHistory).values(revoked.map(({ id }) => ({ deviceId: id, event: 'revoked' as const, createdAt: at })));
      const beforeById = new Map(active.map(({ id }, index) => [id, before[index]]));
      for (const device of revoked) await writeAudit(tx, {
        module: 'devices', action: 'revoke', entityType: 'device', entityId: device.id,
        beforeState: beforeById.get(device.id), afterState: await findPublicDevice(tx, device.id),
        relatedIds: { employeeId }, createdAt: at,
      });
      await tx.update(devicePairingRequests).set({ status: 'cancelled', cancelledAt: at })
        .where(and(eq(devicePairingRequests.employeeId, employeeId), eq(devicePairingRequests.status, 'pending')));
      for (const pairing of pending) await writeAudit(tx, {
        module: 'devices', action: 'pairing_cancel', entityType: 'device_pairing', entityId: pairing.id,
        beforeState: { status: 'pending' }, afterState: { status: 'cancelled' },
        relatedIds: { employeeId }, createdAt: at,
      });
    };
    if (context) return execute(context as Transaction);
    return database.transaction(execute);
  },
});
