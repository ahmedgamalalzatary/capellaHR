import { getTableName } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as authSchema from './index.js';

describe('authentication database schema', () => {
  it('defines persistent sessions without storing raw tokens', () => {
    const sessions = Reflect.get(authSchema, 'authSessions');

    expect(sessions).toBeDefined();
    expect(getTableName(sessions)).toBe('auth_sessions');
    expect(sessions.tokenHash).toBeDefined();
    expect(sessions.expiresAt).toBeDefined();
    expect(Reflect.get(sessions, 'token')).toBeUndefined();
  });

  it('defines permanent authentication attempt records', () => {
    const attempts = Reflect.get(authSchema, 'authAttempts');

    expect(attempts).toBeDefined();
    expect(getTableName(attempts)).toBe('auth_attempts');
    expect(attempts.succeeded).toBeDefined();
    expect(attempts.reason).toBeDefined();
  });

  it('backfills existing session expiry from the original creation time', () => {
    const migration = readFileSync(
      new URL('../../../migrations/0037_silent_mister_sinister.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toContain(
      'SET `expires_at` = `created_at` + INTERVAL 7 DAY',
    );
    expect(migration).toContain(
      'MODIFY `expires_at` timestamp(3) DEFAULT (CURRENT_TIMESTAMP(3) + INTERVAL 7 DAY) NOT NULL',
    );
  });
});
