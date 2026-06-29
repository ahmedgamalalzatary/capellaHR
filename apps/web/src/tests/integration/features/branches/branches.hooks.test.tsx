import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useBranch,
  useAllBranches,
  useBranches,
  useCreateBranch,
  useUpdateBranch
} from "@/features/branches/branches.hooks";
import { branchKeys } from "@/features/branches/branches.keys";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const branch = {
  id: 1,
  name: "فرع المعادي",
  address: "المعادي",
  gpsLatitude: "29.9602",
  gpsLongitude: "31.2569",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "setup_pending"
};
const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useBranches", () => {
  it("fetches the paginated branch list", async () => {
    server.use(
      http.get(apiUrl("/branches"), () =>
        HttpResponse.json({ branches: { items: [branch], pagination } })
      )
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBranches({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.branches.items).toHaveLength(1);
  });
});

describe("useAllBranches", () => {
  it("fetches every branch page", async () => {
    server.use(
      http.get(apiUrl("/branches"), ({ request }) => {
        const page = new URL(request.url).searchParams.get("page");
        if (page === "2") {
          return HttpResponse.json({
            branches: {
              items: [{ ...branch, id: 2, name: "فرع مدينة نصر" }],
              pagination: { page: 2, pageSize: 100, total: 2, totalPages: 2 }
            }
          });
        }

        return HttpResponse.json({
          branches: {
            items: [branch],
            pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 }
          }
        });
      })
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useAllBranches(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.branches.map((item) => item.id)).toEqual([1, 2]);
  });
});

describe("useBranch", () => {
  it("fetches a single branch by id", async () => {
    server.use(http.get(apiUrl("/branches/1"), () => HttpResponse.json({ branch })));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBranch(1), { wrapper });

    await waitFor(() => expect(result.current.data?.branch.id).toBe(1));
  });
});

describe("useCreateBranch", () => {
  it("invalidates the branch list cache on success", async () => {
    server.use(http.post(apiUrl("/branches"), () => HttpResponse.json({ branch }, { status: 201 })));
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateBranch(), { wrapper });
    result.current.mutate({
      name: "فرع المعادي",
      address: "المعادي",
      gpsLatitude: 29.9602,
      gpsLongitude: 31.2569,
      gpsRadiusMeters: 100,
      allowedIpCidr: "196.221.0.0/16"
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: branchKeys.lists() });
  });
});

describe("useUpdateBranch", () => {
  it("invalidates list and detail caches on success", async () => {
    server.use(
      http.patch(apiUrl("/branches/1"), () =>
        HttpResponse.json({ branch: { ...branch, name: "محدث" } })
      )
    );
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateBranch(), { wrapper });
    result.current.mutate({ branchId: 1, input: { name: "محدث" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: branchKeys.lists() });
    expect(spy).toHaveBeenCalledWith({ queryKey: branchKeys.detail(1) });
  });
});
