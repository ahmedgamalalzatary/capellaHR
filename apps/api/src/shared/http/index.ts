import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header('x-request-id'); const requestId = supplied && /^[\w.-]{1,64}$/.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId; response.setHeader('x-request-id', requestId); next();
};
export const responseRequestId = (response: { locals: Record<string, unknown> }) => typeof response.locals.requestId === 'string' ? response.locals.requestId : randomUUID();

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'المورد غير موجود', requestId: responseRequestId(response) } });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  const malformedJson = error instanceof SyntaxError && Reflect.get(error, 'status') === 400;
  response.status(malformedJson ? 400 : 500).json({ error: { code: malformedJson ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: malformedJson ? 'بيانات JSON غير صالحة' : 'حدث خطأ داخلي', requestId: responseRequestId(response) } });
};
