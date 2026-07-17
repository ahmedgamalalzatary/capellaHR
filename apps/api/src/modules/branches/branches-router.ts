import {
  branchIdParamsSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { BranchError, type BranchService } from './branches-service.js';
import { responseRequestId } from '../../shared/http/index.js';

const failure = (response: Response, status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) => {
  response.status(status).json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}), requestId: responseRequestId(response) } });
};

const handleError = (error: unknown, response: Response) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof BranchError) {
    const status = error.code === 'BRANCH_NOT_FOUND' ? 404 : 409;
    failure(response, status, error.code, error.message);
    return;
  }
  throw error;
};

export const createBranchesRouter = (
  service: BranchService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);

  router.post('/', async (request: Request, response: Response) => {
    try {
      response.status(201).json({ data: await service.create(createBranchSchema.parse(request.body)) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listBranchesQuerySchema.parse(request.query);
      const result = await service.list(query);
      response.json({ data: result.items, meta: {
        page: query.page, pageSize: query.pageSize, total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      } });
    } catch (error) { handleError(error, response); }
  });

  router.get('/:id', async (request: Request, response: Response) => {
    try { response.json({ data: await service.get(branchIdParamsSchema.parse(request.params).id) }); }
    catch (error) { handleError(error, response); }
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    try {
      const id = branchIdParamsSchema.parse(request.params).id;
      response.json({ data: await service.update(id, updateBranchSchema.parse(request.body)) });
    } catch (error) { handleError(error, response); }
  });

  router.delete('/:id', async (request: Request, response: Response) => {
    try {
      await service.remove(branchIdParamsSchema.parse(request.params).id);
      response.status(204).send();
    } catch (error) { handleError(error, response); }
  });

  return router;
};
