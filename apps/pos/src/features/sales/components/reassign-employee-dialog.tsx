'use client';

import type { PublicInvoiceDto } from '@capella/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, Modal } from '@capella/ui';

import { Textarea } from '@/components/form/textarea';
import { PresentEmployeePicker } from '@/features/employee-assignment';
import type { AssignableEmployee } from '@/features/employee-assignment';
import { createUuid } from '@/lib/uuid';

import { reassignInvoiceLine } from '../api/sales-api';
import { responseMessage } from './invoice-format';

type InvoiceLine = PublicInvoiceDto['lines'][number];

export function ReassignEmployeeDialog({
  invoice,
  line,
  branchId,
  onClose,
  onUpdated,
}: {
  invoice: PublicInvoiceDto;
  line: InvoiceLine;
  branchId?: number;
  onClose(): void;
  onUpdated(invoice: PublicInvoiceDto): void;
}) {
  const [employee, setEmployee] = useState<AssignableEmployee | null>(null);
  const [reason, setReason] = useState('');
  const [operationReference] = useState(createUuid);
  const mutation = useMutation({
    mutationFn: () => reassignInvoiceLine(invoice.id, line.id, {
      ...(branchId === undefined ? {} : { branchId }),
      employeeId: employee!.id,
      operationReference,
      reason: reason.trim(),
    }),
    onSuccess: (updated) => {
      onUpdated(updated);
      onClose();
    },
  });
  const valid = employee !== null && employee.id !== line.employee?.id && reason.trim() !== '';

  return <Modal title={`تغيير موظف الخدمة: ${line.name}`} onClose={onClose}>
    <PresentEmployeePicker selected={employee} onSelect={setEmployee} {...(branchId === undefined ? {} : { branchId })} />
    <label className="block space-y-1 text-sm">
      <span>سبب التغيير</span>
      <Textarea
        aria-label="سبب التغيير"
        maxLength={1000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </label>
    {employee?.id === line.employee?.id
      ? <p role="alert" className="text-sm text-danger">هذا هو الموظف الحالي بالفعل.</p>
      : null}
    {mutation.isError
      ? <p role="alert" className="text-sm text-danger">{responseMessage(mutation.error, 'تعذر تغيير الموظف.')}</p>
      : null}
    <div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={mutation.isPending} onClick={onClose}>إلغاء</Button>
      <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'جارٍ التغيير…' : 'تأكيد التغيير'}
      </Button>
    </div>
  </Modal>;
}
