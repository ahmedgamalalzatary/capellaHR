'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { useSession } from '@/features/auth';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { listClientBranches, listClients, type Client } from '../api/clients-api';
import { clientQueryKeys } from '../query-keys';
import { ClientForm } from './client-form';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const columns = [
  { key: 'name', label: 'اسم العميل' },
  { key: 'phone', label: 'رقم الهاتف' },
  { key: 'actions', label: 'إجراءات' },
] as const;

export function ClientsView() {
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const [selectedBranchId, setSelectedBranchId] = useState<number>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  // Whitespace-only input must read as "no filter", so the trimmed term drives
  // both the cache key and the request.
  const trimmedSearch = search.trim();
  const branchId = isAdmin ? selectedBranchId : undefined;
  const branchScope = branchId === undefined ? {} : { branchId };
  const scopeReady = session.isSuccess && (!isAdmin || branchId !== undefined);

  const branchesQuery = useQuery({
    queryKey: ['clients', 'branches'],
    queryFn: () => fetchAllPages((branchPage) => listClientBranches(branchPage)),
    enabled: isAdmin,
  });

  const clientsQuery = useQuery({
    queryKey: clientQueryKeys.list({ page, search: trimmedSearch, branchId }),
    queryFn: () => listClients({
      page,
      ...branchScope,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    }),
    enabled: scopeReady,
  });

  const items = clientsQuery.data?.items ?? [];
  const meta = clientsQuery.data?.meta;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Card><CardContent className="space-y-2">
          <Label htmlFor="clients-branch">الفرع</Label>
          <select
            id="clients-branch"
            value={selectedBranchId ?? ''}
            disabled={branchesQuery.isPending || branchesQuery.isError}
            className="h-9 w-full max-w-xs rounded-control border border-line bg-paper px-3 text-sm"
            onChange={(event) => {
              setSelectedBranchId(event.target.value ? Number(event.target.value) : undefined);
              setPage(1);
              setCreateOpen(false);
              setEditing(null);
            }}
          >
            <option value="">اختر الفرع</option>
            {(branchesQuery.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
          {branchesQuery.isError ? (
            <EmptyState
              title="تعذر تحميل الفروع"
              description={serverErrorMessage(branchesQuery.error) ?? undefined}
              action={
                <Button variant="secondary" size="sm" onClick={() => void branchesQuery.refetch()}>
                  إعادة المحاولة
                </Button>
              }
            />
          ) : null}
        </CardContent></Card>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="w-full max-w-xs">
          <Input
            aria-label="بحث بالاسم أو رقم الهاتف"
            placeholder="بحث بالاسم أو رقم الهاتف"
            value={search}
            disabled={!scopeReady}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
        </div>
        <Button size="sm" disabled={!scopeReady} onClick={() => { setCreateOpen(true); setEditing(null); }}>
          <Plus className="size-4" aria-hidden />
          إضافة عميل
        </Button>
      </div>

      {createOpen ? (
        <ClientForm {...branchScope} onDone={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} />
      ) : null}

      {editing ? (
        <ClientForm
          client={editing}
          {...branchScope}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <Card>
        {!scopeReady ? (
          <EmptyState title="اختر فرعًا لعرض العملاء" />
        ) : clientsQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل العملاء…</div>
        ) : clientsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل العملاء"
            description={serverErrorMessage(clientsQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void clientsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={trimmedSearch ? 'لا يوجد عميل مطابق' : 'لا يوجد عملاء بعد'}
            description={trimmedSearch ? 'جرب رقمًا أو اسمًا آخر.' : 'ابدأ بإضافة أول عميل.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-2.5 text-start font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((client) => (
                  <tr key={client.id} className="border-b border-line/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium">{client.fullName}</td>
                    <td className="px-4 py-3 tabular text-muted" dir="ltr">{client.phone}</td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditing(client); setCreateOpen(false); }}
                      >
                        <Pencil className="size-4" aria-hidden />
                        تعديل
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> عميل
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
