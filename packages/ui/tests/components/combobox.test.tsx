import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { Combobox, normalizeArabic } from '../../src/components/combobox';

afterEach(cleanup);

const employees = [
  { value: '1', label: 'أحمد علي', hint: 'المعادي' },
  { value: '2', label: 'فاطمة حسن', hint: 'مدينة نصر' },
  { value: '3', label: 'إيمان سعيد', hint: 'المعادي' },
];

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div dir="rtl">
      <Combobox
        label="الموظف"
        options={employees}
        value={value}
        onChange={(next) => { setValue(next); onChange(next); }}
        allLabel="كل الموظفين"
      />
    </div>
  );
}

describe('normalizeArabic', () => {
  test('matches regardless of hamza forms, taa marbuta, alef maqsura and diacritics', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('إيمان')).toBe(normalizeArabic('ايمان'));
    expect(normalizeArabic('فاطمة')).toBe(normalizeArabic('فاطمه'));
    expect(normalizeArabic('مُنى')).toBe(normalizeArabic('مني'));
  });
});

describe('Combobox', () => {
  test('is an ARIA combobox showing "all" when nothing is chosen', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'الموظف' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect((box as HTMLInputElement).placeholder).toBe('كل الموظفين');
  });

  test('typing filters the options (Arabic-aware) and matches the hint too', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'الموظف' });
    fireEvent.change(box, { target: { value: 'احمد' } });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['أحمد عليالمعادي']);
    fireEvent.change(box, { target: { value: 'المعادي' } });
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  test('keyboard: ArrowDown opens and moves, Enter picks, the input shows the choice', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'الموظف' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const active = box.getAttribute('aria-activedescendant');
    expect(document.getElementById(active!)?.textContent).toContain('فاطمة حسن');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect((box as HTMLInputElement).value).toBe('فاطمة حسن');
  });

  test('Escape closes and puts back the chosen label', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'الموظف' });
    fireEvent.change(box, { target: { value: 'زز' } });
    expect(screen.getByText('لا توجد نتائج')).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect((box as HTMLInputElement).value).toBe('');
  });

  test('clicking an option picks it; the clear button goes back to all', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'الموظف' });
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.mouseDown(screen.getByRole('option', { name: /إيمان سعيد/ }));
    expect(onChange).toHaveBeenLastCalledWith('3');
    fireEvent.click(screen.getByRole('button', { name: 'مسح الموظف' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
