import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('../src/features/catalog', () => ({
  ServicePicker: () => <div>قائمة الخدمات</div>,
}));

import ServicesPage from '../src/app/(protected)/services/page';

afterEach(cleanup);

test('labels the Cashier services page with a top-level heading', () => {
  render(<ServicesPage />);

  expect(screen.getByRole('heading', { level: 1, name: 'الخدمات' })).toBeDefined();
});
