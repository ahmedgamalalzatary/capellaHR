import {
  branchLinkParamsSchema,
  createBranchLinkSchema,
  linkedProductsQuerySchema,
  settleProductLinkSchema,
  settleSyncIssueSchema,
  setupRowParamsSchema,
  syncIssueParamsSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { ProductSyncError, type ProductSyncErrorCode } from './product-sync-service.js';
import type { createProductSyncService } from './product-sync-service.js';

type ProductSyncService = ReturnType<typeof createProductSyncService>;

const failure = (response: Response, status: number, code: string, message: string) => response.status(status).json({
  error: { code, message, requestId: responseRequestId(response) },
});

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء');
  return actor;
};

const statuses: Record<ProductSyncErrorCode, number> = {
  SYNC_ADMIN_REQUIRED: 403,
  SYNC_LINK_NOT_FOUND: 404,
  SYNC_BRANCH_NOT_FOUND: 404,
  SYNC_PRODUCT_NOT_FOUND: 404,
  SYNC_ISSUE_NOT_FOUND: 404,
  SYNC_SAME_BRANCH: 409,
  SYNC_SENDER_IS_RECEIVER: 409,
  SYNC_RECEIVER_IS_SENDER: 409,
  SYNC_RECEIVER_TAKEN: 409,
  SYNC_SETUP_INCOMPLETE: 409,
  SYNC_RECEIVER_TAKEN_BY_OTHER: 409,
  SYNC_NAME_TAKEN: 409,
};

const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of cause.issues) (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'بيانات الطلب غير صالحة', fieldErrors, requestId: responseRequestId(response) },
    });
    return;
  }
  if (cause instanceof ProductSyncError) {
    failure(response, statuses[cause.code], cause.code, cause.message);
    return;
  }
  if (cause instanceof ErpBranchContextError) {
    const status = cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403;
    failure(response, status, cause.code, cause.message);
    return;
  }
  throw cause;
};

export const createErpProductSyncRouter = (service: ProductSyncService) => {
  const router = Router();
  router.get('/', async (request, response) => {
    try { response.json({ data: await service.list(actorFrom(response)) }); } catch (cause) { handle(cause, response); }
  });
  router.post('/', async (request, response) => {
    try {
      response.status(201).json({ data: await service.create(actorFrom(response), createBranchLinkSchema.parse(request.body)) });
    } catch (cause) { handle(cause, response); }
  });
  // The "needs attention" list: products a sending branch created that the
  // receiving branch could not take.
  router.get('/issues', async (request, response) => {
    try { response.json({ data: await service.issues(actorFrom(response)) }); } catch (cause) { handle(cause, response); }
  });
  router.put('/issues/:issueId', async (request, response) => {
    try {
      const { issueId } = syncIssueParamsSchema.parse(request.params);
      await service.settleIssue(actorFrom(response), issueId, settleSyncIssueSchema.parse(request.body));
      response.json({ data: await service.issues(actorFrom(response)) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/linked', async (request, response) => {
    try {
      const { branchId } = linkedProductsQuerySchema.parse(request.query);
      response.json({ data: await service.linkedProducts(actorFrom(response), branchId) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/:id/setup', async (request, response) => {
    try {
      const { id } = branchLinkParamsSchema.parse(request.params);
      response.json({ data: await service.setup(actorFrom(response), id) });
    } catch (cause) { handle(cause, response); }
  });
  router.put('/:id/rows/:productId', async (request, response) => {
    try {
      const { id, productId } = setupRowParamsSchema.parse(request.params);
      response.json({ data: await service.settle(actorFrom(response), id, productId, settleProductLinkSchema.parse(request.body)) });
    } catch (cause) { handle(cause, response); }
  });
  router.post('/:id/activation', async (request, response) => {
    try {
      const { id } = branchLinkParamsSchema.parse(request.params);
      response.json({ data: await service.activate(actorFrom(response), id) });
    } catch (cause) { handle(cause, response); }
  });
  router.get('/:id/excluded', async (request, response) => {
    try {
      const { id } = branchLinkParamsSchema.parse(request.params);
      response.json({ data: await service.excluded(actorFrom(response), id) });
    } catch (cause) { handle(cause, response); }
  });
  router.delete('/:id', async (request, response) => {
    try {
      const { id } = branchLinkParamsSchema.parse(request.params);
      await service.remove(actorFrom(response), id);
      response.status(204).end();
    } catch (cause) { handle(cause, response); }
  });
  return router;
};
