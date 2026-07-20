import type { RequestHandler } from 'express';
import { responseRequestId } from '../../shared/http/index.js';
import { setAuditActor } from '../audit/index.js';

import type { AuthService } from './auth-service.js';

const readSessionToken = (cookieHeader: string | undefined) => {
  if (!cookieHeader) return '';
  for (const section of cookieHeader.split(';')) {
    const [name, ...value] = section.trim().split('=');
    if (name === 'capella_session') { try { return decodeURIComponent(value.join('=')); } catch { return ''; } }
  }
  return '';
};

const reject = (status: number, code: string, message: string): RequestHandler => (_request, response) => {
  response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } });
};

export const createAuthMiddleware = (service: Pick<AuthService, 'authenticate'>) => {
  const authenticate: RequestHandler = async (request, response, next) => {
    const session = await service.authenticate(readSessionToken(request.headers.cookie));
    if (!session) {
      reject(401, 'UNAUTHENTICATED', 'يجب تسجيل الدخول')(request, response, next);
      return;
    }
    response.locals.actor = session.actorType === 'admin'
      ? { type: 'admin' as const }
      : { type: 'employee' as const, employeeId: session.employeeId };
    setAuditActor(session.actorType === 'admin'
      ? { type: 'admin', identifier: 'admin' }
      : { type: 'employee', identifier: String(session.employeeId) });
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

  return { authenticate, requireAdmin, requireEmployee };
};
