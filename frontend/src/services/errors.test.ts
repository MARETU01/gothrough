import { AxiosError, CanceledError } from 'axios';
import { expect, it } from 'vitest';
import { apiErrorMessage, getErrorBody, isCanceledError } from './errors';
import { apiErrorDescriptor } from './errors';
import i18n from '@/i18n';
import { translateMessage } from '@/i18n/messages';

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

it('translates known error codes and retains messages for unknown or older servers', async () => {
  const descriptor = apiErrorDescriptor({ isAxiosError: true, response: { data: { code: 'CHUNK_TOO_LARGE', error: '原始提示' } } });
  expect(translateMessage(descriptor)).toBe('分块超过大小限制');
  await i18n.changeLanguage('en');
  expect(translateMessage(descriptor)).toBe('Chunk exceeds the size limit');
  expect(apiErrorDescriptor({ isAxiosError: true, response: { data: { code: 'NEW_CODE', error: 'Unknown server detail' } } })).toBe('Unknown server detail');
  expect(apiErrorDescriptor(new Error('offline'))).toBe('offline');
  expect(translateMessage(apiErrorDescriptor(new AxiosError('Network Error', 'ERR_NETWORK')))).toContain('Connection failed');
});
