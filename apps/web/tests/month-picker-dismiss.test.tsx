import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MonthPicker } from '@capella/ui';

afterEach(cleanup);

const renderPicker = (value = '') =>
  render(
    <div>
      <button type="button">outside</button>
      <MonthPicker id="month-filter" filterLabel="تصفية حسب الشهر" value={value} onChange={vi.fn()} />
    </div>,
  );

describe('MonthPicker dismissal', () => {
  test('dismisses the open popover on Escape', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'تصفية حسب الشهر' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('dismisses the open popover on outside pointer interaction', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'تصفية حسب الشهر' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('keeps trigger-based toggling and stays closed on Escape while closed', () => {
    renderPicker();
    const trigger = screen.getByRole('button', { name: 'تصفية حسب الشهر' });

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
