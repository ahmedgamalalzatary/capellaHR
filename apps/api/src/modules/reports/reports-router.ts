import {
  createReportExportSchema,
  listReportExportsQuerySchema,
  reportExportParamsSchema,
  reportFilterCompatibilitySchema,
  reportQuerySchema,
  reportTypeParamsSchema,
} from '@capella/contracts';
import { Router, type Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { ReportError, type ReportService } from './reports-service.js';

const queryControlKeys = new Set(['selection', 'selectedIds', 'page', 'pageSize']);

const fail = (response: Response, status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) => {
  response.status(status).json({
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      requestId: responseRequestId(response),
    },
  });
};

const handleError = (error: unknown, response: Response) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_root';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    fail(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof ReportError) {
    const status = error.code === 'REPORT_EXPORT_NOT_FOUND' ? 404
      : error.code === 'REPORT_FILE_DELETED' || error.code === 'REPORT_FILE_MISSING' ? 410
        : 409;
    fail(response, status, error.code, error.message);
    return;
  }
  throw error;
};

export const createReportsRouter = (
  service: ReportService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);
  router.use(auth.authenticate, auth.requireAdmin);

  router.post('/exports', async (request, response) => {
    try {
      const input = createReportExportSchema.parse(request.body);
      response.status(202).json({ data: await service.createExport(input) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.get('/exports', async (request, response) => {
    try {
      const query = listReportExportsQuerySchema.parse(request.query);
      const result = await service.listExports(query);
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
      handleError(error, response);
    }
  });

  router.get('/exports/:exportId/download', async (request, response) => {
    try {
      const { exportId } = reportExportParamsSchema.parse(request.params);
      const result = await service.download(exportId);
      response.type('application/pdf');
      response.attachment(result.filename);
      await pipeline(result.stream, response);
    } catch (error) {
      if (response.headersSent || response.writableEnded) return;
      handleError(error, response);
    }
  });

  router.post('/exports/:exportId/retry', async (request, response) => {
    try {
      const { exportId } = reportExportParamsSchema.parse(request.params);
      response.status(202).json({ data: await service.retryExport(exportId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.delete('/exports/:exportId/file', async (request, response) => {
    try {
      const { exportId } = reportExportParamsSchema.parse(request.params);
      response.json({ data: await service.deleteFile(exportId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.get('/exports/:exportId', async (request, response) => {
    try {
      const { exportId } = reportExportParamsSchema.parse(request.params);
      response.json({ data: await service.getExport(exportId) });
    } catch (error) {
      handleError(error, response);
    }
  });

  router.get('/:reportType', async (request, response) => {
    try {
      const { reportType } = reportTypeParamsSchema.parse(request.params);
      const query = reportQuerySchema.parse(request.query);
      const filters = Object.fromEntries(
        Object.entries(query).filter(([key]) => !queryControlKeys.has(key)),
      );
      reportFilterCompatibilitySchema.parse({ reportType, filters });
      const result = await service.view(reportType, query);
      response.json({
        data: result.snapshot,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / query.pageSize),
        },
      });
    } catch (error) {
      handleError(error, response);
    }
  });

  return router;
};
