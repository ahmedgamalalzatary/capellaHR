import { and, asc, eq, isNotNull, isNull, like, type SQL } from "drizzle-orm";
import type { EmployeeListFilterInput } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { branches, employees, salaryHistory } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");
export type EmployeeConflictField = "primary_phone" | "whatsapp_phone" | "email";
export type EmployeeConflictResult = {
  error: {
    code: "EMPLOYEE_CONFLICT";
    field: EmployeeConflictField;
  };
};

export type EmployeeRecord = {
  id: number;
  fullName: string;
  passwordHash: string;
  primaryPhone: string;
  whatsappPhone: string;
  email: string | null;
  branchId: number | null;
  age: number;
  address: string;
  currentMonthlySalary: string;
  softDeletedAt: Date | null;
};

type CreateEmployeeInput = {
  fullName: string;
  passwordHash: string;
  primaryPhone: string;
  whatsappPhone: string;
  email?: string;
  branchId: number;
  age: number;
  address: string;
  currentMonthlySalary: string;
  createdByAdminId: number;
};

type UpdateEmployeeInput = Partial<Omit<CreateEmployeeInput, "createdByAdminId">>;

type CreateDrizzleEmployeeRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function mapEmployeeRecord(row: typeof employees.$inferSelect): EmployeeRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    passwordHash: row.passwordHash,
    primaryPhone: row.primaryPhone,
    whatsappPhone: row.whatsappPhone,
    email: row.email ?? null,
    branchId: row.branchId ?? null,
    age: row.age,
    address: row.address,
    currentMonthlySalary: String(row.currentMonthlySalary),
    softDeletedAt: row.softDeletedAt ?? null
  };
}

function mapDuplicateKeyError(error: unknown): EmployeeConflictResult | null {
  const duplicateKeyMessage = findMysqlDuplicateKeyMessage(error);

  if (!duplicateKeyMessage) {
    return null;
  }

  if (duplicateKeyMessage.includes("employees_primary_phone_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "primary_phone"
      }
    };
  }

  if (duplicateKeyMessage.includes("employees_whatsapp_phone_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "whatsapp_phone"
      }
    };
  }

  if (duplicateKeyMessage.includes("employees_email_uq")) {
    return {
      error: {
        code: "EMPLOYEE_CONFLICT",
        field: "email"
      }
    };
  }

  return null;
}

function findMysqlDuplicateKeyMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    sqlMessage?: unknown;
    cause?: unknown;
  };

  if (maybeError.code === "ER_DUP_ENTRY") {
    if (typeof maybeError.sqlMessage === "string") {
      return maybeError.sqlMessage;
    }

    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return findMysqlDuplicateKeyMessage(maybeError.cause);
}

export function createDrizzleEmployeeRepository(options: CreateDrizzleEmployeeRepositoryOptions) {
  return {
    async findBranchSetupStatus(branchId: number) {
      const rows = await options.db
        .select({
          setupStatus: branches.setupStatus
        })
        .from(branches)
        .where(eq(branches.id, branchId))
        .limit(1);

      return rows[0]?.setupStatus ?? null;
    },

    async createEmployee(input: CreateEmployeeInput) {
      try {
        await options.db.insert(employees).values({
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          primaryPhone: input.primaryPhone,
          whatsappPhone: input.whatsappPhone,
          email: input.email,
          branchId: input.branchId,
          age: input.age,
          address: input.address,
          currentMonthlySalary: input.currentMonthlySalary
        });

        const insertedRows = await options.db
          .select()
          .from(employees)
          .where(eq(employees.primaryPhone, input.primaryPhone))
          .limit(1);

        if (!insertedRows[0]) {
          throw new Error("Failed to load employee after create");
        }

        const employeeId = insertedRows[0].id;

        await options.db.insert(salaryHistory).values({
          employeeId,
          amount: input.currentMonthlySalary,
          effectiveAt: new Date(),
          changedByAdminId: input.createdByAdminId
        });

        return mapEmployeeRecord(insertedRows[0]);
      } catch (error) {
        const conflict = mapDuplicateKeyError(error);

        if (conflict) {
          return conflict;
        }

        throw error;
      }
    },

    async updateEmployee(employeeId: number, input: UpdateEmployeeInput, updatedByAdminId: number) {
      const existingRows = await options.db
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!existingRows[0]) {
        return null;
      }

      try {
        await options.db.update(employees).set({
          fullName: input.fullName,
          passwordHash: input.passwordHash,
          primaryPhone: input.primaryPhone,
          whatsappPhone: input.whatsappPhone,
          email: input.email,
          branchId: input.branchId,
          age: input.age,
          address: input.address,
          currentMonthlySalary: input.currentMonthlySalary
        }).where(eq(employees.id, employeeId));
      } catch (error) {
        const conflict = mapDuplicateKeyError(error);

        if (conflict) {
          return conflict;
        }

        throw error;
      }

      if (
        input.currentMonthlySalary &&
        String(existingRows[0].currentMonthlySalary) !== String(input.currentMonthlySalary)
      ) {
        await options.db.insert(salaryHistory).values({
          employeeId,
          amount: input.currentMonthlySalary,
          effectiveAt: new Date(),
          changedByAdminId: updatedByAdminId
        });
      }

      const updatedRows = await options.db
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      if (!updatedRows[0]) {
        throw new Error("Failed to load employee after update");
      }

      return mapEmployeeRecord(updatedRows[0]);
    },

    async listEmployees(filters: EmployeeListFilterInput) {
      const conditions: SQL[] = [];

      if (filters.search) {
        conditions.push(like(employees.fullName, `%${filters.search}%`));
      }

      if (typeof filters.branchId === "number") {
        conditions.push(eq(employees.branchId, filters.branchId));
      }

      if (filters.status === "active") {
        conditions.push(isNull(employees.softDeletedAt));
      }

      if (filters.status === "soft_deleted") {
        conditions.push(isNotNull(employees.softDeletedAt));
      }

      const query = options.db.select().from(employees).orderBy(asc(employees.fullName));
      const rows = conditions.length === 0
        ? await query
        : await query.where(and(...conditions));

      return rows.map(mapEmployeeRecord);
    },

    async findEmployeeById(employeeId: number) {
      const rows = await options.db
        .select()
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);

      return rows[0] ? mapEmployeeRecord(rows[0]) : null;
    },

    async softDeleteEmployee(employeeId: number) {
      const result = await options.db
        .update(employees)
        .set({
          softDeletedAt: new Date()
        })
        .where(eq(employees.id, employeeId));

      return result[0].affectedRows > 0;
    }
  };
}
