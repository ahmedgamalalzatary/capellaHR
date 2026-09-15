import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { Pagination } from '../src/components/data/pagination';

afterEach(() => cleanup());

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
});
