export type CatalogErrorCode =
  | 'ERP_CATALOG_ADMIN_REQUIRED'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NAME_EXISTS'
  | 'CATEGORY_IN_USE'
  | 'CATEGORY_TYPE_INVALID'
  | 'CATEGORY_INACTIVE'
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_NAME_EXISTS'
  | 'CATALOG_EMPLOYEE_NOT_FOUND'
  | 'COMMISSION_OVERRIDE_NOT_FOUND';

export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    /**
     * On a duplicate name the admin needs to be pointed at the record that
     * already holds it rather than being told only that the save failed.
     */
    public readonly existingId?: number,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

export const CATALOG_MESSAGES = {
  ERP_CATALOG_ADMIN_REQUIRED: 'إدارة الكتالوج متاحة للمدير فقط',
  CATEGORY_NOT_FOUND: 'التصنيف غير موجود',
  CATEGORY_NAME_EXISTS: 'اسم التصنيف مستخدم بالفعل في هذا النوع',
  CATEGORY_IN_USE: 'لا يمكن حذف تصنيف مستخدم؛ يمكن إيقافه بدلًا من ذلك',
  CATEGORY_TYPE_INVALID: 'يجب اختيار تصنيف من نوع الخدمات',
  CATEGORY_INACTIVE: 'التصنيف موقوف',
  SERVICE_NOT_FOUND: 'الخدمة غير موجودة',
  SERVICE_NAME_EXISTS: 'اسم الخدمة مستخدم بالفعل',
  CATALOG_EMPLOYEE_NOT_FOUND: 'الموظف غير موجود في هذا الفرع',
  COMMISSION_OVERRIDE_NOT_FOUND: 'لا توجد نسبة عمولة خاصة لهذا الموظف',
} as const satisfies Record<CatalogErrorCode, string>;

export const catalogError = (code: CatalogErrorCode, existingId?: number) => (
  new CatalogError(code, CATALOG_MESSAGES[code], existingId)
);

/**
 * The unique indexes are the real guards; a lost race surfaces as ER_DUP_ENTRY
 * and is translated back into the conflict the pre-check would have produced.
 */
export const isDuplicateEntryError = (error: unknown) => (
  typeof error === 'object' && error !== null && (
    Reflect.get(error, 'code') === 'ER_DUP_ENTRY'
    || Reflect.get(Reflect.get(error, 'cause') ?? {}, 'code') === 'ER_DUP_ENTRY'
  )
);
