import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import pino, { type DestinationStream, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import { runWithAuditContext } from '../../modules/audit/index.js';

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-request-id');
  const requestId = supplied && /^[\w.-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  runWithAuditContext({
    actorType: 'system',
    actorIdentifier: 'system',
    requestId,
    ipAddress: request.ip?.slice(0, 45) ?? null,
    userAgent: request.header('user-agent')?.slice(0, 1024) ?? null,
  }, next);
};

export const responseRequestId = (response: { locals: Record<string, unknown> }) => (
  typeof response.locals.requestId === 'string' ? response.locals.requestId : randomUUID()
);

export const createApiLogger = (level: string, destination?: DestinationStream) => pino({
  level,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    censor: '[REDACTED]',
  },
}, destination);

export const createRequestLogger = (logger: Logger): RequestHandler => pinoHttp({
  logger,
  quietReqLogger: true,
  quietResLogger: true,
  genReqId: (_request, response) => responseRequestId(response),
  customAttributeKeys: { reqId: 'requestId' },
  customLogLevel: (_request, response, error) => {
    if (error || response.statusCode >= 500) return 'error';
    if (response.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: () => 'API request completed',
  customErrorMessage: () => 'API request failed',
  customSuccessObject: (request, response, value) => ({
    method: request.method,
    url: (request as typeof request & { originalUrl?: string }).originalUrl ?? request.url,
    requestId: responseRequestId(response),
    statusCode: response.statusCode,
    responseTime: (value as { responseTime: number }).responseTime,
  }),
  customErrorObject: (request, response, error, value) => ({
    err: error,
    method: request.method,
    url: (request as typeof request & { originalUrl?: string }).originalUrl ?? request.url,
    requestId: responseRequestId(response),
    statusCode: response.statusCode,
    responseTime: (value as { responseTime: number }).responseTime,
  }),
});

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'المورد غير موجود', requestId: responseRequestId(response) },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) {
    _next(error);
    return;
  }
  const malformedJson = error instanceof SyntaxError && Reflect.get(error, 'status') === 400;
  const payloadTooLarge = typeof error === 'object' && error !== null
    && Reflect.get(error, 'status') === 413
    && Reflect.get(error, 'type') === 'entity.too.large';
  const status = malformedJson ? 400 : payloadTooLarge ? 413 : 500;
  const code = malformedJson ? 'VALIDATION_ERROR' : payloadTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR';
  const message = malformedJson
    ? 'بيانات JSON غير صالحة'
    : payloadTooLarge
      ? 'حجم الطلب أكبر من الحد المسموح'
      : 'حدث خطأ داخلي';
  if (status === 500) {
    const requestId = responseRequestId(response);
    request.log?.error({ err: error, requestId }, 'Unhandled API request error');
    response.err = error instanceof Error ? error : new Error(String(error));
  }
  response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } });
};
