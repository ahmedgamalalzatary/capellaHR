import express from 'express';

import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './shared/http/index.js';

export const createApp = () => {
  const app = express();

  app.use(express.json());
  app.use('/api/v1', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
