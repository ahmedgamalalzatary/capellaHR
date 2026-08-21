'use client';

import { Button, Modal } from '@capella/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';

import {
  getEmployeeSettlement,
  listEmployeeDebts,
  settleEmployeeDebt,
  type Employee,
} from '../api/employees-api';
import { employeeQueryKeys } from '../query-keys';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export interface EmployeeSettlementPanelProps {
  employee: Employee;
  onClose: () => void;
}

const rows = (statement: {
  netSalaryBeforeSettlement: string;
  advancesRecovered: string;
  writeOffAmount: string;
  forfeitedSalaryAmount: string;
  cashCollectedAmount: string;
  debtRecordedAmount: string;
  finalNetSalary: string;
}) => [
  ['صافي الراتب قبل التسوية', statement.netSalaryBeforeSettlement],
  ['السلف المستردة', statement.advancesRecovered],
  ['مبالغ تم إعفاؤها', statement.writeOffAmount],
  ['راتب تم التنازل عنه', statement.forfeitedSalaryAmount],
  ['نقدية تم تحصيلها', statement.cashCollectedAmount],
  ['مديونية مسجلة', statement.debtRecordedAmount],
  ['الصافي النهائي', statement.finalNetSalary],
] as const;

/**
 * Everything about the money side of an employee leaving: what they still owe, and the frozen
 * end-of-service statement once they have actually left. The statement query is expected to fail
 * for anyone still employed, so its error is not surfaced as a problem.
 */
export function EmployeeSettlementPanel({ employee, onClose }: EmployeeSettlementPanelProps) {
  const queryClient = useQueryClient();
  const debtsQuery = useQuery({
    queryKey: employeeQueryKeys.debts(employee.id),
    queryFn: () => listEmployeeDebts(employee.id),
  });
  const statementQuery = useQuery({
    queryKey: employeeQueryKeys.settlement(employee.id),
    queryFn: () => getEmployeeSettlement(employee.id),
    retry: false,
  });
  const settle = useMutation({
    mutationFn: (debtId: number) => settleEmployeeDebt(employee.id, debtId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.debts(employee.id) });
    },
  });

  const debts = debtsQuery.data ?? [];
  const statement = statementQuery.data;

  return (
    <Modal title={`تسوية ${employee.fullName}`} onClose={onClose}>
      <section className="space-y-2">
        <h3 className="text-[13px] font-medium">المديونيات</h3>
        {debtsQuery.isPending ? (
          <p className="text-[13px] text-muted">جارٍ التحميل…</p>
        ) : debtsQuery.isError ? (
          <p role="alert" className="text-[13px] text-danger">
            {serverErrorMessage(debtsQuery.error) ?? 'تعذر تحميل المديونيات'}
          </p>
        ) : debts.length === 0 ? (
          <p className="text-[13px] text-muted">لا توجد مديونيات على هذا الموظف.</p>
        ) : (
          <ul className="space-y-1.5">
            {debts.map((debt) => (
              <li key={debt.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="tabular text-muted">{debt.payrollMonth}</span>
                <span className="tabular">{debt.amount} ج</span>
                {debt.settledAt === null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={settle.isPending}
                    onClick={() => settle.mutate(debt.id)}
                  >
                    تسجيل السداد
                  </Button>
                ) : (
                  <span className="text-success">تم السداد</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {settle.isError ? (
          <p role="alert" className="text-[13px] text-danger">
            {serverErrorMessage(settle.error) ?? 'تعذر تسجيل السداد'}
          </p>
        ) : null}
      </section>

      {statement ? (
        <section className="space-y-2 border-t border-line pt-3 print-statement">
          <h3 className="text-[13px] font-medium">بيان تسوية نهاية الخدمة</h3>
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">سبب ترك العمل</dt>
              <dd>{statement.reason}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">آخر يوم عمل</dt>
              <dd className="tabular">{statement.lastWorkingDay}</dd>
            </div>
            {rows(statement).map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular">{amount} ج</dd>
              </div>
            ))}
          </dl>
          {/* Inside the printed section, so it has to take itself out of the print. */}
          <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
            طباعة
          </Button>
        </section>
      ) : null}
    </Modal>
  );
}
