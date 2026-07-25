'use client';

import type { ReactNode } from 'react';

import { Button } from './button';
import { Modal } from './modal';

export interface ConfirmDialogProps {
  title: string;
  /** Optional detail: what the action does, or what it cannot undo. */
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for destructive or irreversible actions. */
  tone?: 'default' | 'danger';
  /** Disables both actions while the confirmed action is running. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The standard two-choice confirmation, replacing `window.confirm` across the app. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'إلغاء',
  tone = 'default',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    // While the confirmed action runs, cancelling is disabled everywhere else, so an outside
    // click must not be a back door into the same cancel.
    <Modal title={title} dismissOnBackdrop={!pending} onClose={onCancel}>
      {description ? <p className="text-[13px] text-muted">{description}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tone === 'danger' ? 'danger' : 'primary'}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </Modal>
  );
}
