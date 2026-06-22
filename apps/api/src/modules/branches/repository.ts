import { asc, eq, like, type SQL } from "drizzle-orm";
import type { BranchCreateInput, BranchSearchInput, BranchUpdateInput, BranchSetupStatus } from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { branches } from "../../db";

type DatabaseSchema = typeof import("../../db/schema");

export type BranchRecord = {
  id: number;
  name: string;
  address: string;
  gpsLatitude: string;
  gpsLongitude: string;
  gpsRadiusMeters: number;
  allowedIpCidr: string;
  registeredDeviceToken: string | null;
  setupStatus: BranchSetupStatus;
};

type CreateDrizzleBranchRepositoryOptions = {
  db: MySql2Database<DatabaseSchema>;
};

function mapBranchRecord(row: typeof branches.$inferSelect): BranchRecord {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    gpsLatitude: String(row.gpsLatitude),
    gpsLongitude: String(row.gpsLongitude),
    gpsRadiusMeters: row.gpsRadiusMeters,
    allowedIpCidr: row.allowedIpCidr,
    registeredDeviceToken: row.registeredDeviceToken ?? null,
    setupStatus: row.setupStatus
  };
}

export function createDrizzleBranchRepository(options: CreateDrizzleBranchRepositoryOptions) {
  return {
    async createBranch(input: BranchCreateInput) {
      const result = await options.db.insert(branches).values({
        name: input.name,
        address: input.address,
        gpsLatitude: input.gpsLatitude,
        gpsLongitude: input.gpsLongitude,
        gpsRadiusMeters: input.gpsRadiusMeters,
        allowedIpCidr: input.allowedIpCidr,
        setupStatus: input.setupStatus
      });

      const rows = await options.db.select().from(branches).where(eq(branches.id, Number(result[0].insertId))).limit(1);

      return mapBranchRecord(rows[0]!);
    },

    async listBranches(filters: BranchSearchInput) {
      const whereClauses: SQL[] = [];

      if (filters.search) {
        whereClauses.push(like(branches.name, `%${filters.search}%`));
      }

      const rows = await options.db.select().from(branches)
        .where(whereClauses[0])
        .orderBy(asc(branches.name));

      return rows.map(mapBranchRecord);
    },

    async findBranchById(branchId: number) {
      const rows = await options.db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
      return rows[0] ? mapBranchRecord(rows[0]) : null;
    },

    async updateBranch(branchId: number, input: BranchUpdateInput) {
      const updates = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(updates).length === 0) {
        return this.findBranchById(branchId);
      }

      const result = await options.db.update(branches).set(updates).where(eq(branches.id, branchId));

      if (result[0].affectedRows === 0) {
        return null;
      }

      return this.findBranchById(branchId);
    }
  };
}
