import "dotenv/config";

export type AppConfig = {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
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

export function getAppConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    nodeEnv: process.env.NODE_ENV ?? "development",
    databaseUrl: process.env.DATABASE_URL ?? "",
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
