import { and, asc, eq, isNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { employeeFiles } from "../../db";
import { mapEmployeeFileRecord } from "./employee-mappers";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;
type EmployeeFileType = "personal_photo" | "id_front" | "id_back";

export async function insertEmployeeFiles(db: Db, employeeId: number, files: Array<{
  fileType: EmployeeFileType;
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
}>) {
  if (files.length === 0) {
    return [];
  }

  await db.insert(employeeFiles).values(
    files.map((file) => ({
      employeeId,
      fileType: file.fileType,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes
    }))
  );

  const rows = await db
    .select()
    .from(employeeFiles)
    .where(eq(employeeFiles.employeeId, employeeId));

  return rows
    .filter((row) => files.some((file) => file.storagePath === row.storagePath))
    .map(mapEmployeeFileRecord);
}

export async function listEmployeeFiles(db: Db, employeeId: number) {
  const rows = await db
    .select()
    .from(employeeFiles)
    .where(and(
      eq(employeeFiles.employeeId, employeeId),
      isNull(employeeFiles.replacedAt)
    ))
    .orderBy(asc(employeeFiles.id));

  return rows.map(mapEmployeeFileRecord);
}

export async function findEmployeeFileById(db: Db, employeeId: number, fileId: number) {
  const rows = await db
    .select()
    .from(employeeFiles)
    .where(and(
      eq(employeeFiles.employeeId, employeeId),
      eq(employeeFiles.id, fileId)
    ))
    .limit(1);

  return rows[0] ? mapEmployeeFileRecord(rows[0]) : null;
}

export async function replaceEmployeeFile(db: Db, employeeId: number, fileType: EmployeeFileType, file: {
  storagePath: string;
  mimeType: string;
  fileSizeBytes: number;
}) {
  return db.transaction(async (tx) => {
    const activeRows = await tx
      .select()
      .from(employeeFiles)
      .where(and(
        eq(employeeFiles.employeeId, employeeId),
        eq(employeeFiles.fileType, fileType),
        isNull(employeeFiles.replacedAt)
      ))
      .limit(1);

    if (!activeRows[0]) {
      return null;
    }

    await tx
      .update(employeeFiles)
      .set({
        replacedAt: new Date()
      })
      .where(eq(employeeFiles.id, activeRows[0].id));

    await tx.insert(employeeFiles).values({
      employeeId,
      fileType,
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      fileSizeBytes: file.fileSizeBytes
    });

    const rows = await tx
      .select()
      .from(employeeFiles)
      .where(and(
        eq(employeeFiles.employeeId, employeeId),
        eq(employeeFiles.storagePath, file.storagePath)
      ))
      .limit(1);

    return rows[0] ? mapEmployeeFileRecord(rows[0]) : null;
  });
}
