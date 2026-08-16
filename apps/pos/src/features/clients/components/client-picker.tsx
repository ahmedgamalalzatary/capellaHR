'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, Search, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, EmptyState, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { clientLabel } from '@/lib/client-label';

import { listClients, type Client } from '../api/clients-api';
import { clientQueryKeys } from '../query-keys';
import { ClientForm } from './client-form';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

/** Below this the query stays idle, so one or two digits do not list the branch. */
const MIN_SEARCH_LENGTH = 3;

/**
 * Selects the mandatory client for a sale: search by phone or name, pick a
 * result, or create one inline without leaving the counter screen.
 */
export function ClientPicker({
  selected,
  onSelect,
  branchId,
}: {
  selected?: Client | null;
  onSelect: (client: Client | null) => void;
  branchId?: number;
}) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const enabled = search.trim().length >= MIN_SEARCH_LENGTH;
  const clientsQuery = useQuery({
    queryKey: clientQueryKeys.list({ picker: true, search, branchId }),
    queryFn: () => listClients({
      search: search.trim(),
      pageSize: 10,
      ...(branchId === undefined ? {} : { branchId }),
    }),
    enabled,
  });

  const items = clientsQuery.data?.items ?? [];

  if (selected) {
    return (
      <Card className="border-ink/20 bg-surface/60">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
              <Check className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{clientLabel(selected)}</span>
              <span className="tabular block text-[13px] text-muted">
                {selected.fullName === null ? '' : selected.phone ?? ''}
              </span>
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => {
            setSearch('');
            setCreating(false);
            onSelect(null);
          }}>
            تغيير العميل
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
        <Input
          aria-label="ابحث عن العميل برقم الهاتف أو الاسم"
          placeholder="رقم الهاتف أو الاسم"
          className="ps-9"
          inputMode="tel"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setCreating(false); }}
        />
      </div>

      {creating ? (
        <ClientForm
          {...(branchId === undefined ? {} : { branchId })}
          defaultPhone={/^\d+$/.test(search.trim()) ? search.trim() : ''}
          onDone={(saved) => { setCreating(false); onSelect(saved); }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {!enabled ? (
        <p className="px-1 text-[13px] text-muted">
          اكتب 3 أرقام أو حروف على الأقل للبحث.
        </p>
      ) : clientsQuery.isPending ? (
        <p className="px-1 text-[13px] text-muted">جارٍ البحث…</p>
      ) : clientsQuery.isError ? (
        <EmptyState
          title="تعذر البحث عن العملاء"
          description={serverErrorMessage(clientsQuery.error) ?? undefined}
          action={
            <Button variant="secondary" size="sm" onClick={() => void clientsQuery.refetch()}>
              إعادة المحاولة
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="لا يوجد عميل بهذا الرقم"
          description="لا يمكن إتمام بيع بدون عميل، أضف العميل الآن."
          action={
            !creating ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <UserPlus className="size-4" aria-hidden />
                إضافة عميل جديد
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="scroll-thin max-h-72 overflow-y-auto shadow-card">
          <ul>
            {items.map((client) => (
              <li key={client.id} className="border-b border-line/60 last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-surface"
                  onClick={() => onSelect(client)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{clientLabel(client)}</span>
                    <span className="tabular block text-[13px] text-muted">
                      {client.fullName === null ? '' : client.phone ?? ''}
                    </span>
                  </span>
                  <ChevronLeft className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
