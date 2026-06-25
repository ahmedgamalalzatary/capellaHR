"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/components/ui/select";
import { FileUpload } from "@/shared/components/common/file-upload";
import { useBranches } from "@/features/branches/branches.hooks";
import { useCreateEmployee, useUpdateEmployee } from "@/features/employees/employees.hooks";
import { employeeErrorMessage } from "@/features/employees/employee-error-message";
import {
  employeeCreateFormSchema,
  employeeEditFormSchema,
  type EmployeeCreateFormValues,
  type EmployeeEditFormValues
} from "@/features/employees/employees.schemas";
import type {
  Employee,
  EmployeeCreatePayload,
  EmployeeUpdatePayload
} from "@/features/employees/employees.types";

type EmployeeFormProps = {
  /** When provided the form edits this employee; otherwise it creates one. */
  employee?: Employee;
  onSuccess?: (employee: Employee) => void;
};

/** Create or edit an employee. Creation collects images; editing does not. */
export function EmployeeForm({ employee, onSuccess }: EmployeeFormProps) {
  return employee ? (
    <EditEmployeeForm employee={employee} onSuccess={onSuccess} />
  ) : (
    <CreateEmployeeForm onSuccess={onSuccess} />
  );
}

/** Shared inline error banner for failed submissions. */
function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

function CreateEmployeeForm({ onSuccess }: { onSuccess?: (employee: Employee) => void }) {
  const createEmployee = useCreateEmployee();
  const [formError, setFormError] = useState<string | null>(null);
  const branchesQuery = useBranches({ pageSize: 100 });
  const completedBranches = (branchesQuery.data?.branches.items ?? []).filter(
    (branch) => branch.setupStatus === "completed"
  );

  const form = useForm<EmployeeCreateFormValues>({
    resolver: zodResolver(employeeCreateFormSchema) as Resolver<EmployeeCreateFormValues>,
    defaultValues: {
      fullName: "",
      password: "",
      primaryPhone: "",
      whatsappPhone: "",
      email: "",
      age: "" as unknown as number,
      address: "",
      currentMonthlySalary: "" as unknown as number,
      branchId: undefined as unknown as number,
      personalPhoto: undefined as unknown as File,
      idFront: undefined as unknown as File,
      idBack: undefined as unknown as File
    }
  });

  function onSubmit(values: EmployeeCreateFormValues) {
    setFormError(null);
    const payload: EmployeeCreatePayload = {
      fullName: values.fullName,
      password: values.password,
      primaryPhone: values.primaryPhone,
      whatsappPhone: values.whatsappPhone,
      email: values.email || undefined,
      branchId: values.branchId,
      age: values.age,
      currentMonthlySalary: String(values.currentMonthlySalary),
      address: values.address,
      personalPhoto: values.personalPhoto,
      idFront: values.idFront,
      idBack: values.idBack
    };

    createEmployee.mutate(payload, {
      onSuccess: ({ employee }) => onSuccess?.(employee),
      onError: (error) => {
        const message = employeeErrorMessage(error);
        setFormError(message);
        toast.error(message);
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <EmployeeTextFields form={form} />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>كلمة المرور</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="branchId"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>الفرع</FormLabel>
              <Select
                value={field.value ? String(field.value) : undefined}
                onValueChange={(value) => field.onChange(Number(value))}
              >
                <FormControl>
                  <SelectTrigger aria-label="الفرع">
                    <SelectValue placeholder="اختر الفرع" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {completedBranches.map((branch) => (
                    <SelectItem key={branch.id} value={String(branch.id)}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage>{fieldState.error?.message}</FormMessage>
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="personalPhoto"
            render={({ field, fieldState }) => (
              <FileUpload
                label="الصورة الشخصية"
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <FormField
            control={form.control}
            name="idFront"
            render={({ field, fieldState }) => (
              <FileUpload
                label="صورة الهوية (أمامي)"
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
          <FormField
            control={form.control}
            name="idBack"
            render={({ field, fieldState }) => (
              <FileUpload
                label="صورة الهوية (خلفي)"
                value={field.value ?? null}
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </div>

        <Button type="submit" disabled={createEmployee.isPending}>
          {createEmployee.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </form>
    </Form>
  );
}

function EditEmployeeForm({
  employee,
  onSuccess
}: {
  employee: Employee;
  onSuccess?: (employee: Employee) => void;
}) {
  const updateEmployee = useUpdateEmployee();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<EmployeeEditFormValues>({
    resolver: zodResolver(employeeEditFormSchema) as Resolver<EmployeeEditFormValues>,
    defaultValues: {
      fullName: employee.fullName,
      password: "",
      primaryPhone: employee.primaryPhone,
      whatsappPhone: employee.whatsappPhone,
      email: employee.email ?? "",
      age: employee.age,
      address: employee.address,
      currentMonthlySalary: Number(employee.currentMonthlySalary)
    }
  });

  function onSubmit(values: EmployeeEditFormValues) {
    setFormError(null);
    const input: EmployeeUpdatePayload = {
      fullName: values.fullName,
      primaryPhone: values.primaryPhone,
      whatsappPhone: values.whatsappPhone,
      email: values.email || undefined,
      age: values.age,
      address: values.address,
      currentMonthlySalary: String(values.currentMonthlySalary)
    };
    if (values.password) {
      input.password = values.password;
    }

    updateEmployee.mutate(
      { employeeId: employee.id, input },
      {
        onSuccess: ({ employee: updated }) => onSuccess?.(updated),
        onError: (error) => {
          const message = employeeErrorMessage(error);
          setFormError(message);
          toast.error(message);
        }
      }
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormError message={formError} />

        <EmployeeTextFields form={form} />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>كلمة المرور الجديدة (اختياري)</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={updateEmployee.isPending}>
          {updateEmployee.isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </form>
    </Form>
  );
}

/**
 * The text fields common to creating and editing an employee. Typed loosely so
 * it can drive either form's `useForm` instance (the field names match in both).
 */
function EmployeeTextFields({
  form
}: {
  // Both form value shapes share these field names.
  form: ReturnType<typeof useForm<EmployeeCreateFormValues>> | ReturnType<typeof useForm<EmployeeEditFormValues>>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared across two form value shapes with identical field names
  const control = form.control as any;

  return (
    <>
      <FormField
        control={control}
        name="fullName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>الاسم الكامل</FormLabel>
            <FormControl>
              <Input placeholder="الاسم الكامل" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="primaryPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>رقم الهاتف</FormLabel>
              <FormControl>
                <Input dir="ltr" placeholder="01012345678" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="whatsappPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>رقم واتساب</FormLabel>
              <FormControl>
                <Input dir="ltr" placeholder="01012345678" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>البريد الإلكتروني (اختياري)</FormLabel>
            <FormControl>
              <Input type="email" dir="ltr" placeholder="name@example.com" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="age"
          render={({ field }) => (
            <FormItem>
              <FormLabel>العمر</FormLabel>
              <FormControl>
                <Input type="number" dir="ltr" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="currentMonthlySalary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>الراتب الشهري</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" dir="ltr" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="address"
        render={({ field }) => (
          <FormItem>
            <FormLabel>العنوان</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="العنوان التفصيلي" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
