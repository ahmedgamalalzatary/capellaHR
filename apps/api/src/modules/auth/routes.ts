import type { Express, Request, Response } from "express";
import { signInSchema } from "@capella/shared";
import { signIn } from "./service";

export function registerAuthRoutes(app: Express) {
  app.post("/auth/sign-in", (request: Request, response: Response) => {
    const parsed = signInSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          details: parsed.error.flatten()
        }
      });
      return;
    }

    response.status(501).json(signIn(parsed.data));
  });
}
