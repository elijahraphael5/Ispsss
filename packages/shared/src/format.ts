export function formatNaira(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined || Number.isNaN(kobo)) return '₦0.00';
  return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Parse a Naira amount (string or number, commas/₦ allowed, decimals = kobo) into integer kobo. */
export function nairaToKobo(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[₦,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Convert integer kobo into a plain Naira number for form inputs (e.g. 2500050 → 25000.5). */
export function koboToNaira(kobo: number | null | undefined): number {
  if (kobo === null || kobo === undefined || Number.isNaN(kobo)) return 0;
  return kobo / 100;
}

/** Convert integer kobo into a Naira input string ('' when zero, so placeholders show). */
export function koboToNairaInput(kobo: number | null | undefined): string {
  if (!kobo) return '';
  return String(kobo / 100);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
