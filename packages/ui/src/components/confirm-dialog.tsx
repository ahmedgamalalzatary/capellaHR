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
    <Modal
      title={title}
      size="sm"
      dismissOnBackdrop={!pending}
      onClose={onCancel}
      footer={(
        <>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={pending}
            className="flex-1 sm:flex-none"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" disabled={pending} className="flex-1 sm:flex-none" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </>
      )}
    >
      {description ? <div className="text-sm text-muted">{description}</div> : null}
    </Modal>
  );
}
