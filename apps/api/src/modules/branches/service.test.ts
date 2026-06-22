import { describe, expect, it } from "vitest";
import type { BranchCreateInput, BranchSearchInput } from "@capella/shared";
import { createBranchService, type BranchRepository } from "./service";
import type { BranchRecord } from "./repository";

class InMemoryBranchRepository implements BranchRepository {
  branches: BranchRecord[] = [
    {
      id: 1,
      name: "Nasr City",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 100,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: null,
      setupStatus: "completed"
    }
  ];

  async createBranch(input: BranchCreateInput) {
    const branch: BranchRecord = {
      id: this.branches.length + 1,
      name: input.name,
      address: input.address,
      gpsLatitude: input.gpsLatitude,
      gpsLongitude: input.gpsLongitude,
      gpsRadiusMeters: input.gpsRadiusMeters,
      allowedIpCidr: input.allowedIpCidr,
      registeredDeviceToken: null,
      setupStatus: input.setupStatus
    };

    this.branches.push(branch);
    return branch;
  }

  async listBranches(filters: BranchSearchInput) {
    return this.branches.filter((branch) => {
      if (!filters.search) {
        return true;
      }

      return branch.name.toLowerCase().includes(filters.search.toLowerCase());
    });
  }

  async findBranchById(branchId: number) {
    return this.branches.find((branch) => branch.id === branchId) ?? null;
  }

  async updateBranch(branchId: number, input: Partial<BranchCreateInput>) {
    const branch = this.branches.find((item) => item.id === branchId);

    if (!branch) {
      return null;
    }

    Object.assign(branch, Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined)
    ));

    return branch;
  }
}

describe("branch service", () => {
  it("creates a branch", async () => {
    const service = createBranchService({
      repository: new InMemoryBranchRepository()
    });

    const result = await service.createBranch(validBranchInput(), 1);

    expect(result).toEqual({
      id: 2,
      name: "Heliopolis",
      address: "Cairo",
      gpsLatitude: "30.1000000",
      gpsLongitude: "31.3000000",
      gpsRadiusMeters: 150,
      allowedIpCidr: "192.168.10.0/24",
      registeredDeviceToken: null,
      setupStatus: "setup_pending"
    });
  });

  it("lists branches by search term", async () => {
    const service = createBranchService({
      repository: new InMemoryBranchRepository()
    });

    const result = await service.listBranches({
      search: "nasr"
    });

    expect(result).toEqual([
      {
        id: 1,
        name: "Nasr City",
        address: "Cairo",
        gpsLatitude: "30.0500000",
        gpsLongitude: "31.2500000",
        gpsRadiusMeters: 100,
        allowedIpCidr: "192.168.1.0/24",
        registeredDeviceToken: null,
        setupStatus: "completed"
      }
    ]);
  });

  it("returns not found for a missing branch", async () => {
    const service = createBranchService({
      repository: new InMemoryBranchRepository()
    });

    const result = await service.getBranchById(999);

    expect(result).toEqual({
      error: {
        code: "BRANCH_NOT_FOUND",
        message: "Branch not found",
        details: {}
      }
    });
  });

  it("updates an existing branch", async () => {
    const service = createBranchService({
      repository: new InMemoryBranchRepository()
    });

    const result = await service.updateBranch(1, {
      name: "Nasr City Updated",
      gpsRadiusMeters: 200
    }, 1);

    expect(result).toEqual({
      id: 1,
      name: "Nasr City Updated",
      address: "Cairo",
      gpsLatitude: "30.0500000",
      gpsLongitude: "31.2500000",
      gpsRadiusMeters: 200,
      allowedIpCidr: "192.168.1.0/24",
      registeredDeviceToken: null,
      setupStatus: "completed"
    });
  });
});

function validBranchInput(): BranchCreateInput {
  return {
    name: "Heliopolis",
    address: "Cairo",
    gpsLatitude: "30.1000000",
    gpsLongitude: "31.3000000",
    gpsRadiusMeters: 150,
    allowedIpCidr: "192.168.10.0/24",
    setupStatus: "setup_pending"
  };
}
