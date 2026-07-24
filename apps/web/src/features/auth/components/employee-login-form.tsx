'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { installationMarker } from '../../devices/lib/device-identity';
import { employeeLogin } from '../api/auth-api';
import { SESSION_QUERY_KEY } from '../hooks/use-session';
import { employeeLoginFormSchema, type EmployeeLoginFormValues } from '../schemas/login-schemas';

export function EmployeeLoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeLoginFormValues>({
    resolver: zodResolver(employeeLoginFormSchema),
  });

  const login = useMutation({
    mutationFn: (values: EmployeeLoginFormValues) => employeeLogin({
      ...values,
      installationMarker: installationMarker(),
    }),
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      onSuccess?.();
    },
  });

  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'حدث خطأ غير متوقع. حاول مرة أخرى.'
        : null;

  const validationError =
    errors.employeeCode?.message ?? errors.pin?.message ?? errors.personalPhone?.message ?? null;
  const formError = validationError ?? serverError;

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="py-6">
        <form
          noValidate
          onSubmit={handleSubmit((values) => login.mutate(values))}
          className="space-y-4"
        >
          <Field label="كود الموظف" htmlFor="employeeCode" required>
            <Input
              id="employeeCode"
              inputMode="numeric"
              className="tabular"
              aria-invalid={errors.employeeCode ? true : undefined}
              {...register('employeeCode')}
            />
          </Field>

          <Field label="الرقم السري (4 أرقام)" htmlFor="pin" required>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              className="tabular"
              aria-invalid={errors.pin ? true : undefined}
              {...register('pin')}
            />
          </Field>

          <Field label="رقم الهاتف الشخصي" htmlFor="personalPhone" required>
            <Input
              id="personalPhone"
              inputMode="numeric"
              className="tabular"
              placeholder="01012345678"
              aria-invalid={errors.personalPhone ? true : undefined}
              {...register('personalPhone')}
            />
          </Field>

          {formError ? (
            <p role="alert" className="text-[13px] text-danger">
              {formError}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
