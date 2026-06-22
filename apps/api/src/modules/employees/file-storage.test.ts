import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalEmployeeFileStorage } from "./file-storage";

let tempDir: string | null = null;

afterEach(async () => {
  if (!tempDir) {
    return;
  }

  await rm(tempDir, {
    force: true,
    recursive: true
  });
  tempDir = null;
});

describe("employee file storage", () => {
  it("writes employee files to disk and reads them back", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "capella-employee-files-"));
    const storage = createLocalEmployeeFileStorage({
      basePath: tempDir
    });

    const stored = await storage.saveEmployeeFile(7, {
      fileType: "personal_photo",
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 11,
      buffer: Buffer.from("hello-world")
    });

    expect(stored).toEqual({
      storagePath: expect.stringMatching(/^7\/personal_photo\/.+\.jpg$/),
      mimeType: "image/jpeg",
      fileSizeBytes: 11
    });

    const content = await storage.readEmployeeFile(stored.storagePath);

    expect(content).toEqual(Buffer.from("hello-world"));
  });
});
