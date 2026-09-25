/**
 * Drains a paginated list endpoint so option selectors are not capped at the
 * first page. Only for small admin datasets (employees/branches of one company).
 *
 * `identity` names the field that tells two rows apart, and it defaults to `id`.
 * Deduplication matters because rows can shift between pages while the list is
 * being read, so a record straddling the boundary comes back twice. Repeats
 * would otherwise reach the caller as duplicate options.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; meta: { totalPages: number } }>,
  identity: (item: T) => number | string = (item) => (item as { id: number | string }).id,
): Promise<T[]> {
  const first = await fetchPage(1);
  const seen = new Map<number | string, T>();
  for (const item of first.items) seen.set(identity(item), item);
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    for (const item of (await fetchPage(page)).items) seen.set(identity(item), item);
  }
  return [...seen.values()];
}
