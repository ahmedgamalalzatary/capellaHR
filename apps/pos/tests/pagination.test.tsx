import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Pagination } from '../src/components/data/pagination';

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  vi.unstubAllGlobals();
});

describe('Pagination (smart mode)', () => {
  test('renders page-number buttons and jump input when page/totalPages/onPage are given', () => {
    render(
      <Pagination
        summary="صفحة 5 من 10"
        previousDisabled={false}
        nextDisabled={false}
        onPrevious={() => {}}
        onNext={() => {}}
        page={5}
        totalPages={10}
        onPage={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'الصفحة 5' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'الصفحة 1' })).toBeDefined();
    expect(screen.getByLabelText('انتقال إلى صفحة')).toBeDefined();
  });

  test('clicking a page number calls onPage with that page', () => {
    const onPage = vi.fn();
    render(
      <Pagination
        previousDisabled={false}
        nextDisabled={false}
        onPrevious={() => {}}
        onNext={() => {}}
        page={5}
        totalPages={10}
        onPage={onPage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'الصفحة 4' }));
    expect(onPage).toHaveBeenCalledWith(4);
  });

  test('scrolls to the top on every page change', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1250 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={vi.fn()} persistenceKey="scroll-test" />,
    );

    for (const page of [2, 3, 2, 1, 4]) {
      fireEvent.click(screen.getByRole('button', { name: `الصفحة ${page}` }));
      expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    }
  });

  test('restores the saved page when the same list remounts', () => {
    const first = vi.fn();
    const firstRender = render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={first} persistenceKey="invoices" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة 3' }));
    firstRender.unmount();

    const restored = vi.fn();
    render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={restored} persistenceKey="invoices" />,
    );

    expect(restored).toHaveBeenCalledWith(3);
  });

  test('restores a page only for the same result set', () => {
    const first = render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={vi.fn()} persistenceKey="reports" resultSetKey="sales:july" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة 3' }));
    first.unmount();

    const differentReport = vi.fn();
    const differentRender = render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={differentReport} persistenceKey="reports" resultSetKey="sales:august" />,
    );
    expect(differentReport).not.toHaveBeenCalled();

    differentRender.unmount();
    const sameReport = vi.fn();
    render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={sameReport} persistenceKey="reports" resultSetKey="sales:july" />,
    );
    expect(sameReport).toHaveBeenCalledWith(3);
  });

  test('keeps separate list page positions', () => {
    const invoices = vi.fn();
    const firstRender = render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={invoices} persistenceKey="invoices" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'الصفحة 2' }));
    firstRender.unmount();

    const sessions = vi.fn();
    render(
      <Pagination previousDisabled={false} nextDisabled={false} onPrevious={() => {}} onNext={() => {}} page={1} totalPages={4} onPage={sessions} persistenceKey="cashier-sessions" />,
    );

    expect(sessions).not.toHaveBeenCalled();
  });
});
