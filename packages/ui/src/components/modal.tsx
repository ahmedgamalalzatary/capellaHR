'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';

export interface ModalProps {
  /** Announced as the dialog's accessible name and rendered as its heading. */
  title: string;
  children: ReactNode;
  /** Invoked on Escape and on a backdrop click; the caller decides what closing means. */
  onClose: () => void;
  /** Set false for a decision the user must answer explicitly: disables Escape and backdrop alike. */
  dismissOnBackdrop?: boolean;
  /** Actions row. Stays pinned to the bottom of the sheet while the body scrolls. */
  footer?: ReactNode;
  /** Width on wider screens; on phones every dialog is a full-width bottom sheet. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClassName = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

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
  footer,
  size = 'md',
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Escape reads the props of the last commit, not of the last effect run: a form that
  // just started saving must refuse Escape at once, before passive effects catch up.
  const closeProps = useRef({ onClose, dismissOnBackdrop });
  useLayoutEffect(() => {
    closeProps.current = { onClose, dismissOnBackdrop };
  });

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
        if (event.defaultPrevented) return;
        event.stopPropagation();
        if (closeProps.current.dismissOnBackdrop) closeProps.current.onClose();
      }
    };

    document.addEventListener('keydown', containKeyboardFocus);
    return () => document.removeEventListener('keydown', containKeyboardFocus);
  }, []);

  const overlay = (
    <div
      className={cn(
        'fixed inset-0 z-(--z-modal) m-0 flex animate-fade-in items-end justify-center bg-ink/45',
        'sm:items-center sm:p-4',
      )}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          // Phones: a bottom sheet, full width, thumb-reachable actions. Wider: a centred dialog.
          'flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-card border border-line bg-paper shadow-panel outline-none',
          'sm:max-h-[90dvh] sm:animate-fade-in sm:rounded-card',
          sizeClassName[size],
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <div className="mt-3 space-y-3">{children}</div>
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-paper px-4 pt-3 pb-safe sm:px-5 sm:pb-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );

  // Parent stacks like `space-y-4` apply 16px sibling margin even to `fixed`
  // overlays; portaling onto `document.body` keeps the backdrop flush with the viewport.
  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
