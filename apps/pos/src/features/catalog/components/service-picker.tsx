'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Card, EmptyState, Input } from '@capella/ui';

import { listServices, type ServiceListItem } from '../api/catalog-api';
import { catalogQueryKeys } from '../query-keys';
import { serverErrorMessage } from './catalog-messages';

/**
 * Counter-side service browsing and search. Only sellable services are offered —
 * the server treats "active" as the service and its category both being live —
 * and the fixed price is displayed, never edited: the locked rule is one fixed
 * price per service, with the invoice-level discount as the only variation.
 *
 * Without `onSelect` this is a read-only catalog view; the ERP 9 sale workflow
 * passes a handler to turn each row into a selectable line.
 */
export function ServicePicker({ onSelect }: { onSelect?: (service: ServiceListItem) => void }) {
  const [search, setSearch] = useState('');
  // Whitespace-only input must read as "no filter", so the trimmed term drives
  // both the cache key and the request.
  const trimmed = search.trim();

  const servicesQuery = useQuery({
    queryKey: catalogQueryKeys.services({ picker: true, search: trimmed }),
    queryFn: () => listServices({ isActive: true, pageSize: 50, ...(trimmed ? { search: trimmed } : {}) }),
  });

  const items = servicesQuery.data?.items ?? [];

  return (
    <div className="space-y-3">
      <Input
        aria-label="بحث عن خدمة"
        placeholder="اسم الخدمة"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {servicesQuery.isPending ? (
        <p className="px-1 text-[13px] text-muted">جارٍ تحميل الخدمات…</p>
      ) : servicesQuery.isError ? (
        <EmptyState
          title="تعذر تحميل الخدمات"
          description={serverErrorMessage(servicesQuery.error) ?? undefined}
          action={
            <Button variant="secondary" size="sm" onClick={() => void servicesQuery.refetch()}>
              إعادة المحاولة
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={trimmed ? 'لا توجد خدمة مطابقة' : 'لا توجد خدمات متاحة'}
          description={trimmed ? 'جرب اسمًا آخر.' : 'أضف الخدمات من إدارة الكتالوج.'}
        />
      ) : (
        <Card>
          <ul>
            {items.map((service) => {
              const body = (
                <>
                  <span>
                    <span className="block text-sm font-medium">{service.name}</span>
                    <span className="block text-[13px] text-muted">{service.categoryName}</span>
                  </span>
                  <span className="tabular text-sm font-medium" dir="ltr">
                    {`${service.price} ج.م`}
                  </span>
                </>
              );

              return (
                <li key={service.id} className="border-b border-line/60 last:border-b-0">
                  {onSelect ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-line/20"
                      onClick={() => onSelect(service)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
