import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/** Fresh QueryClient per test, retries off so error states surface immediately. */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

/** Render a component wrapped in the providers features depend on. */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
