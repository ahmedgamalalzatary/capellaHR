"use client";

import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen } from "@/test/utils";

const push = vi.fn();
const useParams = vi.fn(() => ({ branchId: "1" }));
const useBranch = vi.fn((branchId: number) => {
  void branchId;

  return {
    data: { branch: { id: 1, name: "فرع المعادي" } },
    isPending: false,
    isError: false
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => useParams(),
  useRouter: () => ({ push })
}));

vi.mock("@/features/branches/branches.hooks", () => ({
  useBranch: (branchId: number) => useBranch(branchId)
}));

vi.mock("@/features/branches/components/branch-form", () => ({
  BranchForm: () => <div>branch-form</div>
}));

import EditBranchPage from "@/app/(admin)/branches/[branchId]/page";

describe("EditBranchPage", () => {
  it("shows an invalid-branch message when the route param is not a positive number", () => {
    useParams.mockReturnValue({ branchId: "abc" });

    renderWithProviders(<EditBranchPage />);

    expect(screen.getByText("معرّف الفرع غير صالح")).toBeInTheDocument();
  });
});
