import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { createReportFileStore } from '../../src/modules/reports/index.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('report file store', () => {
  it('atomically stores a private PDF with verified metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-reports-'));
    roots.push(root);
    const store = createReportFileStore(root);
    const buffer = Buffer.from('%PDF-1.7\nreport');

    const saved = await store.save(42, async (output) => {
      Readable.from(buffer).pipe(output);
    });

    expect(saved.storagePath).toMatch(/^reports\/42-[\w-]+\.pdf$/);
    expect(saved.sizeBytes).toBe(buffer.length);
    expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
    const stream = await store.openRead(saved.storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      else chunks.push(Buffer.from(String(chunk)));
    }
    expect(Buffer.concat(chunks)).toEqual(buffer);
  });

  it('rejects path traversal and unrelated storage paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-reports-'));
    roots.push(root);
    const store = createReportFileStore(root);

    await expect(store.openRead('../secret.pdf')).rejects.toThrow('Invalid report storage path');
    await expect(store.openRead('employees/file.pdf')).rejects.toThrow('Invalid report storage path');
  });

  it('deletes a stored file idempotently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-reports-'));
    roots.push(root);
    const store = createReportFileStore(root);
    const first = await store.save(1, async (output) => {
      Readable.from(Buffer.from('%PDF first')).pipe(output);
    });
    await store.delete(first.storagePath);
    await store.delete(first.storagePath);
    await expect(store.openRead(first.storagePath)).rejects.toThrow();
    await expect(readFile(path.join(root, path.basename(first.storagePath)))).rejects.toThrow();
  });

  it('spools rows as a repeatable private source and disposes it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-reports-'));
    roots.push(root);
    const store = createReportFileStore(root);
    const spool = await store.createSpool();
    await spool.append([{ id: 1 }, { id: 2 }]);
    await spool.append([{ id: 3 }]);

    const readRows = async () => {
      const result = [];
      for await (const batch of spool.rows()) result.push(...batch);
      return result;
    };
    await expect(readRows()).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await expect(readRows()).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await spool.dispose();
    await expect(readRows()).rejects.toThrow();
  });

  it('reconciles stale final and temporary files that no export references', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-reports-'));
    roots.push(root);
    const store = createReportFileStore(root);
    const orphan = await store.save(9, async (output) => {
      Readable.from(Buffer.from('%PDF orphan')).pipe(output);
    });
    const temporary = path.join(root, '.9-orphan.pdf.abandoned.tmp');
    await writeFile(temporary, 'partial', { mode: 0o600 });

    await expect(store.removeOrphans(new Set(), new Date(Date.now() + 60_000))).resolves.toBe(2);
    await expect(store.openRead(orphan.storagePath)).rejects.toThrow();
    await expect(readFile(temporary)).rejects.toThrow();
  });
});
