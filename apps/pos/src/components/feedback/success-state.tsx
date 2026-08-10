import { CircleCheck } from 'lucide-react';

export function SuccessState({ message }: { message: string }) {
  return (
    <p
      role="status"
      aria-label={message}
      aria-live="polite"
      className="flex items-center gap-2 rounded-control border border-success/20 bg-success-soft px-3 py-2 text-sm text-success"
    >
      <CircleCheck className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}
