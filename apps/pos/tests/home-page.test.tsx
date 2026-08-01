import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import HomePage from '../src/app/(protected)/page';

afterEach(() => {
  cleanup();
});

describe('POS placeholder home page', () => {
  it('renders the Arabic placeholder shell', () => {
    render(<HomePage />);
    expect(screen.getByText('كابيلا — نقطة البيع')).toBeDefined();
    expect(screen.getByText('قيد الإنشاء')).toBeDefined();
  });
});
