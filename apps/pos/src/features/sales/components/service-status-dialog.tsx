'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { Badge, Button, EmptyState, Modal } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { fetchAllPages } from '@/lib/api/fetch-all';
import {
  listConsumableServices,
  updateServiceExecutionStatus,
  type ConsumableServiceExecution,
} from '@/features/consumables';

import { responseMessage } from './invoice-format';

type EditableStatus = 'pending' | 'in_progress' | 'completed';

export function ServiceStatusDialog({
  invoiceId,
  branchId,
  onClose,
}: {
  invoiceId: number;
  branchId?: number;
  onClose(): void;
}) {
  const params = { ...(branchId === undefined ? {} : { branchId }), invoiceId };
  const services = useQuery({
    queryKey: ['invoice-service-statuses', invoiceId, branchId ?? null],
    queryFn: () => fetchAllPages((page) => listConsumableServices({
      ...params, status: 'operational', page, pageSize: 100,
    })),
  });
  const mutation = useMutation({
    mutationFn: ({ item, status }: { item: ConsumableServiceExecution; status: EditableStatus }) => updateServiceExecutionStatus({
      ...(branchId === undefined ? {} : { branchId }),
      serviceQueueEntryIds: [item.id],
      status,
    }),
    onSuccess: () => services.refetch(),
  });

  return <Modal title="حالة خدمات الفاتورة" className="max-w-2xl" onClose={onClose}>
    {services.isPending ? <LoadingState label="جارٍ تحميل الخدمات…" /> : services.isError ? (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-danger">{responseMessage(services.error, 'تعذر تحميل حالات الخدمات.')}</p>
        <Button variant="secondary" onClick={() => void services.refetch()}>إعادة المحاولة</Button>
      </div>
    ) : services.data.length === 0 ? <EmptyState title="لا توجد خدمات في هذه الفاتورة" /> : (
      <div className="space-y-3">
        {services.data.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line p-3">
          <div>
            <p className="text-sm font-medium">{item.serviceName}</p>
            <p className="text-xs text-muted">الدور {item.queueNumber}{item.employeeName ? ` — ${item.employeeName}` : ''}</p>
          </div>
          {item.status === 'completed' ? <Badge variant="success">تمت</Badge> : <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={item.status === 'pending' ? 'secondary' : 'ghost'} disabled={mutation.isPending} onClick={() => mutation.mutate({ item, status: 'pending' })}>لم تبدأ</Button>
            <Button size="sm" variant={item.status === 'in_progress' ? 'secondary' : 'ghost'} disabled={mutation.isPending} onClick={() => mutation.mutate({ item, status: 'in_progress' })}>قيد التنفيذ</Button>
            <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ item, status: 'completed' })}>تمت</Button>
          </div>}
        </div>)}
        {mutation.isError ? <p role="alert" className="text-sm text-danger">{responseMessage(mutation.error, 'تعذر تحديث حالة الخدمة.')}</p> : null}
      </div>
    )}
  </Modal>;
}
