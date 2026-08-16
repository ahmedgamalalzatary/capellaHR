import { api } from '@/lib/api/client';

export interface Client {
  id: number;
  branchId: number;
  /** A client carries a name, a number, or both — never neither. */
  fullName: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ClientBranch { id: number; name: string }

export interface ListClientsParams {
  search?: string;
  page?: number;
  pageSize?: number;
  /** Admins act on a named branch; a cashier's branch comes from their account. */
  branchId?: number;
}

const queryString = (params: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
};

export function listClients(params: ListClientsParams = {}) {
  return api.getPage<Client>(`/erp/clients${queryString({ ...params })}`);
}

export function listClientBranches(page = 1) {
  return api.getPage<ClientBranch>(`/branches?page=${page}&pageSize=100`);
}

/** Used to put a saved draft's client back on screen; drafts store only the id. */
export function getClient(id: number, branchId?: number) {
  return api.get<Client>(`/erp/clients/${id}${queryString({ branchId })}`);
}

export function findClientByPhone(phone: string, branchId?: number) {
  return api.get<Client>(`/erp/clients/by-phone${queryString({ phone, branchId })}`);
}

export function createClient(input: { fullName?: string; phone?: string; branchId?: number }) {
  return api.post<Client>('/erp/clients', input);
}

export function updateClient(
  id: number,
  input: { fullName?: string; phone?: string; branchId?: number },
) {
  return api.patch<Client>(`/erp/clients/${id}`, input);
}
