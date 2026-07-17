import { type createDatabase } from '@capella/database';

import { createDrizzleShiftRepository } from './shifts-repository.js';
import { createShiftService } from './shifts-service.js';

export const createShiftsModule = (database: ReturnType<typeof createDatabase>) => {
  const repository = createDrizzleShiftRepository(database);
  return { repository, service: createShiftService(repository) };
};
