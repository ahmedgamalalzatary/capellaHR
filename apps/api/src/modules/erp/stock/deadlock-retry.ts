/**
 * MySQL rolls the whole transaction back on a deadlock, so the only way to keep
 * "A's product is created" true is to run the create again. One retry is enough:
 * the second attempt takes the same locks in the same order, and the loser of
 * the deadlock is by then the only one left.
 */

const DEADLOCK_ERRNO = 1213;

/** Drizzle wraps driver errors, so the code can sit one or two `cause`s down. */
export const isDeadlock = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if (Reflect.get(current, 'errno') === DEADLOCK_ERRNO) return true;
    if (Reflect.get(current, 'code') === 'ER_LOCK_DEADLOCK') return true;
    current = Reflect.get(current, 'cause');
  }
  return false;
};

export const withDeadlockRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (!isDeadlock(error)) throw error;
    return run();
  }
};
