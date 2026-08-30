'use client';

import { Button, Modal } from '@capella/ui';

export function DiscardPendingSaleModal({
  discardError,
  onClose,
  onBack,
  onConfirm,
}: {
  discardError: boolean;
  onClose: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="تأكيد حذف البيع المعلق" onClose={onClose}>
      <p className="text-sm">سيُحذف الطلب المحفوظ من هذا المتصفح ولن تتم مزامنته لاحقًا.</p>
      {discardError ? (
        <p role="alert" className="text-[13px] text-danger">
          تعذر حذف البيع المعلق من المتصفح. سيبقى محفوظًا ولن نخفيه حتى ينجح الحذف.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onBack}>رجوع</Button>
        <Button variant="danger" onClick={onConfirm}>حذف نهائي</Button>
      </div>
    </Modal>
  );
}
