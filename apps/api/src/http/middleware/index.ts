import express from "express";
import type { Express } from "express";

export function registerAppMiddleware(app: Express) {
  app.use(express.json());
}
