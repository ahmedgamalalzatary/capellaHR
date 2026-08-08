import { adminLoginSchema, employeeLoginSchema } from '@capella/contracts';
import { Router, type CookieOptions, type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AuthError, type AuthService } from './auth-service.js';
import { SESSION_COOKIE, readSessionCookie } from './session-cookie.js';
import { responseRequestId } from '../../shared/http/index.js';

// Mirrors SESSION_LIFETIME_MS.admin in auth-service: the cookie must not expire before
// the session it carries, or the browser signs the user out while the session is alive.
// Employee logins deliberately omit Max-Age so their cookie dies with the browser.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

const publicActor = (actor: { type: 'admin' | 'employee' }) => ({ type: actor.type });

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
  const sessionCookieOptions: CookieOptions = {
    ...cookieOptions,
    maxAge: SESSION_MAX_AGE_MS,
  };

  router.post('/admin/login', async (request, response) => {
    const input = adminLoginSchema.parse(request.body);
    const result = await service.loginAdmin(input.email, input.password, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
    response.cookie(SESSION_COOKIE, result.token, sessionCookieOptions);
    response.json({ data: { actor: publicActor(result.actor) } });
  });

  router.post('/employee/login', async (request, response) => {
    const input = employeeLoginSchema.parse(request.body);
    const result = await service.loginEmployee(input, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
    response.cookie(SESSION_COOKIE, result.token, cookieOptions);
    response.json({ data: { actor: publicActor(result.actor) } });
  });

  router.get('/session', async (request, response) => {
    const token = readSessionCookie(request.headers.cookie) ?? '';
    const session = await service.authenticate(token);
    if (!session) {
      if (token) response.clearCookie(SESSION_COOKIE, cookieOptions);
      throw new AuthError('UNAUTHENTICATED', 'يجب تسجيل الدخول');
    }
    const actor = publicActor({ type: session.actorType });
    response.json({ data: { actor } });
  });

  router.post('/logout', async (request, response) => {
    const token = readSessionCookie(request.headers.cookie);
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
