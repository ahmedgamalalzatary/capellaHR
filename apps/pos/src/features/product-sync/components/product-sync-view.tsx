'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Modal } from '@capella/ui';

import { LoadingState } from '@/components/feedback/loading-state';
import { Select } from '@/components/form/select';
import { SectionHeading } from '@/components/layout/page-header';
import { listCatalogBranches } from '@/features/catalog';
import { fetchAllPages } from '@/lib/api/fetch-all';
import { notifyError, notifySuccess } from '@/lib/notify';

import {
  activateBranchLink,
  createBranchLink,
  deleteBranchLink,
  getSyncSetup,
  listBranchLinks,
  listExcludedProducts,
  settleSyncRow,
  type BranchLink,
  type SettleSyncInput,
  type SyncCandidate,
  type SyncSetupRow,
} from '../api/product-sync-api';

const rowHint: Record<SyncSetupRow['kind'], string> = {
  auto: 'مطابقة تلقائية',
  linked: 'مربوط',
  excluded: 'لن يُنسخ',
  ambiguous: 'يطابق أكثر من منتج — اختر الصحيح',
  barcode_mismatch: 'الاسم متطابق والباركود مختلف — قرّر',
  only_in_sender: 'موجود في الفرع المرسل فقط — انسخه أو استبعده',
  receiver_taken: 'المنتج المقابل مرتبط بمنتج آخر — اختر بديلًا',
};

function SetupRow({
  row, products, disabled, onSettle,
}: {
  row: SyncSetupRow;
  products: SyncCandidate[];
  disabled: boolean;
  onSettle(input: SettleSyncInput): void;
}) {
  const initial = row.receiverProductId ?? row.candidates[0]?.id;
  const [receiverId, setReceiverId] = useState(initial === undefined ? '' : String(initial));
  const [newName, setNewName] = useState(row.name);
  const selected = receiverId === '' ? undefined : Number(receiverId);

  return (
    <div className={`space-y-2 rounded-control border p-3 ${row.state === 'green' ? 'border-line' : 'border-warning/40 bg-warning-soft/40'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{row.name}</span>
        <Badge variant={row.state === 'green' ? 'success' : 'warning'}>
          {row.state === 'green' ? 'جاهز' : 'يحتاج قرارًا'}
        </Badge>
      </div>
      <p className="text-[13px] text-muted">{rowHint[row.kind]}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`row-product-${row.senderProductId}`}>المنتج في الفرع المستلم</Label>
          <Select
            id={`row-product-${row.senderProductId}`}
            aria-label={`المنتج المقابل لـ ${row.name}`}
            disabled={disabled}
            value={receiverId}
            onChange={(event) => setReceiverId(event.target.value)}
          >
            <option value="">— بدون —</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`row-name-${row.senderProductId}`}>اسم النسخة الجديدة</Label>
          <Input
            id={`row-name-${row.senderProductId}`}
            aria-label={`اسم نسخة ${row.name}`}
            disabled={disabled}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || selected === undefined || selected === row.receiverProductId}
          onClick={() => { if (selected !== undefined) onSettle({ action: 'link', receiverProductId: selected }); }}>
          ربط بالمنتج
        </Button>
        <Button size="sm" variant="secondary" disabled={disabled || !newName.trim()}
          onClick={() => onSettle({ action: 'create', name: newName.trim() })}>
          نسخ باسم جديد
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled}
          onClick={() => onSettle({ action: 'exclude', notSameAsProductId: selected ?? null })}>
          عدم النسخ
        </Button>
      </div>
    </div>
  );
}

function SetupDialog({ link, onClose }: { link: BranchLink; onClose(): void }) {
  const queryClient = useQueryClient();
  const setup = useQuery({ queryKey: ['sync-setup', link.id], queryFn: () => getSyncSetup(link.id) });
  const excluded = useQuery({ queryKey: ['sync-excluded', link.id], queryFn: () => listExcludedProducts(link.id) });

  const settle = useMutation({
    mutationFn: ({ productId, input }: { productId: number; input: SettleSyncInput }) => settleSyncRow(link.id, productId, input),
    onSuccess: async (data) => {
      queryClient.setQueryData(['sync-setup', link.id], data);
      await queryClient.invalidateQueries({ queryKey: ['sync-excluded', link.id] });
    },
    onError: (error: unknown) => notifyError(error),
  });
  const activate = useMutation({
    mutationFn: () => activateBranchLink(link.id),
    onSuccess: async (data) => {
      queryClient.setQueryData(['sync-setup', link.id], data);
      notifySuccess('تم تفعيل الرابط. المنتجات المطابقة صارت مرتبطة، والنسخ تنتظر أول مخزون.');
      await queryClient.invalidateQueries({ queryKey: ['branch-links'] });
    },
    onError: (error: unknown) => notifyError(error),
  });
  const pending = settle.isPending || activate.isPending;
  const conflicts = setup.data?.rows.filter((row) => row.state === 'conflict').length ?? 0;

  return (
    <Modal
      title={`إعداد ${link.senderBranchName} ← ${link.receiverBranchName}`}
      className="max-h-[90dvh] max-w-3xl overflow-y-auto"
      onClose={() => { if (!pending) onClose(); }}
    >
      {setup.isPending ? <LoadingState label="جارٍ حساب المطابقات…" className="py-10" />
        : setup.isError ? <EmptyState title="تعذر فتح الإعداد" action={<Button onClick={() => void setup.refetch()}>إعادة المحاولة</Button>} />
          : (
            <div className="space-y-4">
              <p className="text-[13px] text-muted">
                كل صف يحتاج قرارًا. المنتجات المطابقة تُربط، والباقي تختار له: الربط بمنتج موجود، نسخ باسم جديد، أو عدم النسخ.
                لا يتم تفعيل المزامنة قبل أن تصبح كل الصفوف جاهزة.
              </p>

              <div className="space-y-2">
                {setup.data.rows.length === 0 ? <p className="text-sm text-muted">لا توجد منتجات في الفرع المرسل بعد.</p> : null}
                {setup.data.rows.map((row) => (
                  <SetupRow
                    key={row.senderProductId}
                    row={row}
                    products={setup.data.receiverProducts}
                    disabled={pending}
                    onSettle={(input) => settle.mutate({ productId: row.senderProductId, input })}
                  />
                ))}
              </div>

              {excluded.data?.length ? (
                <div className="space-y-2 border-t border-line/70 pt-3">
                  <p className="text-sm font-medium">مستبعدة من المزامنة</p>
                  {excluded.data.map((row) => (
                    <p key={row.senderProductId} className="text-[13px] text-muted">
                      {row.name}{row.notSameAs ? ` — ليس نفس «${row.notSameAs.name}»` : ''}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-4">
                <Button disabled={pending || !setup.data.allGreen} onClick={() => activate.mutate()}>
                  {link.state === 'active' ? 'مفعّل' : 'تفعيل الرابط'}
                </Button>
                <Button variant="ghost" disabled={pending} onClick={onClose}>إغلاق</Button>
                <span className="text-[13px] text-muted">
                  {conflicts === 0 ? 'كل الصفوف جاهزة' : `بقي ${conflicts} صفًا يحتاج قرارًا`}
                </span>
              </div>
            </div>
          )}
    </Modal>
  );
}

export function ProductSyncView() {
  const queryClient = useQueryClient();
  const [senderId, setSenderId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [setupLink, setSetupLink] = useState<BranchLink | null>(null);
  const [deleting, setDeleting] = useState<BranchLink | null>(null);

  const links = useQuery({ queryKey: ['branch-links'], queryFn: listBranchLinks });
  const branches = useQuery({
    queryKey: ['product-branches'],
    queryFn: () => fetchAllPages((page) => listCatalogBranches(page)),
  });

  const senderIds = new Set((links.data ?? []).map((link) => link.senderBranchId));
  const receiverIds = new Set((links.data ?? []).map((link) => link.receiverBranchId));
  const options = branches.data ?? [];
  // A branch is a sender, a receiver, or neither — so these two lists are
  // everything the server would accept, before it has to explain why not.
  const senderOptions = options.filter((branch) => !receiverIds.has(branch.id));
  const receiverOptions = options.filter((branch) => (
    String(branch.id) !== senderId && !senderIds.has(branch.id) && !receiverIds.has(branch.id)
  ));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['branch-links'] });
  const create = useMutation({
    mutationFn: () => createBranchLink({ senderBranchId: Number(senderId), receiverBranchId: Number(receiverId) }),
    onSuccess: async () => {
      setSenderId(''); setReceiverId('');
      notifySuccess('تم إنشاء الرابط. أكمل الإعداد ثم فعّله.');
      await refresh();
    },
    onError: (error: unknown) => notifyError(error),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteBranchLink(id),
    onSuccess: async () => {
      setDeleting(null);
      notifySuccess('تم إلغاء رابط الفرعين. روابط المنتجات تبقى لصالح التحويلات.');
      await refresh();
    },
    onError: (error: unknown) => notifyError(error),
  });

  return (
    <Card className="overflow-hidden shadow-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-1">
          <SectionHeading title="مزامنة المنتجات بين الفروع" />
          <p className="text-[13px] text-muted">
            فرع مرسل واحد يغذي فرعًا مستلمًا. تُنسخ المنتجات مرة واحدة بحالة «بانتظار أول مخزون»، ولا يتغير شيء في
            الفرع المستلم بعد ذلك.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sync-sender">الفرع المرسل</Label>
            <Select id="sync-sender" aria-label="الفرع المرسل" value={senderId}
              onChange={(event) => { setSenderId(event.target.value); setReceiverId(''); }}>
              <option value="">اختر الفرع</option>
              {senderOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sync-receiver">الفرع المستلم</Label>
            <Select id="sync-receiver" aria-label="الفرع المستلم" value={receiverId}
              onChange={(event) => setReceiverId(event.target.value)}>
              <option value="">اختر الفرع</option>
              {receiverOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
          <div className="flex items-end">
            <Button disabled={!senderId || !receiverId || create.isPending} onClick={() => create.mutate()}>
              إنشاء رابط
            </Button>
          </div>
        </div>

        {links.isPending ? <LoadingState label="جارٍ تحميل الروابط…" />
          : links.isError ? <EmptyState title="تعذر تحميل روابط المزامنة" action={<Button onClick={() => void links.refetch()}>إعادة المحاولة</Button>} />
            : !links.data.length ? <p className="text-sm text-muted">لا توجد روابط بين الفروع بعد.</p>
              : (
                <div className="space-y-2">
                  {links.data.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line p-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.senderBranchName} ← {row.receiverBranchName}</span>
                        <Badge variant={row.state === 'active' ? 'success' : 'warning'}>
                          {row.state === 'active' ? 'مفعّل' : 'بانتظار الإعداد'}
                        </Badge>
                      </span>
                      <span className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setSetupLink(row)}>إعداد</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>إلغاء الربط</Button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

        {setupLink ? <SetupDialog link={setupLink} onClose={() => setSetupLink(null)} /> : null}

        {deleting ? <ConfirmDialog
          title="إلغاء رابط الفرعين"
          description={`سيتوقف نسخ منتجات ${deleting.senderBranchName} إلى ${deleting.receiverBranchName}. روابط المنتجات تبقى، فتظل التحويلات تصل إلى المنتج الصحيح.`}
          confirmLabel="إلغاء الربط"
          tone="danger"
          pending={remove.isPending}
          onConfirm={() => { if (!remove.isPending) remove.mutate(deleting.id); }}
          onCancel={() => { if (!remove.isPending) setDeleting(null); }}
        /> : null}
      </CardContent>
    </Card>
  );
}
