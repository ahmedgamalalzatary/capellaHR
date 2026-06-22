import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app";

describe("auth routes", () => {
  it("rejects invalid sign-in payloads with the project error shape", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/sign-in").send({
      phone: "12345",
      password: "short"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        details: expect.any(Object)
      }
    });
  });

  it("accepts valid sign-in payloads and marks the handler as not implemented yet", async () => {
    const app = createApp();

    const response = await request(app).post("/auth/sign-in").send({
      phone: "+201012345678",
      password: "secret123"
    });

    expect(response.status).toBe(501);
    expect(response.body).toEqual({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Auth sign-in is not implemented yet",
        details: {}
      }
    });
  });
});
