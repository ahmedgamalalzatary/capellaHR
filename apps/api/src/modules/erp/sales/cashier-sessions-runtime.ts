import {
  CASHIER_SESSION_MAX_DURATION_MS,
  type CashierSessionRepository,
} from './cashier-sessions-service.js';

export { CASHIER_SESSION_MAX_DURATION_MS } from './cashier-sessions-service.js';
export { createDrizzleCashierSessionRepository } from './cashier-sessions-repository.js';

/**
 * The background pass that ends shifts nobody came back to close. The API closes
 * an expired shift the moment anyone touches it, so this only matters for a till
 * left untouched overnight — but that is exactly the case the rule exists for.
 */
export const createCashierSessionSweeper = (dependencies: {
  repository: CashierSessionRepository;
  now?: () => Date;
}) => async () => {
  const now = (dependencies.now ?? (() => new Date()))();
  const closed = await dependencies.repository.autoCloseExpired({
    openedBefore: new Date(now.getTime() - CASHIER_SESSION_MAX_DURATION_MS),
  });
  return closed.length;
};
