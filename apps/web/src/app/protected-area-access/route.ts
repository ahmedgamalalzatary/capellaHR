import { timingSafeEqual } from 'node:crypto';

const json = (body: object, status: number) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  const configuredPassword = process.env['PROTECTED_TAB_PASSWORD'];
  if (!configuredPassword) return json({ error: 'NOT_CONFIGURED' }, 503);

  let submittedPassword: unknown;
  try {
    submittedPassword = (await request.json() as { password?: unknown }).password;
  } catch {
    return json({ error: 'INVALID_PASSWORD' }, 401);
  }

  if (typeof submittedPassword !== 'string') {
    return json({ error: 'INVALID_PASSWORD' }, 401);
  }

  const configured = Buffer.from(configuredPassword);
  const submitted = Buffer.from(submittedPassword);
  const matches = configured.length === submitted.length && timingSafeEqual(configured, submitted);

  return matches
    ? json({ unlocked: true }, 200)
    : json({ error: 'INVALID_PASSWORD' }, 401);
}
