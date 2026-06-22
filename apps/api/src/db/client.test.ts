import { afterEach, describe, expect, it } from "vitest";
import { getAppConfig } from "../config/app-config";
import { createDatabaseClient, resetDatabaseClient } from "./client";

afterEach(async () => {
  await resetDatabaseClient();
});

describe("database client", () => {
  it("creates a database client from the configured database url", async () => {
    const config = getAppConfig();
    const client = createDatabaseClient({
      databaseUrl: config.databaseUrl
    });

    expect(client).toEqual({
      db: expect.any(Object),
      pool: expect.any(Object),
      close: expect.any(Function)
    });

    await client.close();
  });

  it("reuses a singleton database client until it is reset", async () => {
    const config = getAppConfig();
    const firstClient = createDatabaseClient({
      databaseUrl: config.databaseUrl
    });
    const secondClient = createDatabaseClient({
      databaseUrl: config.databaseUrl
    });

    expect(secondClient).toBe(firstClient);

    await firstClient.close();
  });
});
