import { env } from '@capella/config/server';
import { createDatabase } from '@capella/database';

import { createApp } from './app.js';
import { createAuthModule } from './modules/auth/index.js';

const database = createDatabase(env.DATABASE_URL);
const auth = createAuthModule({
  database,
  admin: { email: env.ADMIN_EMAIL, passwordHash: env.ADMIN_PASSWORD_HASH },
});

createApp({
  authService: auth.service,
  secureCookies: env.NODE_ENV === 'production',
  corsOrigin: env.WEB_ORIGIN,
}).listen(env.API_PORT);
