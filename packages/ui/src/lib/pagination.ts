export type PageItem = number | '…';

/**
 * Windowed page list: every page when small, otherwise first/last +
 * current neighbours with ellipsis gaps. Pure helper so it is unit-testable.
 */
export function getVisiblePages(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 1) return totalPages === 1 ? [1] : [];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (page <= 3) return [1, 2, 3, '…', totalPages];
  if (page >= totalPages - 2) {
    return [1, '…', totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, '…', page - 1, page, page + 1, '…', totalPages];
}
