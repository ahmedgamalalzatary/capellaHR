import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DateRangeFilter, datePresets } from '../../src/components/filters';

afterEach(cleanup);

describe('datePresets (Cairo, week starts Saturday)', () => {
  // Wednesday 2026-10-14, 23:30 in Cairo (UTC+3 in summer time).
  const now = new Date('2026-10-14T20:30:00Z');

  test('today, yesterday, this week and this month', () => {
    const presets = Object.fromEntries(datePresets(now).map((preset) => [preset.label, [preset.from, preset.to]]));
    expect(presets['اليوم']).toEqual(['2026-10-14', '2026-10-14']);
    expect(presets['أمس']).toEqual(['2026-10-13', '2026-10-13']);
    expect(presets['هذا الأسبوع']).toEqual(['2026-10-10', '2026-10-14']);
    expect(presets['هذا الشهر']).toEqual(['2026-10-01', '2026-10-14']);
  });

  test('uses the Cairo day, not the UTC day', () => {
    const lateEvening = new Date('2026-10-14T22:30:00Z');
    const today = datePresets(lateEvening).find((preset) => preset.label === 'اليوم');
    expect(today?.from).toBe('2026-10-15');
  });
});

describe('DateRangeFilter', () => {
  test('applies a valid range', () => {
    const onChange = vi.fn();
    render(<DateRangeFilter from="" to="" onChange={onChange} presets={false} />);
    fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-10-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '' });
  });

  test('refuses "from" after "to" with an inline message and does not apply it', () => {
    const onChange = vi.fn();
    render(<DateRangeFilter from="2026-10-01" to="2026-10-05" onChange={onChange} presets={false} />);
    fireEvent.change(screen.getByLabelText('من'), { target: { value: '2026-10-09' } });
    expect(screen.getByRole('alert').textContent).toBe('تاريخ البداية بعد تاريخ النهاية');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('من').getAttribute('aria-invalid')).toBe('true');
  });

  test('a preset fills both dates and shows as pressed', () => {
    const onChange = vi.fn();
    const presets = datePresets(new Date('2026-10-14T10:00:00Z'));
    const { rerender } = render(<DateRangeFilter from="" to="" onChange={onChange} now={new Date('2026-10-14T10:00:00Z')} />);
    fireEvent.click(screen.getByRole('button', { name: 'أمس' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-13', to: '2026-10-13' });
    const yesterday = presets.find((preset) => preset.label === 'أمس')!;
    rerender(<DateRangeFilter from={yesterday.from} to={yesterday.to} onChange={onChange} now={new Date('2026-10-14T10:00:00Z')} />);
    expect(screen.getByRole('button', { name: 'أمس' }).getAttribute('aria-pressed')).toBe('true');
  });
});
