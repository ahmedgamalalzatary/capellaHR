import type { Express, Request, Response } from "express";
import { signInSchema } from "@capella/shared";
import { z } from "zod";
import { getAppConfig } from "../../config/app-config";
import { type createAuthService } from "./service";
import { getAuthService } from "./runtime";

const adminSignInSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8)
});

type RegisterAuthRoutesOptions = {
  authService?: ReturnType<typeof createAuthService>;
};

export function registerAuthRoutes(app: Express, options: RegisterAuthRoutesOptions = {}) {
  const config = getAppConfig();
  const resolveAuthService = async () => options.authService ?? getAuthService();

  app.post("/auth/sign-in", async (request: Request, response: Response) => {
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

    const authService = await resolveAuthService();
    const result = await authService.signInEmployee(parsed.data);

    if ("error" in result) {
      response.status(401).json(result);
      return;
    }

    response.cookie(config.auth.cookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.auth.cookieSecure,
      expires: result.expiresAt,
      path: "/"
    });

    response.status(200).json({
      actor: result.actor
    });
  });

  app.post("/auth/admin/sign-in", async (request: Request, response: Response) => {
    const parsed = adminSignInSchema.safeParse(request.body);

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

    const authService = await resolveAuthService();
    const result = await authService.signInAdmin(parsed.data);

    if ("error" in result) {
      response.status(401).json(result);
      return;
    }

    response.cookie(config.auth.cookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.auth.cookieSecure,
      expires: result.expiresAt,
      path: "/"
    });

    response.status(200).json({
      actor: result.actor
    });
  });

  app.get("/auth/me", async (request: Request, response: Response) => {
    const authService = await resolveAuthService();
    const sessionToken = request.cookies?.[config.auth.cookieName];

    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    const actor = await authService.getSessionActor(sessionToken);

    if (!actor) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          details: {}
        }
      });
      return;
    }

    response.status(200).json({ actor });
  });

  app.post("/auth/sign-out", async (request: Request, response: Response) => {
    const authService = await resolveAuthService();
    const sessionToken = request.cookies?.[config.auth.cookieName];

    if (typeof sessionToken === "string" && sessionToken.length > 0) {
      await authService.signOut(sessionToken);
    }

    response.clearCookie(config.auth.cookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.auth.cookieSecure,
      path: "/"
    });
    response.status(204).send();
  });
}
