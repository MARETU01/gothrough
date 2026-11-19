import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function upload(page: Page, name: string, bytes: Buffer) {
  expect((await page.request.post('/api/auth/login', { data: { password: 'e2e-only-password' } })).ok()).toBe(true);
  const init = await page.request.post('/api/upload/init', { data: { filename: name, total_size: bytes.length } });
  expect(init.ok()).toBe(true);
  const { session_id } = await init.json();
  expect((await page.request.post('/api/upload/chunk', { params: { session_id, chunk_index: 0 }, headers: { 'Content-Type': 'application/octet-stream' }, data: bytes })).ok()).toBe(true);
  expect((await page.request.post('/api/upload/complete', { data: { session_id } })).ok()).toBe(true);
  await page.goto('/files');
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
}

test('backs up and compares a real text conflict while keeping local edits', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gothrough.language', 'en'));
  const name = `conflict-${testInfo.project.name}-${Date.now()}.txt`;
  await upload(page, name, Buffer.from('original text\n'));
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  const input = dialog.getByLabel('File content', { exact: true });
  const draft = '<b>local draft</b>\nsecond line';
  await input.fill(draft);
  const url = '/api/files/' + encodeURIComponent(name);
  const base = await (await page.request.get(url + '?preview=info')).json();
  expect((await page.request.put(url, { data: { version: base.version, text: 'remote edit\n' } })).ok()).toBe(true);
  await input.press('Control+s');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Compare latest content', exact: true }).click();
  const backup = dialog.getByRole('region', { name: 'Draft backup and comparison' });
  await expect(backup.locator('pre').last()).toHaveText('remote edit\n');
  await expect(input).toHaveValue(draft);
  expect(await backup.locator('b').count()).toBe(0);
  const downloading = page.waitForEvent('download');
  await backup.getByRole('button', { name: 'Export draft', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(name + '.draft.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe(draft);
  // HTTP LAN origins and denied clipboard permission both need a manual path.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await backup.getByRole('button', { name: 'Copy draft', exact: true }).click();
  const manual = backup.getByRole('textbox');
  await expect(manual).toHaveValue(draft);
  expect(await manual.evaluate(element => (element as HTMLTextAreaElement).selectionEnd)).toBe(draft.length);
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 600 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await backup.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    }
  }
  await backup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('text-conflict-backup.png') });
  expect((await (await page.request.get(url + '?preview=info')).json()).text).toBe('remote edit\n');
});

test('navigates a workbook using the keyboard, exports its typed draft and saves with a shortcut', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gothrough.language', 'en'));
  const name = `keys-${testInfo.project.name}-${Date.now()}.xlsx`;
  await upload(page, name, await readFile(new URL('./fixtures/basic.xlsx', import.meta.url)));
  const dialog = page.getByRole('dialog');
  const initial = dialog.getByRole('button', { name: 'Select cell A1', exact: true });
  await initial.focus(); await initial.press('ArrowRight');
  const target = dialog.getByRole('button', { name: 'Select cell B1', exact: true });
  await expect(target).toBeFocused();
  await target.press('Enter');
  const input = dialog.getByLabel('Cell content', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('keyboard draft');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export draft', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(name + '.draft.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.format).toBe('gothrough-spreadsheet-draft');
  expect(exported.base_version).toBeTruthy();
  expect(exported.changes).toEqual([{ sheet: 'Sheet1', cell: 'B1', type: 'text', value: 'keyboard draft' }]);
  await dialog.getByRole('button', { name: 'Compare latest content', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Draft backup and comparison' }).locator('pre').nth(1)).toHaveText('keyboard draft');
  await input.press('Meta+s');
  await expect(dialog.getByText('File saved', { exact: true })).toBeVisible();
  const saved = await (await page.request.get('/api/files/' + encodeURIComponent(name) + '?preview=info')).json();
  expect(saved.sheets[0].cells.B1.raw).toBe('keyboard draft');
});
