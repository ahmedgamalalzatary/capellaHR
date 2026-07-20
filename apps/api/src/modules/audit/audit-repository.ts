import type { ListAuditEventsQuery } from '@capella/contracts';
import { type createDatabase } from '@capella/database';
import { auditEvents } from '@capella/database/schema';
import { and, count, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';

import type { AuditRepository } from './audit-service.js';

type Database = ReturnType<typeof createDatabase>;

const dateAt = (instant: Date, formatter: Intl.DateTimeFormat) => {
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const startOfDate = (value: string, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60 * 1_000;
  let high = target + 36 * 60 * 60 * 1_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(new Date(middle), formatter) < value) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
};

const endOfDate = (value: string, timeZone: string) => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return new Date(startOfDate(next, timeZone).valueOf() - 1);
};

const filtersFor = (query: ListAuditEventsQuery, timeZone: string): SQL[] => [
  ...(query.search === undefined ? [] : [or(
    sql`locate(${query.search}, ${auditEvents.module}) > 0`,
    sql`locate(${query.search}, ${auditEvents.action}) > 0`,
    sql`locate(${query.search}, ${auditEvents.entityType}) > 0`,
    sql`locate(${query.search}, ${auditEvents.entityId}) > 0`,
    sql`locate(${query.search}, ${auditEvents.actorIdentifier}) > 0`,
    sql`locate(${query.search}, coalesce(${auditEvents.requestId}, '')) > 0`,
  )!]),
  ...(query.actorType === undefined ? [] : [eq(auditEvents.actorType, query.actorType)]),
  ...(query.module === undefined ? [] : [eq(auditEvents.module, query.module)]),
  ...(query.action === undefined ? [] : [eq(auditEvents.action, query.action)]),
  ...(query.entityType === undefined ? [] : [eq(auditEvents.entityType, query.entityType)]),
  ...(query.entityId === undefined ? [] : [eq(auditEvents.entityId, query.entityId)]),
  ...(query.requestId === undefined ? [] : [eq(auditEvents.requestId, query.requestId)]),
  ...(query.dateFrom === undefined ? [] : [gte(auditEvents.createdAt, startOfDate(query.dateFrom, timeZone))]),
  ...(query.dateTo === undefined ? [] : [lte(auditEvents.createdAt, endOfDate(query.dateTo, timeZone))]),
];

export const createDrizzleAuditRepository = (
  database: Database,
  options: { timeZone?: string } = {},
): AuditRepository => {
  const timeZone = options.timeZone ?? 'Africa/Cairo';
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
  return {
    async list(query) {
      const where = filtersFor(query, timeZone);
      const condition = where.length ? and(...where) : undefined;
      const items = await database.select().from(auditEvents).where(condition)
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
      const totals = await database.select({ value: count() }).from(auditEvents).where(condition);
      return { items, total: totals[0]?.value ?? 0 };
    },
  };
};
