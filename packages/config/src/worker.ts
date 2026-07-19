import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  APP_TIME_ZONE: z.literal('Africa/Cairo').default('Africa/Cairo'),
  REPORT_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  REPORT_FILES_ROOT: z.string().trim().min(1).max(500).optional(),
}).strip();

export const parseWorkerEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);

export const workerEnv = parseWorkerEnv(process.env);
