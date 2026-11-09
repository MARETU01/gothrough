export function formatDateTime(value: string, language?: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(language) : value;
}
