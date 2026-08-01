import {
  clientIdParamsSchema,
  createClientSchema,
  findClientByPhoneQuerySchema,
  listClientsQuerySchema,
  updateClientSchema,
} from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { responseRequestId } from '../../../shared/http/index.js';
import { ClientError, type ClientService } from './clients-service.js';

const failure = (
  response: Response,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) => {
  response.status(status).json({
    error: { code, message, ...extra, requestId: responseRequestId(response) },
  });
};

const BRANCH_ERROR_STATUS: Record<string, number> = {
  ERP_BRANCH_REQUIRED: 400,
  ERP_BRANCH_NOT_FOUND: 404,
  ERP_CASHIER_EMPLOYEE_UNAVAILABLE: 403,
  ERP_BRANCH_FORBIDDEN: 403,
};

const handleError = (error: unknown, response: Response) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors });
    return;
  }
  if (error instanceof ClientError) {
    failure(
      response,
      error.code === 'CLIENT_NOT_FOUND' ? 404 : 409,
      error.code,
      error.message,
      // Lets the counter continue with the client that already holds the number.
      error.existingClientId === undefined ? undefined : { existingClientId: error.existingClientId },
    );
    return;
  }
  if (error instanceof ErpBranchContextError) {
    failure(response, BRANCH_ERROR_STATUS[error.code] ?? 403, error.code, error.message);
    return;
  }
  throw error;
};

/**
 * Authentication is mounted by the composition root; the router only translates
 * its result. Resolving which branch the account acts on belongs to the service.
 */
const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) {
    throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء');
  }
  return actor;
};

export const createErpClientsRouter = (service: ClientService) => {
  const router = Router();

  router.post('/', async (request: Request, response: Response) => {
    try {
      const input = createClientSchema.parse(request.body);
      response.status(201).json({ data: await service.create(actorFrom(response), input) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listClientsQuerySchema.parse(request.query);
      const result = await service.list(actorFrom(response), query);
      response.json({
        data: result.items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) { handleError(error, response); }
  });

  // Declared before `/:id` so the literal path is not parsed as an identifier.
  router.get('/by-phone', async (request: Request, response: Response) => {
    try {
      const query = findClientByPhoneQuerySchema.parse(request.query);
      const client = await service.findByPhone(actorFrom(response), query.phone, query.branchId);
      response.json({ data: client });
    } catch (error) { handleError(error, response); }
  });

  router.get('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = clientIdParamsSchema.parse(request.params);
      const branchId = request.query.branchId === undefined
        ? undefined
        : listClientsQuerySchema.parse(request.query).branchId;
      response.json({ data: await service.get(actorFrom(response), id, branchId) });
    } catch (error) { handleError(error, response); }
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = clientIdParamsSchema.parse(request.params);
      const input = updateClientSchema.parse(request.body);
      response.json({ data: await service.update(actorFrom(response), id, input) });
    } catch (error) { handleError(error, response); }
  });

  return router;
};
