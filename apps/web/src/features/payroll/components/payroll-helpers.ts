import { ApiError } from '@/lib/api/client';

export const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (error instanceof ApiError) {
    return error.fieldErrors.amount?.[0] ?? error.message;
  }
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

/** Current Cairo business month as YYYY-MM. */
export const currentCairoMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}`;
};
