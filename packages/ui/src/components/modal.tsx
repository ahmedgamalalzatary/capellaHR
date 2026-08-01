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

const focusableSelector = 'button, [href], input, select, textarea, [tabindex]';
const isTabbable = (element: HTMLElement) => (
  element.tabIndex >= 0
  && !element.hasAttribute('disabled')
  && !element.matches('input[type="hidden"]')
);

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
    const target = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    ).find(isTabbable);
    (target ?? dialogRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const focusableElements = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      focusableSelector,
    ) ?? []).filter(isTabbable);

    const containKeyboardFocus = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Tab') {
        const focusable = focusableElements();
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const active = document.activeElement;
        if (!dialog.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || active === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (dismissOnBackdrop) onClose();
      }
    };

    document.addEventListener('keydown', containKeyboardFocus);
    return () => document.removeEventListener('keydown', containKeyboardFocus);
  }, [dismissOnBackdrop, onClose]);

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
      >
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </div>
  );
}
