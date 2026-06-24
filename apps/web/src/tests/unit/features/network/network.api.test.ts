import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

import { networkApi } from "@/features/network/network.api";

describe("networkApi.whoami", () => {
  it("returns the caller IP from the endpoint", async () => {
    server.use(
      http.get(apiUrl("/network/whoami"), () => HttpResponse.json({ ip: "203.0.113.7" }))
    );

    await expect(networkApi.whoami()).resolves.toEqual({ ip: "203.0.113.7" });
  });
});
