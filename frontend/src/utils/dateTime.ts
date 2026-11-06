// Legacy servers sent a local date without an offset. Keep its display intact;
// new responses use RFC3339, allowing conversion to the viewer's local timezone.
export function timestampValue(value: string): number {
  const time = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(time) ? time : 0;
}

export function formatDateTime(value: string, language?: string): string {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return value;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString(language) : value;
}
