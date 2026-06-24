import { afterEach, describe, expect, it, vi } from "vitest";

describe("api-client buildUrl behavior", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/shared/config/env");
    vi.unstubAllEnvs();
  });

  it("supports relative NEXT_PUBLIC_API_URL values in the browser", async () => {
    window.history.replaceState({}, "", "/sign-in");
    vi.doMock("@/shared/config/env", () => ({
      env: {
        apiUrl: "/api"
      }
    }));

    const { api } = await import("./api-client");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ actor: { id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/auth/admin/sign-in", {
      json: { email: "adminhr@capella.eg", password: "admin1234" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/admin/sign-in",
      expect.objectContaining({
        credentials: "include",
        method: "POST"
      })
    );
  });

  it("fails fast on the server when NEXT_PUBLIC_API_URL is relative", async () => {
    const originalWindow = globalThis.window;
    vi.doMock("@/shared/config/env", () => ({
      env: {
        apiUrl: "/api"
      }
    }));
    vi.stubGlobal("window", undefined);

    try {
      const { api } = await import("./api-client");

      await expect(api.get("/branches")).rejects.toThrow(
        "Relative NEXT_PUBLIC_API_URL values require a browser origin"
      );
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });
});
