import { type createDatabase } from '@capella/database';

import { createDrizzleWeeklyDayOffRepository } from './weekly-day-off-repository.js';
import {
  createWeeklyDayOffService,
  type WeeklyDayOffFinancialLockCheck,
} from './weekly-day-off-service.js';

export const createWeeklyDayOffModule = (
  database: ReturnType<typeof createDatabase>,
  options: {
    isFinanciallyLocked: WeeklyDayOffFinancialLockCheck;
    timeZone?: string;
    now?: () => Date;
  },
) => {
  const repository = createDrizzleWeeklyDayOffRepository(database, options.now);
  return {
    repository,
    service: createWeeklyDayOffService(repository, options),
  };
};
