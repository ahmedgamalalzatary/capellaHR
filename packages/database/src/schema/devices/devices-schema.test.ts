import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { devicePairingRequests, devices } from './index.js';

describe('device schema', () => {
  it('retains devices and pairing requests with unique marker and token hashes', () => {
    expect(getTableConfig(devices).indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'devices_installation_marker_hash_unique',
      'devices_active_employee_assignment_idx', 'devices_active_branch_assignment_idx',
    ]));
    expect(getTableConfig(devicePairingRequests).indexes.map((item) => item.config.name)).toEqual(expect.arrayContaining([
      'device_pairing_token_hash_unique', 'device_pairings_status_created_idx',
    ]));
  });
  it('persists only the browser marker needed for silent device verification', () => {
    expect(Object.keys(devices)).toEqual([
      'id', 'assignmentType', 'employeeId', 'branchId', 'installationMarkerHash',
      'browser', 'platform', 'status', 'pairedAt', 'lastUsedAt', 'revokedAt',
    ]);
    expect(Object.keys(devicePairingRequests)).toEqual([
      'id', 'assignmentType', 'employeeId', 'branchId', 'tokenHash',
      'status', 'createdAt', 'consumedAt', 'cancelledAt',
    ]);
  });
});
