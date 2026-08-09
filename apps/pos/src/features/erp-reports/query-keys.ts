export const erpReportQueryKeys = {
  all: ['erp-reports'] as const,
  view: (reportType: string, filters: object) => ['erp-reports', 'view', reportType, filters] as const,
  exports: (reportType?: string) => ['erp-reports', 'exports', reportType] as const,
};
