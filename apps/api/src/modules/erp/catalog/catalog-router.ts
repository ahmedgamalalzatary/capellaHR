import {
  categoryIdParamsSchema,
  createCategorySchema,
  createServiceSchema,
  listCategoriesQuerySchema,
  listServicesQuerySchema,
  serviceCommissionOverrideParamsSchema,
  serviceIdParamsSchema,
  setServiceCommissionOverrideSchema,
  updateCategorySchema,
  updateServiceSchema,
} from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { CatalogError, type CatalogErrorCode } from './catalog-errors.js';
import type { CategoryService } from './categories-service.js';
import type { ServiceCatalogService } from './services-service.js';

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

const CATALOG_ERROR_STATUS: Record<CatalogErrorCode, number> = {
  ERP_CATALOG_ADMIN_REQUIRED: 403,
  CATEGORY_NOT_FOUND: 404,
  CATEGORY_NAME_EXISTS: 409,
  CATEGORY_IN_USE: 409,
  // A service-typed category is a request-shape mistake, not a state conflict.
  CATEGORY_TYPE_INVALID: 400,
  CATEGORY_INACTIVE: 409,
  SERVICE_NOT_FOUND: 404,
  SERVICE_NAME_EXISTS: 409,
  CATALOG_EMPLOYEE_NOT_FOUND: 404,
  COMMISSION_OVERRIDE_NOT_FOUND: 404,
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
  if (error instanceof CatalogError) {
    failure(
      response,
      CATALOG_ERROR_STATUS[error.code],
      error.code,
      error.message,
      // Points the admin at the record that already holds the name.
      error.existingId === undefined ? undefined : { existingId: error.existingId },
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

const paginationMeta = (query: { page: number; pageSize: number }, total: number) => ({
  page: query.page,
  pageSize: query.pageSize,
  total,
  totalPages: Math.ceil(total / query.pageSize),
});

/**
 * A read may carry `?branchId=` so an Admin can name the branch they act on; a
 * Cashier's branch always comes from their account and any other value is
 * rejected by the resolver.
 */
const branchScopeOf = (request: Request) => (
  request.query.branchId === undefined
    ? undefined
    : listCategoriesQuerySchema.parse({ branchId: request.query.branchId }).branchId
);

export const createErpCategoriesRouter = (service: CategoryService) => {
  const router = Router();

  router.post('/', async (request: Request, response: Response) => {
    try {
      const input = createCategorySchema.parse(request.body);
      response.status(201).json({ data: await service.create(actorFrom(response), input) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listCategoriesQuerySchema.parse(request.query);
      const result = await service.list(actorFrom(response), query);
      response.json({ data: result.items, meta: paginationMeta(query, result.total) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const data = await service.get(actorFrom(response), id, branchScopeOf(request));
      response.json({ data });
    } catch (error) { handleError(error, response); }
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      const input = updateCategorySchema.parse(request.body);
      response.json({ data: await service.update(actorFrom(response), id, input) });
    } catch (error) { handleError(error, response); }
  });

  router.delete('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = categoryIdParamsSchema.parse(request.params);
      await service.remove(actorFrom(response), id, branchScopeOf(request));
      response.status(204).end();
    } catch (error) { handleError(error, response); }
  });

  return router;
};

/** There is deliberately no DELETE route: a service is retired, never removed. */
export const createErpServicesRouter = (service: ServiceCatalogService) => {
  const router = Router();

  router.post('/', async (request: Request, response: Response) => {
    try {
      const input = createServiceSchema.parse(request.body);
      response.status(201).json({ data: await service.create(actorFrom(response), input) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listServicesQuerySchema.parse(request.query);
      const result = await service.list(actorFrom(response), query);
      response.json({ data: result.items, meta: paginationMeta(query, result.total) });
    } catch (error) { handleError(error, response); }
  });

  router.get('/:id/commission-overrides', async (request: Request, response: Response) => {
    try {
      const { id } = serviceIdParamsSchema.parse(request.params);
      const data = await service.listCommissionOverrides(
        actorFrom(response),
        id,
        branchScopeOf(request),
      );
      response.json({ data });
    } catch (error) { handleError(error, response); }
  });

  router.put('/:id/commission-overrides', async (request: Request, response: Response) => {
    try {
      const { id } = serviceIdParamsSchema.parse(request.params);
      const input = setServiceCommissionOverrideSchema.parse(request.body);
      response.json({ data: await service.setCommissionOverride(actorFrom(response), id, input) });
    } catch (error) { handleError(error, response); }
  });

  router.delete('/:id/commission-overrides/:employeeId', async (
    request: Request,
    response: Response,
  ) => {
    try {
      const { id, employeeId } = serviceCommissionOverrideParamsSchema.parse(request.params);
      await service.removeCommissionOverride(
        actorFrom(response),
        id,
        employeeId,
        branchScopeOf(request),
      );
      response.status(204).end();
    } catch (error) { handleError(error, response); }
  });

  router.get('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = serviceIdParamsSchema.parse(request.params);
      const data = await service.get(actorFrom(response), id, branchScopeOf(request));
      response.json({ data });
    } catch (error) { handleError(error, response); }
  });

  router.patch('/:id', async (request: Request, response: Response) => {
    try {
      const { id } = serviceIdParamsSchema.parse(request.params);
      const input = updateServiceSchema.parse(request.body);
      response.json({ data: await service.update(actorFrom(response), id, input) });
    } catch (error) { handleError(error, response); }
  });

  return router;
};
