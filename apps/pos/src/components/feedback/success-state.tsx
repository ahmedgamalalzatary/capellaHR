export function SuccessState({ message }: { message: string }) {
  return (
    <p role="status" aria-label={message} aria-live="polite" className="rounded-control bg-success/10 px-3 py-2 text-sm text-success">
      {message}
    </p>
  );
}
