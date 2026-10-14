import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup } from '@testing-library/react';

import { TabPanel, Tabs } from '../../src/components/tabs';

afterEach(cleanup);

const items = [
  { value: 'open', label: 'المفتوحة' },
  { value: 'done', label: 'المنتهية', count: 3 },
  { value: 'all', label: 'الكل' },
];

function Harness({ dir = 'rtl' }: { dir?: 'rtl' | 'ltr' }) {
  const [value, setValue] = useState('open');
  return (
    <div dir={dir}>
      <Tabs idBase="t" label="حالة الخدمة" items={items} value={value} onValueChange={setValue} />
      <TabPanel idBase="t" value={value}>panel {value}</TabPanel>
    </div>
  );
}

describe('Tabs', () => {
  test('marks the selected tab and links it to its panel', () => {
    render(<Harness />);
    const tab = screen.getByRole('tab', { name: 'المفتوحة' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: /المنتهية/ }).tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel', { name: 'المفتوحة' }).textContent).toBe('panel open');
  });

  test('in RTL, ArrowLeft moves to the next tab and ArrowRight to the previous', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'المفتوحة' }), { key: 'ArrowLeft' });
    const next = screen.getByRole('tab', { name: /المنتهية/ });
    expect(next.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(next);
    fireEvent.keyDown(next, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'المفتوحة' }).getAttribute('aria-selected')).toBe('true');
  });

  test('wraps around and supports Home and End', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'المفتوحة' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'الكل' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'الكل' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'المفتوحة' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'المفتوحة' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'الكل' }).getAttribute('aria-selected')).toBe('true');
  });

  test('in LTR, ArrowRight moves to the next tab', () => {
    render(<Harness dir="ltr" />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'المفتوحة' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /المنتهية/ }).getAttribute('aria-selected')).toBe('true');
  });

  test('shows a count beside the label', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /المنتهية/ }).textContent).toContain('3');
  });
});
