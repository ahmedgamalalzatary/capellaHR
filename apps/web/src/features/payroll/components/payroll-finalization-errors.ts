import { payrollFinalizationIssueSchema, type PayrollFinalizationIssue } from '@capella/contracts';

import { ApiError } from '@/lib/api/client';

export const payrollIssueLabels: Record<string, { title: string; action: string }> = {
  OPEN_SESSION: {
    title: 'جلسة حضور مفتوحة', action: 'راجع الجلسة وسجّل وقت الانصراف الصحيح من الحضور والغياب، ثم أعد الاعتماد.',
  },
  DENIED_ATTEMPT: {
    title: 'محاولة حضور أو انصراف تحتاج مراجعة',
    action: 'افتح المحاولات المرفوضة في الحضور والغياب. اعتمد الحضور الصحيح وأكمل الانصراف، أو اختر «رفض نهائي» للمحاولة غير الصحيحة. تسجيل الغياب وحده لا يحسم المحاولة.',
  },
  PAYROLL_CHRONOLOGY_CONFLICT: {
    title: 'يجب اعتماد الشهور الأقدم أولًا', action: 'اختر أقدم شهر في القائمة أدناه واعتمده، ثم أكمل الشهور بالترتيب قبل اعتماد هذا الشهر.',
  },
  PAYROLL_MONTH_NOT_ENDED: {
    title: 'شهر الراتب لم ينتهِ بعد', action: 'انتظر بداية الشهر التالي حسب توقيت القاهرة، أو اختر شهرًا انتهى بالفعل.',
  },
  PAYROLL_MONTH_NOT_ELIGIBLE: {
    title: 'الموظف غير مستحق لراتب في هذا الشهر', action: 'راجع فترات عمل الموظف وشهر بدء النظام، ثم اختر شهرًا يقع ضمن فترة استحقاقه.',
  },
  PAYROLL_ALREADY_FINALIZED: {
    title: 'راتب الشهر معتمد بالفعل', action: 'حدّث القائمة لعرض الراتب المعتمد. لا يحتاج هذا الشهر إلى اعتماد جديد.',
  },
  PAYROLL_EMPLOYEE_NOT_FOUND: {
    title: 'الموظف غير موجود', action: 'حدّث قائمة الرواتب وتحقق من سجل الموظف في صفحة الموظفين.',
  },
  ATTENDANCE_EMPLOYEE_NOT_FOUND: {
    title: 'تعذر العثور على الموظف في بيانات الحضور', action: 'حدّث القائمة وتحقق من سجل الموظف. إذا استمر التعذر، أرسل رقم الطلب للدعم.',
  },
  PAYROLL_AMOUNT_OUT_OF_RANGE: {
    title: 'قيمة مالية تتجاوز الحد المسموح', action: 'راجع المبالغ الموضحة والراتب والمكافآت والخصومات والسلف والعمولات. صحّح البيانات غير الصحيحة ثم أعد الاعتماد.',
  },
  PAYROLL_ATTENDANCE_UNAVAILABLE: {
    title: 'تعذر التحقق من بيانات الحضور للراتب', action: 'أعد المحاولة بعد استعادة خدمة الحضور. إذا استمر التعذر، أرسل رقم الطلب للدعم.',
  },
  PAYROLL_BRANCH_NOT_FOUND: {
    title: 'الفرع غير موجود', action: 'حدّث قائمة الفروع واختر الفرع الصحيح.',
  },
  ATTENDANCE_RECONCILIATION_PENDING: {
    title: 'توجد أيام حضور غير مكتملة', action: 'راجع الأيام الناقصة في الحضور والغياب وسجّل الحالة الصحيحة لكل يوم.',
  },
  NETWORK_ERROR: {
    title: 'تعذر الاتصال بالخادم', action: 'تحقق من اتصالك بالإنترنت، ثم حدّث القائمة وتحقق من حالة الراتب قبل إعادة المحاولة؛ قد يكون الطلب وصل للخادم.',
  },
  UNAUTHORIZED: {
    title: 'يلزم تسجيل الدخول من جديد', action: 'سجّل الدخول بحساب المدير، ثم افتح الرواتب وتحقق من حالة الشهر.',
  },
  FORBIDDEN: {
    title: 'لا توجد صلاحية لاعتماد الرواتب', action: 'استخدم حساب المدير المخوّل باعتماد الرواتب.',
  },
  INVALID_ORIGIN: {
    title: 'عنوان الموقع المستخدم غير مسموح', action: 'افتح النظام من عنوانه الرسمي وحدّث الصفحة. إذا استمرت المشكلة، اطلب من الدعم مراجعة عنوان الموقع وإعدادات الاتصال بالخادم.',
  },
  NOT_FOUND: {
    title: 'مسار خدمة اعتماد الرواتب غير متاح', action: 'حدّث الصفحة وافتح النظام من عنوانه الرسمي. إذا استمر التعذر، اطلب من الدعم التحقق من إصدار النظام وإعدادات الخادم.',
  },
  PAYLOAD_TOO_LARGE: {
    title: 'حجم طلب الاعتماد أكبر من المسموح', action: 'حدّث الصفحة وأعد اختيار الشهر والموظف. إذا استمر التعذر، أرسل رقم الطلب للدعم لفحص الطلب وإعدادات الخادم.',
  },
  VALIDATION_ERROR: {
    title: 'بيانات طلب الاعتماد غير صالحة', action: 'راجع الشهر والموظف المحددين، ثم حدّث الصفحة وأعد المحاولة.',
  },
  SERVER_ERROR: {
    title: 'تعذر تأكيد الاعتماد بسبب مشكلة في الخادم', action: 'حدّث القائمة وتحقق من حالة الراتب قبل إعادة المحاولة. إذا استمرت المشكلة، أرسل رقم الطلب للدعم.',
  },
};

export const payrollAmountLabels: Record<string, string> = {
  baseSalary: 'الراتب الأساسي', proratedBase: 'الراتب الأساسي بعد الاستحقاق', overtimeAmount: 'مبلغ الوقت الإضافي',
  bonusAmount: 'المكافآت', commissionAmount: 'العمولات', commissionPaidAmount: 'عمولة مصروفة',
  commissionCarryAmount: 'عمولة مرحلة', attendanceDeductionAmount: 'خصومات الحضور',
  manualDeductionAmount: 'الخصومات اليدوية', commissionDeductionAmount: 'خصومات العمولات',
  advanceAmount: 'أقساط السلف', priorNegativeCarry: 'الترحيل السالب السابق',
  deactivationAdjustmentAmount: 'تسوية إيقاف الموظف', netSalary: 'صافي الراتب',
};

export function describePayrollIssue(issue: PayrollFinalizationIssue) {
  return Object.hasOwn(payrollIssueLabels, issue.code) ? payrollIssueLabels[issue.code]! : {
    title: 'سبب إضافي لتعذر الاعتماد',
    action: 'حدّث القائمة وتحقق من حالة الراتب. إذا استمر التعذر، أرسل رقم الطلب وتفاصيل المشكلة للدعم.',
  };
}

export function payrollFinalizationFailure(error: unknown) {
  const apiError = error instanceof ApiError ? error : null;
  const details = apiError?.details;
  const record = details && typeof details === 'object' ? details as Record<string, unknown> : {};
  let issues: PayrollFinalizationIssue[] = Array.isArray(record.issues)
    ? record.issues.flatMap((value: unknown) => {
      const parsed = payrollFinalizationIssueSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    }) : [];
  // Older APIs still send reason codes, sometimes prefixed with the employee ID for a branch.
  if (Array.isArray(record.blockers)) {
    for (const value of record.blockers as unknown[]) {
      if (typeof value !== 'string') continue;
      const match = /^(\d+):(.+)$/.exec(value);
      const code = match?.[2] ?? value;
      const employeeId = match ? Number(match[1]) : undefined;
      if (!issues.some((issue) => issue.code === code && (employeeId === undefined || issue.employeeId === employeeId))) {
        issues.push({ code, ...(employeeId === undefined ? {} : { employeeId }) });
      }
    }
  }
  if (!issues.length) {
    const code = apiError?.status === 401 ? 'UNAUTHORIZED'
      : apiError?.code === 'INVALID_ORIGIN' ? 'INVALID_ORIGIN'
      : apiError?.status === 403 ? 'FORBIDDEN'
      : apiError && apiError.status >= 500 && apiError.code !== 'PAYROLL_ATTENDANCE_UNAVAILABLE' ? 'SERVER_ERROR'
      : apiError?.code ?? 'UNEXPECTED_ERROR';
    issues = [{ code }];
  }
  const summary = [...new Set(issues.map((issue) => describePayrollIssue(issue).title))].join('، ');
  return { issues, summary, requestId: apiError?.requestId, fieldErrors: apiError?.fieldErrors ?? {} };
}

export type PayrollFinalizationFailure = ReturnType<typeof payrollFinalizationFailure>;
