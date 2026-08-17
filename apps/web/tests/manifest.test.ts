import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';

const appRoot = path.resolve(import.meta.dirname, '..');

describe('hr web app manifest', () => {
  it('is installable as a standalone app', () => {
    const result = manifest();

    expect(result.display).toBe('standalone');
    expect(result.start_url).toBe('/');
    expect(result.short_name).toBeTruthy();
  });

  it('declares any and maskable icons in the required sizes', () => {
    const icons = manifest().icons ?? [];

    expect(icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('ships every icon file referenced by the manifest', () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(path.join(appRoot, 'public', String(icon.src)))).toBe(true);
    }
  });

  it('ships the browser tab and iOS home screen icons', () => {
    expect(existsSync(path.join(appRoot, 'src/app/icon.png'))).toBe(true);
    expect(existsSync(path.join(appRoot, 'src/app/apple-icon.png'))).toBe(true);
  });
});
