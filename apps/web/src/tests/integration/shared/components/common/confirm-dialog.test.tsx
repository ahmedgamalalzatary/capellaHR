import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent } from "@/test/utils";

import { ConfirmDialog } from "@/shared/components/common/confirm-dialog";

describe("ConfirmDialog", () => {
  it("renders the title, description, and confirm label when open", () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="حذف الموظف"
        description="هل أنت متأكد؟"
        confirmLabel="حذف"
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText("حذف الموظف")).toBeInTheDocument();
    expect(screen.getByText("هل أنت متأكد؟")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="حذف الموظف"
        description="هل أنت متأكد؟"
        confirmLabel="حذف"
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole("button", { name: "حذف" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("requests close when the cancel button is clicked", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="حذف الموظف"
        description="هل أنت متأكد؟"
        confirmLabel="حذف"
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "إلغاء" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables the confirm button while confirming", () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="حذف الموظف"
        description="هل أنت متأكد؟"
        confirmLabel="حذف"
        isConfirming
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "حذف" })).toBeDisabled();
  });
});
