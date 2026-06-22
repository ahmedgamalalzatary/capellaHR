import { and, desc, eq, inArray } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { employeeDeviceRegistrations, employees } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

export type EmployeeDeviceRegistrationRecord = {
  id: number;
  employeeId: number;
  deviceToken: string;
  deviceLabel: string | null;
  browserFingerprint: string | null;
  status: "pending" | "active" | "revoked" | "replaced";
  registeredAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

type CreateDrizzleEmployeeDeviceRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function mapRegistrationRecord(
  row: typeof employeeDeviceRegistrations.$inferSelect
): EmployeeDeviceRegistrationRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    deviceToken: row.deviceToken,
    deviceLabel: row.deviceLabel ?? null,
    browserFingerprint: row.browserFingerprint ?? null,
    status: row.status,
    registeredAt: row.registeredAt ?? null,
    revokedAt: row.revokedAt ?? null,
    expiresAt: row.expiresAt ?? null
  };
}

export function createDrizzleEmployeeDeviceRepository(
  options: CreateDrizzleEmployeeDeviceRepositoryOptions
) {
  return {
    async findEmployeeById(employeeId: number) {
      const rows = await options.db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      return rows[0] ?? null;
    },

    async findActiveRegistration(employeeId: number) {
      const rows = await options.db
        .select()
        .from(employeeDeviceRegistrations)
        .where(
          and(
            eq(employeeDeviceRegistrations.employeeId, employeeId),
            eq(employeeDeviceRegistrations.status, "active")
          )
        )
        .orderBy(desc(employeeDeviceRegistrations.id))
        .limit(1);

      return rows[0] ? mapRegistrationRecord(rows[0]) : null;
    },

    async findPendingRegistration(employeeId: number) {
      const rows = await options.db
        .select()
        .from(employeeDeviceRegistrations)
        .where(
          and(
            eq(employeeDeviceRegistrations.employeeId, employeeId),
            eq(employeeDeviceRegistrations.status, "pending")
          )
        )
        .orderBy(desc(employeeDeviceRegistrations.id))
        .limit(1);

      return rows[0] ? mapRegistrationRecord(rows[0]) : null;
    },

    async createPendingRegistration(input: {
      employeeId: number;
      deviceToken: string;
      deviceLabel?: string;
      expiresAt: Date;
    }) {
      const result = await options.db.insert(employeeDeviceRegistrations).values({
        employeeId: input.employeeId,
        deviceToken: input.deviceToken,
        deviceLabel: input.deviceLabel,
        status: "pending",
        expiresAt: input.expiresAt
      });

      const rows = await options.db
        .select()
        .from(employeeDeviceRegistrations)
        .where(eq(employeeDeviceRegistrations.id, Number(result[0].insertId)))
        .limit(1);

      return mapRegistrationRecord(rows[0]!);
    },

    async findPendingRegistrationByToken(deviceToken: string) {
      const rows = await options.db
        .select()
        .from(employeeDeviceRegistrations)
        .where(
          and(
            eq(employeeDeviceRegistrations.deviceToken, deviceToken),
            eq(employeeDeviceRegistrations.status, "pending")
          )
        )
        .limit(1);

      return rows[0] ? mapRegistrationRecord(rows[0]) : null;
    },

    async revokePendingRegistrations(employeeId: number, revokedAt: Date) {
      await options.db
        .update(employeeDeviceRegistrations)
        .set({
          status: "revoked",
          revokedAt,
          expiresAt: null
        })
        .where(
          and(
            eq(employeeDeviceRegistrations.employeeId, employeeId),
            eq(employeeDeviceRegistrations.status, "pending")
          )
        );
    },

    async activatePendingRegistration(
      registrationId: number,
      input: {
        deviceLabel?: string;
        browserFingerprint: string;
        registeredAt: Date;
      }
    ) {
      await options.db
        .update(employeeDeviceRegistrations)
        .set({
          status: "active",
          deviceLabel: input.deviceLabel,
          browserFingerprint: input.browserFingerprint,
          registeredAt: input.registeredAt,
          expiresAt: null
        })
        .where(
          and(
            eq(employeeDeviceRegistrations.id, registrationId),
            eq(employeeDeviceRegistrations.status, "pending")
          )
        );

      const rows = await options.db
        .select()
        .from(employeeDeviceRegistrations)
        .where(eq(employeeDeviceRegistrations.id, registrationId))
        .limit(1);

      if (!rows[0] || rows[0].status !== "active") {
        return null;
      }

      return mapRegistrationRecord(rows[0]);
    },

    async replaceActiveRegistrations(
      employeeId: number,
      keepRegistrationId: number,
      replacedAt: Date
    ) {
      const rows = await options.db
        .select({ id: employeeDeviceRegistrations.id })
        .from(employeeDeviceRegistrations)
        .where(
          and(
            eq(employeeDeviceRegistrations.employeeId, employeeId),
            eq(employeeDeviceRegistrations.status, "active")
          )
        );

      const ids = rows
        .map((row) => row.id)
        .filter((id) => id !== keepRegistrationId);

      if (ids.length === 0) {
        return;
      }

      await options.db
        .update(employeeDeviceRegistrations)
        .set({
          status: "replaced",
          revokedAt: replacedAt
        })
        .where(inArray(employeeDeviceRegistrations.id, ids));
    },

    async revokeDeviceAccess(employeeId: number, revokedAt: Date) {
      const result = await options.db
        .update(employeeDeviceRegistrations)
        .set({
          status: "revoked",
          revokedAt,
          expiresAt: null
        })
        .where(
          and(
            eq(employeeDeviceRegistrations.employeeId, employeeId),
            inArray(employeeDeviceRegistrations.status, ["pending", "active"])
          )
        );

      return result[0].affectedRows > 0;
    }
  };
}
