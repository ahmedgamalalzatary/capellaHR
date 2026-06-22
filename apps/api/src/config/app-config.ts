import "dotenv/config";

export type AppConfig = {
  port: number;
  nodeEnv: string;
};

export function getAppConfig(): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    nodeEnv: process.env.NODE_ENV ?? "development"
  };
}
