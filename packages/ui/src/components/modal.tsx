'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface ModalProps {
  /** Announced as the dialog's accessible name and rendered as its heading. */
  title: string;
  children: ReactNode;
  /** Invoked on Escape and on a backdrop click; the caller decides what closing means. */
  onClose: () => void;
  /** Set false for a decision the user must answer explicitly: disables Escape and backdrop alike. */
  dismissOnBackdrop?: boolean;
  className?: string;
}

/**
 * An in-app replacement for the browser's blocking dialogs: `window.confirm` cannot be styled,
 * localized, or made to carry the amounts and warnings these decisions need.
 */
export function Modal({
  title,
  children,
  onClose,
  dismissOnBackdrop = true,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus moves in so the keyboard lands on the decision, and returns to whatever opened the
    // dialog once it closes, which is where the user was looking.
    const previous = document.activeElement as HTMLElement | null;
    const target = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (target ?? dialogRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md rounded-card border border-line bg-paper p-4 shadow-lg outline-none',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Swallowed either way so Escape never reaches whatever is behind the dialog, but
            // it only closes when dismissal is allowed at all.
            event.stopPropagation();
            if (dismissOnBackdrop) onClose();
          }
        }}
      >
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>
  );
}
