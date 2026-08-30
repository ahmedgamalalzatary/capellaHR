'use client';

import { Button } from '@capella/ui';

import { Notice } from '@/components/feedback/notice';

import { type OfflineSaleQueueItem } from '../offline-sale-queue';

import { type PendingSale } from './sale-primitives';

/** The banner stack that reports offline queue, ambiguity and recovery state. */
export function SaleQueueNotices({
  draftHydrated,
  displayedQueueItem,
  online,
  hasDraftProgress,
  idempotencyKey,
  restoreConflict,
  onRequestDiscard,
  ambiguous,
  retryDisabled,
  onRetryPending,
  pendingSale,
  pendingMatchesActiveDraft,
  hasUnrecoverable,
}: {
  draftHydrated: boolean;
  displayedQueueItem: OfflineSaleQueueItem | null | undefined;
  online: boolean;
  hasDraftProgress: boolean;
  idempotencyKey: string;
  restoreConflict: (item: OfflineSaleQueueItem) => void;
  onRequestDiscard: (item: OfflineSaleQueueItem) => void;
  ambiguous: boolean;
  retryDisabled: boolean;
  onRetryPending: () => void;
  pendingSale: PendingSale | null;
  pendingMatchesActiveDraft: boolean;
  hasUnrecoverable: boolean;
}) {
  return (
    <>
      {draftHydrated && displayedQueueItem ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {displayedQueueItem.state === 'pending'
                  ? (online ? 'بانتظار المزامنة' : 'بانتظار الاتصال')
                  : displayedQueueItem.state === 'syncing'
                    ? 'جارٍ مزامنة البيع'
                    : displayedQueueItem.state === 'conflict'
                      ? 'يحتاج البيع إلى مراجعة'
                      : 'تعذرت مزامنة البيع'}
              </p>
              {displayedQueueItem.failure ? <p role="alert" className="mt-1 text-danger">{displayedQueueItem.failure.message}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {displayedQueueItem.state === 'conflict'
                && displayedQueueItem.recoveryDraft
                && (!hasDraftProgress
                  || displayedQueueItem.input.idempotencyKey === idempotencyKey) ? (
                <Button variant="secondary" size="sm" onClick={() => restoreConflict(displayedQueueItem)}>
                  مراجعة وتعديل البيع
                </Button>
              ) : null}
              {(displayedQueueItem.state === 'conflict' || displayedQueueItem.state === 'failed') ? (
                <Button variant="ghost" size="sm" onClick={() => onRequestDiscard(displayedQueueItem)}>
                  حذف البيع المعلق
                </Button>
              ) : null}
            </div>
          </div>
        </Notice>
      ) : null}

      {ambiguous ? (
        <Notice tone="warning">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">تعذر تأكيد نتيجة البيع</p>
              <p className="mt-0.5 text-muted">سيُعاد استخدام نفس مفتاح العملية، ولن تُنشأ فاتورة مكررة.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={retryDisabled}
              onClick={onRetryPending}
            >
              إعادة المحاولة بنفس الطلب
            </Button>
          </div>
        </Notice>
      ) : null}

      {pendingSale && !pendingMatchesActiveDraft ? (
        <Notice tone="warning">
          <p className="text-sm font-medium">يوجد بيع معلق محفوظ لحساب أو وردية أخرى</p>
          <p className="mt-0.5 text-muted">لن يُعاد إرساله أو حذفه من مساحة العمل الحالية. افتح الحساب والوردية الأصليين لاستعادته بأمان.</p>
        </Notice>
      ) : null}

      {hasUnrecoverable ? (
        <Notice tone="warning">
          <p className="text-sm font-medium">يوجد بيع محفوظ من إصدار أقدم يحتاج مراجعة يدوية</p>
          <p className="mt-0.5 text-muted">
            تعذر استعادة سعر الخدمة بأمان، لذلك احتفظ النظام بالطلب ولم يرسله أو يحذفه.
          </p>
        </Notice>
      ) : null}
    </>
  );
}
