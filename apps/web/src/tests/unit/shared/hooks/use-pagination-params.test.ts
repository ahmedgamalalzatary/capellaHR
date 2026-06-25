import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaginationParams } from "@/shared/hooks/use-pagination-params";

const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/employees",
  useSearchParams: () => currentParams
}));

describe("usePaginationParams", () => {
  beforeEach(() => {
    replace.mockClear();
    currentParams = new URLSearchParams();
  });

  it("reads a current param value, or null when absent", () => {
    currentParams = new URLSearchParams("search=ahmed");
    const { result } = renderHook(() => usePaginationParams());

    expect(result.current.get("search")).toBe("ahmed");
    expect(result.current.get("status")).toBeNull();
  });

  it("merges updates into the URL and replaces the route", () => {
    currentParams = new URLSearchParams("page=2");
    const { result } = renderHook(() => usePaginationParams());

    result.current.setParams({ search: "ahmed" });

    expect(replace).toHaveBeenCalledTimes(1);
    const target = new URL(replace.mock.calls[0][0], "http://x");
    expect(target.pathname).toBe("/employees");
    expect(target.searchParams.get("page")).toBe("2");
    expect(target.searchParams.get("search")).toBe("ahmed");
  });

  it("removes a param when set to an empty string, null, or undefined", () => {
    currentParams = new URLSearchParams("search=ahmed&page=3");
    const { result } = renderHook(() => usePaginationParams());

    result.current.setParams({ search: "", page: undefined });

    const target = new URL(replace.mock.calls[0][0], "http://x");
    expect(target.searchParams.has("search")).toBe(false);
    expect(target.searchParams.has("page")).toBe(false);
  });

  it("coerces numeric values to strings", () => {
    const { result } = renderHook(() => usePaginationParams());

    result.current.setParams({ page: 4 });

    const target = new URL(replace.mock.calls[0][0], "http://x");
    expect(target.searchParams.get("page")).toBe("4");
  });
});
