'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { listCatalogBranches } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import {
  createFixedAsset,
  deleteFixedAsset,
  listFixedAssets,
  updateFixedAsset,
  type FixedAsset,
} from '../api/fixed-assets-api';
import { fixedAssetQueryKeys } from '../query-keys';

const errorText = (error: unknown) => error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية. حاول مرة أخرى.';

const conditionLabels = {
  good: 'جيدة',
  needs_repair: 'تحتاج صيانة',
  broken: 'تالفة',
} as const;
const conditionTones = {
  good: 'success',
  needs_repair: 'warning',
  broken: 'danger',
} as const;

/**
 * Worked out for display instead of being stored, so the total can never
 * disagree with the count and the price it came from. A line missing either of
 * them has no total to show, which is a real answer here and not a zero.
 */
const totalValue = (asset: FixedAsset) => {
  if (asset.quantity === null || asset.unitPrice === null) return null;
  const cents = BigInt(asset.unitPrice.replace('.', '')) * BigInt(asset.quantity);
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`;
};

const emptyForm = {
  name: '', quantity: '', unitPrice: '', location: '', note: '', purchasedOn: '',
  condition: '' as '' | keyof typeof conditionLabels,
};

/**
 * The branch's fixed-assets register: the chairs, mirrors and machines it owns
 * rather than sells. Deliberately a standalone note — no sale, stock movement or
 * report reads it — so a line is edited and deleted outright.
 */
export function FixedAssetsView() {
  const client = useQueryClient();
  const [branchId, setBranchId] = useState<number>();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [successMessage, setSuccessMessage] = useState<string>();

  const branches = useQuery({
    queryKey: ['fixed-asset-branches'],
    queryFn: () => fetchAllPages((branchesPage) => listCatalogBranches(branchesPage)),
  });
  const scopeReady = branchId !== undefined;
  const params = {
    ...(branchId === undefined ? {} : { branchId }),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    pageSize: 20,
  };
  const assets = useQuery({
    queryKey: fixedAssetQueryKeys.list(params),
    queryFn: () => listFixedAssets(params),
    enabled: scopeReady,
  });
  const refresh = () => client.invalidateQueries({ queryKey: fixedAssetQueryKeys.all });

  const set = (field: keyof typeof emptyForm) => (value: string) => setForm((current) => ({ ...current, [field]: value }));
  const clearForm = () => { setEditing(null); setForm(emptyForm); create.reset(); edit.reset(); };
  /** An untouched field is left out entirely, so it stays unwritten rather than becoming a zero. */
  const payload = () => ({
    ...(branchId === undefined ? {} : { branchId }),
    name: form.name.trim(),
    ...(form.quantity ? { quantity: Number(form.quantity) } : {}),
    ...(form.unitPrice ? { unitPrice: form.unitPrice } : {}),
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.note.trim() ? { note: form.note.trim() } : {}),
    ...(form.purchasedOn ? { purchasedOn: form.purchasedOn } : {}),
    ...(form.condition ? { condition: form.condition } : {}),
  });

  const create = useMutation({
    mutationFn: () => createFixedAsset(payload()),
    onSuccess: async () => { setForm(emptyForm); setSuccessMessage('تمت إضافة الأصل.'); await refresh(); },
  });
  const edit = useMutation({
    mutationFn: () => updateFixedAsset(editing!.id, payload()),
    onSuccess: async () => { clearForm(); setSuccessMessage('تم حفظ التعديل.'); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: () => deleteFixedAsset(deleting!.id, branchId),
    onSuccess: async () => { setDeleting(null); setSuccessMessage('تم حذف الأصل.'); await refresh(); },
  });

  const beginEdit = (asset: FixedAsset) => {
    create.reset(); edit.reset();
    setEditing(asset);
    setForm({
      name: asset.name,
      quantity: asset.quantity === null ? '' : String(asset.quantity),
      unitPrice: asset.unitPrice ?? '',
      location: asset.location,
      note: asset.note,
      purchasedOn: asset.purchasedOn ?? '',
      condition: asset.condition ?? '',
    });
  };

  const commandPending = create.isPending || edit.isPending || remove.isPending;
  const canSubmit = scopeReady && form.name.trim().length > 0 && !commandPending;

  return (
    <section className="space-y-6">
      <PageHeader
        title="الأصول الثابتة"
        description="سجل ما يملكه الفرع من كراسي وأجهزة ومعدات. سجل للاطلاع فقط، لا يؤثر على المبيعات أو المخزون."
      />
      {successMessage ? <SuccessState message={successMessage} /> : null}

      <Card className="shadow-card">
        <CardContent className="p-4 sm:p-5">
          {branches.isError ? (
            <EmptyState
              title="تعذر تحميل الفروع"
              className="py-8"
              action={<Button onClick={() => void branches.refetch()}>إعادة المحاولة</Button>}
            />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="asset-branch">الفرع</Label>
              <Select
                id="asset-branch"
                className="max-w-sm"
                value={branchId ?? ''}
                disabled={commandPending}
                onChange={(event) => {
                  if (commandPending) return;
                  setBranchId(event.target.value ? Number(event.target.value) : undefined);
                  clearForm();
                  setDeleting(null);
                  setSearch('');
                  setPage(1);
                }}
              >
                <option value="">اختر الفرع</option>
                {branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {!scopeReady ? (
        <Card className="shadow-card">
          <EmptyState title="اختر فرعًا لعرض أصوله الثابتة" />
        </Card>
      ) : (
        <>
          <Card className="shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <SectionHeading
                title={editing ? `تعديل ${editing.name}` : 'إضافة أصل'}
                description="الاسم وحده مطلوب؛ اكتب ما تريد تذكره واترك الباقي فارغًا."
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="asset-name">اسم الأصل</Label>
                  <Input id="asset-name" aria-label="اسم الأصل" disabled={commandPending} value={form.name} onChange={(event) => set('name')(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-quantity">الكمية</Label>
                  <Input id="asset-quantity" aria-label="الكمية" type="number" min="1" className="text-start" disabled={commandPending} value={form.quantity} onChange={(event) => set('quantity')(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-price">سعر القطعة</Label>
                  <Input id="asset-price" aria-label="سعر القطعة" inputMode="decimal" className="text-start" disabled={commandPending} value={form.unitPrice} onChange={(event) => set('unitPrice')(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-location">المكان</Label>
                  <Input id="asset-location" aria-label="المكان" disabled={commandPending} value={form.location} onChange={(event) => set('location')(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-purchased">تاريخ الشراء</Label>
                  <Input id="asset-purchased" aria-label="تاريخ الشراء" type="date" disabled={commandPending} value={form.purchasedOn} onChange={(event) => set('purchasedOn')(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asset-condition">الحالة</Label>
                  <Select id="asset-condition" aria-label="الحالة" disabled={commandPending} value={form.condition} onChange={(event) => set('condition')(event.target.value)}>
                    <option value="">غير محددة</option>
                    <option value="good">جيدة</option>
                    <option value="needs_repair">تحتاج صيانة</option>
                    <option value="broken">تالفة</option>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="asset-note">ملاحظة</Label>
                  <Input id="asset-note" aria-label="ملاحظة" disabled={commandPending} value={form.note} onChange={(event) => set('note')(event.target.value)} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
                {editing ? (
                  <>
                    <Button disabled={!canSubmit} onClick={() => edit.mutate()}>حفظ التعديل</Button>
                    <Button variant="ghost" disabled={commandPending} onClick={clearForm}>إلغاء</Button>
                  </>
                ) : (
                  <Button disabled={!canSubmit} onClick={() => create.mutate()}>إضافة</Button>
                )}
              </div>

              {(editing ? edit.isError : create.isError) ? (
                <FieldError>{errorText(editing ? edit.error : create.error)}</FieldError>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="space-y-1.5">
                <Label htmlFor="asset-search">بحث</Label>
                <Input
                  id="asset-search"
                  aria-label="بحث"
                  className="max-w-sm"
                  placeholder="بالاسم أو المكان أو الملاحظة"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                />
              </div>
            </CardContent>
          </Card>

          {deleting ? (
            <Card className="shadow-card">
              <CardContent className="space-y-3 p-4 sm:p-5">
                <SectionHeading
                  title={`حذف ${deleting.name}`}
                  description="سيُحذف السطر نهائيًا من السجل ولا يمكن استرجاعه."
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" disabled={commandPending} onClick={() => remove.mutate()}>تأكيد الحذف</Button>
                  <Button variant="ghost" disabled={commandPending} onClick={() => { setDeleting(null); remove.reset(); }}>إلغاء</Button>
                </div>
                {remove.isError ? <FieldError>{errorText(remove.error)}</FieldError> : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden shadow-card">
            {assets.isPending ? <LoadingState label="جارٍ تحميل الأصول…" className="py-16" />
              : assets.isError ? <EmptyState title="تعذر تحميل الأصول" action={<Button onClick={() => void assets.refetch()}>إعادة المحاولة</Button>} />
                : !assets.data?.items.length ? <EmptyState title="لا توجد أصول مسجلة" />
                  : (
                    <>
                      <DataTable>
                        <THead>
                          <TH>الأصل</TH>
                          <TH>المكان</TH>
                          <TH numeric>الكمية</TH>
                          <TH numeric>سعر القطعة</TH>
                          <TH numeric>الإجمالي</TH>
                          <TH>الحالة</TH>
                          <TH>الإجراء</TH>
                        </THead>
                        <tbody>
                          {assets.data.items.map((asset) => {
                            const total = totalValue(asset);
                            return (
                              <TR key={asset.id}>
                                <TD className="font-medium">
                                  {asset.name}
                                  {asset.note ? <span className="block text-xs text-muted">{asset.note}</span> : null}
                                  {asset.purchasedOn ? <span className="tabular block text-xs text-muted">شُري في {asset.purchasedOn}</span> : null}
                                </TD>
                                <TD className="text-muted">{asset.location || '—'}</TD>
                                <TD numeric className="tabular">{asset.quantity ?? '—'}</TD>
                                <TD numeric className="tabular whitespace-nowrap">{asset.unitPrice === null ? '—' : `${asset.unitPrice} ج.م`}</TD>
                                <TD numeric className="tabular whitespace-nowrap font-medium">{total === null ? '—' : `${total} ج.م`}</TD>
                                <TD>
                                  {asset.condition
                                    ? <Badge variant={conditionTones[asset.condition]}>{conditionLabels[asset.condition]}</Badge>
                                    : <span className="text-muted">—</span>}
                                </TD>
                                <TD>
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => beginEdit(asset)}>تعديل</Button>
                                    <Button size="sm" variant="ghost" disabled={commandPending} onClick={() => { remove.reset(); setDeleting(asset); }}>حذف</Button>
                                  </div>
                                </TD>
                              </TR>
                            );
                          })}
                        </tbody>
                      </DataTable>
                      <Pagination
                        summary={<>صفحة <span className="tabular">{page}</span></>}
                        previousDisabled={page <= 1}
                        nextDisabled={page >= (assets.data.meta.totalPages || 1)}
                        onPrevious={() => setPage((value) => value - 1)}
                        onNext={() => setPage((value) => value + 1)}
                      />
                    </>
                  )}
          </Card>
        </>
      )}
    </section>
  );
}
