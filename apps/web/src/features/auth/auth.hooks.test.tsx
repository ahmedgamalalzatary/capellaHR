import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useCurrentUser, useSignIn, useSignOut } from "@/features/auth/auth.hooks";
import { authKeys } from "@/features/auth/auth.keys";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const employeeActor = { id: 1, role: "employee" as const, name: "موظف", phone: "01012345678" };

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useCurrentUser", () => {
  it("returns null when the session endpoint responds 401", async () => {
    server.use(
      http.get(apiUrl("/auth/me"), () =>
        HttpResponse.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 })
      )
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it("returns the actor when authenticated", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: employeeActor })));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useCurrentUser(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(employeeActor));
  });
});

describe("useSignIn", () => {
  it("populates the current-user cache on success", async () => {
    server.use(
      http.post(apiUrl("/auth/sign-in"), () => HttpResponse.json({ actor: employeeActor }))
    );
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(() => useSignIn(), { wrapper });
    result.current.mutate({ phone: "01012345678", password: "secret12" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(authKeys.me())).toEqual(employeeActor);
  });
});

describe("useSignOut", () => {
  it("clears the current-user cache on success", async () => {
    server.use(http.post(apiUrl("/auth/sign-out"), () => new HttpResponse(null, { status: 204 })));
    const { queryClient, wrapper } = makeWrapper();
    queryClient.setQueryData(authKeys.me(), employeeActor);

    const { result } = renderHook(() => useSignOut(), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(authKeys.me())).toBeNull();
  });
});
