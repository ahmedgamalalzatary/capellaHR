import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@capella/ui';
import { expect, test, vi } from 'vitest';

test('initial focus and Tab navigation skip non-tabbable modal controls', () => {
  render(
    <Modal title="Test dialog" onClose={vi.fn()}>
      <input type="hidden" aria-label="Hidden input" />
      <button type="button" tabIndex={-1}>Programmatic action</button>
      <button type="button">First action</button>
      <button type="button">Last action</button>
    </Modal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
  const first = screen.getByRole('button', { name: 'First action' });
  const last = screen.getByRole('button', { name: 'Last action' });
  expect(document.activeElement).toBe(first);

  last.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
});
