import { Router, type NextFunction, type Request, type Response } from 'express';

import { createAuthMiddleware } from '../auth/index.js';
import type { AuthService } from '../auth/index.js';
import type { DashboardService } from './dashboard-service.js';

export const createDashboardRouter = (
  service: DashboardService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);
  router.get('/', async (_request: Request, response: Response, next: NextFunction) => {
    try {
      response.json({ data: await service.getSnapshot() });
    } catch (error) {
      next(error);
    }
  });
  return router;
};
