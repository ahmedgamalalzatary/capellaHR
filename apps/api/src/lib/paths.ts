import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

export const apiRootPath = path.resolve(currentDirPath, "..", "..");
export const apiStoragePath = path.join(apiRootPath, "storage");
