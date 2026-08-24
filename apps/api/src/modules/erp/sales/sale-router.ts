import {
  clientIdParamsSchema,
  clientVisitHistoryQuerySchema,
  completeSaleSchema,
  invoiceHistoryQuerySchema,
  invoiceParamsSchema,
  invoiceLineParamsSchema,
  quoteSaleInputSchema,
  refundInvoiceSchema,
  refundQuoteInputSchema,
  reassignInvoiceLineSchema,
  voidInvoiceSchema,
} from '@capella/contracts';
import { Router, type NextFunction, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { SaleError, type SaleService } from './sale-service.js';

const actorFrom = (response: Response): ErpAccountIdentity => {
  const actor = erpActorFromLocals(response.locals.actor);
  if (!actor) {
    throw new ErpBranchContextError(
      'ERP_BRANCH_FORBIDDEN',
      'غير مصرح لك بتنفيذ هذا الإجراء',
    );
  }
  return actor;
};

const failure = (
  response: Response,
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) => response.status(status).json({
  error: {
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
    requestId: responseRequestId(response),
  },
});

const handleError = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    failure(response, 400, 'SALE_VALIDATION_FAILED', 'بيانات البيع غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof ErpBranchContextError) {
    const status = error.code === 'ERP_BRANCH_REQUIRED'
      ? 400
      : error.code === 'ERP_BRANCH_NOT_FOUND'
        ? 404
        : 403;
    failure(response, status, error.code, error.message);
    return;
  }
  if (error instanceof SaleError) {
    const status = error.code === 'CLIENT_NOT_FOUND' || error.code === 'INVOICE_NOT_FOUND'
      ? 404
      : error.code === 'SALE_VALIDATION_FAILED'
        ? 400
        : 409;
    failure(response, status, error.code, error.message,
      error.code === 'PAYMENT_TOTAL_MISMATCH' ? { payments: [error.message] } : undefined);
    return;
  }
  next(error);
};

export const createErpSalesRouter = (service: SaleService) => {
  const router = Router();

  router.post('/quote', async (request, response, next) => {
    try {
      const input = quoteSaleInputSchema.parse(request.body);
      response.json({ data: await service.quote(actorFrom(response), input) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      const input = completeSaleSchema.parse(request.body);
      response.status(201).json({ data: await service.complete(actorFrom(response), input) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/clients/:clientId/visits', async (request, response, next) => {
    try {
      const { id: clientId } = clientIdParamsSchema.parse({ id: request.params.clientId });
      const query = clientVisitHistoryQuerySchema.parse(request.query);
      const result = await service.listClientVisits(actorFrom(response), clientId, query);
      response.json({
        data: result.items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const query = invoiceHistoryQuerySchema.parse(request.query);
      const result = await service.listInvoices(actorFrom(response), query);
      response.json({
        data: result.items,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/:invoiceId/refunds', async (request, response, next) => {
    try {
      const { invoiceId } = invoiceParamsSchema.parse({ invoiceId: request.params.invoiceId });
      const input = refundInvoiceSchema.parse(request.body);
      response.status(201).json({ data: await service.refund(actorFrom(response), invoiceId, input) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/invoices/:invoiceId/lines/:lineId/reassign', async (request, response, next) => {
    try {
      const { invoiceId, lineId } = invoiceLineParamsSchema.parse(request.params);
      const input = reassignInvoiceLineSchema.parse(request.body);
      response.status(201).json({
        data: await service.reassignLine(actorFrom(response), invoiceId, lineId, input),
      });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/:invoiceId/refunds/quote', async (request, response, next) => {
    try {
      const { invoiceId } = invoiceParamsSchema.parse({ invoiceId: request.params.invoiceId });
      const input = refundQuoteInputSchema.parse(request.body);
      response.json({ data: await service.quoteRefund(actorFrom(response), invoiceId, input) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.post('/:invoiceId/void', async (request, response, next) => {
    try {
      const { invoiceId } = invoiceParamsSchema.parse({ invoiceId: request.params.invoiceId });
      const input = voidInvoiceSchema.parse(request.body);
      response.status(201).json({ data: await service.void(actorFrom(response), invoiceId, input) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  router.get('/:invoiceId', async (request, response, next) => {
    try {
      const { invoiceId } = invoiceParamsSchema.parse({ invoiceId: request.params.invoiceId });
      const { branchId } = invoiceHistoryQuerySchema.pick({ branchId: true }).parse(request.query);
      response.json({ data: await service.getInvoice(actorFrom(response), invoiceId, branchId) });
    } catch (error) {
      handleError(error, response, next);
    }
  });

  return router;
};
