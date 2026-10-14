import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { RowActions } from '../../src/components/dropdown-menu';

afterEach(cleanup);

describe('RowActions', () => {
  test('shows every action when there are two or fewer', () => {
    render(<RowActions label="إجراءات" actions={[
      { label: 'عرض', onSelect: vi.fn() },
      { label: 'طباعة', onSelect: vi.fn() },
    ]} />);
    expect(screen.getByRole('button', { name: 'عرض' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إجراءات' })).toBeNull();
  });

  test('keeps two visible and moves the rest into the menu, destructive last', () => {
    render(<RowActions label="إجراءات" actions={[
      { label: 'حذف', tone: 'danger', onSelect: vi.fn(), confirm: { title: 'حذف السجل', confirmLabel: 'حذف' } },
      { label: 'عرض', onSelect: vi.fn() },
      { label: 'تعديل', onSelect: vi.fn() },
      { label: 'طباعة', onSelect: vi.fn() },
    ]} />);
    expect(screen.getByRole('button', { name: 'عرض' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تعديل' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'حذف' })).toBeNull();

    const trigger = screen.getByRole('button', { name: 'إجراءات' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['طباعة', 'حذف']);
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
  });

  test('menu keyboard: arrows move, Escape closes and returns focus to the trigger', () => {
    render(<RowActions label="إجراءات" actions={[
      { label: 'أ', onSelect: vi.fn() },
      { label: 'ب', onSelect: vi.fn() },
      { label: 'ج', onSelect: vi.fn() },
      { label: 'د', onSelect: vi.fn() },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'إجراءات' });
    fireEvent.click(trigger);
    const [first, second] = screen.getAllByRole('menuitem');
    fireEvent.keyDown(first!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test('a destructive action asks for confirmation before running', async () => {
    const onDelete = vi.fn();
    render(<RowActions label="إجراءات" actions={[
      { label: 'حذف', tone: 'danger', onSelect: onDelete, confirm: { title: 'حذف السجل؟', confirmLabel: 'تأكيد الحذف' } },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'حذف السجل؟' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد الحذف' }));
    expect(onDelete).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('choosing a menu item runs it and closes the menu', () => {
    const onPrint = vi.fn();
    render(<RowActions label="إجراءات" actions={[
      { label: 'أ', onSelect: vi.fn() },
      { label: 'ب', onSelect: vi.fn() },
      { label: 'طباعة', onSelect: onPrint },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'إجراءات' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'طباعة' }));
    expect(onPrint).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
