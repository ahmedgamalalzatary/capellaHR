import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import {
  createAdminAuthService,
  createStubEmployeeService,
  signInAdmin
} from "./employee-routes.fixtures";

describe("employee routes (files)", () => {
  it("lists the current employee files", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1/files").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      files: [
        {
          id: 1,
          fileType: "personal_photo",
          mimeType: "image/jpeg",
          fileSizeBytes: 12,
          replacedAt: null
        }
      ]
    });
  });

  it("downloads an employee file", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app).get("/employees/1/files/1").set("Cookie", cookieHeader);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.body).toEqual(Buffer.from("file-bytes"));
  });

  it("replaces an employee file", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      employeeService: createStubEmployeeService("completed").service
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .put("/employees/1/files/personal_photo")
      .set("Cookie", cookieHeader)
      .attach("file", Buffer.from("replacement"), "replacement.jpg");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      file: {
        id: 2,
        fileType: "personal_photo",
        mimeType: "image/jpeg",
        fileSizeBytes: 11,
        replacedAt: null
      }
    });
  });
});
