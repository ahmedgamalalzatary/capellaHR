'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Card, CardContent, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { installationMarker } from '../../devices/lib/device-identity';
import { employeeLogin, getEmployeeDeviceOptions } from '../api/auth-api';
import { employeeLoginFormSchema, type EmployeeLoginFormValues } from '../schemas/login-schemas';

/** Arabic messages for the employee-login denial codes. */
const EMPLOYEE_LOGIN_ERRORS: Record<string, string> = {
  INVALID_CREDENTIALS: 'بيانات تسجيل الدخول غير صحيحة',
  DEVICE_NOT_REGISTERED: 'هذا الهاتف غير مسجل. راجع المدير لتسجيل جهازك الشخصي.',
  ACTIVE_ATTENDANCE_REQUIRED: 'يجب تسجيل الحضور أولًا قبل الدخول إلى الخدمة الذاتية.',
};

export function EmployeeLoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeLoginFormValues>({
    resolver: zodResolver(employeeLoginFormSchema),
  });

  const login = useMutation({
    mutationFn: async (values: EmployeeLoginFormValues) => {
      // The registered phone must prove itself: fetch a one-time challenge for
      // this installation, sign it via WebAuthn, and attach the proof.
      const marker = installationMarker();
      const { challengeId, options } = await getEmployeeDeviceOptions({
        employeeCode: values.employeeCode,
        installationMarker: marker,
      });
      const response = await startAuthentication({ optionsJSON: options });
      return employeeLogin({
        ...values,
        deviceProof: {
          challengeId,
          installationMarker: marker,
          response: {
            ...response,
            clientExtensionResults: { ...response.clientExtensionResults } as Record<string, unknown>,
          },
        },
      });
    },
    onSuccess: () => onSuccess?.(),
  });

  const serverError =
    login.error instanceof ApiError
      ? (EMPLOYEE_LOGIN_ERRORS[login.error.code] ?? login.error.message)
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
              dir="ltr"
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
              dir="ltr"
              className="tabular"
              aria-invalid={errors.pin ? true : undefined}
              {...register('pin')}
            />
          </Field>

          <Field label="رقم الهاتف الشخصي" htmlFor="personalPhone" required>
            <Input
              id="personalPhone"
              inputMode="numeric"
              dir="ltr"
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
