import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { ImageMetadata } from './employees-service.js';
export class EmployeeUploadError extends Error { constructor(public readonly code: 'IMAGE_REQUIRED' | 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE', message: string) { super(message); } }
export const createEmployeeUploadStore = (root: string) => ({
  async save(file: Express.Multer.File): Promise<ImageMetadata> {
    if (file.size > 16 * 1024 * 1024) throw new EmployeeUploadError('IMAGE_TOO_LARGE', 'حجم الصورة يتجاوز 16 ميجابايت');
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected?.mime.startsWith('image/')) throw new EmployeeUploadError('INVALID_IMAGE', 'محتوى الملف ليس صورة صالحة');
    await mkdir(root, { recursive: true }); const filename = `${randomUUID()}.${detected.ext}`; await writeFile(path.join(root, filename), file.buffer);
    return { storagePath: `employees/${filename}`, originalName: path.basename(file.originalname).slice(0, 255), mimeType: detected.mime, sizeBytes: file.size };
  },
  read(storagePath: string) { return readFile(path.join(root, path.basename(storagePath))); },
  remove(storagePath: string) { return rm(path.join(root, path.basename(storagePath)), { force: true }); },
  async recordCleanupFailure(storagePath: string, error: unknown) {
    await mkdir(root, { recursive: true });
    const message = error instanceof Error ? error.message : 'unknown cleanup error';
    await appendFile(path.join(root, '.pending-image-cleanup.jsonl'), `${JSON.stringify({ storagePath: `employees/${path.basename(storagePath)}`, message, recordedAt: new Date().toISOString() })}\n`, 'utf8');
  },
  async retryPendingCleanup() {
    const ledger = path.join(root, '.pending-image-cleanup.jsonl');
    let lines: string[]; try { lines = (await readFile(ledger, 'utf8')).split('\n').filter(Boolean); } catch { return; }
    const remaining: string[] = [];
    for (const line of lines) try {
      const entry = JSON.parse(line) as { storagePath?: string }; if (!entry.storagePath) continue;
      await rm(path.join(root, path.basename(entry.storagePath)), { force: true });
    } catch { remaining.push(line); }
    await writeFile(ledger, remaining.length ? `${remaining.join('\n')}\n` : '', 'utf8');
  },
});
export type EmployeeUploadStore = ReturnType<typeof createEmployeeUploadStore>;
