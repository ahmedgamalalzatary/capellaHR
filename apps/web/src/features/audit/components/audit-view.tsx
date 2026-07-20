'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, RotateCcw, Search } from 'lucide-react';
import { Fragment, useState } from 'react';

import type { AuditActorType, AuditEventDto } from '@capella/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listAuditEvents } from '../api/audit-api';
import { auditQueryKeys } from '../query-keys';

const ACTOR_LABELS: Record<AuditActorType, string> = {
  admin: 'المشرف',
  employee: 'الموظف',
  system: 'النظام',
};

/** Actor type is colour-coded so a scan separates human actions from automated ones. */
const ACTOR_VARIANTS: Record<AuditActorType, 'neutral' | 'success' | 'warning'> = {
  admin: 'warning',
  employee: 'success',
  system: 'neutral',
};

const MODULE_LABELS: Record<string, string> = {
  auth: 'المصادقة',
  branches: 'الفروع',
  employees: 'الموظفون',
  shifts: 'الورديات',
  'weekly-day-off': 'الراحة الأسبوعية',
  payroll: 'الرواتب',
  bonuses: 'المكافآت',
  deductions: 'الخصومات',
  advances: 'السلف',
  devices: 'الأجهزة',
  reports: 'التقارير',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  pin_reset: 'إعادة تعيين الرقم السري',
  reference_lock: 'قفل مرجع',
  convert: 'تحويل إلى يوم راحة',
  revert: 'إعادة إلى غياب',
  finalize: 'إقفال الراتب',
  accelerate: 'تعجيل السلفة',
  credential_sync: 'مزامنة بيانات الدخول',
  login_succeeded: 'نجاح تسجيل الدخول',
  login_failed: 'فشل تسجيل الدخول',
  session_create: 'إنشاء جلسة',
  logout: 'تسجيل الخروج',
  session_revoke: 'إلغاء جلسة',
  pairing_create: 'بدء ربط جهاز',
  pairing_cancel: 'إلغاء ربط جهاز',
  pairing_options: 'إنشاء خيارات الربط',
  pairing_complete: 'إكمال ربط جهاز',
  replace: 'استبدال جهاز',
  revoke: 'إلغاء جهاز',
  authentication_challenge_create: 'بدء تحقق الجهاز',
  authentication_challenge_supersede: 'استبدال تحدي التحقق',
  authentication_challenge_consume: 'استهلاك تحدي التحقق',
  installation_marker_release: 'تحرير معرّف تثبيت الجهاز',
  verify: 'نجاح تحقق الجهاز',
  export_create: 'إنشاء تصدير',
  export_processing: 'بدء معالجة التصدير',
  export_failure: 'فشل التصدير',
  export_retry: 'إعادة محاولة التصدير',
  export_complete: 'اكتمال التصدير',
  export_recover: 'استعادة تصدير متوقف',
  file_delete_mark: 'بدء حذف ملف',
  file_delete_complete: 'اكتمال حذف ملف',
};

/** Destructive and failed events read as danger; creations read as success. */
const DANGER_ACTIONS = new Set([
  'delete',
  'revoke',
  'session_revoke',
  'login_failed',
  'export_failure',
  'file_delete_mark',
  'file_delete_complete',
  'pairing_cancel',
  'revert',
]);
const SUCCESS_ACTIONS = new Set([
  'create',
  'login_succeeded',
  'session_create',
  'pairing_complete',
  'verify',
  'export_complete',
  'finalize',
]);

const actionVariant = (action: string): 'neutral' | 'success' | 'danger' => {
  if (DANGER_ACTIONS.has(action)) return 'danger';
  if (SUCCESS_ACTIONS.has(action)) return 'success';
  return 'neutral';
};

/**
 * System events carry the identifier "system", which the badge already says.
 * Admin and employee identifiers are real usernames, so they still render.
 */
const redundantIdentifier = (event: AuditEventDto) =>
  !event.actorIdentifier
  || event.actorIdentifier.trim().toLowerCase() === event.actorType.toLowerCase();

const MODULE_OPTIONS = Object.entries(MODULE_LABELS);

const SELECT_CLASS =
  'h-9 w-full rounded-control border border-line bg-paper px-3 text-sm text-ink';
const FILTER_LABEL_CLASS = 'grid gap-1.5 text-[12px] font-medium text-muted';

const serverErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

const jsonDetails = (event: AuditEventDto) => JSON.stringify({
  before: event.beforeState,
  after: event.afterState,
  relatedIds: event.relatedIds,
  ipAddress: event.ipAddress,
  userAgent: event.userAgent,
}, null, 2);

export function AuditView() {
  const formatters = useDisplayFormatters();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [actorType, setActorType] = useState<AuditActorType | null>(null);
  const [module, setModule] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = {
    ...(search ? { search } : {}),
    ...(actorType ? { actorType } : {}),
    ...(module ? { module } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    page,
  };
  const eventsQuery = useQuery({
    queryKey: auditQueryKeys.list(params),
    queryFn: () => listAuditEvents(params),
    retry: false,
  });
  const events = eventsQuery.data?.items ?? [];
  const meta = eventsQuery.data?.meta;

  const activeFilterCount =
    (search ? 1 : 0) + (actorType ? 1 : 0) + (module ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const resetFilters = () => {
    setSearchInput('');
    setSearch('');
    setActorType(null);
    setModule('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <form
              role="search"
              className={`${FILTER_LABEL_CLASS} sm:col-span-2 lg:col-span-1`}
              onSubmit={(submitEvent) => {
                submitEvent.preventDefault();
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              <label htmlFor="audit-search">بحث</label>
              <div className="flex items-center gap-2">
                <Input
                  id="audit-search"
                  type="search"
                  aria-label="بحث في سجل المراجعة"
                  value={searchInput}
                  onChange={(changeEvent) => setSearchInput(changeEvent.target.value)}
                  placeholder="ابحث في الأحداث…"
                  className="w-full"
                />
                <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                  <Search className="size-4" aria-hidden />
                  <span className="sr-only">بحث</span>
                </Button>
              </div>
            </form>

            <label className={FILTER_LABEL_CLASS}>
              نوع المنفذ
              <select
                aria-label="نوع المنفذ"
                className={SELECT_CLASS}
                value={actorType ?? ''}
                onChange={(changeEvent) => {
                  setPage(1);
                  setActorType(changeEvent.target.value
                    ? changeEvent.target.value as AuditActorType
                    : null);
                }}
              >
                <option value="">كل الأنواع</option>
                {Object.entries(ACTOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className={FILTER_LABEL_CLASS}>
              الوحدة
              <select
                aria-label="الوحدة"
                className={SELECT_CLASS}
                value={module}
                onChange={(changeEvent) => {
                  setPage(1);
                  setModule(changeEvent.target.value);
                }}
              >
                <option value="">كل الوحدات</option>
                {MODULE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className={FILTER_LABEL_CLASS}>
              من تاريخ
              <Input
                type="date"
                aria-label="من تاريخ"
                dir="ltr"
                className="w-full tabular"
                value={dateFrom}
                onChange={(changeEvent) => {
                  setPage(1);
                  setDateFrom(changeEvent.target.value);
                }}
              />
            </label>

            <label className={FILTER_LABEL_CLASS}>
              إلى تاريخ
              <Input
                type="date"
                aria-label="إلى تاريخ"
                dir="ltr"
                className="w-full tabular"
                value={dateTo}
                onChange={(changeEvent) => {
                  setPage(1);
                  setDateTo(changeEvent.target.value);
                }}
              />
            </label>
          </div>

          {activeFilterCount > 0 ? (
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <span className="text-[12px] text-muted">
                <span className="tabular">{activeFilterCount}</span> فلتر نشط
              </span>
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RotateCcw className="size-4" aria-hidden />
                إعادة ضبط الفلاتر
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>سجل المراجعة</CardTitle>
          {meta ? (
            <span className="text-[13px] text-muted">
              <span className="tabular">{meta.total}</span> حدث
            </span>
          ) : null}
        </CardHeader>

        {eventsQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">
            جارٍ تحميل سجل المراجعة…
          </div>
        ) : eventsQuery.isError ? (
          <EmptyState
            title="تعذر تحميل سجل المراجعة"
            description={serverErrorMessage(eventsQuery.error)}
            action={(
              <Button variant="secondary" size="sm" onClick={() => void eventsQuery.refetch()}>
                إعادة المحاولة
              </Button>
            )}
          />
        ) : events.length === 0 ? (
          <EmptyState
            title="لا توجد أحداث مراجعة مطابقة"
            description={
              activeFilterCount > 0
                ? 'غيّر معايير البحث أو الفلاتر لعرض نتائج أخرى.'
                : 'ستظهر هنا كل الإجراءات التي تتم على النظام.'
            }
            {...(activeFilterCount > 0
              ? {
                  action: (
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      <RotateCcw className="size-4" aria-hidden />
                      إعادة ضبط الفلاتر
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/40 text-[12px] text-muted">
                  <th className="px-4 py-2.5 text-start font-medium">التاريخ والوقت</th>
                  <th className="px-4 py-2.5 text-start font-medium">المنفذ</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">الوحدة</th>
                  <th className="px-4 py-2.5 text-start font-medium">الحدث</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium lg:table-cell">الكيان</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium xl:table-cell">معرّف الطلب</th>
                  <th className="px-4 py-2.5 text-start font-medium">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {events.map((auditEvent) => {
                  const expanded = expandedId === auditEvent.id;
                  return (
                    <Fragment key={auditEvent.id}>
                      <tr
                        className={`border-b border-line/60 transition-colors hover:bg-canvas/50 ${
                          expanded ? 'bg-canvas/50' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted">
                          <span dir="ltr" className="inline-block tabular">
                            {formatters?.formatDateTime(auditEvent.createdAt) ?? auditEvent.createdAt}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={ACTOR_VARIANTS[auditEvent.actorType]}>
                            {ACTOR_LABELS[auditEvent.actorType]}
                          </Badge>
                          {redundantIdentifier(auditEvent) ? null : (
                            <span className="mt-1 block text-[12px] text-muted">
                              <span dir="ltr" className="inline-block">{auditEvent.actorIdentifier}</span>
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-muted md:table-cell">
                          {MODULE_LABELS[auditEvent.module] ?? auditEvent.module}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={actionVariant(auditEvent.action)}>
                            {ACTION_LABELS[auditEvent.action] ?? auditEvent.action}
                          </Badge>
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 lg:table-cell">
                          <span dir="ltr" className="inline-block">
                            <span className="text-ink">{auditEvent.entityType}</span>
                            <span className="tabular text-muted"> #{auditEvent.entityId}</span>
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-[12px] text-muted xl:table-cell">
                          <span dir="ltr" className="inline-block">{auditEvent.requestId ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : auditEvent.id)}
                          >
                            {expanded
                              ? <ChevronUp className="size-4" aria-hidden />
                              : <ChevronDown className="size-4" aria-hidden />}
                            {expanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                          </Button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b border-line/60 bg-canvas/50">
                          <td colSpan={7} className="px-4 pb-4">
                            <pre
                              className="max-h-80 overflow-auto rounded-control border border-line bg-paper p-3 text-[12px] leading-relaxed whitespace-pre-wrap"
                              dir="ltr"
                            >
                              {jsonDetails(auditEvent)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {meta && meta.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted">
            صفحة <span className="tabular">{meta.page}</span> من{' '}
            <span className="tabular">{meta.totalPages}</span>
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
