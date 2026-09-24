'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';

import { Button, Field, Input } from '@capella/ui';

import { notifyError, notifySuccess } from '@/lib/notify';

import { createEmployee } from '../api/employees-api';
import {
  employeeCreateFormSchema,
  type EmployeeCreateFormValues,
} from '../schemas/employee-form';
import { employeeQueryKeys } from '../query-keys';
import { EmployeeFaceCapture } from './employee-face-capture';
import {
  IMAGE_FIELDS,
  ImageField,
  TextField,
  serverErrorMessage,
  type BranchOption,
  type EmployeeFieldsApi,
} from './employee-form-fields';

type CreateFormInput = import('zod').input<typeof employeeCreateFormSchema>;

export function CreateEmployeeForm({ branches, onDone }: { branches: BranchOption[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<CreateFormInput, unknown, EmployeeCreateFormValues>({
    resolver: zodResolver(employeeCreateFormSchema),
  });

  const save = useMutation({
    mutationFn: (values: EmployeeCreateFormValues) => createEmployee(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
      notifySuccess('تمت إضافة الموظف بنجاح.');
      onDone();
    },
    onError: (error: unknown) => notifyError(error),
  });

  const form = { register, errors } as unknown as EmployeeFieldsApi;
  const personalFile = (useWatch({ control, name: 'personal' }) as File | undefined) ?? null;

  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="fullName" label="الاسم الكامل" />
        <Field label="الفرع" htmlFor="employee-branchId" required error={errors.branchId?.message}>
          <select
            id="employee-branchId"
            className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
            defaultValue=""
            {...register('branchId')}
          >
            <option value="" disabled>
              اختر الفرع…
            </option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField form={form} name="personalPhone" label="الهاتف الشخصي" />
        <TextField form={form} name="whatsappPhone" label="هاتف واتساب" />
        <TextField form={form} name="pin" label="الرقم السري (PIN)" type="password" />
        <TextField form={form} name="age" label="العمر" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="العنوان"
          htmlFor="employee-address"
          required
          error={errors.address?.message}
          className="sm:col-span-2"
        >
          <Input id="employee-address" {...register('address')} />
        </Field>
        <TextField form={form} name="shiftDurationMinutes" label="مدة الوردية (دقيقة)" />
        <TextField form={form} name="monthlyBaseSalary" label="الراتب الأساسي (جنيه)" />
      </div>

      <Field label="صورة الوجه" htmlFor="employee-face-capture" required error={errors.personal?.message}>
        <EmployeeFaceCapture
          value={personalFile}
          onChange={(file) => setValue('personal', file as File, { shouldValidate: true })}
          disabled={save.isPending}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {IMAGE_FIELDS.map(({ kind, label }) => (
          <ImageField
            key={kind}
            kind={kind}
            label={label}
            required={false}
            error={errors[kind]?.message}
            onSelect={(file) => setValue(kind, file as File, { shouldValidate: true })}
          />
        ))}
      </div>

      {save.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(save.error)}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الموظف'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          إلغاء
        </Button>
      </div>
    </form>
  );
}
