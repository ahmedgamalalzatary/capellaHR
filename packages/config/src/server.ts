import { z } from 'zod';

const webOriginSchema = z.string().url().transform((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'WEB_ORIGIN must use HTTP or HTTPS' });
    return z.NEVER;
  }
  return url.origin;
});

const timeZoneSchema = z.string().refine(
  (value) => value === 'Africa/Cairo',
  'APP_TIME_ZONE must be Africa/Cairo',
);

const localeSchema = z.string().refine(
  (value) => value === 'ar-EG-u-nu-latn',
  'APP_LOCALE must be ar-EG-u-nu-latn',
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  APP_TIME_ZONE: timeZoneSchema.default('Africa/Cairo'),
  APP_LOCALE: localeSchema.default('ar-EG-u-nu-latn'),
  MAX_EMPLOYEE_IMAGE_BYTES: z.coerce.number().int().positive().max(16_777_216).default(16_777_216),
  REPORT_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  REPORT_FILES_ROOT: z.string().trim().min(1).max(500).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(10).optional(),
  WEB_ORIGIN: webOriginSchema.default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(1),
});

export const parseServerEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);

export const env = parseServerEnv(process.env);
