import { createHash } from 'node:crypto';
import type { CreateBranchInput, ListBranchesQuery, UpdateBranchInput } from '@capella/contracts';

export type BranchRecord = CreateBranchInput & {
  id: number;
  nameNormalized: string;
  hasEverBeenReferenced: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface BranchRepository {
  create(input: CreateBranchInput & { nameNormalized: string }): Promise<BranchRecord>;
  findById(id: number): Promise<BranchRecord | null>;
  findByNormalizedName(name: string): Promise<{ id: number } | null>;
  list(query: ListBranchesQuery): Promise<{ items: BranchRecord[]; total: number }>;
  update(id: number, input: UpdateBranchInput & { nameNormalized?: string }): Promise<BranchRecord | null>;
  deleteUnreferenced(id: number): Promise<'deleted' | 'referenced' | 'not_found'>;
  markReferenced(id: number): Promise<boolean>;
}

export class BranchError extends Error {
  constructor(public readonly code: 'BRANCH_NOT_FOUND' | 'BRANCH_NAME_EXISTS' | 'BRANCH_REFERENCED', message: string) {
    super(message);
  }
}

const normalizeName = (name: string) => createHash('sha256').update(name.trim().toLowerCase()).digest('hex');
const isDuplicateNameError = (error: unknown) => (
  typeof error === 'object' && error !== null && (
    Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
    || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
  )
);

export const createBranchService = (repository: BranchRepository) => ({
  async create(input: CreateBranchInput) {
    const name = input.name.trim();
    const nameNormalized = normalizeName(name);
    if (await repository.findByNormalizedName(nameNormalized)) {
      throw new BranchError('BRANCH_NAME_EXISTS', 'اسم الفرع مستخدم بالفعل');
    }
    try {
      return await repository.create({ ...input, name, location: input.location.trim(), nameNormalized });
    } catch (error) {
      if (isDuplicateNameError(error)) throw new BranchError('BRANCH_NAME_EXISTS', 'اسم الفرع مستخدم بالفعل');
      throw error;
    }
  },
  async get(id: number) {
    const branch = await repository.findById(id);
    if (!branch) throw new BranchError('BRANCH_NOT_FOUND', 'الفرع غير موجود');
    return branch;
  },
  list(query: ListBranchesQuery) { return repository.list(query); },
  async update(id: number, input: UpdateBranchInput) {
    await this.get(id);
    const changes: UpdateBranchInput & { nameNormalized?: string } = { ...input };
    if (input.name !== undefined) {
      changes.name = input.name.trim();
      changes.nameNormalized = normalizeName(input.name);
      const existing = await repository.findByNormalizedName(changes.nameNormalized);
      if (existing && existing.id !== id) throw new BranchError('BRANCH_NAME_EXISTS', 'اسم الفرع مستخدم بالفعل');
    }
    if (input.location !== undefined) changes.location = input.location.trim();
    let branch: BranchRecord | null;
    try {
      branch = await repository.update(id, changes);
    } catch (error) {
      if (isDuplicateNameError(error)) throw new BranchError('BRANCH_NAME_EXISTS', 'اسم الفرع مستخدم بالفعل');
      throw error;
    }
    if (!branch) throw new BranchError('BRANCH_NOT_FOUND', 'الفرع غير موجود');
    return branch;
  },
  async remove(id: number) {
    const result = await repository.deleteUnreferenced(id);
    if (result === 'not_found') throw new BranchError('BRANCH_NOT_FOUND', 'الفرع غير موجود');
    if (result === 'referenced') throw new BranchError('BRANCH_REFERENCED', 'لا يمكن حذف فرع تمت الإشارة إليه سابقاً');
  },
  markReferenced(id: number) { return repository.markReferenced(id); },
});

export type BranchService = ReturnType<typeof createBranchService>;
