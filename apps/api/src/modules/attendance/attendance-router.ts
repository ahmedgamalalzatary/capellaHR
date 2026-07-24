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
import { fileTypeFromBuffer } from 'file-type';
import multer from 'multer';
import sharp from 'sharp';
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
  if (code === 'ATTENDANCE_FACE_IMAGE_INVALID') return 400;
  return 409;
};

const faceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 },
});

const receiveFaceImage = (request: Request, response: Response) => new Promise<void>((resolve, reject) => {
  faceUpload.single('faceImage')(request, response, (error) => error ? reject(error) : resolve());
});

const employeeSubmission = async (request: Request) => {
  if (!request.file) throw new AttendanceError('ATTENDANCE_FACE_IMAGE_INVALID', 'صورة الكاميرا مطلوبة');
  const detected = await fileTypeFromBuffer(request.file.buffer);
  if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
    throw new AttendanceError('ATTENDANCE_FACE_IMAGE_INVALID', 'صورة الكاميرا غير صالحة');
  }
  try {
    await sharp(request.file.buffer, { limitInputPixels: 12_000_000, sequentialRead: true })
      .rotate().raw().toBuffer();
  } catch {
    throw new AttendanceError('ATTENDANCE_FACE_IMAGE_INVALID', 'صورة الكاميرا غير صالحة');
  }
  let payload: unknown;
  try { payload = JSON.parse(String(request.body.payload)); } catch {
    throw new AttendanceError('ATTENDANCE_FACE_IMAGE_INVALID', 'بيانات طلب الحضور غير صالحة');
  }
  return { ...employeeAttendanceEventSchema.parse(payload), faceImage: request.file.buffer };
};

const useEmployeeSubmission = async <T>(request: Request, action: (
  submission: Awaited<ReturnType<typeof employeeSubmission>>,
) => Promise<T>) => {
  const uploadedBuffer = request.file?.buffer;
  try {
    const submission = await employeeSubmission(request);
    return await action(submission);
  } finally {
    uploadedBuffer?.fill(0);
    if (request.file?.buffer !== uploadedBuffer) request.file?.buffer.fill(0);
    request.file = undefined;
  }
};

const handle = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    fail(response, 400, 'ATTENDANCE_FACE_IMAGE_INVALID', 'صورة الكاميرا كبيرة جدًا أو غير صالحة');
    return;
  }
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
      await receiveFaceImage(request, response);
      response.status(201).json({
        data: await useEmployeeSubmission(request, (submission) => service.checkIn(submission)),
      });
    } catch (error) {
      handle(error, response, next);
    }
  });
  router.post('/check-out', async (request: Request, response: Response, next: NextFunction) => {
    try {
      await receiveFaceImage(request, response);
      response.json({
        data: await useEmployeeSubmission(request, (submission) => service.checkOut(submission)),
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
