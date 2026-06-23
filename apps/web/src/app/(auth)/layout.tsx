import type { ReactNode } from "react";

/** Minimal centered layout for the sign-in screens (no app shell). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
