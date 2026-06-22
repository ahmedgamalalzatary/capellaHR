import { and, asc, desc, eq, inArray, like, type SQL } from "drizzle-orm";
import type {
  BranchCreateInput,
  BranchSearchInput,
  BranchUpdateInput,
  BranchSetupStatus
} from "@capella/shared";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { branchDeviceRegistrations, branches, branchSetupLinks } from "../../db";

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

export type BranchSetupLinkRecord = {
  id: number;
  branchId: number;
  token: string;
  deviceLabel: string | null;
  status: "active" | "used" | "revoked" | "expired";
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdByAdminId: number;
};

export type BranchDeviceRegistrationRecord = {
  id: number;
  branchId: number;
  deviceToken: string;
  deviceLabel: string | null;
  browserFingerprint: string | null;
  status: "pending" | "active" | "revoked" | "replaced";
  registeredAt: Date | null;
  revokedAt: Date | null;
  replacedAt: Date | null;
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

function mapSetupLinkRecord(row: typeof branchSetupLinks.$inferSelect): BranchSetupLinkRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    token: row.token,
    deviceLabel: row.deviceLabel ?? null,
    status: row.status,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdByAdminId: row.createdByAdminId
  };
}

function mapBranchDeviceRegistrationRecord(
  row: typeof branchDeviceRegistrations.$inferSelect
): BranchDeviceRegistrationRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    deviceToken: row.deviceToken,
    deviceLabel: row.deviceLabel ?? null,
    browserFingerprint: row.browserFingerprint ?? null,
    status: row.status,
    registeredAt: row.registeredAt ?? null,
    revokedAt: row.revokedAt ?? null,
    replacedAt: row.replacedAt ?? null
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
    },

    async findActiveRegistration(branchId: number) {
      const rows = await options.db.select().from(branchDeviceRegistrations).where(
        and(
          eq(branchDeviceRegistrations.branchId, branchId),
          eq(branchDeviceRegistrations.status, "active")
        )
      ).orderBy(desc(branchDeviceRegistrations.id)).limit(1);

      return rows[0] ? mapBranchDeviceRegistrationRecord(rows[0]) : null;
    },

    async findPendingSetupLink(branchId: number) {
      const rows = await options.db.select().from(branchSetupLinks).where(
        and(
          eq(branchSetupLinks.branchId, branchId),
          eq(branchSetupLinks.status, "active")
        )
      ).orderBy(desc(branchSetupLinks.id)).limit(1);

      return rows[0] ? mapSetupLinkRecord(rows[0]) : null;
    },

    async createSetupLink(input: {
      branchId: number;
      token: string;
      deviceLabel?: string;
      expiresAt: Date;
      createdByAdminId: number;
    }) {
      const result = await options.db.insert(branchSetupLinks).values({
        branchId: input.branchId,
        token: input.token,
        deviceLabel: input.deviceLabel ?? null,
        expiresAt: input.expiresAt,
        createdByAdminId: input.createdByAdminId
      });

      const rows = await options.db.select().from(branchSetupLinks).where(eq(branchSetupLinks.id, Number(result[0].insertId))).limit(1);
      return mapSetupLinkRecord(rows[0]!);
    },

    async findPendingSetupLinkByToken(token: string) {
      const rows = await options.db.select().from(branchSetupLinks).where(
        and(
          eq(branchSetupLinks.token, token),
          eq(branchSetupLinks.status, "active")
        )
      ).limit(1);

      return rows[0] ? mapSetupLinkRecord(rows[0]) : null;
    },

    async revokePendingSetupLinks(branchId: number, revokedAt: Date) {
      await options.db.update(branchSetupLinks).set({
        status: "revoked",
        revokedAt
      }).where(
        and(
          eq(branchSetupLinks.branchId, branchId),
          eq(branchSetupLinks.status, "active")
        )
      );
    },

    async activateSetupLink(token: string, input: {
      deviceLabel?: string;
      browserFingerprint: string;
      registeredAt: Date;
    }) {
      return options.db.transaction(async (tx) => {
        const setupLinkRows = await tx.select().from(branchSetupLinks).where(
          and(
            eq(branchSetupLinks.token, token),
            eq(branchSetupLinks.status, "active")
          )
        ).limit(1);
        const setupLink = setupLinkRows[0];

        if (!setupLink) {
          return null;
        }

        const updateResult = await tx.update(branchSetupLinks).set({
          status: "used",
          usedAt: input.registeredAt
        }).where(
          and(
            eq(branchSetupLinks.id, setupLink.id),
            eq(branchSetupLinks.status, "active")
          )
        );

        if (updateResult[0].affectedRows === 0) {
          return null;
        }

        const result = await tx.insert(branchDeviceRegistrations).values({
          branchId: setupLink.branchId,
          deviceToken: token,
          deviceLabel: input.deviceLabel ?? setupLink.deviceLabel ?? null,
          browserFingerprint: input.browserFingerprint,
          status: "active",
          registeredAt: input.registeredAt
        });

        await tx.update(branches).set({
          setupStatus: "completed",
          registeredDeviceToken: token
        }).where(eq(branches.id, setupLink.branchId));

        const rows = await tx.select().from(branchDeviceRegistrations).where(
          eq(branchDeviceRegistrations.id, Number(result[0].insertId))
        ).limit(1);

        return rows[0] ? mapBranchDeviceRegistrationRecord(rows[0]) : null;
      });
    },

    async replaceActiveRegistrations(branchId: number, keepRegistrationId: number, replacedAt: Date) {
      const rows = await options.db.select({ id: branchDeviceRegistrations.id }).from(branchDeviceRegistrations).where(
        and(
          eq(branchDeviceRegistrations.branchId, branchId),
          eq(branchDeviceRegistrations.status, "active")
        )
      );
      const ids = rows.map((row) => row.id).filter((id) => id !== keepRegistrationId);
      if (ids.length === 0) {
        return;
      }

      await options.db.update(branchDeviceRegistrations).set({
        status: "replaced",
        revokedAt: replacedAt,
        replacedAt
      }).where(inArray(branchDeviceRegistrations.id, ids));
    }
  };
}
