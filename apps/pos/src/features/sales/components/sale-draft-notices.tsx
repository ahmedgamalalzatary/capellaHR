'use client';

import { Button } from '@capella/ui';

import { DraftNotice } from '@/components/feedback/draft-notice';
import { Notice } from '@/components/feedback/notice';

import { errorMessage } from './sale-primitives';

/** The banner stack that reports draft restore, booking prefill and sync state. */
export function SaleDraftNotices({
  offeredDraft,
  restoreOfferedDraft,
  discardOfferedDraft,
  draftRestored,
  bookingPrefillError,
  bookingIsError,
  bookingError,
  bookingEmployeesIsError,
  refetchBookingEmployees,
  activeBookingId,
  conflictRestored,
  backgroundSyncCount,
  draftStorageError,
}: {
  offeredDraft: unknown;
  restoreOfferedDraft: () => void;
  discardOfferedDraft: () => void;
  draftRestored: boolean;
  bookingPrefillError: string | undefined;
  bookingIsError: boolean;
  bookingError: unknown;
  bookingEmployeesIsError: boolean;
  refetchBookingEmployees: () => void;
  activeBookingId: number | undefined;
  conflictRestored: boolean;
  backgroundSyncCount: number;
  draftStorageError: boolean;
}) {
  return (
    <>
      {offeredDraft ? (
        <DraftNotice
          label="لديك مسودة بيع غير مكتملة لهذه الوردية."
          onRestore={restoreOfferedDraft}
          onDiscard={discardOfferedDraft}
        />
      ) : null}

      {draftRestored ? (
        <Notice tone="success">تم استعادة مسودة البيع المحفوظة لهذا الحساب والوردية.</Notice>
      ) : null}

      {bookingPrefillError || bookingIsError ? (
        <Notice tone="danger" role="alert">
          {bookingPrefillError ?? errorMessage(bookingError)}
          {bookingEmployeesIsError ? <Button variant="secondary" size="sm" onClick={refetchBookingEmployees}>إعادة المحاولة</Button> : null}
        </Notice>
      ) : activeBookingId !== undefined ? (
        <Notice tone="success">تم تحميل الحجز في البيع. أكمل اختيار الكاشير والموظفين ثم احفظ الفاتورة.</Notice>
      ) : null}

      {conflictRestored ? (
        <Notice tone="warning">
          تم استعادة البيع للمراجعة. راجع العميل والأسعار والحضور والمخزون قبل الإرسال.
        </Notice>
      ) : null}

      {backgroundSyncCount > 0 ? (
        <Notice tone="success">
          {backgroundSyncCount === 1
            ? 'تمت مزامنة بيع معلق بنجاح.'
            : `تمت مزامنة ${backgroundSyncCount} مبيعات معلقة بنجاح.`}
        </Notice>
      ) : null}

      {draftStorageError ? (
        <Notice tone="danger" role="alert">
          تعذر حفظ مسودة البيع في المتصفح. لا تغادر الصفحة قبل إتمام البيع.
        </Notice>
      ) : null}
    </>
  );
}
