import i18n from './index';

// Store keys and values in long-lived state. Translate only when rendering so
// completed notices and in-flight failures follow a language change as well.
export interface MessageDescriptor {
  key: string;
  values?: Record<string, string | number | MessageDescriptor>;
}
export type Message = string | MessageDescriptor;

export function message(key: string, values?: MessageDescriptor['values']): MessageDescriptor {
  return { key, values };
}

export function translateMessage(value: Message): string {
  if (typeof value === 'string') return value;
  const values = Object.fromEntries(Object.entries(value.values ?? {}).map(([key, nested]) =>
    [key, typeof nested === 'object' ? translateMessage(nested) : nested]));
  return i18n.t(value.key, values);
}
