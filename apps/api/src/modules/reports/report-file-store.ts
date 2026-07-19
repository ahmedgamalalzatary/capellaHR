import type { ReportSnapshot } from '@capella/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { ReportFileStore } from './reports-service.js';

const storagePattern = /^reports\/([1-9]\d*)-([A-Za-z0-9-]+)\.pdf$/;

const filenameFor = (storagePath: string) => {
  const match = storagePattern.exec(storagePath);
  if (!match) throw new Error('Invalid report storage path');
  return path.basename(storagePath);
};

export const createReportFileStore = (root: string): ReportFileStore => ({
  async save(exportId, write) {
    await mkdir(root, { recursive: true });
    const filename = `${exportId}-${randomUUID()}.pdf`;
    const temporary = path.join(root, `.${filename}.${randomUUID()}.tmp`);
    const destination = path.join(root, filename);
    const hash = createHash('sha256');
    let sizeBytes = 0;
    const meter = new PassThrough();
    meter.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      sizeBytes += chunk.length;
    });
    const writing = pipeline(meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    try {
      await write(meter);
      await writing;
      await rename(temporary, destination);
    } catch (error) {
      meter.destroy();
      await writing.catch(() => undefined);
      await rm(temporary, { force: true });
      throw error;
    }
    return {
      storagePath: `reports/${filename}`,
      sha256: hash.digest('hex'),
      sizeBytes,
    };
  },

  async openRead(storagePath) {
    const handle = await open(path.join(root, filenameFor(storagePath)), 'r');
    return handle.createReadStream();
  },

  async createSpool() {
    const spoolRoot = path.join(root, '.spool');
    await mkdir(spoolRoot, { recursive: true, mode: 0o700 });
    const spoolPath = path.join(spoolRoot, `${randomUUID()}.ndjson`);
    await appendFile(spoolPath, '', { flag: 'wx', mode: 0o600 });
    return {
      async append(rows) {
        await appendFile(spoolPath, `${JSON.stringify(rows)}\n`, 'utf8');
      },
      async *rows() {
        const handle = await open(spoolPath, 'r');
        const input = handle.createReadStream();
        const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
        try {
          for await (const line of lines) {
            if (line) yield JSON.parse(line) as ReportSnapshot['rows'];
          }
        } finally {
          lines.close();
          input.destroy();
        }
      },
      async dispose() {
        await rm(spoolPath, { force: true });
      },
    };
  },

  async delete(storagePath) {
    await rm(path.join(root, filenameFor(storagePath)), { force: true });
  },

  async removeOrphans(referenced, staleBefore) {
    let removed = 0;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      const isFinal = /^([1-9]\d*)-([A-Za-z0-9-]+)\.pdf$/.test(entry.name);
      const isTemporary = /^\.([1-9]\d*)-([A-Za-z0-9-]+)\.pdf\.([A-Za-z0-9-]+)\.tmp$/.test(entry.name);
      if (!isFinal && !isTemporary) continue;
      if (isFinal && referenced.has(`reports/${entry.name}`)) continue;
      const filePath = path.join(root, entry.name);
      if ((await stat(filePath)).mtime > staleBefore) continue;
      await rm(filePath, { force: true });
      removed += 1;
    }
    const spoolRoot = path.join(root, '.spool');
    for (const entry of await readdir(spoolRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith('.ndjson')) continue;
      const spoolPath = path.join(spoolRoot, entry.name);
      if ((await stat(spoolPath)).mtime > staleBefore) continue;
      await rm(spoolPath, { force: true });
      removed += 1;
    }
    return removed;
  },
});
