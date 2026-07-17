import { drizzle } from 'drizzle-orm/mysql2';

import * as schema from './schema/index.js';

export const createDatabase = (connectionUrl: string) => drizzle(connectionUrl, { schema, mode: 'default' });
