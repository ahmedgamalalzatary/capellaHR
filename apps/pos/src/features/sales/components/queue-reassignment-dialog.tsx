'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Modal } from '@capella/ui';

import { Textarea } from '@/components/form/textarea';
import { PresentEmployeePicker, type AssignableEmployee } from '@/features/employee-assignment';
import type { ConsumableServiceExecution } from '@/features/consumables';
import { createUuid } from '@/lib/uuid';
import { notifyError, notifySuccess } from '@/lib/notify';

import { reassignServiceQueueEntry } from '../api/sales-api';
import { responseMessage } from './invoice-format';

export function QueueReassignmentDialog({ ticket, branchId, onClose, onUpdated }: {
  ticket: ConsumableServiceExecution;
  branchId?: number;
  onClose(): void;
  onUpdated(): void;
}) {
  const [employee, setEmployee] = useState<AssignableEmployee | null>(null);
  const [reason, setReason] = useState('');
  const [operationReference] = useState(createUuid);
  const mutation = useMutation({
    mutationFn: () => reassignServiceQueueEntry(ticket.invoiceId, ticket.id, {
      ...(branchId === undefined ? {} : { branchId }),
      employeeId: employee!.id, operationReference, reason: reason.trim(),
    }),
    onSuccess: () => {
      onUpdated();
      notifySuccess('تم تغيير موظف الخدمة.');
      onClose();
    },
    onError: (error: unknown) => notifyError(error, 'تعذر تغيير موظف الخدمة.'),
  });
  const same = employee?.id === ticket.employeeId;
  return <Modal title={`تغيير موظف الخدمة: ${ticket.serviceName} — الدور ${ticket.queueNumber}`} onClose={onClose}>
    <p className="text-sm text-muted">الموظف الحالي: {ticket.employeeName}</p>
    <PresentEmployeePicker selected={employee} onSelect={setEmployee} {...(branchId === undefined ? {} : { branchId })} />
    <label className="block space-y-1 text-sm">
      <span>سبب التغيير</span>
      <Textarea aria-label="سبب التغيير" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
    </label>
    {same ? <p role="alert" className="text-sm text-danger">هذا هو الموظف الحالي بالفعل.</p> : null}
    {mutation.isError ? <p role="alert" className="text-sm text-danger">{responseMessage(mutation.error, 'تعذر تغيير الموظف.')}</p> : null}
    <div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>إلغاء</Button>
      <Button disabled={!employee || same || !reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'جارٍ التغيير…' : 'تأكيد التغيير'}
      </Button>
    </div>
  </Modal>;
}
