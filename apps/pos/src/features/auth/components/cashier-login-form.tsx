'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { cashierLogin } from '../api/auth-api';
import { SESSION_QUERY_KEY } from '../hooks/use-session';
import { cashierLoginFormSchema, type CashierLoginFormValues } from '../schemas/login-schemas';

export function CashierLoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CashierLoginFormValues>({
    resolver: zodResolver(cashierLoginFormSchema),
  });

  const login = useMutation({
    mutationFn: cashierLogin,
    onSuccess: (session) => {
      queryClient.removeQueries();
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      router.push('/');
    },
  });

  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'حدث خطأ غير متوقع. حاول مرة أخرى.'
        : null;

  const formError = errors.username?.message ?? errors.password?.message ?? serverError;

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="py-6">
        <form
          noValidate
          onSubmit={handleSubmit((values) => login.mutate(values))}
          className="space-y-4"
        >
          <Field label="اسم المستخدم" htmlFor="cashier-username" required>
            <Input
              id="cashier-username"
              autoComplete="username"
              aria-invalid={errors.username ? true : undefined}
              {...register('username')}
            />
          </Field>

          <Field label="كلمة المرور" htmlFor="cashier-password" required>
            <Input
              id="cashier-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              {...register('password')}
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
