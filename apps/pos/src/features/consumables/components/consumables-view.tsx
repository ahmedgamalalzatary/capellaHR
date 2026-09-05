'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, PackageOpen } from 'lucide-react';
import { type ReactNode, type SetStateAction, useState } from 'react';
import { Badge, Button, Card, CardContent, EmptyState, Input, Label } from '@capella/ui';

import { DataTable, TD, TH, THead, TR } from '@/components/data/data-table';
import { LoadingState } from '@/components/feedback/loading-state';
import { FieldError, Notice } from '@/components/feedback/notice';
import { Select } from '@/components/form/select';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { useSession } from '@/features/auth';
import { listCatalogBranches } from '@/features/catalog';
import { listAllProducts } from '@/features/products';
import { ApiError } from '@/lib/api/client';
import { fetchAllPages } from '@/lib/api/fetch-all';
import {
  completeServiceExecutions, configureConsumable, listConsumableBalances,
  listConsumableServices, transferConsumableStock, type ConsumableBalance,
  type ConsumableServiceExecution,
} from '../api/consumables-api';

type Tab = 'pending' | 'completed' | 'stock';
type Usage = { productId: number | ''; quantity: string };
const emptyUsages = (): Usage[] => [{ productId: '', quantity: '' }];
const errorText = (error: unknown) => error instanceof ApiError || error instanceof Error
  ? error.message : 'تعذر تنفيذ العملية.';
const dateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium ${active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{children}</button>;
}

function ServicesTable({ items, selectable, selected, onToggle }: {
  items: ConsumableServiceExecution[]; selectable: boolean; selected: number[];
  onToggle: (item: ConsumableServiceExecution) => void;
}) {
  if (!items.length) return <EmptyState title={selectable ? 'لا توجد خدمات معلقة' : 'لا توجد خدمات مكتملة'} description={selectable ? 'كل خدمات العملاء مكتملة ويمكن إغلاق الوردية.' : 'ستظهر الخدمات هنا بعد إكمالها.'} />;
  return <DataTable><THead>{selectable ? <TH>اختيار</TH> : null}<TH>الخدمة</TH><TH>الدور</TH><TH>العميل</TH><TH>الموظف</TH><TH>الفاتورة</TH><TH>{selectable ? 'الحالة' : 'اكتملت في'}</TH></THead><tbody>{items.map((item) => <TR key={item.id}>
    {selectable ? <TD><input type="checkbox" aria-label={`اختيار الخدمة ${item.queueNumber}`} checked={selected.includes(item.id)} onChange={() => onToggle(item)} /></TD> : null}
    <TD className="font-medium">{item.serviceName}</TD>
    <TD><Badge variant={item.status === 'overdue' ? 'warning' : 'neutral'}>{item.queueNumber}</Badge></TD>
    <TD>{item.clientName ?? item.clientPhone ?? '—'}</TD><TD>{item.employeeName ?? '—'}</TD><TD>{item.invoiceNumber}</TD>
    <TD>{selectable ? <Badge variant={item.status === 'overdue' ? 'warning' : 'neutral'}>{item.status === 'overdue' ? 'من وردية منتهية' : 'معلقة'}</Badge> : item.completedAt ? dateTime(item.completedAt) : '—'}</TD>
  </TR>)}</tbody></DataTable>;
}

function CompletionPanel({ selected, balances, branchId, onCompleted }: {
  selected: number[]; balances: ConsumableBalance[]; branchId: number | undefined; onCompleted: () => Promise<void>;
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
    mutationFn: () => completeServiceExecutions({
      ...(branchId === undefined ? {} : { branchId }), serviceQueueEntryIds: selected,
      usages: noConsumables ? [] : validUsages, noConsumablesConfirmed: noConsumables,
    }),
    onSuccess: async () => { rawSetUsages(emptyUsages()); setNoConsumables(false); await onCompleted(); },
  });
  return <div className="space-y-4 border-t border-line p-4">
    <div><SectionHeading title={`إكمال ${selected.length} خدمة`} /><p className="mt-1 text-sm text-muted">سجّل الكمية المستخدمة لكل خدمة محددة. يمكن جمع الخدمات المتطابقة فقط.</p></div>
    <label className="flex w-fit items-center gap-2 rounded-control border border-line px-3 py-2 text-sm"><input type="checkbox" checked={noConsumables} onChange={(event) => { setNoConsumables(event.target.checked); if (event.target.checked) rawSetUsages(emptyUsages()); }} />لم تُستخدم مستهلكات</label>
    {!noConsumables ? <div className="space-y-2">{usages.map((usage, index) => <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_auto]" key={index}>
      <Select aria-label={`المستهلك ${index + 1}`} value={usage.productId} onChange={(event) => setUsages((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, productId: event.target.value ? Number(event.target.value) : '' } : row))}><option value="">اختر المستهلك</option>{balances.map((item) => <option key={item.productId} value={item.productId}>{item.productName} ({item.consumableQuantity} {item.unit})</option>)}</Select>
      <Input aria-label={index === 0 ? 'كمية المستهلك' : `كمية المستهلك ${index + 1}`} type="number" min="0.001" step="0.001" placeholder="الكمية" value={usage.quantity} onChange={(event) => setUsages((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} />
      {usages.length > 1 ? <Button variant="ghost" onClick={() => setUsages((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>حذف</Button> : <span />}
    </div>)}<Button variant="secondary" onClick={() => setUsages((rows) => [...rows, { productId: '', quantity: '' }])}>إضافة مستهلك</Button></div> : <Notice tone="info">سيُحفظ أن الخدمة اكتملت دون استهلاك منتجات.</Notice>}
    {validationError && !noConsumables ? <FieldError>{validationError}</FieldError> : null}
    {complete.isError ? <FieldError>{errorText(complete.error)}</FieldError> : null}
    <Button disabled={!selected.length || (!noConsumables && !hasUsage) || complete.isPending} onClick={() => complete.mutate()}>إكمال الخدمات المحددة</Button>
  </div>;
}

function StockPanel({ branchId, balances, refresh, isAdmin, initialProductId }: { branchId: number | undefined; balances: ConsumableBalance[]; refresh: () => Promise<void>; isAdmin: boolean; initialProductId?: number }) {
  const [configProductId, setConfigProductId] = useState<number | ''>(initialProductId ?? '');
  const [unit, setUnit] = useState<'ml' | 'gm'>('ml'); const [packageSize, setPackageSize] = useState('');
  const [transferProductId, setTransferProductId] = useState<number | ''>(''); const [direction, setDirection] = useState<'reserve' | 'return'>('reserve'); const [packages, setPackages] = useState('1');
  const params = branchId === undefined ? {} : { branchId };
  const products = useQuery({ queryKey: ['consumables-products', branchId], queryFn: () => listAllProducts(params), enabled: isAdmin });
  const configure = useMutation({ mutationFn: () => configureConsumable(Number(configProductId), { ...params, unit, packageSize }), onSuccess: refresh });
  const transfer = useMutation({ mutationFn: () => transferConsumableStock(Number(transferProductId), { ...params, direction, packages: Number(packages) }), onSuccess: refresh });
  const pending = configure.isPending || transfer.isPending; const failed = configure.error ?? transfer.error;
  return <div className="space-y-5">{isAdmin ? <><div className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="space-y-3 p-4"><SectionHeading title="إعداد منتج كمستهلك" /><Select aria-label="منتج إعداد المستهلك" value={configProductId} onChange={(event) => setConfigProductId(event.target.value ? Number(event.target.value) : '')}><option value="">اختر المنتج</option>{products.data?.items.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select><div className="flex gap-2"><Select aria-label="وحدة المستهلك" value={unit} onChange={(event) => setUnit(event.target.value as 'ml' | 'gm')}><option value="ml">ml</option><option value="gm">gm</option></Select><Input aria-label="حجم العبوة" type="number" min="0.001" step="0.001" value={packageSize} onChange={(event) => setPackageSize(event.target.value)} /></div><Button disabled={!configProductId || !Number(packageSize) || pending} onClick={() => configure.mutate()}>حفظ الإعداد</Button></CardContent></Card>
    <Card><CardContent className="space-y-3 p-4"><SectionHeading title="تحويل عبوات كاملة" /><Select aria-label="منتج التحويل" value={transferProductId} onChange={(event) => setTransferProductId(event.target.value ? Number(event.target.value) : '')}><option value="">اختر المستهلك</option>{balances.map((item) => <option key={item.productId} value={item.productId}>{item.productName}</option>)}</Select><div className="flex gap-2"><Select aria-label="اتجاه التحويل" value={direction} onChange={(event) => setDirection(event.target.value as 'reserve' | 'return')}><option value="reserve">حجز من مخزون البيع</option><option value="return">إرجاع لمخزون البيع</option></Select><Input aria-label="عدد العبوات" type="number" min="1" step="1" value={packages} onChange={(event) => setPackages(event.target.value)} /></div><Button disabled={!transferProductId || !Number(packages) || pending} onClick={() => transfer.mutate()}>تنفيذ التحويل</Button></CardContent></Card></div>
    {failed ? <FieldError>{errorText(failed)}</FieldError> : null}</> : null}
    <Card><CardContent className="p-4"><SectionHeading title="أرصدة المستهلكات" /><DataTable><THead><TH>المنتج</TH><TH>مخزون البيع</TH><TH>رصيد المستهلك</TH><TH>حجم العبوة</TH></THead><tbody>{balances.map((item) => <TR key={item.productId}><TD>{item.productName}</TD><TD>{item.sellableQuantity}</TD><TD>{item.consumableQuantity} {item.unit}</TD><TD>{item.packageSize} {item.unit}</TD></TR>)}</tbody></DataTable></CardContent></Card></div>;
}

export function ConsumablesView() {
  const cache = useQueryClient(); const session = useSession(); const isAdmin = session.data?.actor.type === 'admin';
  const search = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const [branchId, setBranchId] = useState<number | undefined>(() => { const value = Number(search?.get('branchId')); return value > 0 ? value : undefined; });
  const [tab, setTab] = useState<Tab>(() => search?.has('productId') ? 'stock' : 'pending');
  const [selected, setSelected] = useState<number[]>([]);
  const cashierSessionId = Number(search?.get('cashierSessionId')) || undefined;
  const productId = Number(search?.get('productId')) || undefined;
  const ready = session.isSuccess && (!isAdmin || branchId !== undefined); const params = branchId === undefined ? {} : { branchId };
  const branches = useQuery({ queryKey: ['consumables-branches'], queryFn: () => listCatalogBranches(), enabled: isAdmin });
  const balances = useQuery({ queryKey: ['consumables-balances', branchId], queryFn: () => fetchAllPages((page) => listConsumableBalances({ ...params, page, pageSize: 100 })), enabled: ready });
  const services = useQuery({ queryKey: ['consumables-services', branchId, tab, cashierSessionId], queryFn: () => fetchAllPages((page) => listConsumableServices({ ...params, ...(cashierSessionId ? { cashierSessionId } : {}), status: tab === 'completed' ? 'completed' : 'unfinished', page, pageSize: 100 })), enabled: ready && tab !== 'stock' });
  const refresh = async () => { await Promise.all([cache.invalidateQueries({ queryKey: ['consumables-balances'] }), cache.invalidateQueries({ queryKey: ['consumables-services'] })]); };
  const changeTab = (next: Tab) => { setTab(next); setSelected([]); };
  const toggle = (item: ConsumableServiceExecution) => setSelected((current) => {
    if (current.includes(item.id)) return current.filter((id) => id !== item.id);
    const selectedServiceId = services.data?.find((candidate) => current.includes(candidate.id))?.serviceId;
    return selectedServiceId === undefined || selectedServiceId === item.serviceId ? [...current, item.id] : current;
  });
  return <section className="space-y-6"><PageHeader title="خدمات العملاء والمستهلكات" description="تابع خدمات العملاء، سجّل استهلاكها، وأدر رصيد المنتجات المستخدمة." />
    {isAdmin ? <Card><CardContent className="space-y-1.5 p-4"><Label htmlFor="consumables-branch">الفرع</Label><Select id="consumables-branch" value={branchId ?? ''} onChange={(event) => { setBranchId(event.target.value ? Number(event.target.value) : undefined); setSelected([]); }}><option value="">اختر الفرع</option>{branches.data?.items.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></CardContent></Card> : null}
    <div role="tablist" aria-label="خدمات العملاء والمستهلكات" className="flex gap-1 overflow-x-auto border-b border-line"><TabButton active={tab === 'pending'} onClick={() => changeTab('pending')}><Clock3 className="size-4" />الخدمات المعلقة{tab === 'pending' && services.data ? ` (${services.data.length})` : ''}</TabButton><TabButton active={tab === 'completed'} onClick={() => changeTab('completed')}><CheckCircle2 className="size-4" />الخدمات المكتملة</TabButton><TabButton active={tab === 'stock'} onClick={() => changeTab('stock')}><PackageOpen className="size-4" />مخزون المستهلكات</TabButton></div>
    {!ready ? <EmptyState title="اختر فرعاً للمتابعة" /> : tab === 'stock' ? (balances.isPending ? <LoadingState label="جارٍ تحميل المستهلكات…" /> : <StockPanel branchId={branchId} balances={balances.data ?? []} refresh={refresh} isAdmin={isAdmin} {...(productId === undefined ? {} : { initialProductId: productId })} />) : <Card><CardContent className="p-0">{services.isPending ? <LoadingState label="جارٍ تحميل خدمات العملاء…" /> : <ServicesTable items={services.data ?? []} selectable={tab === 'pending'} selected={selected} onToggle={toggle} />}{tab === 'pending' && selected.length ? <CompletionPanel selected={selected} balances={balances.data ?? []} branchId={branchId} onCompleted={async () => { setSelected([]); await refresh(); }} /> : null}</CardContent></Card>}
  </section>;
}
