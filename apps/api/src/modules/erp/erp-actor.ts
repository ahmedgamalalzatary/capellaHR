import type { ErpAccountIdentity } from './hr-capabilities.js';

/**
 * Translates the actor that HR's authentication middleware placed on
 * `response.locals` into the ERP identity shape.
 *
 * ERP modules may not import the HR auth middleware, so authentication stays
 * mounted by the composition root and ERP reads only its result. An acting
 * account id is mandatory: an admin session predating account identity cannot
 * act in the ERP, because every sensitive ERP operation must record who
 * authorized it.
 */
export const erpActorFromLocals = (actor: unknown): ErpAccountIdentity | null => {
  if (typeof actor !== 'object' || actor === null) return null;

  const { type, accountId, employeeId } = actor as {
    type?: unknown;
    accountId?: unknown;
    employeeId?: unknown;
  };
  if (typeof accountId !== 'number') return null;

  if (type === 'admin') return { role: 'admin', accountId };
  if (type === 'cashier' && typeof employeeId === 'number') {
    return { role: 'cashier', accountId, employeeId };
  }
  return null;
};
