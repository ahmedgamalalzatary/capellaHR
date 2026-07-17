import { z } from 'zod';

const gpsReading = {
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  gpsAccuracyMeters: z.number().finite().nonnegative(),
};

// MySQL VARCHAR limits count characters (code points), not UTF-16 units.
const codePoints = (value: string) => [...value].length;

// The service persists name.trim().toLowerCase() into a varchar(255) column;
// lowercasing can lengthen some Unicode strings, so the limit applies to the
// normalized form as well.
const branchName = z.string().trim().min(1)
  .refine((value) => codePoints(value) <= 255 && codePoints(value.toLowerCase()) <= 255, {
    message: 'اسم الفرع طويل جدًا',
  });

const branchLocation = z.string().trim().min(1)
  .refine((value) => codePoints(value) <= 1000, { message: 'الموقع طويل جدًا' });

export const createBranchSchema = z.object({
  name: branchName,
  location: branchLocation,
  ...gpsReading,
  attendanceRadiusMeters: z.number().finite().positive(),
}).strict();

export const updateBranchSchema = z.object({
  name: branchName.optional(),
  location: branchLocation.optional(),
  latitude: gpsReading.latitude.optional(),
  longitude: gpsReading.longitude.optional(),
  gpsAccuracyMeters: gpsReading.gpsAccuracyMeters.optional(),
  attendanceRadiusMeters: z.number().finite().positive().optional(),
}).strict().superRefine((value, context) => {
  const supplied = [value.latitude, value.longitude, value.gpsAccuracyMeters].filter((item) => item !== undefined).length;
  if (supplied !== 0 && supplied !== 3) {
    context.addIssue({ code: 'custom', message: 'يجب إرسال قراءة GPS كاملة', path: ['latitude'] });
  }
  if (Object.keys(value).length === 0) {
    context.addIssue({ code: 'custom', message: 'يجب إرسال حقل واحد على الأقل' });
  }
});

// Upper bound matches the signed MySQL INT primary-key column.
export const branchIdParamsSchema = z.object({ id: z.coerce.number().int().positive().max(2147483647) });

export const listBranchesQuerySchema = z.object({
  search: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type ListBranchesQuery = z.infer<typeof listBranchesQuerySchema>;
