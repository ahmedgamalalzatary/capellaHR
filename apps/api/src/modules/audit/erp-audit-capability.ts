import {
  writeAudit,
  type AuditEventInput,
  type AuditExecutor,
} from './audit-writer.js';

export const createErpAuditCapability = () => ({
  write(executor: AuditExecutor, event: AuditEventInput) {
    return writeAudit(executor, event);
  },
});

export type ErpAuditCapability = ReturnType<typeof createErpAuditCapability>;
