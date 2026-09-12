// In-memory customer cache shared by the list and detail pages, so opening a
// customer paints the row data instantly while the full record revalidates.
const cache = new Map<string, any>();

export function getCachedCustomer(id: string): any | null {
  return cache.get(id) ?? null;
}

export function setCachedCustomer(id: string, customer: any): void {
  if (id && customer) cache.set(id, customer);
}
