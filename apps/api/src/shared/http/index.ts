import type { ErrorRequestHandler, RequestHandler } from 'express';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
};

export const errorHandler: ErrorRequestHandler = (_error, _request, response, _next) => {
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error' } });
};
