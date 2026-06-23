import dotenv from "dotenv";
import path from "node:path";

type AppConfig = {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  cors: {
    allowedOrigins: string[];
  };
  uploads: {
    basePath: string;
    maxBytes: number;
    allowedMimeTypes: string[];
  };
  auth: {
    cookieName: string;
    cookieSecure: boolean;
    adminSessionTtlHours: number;
    bootstrapAdmin: {
      name: string;
      email: string;
      password: string;
    };
  };
};

const ENV_FILE_CANDIDATES = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(process.cwd(), "../.env")
];

for (const envPath of ENV_FILE_CANDIDATES) {
  dotenv.config({ path: envPath, override: false });
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

export function getAppConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
    cors: {
      allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((value) => normalizeOrigin(value.trim()))
        .filter(Boolean)
    },
    uploads: {
      basePath: process.env.UPLOAD_BASE_PATH ?? "storage",
      maxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 52428800),
      allowedMimeTypes: (process.env.UPLOAD_ALLOWED_MIME_TYPES ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    },
    auth: {
      cookieName: "capella_session",
      cookieSecure: process.env.COOKIE_SECURE === "true",
      adminSessionTtlHours: 8,
      bootstrapAdmin: {
        name: process.env.ADMIN_NAME ?? "Capella Admin",
        email: process.env.ADMIN_EMAIL ?? "admin@capella.eg",
        password: process.env.ADMIN_PASSWORD ?? "admin1234"
      }
    }
  };
}
