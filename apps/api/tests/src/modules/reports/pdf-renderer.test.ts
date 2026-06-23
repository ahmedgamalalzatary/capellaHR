import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";

const launch = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch
  }
}));

describe("pdf renderer", () => {
  afterEach(async () => {
    const { cleanupPlaywrightPdfRenderer } = await import("../../../../src/modules/reports/pdf-renderer");
    await cleanupPlaywrightPdfRenderer();
    launch.mockReset();
  });

  it("closes the cached browser during cleanup", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      setContent: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
      close: vi.fn().mockResolvedValue(undefined)
    });

    launch.mockResolvedValue({
      newPage,
      close
    } satisfies Partial<Browser>);

    const {
      cleanupPlaywrightPdfRenderer,
      createPlaywrightPdfRenderer
    } = await import("../../../../src/modules/reports/pdf-renderer");
    const renderer = createPlaywrightPdfRenderer();

    await renderer.render({
      title: "Title",
      subtitle: "Subtitle",
      columns: ["Col"],
      rows: [["Value"]],
      emptyMessage: "Empty"
    });

    await cleanupPlaywrightPdfRenderer();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
