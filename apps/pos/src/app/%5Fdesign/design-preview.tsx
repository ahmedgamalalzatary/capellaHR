'use client';

import { Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Board,
  BoardFigure,
  BoardFigures,
  BoardRow,
  BoardRows,
  Button,
  Card,
  CardContent,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DataList,
  DateOnly,
  DateRangeFilter,
  DateTime,
  Duration,
  Field,
  FilterBar,
  FilterSelect,
  IconButton,
  Input,
  ListEmptyState,
  LoadingState,
  Modal,
  Money,
  MonthFilter,
  Notice,
  PageHeader,
  Pagination,
  Phone,
  RowActions,
  SearchInput,
  Section,
  Select,
  Skeleton,
  StatGrid,
  StatTile,
  StatusBadge,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  TotalsBar,
  normalizeArabic,
  useListState,
  type BoardRowState,
  type DataColumn,
  type StatusMap,
} from '@capella/ui';

export interface FontPair {
  id: string;
  name: string;
  display: string;
  body: string;
  stretch: string;
}

const FONT_STORAGE_KEY = 'capella:design-font-pair';
const FONT_EVENT = 'capella:design-font-pair';

/** The picked pair survives reloads (per browser) so the owner can compare across pages. */
const readFontPair = () => {
  try { return localStorage.getItem(FONT_STORAGE_KEY); } catch { return null; }
};
const subscribeFontPair = (onChange: () => void) => {
  window.addEventListener(FONT_EVENT, onChange);
  return () => window.removeEventListener(FONT_EVENT, onChange);
};
const writeFontPair = (id: string) => {
  try { localStorage.setItem(FONT_STORAGE_KEY, id); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(FONT_EVENT));
};

/* ------------------------------------------------------------------------------------------------
 * Sample data (preview only — not real clients or amounts)
 * --------------------------------------------------------------------------------------------- */

type InvoiceStatus = 'completed' | 'partially_refunded' | 'refunded' | 'voided';
const invoiceStatus: StatusMap<InvoiceStatus> = {
  completed: { label: 'مكتملة', tone: 'success' },
  partially_refunded: { label: 'مستردة جزئيًا', tone: 'warning' },
  refunded: { label: 'مستردة', tone: 'neutral' },
  voided: { label: 'ملغاة', tone: 'danger' },
};

interface SampleInvoice {
  id: number;
  number: string;
  client: string;
  phone: string;
  cashier: string;
  createdAt: string;
  total: number;
  remaining: number;
  status: InvoiceStatus;
}

const statuses: InvoiceStatus[] = ['completed', 'completed', 'partially_refunded', 'completed', 'voided', 'refunded'];
const sampleInvoices: SampleInvoice[] = Array.from({ length: 57 }, (_unused, index) => ({
  id: index + 1,
  number: `INV-${String(1040 + index).padStart(5, '0')}`,
  client: `عميلة تجريبية ${index + 1}`,
  phone: `0100${String(1234500 + index * 37).slice(0, 7)}`,
  cashier: index % 3 === 0 ? 'كاشير ١' : 'كاشير ٢',
  createdAt: new Date(Date.UTC(2026, 9, 14, 7 + (index % 10), (index * 7) % 60)).toISOString(),
  total: 150 + ((index * 73) % 900),
  remaining: index % 4 === 0 ? 50 : 0,
  status: statuses[index % statuses.length]!,
}));

const sampleEmployees = [
  { value: '1', label: 'أحمد علي', hint: 'المعادي' },
  { value: '2', label: 'فاطمة حسن', hint: 'مدينة نصر' },
  { value: '3', label: 'إيمان سعيد', hint: 'المعادي' },
  { value: '4', label: 'منى عبد الله', hint: 'الشيخ زايد' },
  { value: '5', label: 'هالة محمود', hint: 'مدينة نصر' },
];

/* ------------------------------------------------------------------------------------------------ */

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Section title={title} {...(note ? { description: note } : {})} className="border-t border-line pt-6">
      {children}
    </Section>
  );
}

function Swatch({ name, token, text, ratio }: { name: string; token: string; text?: string; ratio?: string }) {
  return (
    <div className="overflow-hidden rounded-control border border-line bg-paper">
      <div className="flex h-14 items-end p-2 text-[12px] font-semibold" style={{ background: `var(--color-${token})`, color: text ? `var(--color-${text})` : undefined }}>
        {text ? 'نص ١٢٣' : null}
      </div>
      <div className="p-2 text-[12px]">
        <p className="font-medium text-ink">{name}</p>
        <p className="tabular text-muted" dir="ltr">--color-{token}{ratio ? ` · ${ratio}` : ''}</p>
      </div>
    </div>
  );
}

function BoardDemo() {
  const [tick, setTick] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => setTick((value) => value + 1), 3500);
    return () => clearInterval(timer);
  }, [auto]);

  const drawer = 4250 + (tick % 5) * 185;
  const rows: { time: string; title: string; detail: string; status: string; state: BoardRowState }[] = [
    { time: '13:30', title: 'عميلة تجريبية ٤', detail: 'قص وسشوار · منى', status: tick % 2 ? 'جارية' : 'في الانتظار', state: tick % 2 ? 'active' : 'upcoming' },
    { time: '13:45', title: 'عميلة تجريبية ٧', detail: 'مانيكير · فاطمة', status: tick % 3 === 2 ? 'متأخرة' : 'في الانتظار', state: tick % 3 === 2 ? 'late' : 'upcoming' },
    { time: '14:00', title: 'عميلة تجريبية ٩', detail: 'صبغة · هالة', status: 'ملغاة', state: 'cancelled' },
    { time: '12:15', title: 'عميلة تجريبية ٢', detail: 'بروتين · إيمان', status: 'تمت', state: 'done' },
  ];

  return (
    <div className="space-y-3">
      <Board title="الوردية الآن" meta={<span className="tabular">مفتوحة منذ 09:12</span>}>
        <BoardFigures>
          <BoardFigure label="المتبقي في الدرج" value={`${drawer.toLocaleString('en-US')}.00`} hint="ج.م" href="#list" />
          <BoardFigure label="مبيعات اليوم" value={`${(7820 + tick * 240).toLocaleString('en-US')}.00`} hint="ج.م" href="#list" />
          <BoardFigure label="مدة الوردية" value={`4:${String(18 + (tick % 40)).padStart(2, '0')}`} href="#list" />
          <BoardFigure label="مواعيد متأخرة" value={String(tick % 3 === 2 ? 1 : 0)} tone={tick % 3 === 2 ? 'late' : 'live'} href="#list" />
        </BoardFigures>
        <BoardRows label="طابور اليوم" empty="لا توجد مواعيد اليوم" className="mt-3">
          {rows.map((row) => (
            <BoardRow
              key={row.time}
              {...row}
              {...(row.state === 'upcoming' || row.state === 'late' ? { actions: <Button variant="board" size="sm">بدء</Button> } : {})}
            />
          ))}
        </BoardRows>
      </Board>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setTick((value) => value + 1)}>محاكاة تغيير</Button>
        <Switch label="تغيير تلقائي كل 3.5 ثانية" checked={auto} onCheckedChange={setAuto} />
      </div>
    </div>
  );
}

function ListDemo() {
  const list = useListState({ search: '', status: '', cashier: '', from: '', to: '', page: 1, sort: 'createdAt:desc' }, { prefix: 'demo' });
  const [simulate, setSimulate] = useState<'none' | 'loading' | 'error'>('none');
  const pageSize = 10;
  const { values } = list;

  const filtered = useMemo(() => {
    const needle = normalizeArabic(values.search);
    const rows = sampleInvoices.filter((invoice) =>
      (!needle || normalizeArabic(`${invoice.number} ${invoice.client} ${invoice.phone}`).includes(needle))
      && (!values.status || invoice.status === values.status)
      && (!values.cashier || invoice.cashier === values.cashier));
    const sort = list.sort;
    if (!sort) return rows;
    const key = sort.key as keyof SampleInvoice;
    return [...rows].sort((a, b) => {
      const order = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      return sort.direction === 'asc' ? order : -order;
    });
  }, [values.search, values.status, values.cashier, list.sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(values.page, totalPages);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sum = (key: 'total' | 'remaining') => filtered.reduce((total, invoice) => total + invoice[key], 0);

  const columns: DataColumn<SampleInvoice>[] = [
    { key: 'number', header: 'الفاتورة', mobile: 'primary', sortKey: 'number', cell: (row) => <a href="#list" className="font-medium text-brand-strong hover:underline">{row.number}</a> },
    { key: 'client', header: 'العميل', mobile: 'secondary', cell: (row) => <span>{row.client} · <Phone value={row.phone} /></span> },
    { key: 'createdAt', header: 'التاريخ', sortKey: 'createdAt', cell: (row) => <DateTime value={row.createdAt} /> },
    { key: 'cashier', header: 'الكاشير', mobile: 'hidden', cell: (row) => row.cashier },
    { key: 'status', header: 'الحالة', mobile: 'status', cell: (row) => <StatusBadge status={row.status} map={invoiceStatus} /> },
    { key: 'remaining', header: 'المتبقي', numeric: true, cell: (row) => <Money value={row.remaining} /> },
    { key: 'total', header: 'الإجمالي', numeric: true, mobile: 'amount', sortKey: 'total', cell: (row) => <Money value={row.total} /> },
  ];

  const chips = [
    ...(values.status ? [{ key: 'status', label: `الحالة: ${invoiceStatus[values.status as InvoiceStatus].label}`, onRemove: () => list.set({ status: '' }) }] : []),
    ...(values.cashier ? [{ key: 'cashier', label: `الكاشير: ${values.cashier}`, onRemove: () => list.set({ cashier: '' }) }] : []),
  ];

  return (
    <div id="list" className="space-y-3">
      <PageHeader
        title="الفواتير"
        description="مثال تشريح صفحة القائمة: رأس الصفحة ← أرقام اللوحة ← شريط التصفية ← القائمة ← الإجماليات ← الصفحات."
        actions={<Button variant="secondary"><Printer className="size-4" aria-hidden />طباعة</Button>}
        primaryAction={<Button><Plus className="size-4" aria-hidden />بيع جديد</Button>}
      />
      <StatGrid label="ملخص الفواتير">
        <StatTile label="فواتير مطابقة" value={String(filtered.length)} href="#list" />
        <StatTile label="الإجمالي" value={sum('total').toLocaleString('en-US')} hint="ج.م" href="#list" />
        <StatTile label="المتبقي" value={sum('remaining').toLocaleString('en-US')} hint="ج.م" tone={sum('remaining') > 0 ? 'late' : 'live'} href="#list" />
        <StatTile label="ملغاة" value={String(filtered.filter((invoice) => invoice.status === 'voided').length)} tone="cancel" href="#list" />
      </StatGrid>
      <FilterBar
        label="تصفية الفواتير"
        activeCount={list.activeCount}
        onReset={list.reset}
        chips={chips}
        search={(
          <SearchInput
            label="بحث الفواتير"
            placeholder="بحث برقم الفاتورة أو اسم العميل أو الهاتف"
            value={values.search}
            onSearch={(search) => list.set({ search })}
          />
        )}
      >
        <FilterSelect
          label="الحالة"
          allLabel="كل الحالات"
          value={values.status}
          onChange={(status) => list.set({ status })}
          options={Object.entries(invoiceStatus).map(([value, entry]) => ({ value, label: entry.label }))}
        />
        <FilterSelect
          label="الكاشير"
          allLabel="كل الكاشيرات"
          value={values.cashier}
          onChange={(cashier) => list.set({ cashier })}
          options={[{ value: 'كاشير ١', label: 'كاشير ١' }, { value: 'كاشير ٢', label: 'كاشير ٢' }]}
        />
        <DateRangeFilter from={values.from} to={values.to} onChange={(range) => list.set(range)} />
      </FilterBar>
      <div className="flex flex-wrap gap-2 text-[12px] text-muted">
        محاكاة:
        {(['none', 'loading', 'error'] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={simulate === mode} onClick={() => setSimulate(mode)} className="underline aria-pressed:font-semibold aria-pressed:text-ink">
            {{ none: 'بيانات', loading: 'تحميل', error: 'خطأ' }[mode]}
          </button>
        ))}
      </div>
      <DataList
        label="الفواتير"
        rows={simulate === 'none' ? pageRows : []}
        columns={columns}
        getRowKey={(row) => String(row.id)}
        sort={list.sort}
        onSortChange={list.setSort}
        loading={simulate === 'loading'}
        error={simulate === 'error' ? { message: 'تعذر تحميل الفواتير.', onRetry: () => setSimulate('none') } : null}
        rowTone={(row) => (row.remaining > 0 ? 'late' : row.status === 'voided' ? 'muted' : undefined)}
        actions={(row) => (
          <RowActions
            label={`إجراءات الفاتورة ${row.number}`}
            actions={[
              { label: 'عرض', onSelect: () => { toast(`فتح ${row.number}`); } },
              { label: 'طباعة', onSelect: () => { toast.success('أُرسلت للطابعة'); } },
              { label: 'استرداد', onSelect: () => { toast('استرداد'); } },
              {
                label: 'إلغاء الفاتورة',
                tone: 'danger',
                onSelect: () => new Promise((resolve) => { setTimeout(resolve, 900); }).then(() => toast.success('أُلغيت الفاتورة')),
                confirm: { title: `إلغاء الفاتورة ${row.number}؟`, description: 'لا يمكن التراجع عن الإلغاء.', confirmLabel: 'تأكيد الإلغاء' },
              },
            ]}
          />
        )}
        empty={(
          <ListEmptyState
            isFiltered={list.isFiltered}
            onReset={list.reset}
            title="لا توجد فواتير بعد"
            description="ستظهر الفواتير هنا بعد أول بيع."
          />
        )}
      />
      {filtered.length > 0 && simulate === 'none' ? (
        <TotalsBar
          scope={`إجمالي ${filtered.length} فاتورة مطابقة`}
          items={[
            { label: 'الإجمالي', value: <Money value={sum('total')} /> },
            { label: 'المتبقي', value: <Money value={sum('remaining')} />, strong: true },
          ]}
        />
      ) : null}
      <Pagination page={page} totalPages={totalPages} total={filtered.length} unit="فاتورة" onPageChange={list.setPage} />
    </div>
  );
}

export function DesignPreview({ pairs }: { pairs: FontPair[] }) {
  const storedPairId = useSyncExternalStore(subscribeFontPair, readFontPair, () => null);
  const pairId = storedPairId ?? pairs[0]!.id;
  const pair = pairs.find((candidate) => candidate.id === pairId) ?? pairs[0]!;
  const fontStyle = {
    '--font-sans': `${pair.body}, system-ui, sans-serif`,
    '--font-display': `${pair.display}, ${pair.body}, system-ui, sans-serif`,
    '--display-stretch': pair.stretch,
    fontFamily: 'var(--font-sans)',
  } as CSSProperties;

  const [tab, setTab] = useState('open');
  const [modal, setModal] = useState<'none' | 'sheet' | 'confirm'>('none');
  const [saving, setSaving] = useState(false);
  const [employee, setEmployee] = useState('');
  const [month, setMonth] = useState('2026-10');
  const [checked, setChecked] = useState(true);

  return (
    <div style={fontStyle} className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-3">
        <p className="text-[13px] text-muted">صفحة للمطوّرين فقط · لا تظهر في النسخة المنشورة</p>
        <h1 className="text-3xl font-bold text-ink">نظام تصميم كابيلا — لوحة المغادرة</h1>
        <fieldset className="rounded-card border border-brand/30 bg-brand-soft p-3">
          <legend className="px-1 text-sm font-semibold text-brand-strong">اختر زوج الخطوط</legend>
          <div className="grid gap-1.5">
            {pairs.map((candidate) => (
              <label key={candidate.id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="font-pair"
                  className="accent-brand-strong"
                  checked={candidate.id === pair.id}
                  onChange={() => writeFontPair(candidate.id)}
                />
                {candidate.name}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-sm">
          <Link href="/_design/shell" className="font-medium text-brand-strong underline">معاينة إطار التطبيق (القائمة الجانبية، الشريط العلوي، أزرار الهاتف السفلية)</Link>
        </p>
      </header>

      <Block title="اللوحة الحية" note="تتقلب الخانات التي تغيّرت فقط؛ وتتغير فورًا دون حركة إذا أوقف المستخدم الحركة في جهازه.">
        <BoardDemo />
      </Block>

      <Block title="تشريح صفحة القائمة" note="البحث يُطبّق بعد نصف ثانية من آخر حرف، والتصفية محفوظة في الرابط (جرّب الرجوع أو نسخ الرابط).">
        <ListDemo />
      </Block>

      <Block title="الألوان" note="كل زوج نص/خلفية مستخدم للنص يحقق تباين AA (4.5:1) على الأقل.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Swatch name="إسبريسو — نص قوي" token="ink" />
          <Swatch name="عاجي — أرضية الصفحة" token="surface" text="ink" ratio="13.7:1" />
          <Swatch name="ورق — اللوحات" token="paper" text="muted" ratio="5.8:1" />
          <Swatch name="خط فاصل" token="line" />
          <Swatch name="ذهبي وردي — أزرار" token="brand-strong" text="paper" ratio="5.8:1" />
          <Swatch name="ذهبي وردي — لمسات" token="brand" />
          <Swatch name="خلفية التحديد" token="brand-soft" text="brand-strong" ratio="4.7:1" />
          <Swatch name="شامبانيا" token="champagne" text="ink" ratio="10.6:1" />
          <Swatch name="خانة اللوحة" token="flap" text="board-ink" ratio="11.9:1" />
          <Swatch name="متأخر (كهرماني)" token="flap" text="board-late" ratio="7.7:1" />
          <Swatch name="ملغى (طوبي)" token="flap" text="board-cancel" ratio="5.9:1" />
          <Swatch name="تم" token="flap" text="board-done" ratio="7:1" />
          <Swatch name="نجاح" token="success-soft" text="success" ratio="5.6:1" />
          <Swatch name="تنبيه" token="warning-soft" text="warning" ratio="5:1" />
          <Swatch name="خطر" token="danger-soft" text="danger" ratio="5.7:1" />
          <Swatch name="معلومة" token="info-soft" text="info" ratio="5.3:1" />
        </div>
      </Block>

      <Block title="الخطوط والأحجام">
        <Card>
          <CardContent className="space-y-2">
            <p className="type-display text-4xl font-bold">١٢:٣٠ · 4,250.00 ج.م</p>
            <h1 className="text-[1.75rem] font-bold">عنوان الصفحة — ورديات الكاشير</h1>
            <h2 className="text-base font-semibold">عنوان القسم — سجل الورديات</h2>
            <p className="max-w-prose text-sm">نص عادي: يبيع الكاشير الخدمات والمنتجات، ويدير دفتر المواعيد والعملاء والمرتجعات في فرعه طوال اليوم.</p>
            <p className="text-[13px] text-muted">نص ثانوي: آخر تحديث منذ دقيقتين.</p>
            <p className="tabular text-sm">أرقام جدولية: 1,111.11 / 9,999.99 / 0100 123 4567</p>
          </CardContent>
        </Card>
      </Block>

      <Block title="الأزرار">
        <div className="flex flex-wrap items-center gap-2">
          <Button>أساسي</Button>
          <Button variant="secondary">ثانوي</Button>
          <Button variant="ghost">خفيف</Button>
          <Button variant="danger">حذف</Button>
          <Button loading>جارٍ الحفظ</Button>
          <Button disabled>معطّل</Button>
          <Button size="sm">صغير</Button>
          <Button size="lg">كبير</Button>
          <IconButton label="طباعة"><Printer className="size-4" aria-hidden /></IconButton>
        </div>
        <div className="flex flex-wrap gap-2 rounded-card bg-board p-3">
          <Button variant="board">على اللوحة</Button>
          <Button variant="board" size="sm">بدء</Button>
        </div>
      </Block>

      <Block title="حقول الإدخال" note="40 بكسل بالفأرة، و44 بكسل على شاشات اللمس.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم العميل" htmlFor="d-name" required hint="الاسم كما يظهر على الفاتورة">
            <Input id="d-name" placeholder="مثال: منى أحمد" aria-describedby="d-name-hint" />
          </Field>
          <Field label="الهاتف" htmlFor="d-phone" error="رقم الهاتف غير صحيح">
            <Input id="d-phone" dir="ltr" defaultValue="0100" aria-invalid />
          </Field>
          <Field label="طريقة الدفع" htmlFor="d-method">
            <Select id="d-method"><option>نقدًا</option><option>فيزا</option><option>إنستاباي</option><option>فودافون كاش</option></Select>
          </Field>
          <Combobox label="الموظف" options={sampleEmployees} value={employee} onChange={setEmployee} allLabel="كل الموظفين" />
          <Field label="ملاحظات" htmlFor="d-notes" className="sm:col-span-2">
            <Textarea id="d-notes" placeholder="اختياري" />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Checkbox label="إرسال الإيصال" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <Switch label="طباعة تلقائية" checked={checked} onCheckedChange={setChecked} />
          </div>
          <MonthFilter value={month} onChange={setMonth} />
        </div>
      </Block>

      <Block title="الحالات والشارات">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(invoiceStatus) as InvoiceStatus[]).map((status) => <StatusBadge key={status} status={status} map={invoiceStatus} />)}
          <Badge variant="brand">مختار</Badge>
          <Badge variant="info">معلومة</Badge>
          <Badge variant="warning" dot={false}>معتمد — مقفل</Badge>
        </div>
      </Block>

      <Block title="التبويبات" note="الأسهم تتبع اتجاه القراءة: السهم الأيسر للتالي.">
        <Tabs
          idBase="demo-tabs"
          label="حالة الخدمة"
          value={tab}
          onValueChange={setTab}
          items={[{ value: 'open', label: 'الجارية', count: 4 }, { value: 'done', label: 'المنتهية', count: 12 }, { value: 'all', label: 'الكل' }]}
        />
        <TabPanel idBase="demo-tabs" value={tab} className="pt-3 text-sm text-muted">محتوى تبويب «{tab}»</TabPanel>
      </Block>

      <Block title="التنبيهات والرسائل" note="النجاح رسالة منبثقة فقط. أخطاء النموذج داخل النموذج. الشريط الثابت فقط لما يمنع استخدام الصفحة.">
        <div className="space-y-2">
          <Notice tone="warning" action={<Button size="sm" variant="secondary">فتح الوردية</Button>}>لا توجد وردية مفتوحة. افتح الوردية لتبدأ البيع.</Notice>
          <Notice tone="danger" role="alert">تعذر تحميل قائمة الفروع.</Notice>
          <Notice tone="info">هذا الشهر معتمد — لا يمكن تعديل المكافآت.</Notice>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => toast.success('تم حفظ الفاتورة')}>رسالة نجاح</Button>
            <Button variant="secondary" size="sm" onClick={() => toast.error('تعذر إرسال الإيصال')}>رسالة خطأ</Button>
          </div>
        </div>
      </Block>

      <Block title="النوافذ" note="على الهاتف تصبح النافذة لوحة سفلية بأزرار ثابتة. لا يمكن إغلاقها أثناء الحفظ.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setModal('sheet')}>نافذة نموذج</Button>
          <Button variant="danger" onClick={() => setModal('confirm')}>تأكيد إجراء خطير</Button>
        </div>
        {modal === 'sheet' ? (
          <Modal
            title="تسجيل دفعة"
            dismissOnBackdrop={!saving}
            onClose={() => setModal('none')}
            footer={(
              <>
                <Button
                  className="flex-1 sm:flex-none"
                  loading={saving}
                  onClick={() => {
                    setSaving(true);
                    setTimeout(() => { setSaving(false); setModal('none'); toast.success('سُجلت الدفعة'); }, 1200);
                  }}
                >
                  حفظ الدفعة
                </Button>
                <Button variant="secondary" className="flex-1 sm:flex-none" disabled={saving} onClick={() => setModal('none')}>إلغاء</Button>
              </>
            )}
          >
            <Field label="المبلغ" htmlFor="d-amount"><Input id="d-amount" inputMode="decimal" dir="ltr" defaultValue="150.00" /></Field>
            <Field label="طريقة الدفع" htmlFor="d-pay"><Select id="d-pay"><option>نقدًا</option><option>فيزا</option></Select></Field>
          </Modal>
        ) : null}
        {modal === 'confirm' ? (
          <ConfirmDialog
            title="حذف المصروف؟"
            description="سيُسجّل قيد عكسي بنفس المبلغ."
            confirmLabel="تأكيد الحذف"
            tone="danger"
            onConfirm={() => { setModal('none'); toast.success('حُذف المصروف'); }}
            onCancel={() => setModal('none')}
          />
        ) : null}
      </Block>

      <Block title="التنسيق" note="لا تظهر تواريخ خام أبدًا؛ كل الأوقات بتوقيت القاهرة.">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-[12px] text-muted">مبلغ</dt><dd><Money value="1234.5" /></dd></div>
          <div><dt className="text-[12px] text-muted">تاريخ ووقت</dt><dd><DateTime value="2026-10-14T10:30:00Z" /></dd></div>
          <div><dt className="text-[12px] text-muted">تاريخ فقط</dt><dd><DateOnly value="2026-10-01" /></dd></div>
          <div><dt className="text-[12px] text-muted">مدة</dt><dd><Duration minutes={510} /></dd></div>
          <div><dt className="text-[12px] text-muted">هاتف داخل نص عربي</dt><dd>اتصل على <Phone value="0100 123 4567" /> للحجز</dd></div>
        </dl>
      </Block>

      <Block title="التحميل والقوائم الفارغة">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card><LoadingState label="جارٍ تحميل الورديات" /><div className="space-y-2 p-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-10" /></div></Card>
          <Card><ListEmptyState isFiltered onReset={() => toast('إعادة ضبط')} title="لا توجد ورديات" /></Card>
        </div>
      </Block>
    </div>
  );
}
