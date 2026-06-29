import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent } from "@/test/utils";

import { FileUpload } from "@/shared/components/common/file-upload";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("FileUpload", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("renders the label", () => {
    renderWithProviders(<FileUpload label="الصورة الشخصية" value={null} onChange={vi.fn()} />);
    expect(screen.getByText("الصورة الشخصية")).toBeInTheDocument();
  });

  it("calls onChange with the selected file", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FileUpload label="الصورة" value={null} onChange={onChange} />);

    const file = new File(["x"], "me.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("الصورة"), file);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onChange.mock.calls[0][0].name).toBe("me.png");
    expect(screen.getByLabelText("الصورة")).toHaveValue("");
  });

  it("shows a preview image for the selected file", () => {
    const file = new File(["x"], "me.png", { type: "image/png" });
    renderWithProviders(<FileUpload label="الصورة" value={file} onChange={vi.fn()} />);

    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:mock");
  });

  it("shows an existing preview url when no file is selected", () => {
    renderWithProviders(
      <FileUpload label="الصورة" value={null} previewUrl="blob:existing" onChange={vi.fn()} />
    );

    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:existing");
  });

  it("renders an error message when provided", () => {
    renderWithProviders(
      <FileUpload label="الصورة" value={null} error="الملف مطلوب" onChange={vi.fn()} />
    );

    expect(screen.getByText("الملف مطلوب")).toBeInTheDocument();
  });
});
