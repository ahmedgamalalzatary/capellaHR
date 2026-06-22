import path from "node:path";

export const apiRootPath = process.cwd();
export const apiStoragePath = path.join(apiRootPath, "storage");
export const employeeFilesStoragePath = path.join(apiStoragePath, "employees");
