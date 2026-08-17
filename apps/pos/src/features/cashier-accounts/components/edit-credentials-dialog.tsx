'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { Button, Field, Input, Modal } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import { upsertBranchCashier } from '../api/cashier-accounts-api';
import { cashierAccountQueryKeys } from '../query-keys';
import {
  branchCashierCredentialsFormSchema,
  type BranchCashierCredentialsFormValues,
} from '../schemas/cashier-account-schemas';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

/**
 * Rewrites both halves of a branch login in one step. The branch is fixed — it
 * owns exactly one login — so only the name and password are editable, and the
 * password must be typed fresh because the stored one is never readable.
 */
export function EditCredentialsDialog({
  branchId,
  username,
  onClose,
}: {
  branchId: number;
  username: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BranchCashierCredentialsFormValues>({
    resolver: zodResolver(branchCashierCredentialsFormSchema),
    defaultValues: { branchId, username, password: '' },
  });

  const save = useMutation({
    mutationFn: (values: BranchCashierCredentialsFormValues) => upsertBranchCashier(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cashierAccountQueryKeys.all });
      onClose();
    },
  });

  const formError = errors.username?.message
    ?? errors.password?.message
    ?? serverErrorMessage(save.error);

  return (
    <Modal
      title={`تعديل بيانات دخول ${username}`}
      dismissOnBackdrop={!save.isPending}
      onClose={onClose}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((values) => save.mutate({ ...values, branchId }))}
      >
        <input type="hidden" {...register('branchId')} value={branchId} />
        <Field label="اسم المستخدم" htmlFor="edit-credentials-username" required>
          <Input
            id="edit-credentials-username"
            autoComplete="off"
            aria-invalid={errors.username ? true : undefined}
            {...register('username')}
          />
        </Field>
        <Field label="كلمة المرور الجديدة" htmlFor="edit-credentials-password" required>
          <Input
            id="edit-credentials-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            {...register('password')}
          />
        </Field>
        {formError ? (
          <p role="alert" className="text-[13px] text-danger">
            {formError}
          </p>
        ) : null}
        <p className="text-[12px] text-muted">
          سيُسجَّل خروج الجلسات المفتوحة بهذا الحساب بعد الحفظ.
        </p>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            حفظ
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={save.isPending} onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
