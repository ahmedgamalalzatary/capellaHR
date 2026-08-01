import { writeAudit, type AuditEventInput, type AuditExecutor } from './audit-writer.js';

/**
 * ERP modules may not import HR internals, so audit writes cross the same
 * public capability bridge as every other HR core service.
 *
 * `actor` is deliberately not part of the ERP-facing event: the acting account
 * is taken from the request audit context established at authentication, so an
 * ERP caller can neither forget it nor claim to be someone else. That is what
 * makes "every sensitive ERP operation records the acting account" structural
 * rather than a per-call convention.
 */
export type ErpAuditEvent = Omit<AuditEventInput, 'actor'>;

export type ErpAuditExecutor = AuditExecutor;

export const createErpAuditCapability = () => ({
  async record(executor: ErpAuditExecutor, event: ErpAuditEvent): Promise<void> {
    await writeAudit(executor, event);
  },
});

export type ErpAuditCapability = ReturnType<typeof createErpAuditCapability>;
