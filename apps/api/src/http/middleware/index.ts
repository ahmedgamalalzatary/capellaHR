import cookieParser from "cookie-parser";
import express from "express";
import type { Express } from "express";
import { corsMiddleware } from "./cors";

export function registerAppMiddleware(app: Express) {
  app.use(corsMiddleware);
  app.use(cookieParser());
  app.use(express.json());
}
