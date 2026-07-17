import { describe, expect, it, vi } from 'vitest';

import { BranchError, createBranchService, type BranchRecord, type BranchRepository } from '../../src/modules/branches/index.js';

const input = {
  name: ' Cairo ', location: 'Nasr City', latitude: 30, longitude: 31,
  gpsAccuracyMeters: 5, attendanceRadiusMeters: 50,
};

const repository = (overrides: Partial<BranchRepository> = {}): BranchRepository => ({
  async create(value): Promise<BranchRecord> {
    return { id: 1, ...value, hasEverBeenReferenced: false, createdAt: new Date(), updatedAt: new Date() };
  },
  findById: vi.fn(async () => null),
  findByNormalizedName: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [], total: 0 })),
  update: vi.fn(async () => null),
  deleteUnreferenced: vi.fn(async () => 'deleted' as const),
  markReferenced: vi.fn(async () => true),
  ...overrides,
});

describe('branch service', () => {
  it('stores trimmed text and a normalized unique name', async () => {
    const create = vi.fn(async (value: Parameters<BranchRepository['create']>[0]): Promise<BranchRecord> => (
      { id: 1, ...value, hasEverBeenReferenced: false, createdAt: new Date(), updatedAt: new Date() }
    ));
    const repo = repository({ create });
    await createBranchService(repo).create(input);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cairo', nameNormalized: 'cairo' }));
  });

  it('rejects a duplicate normalized name', async () => {
    const repo = repository({ findByNormalizedName: vi.fn(async () => ({ id: 7 })) });
    await expect(createBranchService(repo).create(input)).rejects.toMatchObject({ code: 'BRANCH_NAME_EXISTS' });
  });

  it('never deletes a branch after its first reference', async () => {
    const repo = repository({ deleteUnreferenced: vi.fn(async () => 'referenced' as const) });
    await expect(createBranchService(repo).remove(1)).rejects.toEqual(expect.any(BranchError));
    await expect(createBranchService(repo).remove(1)).rejects.toMatchObject({ code: 'BRANCH_REFERENCED' });
  });
});
