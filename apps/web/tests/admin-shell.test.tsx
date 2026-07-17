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

  test('moves focus into the drawer on open and restores it to the toggle on close, repeatedly', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'فتح القائمة' });
    const sidebar = screen.getByRole('complementary');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      toggle.focus();
      fireEvent.click(toggle);
      expect(sidebar.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.activeElement).toBe(toggle);
    }
  });

  test('wraps Tab focus inside the open drawer', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'فتح القائمة' });
    toggle.focus();
    fireEvent.click(toggle);
    const sidebar = screen.getByRole('complementary');
    const links = Array.from(sidebar.querySelectorAll<HTMLElement>('a[href]'));
    const first = links[0]!;
    const last = links[links.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('closes the sidebar on Escape', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('complementary').dataset['state']).toBe('closed');
  });
});
