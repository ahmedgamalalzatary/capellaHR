import type { ListClientsQuery } from '@capella/contracts';

import type { ErpBranchContextResolver } from '../branch-context.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';

export type ClientRecord = {
  id: number;
  branchId: number;
  fullName: string | null;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ClientWrite = { branchId: number; fullName: string | null; phone: string | null };

export interface ClientRepository {
  create(input: ClientWrite): Promise<ClientRecord>;
  findById(id: number): Promise<ClientRecord | null>;
  findByPhone(branchId: number, phone: string): Promise<ClientRecord | null>;
  list(branchId: number, query: ListClientsQuery): Promise<{ items: ClientRecord[]; total: number }>;
  update(
    id: number,
    branchId: number,
    changes: { fullName?: string | null; phone?: string | null },
  ): Promise<ClientRecord | null>;
}

export class ClientError extends Error {
  constructor(
    public readonly code: 'CLIENT_NOT_FOUND' | 'CLIENT_PHONE_EXISTS',
    message: string,
    /**
     * On a duplicate phone the counter needs to continue with the client that
     * already exists rather than being told only that the save failed.
     */
    public readonly existingClientId?: number,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

const isDuplicateEntryError = (error: unknown) => (
  typeof error === 'object' && error !== null && (
    Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
    || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
  )
);

const NOT_FOUND_MESSAGE = 'العميل غير موجود';
const DUPLICATE_MESSAGE = 'رقم الهاتف مسجل لعميل آخر';

export const createClientService = (dependencies: {
  repository: ClientRepository;
  resolveBranchContext: ErpBranchContextResolver;
}) => {
  const { repository, resolveBranchContext } = dependencies;

  /**
   * A client outside the acting branch is reported as missing rather than
   * forbidden, so a Cashier cannot probe another branch's records by id.
   */
  const readInBranch = async (branchId: number, id: number) => {
    const client = await repository.findById(id);
    if (!client || client.branchId !== branchId) {
      throw new ClientError('CLIENT_NOT_FOUND', NOT_FOUND_MESSAGE);
    }
    return client;
  };

  const rejectDuplicate = async (branchId: number, phone: string, allowedId?: number) => {
    const existing = await repository.findByPhone(branchId, phone);
    if (existing && existing.id !== allowedId) {
      throw new ClientError('CLIENT_PHONE_EXISTS', DUPLICATE_MESSAGE, existing.id);
    }
  };

  /**
   * The unique index is the real guard; a lost race surfaces as ER_DUP_ENTRY
   * and is translated back into the same conflict the pre-check would have
   * produced, including the winning client's id.
   */
  const asConflict = async (
    branchId: number,
    phone: string | null,
    error: unknown,
  ): Promise<never> => {
    if (!isDuplicateEntryError(error)) throw error;
    const existing = phone === null ? null : await repository.findByPhone(branchId, phone);
    throw new ClientError('CLIENT_PHONE_EXISTS', DUPLICATE_MESSAGE, existing?.id);
  };

  return {
    async create(
      actor: ErpAccountIdentity,
      input: {
        fullName?: string | undefined;
        phone?: string | undefined;
        branchId?: number | undefined;
      },
    ) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      const fullName = input.fullName?.trim() ?? null;
      const phone = input.phone ?? null;
      // Only a stored number can collide; two nameless-phone-less rows cannot exist.
      if (phone !== null) await rejectDuplicate(branchId, phone);
      try {
        return await repository.create({ branchId, fullName, phone });
      } catch (error) {
        return await asConflict(branchId, phone, error);
      }
    },

    async get(actor: ErpAccountIdentity, id: number, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      return readInBranch(branchId, id);
    },

    async list(actor: ErpAccountIdentity, query: ListClientsQuery) {
      const { branchId } = await resolveBranchContext(actor, query.branchId);
      return repository.list(branchId, query);
    },

    async findByPhone(actor: ErpAccountIdentity, phone: string, requestedBranchId?: number) {
      const { branchId } = await resolveBranchContext(actor, requestedBranchId);
      const client = await repository.findByPhone(branchId, phone);
      if (!client) throw new ClientError('CLIENT_NOT_FOUND', NOT_FOUND_MESSAGE);
      return client;
    },

    async update(
      actor: ErpAccountIdentity,
      id: number,
      // Explicit `| undefined` because the API compiles with exactOptionalPropertyTypes.
      input: {
        fullName?: string | undefined;
        phone?: string | undefined;
        branchId?: number | undefined;
      },
    ) {
      const { branchId } = await resolveBranchContext(actor, input.branchId);
      await readInBranch(branchId, id);

      const changes: { fullName?: string; phone?: string } = {};
      if (input.fullName !== undefined) changes.fullName = input.fullName.trim();
      if (input.phone !== undefined) {
        await rejectDuplicate(branchId, input.phone, id);
        changes.phone = input.phone;
      }

      let client: ClientRecord | null;
      try {
        client = await repository.update(id, branchId, changes);
      } catch (error) {
        return await asConflict(branchId, input.phone ?? null, error);
      }
      if (!client) throw new ClientError('CLIENT_NOT_FOUND', NOT_FOUND_MESSAGE);
      return client;
    },
  };
};

export type ClientService = ReturnType<typeof createClientService>;
