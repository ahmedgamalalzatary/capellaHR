import { cancelPurchaseSchema, createPurchaseSchema, createSupplierSchema, listPurchasesQuerySchema, listSuppliersQuerySchema, purchaseIdParamsSchema, supplierIdParamsSchema, updateSupplierSchema } from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { PurchaseError, type SupplierPurchaseService } from './suppliers-service.js';

const failure = (response: Response, status: number, code: string, message: string, extra?: Record<string, unknown>) => response.status(status).json({ error: { code, message, ...extra, requestId: responseRequestId(response) } });
const actorFrom = (response: Response): ErpAccountIdentity => { const actor = erpActorFromLocals(response.locals.actor); if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء'); return actor; };
const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) { const fieldErrors: Record<string, string[]> = {}; for (const issue of cause.issues) (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message); failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors }); return; }
  if (cause instanceof PurchaseError) { const status = cause.code.endsWith('NOT_FOUND') ? 404 : 409; failure(response, status, cause.code, cause.message, cause.existingId === undefined ? undefined : { existingId: cause.existingId }); return; }
  if (cause instanceof ErpBranchContextError) { failure(response, cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403, cause.code, cause.message); return; }
  throw cause;
};
const meta = (query: { page: number; pageSize: number }, total: number) => ({ page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) });

export const createErpSuppliersRouter = (service: SupplierPurchaseService) => {
  const router = Router();
  router.post('/purchases', async (request, response) => { try { response.status(201).json({ data: await service.postPurchase(actorFrom(response), createPurchaseSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.get('/purchases', async (request, response) => { try { const query = listPurchasesQuerySchema.parse(request.query); const result = await service.listPurchases(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  router.get('/purchases/:id', async (request, response) => { try { const { id } = purchaseIdParamsSchema.parse(request.params); const branchId = request.query.branchId === undefined ? undefined : listPurchasesQuerySchema.parse({ branchId: request.query.branchId }).branchId; response.json({ data: await service.getPurchase(actorFrom(response), id, branchId) }); } catch (cause) { handle(cause, response); } });
  router.post('/purchases/:id/cancel', async (request, response) => { try { const { id } = purchaseIdParamsSchema.parse(request.params); response.json({ data: await service.cancelPurchase(actorFrom(response), id, cancelPurchaseSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.post('/', async (request, response) => { try { response.status(201).json({ data: await service.createSupplier(actorFrom(response), createSupplierSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  router.get('/', async (request, response) => { try { const query = listSuppliersQuerySchema.parse(request.query); const result = await service.listSuppliers(actorFrom(response), query); response.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, response); } });
  router.get('/:id', async (request, response) => { try { const { id } = supplierIdParamsSchema.parse(request.params); const branchId = request.query.branchId === undefined ? undefined : listSuppliersQuerySchema.parse({ branchId: request.query.branchId }).branchId; response.json({ data: await service.getSupplier(actorFrom(response), id, branchId) }); } catch (cause) { handle(cause, response); } });
  router.patch('/:id', async (request, response) => { try { const { id } = supplierIdParamsSchema.parse(request.params); response.json({ data: await service.updateSupplier(actorFrom(response), id, updateSupplierSchema.parse(request.body)) }); } catch (cause) { handle(cause, response); } });
  return router;
};
