import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/lib/api-client";
import { authApi } from "@/features/auth/auth.api";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const employeeActor = { id: 1, role: "employee", name: "موظف", phone: "01012345678" };
const adminActor = { id: 1, role: "admin", name: "مدير", email: "admin.test@capella.invalid" };

describe("authApi.signIn", () => {
  it("POSTs credentials to /auth/sign-in and returns the actor", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/auth/sign-in"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ actor: employeeActor });
      })
    );

    const result = await authApi.signIn({ phone: "01012345678", password: "secret12" });

    expect(receivedBody).toEqual({ phone: "01012345678", password: "secret12" });
    expect(result.actor).toEqual(employeeActor);
  });

  it("throws ApiError with status on invalid credentials", async () => {
    server.use(
      http.post(apiUrl("/auth/sign-in"), () =>
        HttpResponse.json(
          { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
          { status: 401 }
        )
      )
    );

    await expect(authApi.signIn({ phone: "01012345678", password: "wrongpass" })).rejects.toMatchObject(
      { name: "ApiError", status: 401 } satisfies Partial<ApiError>
    );
  });
});

describe("authApi.adminSignIn", () => {
  it("POSTs credentials to /auth/admin/sign-in and returns the actor", async () => {
    server.use(
      http.post(apiUrl("/auth/admin/sign-in"), () => HttpResponse.json({ actor: adminActor }))
    );

    const result = await authApi.adminSignIn({ email: "admin.test@capella.invalid", password: "secret12" });

    expect(result.actor).toEqual(adminActor);
  });
});

describe("authApi.me", () => {
  it("GETs /auth/me and returns the actor", async () => {
    server.use(http.get(apiUrl("/auth/me"), () => HttpResponse.json({ actor: adminActor })));

    const result = await authApi.me();

    expect(result.actor).toEqual(adminActor);
  });
});
