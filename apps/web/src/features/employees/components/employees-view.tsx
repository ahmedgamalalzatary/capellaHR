'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, PowerOff, Search, Trash2, UserRound, Wallet } from 'lucide-react';
import { useState } from 'react';

import { Button, Card, ConfirmDialog, EmptyState, Input, Modal, SmartPagination } from '@capella/ui';

import { notifyError, notifySuccess } from '@/lib/notify';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { DeactivationDialog, type EmployeeDeparture } from './deactivation-dialog';
import { EmployeeSettlementPanel } from './employee-settlement-panel';
import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import {
  activateEmployee,
  deactivateEmployee,
  deleteEmployee,
  listEmployees,
  previewEmployeeDeactivation,
  type AdvanceDecision,
  type Employee,
  type EmployeeDeactivationPreview,
  type NegativeBalanceDecision,
} from '../api/employees-api';
import { employeeQueryKeys } from '../query-keys';
import { CreateEmployeeForm } from './create-employee-form';
import { EditEmployeeForm } from './edit-employee-form';
import { serverErrorMessage, type BranchOption } from './employee-form-fields';

export function EmployeesView() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<Employee | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const employeesQuery = useQuery({
    queryKey: employeeQueryKeys.list({ search, branchFilter, page }),
    queryFn: () =>
      listEmployees({
        ...(search ? { search } : {}),
        ...(branchFilter !== null ? { branchId: branchFilter } : {}),
        page,
        status: 'all',
      }),
  });

  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });
  const branches: BranchOption[] = branchesQuery.data ?? [];
  const branchNameOf = (id: number) => branches.find((branch) => branch.id === id)?.name;

  const removal = useMutation({
    mutationFn: deleteEmployee,
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
      notifySuccess('تم حذف الموظف.');
    },
    onError: (error: unknown) => notifyError(error),
  });
  // Deactivation is a guided decision, so the preview is loaded first and the dialog drives the
  // rest; reactivation has nothing to decide and applies straight away.
  const [deactivating, setDeactivating] = useState<
    { employee: Employee; preview: EmployeeDeactivationPreview } | null
  >(null);

  const reactivation = useMutation({
    mutationFn: (employee: Employee) => activateEmployee(employee.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
      notifySuccess('تمت إعادة تفعيل الموظف.');
    },
    onError: (error: unknown) => notifyError(error),
  });

  const startDeactivation = useMutation({
    mutationFn: async (employee: Employee) => ({
      employee,
      preview: await previewEmployeeDeactivation(employee.id),
    }),
    onSuccess: setDeactivating,
    onError: (error: unknown) => notifyError(error),
  });

  const deactivation = useMutation({
    mutationFn: ({ employee, preview, advanceDecision, negativeBalanceDecision, departure }: {
      employee: Employee;
      preview: EmployeeDeactivationPreview;
      advanceDecision: AdvanceDecision;
      negativeBalanceDecision: NegativeBalanceDecision | undefined;
      departure: EmployeeDeparture;
    }) => deactivateEmployee(employee.id, advanceDecision, negativeBalanceDecision, preview, departure),
    onSuccess: async () => {
      setDeactivating(null);
      await queryClient.invalidateQueries({ queryKey: employeeQueryKeys.all });
      notifySuccess('تم إيقاف الموظف.');
    },
    onError: (error: unknown) => notifyError(error),
  });

  const employmentStateError = reactivation.error
    ?? startDeactivation.error
    ?? deactivation.error;
  const employmentStatePending = reactivation.isPending
    || startDeactivation.isPending
    || deactivation.isPending;

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

      {creating ? (
        <Modal title="موظف جديد" className="max-h-[90dvh] max-w-xl overflow-y-auto" onClose={closeForm}>
          <CreateEmployeeForm branches={branches} onDone={closeForm} />
        </Modal>
      ) : editing ? (
        <Modal title={`تعديل الموظف — ${editing.fullName}`} className="max-h-[90dvh] max-w-xl overflow-y-auto" onClose={closeForm}>
          <EditEmployeeForm
            key={editing.id}
            employee={editing}
            branches={branches}
            onDone={closeForm}
          />
        </Modal>
      ) : null}

      {removal.error || employmentStateError ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(removal.error ?? employmentStateError)}
        </p>
      ) : null}

      {confirmDeleteId !== null ? (
        <ConfirmDialog
          title="حذف الموظف"
          description="سيتم إخفاء الموظف مع الاحتفاظ بسجلاته. لا يمكن التراجع عن الحذف."
          confirmLabel="تأكيد الحذف"
          tone="danger"
          pending={removal.isPending}
          onConfirm={() => removal.mutate(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      ) : null}

      {deactivating ? (
        <DeactivationDialog
          key={deactivating.employee.id}
          employee={deactivating.employee}
          preview={deactivating.preview}
          pending={deactivation.isPending}
          onCancel={() => setDeactivating(null)}
          onConfirm={(advanceDecision, negativeBalanceDecision, departure) => deactivation.mutate({
            ...deactivating,
            advanceDecision,
            negativeBalanceDecision,
            departure,
          })}
        />
      ) : null}

      {settling ? (
        <EmployeeSettlementPanel employee={settling} onClose={() => setSettling(null)} />
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
                      <span className="tabular">{employee.employeeCode}</span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                        {employee.fullName}
                        {employee.employmentStatus === 'inactive' ? (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-normal text-danger">
                            غير نشط
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <span className="tabular">{employee.personalPhone}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {branchNameOf(employee.branchId) ?? '—'}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="tabular">{employee.shiftDurationMinutes} د</span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="tabular">{employee.monthlyBaseSalary} ج</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={employmentStatePending}
                          onClick={() => {
                            if (employee.employmentStatus === 'inactive') reactivation.mutate(employee);
                            else startDeactivation.mutate(employee);
                          }}
                        >
                          {employee.employmentStatus === 'active'
                            ? <PowerOff className="size-4" aria-hidden />
                            : <Power className="size-4" aria-hidden />}
                          {employee.employmentStatus === 'active' ? 'تعطيل' : 'تفعيل'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSettling(employee)}
                        >
                          <Wallet className="size-4" aria-hidden />
                          التسوية
                        </Button>
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
                        {confirmDeleteId === employee.id ? null : (
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
        <SmartPagination
          page={meta.page}
          totalPages={meta.totalPages}
          onPage={setPage}
          summary={
            <>
              صفحة <span className="tabular">{meta.page}</span> من <span className="tabular">{meta.totalPages}</span>
              {' — '}
              <span className="tabular">{meta.total}</span> موظف
            </>
          }
        />
      ) : null}
    </div>
  );
}
