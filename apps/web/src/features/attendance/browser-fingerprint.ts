export function createBrowserFingerprint() {
  const screenSize =
    typeof window === "undefined" || !window.screen
      ? "unknown-screen"
      : `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;

  return [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    screenSize
  ].join("|");
}
