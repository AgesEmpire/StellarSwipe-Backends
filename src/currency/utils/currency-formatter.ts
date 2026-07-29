/**
 * Format a numeric amount as a localised currency string.
 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(amount);
}
