import { adminLoginSchema, employeeLoginSchema } from '@capella/contracts';
import { Router, type CookieOptions, type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AuthError, type AuthService } from './auth-service.js';
import { responseRequestId } from '../../shared/http/index.js';

const SESSION_COOKIE = 'capella_session';

const readCookie = (cookieHeader: string | undefined, name: string) => {
  if (!cookieHeader) return null;
  for (const section of cookieHeader.split(';')) {
    const separator = section.indexOf('=');
    if (separator < 0) continue;
    if (section.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(section.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
};

export const createAuthRouter = (
  service: AuthService,
  options: { secureCookies?: boolean } = {},
) => {
  const router = Router();
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: options.secureCookies ?? true,
    sameSite: 'strict',
    path: '/api/v1',
  };

  router.post('/admin/login', async (request, response) => {
    const input = adminLoginSchema.parse(request.body);
    const result = await service.loginAdmin(input.email, input.password, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
    response.cookie(SESSION_COOKIE, result.token, cookieOptions);
    response.json({ data: { actor: result.actor } });
  });

  router.post('/employee/login', async (request, response) => {
    const input = employeeLoginSchema.parse(request.body);
    const result = await service.loginEmployee(input, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
    response.cookie(SESSION_COOKIE, result.token, cookieOptions);
    response.json({ data: { actor: result.actor } });
  });

  router.get('/session', async (request, response) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE) ?? '';
    const session = await service.authenticate(token);
    if (!session) throw new AuthError('UNAUTHENTICATED', 'يجب تسجيل الدخول');
    const actor = session.actorType === 'admin'
      ? { type: 'admin' as const }
      : { type: 'employee' as const, employeeId: session.employeeId };
    response.json({ data: { actor } });
  });

  router.post('/logout', async (request, response) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await service.logout(token);
    response.clearCookie(SESSION_COOKIE, cookieOptions);
    response.status(204).send();
  });

  const authErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
    const requestId = responseRequestId(response);
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'البيانات المدخلة غير صحيحة',
          fieldErrors: error.flatten().fieldErrors,
          requestId,
        },
      });
      return;
    }
    if (error instanceof AuthError) {
      response.status(401).json({
        error: { code: error.code, message: error.message, requestId },
      });
      return;
    }
    next(error);
  };
  router.use(authErrorHandler);

  return router;
};
