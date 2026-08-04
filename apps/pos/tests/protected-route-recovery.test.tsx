import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import ProtectedRouteError from '../src/app/(protected)/error';
import ProtectedRouteLoading from '../src/app/(protected)/loading';

afterEach(cleanup);

describe('protected route recovery', () => {
  test('offers an in-place retry without claiming the sale draft was lost', () => {
    const reset = vi.fn();

    render(<ProtectedRouteError error={new Error('boom')} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'تعذر تحميل صفحة نقطة البيع' })).toBeDefined();
    expect(screen.getByText(/آخر مسودة تم حفظها بنجاح/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'العودة إلى البيع' }).getAttribute('href')).toBe('/sales');
  });

  test('announces route loading to assistive technology', () => {
    render(<ProtectedRouteLoading />);

    expect(screen.getByRole('status').textContent).toContain('جارٍ تحميل صفحة نقطة البيع');
  });
});
