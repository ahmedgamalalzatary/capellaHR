'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, PackageOpen } from 'lucide-react';
import { type ReactNode, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, SortableTH, type SortState } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { Pagination } from '@/components/data/pagination';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError, Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { QueueReassignmentDialog } from '@/features/sales';
import { listCatalogBranches } from '@/features/catalog';
import { useAdminBranch } from '@/hooks/use-admin-branch';
import { notifyError, notifySuccess } from '@/lib/notify';
import { listAllProducts } from '@/features/products';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import {
  configureConsumable, listConsumableBalances, listConsumableServices,
  recordServiceConsumptions, transferConsumableStock, updateServiceExecutionStatus, type ConsumableBalance,
  type ConsumableServiceExecution,
} from '../api/consumables-api';

type Tab = 'status' | 'consumables' | 'stock';
type Usage = { productId: number | ''; quantity: string };
const emptyUsages = (): Usage[] => [{ productId: '', quantity: '' }];
const errorText = (error: unknown) => error instanceof ApiError || error instanceof Error
  ? error.message : 'تعذر تنفيذ العملية.';

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{children}</button>;
}

function ServicesTable({ items, mode, selected, onToggle, onStatus, statusPending, page, totalPages, onPage, isAdmin, onReassign }: {
  items: ConsumableServiceExecution[]; mode: 'status' | 'consumables'; selected: number[];
  onToggle: (item: ConsumableServiceExecution) => void;
  onStatus: (item: ConsumableServiceExecution, status: 'pending' | 'in_progress' | 'completed') => void;
  statusPending: boolean;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  isAdmin: boolean;
  onReassign: (item: ConsumableServiceExecution) => void;
}) {
  if (!items.length) return <EmptyState title={mode === 'status' ? 'لا توجد خدمات' : 'لا توجد خدمات مكتملة'} />;
  return <><DataTable><THead>{mode === 'consumables' ? <TH>اختيار</TH> : null}<TH>الخدمة</TH><TH>الدور</TH><TH>العميل</TH><TH>الموظف</TH><TH>الفاتورة</TH><TH>الحالة</TH></THead><tbody>{items.map((item) => <TR key={item.id}>
    {mode === 'consumables' ? <TD>{item.consumptionRecorded ? null : <input type="checkbox" aria-label={`اختيار الخدمة ${item.queueNumber}`} checked={selected.includes(item.id)} onChange={() => onToggle(item)} />}</TD> : null}
    <TD className="font-medium">{item.serviceName}</TD>
    <TD><Badge variant={item.status === 'overdue' ? 'warning' : 'neutral'}>{item.queueNumber}</Badge></TD>
    <TD>{item.clientName ?? item.clientPhone ?? '—'}</TD><TD>{item.employeeName ?? '—'}</TD><TD>{item.invoiceNumber}{mode === 'status' && item.status !== 'canceled' && (item.status !== 'completed' || isAdmin) ? <Button size="sm" variant="secondary" onClick={() => onReassign(item)}>{'\u062a\u063a\u064a\u064a\u0631 \u0627\u0644\u0645\u0648\u0638\u0641'}</Button> : null}</TD>
    <TD>{mode === 'consumables' ? <Badge variant={item.consumptionRecorded ? 'success' : 'warning'}>{item.consumptionRecorded ? 'مسجلة' : 'لم تسجل'}</Badge> : item.status === 'completed' ? <Badge variant="success">تمت</Badge> : <div className="flex gap-1"><Button size="sm" variant={item.status === 'pending' ? 'secondary' : 'ghost'} disabled={statusPending} onClick={() => onStatus(item, 'pending')}>لم تبدأ</Button><Button size="sm" variant={item.status === 'in_progress' ? 'secondary' : 'ghost'} disabled={statusPending} onClick={() => onStatus(item, 'in_progress')}>قيد التنفيذ</Button><Button size="sm" disabled={statusPending} onClick={() => onStatus(item, 'completed')}>تمت</Button></div>}</TD>
  </TR>)}</tbody></DataTable><Pagination summary={<>صفحة <span className="tabular">{page}</span></>} previousDisabled={page <= 1} nextDisabled={page >= totalPages} onPrevious={() => onPage(page - 1)} onNext={() => onPage(page + 1)} page={page} totalPages={totalPages} onPage={onPage} persistenceKey={mode === 'status' ? 'pos:consumables:services' : 'pos:consumables:usage'} resultSetKey={JSON.stringify({ mode })} /></>;
}

function CompletionPanel({ selected, balances, branchId, onCompleted, onClose }: {
  selected: number[]; balances: ConsumableBalance[]; branchId: number | undefined; onCompleted: () => Promise<void>; onClose: () => void;
}) {
  const [usages, rawSetUsages] = useState<Usage[]>(emptyUsages);
  const [noConsumables, setNoConsumables] = useState(false);
  const setUsages = (next: SetStateAction<Usage[]>) => rawSetUsages((current) => {
    const proposed = typeof next === 'function' ? next(current) : next;
    const ids = proposed.flatMap((row) => typeof row.productId === 'number' ? [row.productId] : []);
    return new Set(ids).size === ids.length ? proposed : current;
  });
  const usageErrors = usages.map((entry, index) => {
    if (entry.productId === '' && entry.quantity.trim() === '') return null;
    if (entry.productId === '') return `صف المستهلك ${index + 1}: اختر المنتج`;
    if (!Number.isFinite(Number(entry.quantity)) || Number(entry.quantity) <= 0) return `صف المستهلك ${index + 1}: أدخل كمية أكبر من صفر`;
    return null;
  });
  const validUsages = usages.filter((entry): entry is { productId: number; quantity: string } => typeof entry.productId === 'number' && Number(entry.quantity) > 0);
  const validationError = usageErrors.filter(Boolean).join('، ');
  const hasUsage = validUsages.length > 0 && !validationError;
  const complete = useMutation({
    mutationFn: () => recordServiceConsumptions({
      ...(branchId === undefined ? {} : { branchId }), serviceQueueEntryIds: selected,
      usages: noConsumables ? [] : validUsages, noConsumablesConfirmed: noConsumables,
    }),
    onSuccess: async () => { rawSetUsages(emptyUsages()); setNoConsumables(false); notifySuccess('تم حفظ المستهلكات.'); await onCompleted(); },
    onError: (error: unknown) => notifyError(error),
  });
  return <Modal title={`تسجيل مستهلكات ${selected.length} خدمة`} className="max-h-[90dvh] max-w-xl overflow-y-auto" onClose={() => { if (!complete.isPending) onClose(); }}>
    <p className="text-sm text-muted">سجّل الكمية المستخدمة لكل خدمة محددة. يمكن جمع الخدمات المتطابقة فقط.</p>
    <label className="flex w-fit items-center gap-2 rounded-control border border-line px-3 py-2 text-sm"><input type="checkbox" checked={noConsumables} onChange={(event) => { setNoConsumables(event.target.checked); if (event.target.checked) rawSetUsages(emptyUsages()); }} />لم تُستخدم مستهلكات</label>
    {!noConsumables ? <div className="space-y-2">{usages.map((usage, index) => <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_auto]" key={index}>
      <Select aria-label={`المستهلك ${index + 1}`} value={usage.productId} onChange={(event) => setUsages((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: event.target.value ? Number(event.target.value) : '' } : row))}><option value="">اختر المستهلك</option>{balances.map((item) => <option key={item.productId} value={item.productId}>{item.productName} ({item.consumableQuantity} {item.unit})</option>)}</Select>
      <Input aria-label={index === 0 ? 'كمية المستهلك' : `كمية المستهلك ${index + 1}`} type="number" min="0.001" step="0.001" placeholder="الكمية" value={usage.quantity} onChange={(event) => setUsages((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} />
      {usages.length > 1 ? <Button variant="ghost" onClick={() => setUsages((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>حذف</Button> : <span />}
    </div>)}<Button variant="secondary" onClick={() => setUsages((rows) => [...rows, { productId: '', quantity: '' }])}>إضافة مستهلك</Button></div> : <Notice tone="info">سيُحفظ أن الخدمة اكتملت دون استهلاك منتجات.</Notice>}
    {validationError && !noConsumables ? <FieldError>{validationError}</FieldError> : null}
    {complete.isError ? <FieldError>{errorText(complete.error)}</FieldError> : null}
    <div className="flex flex-wrap gap-2">
      <Button disabled={!selected.length || (!noConsumables && !hasUsage) || complete.isPending} onClick={() => complete.mutate()}>حفظ المستهلكات</Button>
      <Button variant="ghost" disabled={complete.isPending} onClick={onClose}>إلغاء</Button>
    </div>
  </Modal>;
}

function StockPanel({ branchId, balances, allBalances, meta, onPage, refresh, isAdmin, initialProductId }: { branchId: number | undefined; balances: ConsumableBalance[]; allBalances: ConsumableBalance[]; meta: { page: number; totalPages: number }; onPage: (page: number) => void; refresh: () => Promise<void>; isAdmin: boolean; initialProductId?: number }) {
  const [configProductId, setConfigProductId] = useState<number | ''>(initialProductId ?? '');
  const [configOpen, setConfigOpen] = useState(initialProductId !== undefined);
  const [transferOpen, setTransferOpen] = useState(false);
  const [unit, setUnit] = useState<'ml' | 'gm'>('ml'); const [packageSize, setPackageSize] = useState('');
  const [transferProductId, setTransferProductId] = useState<number | ''>(''); const [direction, setDirection] = useState<'reserve' | 'return'>('reserve'); const [packages, setPackages] = useState('1');
  const params = branchId === undefined ? {} : { branchId };
  const products = useQuery({ queryKey: ['consumables-products', branchId], queryFn: () => listAllProducts(params), enabled: isAdmin });
  const configure = useMutation({ mutationFn: () => configureConsumable(Number(configProductId), { ...params, unit, packageSize }), onSuccess: async () => { setConfigOpen(false); notifySuccess('تم حفظ إعداد المستهلك.'); await refresh(); }, onError: (error: unknown) => notifyError(error) });
  const transfer = useMutation({ mutationFn: () => transferConsumableStock(Number(transferProductId), { ...params, direction, packages: Number(packages) }), onSuccess: async () => { setTransferOpen(false); notifySuccess('تم تنفيذ التحويل.'); await refresh(); }, onError: (error: unknown) => notifyError(error) });
  const pending = configure.isPending || transfer.isPending;
  const [sort, setSort] = useState<SortState | null>(null);
  const ordered = useMemo(() => {
    if (!sort) return balances;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...balances].sort((a, b) => {
      switch (sort.key) {
        case 'product': return a.productName.localeCompare(b.productName, 'ar') * dir;
        case 'sellable': return (Number(a.sellableQuantity) - Number(b.sellableQuantity)) * dir;
        case 'consumable': return (Number(a.consumableQuantity) - Number(b.consumableQuantity)) * dir;
        default: return 0;
      }
    });
  }, [balances, sort]);
  return <div className="space-y-5">{isAdmin ? <>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setConfigOpen(true)}>إعداد منتج كمستهلك</Button>
      <Button variant="secondary" onClick={() => setTransferOpen(true)}>تحويل عبوات كاملة</Button>
    </div>
    {configOpen ? (
      <Modal title="إعداد منتج كمستهلك" className="max-h-[90dvh] max-w-xl overflow-y-auto" onClose={() => { if (!pending) setConfigOpen(false); }}>
        <Select aria-label="منتج إعداد المستهلك" value={configProductId} onChange={(event) => setConfigProductId(event.target.value ? Number(event.target.value) : '')}><option value="">اختر المنتج</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select><div className="flex gap-2"><Select aria-label="وحدة المستهلك" value={unit} onChange={(event) => setUnit(event.target.value as 'ml' | 'gm')}><option value="ml">ml</option><option value="gm">gm</option></Select><Input aria-label="حجم العبوة" type="number" min="0.001" step="0.001" value={packageSize} onChange={(event) => setPackageSize(event.target.value)} /></div>
        {configure.error ? <FieldError>{errorText(configure.error)}</FieldError> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!configProductId || !Number(packageSize) || pending} onClick={() => configure.mutate()}>حفظ الإعداد</Button>
          <Button variant="ghost" disabled={pending} onClick={() => setConfigOpen(false)}>إلغاء</Button>
        </div>
      </Modal>
    ) : null}
    {transferOpen ? (
      <Modal title="تحويل عبوات كاملة" className="max-h-[90dvh] max-w-xl overflow-y-auto" onClose={() => { if (!pending) setTransferOpen(false); }}>
        <Select aria-label="منتج التحويل" value={transferProductId} onChange={(event) => setTransferProductId(event.target.value ? Number(event.target.value) : '')}><option value="">اختر المستهلك</option>{allBalances.map((item) => <option key={item.productId} value={item.productId}>{item.productName}</option>)}</Select><div className="flex gap-2"><Select aria-label="اتجاه التحويل" value={direction} onChange={(event) => setDirection(event.target.value as 'reserve' | 'return')}><option value="reserve">حجز من مخزون البيع</option><option value="return">إرجاع لمخزون البيع</option></Select><Input aria-label="عدد العبوات" type="number" min="1" step="1" value={packages} onChange={(event) => setPackages(event.target.value)} /></div>
        {transfer.error ? <FieldError>{errorText(transfer.error)}</FieldError> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!transferProductId || !Number(packages) || pending} onClick={() => transfer.mutate()}>تنفيذ التحويل</Button>
          <Button variant="ghost" disabled={pending} onClick={() => setTransferOpen(false)}>إلغاء</Button>
        </div>
      </Modal>
    ) : null}
  </> : null}
    <Card><CardContent className="p-4"><SectionHeading title="أرصدة المستهلكات" /><DataTable><THead><SortableTH label="المنتج" sortKey="product" sort={sort} onSort={setSort} className="whitespace-nowrap px-2 py-2.5 text-[12px] font-semibold tracking-wide" /><SortableTH label="مخزون البيع" sortKey="sellable" sort={sort} onSort={setSort} className="whitespace-nowrap px-2 py-2.5 text-[12px] font-semibold tracking-wide" /><SortableTH label="رصيد المستهلك" sortKey="consumable" sort={sort} onSort={setSort} className="whitespace-nowrap px-2 py-2.5 text-[12px] font-semibold tracking-wide" /><TH>حجم العبوة</TH></THead><tbody>{ordered.map((item) => <TR key={item.productId}><TD>{item.productName}</TD><TD>{item.sellableQuantity}</TD><TD>{item.consumableQuantity} {item.unit}</TD><TD>{item.packageSize} {item.unit}</TD></TR>)}</tbody></DataTable><Pagination summary={<>صفحة <span className="tabular">{meta.page}</span></>} previousDisabled={meta.page <= 1} nextDisabled={meta.page >= meta.totalPages} onPrevious={() => onPage(meta.page - 1)} onNext={() => onPage(meta.page + 1)} page={meta.page} totalPages={meta.totalPages} onPage={onPage} persistenceKey="pos:consumables:stock" resultSetKey={JSON.stringify({ branchId })} /></CardContent></Card></div>;
}

export function ConsumablesView() {
  const cache = useQueryClient(); const session = useSession(); const { branchId, setBranchId, isAdmin } = useAdminBranch();
  const search = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  // Deep links (e.g. product label → ?productId=&branchId=) adopt their branch once, then shared state takes over.
  useEffect(() => {
    const urlBranch = Number(search?.get('branchId'));
    if (urlBranch > 0) setBranchId(urlBranch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tab, setTab] = useState<Tab>(() => search?.has('productId') ? 'stock' : 'status');
  const [statusPage, setStatusPage] = useState(1);
  const [consumablesPage, setConsumablesPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [reassigning, setReassigning] = useState<ConsumableServiceExecution | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number>();
  const [selectionHint, setSelectionHint] = useState<string>();
  const cashierSessionId = Number(search?.get('cashierSessionId')) || undefined;
  const productId = Number(search?.get('productId')) || undefined;
  const ready = session.isSuccess && (!isAdmin || branchId !== undefined);
  // Cashiers are server-pinned to their session branch: never send a stored
  // admin branch on their queries or mutations.
  const params = !isAdmin || branchId === undefined ? {} : { branchId };
  const branches = useQuery({ queryKey: ['consumables-branches'], queryFn: () => fetchAllPages((page) => listCatalogBranches(page)), enabled: isAdmin });
  const balances = useQuery({ queryKey: ['consumables-balances', branchId, stockPage], queryFn: () => listConsumableBalances({ ...params, page: stockPage, pageSize: 20 }), enabled: ready });
  const balanceOptions = useQuery({ queryKey: ['consumables-balance-options', branchId], queryFn: () => fetchAllPages((page) => listConsumableBalances({ ...params, page, pageSize: 100 })), enabled: ready });
  const services = useQuery({ queryKey: ['consumables-services', branchId, tab, cashierSessionId, tab === 'status' ? statusPage : consumablesPage], queryFn: () => listConsumableServices({ ...params, ...(cashierSessionId ? { cashierSessionId } : {}), status: tab === 'consumables' ? 'completed' : 'operational', page: tab === 'consumables' ? consumablesPage : statusPage, pageSize: 20 }), enabled: ready && tab !== 'stock' });
  const refresh = async () => { await Promise.all([cache.invalidateQueries({ queryKey: ['consumables-balances'] }), cache.invalidateQueries({ queryKey: ['consumables-services'] })]); };
  const statusMutation = useMutation({
    mutationFn: ({ item, status }: { item: ConsumableServiceExecution; status: 'pending' | 'in_progress' | 'completed' }) => updateServiceExecutionStatus({
      ...params, serviceQueueEntryIds: [item.id], status,
    }),
    onSuccess: async () => { notifySuccess('تم تحديث حالة الخدمة.'); await refresh(); },
    onError: (error: unknown) => notifyError(error),
  });
  const changeTab = (next: Tab) => { setTab(next); setSelected([]); setSelectedServiceId(undefined); if (next === 'status') setStatusPage(1); if (next === 'consumables') setConsumablesPage(1); if (next === 'stock') setStockPage(1); };
  const toggle = (item: ConsumableServiceExecution) => setSelected((current) => {
    if (current.includes(item.id)) {
      setSelectionHint(undefined);
      if (current.length === 1) setSelectedServiceId(undefined);
      return current.filter((id) => id !== item.id);
    }
    if (selectedServiceId !== undefined && selectedServiceId !== item.serviceId) {
      setSelectionHint('يمكن تسجيل استهلاك خدمة واحدة في كل مرة. أزل الاختيار الحالي أولًا.');
      return current;
    }
    setSelectionHint(undefined);
    setSelectedServiceId(item.serviceId);
    return [...current, item.id];
  });
  return <section className="space-y-6"><PageHeader title="خدمات العملاء والمستهلكات" description="تابع خدمات العملاء، سجّل استهلاكها، وأدر رصيد المنتجات المستخدمة." />
    {isAdmin ? <Card><CardContent className="space-y-1.5 p-4"><Label htmlFor="consumables-branch">الفرع</Label><Select id="consumables-branch" className="max-w-sm" disabled={branches.isPending || branches.isError} value={branchId ?? ''} onChange={(event) => { setBranchId(event.target.value ? Number(event.target.value) : undefined); setSelected([]); setSelectedServiceId(undefined); setSelectionHint(undefined); setStatusPage(1); setConsumablesPage(1); setStockPage(1); }}><option value="">اختر الفرع</option>{branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select>{branches.isError ? <FieldError>تعذر تحميل الفروع. <Button variant="secondary" size="sm" className="mt-2" onClick={() => void branches.refetch()}>إعادة المحاولة</Button></FieldError> : null}</CardContent></Card> : null}
    <div role="tablist" aria-label="خدمات العملاء والمستهلكات" className="flex gap-1 overflow-x-auto border-b border-line"><TabButton active={tab === 'status'} onClick={() => changeTab('status')}><Clock3 className="size-4" />حالة الخدمات</TabButton><TabButton active={tab === 'consumables'} onClick={() => changeTab('consumables')}><CheckCircle2 className="size-4" />تسجيل المستهلكات</TabButton><TabButton active={tab === 'stock'} onClick={() => changeTab('stock')}><PackageOpen className="size-4" />مخزون المستهلكات</TabButton></div>
    {!session.isSuccess ? <LoadingState label="جارٍ التحقق من الجلسة…" /> : !ready ? <EmptyState title="اختر فرعاً للمتابعة" /> : tab === 'stock' ? (balances.isPending ? <LoadingState label="جارٍ تحميل المستهلكات…" /> : <StockPanel branchId={branchId} balances={balances.data?.items ?? []} allBalances={balanceOptions.data ?? []} meta={{ page: balances.data?.meta.page ?? stockPage, totalPages: balances.data?.meta.totalPages ?? 1 }} onPage={setStockPage} refresh={refresh} isAdmin={isAdmin} {...(productId === undefined ? {} : { initialProductId: productId })} />) : <Card><CardContent className="p-0">{selectionHint ? <p role="status" className="border-b border-line px-4 py-2 text-[13px] text-warning">{selectionHint}</p> : null}{services.isPending ? <LoadingState label="جارٍ تحميل خدمات العملاء…" /> : <ServicesTable items={services.data?.items ?? []} mode={tab} selected={selected} onToggle={toggle} statusPending={statusMutation.isPending} page={services.data?.meta.page ?? (tab === 'consumables' ? consumablesPage : statusPage)} totalPages={services.data?.meta.totalPages ?? 1} onPage={tab === 'consumables' ? setConsumablesPage : setStatusPage} onStatus={(item, status) => statusMutation.mutate({ item, status })} isAdmin={isAdmin} onReassign={setReassigning} />}{statusMutation.isError ? <FieldError>{errorText(statusMutation.error)}</FieldError> : null}</CardContent></Card>}
    {tab === 'consumables' && selected.length && ready ? <CompletionPanel selected={selected} balances={balanceOptions.data ?? []} branchId={branchId} onCompleted={async () => { setSelected([]); setSelectedServiceId(undefined); await refresh(); }} onClose={() => { setSelected([]); setSelectedServiceId(undefined); }} /> : null}
    {reassigning ? <QueueReassignmentDialog ticket={reassigning} {...(branchId === undefined ? {} : { branchId })} onClose={() => setReassigning(null)} onUpdated={() => { void refresh(); void cache.invalidateQueries({ queryKey: ['erp-sales'] }); void cache.invalidateQueries({ queryKey: ['erp-commissions'] }); void cache.invalidateQueries({ queryKey: ['erp-reports'] }); }} /> : null}
  </section>;
}
