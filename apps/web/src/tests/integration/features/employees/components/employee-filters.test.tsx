import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { EmployeeFilters } from "@/features/employees/components/employee-filters";

// Radix Select relies on these DOM APIs that jsdom doesn't implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const completed = {
  id: 2,
  name: "فرع المعادي",
  address: "المعادي",
  gpsLatitude: "29.9",
  gpsLongitude: "31.2",
  gpsRadiusMeters: 100,
  allowedIpCidr: "196.221.0.0/16",
  registeredDeviceToken: null,
  setupStatus: "completed"
};
const pending = { ...completed, id: 3, name: "فرع لم يكتمل", setupStatus: "setup_pending" };

function mockBranches() {
  server.use(
    http.get(apiUrl("/branches"), () =>
      HttpResponse.json({
        branches: {
          items: [completed, pending],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 }
        }
      })
    )
  );
}

describe("EmployeeFilters", () => {
  it("renders the search box with the current search value", () => {
    mockBranches();
    renderWithProviders(
      <EmployeeFilters filters={{ page: 1, search: "أحمد" }} onChange={vi.fn()} />
    );

    expect(screen.getByPlaceholderText("ابحث بالاسم")).toHaveValue("أحمد");
  });

  it("debounces search input and resets to page 1", async () => {
    mockBranches();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<EmployeeFilters filters={{ page: 3 }} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("ابحث بالاسم"), "أحمد");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ search: "أحمد", page: 1 }));
  });

  it("lists only completed branches as filter options and emits the choice", async () => {
    mockBranches();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<EmployeeFilters filters={{ page: 1 }} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "الفرع" }));

    expect(await screen.findByRole("option", { name: "فرع المعادي" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "فرع لم يكتمل" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "فرع المعادي" }));

    expect(onChange).toHaveBeenCalledWith({ branchId: 2, page: 1 });
  });

  it("emits the chosen status and resets to page 1", async () => {
    mockBranches();
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<EmployeeFilters filters={{ page: 1 }} onChange={onChange} />);

    await user.click(screen.getByRole("combobox", { name: "الحالة" }));
    await user.click(await screen.findByRole("option", { name: "محذوف" }));

    expect(onChange).toHaveBeenCalledWith({ status: "soft_deleted", page: 1 });
  });
});
