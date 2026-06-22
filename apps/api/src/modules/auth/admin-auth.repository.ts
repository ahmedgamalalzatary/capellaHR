import { eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { admins } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");
type Db = MySql2Database<DatabaseSchema>;

export type AdminRecord = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
};

export async function findAdminByEmail(db: Db, email: string): Promise<AdminRecord | null> {
  const rows = await db
    .select({
      id: admins.id,
      name: admins.name,
      email: admins.email,
      passwordHash: admins.passwordHash
    })
    .from(admins)
    .where(eq(admins.email, email.trim().toLowerCase()))
    .limit(1);

  return rows[0] ?? null;
}

export async function findAdminById(db: Db, id: number): Promise<AdminRecord | null> {
  const rows = await db
    .select({
      id: admins.id,
      name: admins.name,
      email: admins.email,
      passwordHash: admins.passwordHash
    })
    .from(admins)
    .where(eq(admins.id, id))
    .limit(1);

  return rows[0] ?? null;
}
