import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { employeeFilesStoragePath } from "../../lib/paths";

export type EmployeeFileType = "personal_photo" | "id_front" | "id_back";

export type EmployeeFileInput = {
  fileType: EmployeeFileType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
};

export type StoredEmployeeFile = {
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
};

export type EmployeeFileStorage = {
  saveEmployeeFile(employeeId: number, file: EmployeeFileInput): Promise<StoredEmployeeFile>;
  readEmployeeFile(storagePath: string): Promise<Buffer>;
};

type CreateLocalEmployeeFileStorageOptions = {
  basePath?: string;
};

export function createLocalEmployeeFileStorage(
  options: CreateLocalEmployeeFileStorageOptions = {}
): EmployeeFileStorage {
  const basePath = options.basePath ?? employeeFilesStoragePath;

  return {
    async saveEmployeeFile(employeeId, file) {
      const fileExtension = path.extname(file.originalName) || mimeTypeToExtension(file.mimeType);
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${fileExtension}`;
      const relativePath = path.join(String(employeeId), file.fileType, fileName);
      const absolutePath = path.join(basePath, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.buffer);

      return {
        storagePath: relativePath.replaceAll("\\", "/"),
        mimeType: file.mimeType,
        fileSizeBytes: file.sizeBytes
      };
    },

    async readEmployeeFile(storagePath) {
      return readFile(path.join(basePath, storagePath));
    }
  };
}

function mimeTypeToExtension(mimeType: string) {
  if (mimeType === "image/png") {
    return ".png";
  }

  return ".jpg";
}
