import {
  adminLoginSchema,
  cashierAccountStatusSchema,
  cashierLoginSchema,
  employeeLoginSchema,
  listCashierAccountsSchema,
  positiveMysqlIntSchema,
  promoteCashierSchema,
  resetCashierPasswordSchema,
} from '@capella/contracts';
import { Router, type CookieOptions, type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AuthError, type AuthService } from './auth-service.js';
import {
  CashierAccountError,
  type CashierAccountsService,
} from './cashier-accounts-service.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { responseRequestId } from '../../shared/http/index.js';

// Stable protocol name shared by issuing, reading, and clearing the session cookie.
const SESSION_COOKIE = 'capella_session';

const publicActor = (
  actor:
    | { type: 'admin' | 'employee' }
    | { type: 'cashier'; accountId: number; employeeId: number },
) => actor.type === 'cashier'
  ? { type: actor.type, accountId: actor.accountId, employeeId: actor.employeeId }
  : { type: actor.type };

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
  options: {
    secureCookies?: boolean;
    cashierAccounts?: CashierAccountsService;
    employeeAuthenticationEnabled?: boolean;
  } = {},
) => {
  const router = Router();
  const employeeAuthenticationEnabled = options.employeeAuthenticationEnabled ?? true;
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: options.secureCookies ?? true,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60_000,
  };

  router.post('/admin/login', async (request, response) => {
    const input = adminLoginSchema.parse(request.body);
    const result = await service.loginAdmin(input.email, input.password, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
    response.cookie(SESSION_COOKIE, result.token, cookieOptions);
    response.json({ data: { actor: publicActor(result.actor) } });
  });

  if (employeeAuthenticationEnabled) {
    router.post('/employee/login', async (request, response) => {
      const input = employeeLoginSchema.parse(request.body);
      const result = await service.loginEmployee(input, { ipAddress: request.ip?.slice(0, 45) ?? null, userAgent: request.header('user-agent')?.slice(0, 1024) ?? null, requestId: responseRequestId(response) });
      response.cookie(SESSION_COOKIE, result.token, cookieOptions);
      response.json({ data: { actor: publicActor(result.actor) } });
    });
  }

  if (options.cashierAccounts) {
    const middleware = createAuthMiddleware(service);
    router.post('/cashier/login', async (request, response) => {
      const input = cashierLoginSchema.parse(request.body);
      const result = await service.loginCashier(input.username, input.password, {
        ipAddress: request.ip?.slice(0, 45) ?? null,
        userAgent: request.header('user-agent')?.slice(0, 1024) ?? null,
        requestId: responseRequestId(response),
      });
      response.cookie(SESSION_COOKIE, result.token, cookieOptions);
      response.json({ data: { actor: publicActor(result.actor) } });
    });
    router.post(
      '/cashier-accounts',
      middleware.authenticate,
      middleware.requireAdmin,
      async (request, response) => {
        const input = promoteCashierSchema.parse(request.body);
        const account = await options.cashierAccounts!.promote(input);
        response.status(201).json({ data: account });
      },
    );
    router.get(
      '/cashier-accounts',
      middleware.authenticate,
      middleware.requireAdmin,
      async (request, response) => {
        const query = listCashierAccountsSchema.parse(request.query);
        const result = await options.cashierAccounts!.list(query);
        response.json({
          data: result.items,
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / query.pageSize),
          },
        });
      },
    );
    router.patch(
      '/cashier-accounts/:accountId/status',
      middleware.authenticate,
      middleware.requireAdmin,
      async (request, response) => {
        const accountId = positiveMysqlIntSchema.parse(Number(request.params.accountId));
        const input = cashierAccountStatusSchema.parse(request.body);
        response.json({ data: await options.cashierAccounts!.setActive(accountId, input.active) });
      },
    );
    router.patch(
      '/cashier-accounts/:accountId/password',
      middleware.authenticate,
      middleware.requireAdmin,
      async (request, response) => {
        const accountId = positiveMysqlIntSchema.parse(Number(request.params.accountId));
        const input = resetCashierPasswordSchema.parse(request.body);
        response.json({ data: await options.cashierAccounts!.resetPassword(accountId, input.password) });
      },
    );
  }

  router.get('/session', async (request, response) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE) ?? '';
    const session = await service.authenticate(token);
    if (!session) throw new AuthError('UNAUTHENTICATED', 'يجب تسجيل الدخول');
    const disabledActor = (
      (session.actorType === 'employee' && !employeeAuthenticationEnabled)
      || (session.actorType === 'account'
        && session.accountRole === 'cashier'
        && !options.cashierAccounts)
    );
    if (disabledActor) {
      await service.logout(token);
      throw new AuthError('UNAUTHENTICATED', 'يجب تسجيل الدخول');
    }
    const actor = session.actorType === 'account'
      ? session.accountRole === 'admin'
        ? publicActor({ type: 'admin' })
        : publicActor({
            type: 'cashier',
            accountId: session.accountId!,
            employeeId: session.employeeId!,
          })
      : publicActor({ type: session.actorType });
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
      const status = error.code === 'TOO_MANY_ATTEMPTS' ? 429 : 401;
      if (error.retryAfterSeconds !== undefined) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      response.status(status).json({
        error: { code: error.code, message: error.message, requestId },
      });
      return;
    }
    if (error instanceof CashierAccountError) {
      const status = error.code === 'EMPLOYEE_NOT_FOUND' || error.code === 'ACCOUNT_NOT_FOUND' ? 404 : 409;
      response.status(status).json({
        error: { code: error.code, message: error.message, requestId },
      });
      return;
    }
    next(error);
  };
  router.use(authErrorHandler);

  return router;
};
