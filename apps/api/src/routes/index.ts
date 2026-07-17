import { Router } from 'express';

import { createAuthRouter, type AuthService } from '../modules/auth/index.js';
import { createBranchesRouter, type BranchService } from '../modules/branches/index.js';

export const createApiRouter = (dependencies: {
  authService?: AuthService;
  branchService?: BranchService;
  secureCookies?: boolean;
} = {}) => {
  const router = Router();

  if (dependencies.authService) {
    const authOptions = dependencies.secureCookies === undefined
      ? {}
      : { secureCookies: dependencies.secureCookies };
    router.use('/auth', createAuthRouter(dependencies.authService, authOptions));
    if (dependencies.branchService) {
      router.use('/branches', createBranchesRouter(dependencies.branchService, dependencies.authService));
    }
  }

  return router;
};
