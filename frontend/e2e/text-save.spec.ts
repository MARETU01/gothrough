import { expect, test } from '@playwright/test';

test('confirms a real text save after a lost response without overwriting later changes', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gothrough.language', 'en'));
  const name = `text-receipt-${testInfo.project.name}-${Date.now()}.txt`;
  const original = Buffer.from('\ufeffold\r\n');
  expect((await page.request.post('/api/auth/login', { data: { password: 'e2e-only-password' } })).ok()).toBe(true);
  const init = await page.request.post('/api/upload/init', { data: { filename: name, total_size: original.length } });
  expect(init.ok()).toBe(true);
  const { session_id } = await init.json();
  expect((await page.request.post('/api/upload/chunk', { params: { session_id, chunk_index: 0 }, headers: { 'Content-Type': 'application/octet-stream' }, data: original })).ok()).toBe(true);
  expect((await page.request.post('/api/upload/complete', { data: { session_id } })).ok()).toBe(true);
  await page.goto('/files');
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('File content', { exact: true }).fill('first save\n');
  const writes: string[] = [];
  await page.route('**/api/files/**', async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return; }
    writes.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (writes.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.route('**/api/text-saves/**', route => route.fulfill({ json: { status: 'unknown' } }));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const confirm = dialog.getByRole('button', { name: 'Confirm save result', exact: true });
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByLabel('File content', { exact: true })).toBeDisabled();
  // Another device changes the file after the first operation committed.
  const url = '/api/files/' + encodeURIComponent(name);
  const saved = await (await page.request.get(url + '?preview=info')).json();
  expect(saved.text).toBe('first save\n');
  expect((await page.request.put(url, { data: { version: saved.version, text: 'later save\n' } })).ok()).toBe(true);
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 600 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = (await confirm.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
  }
  await confirm.click();
  await expect(dialog.getByText('File saved', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Your changes were saved. The file has since changed; the latest content is shown.')).toBeVisible();
  await expect(dialog.locator('pre')).toHaveText('later save\n');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toBe(writes[0]);
  const bytes = await (await page.request.get(url)).body();
  expect(bytes.equals(Buffer.from('\ufefflater save\r\n'))).toBe(true);
});
