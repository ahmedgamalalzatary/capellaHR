import { AsyncLocalStorage } from 'node:async_hooks';

import { auditEvents } from '@capella/database/schema';
import type { AuditActorType } from '@capella/contracts';

export interface AuditRequestContext {
  actorType: AuditActorType;
  actorIdentifier: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditEventInput {
  actor?: { type: AuditActorType; identifier: string };
  requestId?: string | null;
  module: string;
  action: string;
  entityType: string;
  entityId: string | number;
  beforeState?: unknown;
  afterState?: unknown;
  relatedIds?: Record<string, string | number>;
  createdAt?: Date;
}

type AuditInsert = typeof auditEvents.$inferInsert;
export interface AuditExecutor {
  insert(table: typeof auditEvents): { values(value: AuditInsert): PromiseLike<unknown> };
}

const storage = new AsyncLocalStorage<AuditRequestContext>();
const secretKey = /(password|pin|secret|token|cookie|authorization|api.?key|credential|biometric|template|challenge|installation.?marker|private.?key|public.?key)/i;

const redact = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return '[REDACTED]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => redact(entry, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = secretKey.test(key) ? '[REDACTED]' : redact(entry, seen);
  }
  seen.delete(value);
  return result;
};

export const redactAuditValue = (value: unknown) => redact(value, new WeakSet());

export const runWithAuditContext = <T>(context: AuditRequestContext, callback: () => T): T => (
  storage.run(context, callback)
);

export const setAuditActor = (actor: { type: AuditActorType; identifier: string }) => {
  const context = storage.getStore();
  if (!context) return;
  context.actorType = actor.type;
  context.actorIdentifier = actor.identifier.slice(0, 128);
};

export const currentAuditRequestId = () => storage.getStore()?.requestId ?? null;

const relatedIds = (value: AuditEventInput['relatedIds']) => {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    secretKey.test(key) ? '[REDACTED]' : String(entry),
  ]));
};

export const writeAudit = async (executor: AuditExecutor, event: AuditEventInput) => {
  const context = storage.getStore();
  const actor = event.actor ?? {
    type: context?.actorType ?? 'system',
    identifier: context?.actorIdentifier ?? 'system',
  };
  await executor.insert(auditEvents).values({
    actorType: actor.type,
    actorIdentifier: actor.identifier.slice(0, 128),
    module: event.module.slice(0, 64),
    action: event.action.slice(0, 64),
    entityType: event.entityType.slice(0, 64),
    entityId: String(event.entityId).slice(0, 128),
    beforeState: event.beforeState === undefined ? null : redactAuditValue(event.beforeState),
    afterState: event.afterState === undefined ? null : redactAuditValue(event.afterState),
    relatedIds: relatedIds(event.relatedIds),
    requestId: event.requestId === undefined
      ? context?.requestId?.slice(0, 64) ?? null
      : event.requestId?.slice(0, 64) ?? null,
    ipAddress: context?.ipAddress?.slice(0, 45) ?? null,
    userAgent: context?.userAgent?.slice(0, 1024) ?? null,
    createdAt: event.createdAt ?? new Date(),
  });
};
