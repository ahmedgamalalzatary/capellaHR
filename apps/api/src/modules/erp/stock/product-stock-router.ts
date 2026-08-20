import {
  adjustProductStockSchema,
  generateProductBarcodeSchema,
  createProductSchema,
  listProductsQuerySchema,
  listStockMovementsQuerySchema,
  productBarcodeLookupSchema,
  productIdParamsSchema,
  updateProductSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { ProductStockError, type ProductStockService } from './product-stock-service.js';

const failure = (response: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) => response.status(status).json({
  error: { code, message, ...extra, requestId: responseRequestId(response) },
});
const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء');
  return actor;
};
const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of cause.issues) (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors });
    return;
  }
  if (cause instanceof ProductStockError) {
    const status = cause.code === 'PRODUCT_NOT_FOUND' ? 404 : 409;
    failure(response, status, cause.code, cause.message, cause.existingId === undefined ? undefined : { existingId: cause.existingId });
    return;
  }
  if (cause instanceof ErpBranchContextError) {
    const status = cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403;
    failure(response, status, cause.code, cause.message);
    return;
  }
  throw cause;
};
const meta = (query: { page: number; pageSize: number }, total: number) => ({ page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) });

export const createErpProductsRouter = (service: ProductStockService) => {
  const router = Router();
  router.post('/', async (request, response) => { try { response.status(201).json({ data: await service.create(actorFrom(response), createProductSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.get('/', async (request, response) => { try { const query = listProductsQuerySchema.parse(request.query); const result = await service.list(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  router.get('/movements', async (request, response) => { try { const query = listStockMovementsQuerySchema.parse(request.query); const result = await service.listMovements(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  // Ahead of `/:id`, and reading the code from the query rather than the path:
  // a supplier's code may contain a slash, which a path segment cannot carry.
  router.get('/by-barcode', async (request, response) => { try { response.json({ data: await service.findByBarcode(actorFrom(response), productBarcodeLookupSchema.parse(request.query)) }); } catch (cause) { handle(cause, response); } });
  router.post('/:id/barcode', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); response.json({ data: await service.generateBarcode(actorFrom(response), id, generateProductBarcodeSchema.parse(request.body ?? {})) }); } catch (cause) { handle(cause, response); } });
  router.get('/:id', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); const branchId = request.query.branchId === undefined ? undefined : listProductsQuerySchema.parse({ branchId: request.query.branchId }).branchId; response.json({ data: await service.get(actorFrom(response), id, branchId) }); } catch (cause) { handle(cause, response); } });
  router.patch('/:id', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); response.json({ data: await service.update(actorFrom(response), id, updateProductSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.post('/:id/adjustments', async (request, response) => { try { const { id } = productIdParamsSchema.parse(request.params); response.json({ data: await service.adjust(actorFrom(response), id, adjustProductStockSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  return router;
};
