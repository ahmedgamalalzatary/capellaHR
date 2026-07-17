import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { devicePairingRequests, devices } from './index.js';

describe('device schema', () => {
  it('retains devices and pairing requests with unique credential and marker hashes', () => {
    expect(getTableConfig(devices).indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining(['devices_credential_hash_unique', 'devices_installation_marker_hash_unique']));
    expect(getTableConfig(devicePairingRequests).indexes.map((item) => item.config.name)).toContain('device_pairing_token_hash_unique');
  });
});
