import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as authSchema from './index.js';

describe('authentication database schema', () => {
  it('defines persistent sessions without storing raw tokens', () => {
    const sessions = Reflect.get(authSchema, 'authSessions');

    expect(sessions).toBeDefined();
    expect(getTableName(sessions)).toBe('auth_sessions');
    expect(sessions.tokenHash).toBeDefined();
    expect(Reflect.get(sessions, 'token')).toBeUndefined();
  });

  it('defines permanent authentication attempt records', () => {
    const attempts = Reflect.get(authSchema, 'authAttempts');

    expect(attempts).toBeDefined();
    expect(getTableName(attempts)).toBe('auth_attempts');
    expect(attempts.succeeded).toBeDefined();
    expect(attempts.reason).toBeDefined();
  });
});
