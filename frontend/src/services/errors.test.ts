import { AxiosError, CanceledError } from 'axios';
import { expect, it } from 'vitest';
import { apiErrorMessage, getErrorBody, isCanceledError } from './errors';

it('prefers the server error and preserves structured error details', () => {
  const body = { error: '缺少分块', missing_chunks: [1, 3] };
  const error = { isAxiosError: true, response: { data: body }, message: 'Request failed' };
  expect(apiErrorMessage(error)).toBe('缺少分块');
  expect(getErrorBody<typeof body>(error)?.missing_chunks).toEqual([1, 3]);
});

it('falls back to the original message for network and non-HTTP failures', () => {
  expect(apiErrorMessage(new Error('offline'))).toBe('offline');
  expect(apiErrorMessage('failure')).toBe('failure');
  expect(apiErrorMessage(new AxiosError('network'))).toBe('network');
  expect(getErrorBody(new Error('offline'))).toBeNull();
  expect(isCanceledError(new CanceledError())).toBe(true);
  expect(isCanceledError(new Error('offline'))).toBe(false);
});
