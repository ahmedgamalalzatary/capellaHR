import { ApiError } from '@/lib/api/client';

/** Server messages are already Arabic; anything else gets the shared fallback. */
export const serverErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  return error instanceof ApiError ? error.message : 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};

export const CATEGORY_TYPE_LABELS = { service: 'خدمات' } as const;
