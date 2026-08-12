'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Percent, Plus, Search } from 'lucide-react';
import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  Input,
  Label,
  cn,
} from '@capella/ui';

import { DataTable, RowActions, TD, TH, THead, TR } from '@/components/data/data-table';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError } from '@/components/feedback/notice';
import { SuccessState } from '@/components/feedback/success-state';
import { Select } from '@/components/form/select';
import { PageHeader } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { invalidateErpCaches } from '@/lib/erp-cache';

import {
  deleteCategory,
  listCatalogBranches,
  listCategories,
  listServices,
  updateCategory,
  updateService,
  type Category,
  type ServiceListItem,
} from '../api/catalog-api';
import { catalogQueryKeys } from '../query-keys';
import { CATEGORY_TYPE_LABELS, serverErrorMessage } from './catalog-messages';
import { CategoryForm } from './category-form';
import { CommissionOverridesDialog } from './commission-overrides-dialog';
import { ServiceForm } from './service-form';

type Tab = 'categories' | 'services';

const tabs: { key: Tab; label: string }[] = [
  { key: 'categories', label: 'التصنيفات' },
  { key: 'services', label: 'الخدمات' },
];

/**
 * Admin catalog management. An Admin belongs to no branch, so they must name the
 * branch they act on before anything loads; a Cashier's branch is derived from
 * their account by the server and is never sent from the browser.
 */
export function CatalogView() {
  const queryClient = useQueryClient();
  const session = useSession();
  const commandPending = useIsMutating() > 0;
  const isAdmin = session.data?.actor.type === 'admin';

  const [selectedBranchId, setSelectedBranchId] = useState<number | undefined>();
  const [tab, setTab] = useState<Tab>('categories');
  const [categorySearch, setCategorySearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [confirmingCategory, setConfirmingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [creatingService, setCreatingService] = useState(false);
  const [editingService, setEditingService] = useState<ServiceListItem | null>(null);
  const [confirmingService, setConfirmingService] = useState<ServiceListItem | null>(null);
  const [overridesFor, setOverridesFor] = useState<ServiceListItem | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>();

  const branchId = isAdmin ? selectedBranchId : undefined;
  const branchScope = branchId === undefined ? {} : { branchId };
  // A cashier is scoped by their account; an admin must choose first.
  const scopeReady = session.isSuccess && (!isAdmin || selectedBranchId !== undefined);

  const branchesQuery = useQuery({
    queryKey: catalogQueryKeys.branches,
    queryFn: () => fetchAllPages((page) => listCatalogBranches(page)),
    enabled: isAdmin,
  });

  const trimmedCategorySearch = categorySearch.trim();
  const categoriesQuery = useQuery({
    queryKey: catalogQueryKeys.categories({ branchId, search: trimmedCategorySearch }),
    queryFn: () => fetchAllPages((page) => listCategories({
      ...branchScope,
      ...(trimmedCategorySearch ? { search: trimmedCategorySearch } : {}),
      page,
    })),
    enabled: scopeReady,
  });

  const trimmedServiceSearch = serviceSearch.trim();
  const servicesQuery = useQuery({
    queryKey: catalogQueryKeys.services({ branchId, search: trimmedServiceSearch }),
    queryFn: () => fetchAllPages((page) => listServices({
      ...branchScope,
      ...(trimmedServiceSearch ? { search: trimmedServiceSearch } : {}),
      page,
    })),
    enabled: scopeReady && tab === 'services',
  });

  const invalidate = () => invalidateErpCaches(queryClient, 'catalog');

  const toggleCategory = useMutation({
    mutationFn: (category: Category) =>
      updateCategory(category.id, { isActive: !category.isActive, ...branchScope }),
    onSuccess: async (_saved, category) => { setConfirmingCategory(null); setSuccessMessage(category.isActive ? 'تم إيقاف التصنيف.' : 'تم تفعيل التصنيف.'); await invalidate(); },
  });

  const removeCategory = useMutation({
    mutationFn: (category: Category) => deleteCategory(category.id, branchId),
    onSuccess: async () => { setDeletingCategory(null); setSuccessMessage('تم حذف التصنيف.'); await invalidate(); },
  });

  const toggleService = useMutation({
    mutationFn: (service: ServiceListItem) =>
      updateService(service.id, { isActive: !service.isActive, ...branchScope }),
    onSuccess: async (_saved, service) => { setConfirmingService(null); setSuccessMessage(service.isActive ? 'تم إيقاف الخدمة.' : 'تم تفعيل الخدمة.'); await invalidate(); },
  });

  const categories = categoriesQuery.data ?? [];
  const services = servicesQuery.data ?? [];

  return (
    <section className="space-y-6">
      <PageHeader
        title="إدارة الكتالوج"
        description="إدارة تصنيفات الخدمات والأسعار ونسب العمولات."
      />
      {successMessage ? <SuccessState message={successMessage} /> : null}
      {isAdmin ? (
        <Card className="shadow-card">
          <CardContent className="space-y-1.5 p-4 sm:p-5">
            <Label htmlFor="catalog-branch">الفرع</Label>
            <Select
              id="catalog-branch"
              className="max-w-sm"
              value={selectedBranchId ?? ''}
              disabled={branchesQuery.isPending || branchesQuery.isError || commandPending}
              onChange={(event) => {
                if (commandPending) return;
                setSelectedBranchId(event.target.value ? Number(event.target.value) : undefined);
              }}
            >
              <option value="">اختر الفرع</option>
              {(branchesQuery.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </Select>
            {branchesQuery.isError ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <FieldError>{serverErrorMessage(branchesQuery.error)}</FieldError>
                <Button variant="ghost" size="sm" onClick={() => void branchesQuery.refetch()}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!scopeReady ? (
        session.isPending ? (
          <Card className="shadow-card"><LoadingState label="جارٍ تحميل بيانات الحساب…" /></Card>
        ) : (
          <Card className="shadow-card"><EmptyState title="اختر فرعًا لعرض الكتالوج" /></Card>
        )
      ) : (
        <>
          <div
            role="tablist"
            aria-label="أقسام الكتالوج"
            className="inline-flex gap-1 rounded-control border border-line bg-paper p-1"
          >
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                disabled={commandPending}
                className={cn(
                  'rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                  tab === entry.key ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
                )}
                onClick={() => { if (!commandPending) setTab(entry.key); }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {tab === 'categories' ? (
            <div className="space-y-4">
              {creatingCategory ? (
                <CategoryForm
                  {...branchScope}
                  onDone={() => { setCreatingCategory(false); setSuccessMessage('تم حفظ التصنيف.'); }}
                  onCancel={() => setCreatingCategory(false)}
                />
              ) : null}
              {editingCategory ? (
                <CategoryForm
                  category={editingCategory}
                  {...branchScope}
                  onDone={() => { setEditingCategory(null); setSuccessMessage('تم حفظ التصنيف.'); }}
                  onCancel={() => setEditingCategory(null)}
                />
              ) : null}

              <Card className="overflow-hidden shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 p-3 sm:p-4">
                  <div className="relative w-full max-w-xs">
                    <Search
                      className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted"
                      aria-hidden
                    />
                    <Input
                      aria-label="بحث في التصنيفات"
                      placeholder="بحث باسم التصنيف"
                      className="ps-9"
                      value={categorySearch}
                      onChange={(event) => setCategorySearch(event.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={commandPending}
                    onClick={() => {
                      if (commandPending) return;
                      setCreatingCategory(true);
                      setEditingCategory(null);
                    }}
                  >
                    <Plus className="size-4" aria-hidden />
                    إضافة تصنيف
                  </Button>
                </div>

                {categoriesQuery.isPending ? (
                  <LoadingState label="جارٍ تحميل التصنيفات…" className="px-6 py-16" />
                ) : categoriesQuery.isError ? (
                  <EmptyState
                    title="تعذر تحميل التصنيفات"
                    description={serverErrorMessage(categoriesQuery.error) ?? undefined}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => void categoriesQuery.refetch()}>
                        إعادة المحاولة
                      </Button>
                    }
                  />
                ) : categories.length === 0 ? (
                  <EmptyState
                    title={trimmedCategorySearch ? 'لا يوجد تصنيف مطابق' : 'لا توجد تصنيفات بعد'}
                    description={trimmedCategorySearch ? 'جرب اسمًا آخر.' : 'ابدأ بإضافة أول تصنيف.'}
                  />
                ) : (
                  <DataTable>
                    <THead>
                      <TH>اسم التصنيف</TH>
                      <TH>النوع</TH>
                      <TH>الحالة</TH>
                      <TH>إجراءات</TH>
                    </THead>
                    <tbody>
                      {categories.map((category) => (
                        <TR key={category.id}>
                          <TD className="font-medium">{category.name}</TD>
                          <TD className="text-muted">{CATEGORY_TYPE_LABELS[category.type]}</TD>
                          <TD>
                            <Badge variant={category.isActive ? 'success' : 'neutral'}>
                              {category.isActive ? 'نشط' : 'موقوف'}
                            </Badge>
                          </TD>
                          <TD>
                            <RowActions>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => {
                                  if (commandPending) return;
                                  setEditingCategory(category);
                                  setCreatingCategory(false);
                                }}
                              >
                                <Pencil className="size-4" aria-hidden />
                                تعديل
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => {
                                  if (commandPending) return;
                                  if (category.isActive) setConfirmingCategory(category);
                                  else toggleCategory.mutate(category);
                                }}
                              >
                                {category.isActive ? 'إيقاف' : 'تفعيل'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => { if (!commandPending) setDeletingCategory(category); }}
                              >
                                حذف
                              </Button>
                            </RowActions>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </Card>

              {toggleCategory.isError ? (
                <FieldError>{serverErrorMessage(toggleCategory.error)}</FieldError>
              ) : null}

              {confirmingCategory ? (
                <ConfirmDialog
                  title="إيقاف التصنيف"
                  description={toggleCategory.isError
                    ? serverErrorMessage(toggleCategory.error)
                    : `لن تظهر خدمات ${confirmingCategory.name} في المبيعات الجديدة حتى إعادة تفعيله.`}
                  confirmLabel="تأكيد إيقاف التصنيف"
                  tone="danger"
                  pending={commandPending}
                  onConfirm={() => { if (!commandPending) toggleCategory.mutate(confirmingCategory); }}
                  onCancel={() => {
                    if (commandPending) return;
                    toggleCategory.reset();
                    setConfirmingCategory(null);
                  }}
                />
              ) : null}

              {deletingCategory ? (
                <ConfirmDialog
                  title="حذف التصنيف"
                  description={
                    removeCategory.isError
                      ? serverErrorMessage(removeCategory.error)
                      : 'لا يمكن حذف تصنيف استُخدم من قبل؛ يمكن إيقافه بدلًا من ذلك.'
                  }
                  confirmLabel="تأكيد الحذف"
                  tone="danger"
                  pending={commandPending}
                  onConfirm={() => { if (!commandPending) removeCategory.mutate(deletingCategory); }}
                  onCancel={() => {
                    if (commandPending) return;
                    removeCategory.reset();
                    setDeletingCategory(null);
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {creatingService ? (
                <ServiceForm
                  categories={categories}
                  {...branchScope}
                  onDone={() => { setCreatingService(false); setSuccessMessage('تم حفظ الخدمة.'); }}
                  onCancel={() => setCreatingService(false)}
                />
              ) : null}
              {editingService ? (
                <ServiceForm
                  service={editingService}
                  categories={categories}
                  {...branchScope}
                  onDone={() => { setEditingService(null); setSuccessMessage('تم حفظ الخدمة.'); }}
                  onCancel={() => setEditingService(null)}
                />
              ) : null}

              <Card className="shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 p-3 sm:p-4">
                  <div className="relative w-full max-w-xs">
                    <Search
                      className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted"
                      aria-hidden
                    />
                    <Input
                      aria-label="بحث في الخدمات"
                      placeholder="بحث باسم الخدمة"
                      className="ps-9"
                      value={serviceSearch}
                      onChange={(event) => setServiceSearch(event.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={commandPending}
                    onClick={() => {
                      if (commandPending) return;
                      setCreatingService(true);
                      setEditingService(null);
                    }}
                  >
                    <Plus className="size-4" aria-hidden />
                    إضافة خدمة
                  </Button>
                </div>

                {servicesQuery.isPending ? (
                  <LoadingState label="جارٍ تحميل الخدمات…" className="px-6 py-16" />
                ) : servicesQuery.isError ? (
                  <EmptyState
                    title="تعذر تحميل الخدمات"
                    description={serverErrorMessage(servicesQuery.error) ?? undefined}
                    action={
                      <Button variant="secondary" size="sm" onClick={() => void servicesQuery.refetch()}>
                        إعادة المحاولة
                      </Button>
                    }
                  />
                ) : services.length === 0 ? (
                  <EmptyState
                    title={trimmedServiceSearch ? 'لا توجد خدمة مطابقة' : 'لا توجد خدمات بعد'}
                    description={trimmedServiceSearch ? 'جرب اسمًا آخر.' : 'ابدأ بإضافة أول خدمة.'}
                  />
                ) : (
                  <DataTable>
                    <THead>
                      <TH>اسم الخدمة</TH>
                      <TH>التصنيف</TH>
                      <TH numeric>السعر (ج.م)</TH>
                      <TH numeric>العمولة</TH>
                      <TH>الحالة</TH>
                      <TH>إجراءات</TH>
                    </THead>
                    <tbody>
                      {services.map((service) => (
                        <TR key={service.id}>
                          <TD className="font-medium">{service.name}</TD>
                          <TD className="text-muted">{service.categoryName}</TD>
                          <TD numeric>{service.price ?? 'عند البيع'}</TD>
                          <TD numeric className="text-muted">
                            {`${service.commissionPercent}%`}
                          </TD>
                          <TD>
                            <Badge
                              variant={
                                service.isActive && service.categoryIsActive
                                  ? 'success'
                                  : service.isActive
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {service.isActive && service.categoryIsActive
                                ? 'نشط'
                                : service.isActive
                                  ? 'موقوف بالتصنيف'
                                  : 'موقوف'}
                            </Badge>
                          </TD>
                          {/* No delete: an invoice line snapshots the service and
                              points back at it, so the row is never removed. */}
                          <TD>
                            <RowActions>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => {
                                  if (commandPending) return;
                                  setEditingService(service);
                                  setCreatingService(false);
                                }}
                              >
                                <Pencil className="size-4" aria-hidden />
                                تعديل
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => {
                                  if (commandPending) return;
                                  if (service.isActive) setConfirmingService(service);
                                  else toggleService.mutate(service);
                                }}
                              >
                                {service.isActive ? 'إيقاف' : 'تفعيل'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={commandPending}
                                onClick={() => { if (!commandPending) setOverridesFor(service); }}
                              >
                                <Percent className="size-4" aria-hidden />
                                العمولات
                              </Button>
                            </RowActions>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </Card>

              {toggleService.isError ? (
                <FieldError>{serverErrorMessage(toggleService.error)}</FieldError>
              ) : null}

              {confirmingService ? (
                <ConfirmDialog
                  title="إيقاف الخدمة"
                  description={toggleService.isError
                    ? serverErrorMessage(toggleService.error)
                    : `لن تظهر ${confirmingService.name} في المبيعات الجديدة حتى إعادة تفعيلها.`}
                  confirmLabel="تأكيد إيقاف الخدمة"
                  tone="danger"
                  pending={commandPending}
                  onConfirm={() => { if (!commandPending) toggleService.mutate(confirmingService); }}
                  onCancel={() => {
                    if (commandPending) return;
                    toggleService.reset();
                    setConfirmingService(null);
                  }}
                />
              ) : null}

              {overridesFor ? (
                <CommissionOverridesDialog
                  service={overridesFor}
                  {...branchScope}
                  onClose={() => setOverridesFor(null)}
                />
              ) : null}
            </div>
          )}
        </>
      )}
    </section>
  );
}
