'use client';

import { Button, Modal } from '@capella/ui';
import { useState } from 'react';

import type {
  AdvanceDecision,
  Employee,
  EmployeeDeactivationPreview,
  NegativeBalanceDecision,
} from '../api/employees-api';

/**
 * The admin answers at most three questions, and the later two only exist when money is
 * unresolved: what to do with outstanding advances, and how to settle a shortfall that summing
 * them leaves behind. Anything the decision already settles ends the flow immediately.
 */
type Stage = 'confirm' | 'advance' | 'shortfall';

export interface DeactivationDialogProps {
  employee: Employee;
  preview: EmployeeDeactivationPreview;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (
    advanceDecision: AdvanceDecision,
    negativeBalanceDecision: NegativeBalanceDecision | undefined,
  ) => void;
}

const owesMoney = (preview: EmployeeDeactivationPreview) => Number(preview.amountOwed) > 0;

export function DeactivationDialog({
  employee,
  preview,
  pending,
  onCancel,
  onConfirm,
}: DeactivationDialogProps) {
  const [stage, setStage] = useState<Stage>('confirm');
  const hasAdvances = preview.unpaidInstallmentCount > 0;

  // Summing advances is the only decision that can leave a shortfall, so it is also the decision
  // implied when there are no advances at all and the salary is negative for other reasons.
  const afterSumAll = () => {
    if (owesMoney(preview)) setStage('shortfall');
    else onConfirm('sum_all', undefined);
  };

  const title = stage === 'confirm'
    ? `تعطيل الموظف ${employee.fullName}`
    : stage === 'advance' ? 'الأقساط غير المدفوعة' : 'المبلغ المتبقي على الموظف';

  return (
    // Not dismissable by backdrop: money is being decided, so leaving must be a deliberate click.
    <Modal title={title} dismissOnBackdrop={false} onClose={onCancel}>
      {stage === 'confirm' ? (
        <>
          {preview.hasOpenSession ? (
            <p className="text-[13px] text-warning">
              الموظف مسجّل حضور حاليًا. لو كملت، هيكمل شغله وهيتم تعطيله بعد تسجيل خروجه.
            </p>
          ) : null}
          <p className="text-[13px] text-muted">
            صافي راتب الشهر الحالي: <span className="tabular">{preview.currentNetSalary}</span> ج
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                if (hasAdvances) setStage('advance');
                else afterSumAll();
              }}
            >
              متابعة
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
              إلغاء
            </Button>
          </div>
        </>
      ) : null}

      {stage === 'advance' ? (
        <>

          <p className="text-[13px] text-muted">
            على الموظف <span className="tabular">{preview.unpaidInstallmentCount}</span> أقساط
            بإجمالي <span className="tabular">{preview.unpaidAdvanceAmount}</span> ج، وراتبه{' '}
            <span className="tabular">{preview.currentNetSalary}</span> ج.
          </p>
          <div className="flex flex-col gap-2">
            <Button size="sm" disabled={pending} onClick={afterSumAll}>
              تجميع الأقساط وخصمها من الراتب
            </Button>
            {preview.canZeroSalary ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => onConfirm('zero_salary', undefined)}
              >
                تصفية الراتب مقابل المديونية
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => onConfirm('ignore_debt', undefined)}
            >
              إلغاء المديونية وصرف الراتب كاملًا
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
              إلغاء التعطيل
            </Button>
          </div>
        </>
      ) : null}

      {stage === 'shortfall' ? (
        <>

          <p className="text-[13px] text-muted">
            بعد الخصم، يتبقى على الموظف <span className="tabular">{preview.amountOwed}</span> ج.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => onConfirm('sum_all', 'collect_cash')}
            >
              تم استلام المبلغ نقدًا
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => onConfirm('sum_all', 'record_debt')}
            >
              تسجيل المبلغ كمديونية على الموظف
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
              إلغاء التعطيل
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
