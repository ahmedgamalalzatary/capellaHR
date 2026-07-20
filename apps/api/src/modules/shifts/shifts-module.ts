import { type createDatabase } from '@capella/database';

import { createDrizzleShiftRepository } from './shifts-repository.js';
import { createShiftService, type ShiftBeforeDurationChange } from './shifts-service.js';

export const createShiftsModule = (
  database: ReturnType<typeof createDatabase>,
  options: { beforeDurationChange?: ShiftBeforeDurationChange } = {},
) => {
  const repository = createDrizzleShiftRepository(
    database,
    () => new Date(),
    options.beforeDurationChange,
  );
  return { repository, service: createShiftService(repository) };
};
