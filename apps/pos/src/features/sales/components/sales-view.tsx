'use client';

import type {
  CompleteSaleInput,
  InvoiceDto,
  PaymentMethod,
  QuoteSaleInput,
} from '@capella/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Modal,
} from '@capella/ui';

import { useSession } from '@/features/auth';
import {
  getCurrentCashierSession,
  listCashierSessionBranches,
} from '@/features/cashier-sessions';
import { ClientPicker, type Client } from '@/features/clients';
import { ServicePicker, type ServiceListItem } from '@/features/catalog';
import {
  PresentEmployeePicker,
  type AssignableEmployee,
} from '@/features/employee-assignment';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';

import { completeSale, quoteSale } from '../api/sales-api';
import { salesQueryKeys } from '../query-keys';
import {
  acquireSaleDraftTab,
  readSaleDraft,
  removeSaleDraft,
  writeSaleDraft,
  type SaleDraftOwner,
} from '../sale-draft-storage';

const PENDING_KEY = 'capella:pending-sale';
const PENDING_KEY_PREFIX = `${PENDING_KEY}:`;
const paymentMethods: Array<{ method: PaymentMethod; label: string }> = [
  { method: 'cash', label: 'نقدي' },
  { method: 'visa', label: 'فيزا' },
  { method: 'instapay', label: 'إنستا باي' },
  { method: 'vodafone_cash', label: 'فودافون كاش' },
];

type Line = { service: ServiceListItem; quantity: number };
type AdjustmentKind = 'percentage' | 'fixed';
/** Admin is a database-enforced singleton and has no public account id. */
type PendingSaleOwner = SaleDraftOwner;
type PendingSale = { owner: PendingSaleOwner; input: CompleteSaleInput };

const pendingKey = (idempotencyKey: string) => `${PENDING_KEY_PREFIX}${idempotencyKey}`;

const parsePending = (value: string | null): PendingSale | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const owner = Reflect.get(parsed, 'owner');
    const input = Reflect.get(parsed, 'input');
    return typeof owner === 'object' && owner !== null
      && typeof input === 'object' && input !== null
      ? parsed as PendingSale
      : null;
  } catch {
    return null;
  }
};

const toCents = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
};

const money = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`;

const errorMessage = (error: unknown) => (
  error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.'
);

const readPending = (matches: (pending: PendingSale) => boolean = () => true): PendingSale | null => {
  if (typeof window === 'undefined') return null;
  try {
    const keys = [PENDING_KEY, ...Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index),
    )
      .filter((key): key is string => key?.startsWith(PENDING_KEY_PREFIX) === true)
      .sort()];
    for (const key of keys) {
      const pending = parsePending(localStorage.getItem(key));
      if (!pending) continue;
      if (key === PENDING_KEY) {
        try {
          localStorage.setItem(pendingKey(pending.input.idempotencyKey), JSON.stringify(pending));
          localStorage.removeItem(PENDING_KEY);
        } catch {
          // Continue using the legacy record when migration is not available.
        }
      }
      if (matches(pending)) return pending;
    }
    return null;
  } catch {
    return null;
  }
};

const removePendingRequest = (input: CompleteSaleInput) => {
  try {
    localStorage.removeItem(pendingKey(input.idempotencyKey));
    const legacy = parsePending(localStorage.getItem(PENDING_KEY));
    if (legacy?.input.idempotencyKey === input.idempotencyKey) {
      localStorage.removeItem(PENDING_KEY);
    }
  } catch {
    // A failed cleanup is safe: the same idempotency key will only reload this invoice.
  }
};

export function SalesView() {
  const auth = useSession();
  const actor = auth.data?.actor;
  const isAdmin = actor?.type === 'admin';
  const [selectedBranchId, setSelectedBranchId] = useState<number>();

  const branches = useQuery({
    queryKey: ['erp-sales', 'branches'],
    queryFn: () => fetchAllPages((page) => listCashierSessionBranches(page)),
    enabled: isAdmin,
  });
  const branchId = isAdmin ? selectedBranchId : undefined;
  const session = useQuery({
    queryKey: ['erp-sales', 'cashier-session', branchId ?? null],
    queryFn: () => getCurrentCashierSession(branchId),
    enabled: actor?.type === 'cashier' || (isAdmin && branchId !== undefined),
  });

  if (isAdmin && branchId === undefined) {
    const branchContent = branches.isError ? (
      <EmptyState
        title="تعذر تحميل الفروع"
        description={errorMessage(branches.error)}
        action={
          <Button variant="secondary" size="sm" onClick={() => void branches.refetch()}>
            إعادة المحاولة
          </Button>
        }
      />
    ) : branches.isSuccess && branches.data.length === 0 ? (
      <EmptyState title="لا توجد فروع متاحة" />
    ) : (
      <>
        <Label htmlFor="sale-branch">الفرع</Label>
        <select
          id="sale-branch"
          disabled={branches.isPending}
          className="h-9 w-full rounded-control border border-line bg-paper px-3 text-sm"
          value={selectedBranchId ?? ''}
          onChange={(event) => setSelectedBranchId(Number(event.target.value) || undefined)}
        >
          <option value="">اختر الفرع</option>
          {(branches.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </>
    );
    return (
      <section className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-2xl font-semibold">بيع خدمة</h1>
        <Card><CardContent className="space-y-2">
          {branchContent}
        </CardContent></Card>
      </section>
    );
  }

  if (auth.isPending) {
    return <Card><CardContent>جارٍ تحميل وردية الكاشير…</CardContent></Card>;
  }
  if (!actor || actor.type === 'employee') {
    return <EmptyState title="هذا الحساب غير مخول لاستخدام نقطة البيع" />;
  }
  if (session.isPending) {
    return <Card><CardContent>جارٍ تحميل وردية الكاشير…</CardContent></Card>;
  }
  if (session.isError) {
    return (
      <EmptyState
        title="تعذر تحميل وردية الكاشير"
        description={errorMessage(session.error)}
        action={
          <Button variant="secondary" size="sm" onClick={() => void session.refetch()}>
            إعادة المحاولة
          </Button>
        }
      />
    );
  }
  if (!session.data || (actor?.type === 'cashier' && session.data.openedByAccountId !== actor.accountId)) {
    const actorAccountId = actor.type === 'cashier' ? actor.accountId : null;
    const pending = readPending((item) => item.owner.role === actor.type
      && item.owner.accountId === actorAccountId
      && (actor.type === 'cashier' || item.owner.branchId === branchId));
    const canRecover = pending
      && pending.owner.role === actor.type
      && pending.owner.accountId === actorAccountId
      && (actor.type === 'cashier' || pending.owner.branchId === branchId);
    if (canRecover) return <PendingSaleRecovery pending={pending} />;
    return (
      <EmptyState
        title="لا توجد وردية بيع متاحة لهذا الحساب"
        description="افتح ورديتك من الصفحة الرئيسية قبل إتمام أي عملية بيع."
      />
    );
  }

  return (
    <SaleWorkspace
      key={`${actor.type}:${actor.type === 'cashier' ? actor.accountId : 'admin'}:${session.data.branchId}:${session.data.id}`}
      {...(branchId === undefined ? {} : { branchId })}
      workspaceBranchId={session.data.branchId}
      cashierSessionId={session.data.id}
      accountId={actor.type === 'cashier' ? actor.accountId : null}
      role={actor.type}
    />
  );
}

function PendingSaleRecovery({ pending }: { pending: PendingSale }) {
  const attempted = useRef(false);
  const recovery = useMutation({
    mutationFn: completeSale,
    onSuccess: (_invoice, input) => removePendingRequest(input),
    onError: (error, input) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        removePendingRequest(input);
      }
    },
  });

  useEffect(() => {
    if (!attempted.current && navigator.onLine) {
      attempted.current = true;
      recovery.mutate(pending.input);
    }
  }, [pending.input, recovery]);

  if (recovery.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader><CardTitle>تم حفظ الفاتورة</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-center">
          <p className="font-mono text-lg font-semibold" dir="ltr">{recovery.data.invoiceNumber}</p>
          <p>{recovery.data.totals.total} ج.م</p>
        </CardContent>
      </Card>
    );
  }

  if (recovery.isError) {
    const authoritative = recovery.error instanceof ApiError
      && recovery.error.status >= 400 && recovery.error.status < 500;
    return (
      <EmptyState
        title={authoritative ? 'تعذر استعادة البيع المعلق' : 'تعذر تأكيد نتيجة البيع المعلق'}
        description={errorMessage(recovery.error)}
        action={!authoritative ? (
          <Button variant="secondary" onClick={() => recovery.mutate(pending.input)}>
            إعادة المحاولة بنفس الطلب
          </Button>
        ) : undefined}
      />
    );
  }

  return <Card><CardContent>جارٍ استعادة نتيجة البيع المعلق…</CardContent></Card>;
}

function SaleWorkspace({
  branchId,
  workspaceBranchId,
  cashierSessionId,
  accountId,
  role,
}: {
  branchId?: number;
  workspaceBranchId: number;
  cashierSessionId: number;
  accountId: number | null;
  role: 'admin' | 'cashier';
}) {
  const workspaceOwner = useMemo<PendingSaleOwner>(() => ({
    accountId,
    role,
    branchId: workspaceBranchId,
    cashierSessionId,
  }), [accountId, cashierSessionId, role, workspaceBranchId]);
  const [client, setClient] = useState<Client | null>(null);
  const [employee, setEmployee] = useState<AssignableEmployee | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [discountKind, setDiscountKind] = useState<AdjustmentKind>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [taxKind, setTaxKind] = useState<AdjustmentKind>('percentage');
  const [taxValue, setTaxValue] = useState('');
  const [payments, setPayments] = useState<Record<PaymentMethod, string>>({
    cash: '', visa: '', instapay: '', vodafone_cash: '',
  });
  const [paymentsTouched, setPaymentsTouched] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingSale, setPendingSale] = useState<PendingSale | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [completed, setCompleted] = useState<InvoiceDto | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const didReplayOnMount = useRef(false);
  const hasDraftProgress = Boolean(
    client || employee || lines.length > 0 || discountValue || taxValue || paymentsTouched,
  );
  const matchesActiveDraft = useCallback((pending: PendingSale) => (
    pending.owner.accountId === workspaceOwner.accountId
      && pending.owner.role === workspaceOwner.role
      && pending.owner.branchId === workspaceOwner.branchId
      && pending.owner.cashierSessionId === workspaceOwner.cashierSessionId
      && (!hasDraftProgress || pending.input.idempotencyKey === idempotencyKey)
  ), [hasDraftProgress, idempotencyKey, workspaceOwner]);
  const pendingMatchesActiveDraft = Boolean(
    pendingSale
      && pendingSale.owner.accountId === workspaceOwner.accountId
      && pendingSale.owner.role === workspaceOwner.role
      && pendingSale.owner.branchId === workspaceOwner.branchId
      && pendingSale.owner.cashierSessionId === workspaceOwner.cashierSessionId
      && (!hasDraftProgress || pendingSale.input.idempotencyKey === idempotencyKey),
  );
  const pendingInput = pendingMatchesActiveDraft ? pendingSale!.input : null;

  useEffect(() => {
    let cancelled = false;
    let releaseLease: () => void = () => undefined;
    void acquireSaleDraftTab(workspaceOwner).then((release) => {
      if (cancelled) {
        release();
        return;
      }
      releaseLease = release;
      const draft = readSaleDraft(workspaceOwner);
      if (draft) {
        setClient(null);
        setEmployee(draft.employee);
        setLines(draft.lines);
        setDiscountKind(draft.discountKind);
        setDiscountValue(draft.discountValue);
        setTaxKind(draft.taxKind);
        setTaxValue(draft.taxValue);
        setPayments(draft.payments);
        setPaymentsTouched(draft.paymentsTouched);
        setIdempotencyKey(draft.idempotencyKey);
        setDraftRestored(true);
      }
      setDraftHydrated(true);
    });
    return () => {
      cancelled = true;
      releaseLease();
    };
  }, [workspaceOwner]);

  useEffect(() => {
    if (!draftHydrated) return;
    const synchronizePending = (event?: StorageEvent) => {
      if (!event || event.key === PENDING_KEY || event.key?.startsWith(PENDING_KEY_PREFIX)) {
        setPendingSale(readPending(matchesActiveDraft));
      }
    };
    synchronizePending();
    window.addEventListener('storage', synchronizePending);
    return () => window.removeEventListener('storage', synchronizePending);
  }, [draftHydrated, matchesActiveDraft]);

  const quoteInput = useMemo<QuoteSaleInput>(() => ({
    ...(branchId === undefined ? {} : { branchId }),
    lines: lines.map(({ service, quantity }) => ({
      itemType: 'service' as const,
      serviceId: service.id,
      quantity,
    })),
    ...(discountValue ? { discount: { kind: discountKind, value: discountValue } } : {}),
    ...(taxValue ? { tax: { kind: taxKind, value: taxValue } } : {}),
  }), [branchId, discountKind, discountValue, lines, taxKind, taxValue]);

  const quote = useQuery({
    queryKey: salesQueryKeys.quote(quoteInput),
    queryFn: () => quoteSale(quoteInput),
    enabled: lines.length > 0,
  });

  useEffect(() => {
    if (quote.data && !paymentsTouched) {
      setPayments((current) => ({ ...current, cash: quote.data!.totals.total }));
    }
  }, [paymentsTouched, quote.data]);

  useEffect(() => {
    if (!draftHydrated) return;
    if (!hasDraftProgress) {
      removeSaleDraft(workspaceOwner, idempotencyKey);
      setDraftStorageError(false);
      return;
    }
    const saved = writeSaleDraft(workspaceOwner, {
      client,
      employee,
      lines,
      discountKind,
      discountValue,
      taxKind,
      taxValue,
      payments,
      paymentsTouched,
      idempotencyKey,
    });
    setDraftStorageError(!saved);
  }, [
    client,
    draftHydrated,
    discountKind,
    discountValue,
    employee,
    hasDraftProgress,
    idempotencyKey,
    lines,
    payments,
    paymentsTouched,
    taxKind,
    taxValue,
    workspaceOwner,
  ]);

  const completion = useMutation({
    mutationFn: completeSale,
    onSuccess: (invoice, input) => {
      removePendingRequest(input);
      setPendingSale(null);
      setAmbiguous(false);
      setConfirming(false);
      removeSaleDraft(workspaceOwner, input.idempotencyKey);
      setDraftRestored(false);
      setCompleted(invoice);
    },
    onError: (error, input) => {
      setConfirming(false);
      const isAuthoritativeRejection = error instanceof ApiError
        && error.status >= 400 && error.status < 500;
      setAmbiguous(!isAuthoritativeRejection);
      if (isAuthoritativeRejection) {
        removePendingRequest(input);
        setPendingSale(null);
      }
    },
  });
  const completePending = completion.mutate;
  const completionPending = completion.isPending;

  useEffect(() => {
    const retry = () => {
      if (pendingInput && !completionPending) completePending(pendingInput);
    };
    if (pendingInput && !didReplayOnMount.current && navigator.onLine) {
      didReplayOnMount.current = true;
      retry();
    }
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [completePending, completionPending, pendingInput]);

  const paidCents = Object.values(payments).reduce<bigint | null>((sum, value) => {
    if (sum === null || !value) return sum;
    const cents = toCents(value);
    return cents === null ? null : sum + cents;
  }, BigInt(0));
  const totalCents = quote.data ? toCents(quote.data.totals.total) : null;
  const remaining = paidCents === null || totalCents === null ? null : totalCents - paidCents;
  const ready = Boolean(
    client && employee && lines.length > 0 && quote.data && !quote.isFetching
    && remaining === BigInt(0) && !completion.isPending && !pendingSale,
  );

  const makeInput = (): CompleteSaleInput | null => {
    if (!client || !employee || !quote.data || remaining !== BigInt(0)) return null;
    const paymentRows = paymentMethods.flatMap(({ method }) => {
      const amount = payments[method];
      return amount && toCents(amount)! > BigInt(0) ? [{ method, amount }] : [];
    });
    return {
      ...(branchId === undefined ? {} : { branchId }),
      clientId: client.id,
      assignedEmployeeId: employee.id,
      cashierSessionId,
      idempotencyKey,
      lines: quoteInput.lines,
      ...(quoteInput.discount ? { discount: quoteInput.discount } : {}),
      ...(quoteInput.tax ? { tax: quoteInput.tax } : {}),
      payments: paymentRows,
    };
  };

  const submit = () => {
    if (pendingSale) return;
    const input = makeInput();
    if (!input) return;
    const stored = { owner: workspaceOwner, input };
    try {
      localStorage.setItem(pendingKey(input.idempotencyKey), JSON.stringify(stored));
    } catch {
      setConfirming(false);
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setPendingSale(stored);
    completion.mutate(input);
  };

  const reset = () => {
    setClient(null);
    setEmployee(null);
    setLines([]);
    setPayments({ cash: '', visa: '', instapay: '', vodafone_cash: '' });
    setPaymentsTouched(false);
    setDiscountValue('');
    setTaxValue('');
    setCompleted(null);
    setDraftRestored(false);
    setDraftStorageError(false);
    removeSaleDraft(workspaceOwner, idempotencyKey);
    setIdempotencyKey(crypto.randomUUID());
  };

  if (completed) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader><CardTitle>تم حفظ الفاتورة</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="font-mono text-lg font-semibold" dir="ltr">{completed.invoiceNumber}</p>
          <p>{completed.totals.total} ج.م</p>
          <Button onClick={reset}><RotateCcw className="size-4" />بيع جديد</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">بيع خدمة</h1>
        <p className="mt-1 text-sm text-muted">اختر العميل والخدمات والموظف ثم راجع الإجمالي المحسوب من الخادم.</p>
      </div>

      {draftRestored ? (
        <p role="status" className="rounded-control bg-success-soft px-3 py-2 text-sm text-success">
          تم استعادة مسودة البيع المحفوظة لهذا الحساب والوردية.
        </p>
      ) : null}

      {draftStorageError ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
          تعذر حفظ مسودة البيع في المتصفح. لا تغادر الصفحة قبل إتمام البيع.
        </p>
      ) : null}

      {ambiguous ? (
        <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 bg-warning-soft">
          <div>
            <p className="font-medium">تعذر تأكيد نتيجة البيع</p>
            <p className="text-sm text-muted">سيُعاد استخدام نفس مفتاح العملية، ولن تُنشأ فاتورة مكررة.</p>
          </div>
          <Button
            variant="secondary"
            disabled={!pendingInput || completion.isPending}
            onClick={() => pendingInput && completion.mutate(pendingInput)}
          >
            إعادة المحاولة بنفس الطلب
          </Button>
        </CardContent></Card>
      ) : null}

      {pendingSale && !pendingMatchesActiveDraft ? (
        <Card><CardContent className="bg-warning-soft">
          <p className="font-medium">يوجد بيع معلق محفوظ لحساب أو وردية أخرى</p>
          <p className="text-sm text-muted">لن يُعاد إرساله أو حذفه من مساحة العمل الحالية. افتح الحساب والوردية الأصليين لاستعادته بأمان.</p>
        </CardContent></Card>
      ) : null}

      <fieldset
        disabled={Boolean(pendingInput)}
        className="m-0 min-w-0 border-0 p-0"
      >
        <legend className="sr-only">تفاصيل البيع</legend>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Card><CardHeader><CardTitle>1. العميل</CardTitle></CardHeader><CardContent>
            <ClientPicker selected={client} onSelect={setClient} {...(branchId === undefined ? {} : { branchId })} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>2. الخدمات</CardTitle></CardHeader><CardContent className="space-y-3">
            <ServicePicker {...(branchId === undefined ? {} : { branchId })} onSelect={(service) => setLines((current) => {
              const found = current.find(({ service: item }) => item.id === service.id);
              return found
                ? current.map((line) => line.service.id === service.id
                  ? { ...line, quantity: line.quantity + 1 }
                  : line)
                : [...current, { service, quantity: 1 }];
            })} />
            {lines.map((line) => (
              <div key={line.service.id} className="flex items-center justify-between gap-2 rounded-control border border-line p-3">
                <span><span className="block font-medium">{line.service.name}</span><span className="text-sm text-muted">{line.service.price} ج.م</span></span>
                <span className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" aria-label={`تقليل ${line.service.name}`} onClick={() => setLines((current) => current.flatMap((item) => item.service.id !== line.service.id ? [item] : item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : []))}><Minus className="size-4" /></Button>
                  <span className="w-8 text-center">{line.quantity}</span>
                  <Button variant="ghost" size="sm" aria-label={`زيادة ${line.service.name}`} onClick={() => setLines((current) => current.map((item) => item.service.id === line.service.id ? { ...item, quantity: item.quantity + 1 } : item))}><Plus className="size-4" /></Button>
                  <Button variant="ghost" size="sm" aria-label={`حذف ${line.service.name}`} onClick={() => setLines((current) => current.filter((item) => item.service.id !== line.service.id))}><Trash2 className="size-4" /></Button>
                </span>
              </div>
            ))}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. الموظف</CardTitle></CardHeader><CardContent>
            <PresentEmployeePicker
              selected={employee}
              onSelect={setEmployee}
              {...(branchId === undefined ? {} : { branchId })}
            />
          </CardContent></Card>
        </div>

        <div className="space-y-4">
          <Card><CardHeader><CardTitle>4. الخصم والضريبة</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">
            <AdjustmentInput label="الخصم" kind={discountKind} value={discountValue} onKind={setDiscountKind} onValue={setDiscountValue} />
            <AdjustmentInput label="الضريبة" kind={taxKind} value={taxValue} onKind={setTaxKind} onValue={setTaxValue} />
          </CardContent></Card>
          <Card><CardHeader><CardTitle>5. الإجمالي والمدفوعات</CardTitle></CardHeader><CardContent className="space-y-4">
            {quote.isPending && lines.length > 0 ? <p>جارٍ حساب الإجمالي من الخادم…</p> : null}
            {quote.isError ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-danger">{errorMessage(quote.error)}</p>
                <Button variant="secondary" size="sm" onClick={() => void quote.refetch()}>
                  إعادة حساب الإجمالي
                </Button>
              </div>
            ) : null}
            {quote.data ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>المجموع الفرعي</dt><dd className="text-end">{quote.data.totals.subtotal} ج.م</dd>
                <dt>الخصم</dt><dd className="text-end">{quote.data.totals.discountAmount} ج.م</dd>
                <dt>الضريبة</dt><dd className="text-end">{quote.data.totals.taxAmount} ج.م</dd>
                <dt className="font-semibold">الإجمالي</dt><dd className="text-end text-lg font-semibold">{quote.data.totals.total} ج.م</dd>
              </dl>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {paymentMethods.map(({ method, label }) => (
                <div key={method} className="space-y-1">
                  <Label htmlFor={`payment-${method}`}>{label}</Label>
                  <Input
                    id={`payment-${method}`}
                    inputMode="decimal"
                    dir="ltr"
                    value={payments[method]}
                    onChange={(event) => {
                      setPaymentsTouched(true);
                      setPayments((current) => ({ ...current, [method]: event.target.value }));
                    }}
                  />
                </div>
              ))}
            </div>
            {remaining !== null ? (
              <p role="status" className={remaining === BigInt(0) ? 'text-success' : 'text-warning'}>
                {remaining === BigInt(0)
                  ? 'تم سداد الإجمالي بالكامل'
                  : remaining > BigInt(0)
                    ? `المتبقي ${money(remaining)} ج.م`
                    : `المدفوع زائد بمقدار ${money(-remaining)} ج.م`}
              </p>
            ) : null}
            {completion.error && !ambiguous ? <p role="alert" className="text-danger">{errorMessage(completion.error)}</p> : null}
            {storageError ? (
              <p role="alert" className="text-danger">
                تعذر حفظ طلب البيع بأمان. تأكد من إتاحة تخزين المتصفح ثم حاول مرة أخرى.
              </p>
            ) : null}
            <Button className="w-full" disabled={!ready} onClick={() => setConfirming(true)}>
              مراجعة وإتمام البيع
            </Button>
          </CardContent></Card>
        </div>
        </div>
      </fieldset>

      {confirming ? (
        <Modal title="تأكيد البيع" onClose={() => setConfirming(false)}>
          <p>سيتم حفظ الفاتورة نهائيًا بقيمة {quote.data?.totals.total} ج.م.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>رجوع</Button>
            <Button disabled={completion.isPending} onClick={submit}>تأكيد البيع</Button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function AdjustmentInput(props: {
  label: string;
  kind: AdjustmentKind;
  value: string;
  onKind: (kind: AdjustmentKind) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{props.label}</Label>
      <div className="flex gap-2">
        <select
          aria-label={`نوع ${props.label}`}
          className="h-9 rounded-control border border-line bg-paper px-2 text-sm"
          value={props.kind}
          onChange={(event) => props.onKind(event.target.value as AdjustmentKind)}
        >
          <option value="percentage">نسبة %</option>
          <option value="fixed">مبلغ ثابت</option>
        </select>
        <Input
          aria-label={`قيمة ${props.label}`}
          inputMode="decimal"
          dir="ltr"
          value={props.value}
          onChange={(event) => props.onValue(event.target.value)}
        />
      </div>
    </div>
  );
}
