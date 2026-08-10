'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Card, EmptyState, cn } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Notice } from '@/components/feedback/notice';
import { ApiError } from '@/lib/api/client';

import { listAssignableEmployees, type AssignableEmployee } from '../api/assignable-employees-api';
import { employeeAssignmentQueryKeys } from '../query-keys';

const serverErrorMessage = (error: unknown): string | undefined => {
  if (!error) return undefined;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const STALE_SELECTION_MESSAGE = 'انصرف الموظف المحدد، اختر موظفًا مسجلًا حضوره الآن.';

/**
 * Picks the one employee an invoice is assigned to.
 *
 * Eligibility is strictly live attendance with no cashier or admin override
 * (`docs/erp-plan.md` §7): this component only ever shows what the server
 * reports as present, and the server re-checks the choice when the sale is
 * completed. A selection that checked out in the meantime is dropped here so
 * the counter notices before submitting, never to replace that server check.
 */
export function PresentEmployeePicker({
  selected,
  onSelect,
  branchId,
}: {
  selected?: AssignableEmployee | null;
  onSelect: (employee: AssignableEmployee | null) => void;
  branchId?: number;
}) {
  const presentQuery = useQuery({
    queryKey: employeeAssignmentQueryKeys.present(branchId),
    queryFn: () => listAssignableEmployees(branchId === undefined ? {} : { branchId }),
  });

  const items = presentQuery.data;
  const [staleNotice, setStaleNotice] = useState(false);
  const staleSelection = Boolean(
    selected && items && !items.some(({ id }) => id === selected.id),
  );

  useEffect(() => {
    if (staleSelection) {
      setStaleNotice(true);
      onSelect(null);
    }
  }, [staleSelection, onSelect]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">الموظف المسجل حضوره</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void presentQuery.refetch()}
          disabled={presentQuery.isFetching}
        >
          <RefreshCw className="size-4" aria-hidden />
          تحديث
        </Button>
      </div>

      {staleNotice ? (
        <Notice tone="warning">{STALE_SELECTION_MESSAGE}</Notice>
      ) : null}

      {presentQuery.isPending ? (
        <LoadingState label="جارٍ تحميل الموظفين…" align="start" className="p-0" />
      ) : presentQuery.isError ? (
        <EmptyState
          title="تعذر تحميل الموظفين المسجلين حضورًا"
          description={serverErrorMessage(presentQuery.error)}
          action={
            <Button variant="secondary" size="sm" onClick={() => void presentQuery.refetch()}>
              إعادة المحاولة
            </Button>
          }
        />
      ) : (items?.length ?? 0) === 0 ? (
        <EmptyState
          title="لا يوجد موظف مسجل حضورًا في الفرع الآن"
          description="لا يمكن إسناد الفاتورة إلا لموظف مسجل حضوره، سجّل حضوره أولًا."
        />
      ) : (
        <Card className="scroll-thin max-h-72 overflow-y-auto shadow-card">
          <ul>
            {(items ?? []).map((employee) => {
              const isSelected = selected?.id === employee.id && !staleNotice;
              return (
                <li key={employee.id} className="border-b border-line/60 last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-surface',
                      isSelected && 'bg-surface',
                    )}
                    onClick={() => {
                      setStaleNotice(false);
                      onSelect(employee);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{employee.fullName}</span>
                      <span className="tabular block text-[13px] text-muted" dir="ltr">
                        {employee.employeeCode}
                      </span>
                    </span>
                    {isSelected ? (
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-paper">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
