'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { Select } from '@/components/form/select';
import { ApiError } from '@/lib/api/client';

import { promoteCashier } from '../api/cashier-accounts-api';
import type { EmployeeOption } from '../api/employee-options-api';
import { cashierAccountQueryKeys } from '../query-keys';
import { promoteCashierFormSchema, type PromoteCashierFormValues } from '../schemas/cashier-account-schemas';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export function PromoteCashierForm({
  employees,
  onDone,
}: {
  employees: EmployeeOption[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PromoteCashierFormValues>({
    resolver: zodResolver(promoteCashierFormSchema),
  });

  const promote = useMutation({
    mutationFn: promoteCashier,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
      onDone();
    },
  });

  const formError =
    errors.employeeId?.message ?? errors.username?.message ?? errors.password?.message
      ?? serverErrorMessage(promote.error);

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <form noValidate className="space-y-4" onSubmit={handleSubmit((values) => promote.mutate(values))}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="الموظف" htmlFor="promote-employee" required>
              <Select
                id="promote-employee"
                defaultValue=""
                aria-invalid={errors.employeeId ? true : undefined}
                {...register('employeeId')}
              >
                <option value="" disabled>اختر الموظف…</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.fullName}</option>
                ))}
              </Select>
            </Field>
            <Field label="اسم المستخدم" htmlFor="promote-username" required>
              <Input
                id="promote-username"
                autoComplete="off"
                aria-invalid={errors.username ? true : undefined}
                {...register('username')}
              />
            </Field>
            <Field label="كلمة المرور" htmlFor="promote-password" required>
              <Input
                id="promote-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                {...register('password')}
              />
            </Field>
          </div>
          {formError ? (
            <p role="alert" className="text-[13px] text-danger">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
            <Button type="submit" disabled={promote.isPending}>
              <UserPlus className="size-4" aria-hidden />
              إنشاء الحساب
            </Button>
            <Button type="button" variant="ghost" disabled={promote.isPending} onClick={onDone}>
              إلغاء
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
