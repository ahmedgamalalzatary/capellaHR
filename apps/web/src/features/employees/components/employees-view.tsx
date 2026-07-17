'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm, type FieldError } from 'react-hook-form';

import { Button, Card, CardContent, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { listBranches } from '../../branches/api/branches-api';
import {
  createEmployee,
  deleteEmployee,
  listEmployees,
  updateEmployee,
  type Employee,
  type EmployeeImageKind,
} from '../api/employees-api';
import {
  employeeCreateFormSchema,
  employeeUpdateFormSchema,
  type EmployeeCreateFormValues,
  type EmployeeUpdateFormValues,
} from '../schemas/employee-form';

type CreateFormInput = import('zod').input<typeof employeeCreateFormSchema>;
type UpdateFormInput = import('zod').input<typeof employeeUpdateFormSchema>;

const PAGE_SIZE = 20;
const EMPLOYEES_QUERY_KEY = 'employees';
const IMAGE_FIELDS: { kind: EmployeeImageKind; label: string }[] = [
  { kind: 'personal', label: 'الصورة الشخصية' },
  { kind: 'idFront', label: 'صورة البطاقة (وجه)' },
  { kind: 'idBack', label: 'صورة البطاقة (ظهر)' },
];

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

interface BranchOption {
  id: number;
  name: string;
}

/** register()-compatible props for the shared text fields of both forms. */
interface EmployeeFieldsApi {
  register: (name: never) => Record<string, unknown>;
  errors: Partial<Record<string, FieldError | undefined>>;
}

function TextField({
  form,
  name,
  label,
  ltr = false,
  type = 'text',
}: {
  form: EmployeeFieldsApi;
  name: string;
  label: string;
  ltr?: boolean;
  type?: string;
}) {
  return (
    <Field label={label} htmlFor={`employee-${name}`} required error={form.errors[name]?.message}>
      <Input
        id={`employee-${name}`}
        type={type}
        {...(ltr ? { dir: 'ltr' as const, className: 'tabular' } : {})}
        {...form.register(name as never)}
      />
    </Field>
  );
}

function ImageField({
  kind,
  label,
  required,
  error,
  onSelect,
}: {
  kind: EmployeeImageKind;
  label: string;
  required: boolean;
  error: string | undefined;
  onSelect: (file: File | undefined) => void;
}) {
  return (
    <Field label={label} htmlFor={`employee-image-${kind}`} required={required} error={error}>
      <Input
        id={`employee-image-${kind}`}
        type="file"
        accept="image/*"
        onChange={(event) => onSelect(event.target.files?.[0])}
      />
    </Field>
  );
}

function CreateEmployeeForm({ branches, onDone }: { branches: BranchOption[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreateFormInput, unknown, EmployeeCreateFormValues>({
    resolver: zodResolver(employeeCreateFormSchema),
  });

  const save = useMutation({
    mutationFn: (values: EmployeeCreateFormValues) => createEmployee(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [EMPLOYEES_QUERY_KEY] });
      onDone();
    },
  });

  const form = { register, errors } as unknown as EmployeeFieldsApi;

  return (
    <Card>
      <CardContent className="py-5">
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
            <TextField form={form} name="personalPhone" label="الهاتف الشخصي" ltr />
            <TextField form={form} name="whatsappPhone" label="هاتف واتساب" ltr />
            <TextField form={form} name="pin" label="الرقم السري (PIN)" ltr type="password" />
            <TextField form={form} name="age" label="العمر" ltr />
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
            <TextField form={form} name="shiftDurationMinutes" label="مدة الوردية (دقيقة)" ltr />
            <TextField form={form} name="monthlyBaseSalary" label="الراتب الأساسي (جنيه)" ltr />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {IMAGE_FIELDS.map(({ kind, label }) => (
              <ImageField
                key={kind}
                kind={kind}
                label={label}
                required
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
      </CardContent>
    </Card>
  );
}

function EditEmployeeForm({
  employee,
  branchName,
  onDone,
}: {
  employee: Employee;
  branchName: string | undefined;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<UpdateFormInput, unknown, EmployeeUpdateFormValues>({
    resolver: zodResolver(employeeUpdateFormSchema),
    defaultValues: {
      fullName: employee.fullName,
      personalPhone: employee.personalPhone,
      whatsappPhone: employee.whatsappPhone,
      age: employee.age,
      address: employee.address,
      shiftDurationMinutes: employee.shiftDurationMinutes,
      pin: '',
    },
  });

  const save = useMutation({
    mutationFn: (values: EmployeeUpdateFormValues) => updateEmployee(employee.id, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [EMPLOYEES_QUERY_KEY] });
      onDone();
    },
  });

  const form = { register, errors } as unknown as EmployeeFieldsApi;

  return (
    <Card>
      <CardContent className="py-5">
        <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4">
          <p className="text-[13px] text-muted">
            كود الموظف <span className="tabular">{employee.employeeCode}</span>
            {branchName ? <> — الفرع: {branchName}</> : null} (الكود والفرع والراتب الأساسي غير قابلة للتعديل)
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="fullName" label="الاسم الكامل" />
            <Field label="العنوان" htmlFor="employee-address" required error={errors.address?.message}>
              <Input id="employee-address" {...register('address')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField form={form} name="personalPhone" label="الهاتف الشخصي" ltr />
            <TextField form={form} name="whatsappPhone" label="هاتف واتساب" ltr />
            <Field
              label="رقم سري جديد (اختياري)"
              htmlFor="employee-pin"
              error={errors.pin?.message}
            >
              <Input id="employee-pin" dir="ltr" type="password" className="tabular" {...register('pin')} />
            </Field>
            <TextField form={form} name="age" label="العمر" ltr />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField form={form} name="shiftDurationMinutes" label="مدة الوردية (دقيقة)" ltr />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
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
      </CardContent>
    </Card>
  );
}

export function EmployeesView() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const employeesQuery = useQuery({
    queryKey: [EMPLOYEES_QUERY_KEY, { search, branchFilter, page }],
    queryFn: () =>
      listEmployees({
        ...(search ? { search } : {}),
        ...(branchFilter !== null ? { branchId: branchFilter } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage, pageSize: 100 })),
  });
  const branches: BranchOption[] = branchesQuery.data ?? [];
  const branchNameOf = (id: number) => branches.find((branch) => branch.id === id)?.name;

  const removal = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: [EMPLOYEES_QUERY_KEY] });
    },
  });

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const items = employeesQuery.data?.items ?? [];
  const meta = employeesQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            role="search"
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="ابحث بالاسم أو الهاتف أو الكود…"
              className="w-56"
            />
            <Button type="submit" variant="secondary" size="sm">
              <Search className="size-4" aria-hidden />
              بحث
            </Button>
          </form>
          <select
            aria-label="تصفية حسب الفرع"
            className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
            value={branchFilter ?? ''}
            onChange={(event) => {
              setPage(1);
              setBranchFilter(event.target.value === '' ? null : Number(event.target.value));
            }}
          >
            <option value="">كل الفروع</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </div>

        <Button
          size="sm"
          disabled={branchesQuery.isPending || branchesQuery.isError || branches.length === 0}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          إضافة موظف
        </Button>
      </div>

      {branchesQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-danger">
          <span>تعذر تحميل الفروع، ولا يمكن إضافة موظف بدونها.</span>
          <Button variant="secondary" size="sm" onClick={() => void branchesQuery.refetch()}>
            إعادة تحميل الفروع
          </Button>
        </div>
      ) : null}

      {creating ? <CreateEmployeeForm branches={branches} onDone={closeForm} /> : null}
      {editing ? (
        <EditEmployeeForm
          key={editing.id}
          employee={editing}
          branchName={branchNameOf(editing.branchId)}
          onDone={closeForm}
        />
      ) : null}

      {removal.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(removal.error)}
        </p>
      ) : null}

      <Card>
        {employeesQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الموظفين…</div>
        ) : employeesQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الموظفين"
            description={serverErrorMessage(employeesQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void employeesQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا يوجد موظفون بعد"
            description={
              search || branchFilter !== null
                ? 'لا توجد نتائج مطابقة للبحث أو التصفية.'
                : 'ابدأ بإضافة أول موظف للشركة.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الكود</th>
                  <th className="px-4 py-2.5 text-start font-medium">الاسم</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium sm:table-cell">الهاتف</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الفرع</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium lg:table-cell">الوردية</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium lg:table-cell">الراتب الأساسي</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((employee) => (
                  <tr key={employee.id} className="border-b border-line/60 last:border-b-0">
                    <td className="px-4 py-3">
                      <span className="tabular" dir="ltr">{employee.employeeCode}</span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                        {employee.fullName}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span className="tabular" dir="ltr">{employee.personalPhone}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {branchNameOf(employee.branchId) ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="tabular" dir="ltr">{employee.shiftDurationMinutes} د</span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="tabular" dir="ltr">{employee.monthlyBaseSalary} ج</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCreating(false);
                            setConfirmDeleteId(null);
                            setEditing(employee);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                          تعديل
                        </Button>
                        {confirmDeleteId === employee.id ? (
                          <>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={removal.isPending}
                              onClick={() => removal.mutate(employee.id)}
                            >
                              تأكيد الحذف
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                              إلغاء
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(employee.id)}>
                            <Trash2 className="size-4" aria-hidden />
                            حذف
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
            {' — '}
            <span className="tabular">{meta.total}</span> موظف
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              السابق
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              التالي
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
