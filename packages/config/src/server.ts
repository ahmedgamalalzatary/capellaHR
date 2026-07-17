import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().startsWith('$argon2'),
});

export const env = schema.parse(process.env);
