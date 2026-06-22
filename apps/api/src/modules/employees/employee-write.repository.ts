import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { employees, salaryHistory } from "../../db";
import { type EmployeeConflictResult, mapDuplicateKeyError } from "./employee-conflict-mapper";
import { type EmployeeRecord, mapEmployeeRecord } from "./employee-mappers";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export type CreateEmployeeInput = {
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

export type UpdateEmployeeInput = Partial<Omit<CreateEmployeeInput, "createdByAdminId">>;

export async function createEmployee(db: Db, input: CreateEmployeeInput): Promise<EmployeeRecord | EmployeeConflictResult> {
  try {
    await db.insert(employees).values({
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

    const insertedRows = await db
      .select()
      .from(employees)
      .where(eq(employees.primaryPhone, input.primaryPhone))
      .limit(1);

    if (!insertedRows[0]) {
      throw new Error("Failed to load employee after create");
    }

    await db.insert(salaryHistory).values({
      employeeId: insertedRows[0].id,
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
}

export async function updateEmployee(
  db: Db,
  employeeId: number,
  input: UpdateEmployeeInput,
  updatedByAdminId: number
): Promise<EmployeeRecord | EmployeeConflictResult | null> {
  const existingRows = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!existingRows[0]) {
    return null;
  }

  try {
    await db.update(employees).set({
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
    Number(existingRows[0].currentMonthlySalary) !== Number(input.currentMonthlySalary)
  ) {
    await db.insert(salaryHistory).values({
      employeeId: existingRows[0].id,
      amount: input.currentMonthlySalary,
      effectiveAt: new Date(),
      changedByAdminId: updatedByAdminId
    });
  }

  const updatedRows = await db
    .select()
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  if (!updatedRows[0]) {
    throw new Error("Failed to load employee after update");
  }

  return mapEmployeeRecord(updatedRows[0]);
}

export async function softDeleteEmployee(db: Db, employeeId: number) {
  const result = await db
    .update(employees)
    .set({
      softDeletedAt: new Date()
    })
    .where(eq(employees.id, employeeId));

  return result[0].affectedRows > 0;
}
