import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { deviceAuthenticationChallenges, devicePairingRequests, devices } from './index.js';

describe('device schema', () => {
  it('retains devices and pairing requests with unique credential and marker hashes', () => {
    expect(getTableConfig(devices).indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'devices_credential_hash_unique', 'devices_installation_marker_hash_unique',
      'devices_active_employee_assignment_idx', 'devices_active_branch_assignment_idx',
    ]));
    expect(getTableConfig(devicePairingRequests).indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'device_pairing_token_hash_unique', 'device_pairings_status_created_idx',
    ]));
  });
  it('persists WebAuthn counters and one-time authentication challenges', () => {
    expect(Object.keys(devices)).toEqual(expect.arrayContaining(['credentialId', 'credentialPublicKey', 'counter', 'transports']));
    expect(Object.keys(devicePairingRequests)).toContain('registrationChallenge');
    expect(Object.keys(deviceAuthenticationChallenges)).toEqual(expect.arrayContaining(['challenge', 'expiresAt', 'consumedAt', 'deviceId']));
  });
});
