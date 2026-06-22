import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { branches, employees, salaryHistory } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

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
      const inserted = await options.db.insert(employees).values({
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

      const employeeId = Number(inserted[0].insertId);

      await options.db.insert(salaryHistory).values({
        employeeId,
        amount: input.currentMonthlySalary,
        effectiveAt: new Date(),
        changedByAdminId: input.createdByAdminId
      });

      const rows = await options.db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);

      if (!rows[0]) {
        throw new Error("Failed to load employee after create");
      }

      return mapEmployeeRecord(rows[0]);
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
