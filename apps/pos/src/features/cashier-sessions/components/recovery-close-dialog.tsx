'use client';

import { useState } from 'react';

import { Button, Label, Modal } from '@capella/ui';

import { Textarea } from '@/components/form/textarea';

interface RecoveryCloseDialogProps {
  pending: boolean;
  serverError: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function RecoveryCloseDialog({
  pending,
  serverError,
  onConfirm,
  onCancel,
}: RecoveryCloseDialogProps) {
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setValidationError('سبب الإغلاق الاستثنائي مطلوب');
      return;
    }
    setValidationError(null);
    onConfirm(trimmedReason);
  };

  return (
    <Modal
      title="تأكيد الإغلاق الاستثنائي"
      dismissOnBackdrop={!pending}
      onClose={onCancel}
    >
      <p className="text-[13px] text-muted">
        استخدم هذا الإجراء فقط لاستعادة فرع تُركت ورديته مفتوحة. سيظهر السبب في سجل التدقيق.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="recovery-close-reason">سبب الإغلاق الاستثنائي</Label>
        <Textarea
          id="recovery-close-reason"
          value={reason}
          maxLength={1000}
          rows={4}
          disabled={pending}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? 'recovery-close-reason-error' : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (validationError) setValidationError(null);
          }}
        />
        {validationError ? (
          <p id="recovery-close-reason-error" role="alert" className="text-[13px] text-danger">
            {validationError}
          </p>
        ) : null}
      </div>
      {serverError ? <p role="alert" className="text-[13px] text-danger">{serverError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" size="sm" disabled={pending} onClick={submit}>
          تأكيد الإغلاق الاستثنائي
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </Modal>
  );
}
