import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, userEvent, waitFor } from "@/test/utils";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { EmployeeFilesSection } from "@/features/employees/components/employee-files-section";

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function mockFiles(files: unknown[]) {
  server.use(http.get(apiUrl("/employees/1/files"), () => HttpResponse.json({ files })));
}

describe("EmployeeFilesSection", () => {
  it("renders all three file-type labels", async () => {
    mockFiles([]);
    renderWithProviders(<EmployeeFilesSection employeeId={1} />);

    expect(await screen.findByText("الصورة الشخصية")).toBeInTheDocument();
    expect(screen.getByText("صورة الهوية (أمامي)")).toBeInTheDocument();
    expect(screen.getByText("صورة الهوية (خلفي)")).toBeInTheDocument();
  });

  it("shows a preview image for an existing file", async () => {
    mockFiles([
      { id: 5, fileType: "personal_photo", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
    ]);
    server.use(
      http.get(apiUrl("/employees/1/files/5"), () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2]).buffer, {
          headers: { "Content-Type": "image/png" }
        })
      )
    );

    renderWithProviders(<EmployeeFilesSection employeeId={1} />);

    await waitFor(() => expect(screen.getByAltText("الصورة الشخصية")).toHaveAttribute("src", "blob:mock"));
  });

  it("hides replace controls in read-only mode", async () => {
    mockFiles([]);
    renderWithProviders(<EmployeeFilesSection employeeId={1} readOnly />);

    await screen.findByText("الصورة الشخصية");
    expect(screen.queryByLabelText("استبدال الصورة الشخصية")).not.toBeInTheDocument();
  });

  it("uploads a replacement to the per-file endpoint", async () => {
    mockFiles([]);
    let putFileType: string | null = null;
    server.use(
      http.put(apiUrl("/employees/1/files/id_front"), () => {
        putFileType = "id_front";
        return HttpResponse.json({
          file: { id: 6, fileType: "id_front", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
        });
      })
    );

    renderWithProviders(<EmployeeFilesSection employeeId={1} />);

    const input = await screen.findByLabelText("استبدال صورة الهوية (أمامي)");
    await userEvent.setup().upload(input, new File(["x"], "front.png", { type: "image/png" }));

    await waitFor(() => expect(putFileType).toBe("id_front"));
    expect(input).toHaveValue("");
  });
});
