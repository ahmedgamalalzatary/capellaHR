import { correctExpenseSchema, createExpenseSchema, expenseBranchQuerySchema, expenseIdParamsSchema, listExpensesQuerySchema } from '@capella/contracts';
import { Router, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../../shared/http/index.js';
import { ErpBranchContextError } from '../branch-context.js';
import { erpActorFromLocals } from '../erp-actor.js';
import type { ErpAccountIdentity } from '../hr-capabilities.js';
import { ExpenseError, type ExpenseService } from './expense-service.js';

const failure = (response: Response, status: number, code: string, message: string, extra?: object) => response.status(status).json({ error: { code, message, ...extra, requestId: responseRequestId(response) } });
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
  if (cause instanceof ExpenseError) {
    const status = cause.code === 'ERP_EXPENSE_ADMIN_REQUIRED' ? 403 : cause.code === 'EXPENSE_NOT_FOUND' ? 404 : 409;
    failure(response, status, cause.code, cause.message); return;
  }
  if (cause instanceof ErpBranchContextError) {
    failure(response, cause.code === 'ERP_BRANCH_REQUIRED' ? 400 : cause.code === 'ERP_BRANCH_NOT_FOUND' ? 404 : 403, cause.code, cause.message); return;
  }
  throw cause;
};
const meta = (query: { page: number; pageSize: number }, total: number) => ({ page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) });

export const createErpExpensesRouter = (service: ExpenseService) => {
  const router = Router();
  router.post('/', async (req, res) => { try { res.status(201).json({ data: await service.create(actorFrom(res), createExpenseSchema.parse(req.body)) }); } catch (cause) { handle(cause, res); } });
  router.get('/', async (req, res) => { try { const query = listExpensesQuerySchema.parse(req.query); const result = await service.list(actorFrom(res), query); res.json({ data: result.items, meta: meta(query, result.total) }); } catch (cause) { handle(cause, res); } });
  router.get('/:id', async (req, res) => { try { const { id } = expenseIdParamsSchema.parse(req.params); const { branchId } = expenseBranchQuerySchema.parse(req.query); res.json({ data: await service.get(actorFrom(res), id, branchId) }); } catch (cause) { handle(cause, res); } });
  router.post('/:id/corrections', async (req, res) => { try { const { id } = expenseIdParamsSchema.parse(req.params); res.status(201).json({ data: await service.correct(actorFrom(res), id, correctExpenseSchema.parse(req.body)) }); } catch (cause) { handle(cause, res); } });
  return router;
};
