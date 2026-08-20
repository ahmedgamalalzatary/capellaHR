'use client';

import { Button, Field, Input, Modal } from '@capella/ui';
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
    departure: EmployeeDeparture,
  ) => void;
}

/** Why the employee left and when, collected before any money question is asked. */
export interface EmployeeDeparture { reason: string; lastWorkingDay: string }

const owesMoney = (preview: EmployeeDeactivationPreview) => Number(preview.amountOwed) > 0;

export function DeactivationDialog({
  employee,
  preview,
  pending,
  onCancel,
  onConfirm,
}: DeactivationDialogProps) {
  const [stage, setStage] = useState<Stage>('confirm');
  const [reason, setReason] = useState('');
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const hasAdvances = preview.unpaidInstallmentCount > 0;
  const departure = { reason: reason.trim(), lastWorkingDay };
  // Gathered on the first stage so the admin cannot reach the money decisions, act on them, and
  // only then be stopped by a missing reason.
  const departureGiven = departure.reason.length > 0 && lastWorkingDay.length > 0;
  const confirm = (
    advanceDecision: AdvanceDecision,
    negativeBalanceDecision: NegativeBalanceDecision | undefined,
  ) => onConfirm(advanceDecision, negativeBalanceDecision, departure);

  // Summing advances is the only decision that can leave a shortfall, so it is also the decision
  // implied when there are no advances at all and the salary is negative for other reasons.
  const afterSumAll = () => {
    if (owesMoney(preview)) setStage('shortfall');
    else confirm('sum_all', undefined);
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
          <Field label="سبب ترك العمل" htmlFor="deactivation-reason" required>
            <Input
              id="deactivation-reason"
              value={reason}
              maxLength={500}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field label="آخر يوم عمل" htmlFor="deactivation-last-working-day" required>
            <Input
              id="deactivation-last-working-day"
              type="date"
              value={lastWorkingDay}
              disabled={pending}
              onChange={(event) => setLastWorkingDay(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !departureGiven}
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
                onClick={() => confirm('zero_salary', undefined)}
              >
                تصفية الراتب مقابل المديونية
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => confirm('ignore_debt', undefined)}
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
              onClick={() => confirm('sum_all', 'collect_cash')}
            >
              تم استلام المبلغ نقدًا
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => confirm('sum_all', 'record_debt')}
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
