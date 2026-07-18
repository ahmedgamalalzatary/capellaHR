import { z } from 'zod';

const webOriginSchema = z.string().url().transform((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'WEB_ORIGIN must use HTTP or HTTPS' });
    return z.NEVER;
  }
  return url.origin;
});

const timeZoneSchema = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, 'APP_TIME_ZONE must be a supported IANA time zone');

const localeSchema = z.string().min(1).refine((value) => {
  try {
    const canonicalLocales = Intl.getCanonicalLocales(value);
    return Intl.DateTimeFormat.supportedLocalesOf(canonicalLocales).length === canonicalLocales.length
      && Intl.NumberFormat.supportedLocalesOf(canonicalLocales).length === canonicalLocales.length;
  } catch {
    return false;
  }
}, 'APP_LOCALE must be a supported Intl locale');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  APP_TIME_ZONE: timeZoneSchema.default('Africa/Cairo'),
  APP_LOCALE: localeSchema.default('ar-EG-u-nu-latn'),
  MAX_EMPLOYEE_IMAGE_BYTES: z.coerce.number().int().positive().max(16_777_216).default(16_777_216),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(10).optional(),
  WEB_ORIGIN: webOriginSchema.default('http://localhost:3000'),
  WEBAUTHN_RP_NAME: z.string().min(1).default('Capella HR'),
  WEBAUTHN_RP_ID: z.string().min(1).regex(/^[a-z0-9.-]+$/).optional(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(1),
}).superRefine((value, context) => {
  if (typeof value.WEB_ORIGIN !== 'string') return;
  const origin = new URL(value.WEB_ORIGIN);
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'Production WebAuthn requires HTTPS' });
  if (value.WEBAUTHN_RP_ID && origin.hostname !== value.WEBAUTHN_RP_ID && !origin.hostname.endsWith(`.${value.WEBAUTHN_RP_ID}`)) context.addIssue({ code: 'custom', path: ['WEBAUTHN_RP_ID'], message: 'WebAuthn RP ID must equal the origin hostname or be its parent domain' });
});

export const parseServerEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);

export const env = parseServerEnv(process.env);
