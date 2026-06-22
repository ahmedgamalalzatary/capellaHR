import cookieParser from "cookie-parser";
import express from "express";
import type { Express } from "express";

export function registerAppMiddleware(app: Express) {
  app.use(cookieParser());
  app.use(express.json());
}
