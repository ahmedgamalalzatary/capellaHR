'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { SectionHeading } from '@/components/layout/page-header';

import { type Supplier } from '../api/suppliers-api';
import { errorText } from './supplier-purchase-money';

export function SupplierListSection({
  suppliers,
  supplierPage,
  setSupplierPage,
  supplierSearch,
  setSupplierSearch,
  supplierStatus,
  setSupplierStatus,
  branchScope,
  commandPending,
  toggleSupplier,
  openNewSupplier,
  onEdit,
  onToggle,
}: {
  suppliers: UseQueryResult<{ items: Supplier[]; meta: { totalPages: number } }>;
  supplierPage: number;
  setSupplierPage: (value: number | ((page: number) => number)) => void;
  supplierSearch: string;
  setSupplierSearch: (value: string) => void;
  supplierStatus: string;
  setSupplierStatus: (value: string) => void;
  branchScope: object;
  commandPending: boolean;
  toggleSupplier: { isError: boolean; error: unknown; mutate: (supplier: Supplier) => void };
  openNewSupplier: () => void;
  onEdit: (supplier: Supplier) => void;
  onToggle: (supplier: Supplier) => void;
}) {
  return (
    <Card className="overflow-hidden shadow-card">
      <CardContent className="p-4 sm:p-5">
        <SectionHeading
          title="إدارة الموردين"
          description="المورد الموقوف يبقى في السجل ولا يظهر في مشتريات جديدة."
        />
        {toggleSupplier.isError ? <FieldError>{errorText(toggleSupplier.error)}</FieldError> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-search">بحث في الموردين</Label>
            <Input
              id="supplier-search"
              aria-label="بحث في الموردين"
              placeholder="اسم المورد أو الهاتف"
              value={supplierSearch}
              onChange={(event) => setSupplierSearch(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-status">حالة المورد</Label>
            <Select
              id="supplier-status"
              aria-label="تصفية حسب حالة المورد"
              value={supplierStatus}
              onChange={(event) => setSupplierStatus(event.target.value)}
            >
              <option value="">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">متوقف</option>
            </Select>
          </div>
        </div>
      </CardContent>

      {suppliers.isError ? (
        <EmptyState title="تعذر تحميل الموردين" action={<Button onClick={() => void suppliers.refetch()}>إعادة المحاولة</Button>} />
      ) : suppliers.isPending ? (
        <LoadingState label="جارٍ تحميل الموردين…" className="py-16" />
      ) : !suppliers.data.items.length ? (
        <EmptyState
          title="لا يوجد موردون بعد"
          action={
            <Button size="sm" disabled={commandPending} onClick={openNewSupplier}>
              <Plus className="size-4" aria-hidden />
              إضافة أول مورد
            </Button>
          }
        />
      ) : (
        <>
        <DataTable className="border-t border-line/70">
          <THead>
            <TH>المورد</TH>
            <TH>الهاتف</TH>
            <TH>الحالة</TH>
            <TH>الإجراءات</TH>
          </THead>
          <tbody>
            {suppliers.data.items.map((supplier) => (
              <TR key={supplier.id}>
                <TD className="font-medium">{supplier.name}</TD>
                <TD className="tabular text-muted">{supplier.phone ?? '—'}</TD>
                <TD>
                  <Badge variant={supplier.isActive ? 'success' : 'neutral'}>
                    {supplier.isActive ? 'نشط' : 'متوقف'}
                  </Badge>
                </TD>
                <TD>
                  <RowActions>
                    <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => onEdit(supplier)}>تعديل</Button>
                    <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => onToggle(supplier)}>
                      {supplier.isActive ? 'إيقاف' : 'تفعيل'}
                    </Button>
                  </RowActions>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
        <Pagination summary={<>صفحة <span className="tabular">{supplierPage}</span></>} previousDisabled={supplierPage <= 1} nextDisabled={supplierPage >= (suppliers.data?.meta.totalPages ?? 1)} onPrevious={() => setSupplierPage((page) => page - 1)} onNext={() => setSupplierPage((page) => page + 1)} page={supplierPage} totalPages={suppliers.data?.meta.totalPages ?? 1} onPage={setSupplierPage} persistenceKey="pos:suppliers:list" resultSetKey={JSON.stringify(branchScope)} />
        </>
      )}
    </Card>
  );
}
