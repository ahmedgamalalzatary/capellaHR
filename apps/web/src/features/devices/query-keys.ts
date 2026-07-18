/** Keeps device lists and per-device history under one feature-owned cache root. */
export const deviceQueryKeys = {
  all: ['devices'] as const,
  list: <T extends object>(filters: T) => ['devices', 'list', filters] as const,
  history: (deviceId: number) => ['devices', 'history', deviceId] as const,
};
