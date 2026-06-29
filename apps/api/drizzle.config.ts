import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");
const ENV_FILE_CANDIDATES = [
  path.join(configDir, ".env"),
  path.join(repoRoot, ".env")
];

for (const envPath of ENV_FILE_CANDIDATES) {
  dotenv.config({ path: envPath, override: false });
}

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
