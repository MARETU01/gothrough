import { isAxiosError } from 'axios';
import { errorMessage } from '@/utils/misc';
import i18n from '@/i18n';
import { message, type Message } from '@/i18n/messages';

export { isCanceledError } from '@/utils/cancellation';

export function getErrorBody<T>(error: unknown): T | null {
  return isAxiosError<T>(error) ? (error.response?.data ?? null) : null;
}

export function apiErrorMessage(error: unknown): string {
  return getErrorBody<{ error?: string }>(error)?.error ?? errorMessage(error);
}

export function apiErrorDescriptor(error: unknown): Message {
  const body = getErrorBody<{ code?: string; error?: string }>(error);
  if (body?.code && i18n.exists(`errors.${body.code}`)) return message(`errors.${body.code}`);
  if (isAxiosError(error)) {
    if (error.code === 'ERR_NETWORK') return message('errors.network');
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return message('errors.timeout');
  }
  const original = apiErrorMessage(error);
  // Preserve deliberate public messages for unrecognized error codes.
  return i18n.exists(original) ? message(original) : original;
}
