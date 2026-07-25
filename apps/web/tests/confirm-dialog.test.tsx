import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ConfirmDialog, Modal } from '@capella/ui';

afterEach(cleanup);

describe('Modal', () => {
  test('exposes an accessible labelled dialog', () => {
    render(
      <Modal title="عنوان الحوار" onClose={vi.fn()}>
        <p>محتوى</p>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('عنوان الحوار');
  });

  test('closes on Escape so the keyboard is never trapped', () => {
    const onClose = vi.fn();
    render(<Modal title="عنوان" onClose={onClose}><p>محتوى</p></Modal>);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('moves focus into the dialog on open', () => {
    render(<Modal title="عنوان" onClose={vi.fn()}><button type="button">إجراء</button></Modal>);

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  test('ignores Escape when the answer must be explicit', () => {
    const onClose = vi.fn();
    render(
      <Modal title="عنوان" dismissOnBackdrop={false} onClose={onClose}><p>محتوى</p></Modal>,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  test('keeps a click inside the dialog from dismissing it', () => {
    const onClose = vi.fn();
    render(<Modal title="عنوان" onClose={onClose}><p>محتوى</p></Modal>);

    fireEvent.click(screen.getByText('محتوى'));

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  test('runs the confirm action and reports the danger intent', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="حذف الموظف"
        description="لا يمكن التراجع عن الحذف."
        confirmLabel="تأكيد الحذف"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('لا يمكن التراجع عن الحذف.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('cancels without confirming', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="حذف الموظف"
        confirmLabel="تأكيد الحذف"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('disables both actions while the confirmation is in flight', () => {
    render(
      <ConfirmDialog
        title="حذف الموظف"
        confirmLabel="تأكيد الحذف"
        pending
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'تأكيد الحذف' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'إلغاء' })).toHaveProperty('disabled', true);
  });

  test('blocks backdrop dismissal while the confirmation is in flight', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        title="حذف الموظف"
        confirmLabel="تأكيد الحذف"
        pending
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();

    rerender(
      <ConfirmDialog
        title="حذف الموظف"
        confirmLabel="تأكيد الحذف"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('dialog').parentElement!);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
