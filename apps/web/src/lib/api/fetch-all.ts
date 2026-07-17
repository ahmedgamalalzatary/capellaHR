/**
 * Drains a paginated list endpoint so option selectors are not capped at the
 * first page. Only for small admin datasets (employees/branches of one company).
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; meta: { totalPages: number } }>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    items.push(...(await fetchPage(page)).items);
  }
  return items;
}
