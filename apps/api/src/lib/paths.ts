import path from "node:path";

const apiRootPath = process.cwd();
const apiStoragePath = path.join(apiRootPath, "storage");
export const employeeFilesStoragePath = path.join(apiStoragePath, "employees");
