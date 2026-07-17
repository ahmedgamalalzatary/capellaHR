const MARKER_STORAGE_KEY = 'capella-device-installation-marker';

/** Stable random marker identifying this browser installation across pairings. */
export function installationMarker(): string {
  const existing = window.localStorage.getItem(MARKER_STORAGE_KEY);
  if (existing && existing.length >= 16) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const marker = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  window.localStorage.setItem(MARKER_STORAGE_KEY, marker);
  return marker;
}

export function detectBrowser(userAgent: string): string {
  if (/edg(a|ios)?\//i.test(userAgent)) return 'Edge';
  if (/opr\//i.test(userAgent)) return 'Opera';
  if (/samsungbrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/chrome|crios/i.test(userAgent)) return 'Chrome';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return 'متصفح غير معروف';
}

export function detectPlatform(userAgent: string): string {
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'نظام غير معروف';
}
