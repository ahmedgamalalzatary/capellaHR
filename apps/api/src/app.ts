import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import type { AuthService } from './modules/auth/index.js';
import { createApiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './shared/http/index.js';

export const createApp = (dependencies: {
  authService?: AuthService;
  secureCookies?: boolean;
  corsOrigin?: string;
} = {}) => {
  const app = express();

  app.use(helmet());
  if (dependencies.corsOrigin) {
    app.use(cors({ origin: dependencies.corsOrigin, credentials: true }));
  }
  app.use(express.json());
  app.use('/api/v1', createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
