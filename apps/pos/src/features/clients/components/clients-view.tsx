'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
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
  const [formPending, setFormPending] = useState(false);

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
    <section className="space-y-6">
      <PageHeader
        title="إدارة العملاء"
        description="إضافة بيانات العملاء والبحث فيها وتحديثها."
        actions={(
          <Button
            size="sm"
            disabled={!scopeReady || formPending}
            onClick={() => { setCreateOpen(true); setEditing(null); }}
          >
            <Plus className="size-4" aria-hidden />
            إضافة عميل
          </Button>
        )}
      />

      {isAdmin ? (
        <Card className="shadow-card">
          <CardContent className="space-y-1.5 p-4 sm:p-5">
            <Label htmlFor="clients-branch">الفرع</Label>
            <Select
              id="clients-branch"
              className="max-w-sm"
              value={selectedBranchId ?? ''}
              disabled={formPending || branchesQuery.isPending || branchesQuery.isError}
              onChange={(event) => {
                if (formPending) return;
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
            </Select>
            {branchesQuery.isError ? (
              <EmptyState
                title="تعذر تحميل الفروع"
                description={serverErrorMessage(branchesQuery.error) ?? undefined}
                className="py-8"
                action={
                  <Button variant="secondary" size="sm" onClick={() => void branchesQuery.refetch()}>
                    إعادة المحاولة
                  </Button>
                }
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {createOpen ? (
        <ClientForm {...branchScope} onDone={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} onPendingChange={setFormPending} />
      ) : null}

      {editing ? (
        <ClientForm
          client={editing}
          {...branchScope}
          onDone={() => setEditing(null)}
          onCancel={() => setEditing(null)}
          onPendingChange={setFormPending}
        />
      ) : null}

      <Card className="overflow-hidden shadow-card">
        <div className="border-b border-line/70 p-3 sm:p-4">
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted"
              aria-hidden
            />
            <Input
              aria-label="بحث بالاسم أو رقم الهاتف"
              placeholder="بحث بالاسم أو رقم الهاتف"
              className="ps-9"
              value={search}
              disabled={!scopeReady}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </div>
        </div>

        {!scopeReady ? (
          <EmptyState title="اختر فرعًا لعرض العملاء" />
        ) : clientsQuery.isPending ? (
          <LoadingState label="جارٍ تحميل العملاء…" className="px-6 py-16" />
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
          <DataTable>
            <THead>
              {columns.map((column) => <TH key={column.key}>{column.label}</TH>)}
            </THead>
            <tbody>
              {items.map((client) => (
                <TR key={client.id}>
                  <TD className="font-medium">{client.fullName}</TD>
                  <TD className="tabular text-muted">{client.phone}</TD>
                  <TD>
                    <RowActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={formPending}
                        onClick={() => { setEditing(client); setCreateOpen(false); }}
                      >
                        <Pencil className="size-4" aria-hidden />
                        تعديل
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        )}

        {meta && meta.totalPages > 1 ? (
          <Pagination
            summary={(
              <>
                صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
                {' — '}
                <span className="tabular">{meta.total}</span> عميل
              </>
            )}
            previousDisabled={meta.page <= 1}
            nextDisabled={meta.page >= meta.totalPages}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        ) : null}
      </Card>
    </section>
  );
}
