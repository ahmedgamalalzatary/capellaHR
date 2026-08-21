import {
  createFixedAssetSchema,
  fixedAssetBranchQuerySchema,
  fixedAssetIdParamsSchema,
  listFixedAssetsQuerySchema,
  updateFixedAssetSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { FixedAssetError, type FixedAssetService } from './fixed-asset-service.js';

const failure = (response: Response, status: number, code: string, message: string, extra?: object) => response
  .status(status)
  .json({ error: { code, message, ...extra, requestId: responseRequestId(response) } });
const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء');
  return actor;
};
const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of cause.issues) (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors }); return;
  }
  if (cause instanceof FixedAssetError) { failure(response, 404, cause.code, cause.message); return; }
  if (cause instanceof ErpBranchContextError) {
    failure(response, cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403, cause.code, cause.message); return;
  }
  throw cause;
};
const meta = (query: { page: number; pageSize: number }, total: number) => ({
  page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize),
});

export const createErpFixedAssetsRouter = (service: FixedAssetService) => {
  const router = Router();
  router.post('/', async (req, res) => { try { res.status(201).json({ data: await service.create(actorFrom(res), createFixedAssetSchema.parse(req.body)) }); } catch (cause) { handle(cause, res); } });
  router.get('/', async (req, res) => { try { const query = listFixedAssetsQuerySchema.parse(req.query); const result = await service.list(actorFrom(res), query); res.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, res); } });
  router.get('/:id', async (req, res) => { try { const { id } = fixedAssetIdParamsSchema.parse(req.params); const { branchId } = fixedAssetBranchQuerySchema.parse(req.query); res.json({ data: await service.get(actorFrom(res), id, branchId) }); } catch (cause) { handle(cause, res); } });
  // PUT, not PATCH: an edit rewrites the whole line, so a field left out of the
  // body is a field the admin cleared rather than one to leave as it was.
  router.put('/:id', async (req, res) => { try { const { id } = fixedAssetIdParamsSchema.parse(req.params); res.json({ data: await service.update(actorFrom(res), id, updateFixedAssetSchema.parse(req.body)) }); } catch (cause) { handle(cause, res); } });
  router.delete('/:id', async (req, res) => { try { const { id } = fixedAssetIdParamsSchema.parse(req.params); const { branchId } = fixedAssetBranchQuerySchema.parse(req.query); await service.remove(actorFrom(res), id, branchId); res.status(204).end(); } catch (cause) { handle(cause, res); } });
  return router;
};
