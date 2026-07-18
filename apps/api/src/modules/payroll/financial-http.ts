import { type Request, type Response, Router } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';

export const financialFail = (
  response: Response,
  status: number,
  code: string,
  message: string,
  extras: Record<string, unknown> = {},
) => response.status(status).json({
  error: { code, message, ...extras, requestId: responseRequestId(response) },
});

export const handleFinancialValidation = (error: unknown, response: Response) => {
  if (!(error instanceof ZodError)) return false;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join('.') || '_root';
    (fieldErrors[field] ??= []).push(issue.message);
  }
  financialFail(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors });
  return true;
};

type CrudService<Create, Update, Query> = {
  create(input: Create): Promise<unknown>;
  get(id: number): Promise<unknown>;
  list(query: Query): Promise<{ items: unknown[]; total: number }>;
  update(id: number, input: Update): Promise<unknown>;
  remove(id: number): Promise<void>;
};

export const createFinancialCrudRouter = <
  Create,
  Update,
  Query extends { page: number; pageSize: number },
  Params extends Record<string, number>,
>(
  service: CrudService<Create, Update, Query>,
  authService: Pick<AuthService, 'authenticate'>,
  schemas: {
    create: ZodType<Create, ZodTypeDef, unknown>;
    update: ZodType<Update, ZodTypeDef, unknown>;
    query: ZodType<Query, ZodTypeDef, unknown>;
    params: ZodType<Params, ZodTypeDef, unknown>;
    recordPath: string;
    id: (params: Params) => number;
  },
  handleDomainError: (error: unknown, response: Response) => boolean,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);
  const handle = (error: unknown, response: Response) => {
    if (handleFinancialValidation(error, response) || handleDomainError(error, response)) return;
    throw error;
  };

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = schemas.query.parse(request.query);
      const result = await service.list(query);
      response.json({
        data: result.items,
        meta: {
          page: query.page, pageSize: query.pageSize, total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) { handle(error, response); }
  });
  router.post('/', async (request: Request, response: Response) => {
    try { response.status(201).json({ data: await service.create(schemas.create.parse(request.body)) }); }
    catch (error) { handle(error, response); }
  });
  router.get(schemas.recordPath, async (request: Request, response: Response) => {
    try { const params = schemas.params.parse(request.params); response.json({ data: await service.get(schemas.id(params)) }); }
    catch (error) { handle(error, response); }
  });
  router.patch(schemas.recordPath, async (request: Request, response: Response) => {
    try {
      const params = schemas.params.parse(request.params);
      response.json({ data: await service.update(schemas.id(params), schemas.update.parse(request.body)) });
    } catch (error) { handle(error, response); }
  });
  router.delete(schemas.recordPath, async (request: Request, response: Response) => {
    try { const params = schemas.params.parse(request.params); await service.remove(schemas.id(params)); response.status(204).end(); }
    catch (error) { handle(error, response); }
  });
  return router;
};
