/** Same rules as the dashboard: EUR uses custom grouping; other CCYs use Intl. */
export function formatCurrency(value: number, currency: string = 'EUR'): string {
  if (!Number.isFinite(value)) return '€0.00';
  if (currency !== 'EUR') {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const [intRaw, dec] = abs.toFixed(2).split('.');
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}€${intPart}.${dec}`;
}
