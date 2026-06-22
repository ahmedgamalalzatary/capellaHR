import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "mysql",
  schema: "./apps/api/src/db/schema.ts",
  out: "./apps/api/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ""
  }
});
