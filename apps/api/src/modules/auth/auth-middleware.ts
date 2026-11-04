import type { RequestHandler } from 'express';
import { responseRequestId } from '../../shared/http/index.js';
import { setAuditActor } from '../audit/index.js';

import type { AuthService } from './auth-service.js';
import { readSessionCookie } from './session-cookie.js';

const reject = (status: number, code: string, message: string): RequestHandler => (_request, response) => {
  response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } });
};

export const createAuthMiddleware = (service: Pick<AuthService, 'authenticate'>) => {
  const authenticate: RequestHandler = async (request, response, next) => {
    const session = await service.authenticate(readSessionCookie(request.headers.cookie) ?? '');
    if (!session) {
      reject(401, 'UNAUTHENTICATED', 'يجب تسجيل الدخول')(request, response, next);
      return;
    }
    const branchId = (session as { branchId?: number | null }).branchId;
    response.locals.actor = session.actorType === 'admin' || session.accountRole === 'admin'
      ? { type: 'admin' as const, ...(session.accountId ? { accountId: session.accountId } : {}) }
      : session.actorType === 'employee'
        ? { type: 'employee' as const, employeeId: session.employeeId }
        : (session.accountRole === 'cashier' || session.accountRole === 'reception')
          && session.accountId && typeof branchId === 'number'
          ? {
              type: session.accountRole,
              accountId: session.accountId,
              branchId,
            }
          : null;
    if (!response.locals.actor) {
      reject(401, 'UNAUTHENTICATED', 'يجب تسجيل الدخول')(request, response, next);
      return;
    }
    setAuditActor(session.actorType === 'admin'
      ? { type: 'admin', identifier: 'admin' }
      : session.actorType === 'employee'
        ? { type: 'employee', identifier: String(session.employeeId) }
        : { type: 'account', identifier: String(session.accountId) });
    next();
  };

  const requireAdmin: RequestHandler = (request, response, next) => {
    const actor = response.locals.actor as { type?: string } | undefined;
    if (actor?.type !== 'admin') {
      reject(403, 'FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء')(request, response, next);
      return;
    }
    next();
  };

  const requireEmployee: RequestHandler = (request, response, next) => {
    const actor = response.locals.actor as { type?: string } | undefined;
    if (actor?.type !== 'employee') {
      reject(403, 'FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء')(request, response, next);
      return;
    }
    next();
  };

  const requireErpAccount: RequestHandler = (request, response, next) => {
    const actor = response.locals.actor as { type?: string } | undefined;
    if (actor?.type !== 'admin' && actor?.type !== 'cashier') {
      reject(403, 'FORBIDDEN', 'غير مصرح لك بتنفيذ هذا الإجراء')(request, response, next);
      return;
    }
    next();
  };

  /**
   * Front-desk areas: Admin and Cashier keep full access, while a Reception
   * login may only read. Any other ERP area stays behind `requireErpAccount`,
   * which never admits Reception.
   */
  const requireErpReader: RequestHandler = (request, response, next) => {
    const actor = response.locals.actor as { type?: string } | undefined;
    if (actor?.type === 'reception' && (request.method === 'GET' || request.method === 'HEAD')) {
      next();
      return;
    }
    requireErpAccount(request, response, next);
  };

  /**
   * Areas where a Reception login works like the cashier (read and change).
   * The composition root still holds it to the shift the cashier opened.
   */
  const requireErpFrontDesk: RequestHandler = (request, response, next) => {
    if ((response.locals.actor as { type?: string } | undefined)?.type === 'reception') {
      next();
      return;
    }
    requireErpAccount(request, response, next);
  };

  return {
    authenticate, requireAdmin, requireEmployee, requireErpAccount, requireErpReader, requireErpFrontDesk,
  };
};
