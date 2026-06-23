import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createApp } from "../../../src/app";
import { corsMiddleware } from "../../../src/http/middleware/cors";

const ORIGINAL = process.env.CORS_ALLOWED_ORIGINS;

beforeEach(() => {
  process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000,http://localhost:4000";
});

afterEach(() => {
  process.env.CORS_ALLOWED_ORIGINS = ORIGINAL;
});

describe("CORS", () => {
  it("echoes an allowed origin and allows credentials on a normal request", async () => {
    const app = createApp();

    const response = await request(app).get("/health").set("Origin", "http://localhost:3000");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("answers a preflight request with allowed methods and headers", async () => {
    const app = createApp();

    const response = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toContain("content-type");
  });

  it("does not echo an origin that is not allowed", async () => {
    const app = createApp();

    const response = await request(app).get("/health").set("Origin", "http://evil.example.com");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("matches origins configured in .env even when they include a trailing slash", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000/,http://localhost:4000/";

    const app = createApp();

    const response = await request(app).get("/health").set("Origin", "http://localhost:3000");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("appends Origin to an existing Vary header", async () => {
    const app = express();
    app.use((_, response, next) => {
      response.setHeader("Vary", "Accept-Encoding");
      next();
    });
    app.use(corsMiddleware);
    app.get("/health", (_request, response) => {
      response.status(200).json({ ok: true });
    });

    const response = await request(app).get("/health").set("Origin", "http://localhost:3000");

    expect(response.headers.vary).toContain("Accept-Encoding");
    expect(response.headers.vary).toContain("Origin");
  });
});
