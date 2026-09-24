'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';

import { Button, Field, Input } from '@capella/ui';

import { notifyError, notifySuccess } from '@/lib/notify';

import { updateEmployee, type Employee } from '../api/employees-api';
import {
  employeeUpdateFormSchema,
  type EmployeeUpdateFormValues,
} from '../schemas/employee-form';
import { employeeQueryKeys } from '../query-keys';
import { EmployeeFaceCapture } from './employee-face-capture';
import {
  IMAGE_FIELDS,
  ImageField,
  SavedEmployeeImage,
  TextField,
  serverErrorMessage,
  type BranchOption,
  type EmployeeFieldsApi,
} from './employee-form-fields';

type UpdateFormInput = import('zod').input<typeof employeeUpdateFormSchema>;

export function EditEmployeeForm({
  employee,
  branches,
  onDone,
}: {
  employee: Employee;
  branches: BranchOption[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<UpdateFormInput, unknown, EmployeeUpdateFormValues>({
    resolver: zodResolver(employeeUpdateFormSchema),
    defaultValues: {
      fullName: employee.fullName,
      personalPhone: employee.personalPhone,
      whatsappPhone: employee.whatsappPhone,
      age: employee.age,
      address: employee.address,
      branchId: employee.branchId,
      shiftDurationMinutes: employee.shiftDurationMinutes,
      pin: '',
    },
  });

  const save = useMutation({
    mutationFn: (values: EmployeeUpdateFormValues) => updateEmployee(employee.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
      notifySuccess('تم حفظ التعديل بنجاح.');
      onDone();
    },
    onError: (error: unknown) => notifyError(error),
  });

  const form = { register, errors } as unknown as EmployeeFieldsApi;
  const personalFile = (useWatch({ control, name: 'personal' }) as File | undefined) ?? null;

  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4">
      <p className="text-[13px] text-muted">
        كود الموظف <span className="tabular">{employee.employeeCode}</span>
        {' '}— الكود والراتب الأساسي غير قابلين للتعديل
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField form={form} name="fullName" label="الاسم الكامل" />
        <Field label="الفرع" htmlFor="employee-edit-branchId" required error={errors.branchId?.message}>
          <select
            id="employee-edit-branchId"
            className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
            {...register('branchId')}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="العنوان" htmlFor="employee-address" required error={errors.address?.message}>
        <Input id="employee-address" {...register('address')} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField form={form} name="personalPhone" label="الهاتف الشخصي" />
        <TextField form={form} name="whatsappPhone" label="هاتف واتساب" />
        <Field
          label="رقم سري جديد"
          htmlFor="employee-pin"
          error={errors.pin?.message}
        >
          <Input id="employee-pin" type="password" className="tabular" {...register('pin')} />
        </Field>
        <TextField form={form} name="age" label="العمر" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField form={form} name="shiftDurationMinutes" label="مدة الوردية (دقيقة)" />
      </div>

      <Field label="استبدال صورة الوجه" htmlFor="employee-face-capture" error={errors.personal?.message}>
        <EmployeeFaceCapture
          value={personalFile}
          onChange={(file) => setValue('personal', file as File, { shouldValidate: true })}
          disabled={save.isPending}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {IMAGE_FIELDS.map(({ kind, label }) => (
          <SavedEmployeeImage
            key={kind}
            employee={employee}
            kind={kind}
            label={label}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {IMAGE_FIELDS.map(({ kind, label }) => (
          <ImageField
            key={kind}
            kind={kind}
            label={`${label} (استبدال اختياري)`}
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
