'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, History, Link2, Plus, Smartphone, X } from 'lucide-react';
import QRCode from 'qrcode';
import { Fragment, useEffect, useState } from 'react';

import { Badge, Button, Card, CardContent, EmptyState, Field, Input } from '@capella/ui';

import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { useDisplayFormatters } from '@/providers/runtime-config';

import { listBranches } from '../../branches/api/branches-api';
import { branchQueryKeys } from '../../branches/query-keys';
import { listEmployees } from '../../employees/api/employees-api';
import { employeeQueryKeys } from '../../employees/query-keys';
import {
  cancelPairing,
  createPairing,
  getDeviceHistory,
  listDevices,
  revokeDevice,
  type Device,
  type DeviceAssignmentType,
  type DeviceStatus,
  type PairingRequest,
} from '../api/devices-api';
import { deviceQueryKeys } from '../query-keys';

// Backend event codes stay stable while the frontend owns their Arabic presentation.
const EVENT_LABELS: Record<'paired' | 'verified' | 'revoked', string> = {
  paired: 'تم الربط',
  verified: 'تم التحقق',
  revoked: 'تم الإلغاء',
};

// One structural source renders headers and determines spanning history rows.
const deviceColumns = [
  { key: 'assignment', label: 'التعيين', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'type', label: 'النوع', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'status', label: 'الحالة', className: 'px-4 py-2.5 text-start font-medium' },
  { key: 'browser', label: 'المتصفح', className: 'hidden px-4 py-2.5 text-start font-medium md:table-cell' },
  { key: 'pairedAt', label: 'تاريخ الربط', className: 'hidden px-4 py-2.5 text-start font-medium lg:table-cell' },
  { key: 'lastUsedAt', label: 'آخر استخدام', className: 'hidden px-4 py-2.5 text-start font-medium lg:table-cell' },
  { key: 'actions', label: 'إجراءات', className: 'px-4 py-2.5 text-start font-medium' },
] as const;

const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

interface AssignmentOptions {
  employees: { id: number; label: string }[];
  branches: { id: number; label: string }[];
}

function PairingQr({ link }: { link: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(link, { type: 'svg', margin: 1, width: 192 })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  return (
    <div
      data-testid="pairing-qr"
      className="mx-auto w-48 max-w-full [&_svg]:h-auto [&_svg]:w-full"
      // qrcode emits a self-contained inline SVG built only from our own link.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function PairingCard({ options, onDone }: { options: AssignmentOptions; onDone: () => void }) {
  const [assignmentType, setAssignmentType] = useState<DeviceAssignmentType>('employee');
  const [assignmentId, setAssignmentId] = useState('');
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: (input: { assignmentType: DeviceAssignmentType; assignmentId: number }) =>
      createPairing(input),
    onSuccess: (created) => setPairing(created),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => cancelPairing(id),
    onSuccess: () => {
      setPairing(null);
      onDone();
    },
  });

  const candidates = assignmentType === 'employee' ? options.employees : options.branches;
  const pairingLink = pairing
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/pair/${pairing.pairingToken}`
    : null;

  const copyLink = async () => {
    if (!pairingLink) return;
    try {
      await navigator.clipboard.writeText(pairingLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        {pairingLink ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              افتح هذا الرابط على الهاتف المطلوب ربطه. الرابط صالح لاستخدام واحد فقط ولن يُعرض مرة أخرى.
            </p>
            <PairingQr link={pairingLink} />
            <Field label="رابط الربط" htmlFor="pairing-link">
              <Input id="pairing-link" readOnly value={pairingLink} />
            </Field>
            {cancel.error ? (
              <p role="alert" className="text-[13px] text-danger">
                {serverErrorMessage(cancel.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
                <Copy className="size-4" aria-hidden />
                {copied ? 'تم النسخ' : 'نسخ الرابط'}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => pairing && cancel.mutate(pairing.id)}
              >
                <X className="size-4" aria-hidden />
                إلغاء طلب الربط
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onDone}>
                تم
              </Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const id = Number(assignmentId);
              if (!Number.isInteger(id) || id <= 0) return;
              create.mutate({ assignmentType, assignmentId: id });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نوع التعيين" htmlFor="pairing-type" required>
                <select
                  id="pairing-type"
                  className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
                  value={assignmentType}
                  onChange={(event) => {
                    setAssignmentType(event.target.value as DeviceAssignmentType);
                    setAssignmentId('');
                  }}
                >
                  <option value="employee">هاتف موظف شخصي</option>
                  <option value="branch">هاتف فرع مشترك</option>
                </select>
              </Field>
              <Field label="التعيين" htmlFor="pairing-assignment" required>
                <select
                  id="pairing-assignment"
                  className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
                  value={assignmentId}
                  onChange={(event) => setAssignmentId(event.target.value)}
                >
                  <option value="" disabled>
                    {assignmentType === 'employee' ? 'اختر الموظف…' : 'اختر الفرع…'}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {create.error ? (
              <p role="alert" className="text-[13px] text-danger">
                {serverErrorMessage(create.error)}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={create.isPending || assignmentId === ''}>
                <Link2 className="size-4" aria-hidden />
                إنشاء طلب الربط
              </Button>
              <Button type="button" variant="ghost" disabled={create.isPending} onClick={onDone}>
                إلغاء
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceHistoryRow({ deviceId }: { deviceId: number }) {
  const formatters = useDisplayFormatters();
  const historyQuery = useQuery({
    queryKey: deviceQueryKeys.history(deviceId),
    queryFn: () => getDeviceHistory(deviceId),
  });

  return (
    <tr className="border-b border-line/60 bg-ink/[0.02] last:border-b-0">
      <td colSpan={deviceColumns.length} className="px-4 py-3">
        <p className="mb-2 text-[13px] font-medium">سجل الجهاز</p>
        {historyQuery.isPending ? (
          <p className="text-[13px] text-muted">جارٍ تحميل السجل…</p>
        ) : historyQuery.isError ? (
          <p className="text-[13px] text-danger">{serverErrorMessage(historyQuery.error)}</p>
        ) : historyQuery.data.length === 0 ? (
          <p className="text-[13px] text-muted">لا توجد أحداث مسجلة.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {historyQuery.data.map((entry, index) => (
              <li key={index} className="flex items-center gap-2">
                <span className="font-medium">{EVENT_LABELS[entry.event]}</span>
                <span className="tabular text-muted">{formatters?.formatDateTime(entry.createdAt) ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function DevicesView() {
  const formatters = useDisplayFormatters();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<DeviceAssignmentType | ''>('');
  const [page, setPage] = useState(1);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);

  const devicesQuery = useQuery({
    queryKey: deviceQueryKeys.list({ statusFilter, typeFilter, page }),
    queryFn: () =>
      listDevices({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(typeFilter ? { assignmentType: typeFilter } : {}),
        page,
      }),
  });

  const employeesQuery = useQuery({
    queryKey: employeeQueryKeys.options(),
    queryFn: () =>
      fetchAllPages((optionsPage) => listEmployees({ page: optionsPage, status: 'all' })),
  });
  const branchesQuery = useQuery({
    queryKey: branchQueryKeys.options(),
    queryFn: () => fetchAllPages((optionsPage) => listBranches({ page: optionsPage })),
  });

  const options: AssignmentOptions = {
    employees: (employeesQuery.data ?? []).map((employee) => ({
      id: employee.id,
      label: employee.fullName,
    })),
    branches: (branchesQuery.data ?? []).map((branch) => ({
      id: branch.id,
      label: branch.name,
    })),
  };

  const assignmentLabel = (device: Device) =>
    (device.assignmentType === 'employee'
      ? options.employees.find((candidate) => candidate.id === device.assignmentId)
      : options.branches.find((candidate) => candidate.id === device.assignmentId)
    )?.label ?? `#${device.assignmentId}`;

  const revocation = useMutation({
    mutationFn: revokeDevice,
    onSuccess: async () => {
      setConfirmRevokeId(null);
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.all });
    },
  });

  const items = devicesQuery.data?.items ?? [];
  const meta = devicesQuery.data?.meta;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="تصفية حسب الحالة"
            className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as DeviceStatus | '');
            }}
          >
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="revoked">ملغي</option>
          </select>
          <select
            aria-label="تصفية حسب النوع"
            className="h-9 rounded-control border border-line bg-paper px-3 text-sm"
            value={typeFilter}
            onChange={(event) => {
              setPage(1);
              setTypeFilter(event.target.value as DeviceAssignmentType | '');
            }}
          >
            <option value="">كل الأنواع</option>
            <option value="employee">هاتف موظف</option>
            <option value="branch">هاتف فرع</option>
          </select>
        </div>

        <Button size="sm" onClick={() => setPairingOpen(true)}>
          <Plus className="size-4" aria-hidden />
          ربط جهاز جديد
        </Button>
      </div>

      {pairingOpen ? <PairingCard options={options} onDone={() => setPairingOpen(false)} /> : null}

      {revocation.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {serverErrorMessage(revocation.error)}
        </p>
      ) : null}

      <Card>
        {devicesQuery.isPending ? (
          <div className="px-6 py-16 text-center text-sm text-muted">جارٍ تحميل الأجهزة…</div>
        ) : devicesQuery.isError ? (
          <EmptyState
            title="تعذر تحميل الأجهزة"
            description={serverErrorMessage(devicesQuery.error) ?? undefined}
            action={
              <Button variant="secondary" size="sm" onClick={() => void devicesQuery.refetch()}>
                إعادة المحاولة
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="لا توجد أجهزة مسجلة بعد"
            description={
              statusFilter || typeFilter
                ? 'لا توجد نتائج مطابقة للتصفية.'
                : 'ابدأ بإنشاء طلب ربط لهاتف موظف أو فرع.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[12px] text-muted">
                  {deviceColumns.map((column) => (
                    <th key={column.key} className={column.className}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((device) => (
                  <Fragment key={device.id}>
                    <tr className="border-b border-line/60 last:border-b-0">
                      <td className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <Smartphone className="size-4 shrink-0 text-muted" aria-hidden />
                          {assignmentLabel(device)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {device.assignmentType === 'employee' ? 'هاتف موظف' : 'هاتف فرع'}
                      </td>
                      <td className="px-4 py-3">
                        {device.status === 'active' ? (
                          <Badge variant="success">نشط</Badge>
                        ) : (
                          <Badge variant="neutral">ملغي</Badge>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-muted md:table-cell">
                        {device.browser} — {device.platform}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <span className="tabular">{formatters?.formatDateTime(device.pairedAt) ?? '—'}</span>
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {device.lastUsedAt ? (
                          <span className="tabular">{formatters?.formatDateTime(device.lastUsedAt) ?? '—'}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setHistoryId((current) => (current === device.id ? null : device.id))
                            }
                          >
                            <History className="size-4" aria-hidden />
                            السجل
                          </Button>
                          {device.status === 'active' ? (
                            confirmRevokeId === device.id ? (
                              <>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  disabled={revocation.isPending}
                                  onClick={() => revocation.mutate(device.id)}
                                >
                                  تأكيد الإلغاء
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setConfirmRevokeId(null)}
                                >
                                  إلغاء
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmRevokeId(device.id)}
                              >
                                <X className="size-4" aria-hidden />
                                إلغاء التسجيل
                              </Button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {historyId === device.id ? (
                      <DeviceHistoryRow deviceId={device.id} />
                    ) : null}
                  </Fragment>
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
            <span className="tabular">{meta.total}</span> جهاز
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
