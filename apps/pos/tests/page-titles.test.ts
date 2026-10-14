import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const protectedRoot = join(__dirname, '../src/app/(protected)');

const pages = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = join(directory, entry);
  if (statSync(path).isDirectory()) return pages(path);
  return entry === 'page.tsx' ? [path] : [];
});

describe('browser tab titles', () => {
  // The home page keeps the app default title; every other page names itself so
  // open tabs and history entries can be told apart.
  const titled = pages(protectedRoot).filter((path) => relative(protectedRoot, path) !== 'page.tsx');

  it.each(titled.map((path) => [relative(protectedRoot, path), path]))('%s declares a title', (_name, path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/export const metadata: Metadata = \{ title: '[^']+' \}/);
  });
});
