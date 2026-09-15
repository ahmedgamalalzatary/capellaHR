'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal } from '@capella/ui';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { useAdminBranch } from '@/hooks/use-admin-branch';

import { listClientBranches, listClientDebtInvoices, listClients, type Client } from '../api/clients-api';
import { clientQueryKeys } from '../query-keys';
import { ClientForm } from './client-form';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const invoiceDate = new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
});

function ClientDebtInvoices({
  client,
  branchId,
  onClose,
}: {
  client: Client & { balanceDue: string };
  branchId?: number;
  onClose: () => void;
}) {
  const invoices = useQuery({
    queryKey: clientQueryKeys.debtInvoices(client.id, branchId),
    queryFn: () => listClientDebtInvoices(client.id, branchId),
  });
  const name = client.fullName ?? client.phone ?? `#${client.id}`;

  return (
    <Modal title={`فواتير ${name} غير المسددة`} className="max-h-[90dvh] overflow-y-auto" onClose={onClose}>
      {invoices.isPending ? (
        <LoadingState label="جارٍ تحميل الفواتير غير المسددة…" className="py-12" />
      ) : invoices.isError ? (
        <EmptyState
          title="تعذر تحميل الفواتير غير المسددة"
          description={serverErrorMessage(invoices.error) ?? undefined}
          action={<Button variant="secondary" onClick={() => void invoices.refetch()}>إعادة المحاولة</Button>}
        />
      ) : invoices.data.items.length === 0 ? (
        <EmptyState title="لا توجد فواتير غير مسددة" />
      ) : (
        <div className="space-y-2">
          {invoices.data.items.map((invoice) => (
            <Link
              key={invoice.id}
              href={`/invoices/${invoice.id}${branchId === undefined ? '' : `?branchId=${branchId}`}`}
              className="block rounded-control border border-line p-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="tabular font-medium">{invoice.invoiceNumber}</p>
                  <time className="text-[13px] text-muted" dateTime={invoice.soldAt}>
                    {invoiceDate.format(new Date(invoice.soldAt))}
                  </time>
                </div>
                <p className="tabular font-semibold text-warning">المتبقي {invoice.balanceDue} ج.م</p>
              </div>
              <p className="tabular mt-2 text-[13px] text-muted">
                الإجمالي {invoice.total} ج.م · المدفوع {invoice.amountPaid} ج.م
              </p>
            </Link>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ClientsView() {
  const session = useSession();
  const isAdmin = session.data?.actor.type === 'admin';
  const { branchId: selectedBranchId, setBranchId: setSelectedBranchId } = useAdminBranch();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debtStatus, setDebtStatus] = useState<'' | 'with_debt' | 'without_debt'>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [debtClient, setDebtClient] = useState<(Client & { balanceDue: string }) | null>(null);
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
    queryKey: clientQueryKeys.list({ page, search: trimmedSearch, debtStatus, branchId }),
    queryFn: () => listClients({
      page,
      ...branchScope,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      ...(debtStatus ? { debtStatus } : {}),
    }),
    enabled: scopeReady,
  });

  const items = clientsQuery.data?.items ?? [];
  const meta = clientsQuery.data?.meta;

  const openCreate = () => { setCreateOpen(true); setEditing(null); };

  return (
    <section className="space-y-6">
      <PageHeader
        title="إدارة العملاء"
        description="إضافة بيانات العملاء والبحث فيها وتحديثها."
        actions={(
          <Button
            size="sm"
            disabled={!scopeReady || formPending}
            onClick={openCreate}
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
        <Modal title="إضافة عميل" className="max-h-[90dvh] overflow-y-auto" onClose={() => !formPending && setCreateOpen(false)}>
          <ClientForm {...branchScope} onDone={() => setCreateOpen(false)} onCancel={() => setCreateOpen(false)} onPendingChange={setFormPending} />
        </Modal>
      ) : null}

      {editing ? (
        <Modal title="تعديل عميل" className="max-h-[90dvh] overflow-y-auto" onClose={() => !formPending && setEditing(null)}>
          <ClientForm
            client={editing}
            {...branchScope}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            onPendingChange={setFormPending}
          />
        </Modal>
      ) : null}

      {debtClient ? (
        <ClientDebtInvoices
          client={debtClient}
          {...(branchId === undefined ? {} : { branchId })}
          onClose={() => setDebtClient(null)}
        />
      ) : null}

      <Card className="overflow-hidden shadow-card">
        <div className="flex flex-wrap gap-3 border-b border-line/70 p-3 sm:p-4">
          <div className="relative min-w-64 flex-1">
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
          <div className="w-full sm:w-52">
            <Label htmlFor="client-debt-status" className="sr-only">حالة المديونية</Label>
            <Select
              id="client-debt-status"
              aria-label="حالة المديونية"
              value={debtStatus}
              disabled={!scopeReady}
              onChange={(event) => {
                setDebtStatus(event.target.value as typeof debtStatus);
                setPage(1);
              }}
            >
              <option value="">كل العملاء</option>
              <option value="with_debt">عليهم مستحقات</option>
              <option value="without_debt">بدون مستحقات</option>
            </Select>
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
            title={trimmedSearch || debtStatus ? 'لا يوجد عميل مطابق' : 'لا يوجد عملاء بعد'}
            description={trimmedSearch || debtStatus ? 'غيّر البحث أو حالة المديونية.' : 'ابدأ بإضافة أول عميل.'}
            action={
              trimmedSearch || debtStatus ? undefined : (
                <Button size="sm" disabled={formPending} onClick={openCreate}>
                  <Plus className="size-4" aria-hidden />
                  إضافة أول عميل
                </Button>
              )
            }
          />
        ) : (
          <ul className="divide-y divide-line/70">
            {items.map((client) => (
              <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="font-medium">{client.fullName ?? <span className="text-muted">بدون اسم</span>}</p>
                  <p className="tabular text-[13px] text-muted">{client.phone ?? '—'}</p>
                  {Number(client.balanceDue) > 0 ? (
                    <button
                      type="button"
                      aria-label={`عرض الفواتير غير المسددة ل${client.fullName ?? client.phone ?? `لعميل ${client.id}`}`}
                      className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
                      onClick={() => setDebtClient(client)}
                    >
                      <Badge variant="warning" className="mt-1.5 tabular cursor-pointer hover:opacity-80">
                        مستحق {client.balanceDue} ج.م
                      </Badge>
                    </button>
                  ) : (
                    <Badge variant="neutral" className="mt-1.5 tabular">مستحق {client.balanceDue} ج.م</Badge>
                  )}
                </div>
                <Button
                  variant="secondary"
                  disabled={formPending}
                  onClick={() => { setEditing(client); setCreateOpen(false); }}
                >
                  <Pencil className="size-4" aria-hidden />
                  تعديل
                </Button>
              </li>
            ))}
          </ul>
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
            page={meta.page}
            totalPages={meta.totalPages}
            onPage={setPage}
          />
        ) : null}
      </Card>
    </section>
  );
}
