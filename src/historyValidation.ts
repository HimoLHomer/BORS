/** Validation for manual portfolio history entries (shared by the editor and the server). */
export function historyEntryError(date: unknown, value: unknown, todayIso: string): string | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Use date format YYYY-MM-DD';
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y!, m! - 1, d!));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m! - 1 || parsed.getUTCDate() !== d) {
    return 'That date does not exist';
  }
  if (date > todayIso) return 'Date cannot be in the future';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a valid number';
  if (value < 0) return 'Value cannot be negative';
  return null;
}
