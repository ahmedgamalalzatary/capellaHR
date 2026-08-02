import { listAssignableEmployeesQuerySchema } from '@capella/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { responseRequestId } from '../../../shared/http/index.js';
import { ErpAssignmentError, type EmployeeAssignmentService } from './assignment-service.js';

const failure = (response: Response, status: number, code: string, message: string) => {
  response.status(status).json({
    error: { code, message, requestId: responseRequestId(response) },
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
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'بيانات الطلب غير صالحة',
        fieldErrors,
        requestId: responseRequestId(response),
      },
    });
    return;
  }
  if (error instanceof ErpAssignmentError) {
    failure(response, 409, error.code, error.message);
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

/**
 * Read-only surface: who may be assigned to an invoice right now. There is no
 * write operation and no override, because assignment eligibility is decided by
 * live Attendance alone (`docs/erp-plan.md` §7).
 */
export const createErpAssignmentRouter = (service: EmployeeAssignmentService) => {
  const router = Router();

  router.get('/', async (request: Request, response: Response) => {
    try {
      const query = listAssignableEmployeesQuerySchema.parse(request.query);
      response.json({ data: await service.listAssignable(actorFrom(response), query) });
    } catch (error) { handleError(error, response); }
  });

  return router;
};
