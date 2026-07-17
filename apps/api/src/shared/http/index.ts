import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-request-id');
  const requestId = supplied && /^[\w.-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
};

export const responseRequestId = (response: { locals: Record<string, unknown> }) => (
  typeof response.locals.requestId === 'string' ? response.locals.requestId : randomUUID()
);

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'المورد غير موجود', requestId: responseRequestId(response) },
  });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
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
  response.status(status).json({ error: { code, message, requestId: responseRequestId(response) } });
};
