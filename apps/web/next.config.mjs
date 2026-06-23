import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

// Load the monorepo root .env so NEXT_PUBLIC_* values defined there are
// available to the web app (Next only reads env from the app dir by default).
const rootEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
loadEnv({ path: rootEnv });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@capella/shared"]
};

export default nextConfig;
