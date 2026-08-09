import { assertEditionProfile, resolveEdition } from '@capella/config/edition';
import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';
import { sql } from 'drizzle-orm';

import { createApp } from './app.js';
import { createApiRuntime } from './runtime/api-runtime.js';
import { createApiLogger } from './shared/http/index.js';

const edition = assertEditionProfile(resolveEdition(env.EDITION), env.COMPOSE_PROFILES);
const database = createDatabase(env.DATABASE_URL);
const logger = createApiLogger(env.LOG_LEVEL);
const runtime = createApiRuntime({
  database,
  edition,
  logger,
  timeZone: env.APP_TIME_ZONE,
  maxEmployeeImageBytes: env.MAX_EMPLOYEE_IMAGE_BYTES,
  ...(env.REPORT_FILES_ROOT === undefined ? {} : { reportFilesRoot: env.REPORT_FILES_ROOT }),
});

await runtime.initialize({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });

createApp({
  ...runtime.dependencies,
  publicConfig: { timeZone: env.APP_TIME_ZONE, locale: env.APP_LOCALE },
  secureCookies: env.NODE_ENV === 'production',
  corsOrigins: env.DEV_CORS_ORIGINS,
  publicOrigins: env.PUBLIC_ORIGINS,
  enforceSameOrigin: true,
  allowHostOriginFallback: env.NODE_ENV === 'development',
  ...(env.TRUST_PROXY_HOPS === undefined ? {} : { trustProxyHops: env.TRUST_PROXY_HOPS }),
  readinessCheck: async () => {
    await database.execute(sql`SELECT 1`);
  },
  logger,
}).listen(env.API_PORT, () => {
  logger.info(
    { port: env.API_PORT, edition: edition.edition, modules: edition.modules },
    'API server started',
  );
});
