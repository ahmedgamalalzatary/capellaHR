import { type createDatabase } from '@capella/database';

import { createDrizzleAdvanceRepository } from './advances-repository.js';
import { createAdvanceService } from './advances-service.js';

export const createAdvanceModule = (
  database: ReturnType<typeof createDatabase>,
  options: { now?: () => Date; timeZone?: string } = {},
) => {
  const repository = createDrizzleAdvanceRepository(database, options);
  const service = createAdvanceService(repository);
  return {
    repository,
    service,
    lifecycle: {
      prepareEmployeeDeletion: (employeeId: number, deletedAt: Date, context?: unknown) => {
        if (!context) throw new Error('Advance deletion lifecycle requires a transaction context');
        return service.accelerateForDeletion(employeeId, deletedAt, context);
      },
    },
  };
};
