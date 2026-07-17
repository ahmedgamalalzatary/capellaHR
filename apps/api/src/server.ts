import { env } from '@capella/config/server';

import { createApp } from './app.js';

createApp().listen(env.API_PORT);
