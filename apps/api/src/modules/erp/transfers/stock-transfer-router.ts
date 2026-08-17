import {
  createStockTransferSchema,
  listStockTransfersQuerySchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { StockTransferError, type StockTransferErrorCode } from './stock-transfer-service.js';
import type { createStockTransferService } from './stock-transfer-service.js';

type StockTransferService = ReturnType<typeof createStockTransferService>;

const failure = (
  response: Response,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) => response.status(status).json({
  error: { code, message, ...extra, requestId: responseRequestId(response) },
});

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) {
    throw new ErpBranchContextError('ERP_BRANCH_FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء');
  }
  return actor;
};

const statuses: Record<StockTransferErrorCode, number> = {
  TRANSFER_ADMIN_REQUIRED: 403,
  TRANSFER_BRANCH_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  TRANSFER_SHIFT_REQUIRED: 409,
  TRANSFER_COST_REQUIRED: 409,
  TRANSFER_COST_CHANGED: 409,
  TRANSFER_DESTINATION_PRODUCT_INACTIVE: 409,
  TRANSFER_KEY_REUSED: 409,
  INSUFFICIENT_STOCK: 409,
};

const handle = (cause: unknown, response: Response) => {
  if (cause instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of cause.issues) {
      (fieldErrors[issue.path.join('.') || '_root'] ??= []).push(issue.message);
    }
    failure(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', { fieldErrors });
    return;
  }
  if (cause instanceof StockTransferError) {
    failure(response, statuses[cause.code], cause.code, cause.message);
    return;
  }
  if (cause instanceof ErpBranchContextError) {
    const status = cause.code === 'ERP_BRANCH_REQUIRED' ? 400
      : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403;
    failure(response, status, cause.code, cause.message);
    return;
  }
  throw cause;
};

const meta = (query: { page: number; pageSize: number }, total: number) => ({
  page: query.page,
  pageSize: query.pageSize,
  total,
  totalPages: Math.ceil(total / query.pageSize),
});

export const createErpStockTransfersRouter = (service: StockTransferService) => {
  const router = Router();
  router.post('/', async (request, response) => {
    try {
      const input = createStockTransferSchema.parse(request.body);
      response.status(201).json({ data: await service.transfer(actorFrom(response), input) });
    } catch (cause) {
      handle(cause, response);
    }
  });
  router.get('/', async (request, response) => {
    try {
      const query = listStockTransfersQuerySchema.parse(request.query);
      const result = await service.list(actorFrom(response), query);
      response.json({ data: result.items, meta: meta(query, result.total) });
    } catch (cause) {
      handle(cause, response);
    }
  });
  return router;
};
