export const SESSION_COOKIE = 'capella_session';

export const readSessionCookie = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) return null;
  for (const section of cookieHeader.split(';')) {
    const separator = section.indexOf('=');
    if (separator < 0) continue;
    if (section.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(section.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};
