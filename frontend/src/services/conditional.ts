import { responseApi } from './http';

export type ConditionalResult<T> =
  | { notModified: true; etag?: string }
  | { notModified: false; data: T; etag?: string };

/** Keep HTTP validation separate from committing the accepted page snapshot. */
export async function conditionalGet<T>(url: string, signal?: AbortSignal, etag?: string): Promise<ConditionalResult<T>> {
  const response = await responseApi.get<T>(url, {
    signal,
    headers: etag ? { 'If-None-Match': etag } : undefined,
    validateStatus: status => (status >= 200 && status < 300) || (status === 304 && !!etag),
  });
  const nextEtag = response.headers.etag as string | undefined;
  return response.status === 304
    ? { notModified: true, etag: nextEtag ?? etag }
    : { notModified: false, data: response.data, etag: nextEtag };
}
