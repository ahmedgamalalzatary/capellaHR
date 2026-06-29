import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/shared/lib/api-client";
import { employeesApi } from "@/features/employees/employees.api";
import { apiUrl } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const employee = {
  id: 1,
  fullName: "أحمد جمال",
  primaryPhone: "01012345678",
  whatsappPhone: "01112345678",
  email: "ahmed@capella.eg",
  branchId: 2,
  age: 30,
  address: "المعادي",
  currentMonthlySalary: "8000.00",
  softDeletedAt: null
};
const pagination = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

function makeImage(): File {
  return new File(["x"], "photo.png", { type: "image/png" });
}

describe("employeesApi.list", () => {
  it("GETs /employees forwarding pagination/search/branch/status as query params", async () => {
    let receivedUrl: URL | undefined;
    server.use(
      http.get(apiUrl("/employees"), ({ request }) => {
        receivedUrl = new URL(request.url);
        return HttpResponse.json({ employees: { items: [employee], pagination } });
      })
    );

    const result = await employeesApi.list({
      page: 2,
      pageSize: 10,
      search: "أحمد",
      branchId: 2,
      status: "active"
    });

    expect(receivedUrl?.searchParams.get("page")).toBe("2");
    expect(receivedUrl?.searchParams.get("pageSize")).toBe("10");
    expect(receivedUrl?.searchParams.get("search")).toBe("أحمد");
    expect(receivedUrl?.searchParams.get("branchId")).toBe("2");
    expect(receivedUrl?.searchParams.get("status")).toBe("active");
    expect(result.employees.items).toHaveLength(1);
  });
});

describe("employeesApi.get", () => {
  it("GETs /employees/:id and returns the employee", async () => {
    server.use(http.get(apiUrl("/employees/1"), () => HttpResponse.json({ employee })));

    const result = await employeesApi.get(1);

    expect(result.employee.id).toBe(1);
  });

  it("throws ApiError(404) when the employee is missing", async () => {
    server.use(
      http.get(apiUrl("/employees/999"), () =>
        HttpResponse.json(
          { error: { code: "EMPLOYEE_NOT_FOUND", message: "not found" } },
          { status: 404 }
        )
      )
    );

    await expect(employeesApi.get(999)).rejects.toMatchObject({
      name: "ApiError",
      status: 404
    } satisfies Partial<ApiError>);
  });
});

describe("employeesApi.create", () => {
  // The multipart body is inspected as raw text: undici's form-data parser in
  // Node cannot read a body built from a jsdom File, but serialization (what
  // the browser does) works, so the raw multipart payload is reliable to assert.
  it("POSTs multipart form-data with text fields and the three image files", async () => {
    let contentType: string | null = null;
    let body = "";
    server.use(
      http.post(apiUrl("/employees"), async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.text();
        return HttpResponse.json({ employee }, { status: 201 });
      })
    );

    const result = await employeesApi.create({
      fullName: "أحمد جمال",
      password: "secret12",
      primaryPhone: "01012345678",
      whatsappPhone: "01112345678",
      email: "ahmed@capella.eg",
      branchId: 2,
      age: 30,
      currentMonthlySalary: "8000",
      address: "المعادي",
      personalPhoto: makeImage(),
      idFront: makeImage(),
      idBack: makeImage()
    });

    expect(contentType).toMatch(/multipart\/form-data/);
    expect(body).toContain('name="fullName"');
    expect(body).toContain("أحمد جمال");
    expect(body).toContain('name="branchId"');
    expect(body).toContain('name="personalPhoto"; filename=');
    expect(body).toContain('name="idFront"; filename=');
    expect(body).toContain('name="idBack"; filename=');
    expect(result.employee.id).toBe(1);
  });

  it("omits an undefined email from the form-data", async () => {
    let body = "";
    server.use(
      http.post(apiUrl("/employees"), async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ employee }, { status: 201 });
      })
    );

    await employeesApi.create({
      fullName: "أحمد",
      password: "secret12",
      primaryPhone: "01012345678",
      whatsappPhone: "01112345678",
      branchId: 2,
      age: 30,
      currentMonthlySalary: "8000",
      address: "المعادي",
      personalPhoto: makeImage(),
      idFront: makeImage(),
      idBack: makeImage()
    });

    expect(body).not.toContain('name="email"');
  });
});

describe("employeesApi.update", () => {
  it("PATCHes /employees/:id with a partial JSON payload", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(apiUrl("/employees/1"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ employee: { ...employee, fullName: "محدث" } });
      })
    );

    const result = await employeesApi.update(1, { fullName: "محدث" });

    expect(receivedBody).toEqual({ fullName: "محدث" });
    expect(result.employee.fullName).toBe("محدث");
  });

  it("omits empty-string unchanged sentinels from update JSON", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(apiUrl("/employees/1"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ employee });
      })
    );

    await employeesApi.update(1, { fullName: "أحمد جمال", email: "", password: "" });

    expect(receivedBody).toEqual({ fullName: "أحمد جمال" });
  });
});

describe("employeesApi.remove", () => {
  it("DELETEs /employees/:id and resolves on 204", async () => {
    server.use(http.delete(apiUrl("/employees/1"), () => new HttpResponse(null, { status: 204 })));

    await expect(employeesApi.remove(1)).resolves.toBeUndefined();
  });
});

describe("employeesApi files", () => {
  it("GETs the file list", async () => {
    server.use(
      http.get(apiUrl("/employees/1/files"), () =>
        HttpResponse.json({
          files: [
            { id: 5, fileType: "personal_photo", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
          ]
        })
      )
    );

    const result = await employeesApi.listFiles(1);

    expect(result.files[0]?.fileType).toBe("personal_photo");
  });

  it("PUTs a replacement file as multipart under the 'file' field", async () => {
    let body = "";
    server.use(
      http.put(apiUrl("/employees/1/files/id_front"), async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          file: { id: 6, fileType: "id_front", mimeType: "image/png", fileSizeBytes: 10, replacedAt: null }
        });
      })
    );

    const result = await employeesApi.replaceFile(1, "id_front", makeImage());

    expect(body).toContain('name="file"; filename=');
    expect(result.file.fileType).toBe("id_front");
  });

  it("fetches file content as a Blob", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    server.use(
      http.get(apiUrl("/employees/1/files/5"), () =>
        HttpResponse.arrayBuffer(bytes.buffer, { headers: { "Content-Type": "image/png" } })
      )
    );

    const blob = await employeesApi.fetchFileBlob(1, 5);

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(3);
  });
});

describe("employeesApi branch assignments", () => {
  it("GETs the assignment history", async () => {
    server.use(
      http.get(apiUrl("/employees/1/branch-assignments"), () =>
        HttpResponse.json({
          assignments: [
            {
              id: 3,
              employeeId: 1,
              branchId: 2,
              effectiveFrom: "2026-07-01T00:00:00.000Z",
              effectiveTo: null,
              assignedByAdminId: 1
            }
          ]
        })
      )
    );

    const result = await employeesApi.listAssignments(1);

    expect(result.assignments[0]?.branchId).toBe(2);
  });

  it("POSTs a new assignment as JSON", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(apiUrl("/employees/1/branch-assignments"), async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            assignment: {
              id: 4,
              employeeId: 1,
              branchId: 7,
              effectiveFrom: "2026-08-01T00:00:00.000Z",
              effectiveTo: null,
              assignedByAdminId: 1
            }
          },
          { status: 201 }
        );
      })
    );

    const result = await employeesApi.createAssignment(1, {
      branchId: 7,
      effectiveFrom: "2026-08-01T00:00:00.000Z"
    });

    expect(receivedBody).toEqual({ branchId: 7, effectiveFrom: "2026-08-01T00:00:00.000Z" });
    expect(result.assignment.branchId).toBe(7);
  });
});
