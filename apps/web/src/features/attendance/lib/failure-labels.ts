export const FACE_FAILURE_LABELS = {
  FACE_MISMATCH: 'الصورة لا تطابق صورة الموظف',
  FACE_NOT_FOUND: 'لم يتم العثور على وجه واضح',
  MULTIPLE_FACES: 'ظهر أكثر من وجه في الصورة',
  FACE_IMAGE_INVALID: 'صورة الكاميرا غير صالحة',
  FACE_COMPARISON_FAILED: 'تعذر التحقق من الصورة',
  FACE_SPOOF_DETECTED: 'تم اكتشاف محاولة تزييف في فحص الوجه',
} as const;

export const ATTENDANCE_FAILURE_LABELS: Record<string, string> = {
  ...FACE_FAILURE_LABELS,
  EMPLOYEE_NOT_FOUND: 'الموظف غير موجود',
  EMPLOYEE_INACTIVE: 'تم إيقاف الموظف',
  EMPLOYMENT_INACTIVE: 'الموظف غير معيّن في تاريخ المحاولة',
  LOCATION_UNRELIABLE: 'دقة الموقع غير كافية للتحقق من الحضور',
  INVALID_CREDENTIALS: 'بيانات الموظف غير صحيحة', DEVICE_INVALID: 'الجهاز غير مسجل أو ملغى',
  DEVICE_REVOKED: 'الجهاز ملغى', TECHNICAL_FAILURE: 'عطل تقني',
  OUT_OF_RANGE: 'خارج نطاق الفرع', WEEKLY_DAY_OFF: 'يوم راحة أسبوعي',
  SESSION_EXISTS: 'يوجد سجل لهذا اليوم', OPEN_SESSION_EXISTS: 'توجد جلسة مفتوحة',
  NO_OPEN_SESSION: 'لا توجد جلسة مفتوحة', INVALID_TIME: 'وقت غير صالح',
  FINANCIALLY_LOCKED: 'الفترة معتمدة ماليًا ولا يمكن تعديلها',
  NOT_FOUND: 'سجل الحضور غير موجود', ALREADY_APPROVED: 'تمت الموافقة على المحاولة من قبل',
  ALREADY_REVIEWED: 'تمت مراجعة المحاولة من قبل', NOT_AUTOMATIC_TIMEOUT: 'الجلسة ليست خروجًا تلقائيًا',
  SESSION_STALE: 'تغيّر سجل الحضور أثناء التحرير', DATE_FIXED: 'لا يمكن نقل الحضور إلى يوم آخر',
  SESSION_OVERLAP: 'أوقات الحضور تتقاطع مع جلسة أخرى',
};
