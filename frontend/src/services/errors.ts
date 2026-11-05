import axios, { isAxiosError } from 'axios';
import { errorMessage } from '@/utils/misc';

export function isCanceledError(error: unknown): boolean {
  return isAxiosError(error) && (axios.isCancel(error) || error.code === 'ERR_CANCELED');
}

export function getErrorBody<T>(error: unknown): T | null {
  return isAxiosError<T>(error) ? (error.response?.data ?? null) : null;
}

export function apiErrorMessage(error: unknown): string {
  return getErrorBody<{ error?: string }>(error)?.error ?? errorMessage(error);
}
