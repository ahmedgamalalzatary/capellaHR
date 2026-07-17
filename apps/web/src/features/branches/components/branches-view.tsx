'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed, MapPin, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Badge, Button, Card, CardContent, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';

import {
  createBranch,
  deleteBranch,
  listBranches,
  updateBranch,
  type Branch,
} from '../api/branches-api';
import { branchFormSchema, type BranchFormValues } from '../schemas/branch-form';

type BranchFormInput = import('zod').input<typeof branchFormSchema>;

const PAGE_SIZE = 20;
const BRANCHES_QUERY_KEY = 'branches';

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

function BranchForm({ branch, onDone }: { branch: Branch | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<BranchFormInput, unknown, BranchFormValues>({
    resolver: zodResolver(branchFormSchema),
    ...(branch
      ? {
          defaultValues: {
            name: branch.name,
            location: branch.location,
            latitude: branch.latitude,
            longitude: branch.longitude,
            gpsAccuracyMeters: branch.gpsAccuracyMeters,
            attendanceRadiusMeters: branch.attendanceRadiusMeters,
          },
        }
      : {}),
  });
  const [gpsError, setGpsError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (values: BranchFormValues) =>
      branch ? updateBranch(branch.id, values) : createBranch(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [BRANCHES_QUERY_KEY] });
      onDone();
    },
  });

  const captureLocation = () => {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError('المتصفح لا يدعم تحديد الموقع. أدخل الإحداثيات يدويًا.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue('latitude', position.coords.latitude, { shouldValidate: true });
        setValue('longitude', position.coords.longitude, { shouldValidate: true });
        setValue('gpsAccuracyMeters', Math.round(position.coords.accuracy), { shouldValidate: true });
      },
      () => setGpsError('تعذر تحديد الموقع. اسمح بالوصول للموقع أو أدخل الإحداثيات يدويًا.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <Card>
      <CardContent className="py-5">
        <form
          noValidate
          onSubmit={handleSubmit((values) => save.mutate(values))}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الفرع" htmlFor="branch-name" required error={errors.name?.message}>
              <Input id="branch-name" {...register('name')} />
            </Field>
            <Field label="الموقع" htmlFor="branch-location" required error={errors.location?.message}>
              <Input id="branch-location" {...register('location')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="خط العرض" htmlFor="branch-latitude" required error={errors.latitude?.message}>
              <Input id="branch-latitude" dir="ltr" inputMode="decimal" className="tabular" {...register('latitude')} />
            </Field>
            <Field label="خط الطول" htmlFor="branch-longitude" required error={errors.longitude?.message}>
              <Input id="branch-longitude" dir="ltr" inputMode="decimal" className="tabular" {...register('longitude')} />
            </Field>
            <Field label="دقة التحديد (متر)" htmlFor="branch-accuracy" required error={errors.gpsAccuracyMeters?.message}>
              <Input id="branch-accuracy" dir="ltr" inputMode="decimal" className="tabular" {...register('gpsAccuracyMeters')} />
            </Field>
            <Field label="نطاق الحضور (متر)" htmlFor="branch-radius" required error={errors.attendanceRadiusMeters?.message}>
              <Input id="branch-radius" dir="ltr" inputMode="decimal" className="tabular" {...register('attendanceRadiusMeters')} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={captureLocation}>
              <LocateFixed className="size-4" aria-hidden />
              التقاط الموقع الحالي
            </Button>
            {gpsError ? <p className="text-[13px] text-warning">{gpsError}</p> : null}
          </div>

          {save.error ? (
            <p role="alert" className="text-[13px] text-danger">
              {serverErrorMessage(save.error)}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الفرع'}
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

export function BranchesView() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const branchesQuery = useQuery({
    queryKey: [BRANCHES_QUERY_KEY, { search, page }],
    queryFn: () => listBranches({ ...(search ? { search } : {}), page, pageSize: PAGE_SIZE }),
  });

  const removal = useMutation({
    mutationFn: deleteBranch,
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: [BRANCHES_QUERY_KEY] });
    },
  });

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const items = branchesQuery.data?.items ?? [];
  const meta = branchesQuery.data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            placeholder="ابحث بالاسم أو الموقع…"
            className="w-56"
          />
          <Button type="submit" variant="secondary" size="sm">
            <Search className="size-4" aria-hidden />
            بحث
          </Button>
        </form>

        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          إضافة فرع
        </Button>
      </div>

      {creating || editing ? (
        <BranchForm key={editing?.id ?? 'create'} branch={editing} onDone={closeForm} />
      ) : null}

      {removal.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(removal.error)}
        </p>
      ) : null}

      <Card>
        {branchesQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الفروع…</div>
        ) : branchesQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الفروع"
            description={serverErrorMessage(branchesQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void branchesQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد فروع بعد"
            description={search ? 'لا توجد نتائج مطابقة للبحث.' : 'ابدأ بإضافة أول فرع للشركة.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">الاسم</th>
                  <th className="px-4 py-2.5 text-start font-medium">الموقع</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">نطاق الحضور</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium lg:table-cell">الإحداثيات</th>
                  <th className="px-4 py-2.5 text-start font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((branch) => (
                  <tr key={branch.id} className="border-b border-line/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
                        {branch.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{branch.location}</td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="tabular" dir="ltr">{branch.attendanceRadiusMeters} م</span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="tabular text-muted" dir="ltr">
                        {branch.latitude.toFixed(4)}, {branch.longitude.toFixed(4)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCreating(false);
                            setConfirmDeleteId(null);
                            setEditing(branch);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                          تعديل
                        </Button>
                        {confirmDeleteId === branch.id ? (
                          <>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={removal.isPending}
                              onClick={() => removal.mutate(branch.id)}
                            >
                              تأكيد الحذف
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                              إلغاء
                            </Button>
                          </>
                        ) : branch.hasEverBeenReferenced ? (
                          <Badge variant="neutral">مُستخدم</Badge>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(branch.id)}>
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
            <span className="tabular">{meta.total}</span> فرع
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
