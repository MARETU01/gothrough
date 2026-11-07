import { isAxiosError, isCancel } from 'axios';

/** Transport cancellation detection without UI translation dependencies. */
export function isCanceledError(error: unknown): boolean {
  return isAxiosError(error) && (isCancel(error) || error.code === 'ERR_CANCELED');
}
