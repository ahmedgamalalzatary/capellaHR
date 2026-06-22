import type { Express, Request, Response } from "express";

export function registerNotFoundHandler(app: Express) {
  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        details: {}
      }
    });
  });
}
