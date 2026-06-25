import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  useCreateEmployee,
  useCreateEmployeeAssignment,
  useDeleteEmployee,
  useEmployee,
  useEmployeeAssignments,
  useEmployeeFiles,
  useEmployees,
  useReplaceEmployeeFile,
  useUpdateEmployee
} from "@/features/employees/employees.hooks";
import { employeeKeys } from "@/features/employees/employees.keys";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const employee = {
  id: 1,
  fullName: "أحمد",
  primaryPhone: "01012345678",
  whatsappPhone: "01112345678",
  email: null,
  branchId: 2,
  age: 30,
  address: "المعادي",
  currentMonthlySalary: "8000.00",
  softDeletedAt: null
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

describe("useEmployees", () => {
  it("fetches the paginated employee list", async () => {
    server.use(
      http.get(apiUrl("/employees"), () =>
        HttpResponse.json({ employees: { items: [employee], pagination } })
      )
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEmployees({ page: 1 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.employees.items).toHaveLength(1);
  });
});

describe("useEmployee", () => {
  it("fetches a single employee by id and is disabled for invalid ids", async () => {
    server.use(http.get(apiUrl("/employees/1"), () => HttpResponse.json({ employee })));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEmployee(1), { wrapper });
    await waitFor(() => expect(result.current.data?.employee.id).toBe(1));

    const disabled = renderHook(() => useEmployee(0), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
  });

  it("supports explicitly disabling the query", () => {
    const { wrapper } = makeWrapper();

    const disabled = renderHook(() => useEmployee(1, false), { wrapper });

    expect(disabled.result.current.fetchStatus).toBe("idle");
  });
});

describe("useCreateEmployee", () => {
  it("invalidates the employee list on success", async () => {
    server.use(http.post(apiUrl("/employees"), () => HttpResponse.json({ employee }, { status: 201 })));
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateEmployee(), { wrapper });
    result.current.mutate({
      fullName: "أحمد",
      password: "secret12",
      primaryPhone: "01012345678",
      whatsappPhone: "01112345678",
      branchId: 2,
      age: 30,
      currentMonthlySalary: "8000",
      address: "المعادي",
      personalPhoto: new File(["x"], "p.png", { type: "image/png" }),
      idFront: new File(["x"], "p.png", { type: "image/png" }),
      idBack: new File(["x"], "p.png", { type: "image/png" })
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.lists() });
  });
});

describe("useUpdateEmployee", () => {
  it("invalidates list and detail caches on success", async () => {
    server.use(http.patch(apiUrl("/employees/1"), () => HttpResponse.json({ employee })));
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateEmployee(), { wrapper });
    result.current.mutate({ employeeId: 1, input: { fullName: "محدث" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.lists() });
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.detail(1) });
  });
});

describe("useDeleteEmployee", () => {
  it("invalidates list and detail caches on success", async () => {
    server.use(http.delete(apiUrl("/employees/1"), () => new HttpResponse(null, { status: 204 })));
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteEmployee(), { wrapper });
    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.lists() });
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.detail(1) });
  });
});

describe("useEmployeeFiles", () => {
  it("fetches the file list for an employee", async () => {
    server.use(
      http.get(apiUrl("/employees/1/files"), () =>
        HttpResponse.json({
          files: [
            { id: 5, fileType: "personal_photo", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
          ]
        })
      )
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEmployeeFiles(1), { wrapper });

    await waitFor(() => expect(result.current.data?.files).toHaveLength(1));
  });
});

describe("useReplaceEmployeeFile", () => {
  it("invalidates the employee's files cache on success", async () => {
    server.use(
      http.put(apiUrl("/employees/1/files/id_front"), () =>
        HttpResponse.json({
          file: { id: 6, fileType: "id_front", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
        })
      )
    );
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useReplaceEmployeeFile(1), { wrapper });
    result.current.mutate({ fileType: "id_front", file: new File(["x"], "p.png", { type: "image/png" }) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.files(1) });
  });
});

describe("useEmployeeAssignments", () => {
  it("fetches the assignment history for an employee", async () => {
    server.use(
      http.get(apiUrl("/employees/1/branch-assignments"), () =>
        HttpResponse.json({
          assignments: [
            { id: 3, employeeId: 1, branchId: 2, effectiveFrom: "2026-07-01T00:00:00.000Z", effectiveTo: null, assignedByAdminId: 1 }
          ]
        })
      )
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useEmployeeAssignments(1), { wrapper });

    await waitFor(() => expect(result.current.data?.assignments).toHaveLength(1));
  });
});

describe("useCreateEmployeeAssignment", () => {
  it("invalidates the assignments and detail caches on success", async () => {
    server.use(
      http.post(apiUrl("/employees/1/branch-assignments"), () =>
        HttpResponse.json(
          {
            assignment: { id: 4, employeeId: 1, branchId: 7, effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveTo: null, assignedByAdminId: 1 }
          },
          { status: 201 }
        )
      )
    );
    const { queryClient, wrapper } = makeWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateEmployeeAssignment(1), { wrapper });
    result.current.mutate({ branchId: 7, effectiveFrom: "2026-08-01T00:00:00.000Z" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.assignments(1) });
    expect(spy).toHaveBeenCalledWith({ queryKey: employeeKeys.detail(1) });
  });
});
