import { Router } from 'express';

import { createAuthRouter, type AuthService } from '../modules/auth/index.js';

export const createApiRouter = (dependencies: {
  authService?: AuthService;
  secureCookies?: boolean;
} = {}) => {
  const router = Router();

  if (dependencies.authService) {
    const authOptions = dependencies.secureCookies === undefined
      ? {}
      : { secureCookies: dependencies.secureCookies };
    router.use('/auth', createAuthRouter(dependencies.authService, authOptions));
  }

  return router;
};
