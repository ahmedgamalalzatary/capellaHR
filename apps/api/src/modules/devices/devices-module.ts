import type { createDatabase } from '@capella/database';

import {
  createDeviceLifecycle,
  createDeviceLoginEligibility,
  createDrizzleDeviceRepository,
} from './devices-repository.js';
import { createDeviceService, DeviceError } from './devices-service.js';

export const createDevicesModule = (database: ReturnType<typeof createDatabase>) => {
  const repository = createDrizzleDeviceRepository(database);
  const loginEligibility = createDeviceLoginEligibility();
  const service = createDeviceService(repository);
  const verify = async (
    assignment: { assignmentType: 'employee' | 'branch'; assignmentId: number },
    installationMarker: string,
  ) => {
    try {
      const device = await service.verify(assignment, installationMarker);
      return { id: device.id, verified: true as const };
    } catch (error) {
      if (error instanceof DeviceError) return error.deviceId === null
        ? null
        : { id: error.deviceId, verified: false as const };
      throw error;
    }
  };

  return {
    repository,
    service,
    lifecycle: createDeviceLifecycle(database),
    attendanceDevices: { verify },
    personalDevices: {
      async verify(employeeId: number, installationMarker: string) {
        const result = await verify(
          { assignmentType: 'employee', assignmentId: employeeId },
          installationMarker,
        );
        return result?.verified === true ? { id: result.id } : null;
      },
      isActiveEmployeeDevice: loginEligibility.isActiveEmployeeDevice,
    },
  };
};
