/**
 * The single place the session cookie is named and parsed.
 *
 * Issuing, reading, and clearing all route through here so the name cannot drift, and so
 * every entry point agrees on what a given Cookie header means. The router and the
 * authorization middleware previously carried separate parsers that agreed on well-formed
 * browser output and diverged on padded names and values, which made a header the session
 * endpoint accepted fail on every other route.
 */
export const SESSION_COOKIE = 'capella_session';

/** Returns the session token from a Cookie header, or null when it carries none. */
export const readSessionCookie = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) return null;
  for (const section of cookieHeader.split(';')) {
    const separator = section.indexOf('=');
    if (separator < 0) continue;
    if (section.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    // A malformed percent-escape throws; treat it as no cookie rather than a 500.
    try {
      return decodeURIComponent(section.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};
