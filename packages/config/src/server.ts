import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  WEBAUTHN_RP_NAME: z.string().min(1).default('Capella HR'),
  WEBAUTHN_RP_ID: z.string().min(1).regex(/^[a-z0-9.-]+$/).optional(),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(1),
}).superRefine((value, context) => {
  const origin = new URL(value.WEB_ORIGIN);
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') context.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'Production WebAuthn requires HTTPS' });
  if (value.WEBAUTHN_RP_ID && origin.hostname !== value.WEBAUTHN_RP_ID && !origin.hostname.endsWith(`.${value.WEBAUTHN_RP_ID}`)) context.addIssue({ code: 'custom', path: ['WEBAUTHN_RP_ID'], message: 'WebAuthn RP ID must equal the origin hostname or be its parent domain' });
});

export const parseServerEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);

export const env = parseServerEnv(process.env);
