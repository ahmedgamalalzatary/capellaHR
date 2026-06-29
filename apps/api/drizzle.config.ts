import dotenv from "dotenv";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

const ENV_FILE_CANDIDATES = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env")
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
