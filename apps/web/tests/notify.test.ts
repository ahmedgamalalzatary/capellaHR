import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ApiError } from '../src/lib/api/client';
import { notifyError, notifySuccess } from '../src/lib/notify';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const FEATURES_DIR = join(__dirname, '..', 'src', 'features');

// Login forms surface inline field errors + redirect on success; a toast
// would duplicate the inline error and fire-and-forget on navigation.
// Kiosk attendance (device-attendance-view) is a high-throughput shared
// terminal where a toast per check-in would spam the next employee.
const NOTIFY_COVERAGE_EXCEPTIONS = new Set([
  'auth/components/admin-login-form.tsx',
  'auth/components/employee-login-form.tsx',
  'attendance/components/device-attendance-view.tsx',
]);

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

beforeEach(() => vi.clearAllMocks());

describe('notify', () => {
  test('notifySuccess forwards the message to toast.success', () => {
    notifySuccess('تم الحفظ بنجاح.');
    expect(toast.success).toHaveBeenCalledWith('تم الحفظ بنجاح.');
  });

  test('notifyError surfaces the ApiError message', () => {
    notifyError(new ApiError(400, { code: 'BAD', message: 'بيانات غير صالحة.' }));
    expect(toast.error).toHaveBeenCalledWith('بيانات غير صالحة.');
  });

  test('notifyError surfaces plain Error messages and falls back otherwise', () => {
    notifyError(new Error('شبكة.'));
    expect(toast.error).toHaveBeenCalledWith('شبكة.');
    notifyError(null);
    expect(toast.error).toHaveBeenCalledWith('تعذر تنفيذ العملية.');
  });

  test('every mutation view provides success or error feedback', () => {
    const missing = collectTsx(FEATURES_DIR)
      .map((full) => ({
        rel: full.substring(FEATURES_DIR.length + 1).replace(/\\/g, '/'),
        text: readFileSync(full, 'utf-8'),
      }))
      .filter(({ text }) => text.includes('useMutation'))
      .filter(({ text }) => !text.includes('notifySuccess') && !text.includes('notifyError') && !text.includes('toast.'))
      .map(({ rel }) => rel)
      .filter((rel) => !NOTIFY_COVERAGE_EXCEPTIONS.has(rel));

    expect(missing).toEqual([]);
  });
});
