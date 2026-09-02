import {
  completeServiceExecutionsSchema,
  configureConsumableSchema,
  correctServiceExecutionSchema,
  listConsumableBalancesQuerySchema,
  listConsumableServicesQuerySchema,
  productIdParamsSchema,
  transferConsumableStockSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { z, ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { ConsumablesError, type ConsumablesService } from './consumables-service.js';

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح بتنفيذ هذا الإجراء');
  return actor;
};
const failure = (response: Response, status: number, code: string, message: string) => response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } });
const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) return failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة');
  if (cause instanceof ConsumablesError) {
    if (cause.code === 'CONSUMABLE_SERVICE_NOT_COMPLETED') {
      return failure(response, 409, cause.code, cause.message);
    }
    const status = cause.code === 'CONSUMABLE_PRODUCT_NOT_FOUND' || cause.code === 'CONSUMABLE_SERVICE_NOT_FOUND' ? 404 : cause.code === 'CONSUMABLES_ADMIN_REQUIRED' ? 403 : 409;
    return failure(response, status, cause.code, cause.message);
  }
  if (cause instanceof ErpBranchContextError) return failure(response, cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : 403, cause.code, cause.message);
  throw cause;
};
const meta = (query: { page: number; pageSize: number }, total: number) => ({ page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) });

export const createConsumablesRouter = (service: ConsumablesService) => {
  const router = Router();
  router.get('/', async (request, response) => { try { const query = listConsumableBalancesQuerySchema.parse(request.query); const result = await service.listBalances(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  router.put('/products/:id/configuration', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); response.json({ data: await service.configure(actorFrom(response), id, configureConsumableSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.post('/products/:id/transfers', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); response.json({ data: await service.transfer(actorFrom(response), id, transferConsumableStockSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.get('/services', async (request, response) => { try { const query = listConsumableServicesQuerySchema.parse(request.query); const result = await service.listServices(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  router.post('/services/complete', async (request, response) => { try { response.json({ data: await service.complete(actorFrom(response), completeServiceExecutionsSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.put('/services/:id', async (request, response) => { try { const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params); response.json({ data: await service.correct(actorFrom(response), id, correctServiceExecutionSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  return router;
};
