import { createHash, timingSafeEqual } from 'node:crypto';

import { resolveApiProxyTarget } from '@capella/config/proxy';

const json = (body: object, status: number) => Response.json(body, { status });

type AttemptWindow = { count: number; startedAt: number };

const sessionToken = (request: Request) => {
  const cookie = request.headers.get('cookie');
  const encodedToken = cookie?.split(';').map((part) => part.trim()).find((part) => (
    part.startsWith('capella_session=')
  ))?.slice('capella_session='.length);
  if (!encodedToken) return null;
  try {
    return decodeURIComponent(encodedToken);
  } catch {
    return null;
  }
};

const sessionKey = (token: string) => (
  `session:${createHash('sha256').update(token).digest('hex')}`
);

const validateAdminSession = async (token: string) => {
  const apiBaseUrl = `${resolveApiProxyTarget()}/api/v1`;
  try {
    const response = await fetch(`${apiBaseUrl}/auth/session`, {
      headers: { cookie: `capella_session=${encodeURIComponent(token)}` },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const body = await response.json() as {
      data?: { actor?: { type?: string } };
    };
    return body.data?.actor?.type === 'admin';
  } catch {
    return false;
  }
};

export const createProtectedAreaAccessHandler = (options: {
  enforceSameOrigin?: boolean;
  now?: () => number;
  maximumAttempts?: number;
  maximumKeys?: number;
  selfOrigins?: readonly string[];
  validateSession?: (token: string) => Promise<boolean>;
  windowMs?: number;
} = {}) => {
  const now = options.now ?? Date.now;
  const sameOriginRequired = options.enforceSameOrigin ?? process.env.NODE_ENV === 'production';
  const maximumAttempts = options.maximumAttempts ?? 5;
  const maximumKeys = options.maximumKeys ?? 10_000;
  const validateSession = options.validateSession ?? validateAdminSession;
  const windowMs = options.windowMs ?? 5 * 60_000;
  const selfOrigins = options.selfOrigins
    ?? process.env['PUBLIC_ORIGINS']?.split(',').map((origin) => origin.trim()).filter(Boolean)
    ?? [];
  const canonicalOriginsByHost = new Map(selfOrigins.map((origin) => {
    const canonicalOrigin = new URL(origin).origin;
    return [new URL(canonicalOrigin).host.toLowerCase(), canonicalOrigin];
  }));
  const attempts = new Map<string, AttemptWindow>();

  return async (request: Request): Promise<Response> => {
    if (sameOriginRequired) {
      const origin = request.headers.get('origin');
      let normalizedOrigin: string | null = null;
      try {
        if (origin) normalizedOrigin = new URL(origin).origin;
      } catch {
        normalizedOrigin = null;
      }
      const requestHost = request.headers.get('host')?.toLowerCase();
      const expectedOrigin = requestHost
        ? canonicalOriginsByHost.get(requestHost)
        : undefined;
      if (!normalizedOrigin || normalizedOrigin !== expectedOrigin) {
        return json({ error: 'INVALID_ORIGIN' }, 403);
      }
    }

    const configuredPassword = process.env['PROTECTED_TAB_PASSWORD'];
    if (!configuredPassword) return json({ error: 'NOT_CONFIGURED' }, 503);

    const token = sessionToken(request);
    if (!token || !await validateSession(token)) {
      return json({ error: 'UNAUTHENTICATED' }, 401);
    }

    const key = sessionKey(token);
    const timestamp = now();
    for (const [storedKey, attempt] of attempts) {
      if (timestamp - attempt.startedAt >= windowMs) attempts.delete(storedKey);
    }
    const existing = attempts.get(key);
    const current = existing && timestamp - existing.startedAt < windowMs ? existing : null;
    if (current && current.count >= maximumAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil(
        (current.startedAt + windowMs - timestamp) / 1000,
      ));
      return Response.json(
        { error: 'TOO_MANY_ATTEMPTS' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      );
    }

    let submittedPassword: unknown;
    try {
      submittedPassword = (await request.json() as { password?: unknown }).password;
    } catch {
      submittedPassword = undefined;
    }

    const configured = Buffer.from(configuredPassword);
    const submitted = typeof submittedPassword === 'string'
      ? Buffer.from(submittedPassword)
      : null;
    const matches = submitted !== null
      && configured.length === submitted.length
      && timingSafeEqual(configured, submitted);

    if (matches) {
      attempts.delete(key);
      return json({ unlocked: true }, 200);
    }

    if (!current && !attempts.has(key) && attempts.size >= maximumKeys) {
      const oldestKey = attempts.keys().next().value as string | undefined;
      if (oldestKey !== undefined) attempts.delete(oldestKey);
    }
    attempts.set(key, current
      ? { ...current, count: current.count + 1 }
      : { count: 1, startedAt: timestamp });
    return json({ error: 'INVALID_PASSWORD' }, 401);
  };
};
