import { describe, expect, it, vi } from 'vitest';

import type { ErpAccountIdentity, ErpBranchContextResolver } from '../../src/modules/erp/index.js';
import {
  ClientError,
  createClientService,
  type ClientRecord,
  type ClientRepository,
} from '../../src/modules/erp/clients/index.js';

const CASHIER: ErpAccountIdentity = { role: 'cashier', accountId: 9, branchId: 4 };

/** Stands in for the real resolver, which is covered by its own tests. */
const resolverFor = (branchId: number): ErpBranchContextResolver => async () => ({
  accountId: 9,
  accountRole: 'cashier',
  branchId,
  employeeId: 4,
});

const record = (overrides: Partial<ClientRecord> = {}): ClientRecord => ({
  id: 1,
  branchId: 1,
  fullName: 'ندى سمير',
  phone: '01001234567',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const duplicateEntryError = () => Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });

const repository = (overrides: Partial<ClientRepository> = {}): ClientRepository => ({
  create: vi.fn(async (input: Parameters<ClientRepository['create']>[0]) => record(input)),
  findById: vi.fn(async () => null),
  findByPhone: vi.fn(async () => null),
  list: vi.fn(async () => ({ items: [], total: 0 })),
  update: vi.fn(async (
    id: number,
    branchId: number,
    changes: Parameters<ClientRepository['update']>[2],
  ) => record({ id, branchId, ...changes })),
  ...overrides,
});

const service = (repo: ClientRepository, branchId = 1) => createClientService({
  repository: repo,
  resolveBranchContext: resolverFor(branchId),
});

describe('ERP client service', () => {
  it('trims the name and takes the branch from the resolver, not the caller', async () => {
    const create = vi.fn(async (input: Parameters<ClientRepository['create']>[0]) => record(input));
    await service(repository({ create }), 7)
      .create(CASHIER, { fullName: '  ندى سمير  ', phone: '01001234567', branchId: 999 });

    // branchId 999 came from the request body and must be ignored.
    expect(create).toHaveBeenCalledWith({ branchId: 7, fullName: 'ندى سمير', phone: '01001234567' });
  });

  it('reports a duplicate phone with the existing client so the counter can continue', async () => {
    const repo = repository({ findByPhone: vi.fn(async () => record({ id: 42 })) });

    await expect(
      service(repo).create(CASHIER, { fullName: 'ندى', phone: '01001234567' }),
    ).rejects.toMatchObject({ code: 'CLIENT_PHONE_EXISTS', existingClientId: 42 });
  });

  it('translates a lost uniqueness race into the same conflict', async () => {
    // Pre-check sees nothing, then the unique index rejects the insert.
    const findByPhone = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ id: 55 }));
    const repo = repository({
      findByPhone: findByPhone as unknown as ClientRepository['findByPhone'],
      create: vi.fn(async () => { throw duplicateEntryError(); }),
    });

    await expect(
      service(repo).create(CASHIER, { fullName: 'ندى', phone: '01001234567' }),
    ).rejects.toMatchObject({ code: 'CLIENT_PHONE_EXISTS', existingClientId: 55 });
  });

  it('hides a client belonging to another branch instead of forbidding it', async () => {
    // Reporting FORBIDDEN would confirm the id exists somewhere else.
    const repo = repository({ findById: vi.fn(async () => record({ id: 3, branchId: 2 })) });

    await expect(service(repo, 1).get(CASHIER, 3))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
  });

  it('lets a client keep its own phone on update but not take another client\'s', async () => {
    const own = record({ id: 3 });
    const keeps = service(repository({
      findById: vi.fn(async () => own),
      findByPhone: vi.fn(async () => own),
    }));

    await expect(keeps.update(CASHIER, 3, { phone: '01001234567' })).resolves.toMatchObject({ id: 3 });

    const taken = service(repository({
      findById: vi.fn(async () => own),
      findByPhone: vi.fn(async () => record({ id: 8 })),
    }));
    await expect(taken.update(CASHIER, 3, { phone: '01001234567' }))
      .rejects.toMatchObject({ code: 'CLIENT_PHONE_EXISTS', existingClientId: 8 });
  });

  it('reports an unknown phone lookup as a missing client', async () => {
    await expect(service(repository()).findByPhone(CASHIER, '01001234567'))
      .rejects.toEqual(expect.any(ClientError));
  });

  it('scopes list reads to the resolved branch', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0 }));
    await service(repository({ list }), 7).list(CASHIER, { page: 1, pageSize: 20 });

    expect(list).toHaveBeenCalledWith(7, expect.objectContaining({ page: 1 }));
  });
});
