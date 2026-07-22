import {
  attendanceDeniedAttemptParamsSchema,
  attendanceSessionParamsSchema,
  correctAutomaticTimeoutSchema,
  employeeAttendanceEventSchema,
  listAttendanceDeniedAttemptsQuerySchema,
  listAttendanceSessionsQuerySchema,
  manualAttendanceEventSchema,
} from '@capella/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';

import { responseRequestId } from '../../shared/http/index.js';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { AttendanceError, type AttendanceService } from './attendance-service.js';

const fail = (
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

const statusFor = (code: string) => {
  if (code === 'ATTENDANCE_NOT_FOUND' || code === 'ATTENDANCE_EMPLOYEE_NOT_FOUND') return 404;
  if (code === 'ATTENDANCE_INVALID_CREDENTIALS') return 401;
  return 409;
};

const handle = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    fail(response, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
    return;
  }
  if (error instanceof AttendanceError) {
    fail(response, statusFor(error.code), error.code, error.message);
    return;
  }
  next(error);
};

export const createAttendanceRouter = (
  service: AttendanceService,
  authService: Pick<AuthService, 'authenticate'>,
) => {
  const router = Router();
  const auth = createAuthMiddleware(authService);

  router.post('/check-in', async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.status(201).json({
        data: await service.checkIn(employeeAttendanceEventSchema.parse(request.body)),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.post('/check-out', async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json({
        data: await service.checkOut(employeeAttendanceEventSchema.parse(request.body)),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });

  router.use(auth.authenticate, auth.requireAdmin);
  router.get('/sessions', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = listAttendanceSessionsQuerySchema.parse(request.query);
      const result = await service.listSessions(query);
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
      handle(error, response, next);
    }
  });
  router.get('/sessions/:sessionId', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { sessionId } = attendanceSessionParamsSchema.parse(request.params);
      response.json({ data: await service.getSession(sessionId) });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.get('/denied-attempts', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = listAttendanceDeniedAttemptsQuerySchema.parse(request.query);
      const result = await service.listDeniedAttempts(query);
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
      handle(error, response, next);
    }
  });
  router.post('/manual/check-in', async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.status(201).json({
        data: await service.manualCheckIn(manualAttendanceEventSchema.parse(request.body)),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.post('/manual/check-out', async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json({
        data: await service.manualCheckOut(manualAttendanceEventSchema.parse(request.body)),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.post('/denied-attempts/:attemptId/approve', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { attemptId } = attendanceDeniedAttemptParamsSchema.parse(request.params);
      response.json({ data: await service.approveDeniedAttempt(attemptId) });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.post('/denied-attempts/:attemptId/dismiss', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { attemptId } = attendanceDeniedAttemptParamsSchema.parse(request.params);
      response.json({ data: await service.dismissDeniedAttempt(attemptId) });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.patch('/sessions/:sessionId/automatic-timeout', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { sessionId } = attendanceSessionParamsSchema.parse(request.params);
      response.json({
        data: await service.correctAutomaticTimeout(
          sessionId,
          correctAutomaticTimeoutSchema.parse(request.body),
        ),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });

  return router;
};
