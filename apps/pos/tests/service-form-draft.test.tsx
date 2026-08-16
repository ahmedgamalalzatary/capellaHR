import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/catalog/api/catalog-api', () => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));

import { ServiceForm } from '../src/features/catalog/components/service-form';
import type { Category, ServiceListItem } from '../src/features/catalog';

const categories: Category[] = [{
  id: 1, branchId: 1, type: 'service', name: 'شعر', isActive: true,
  createdAt: '', updatedAt: '',
} as Category];

const mount = (service?: ServiceListItem) => render(
  <QueryClientProvider client={new QueryClient()}>
    <ServiceForm categories={categories} branchId={1} {...(service ? { service } : {})} />
  </QueryClientProvider>,
);

describe('service form draft', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('offers back a service the admin started writing before changing tab', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^اسم الخدمة/), { target: { value: 'حمام مغربي' } });
    fireEvent.change(screen.getByLabelText(/^السعر/), { target: { value: '300' } });
    cleanup();

    mount();

    fireEvent.click(screen.getByRole('button', { name: 'استعادة' }));
    expect((screen.getByLabelText(/^اسم الخدمة/) as HTMLInputElement).value).toBe('حمام مغربي');
    expect((screen.getByLabelText(/^السعر/) as HTMLInputElement).value).toBe('300');
  });

  it('never offers a draft over an existing service being edited', () => {
    mount();
    fireEvent.change(screen.getByLabelText(/^اسم الخدمة/), { target: { value: 'حمام مغربي' } });
    cleanup();

    mount({
      id: 9, branchId: 1, categoryId: 1, categoryName: 'شعر', categoryIsActive: true,
      name: 'صبغة', description: null, price: '200.00', commissionPercent: '10.00',
      isActive: true, createdAt: '', updatedAt: '',
    } as ServiceListItem);

    expect(screen.queryByRole('button', { name: 'استعادة' })).toBeNull();
  });
});

describe('category form draft', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('retires the draft once the category is stored', async () => {
    const { CategoryForm } = await import('../src/features/catalog/components/category-form');
    const { createCategory } = await import('../src/features/catalog/api/catalog-api');
    (createCategory as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 4, branchId: 1, type: 'service', name: 'أظافر', isActive: true,
      createdAt: '', updatedAt: '',
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CategoryForm branchId={1} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/^اسم التصنيف/), { target: { value: 'أظافر' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التصنيف' }));

    await waitFor(() => expect(sessionStorage.getItem('capella:form-draft:category:1')).toBeNull());
  });
});
