import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AdminShell } from '../src/components/shell/admin-shell';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

function renderShell() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminShell>
        <p>المحتوى</p>
      </AdminShell>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminShell', () => {
  test('renders a closed mobile sidebar with a menu toggle', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'فتح القائمة' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('complementary').dataset['state']).toBe('closed');
  });

  test('opens the sidebar and shows the backdrop when the toggle is clicked', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    expect(screen.getByRole('complementary').dataset['state']).toBe('open');
    expect(screen.getByTestId('sidebar-backdrop')).toBeDefined();
  });

  test('closes the sidebar when the backdrop is clicked', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    fireEvent.click(screen.getByTestId('sidebar-backdrop'));
    expect(screen.getByRole('complementary').dataset['state']).toBe('closed');
    expect(screen.queryByTestId('sidebar-backdrop')).toBeNull();
  });

  test('closes the sidebar when a navigation link is clicked', () => {
    renderShell();
    // jsdom cannot navigate; block the anchor default without touching the React handlers.
    const blockNavigation = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('click', blockNavigation, { capture: true });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
      fireEvent.click(screen.getByRole('link', { name: 'الموظفون' }));
      expect(screen.getByRole('complementary').dataset['state']).toBe('closed');
    } finally {
      document.removeEventListener('click', blockNavigation, { capture: true });
    }
  });

  test('closes the sidebar on Escape', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('complementary').dataset['state']).toBe('closed');
  });
});
