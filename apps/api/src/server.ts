import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';

const database = createDatabase(env.DATABASE_URL);
const auth = createAuthModule({
  database,
});
await auth.initializeAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD });

createApp({
  authService: auth.service,
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
}).listen(env.API_PORT);
