import { type createDatabase } from '@capella/database';

import { createDrizzleBonusRepository } from './bonuses-repository.js';
import { createBonusService } from './bonuses-service.js';

export const createBonusModule = (
  database: ReturnType<typeof createDatabase>,
  options: { now?: () => Date; timeZone?: string } = {},
) => {
  const repository = createDrizzleBonusRepository(database, options);
  return { repository, service: createBonusService(repository) };
};
