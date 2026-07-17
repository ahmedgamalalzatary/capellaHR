import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmployeeUploadStore } from '../../src/modules/employees/employee-upload-store.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
describe('employee upload store', () => {
  it('detects actual image content and stores a safe private filename', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-employee-')); roots.push(root); const store = createEmployeeUploadStore(root);
    const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const saved = await store.save({ buffer, size: buffer.length, originalname: '../photo.jpg' } as Express.Multer.File);
    expect(saved.mimeType).toBe('image/png'); expect(saved.storagePath).toMatch(/^employees\/[\w-]+\.png$/); expect(await store.read(saved.storagePath)).toEqual(buffer);
  });
  it('rejects a fake image regardless of its extension', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'capella-employee-')); roots.push(root);
    await expect(createEmployeeUploadStore(root).save({ buffer: Buffer.from('not image'), size: 9, originalname: 'fake.png' } as Express.Multer.File)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});
