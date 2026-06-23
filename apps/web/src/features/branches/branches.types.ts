import type { BranchSetupStatus } from "@capella/shared/contracts";

/** A branch as returned by the API. Mirrors apps/api BranchRecord. */
export type Branch = {
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

/** Cursor-less pagination envelope shared by list endpoints. */
export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type BranchListResponse = {
  branches: {
    items: Branch[];
    pagination: Pagination;
  };
};

export type BranchResponse = {
  branch: Branch;
};

/**
 * Payload the API accepts when creating/updating a branch. The backend takes
 * GPS coordinates as a string-or-number union and treats `setupStatus` as
 * optional, so this is looser than the shared output type `BranchCreateInput`.
 */
export type BranchWritePayload = {
  name: string;
  address: string;
  gpsLatitude: number | string;
  gpsLongitude: number | string;
  gpsRadiusMeters: number;
  allowedIpCidr: string;
};

/** Active device registered to a branch (camera/kiosk). */
export type BranchActiveDevice = {
  id: number;
  deviceToken: string;
  deviceLabel: string | null;
  browserFingerprint: string | null;
  registeredAt: string | null;
};

/** Pending setup link awaiting completion on the device. */
export type BranchPendingSetup = {
  id: number;
  token: string;
  deviceLabel: string | null;
  expiresAt: string;
};

export type BranchDeviceState = {
  branch: Branch;
  activeDevice: BranchActiveDevice | null;
  pendingSetup: BranchPendingSetup | null;
};

export type BranchDeviceResponse = {
  branchDevice: BranchDeviceState;
};
