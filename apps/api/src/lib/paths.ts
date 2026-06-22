import path from "node:path";

export const apiRootPath = process.cwd();
export const apiStoragePath = path.join(apiRootPath, "storage");
