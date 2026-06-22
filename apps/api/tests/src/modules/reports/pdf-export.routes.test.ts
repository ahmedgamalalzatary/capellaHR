import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../../../src/app";
import { createInMemoryAuthRepository } from "../../../../src/modules/auth/repository";
import { createAuthService } from "../../../../src/modules/auth/service";
import { createPdfExportService } from "../../../../src/modules/reports/pdf-export.service";

describe("reports pdf export routes", () => {
  it("returns unauthorized without an admin session", async () => {
    const app = createApp({
      pdfExportService: createPdfExportService({
        renderer: {
          async render() {
            return Buffer.from("pdf");
          }
        },
        employeeService: {
          async listEmployees() {
            return [];
          }
        },
        attendanceService: {
          async listAdminAttendance() {
            return [];
          }
        },
        reportsService: {
          async getMonthlyAttendanceSummary() {
            return [];
          }
        }
      })
    });

    const response = await request(app).get("/reports/employees/export.pdf");

    expect(response.status).toBe(401);
  });

  it("returns an employee pdf export for admins", async () => {
    const app = createApp({
      authService: createAdminAuthService(),
      pdfExportService: createPdfExportService({
        renderer: {
          async render() {
            return Buffer.from("employees-pdf", "utf8");
          }
        },
        employeeService: {
          async listEmployees() {
            return [
              {
                id: 1,
                fullName: "Mina Adel",
                primaryPhone: "01012345678",
                whatsappPhone: "01012345678",
                email: null,
                branchId: 2,
                age: 28,
                address: "Nasr City",
                currentMonthlySalary: "6500",
                softDeletedAt: null
              }
            ];
          }
        },
        attendanceService: {
          async listAdminAttendance() {
            return [];
          }
        },
        reportsService: {
          async getMonthlyAttendanceSummary() {
            return [];
          }
        }
      })
    });
    const cookieHeader = await signInAdmin(app);

    const response = await request(app)
      .get("/reports/employees/export.pdf")
      .set("Cookie", cookieHeader)
      .buffer(true)
      .parse(binaryParser as unknown as (response: unknown, callback: (error: Error | null, body: Buffer) => void) => void);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("employees.pdf");
    expect(response.body).toEqual(Buffer.from("employees-pdf", "utf8"));
  });
});

function createAdminAuthService() {
  return createAuthService({
    repository: createInMemoryAuthRepository({
      bootstrapAdmin: {
        name: "Capella Admin",
        email: "admin@capella.eg",
        password: "admin1234"
      }
    }),
    adminSessionTtlHours: 8,
    employeeSessionTtlHours: 12
  });
}

async function signInAdmin(app: ReturnType<typeof createApp>) {
  const response = await request(app).post("/auth/admin/sign-in").send({
    email: "admin@capella.eg",
    password: "admin1234"
  });

  return response.headers["set-cookie"];
}

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void
) {
  const chunks: Buffer[] = [];

  response.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
  response.on("error", (error: Error) => {
    callback(error, Buffer.alloc(0));
  });
}
