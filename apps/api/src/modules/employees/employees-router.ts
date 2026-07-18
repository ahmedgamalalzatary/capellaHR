import { createEmployeeFieldsSchema, employeeIdParamsSchema, employeeImageParamsSchema, listEmployeesQuerySchema, updateEmployeeFieldsSchema } from '@capella/contracts';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { createAuthMiddleware } from '../auth/auth-middleware.js';
import type { AuthService } from '../auth/auth-service.js';
import { EmployeeUploadError, type EmployeeUploadStore } from './employee-upload-store.js';
import { EmployeeError, type EmployeeImages, type EmployeeService, type ImageKind } from './employees-service.js';
import { responseRequestId } from '../../shared/http/index.js';
const fail = (res: Response, status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) => res.status(status).json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}), requestId: responseRequestId(res) } });
const handle = (error: unknown, res: Response) => {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join('.') || '_root';
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return fail(res, 400, 'VALIDATION_ERROR', 'بيانات الطلب غير صالحة', fieldErrors);
  }
  if (error instanceof multer.MulterError) {
    return error.code === 'LIMIT_FILE_SIZE'
      ? fail(res, 400, 'IMAGE_TOO_LARGE', 'حجم الصورة يتجاوز الحد الأقصى المسموح')
      : fail(res, 400, 'INVALID_IMAGE', 'ملف الصورة غير صالح');
  }
  if (error instanceof EmployeeUploadError) return fail(res, 400, error.code, error.message);
  if (error instanceof EmployeeError) return fail(res, error.code === 'EMPLOYEE_NOT_FOUND' || error.code === 'EMPLOYEE_BRANCH_NOT_FOUND' ? 404 : error.code === 'EMPLOYEE_ATTENDANCE_UNAVAILABLE' ? 503 : 409, error.code, error.message);
  throw error;
};
// Multipart field names are part of the public employee-image API contract.
const fields = [{ name: 'personal', maxCount: 1 }, { name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 }];
export const createEmployeesRouter = (service: EmployeeService, authService: Pick<AuthService, 'authenticate'>, maxImageBytes: number, store?: EmployeeUploadStore) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxImageBytes, files: 3 } });
  const acceptUploads = (request: Request, response: Response, next: NextFunction) => upload.fields(fields)(request, response, (error) => { if (error) handle(error, response); else next(); });
  const router = Router(); const auth = createAuthMiddleware(authService); router.use(auth.authenticate, auth.requireAdmin);
  const compensate = async (paths: string[]) => {
    if (!store) return;
    for (const storagePath of paths) try { await store.remove(storagePath); } catch (error) {
      try { await store.recordCleanupFailure(storagePath, error); } catch { process.emitWarning('Failed to persist pending employee-image cleanup'); }
    }
  };
  router.get('/', async (req, res) => { try { const query = listEmployeesQuerySchema.parse(req.query); const result = await service.list(query); res.json({ data: result.items, meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) } }); } catch (e) { handle(e, res); } });
  router.get('/:id', async (req, res) => { try { res.json({ data: await service.get(employeeIdParamsSchema.parse(req.params).id) }); } catch (e) { handle(e, res); } });
  router.post('/', acceptUploads, async (req, res) => {
    const saved: string[] = [];
    try {
      if (!store) throw new EmployeeUploadError('IMAGE_REQUIRED', 'مخزن الصور غير متاح');
      const files = req.files as Record<ImageKind, Express.Multer.File[]>; const images = {} as EmployeeImages;
      for (const kind of ['personal', 'idFront', 'idBack'] as const) { if (!files?.[kind]?.[0]) throw new EmployeeUploadError('IMAGE_REQUIRED', `الصورة ${kind} مطلوبة`); images[kind] = await store.save(files[kind][0]); saved.push(images[kind].storagePath); }
      res.status(201).json({ data: await service.create({ ...createEmployeeFieldsSchema.parse(req.body), images }) });
    } catch (e) { await compensate(saved); handle(e, res); }
  });
  router.patch('/:id', acceptUploads, async (req, res) => {
    const saved: string[] = [];
    let committed = false;
    try {
      const id = employeeIdParamsSchema.parse(req.params).id; const files = req.files as Record<ImageKind, Express.Multer.File[]>; const images: Partial<EmployeeImages> = {};
      if (files && !store) throw new EmployeeUploadError('INVALID_IMAGE', 'مخزن الصور غير متاح');
      if (store) for (const kind of ['personal', 'idFront', 'idBack'] as const) if (files?.[kind]?.[0]) { images[kind] = await store.save(files[kind][0]); saved.push(images[kind].storagePath); }
      const body: unknown = req.body; const parsed = body && typeof body === 'object' && Object.keys(body).length ? updateEmployeeFieldsSchema.parse(body) : {};
      const result = await service.update(id, { ...parsed, ...(Object.keys(images).length ? { images } : {}) });
      committed = true;
      if (store) for (const image of Object.values(result.replacedImages)) {
        if (!image) continue; const oldPath = image.storagePath;
        try { await store.remove(oldPath); }
        catch (error) { try { await store.recordCleanupFailure(oldPath, error); } catch { process.emitWarning('Failed to persist pending employee-image cleanup'); } }
      }
      res.json({ data: result.employee });
    } catch (e) { if (!committed) await compensate(saved); handle(e, res); }
  });
  router.get('/:id/images/:kind', async (req, res) => { try { if (!store) throw new EmployeeUploadError('INVALID_IMAGE', 'مخزن الصور غير متاح'); const params = employeeImageParamsSchema.parse(req.params); const employee = await service.get(params.id); const image = employee.images[params.kind]; res.type(image.mimeType).send(await store.read(image.storagePath)); } catch (e) { handle(e, res); } });
  router.delete('/:id', async (req, res) => { try { await service.remove(employeeIdParamsSchema.parse(req.params).id); res.status(204).send(); } catch (e) { handle(e, res); } });
  return router;
};
