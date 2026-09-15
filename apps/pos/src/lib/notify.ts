import { toast } from 'sonner';

const FALLBACK_ERROR = 'تعذر تنفيذ العملية.';

export function notifySuccess(message: string): void {
  toast.success(message);
}

export function notifyError(error: unknown, fallback: string = FALLBACK_ERROR): void {
  toast.error(error instanceof Error ? error.message : fallback);
}
