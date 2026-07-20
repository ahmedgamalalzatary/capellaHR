import type { createDatabase } from '@capella/database';

import {
  createDeviceLifecycle,
  createDeviceLoginEligibility,
  createDrizzleDeviceRepository,
} from './devices-repository.js';
import {
  createDeviceService,
  DeviceError,
  type WebAuthnProvider,
} from './devices-service.js';

export const createDevicesModule = (
  database: ReturnType<typeof createDatabase>,
  webauthn: WebAuthnProvider,
) => {
  const repository = createDrizzleDeviceRepository(database);
  const loginEligibility = createDeviceLoginEligibility();
  const service = createDeviceService(repository, webauthn);
  const beginAuthentication = async (
    assignment: { assignmentType: 'employee' | 'branch'; assignmentId: number },
    installationMarker: string,
  ) => {
    try {
      return await service.beginAuthentication(assignment, installationMarker);
    } catch (error) {
      if (error instanceof DeviceError) return null;
      throw error;
    }
  };
  const verify = async (
    assignment: { assignmentType: 'employee' | 'branch'; assignmentId: number },
    proof: Parameters<typeof service.verify>[1],
  ) => {
    try {
      const device = await service.verify(assignment, proof);
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
    attendanceDevices: { beginAuthentication, verify },
    personalDevices: {
      beginAuthentication(employeeId: number, installationMarker: string) {
        return beginAuthentication(
          { assignmentType: 'employee', assignmentId: employeeId },
          installationMarker,
        );
      },
      async verify(employeeId: number, proof: Parameters<typeof service.verify>[1]) {
        const result = await verify(
          { assignmentType: 'employee', assignmentId: employeeId },
          proof,
        );
        return result?.verified === true ? { id: result.id } : null;
      },
      isActiveEmployeeDevice: loginEligibility.isActiveEmployeeDevice,
    },
  };
};
