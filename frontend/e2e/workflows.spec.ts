import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, path: string) {
  const toggle = page.getByRole('button', { name: '展开导航菜单' });
  if (await toggle.isVisible()) await toggle.click();
  await page.locator(`.navigation a[href="${path}"]`).click();
}

async function showTools(page: Page) {
  const toggle = page.getByRole('button', { name: '展开导航菜单' });
  if (await toggle.isVisible()) await toggle.click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('访问口令', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '解锁空间' }).click();
  await expect(page.getByRole('heading', { name: 'GoThrough', exact: true })).toBeVisible();
});

test('navigation works with touch widths, keyboard dismissal, and English text', async ({ page }) => {
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    const toggle = page.getByRole('button', { name: '展开导航菜单' });
    if (width <= 768) {
      await toggle.click();
      await expect(page.locator('.navigation a[href="/files"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(page.locator('.navigation a[href="/files"]')).toBeHidden();
    } else await expect(page.locator('.navigation a[href="/files"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 480 });
  await showTools(page);
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.locator('.navigation a[href="/clipboard"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('uploads, previews, edits, and downloads a file, then publishes clipboard text', async ({ page }, testInfo) => {
  const name = `文件 with spaces-${testInfo.project.name}-${Date.now()}.txt`;
  await navigate(page, '/upload');
  await page.getByLabel('上传文件', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('original text') });
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByText('上传成功', { exact: true })).toBeVisible();
  await navigate(page, '/files');
  await page.getByRole('searchbox').fill(name);
  const row = page.locator('tbody tr').filter({ hasText: name });
  await expect(row).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloadButton = row.getByRole('link', { name: `下载 ${name}`, exact: true });
  for (const width of [320, 600, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await downloadButton.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await row.evaluate(element => getComputedStyle(element).display)).toBe(width <= 600 ? 'grid' : 'table-row');
  }
  await downloadButton.scrollIntoViewIfNeeded();
  await expect(downloadButton).toBeInViewport();
  await row.getByRole('button', { name: `预览 ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('original text', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  await dialog.getByLabel('文件内容').fill('edited text');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText('文件已保存', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloading;
  expect(await readFile((await download.path())!, 'utf8')).toBe('edited text');
  const deletion = page.waitForResponse(response => response.url().endsWith('/api/batch-delete') && response.request().method() === 'POST');
  await row.getByRole('button', { name: '删除 ' + name, exact: true }).click();
  await row.getByRole('button', { name: '确认删除 ' + name, exact: true }).click();
  expect((await (await deletion).json()).results).toEqual([{ path: name, deleted: true }]);
  await expect(row).toHaveCount(0);
  await navigate(page, '/clipboard');
  const text = `Shared from ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel('输入或粘贴文本', { exact: true }).fill(text);
  await page.getByRole('button', { name: '发布', exact: true }).click();
  await expect(page.locator('.clipboard-entry pre').filter({ hasText: text })).toBeVisible();
  // Exercise the supported manual-copy fallback deterministically.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await page.getByRole('button', { name: '复制记录 1', exact: true }).click();
  await expect(page.locator('#clipboard-manual-text')).toHaveValue(text);
});

test('keeps active transfers when logout is cancelled and locks after confirmation', async ({ page }) => {
  let release!: () => void;
  let started = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/upload/chunk?*', async route => { started = true; await gate; await route.abort().catch(() => {}); });
  try {
    await navigate(page, '/upload');
    await page.getByLabel('上传文件', { exact: true }).setInputFiles({ name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('pending') });
    await page.getByRole('button', { name: '开始上传', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await navigate(page, '/');
    await showTools(page);
    await page.getByRole('button', { name: '锁定退出', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认锁定退出？' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'GoThrough', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '锁定退出', exact: true }).click();
    await dialog.getByRole('button', { name: '中断上传并退出', exact: true }).click();
    await expect(page.getByLabel('访问口令', { exact: true })).toBeVisible();
  } finally { release(); }
});

test('browses server-side directory pages and searches full paths', async ({ page }, testInfo) => {
  const directory = `paged-${testInfo.project.name}-${Date.now()}`;
  for (let index = 0; index < 25; index++) {
    const filename = `file-${String(index).padStart(2, '0')}.txt`;
    const init = await page.request.post('/api/upload/init', { data: { filename, relative_path: `${directory}/${filename}`, total_size: 0 } });
    expect(init.ok()).toBe(true);
    const { session_id } = await init.json();
    expect((await page.request.post('/api/upload/complete', { data: { session_id } })).ok()).toBe(true);
  }
  await navigate(page, '/files');
  await page.getByRole('button', { name: `打开文件夹 ${directory}`, exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await page.getByRole('combobox', { name: '文件排序' }).selectOption('name_asc');
  await expect(page.locator('tbody tr').first()).toContainText('file-00.txt');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.locator('tbody tr').first()).toContainText('file-20.txt');
  const response = page.waitForResponse(response => response.url().includes('view=browser') && response.url().includes('q=file-24') && response.status() === 200);
  await page.getByRole('searchbox').fill('file-24');
  const result = await (await response).json();
  expect(result.files.length).toBeLessThanOrEqual(20);
  await expect(page.locator('tbody tr').filter({ hasText: `${directory}/file-24.txt` })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('tbody tr')).toHaveCount(20);
});

test('selects files and folders, downloads a ZIP, and confirms bulk deletion', async ({ page }, testInfo) => {
  const directory = `bulk-${testInfo.project.name}-${Date.now()}`;
  const loose = directory + '-loose.txt';
  for (const relative_path of [`${directory}/inside.txt`, loose]) {
    const init = await page.request.post('/api/upload/init', { data: { filename: relative_path.split('/').at(-1), relative_path, total_size: 0 } });
    expect(init.ok()).toBe(true);
    const { session_id } = await init.json();
    expect((await page.request.post('/api/upload/complete', { data: { session_id } })).ok()).toBe(true);
  }
  await navigate(page, '/files');
  const folderLink = page.getByRole('link', { name: `下载文件夹 ${directory}`, exact: true });
  await expect(folderLink).toHaveAttribute('href', '/api/batch-download?path=' + directory);
  const folderDownloading = page.waitForEvent('download');
  await folderLink.click();
  const folderDownload = await folderDownloading;
  expect(folderDownload.suggestedFilename()).toBe('files.zip');
  const folderZip = await readFile((await folderDownload.path())!);
  expect(folderZip.includes(Buffer.from(directory + '/inside.txt'))).toBe(true);
  expect(folderZip.includes(Buffer.from(loose))).toBe(false);
  await page.getByRole('checkbox', { name: `选择 ${directory}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `选择 ${loose}`, exact: true }).check();
  await expect(page.getByText('已选 2 项', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 ZIP', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('files.zip');
  const zip = await readFile((await download.path())!);
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  expect(zip.includes(Buffer.from(directory + '/inside.txt'))).toBe(true);
  expect(zip.includes(Buffer.from(loose))).toBe(true);
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect(page.getByRole('group', { name: '确认删除所选的 2 项？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '删除所选', exact: true })).toBeFocused();
  await showTools(page);
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  const toggle = page.getByRole('button', { name: 'Close navigation menu' });
  if (await toggle.isVisible()) await page.keyboard.press('Escape');
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  for (const [width, height] of [[320, 480], [768, 640], [1280, 800], [844, 390]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`bulk-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 320, height: 480 });
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
  const confirmation = page.getByRole('group', { name: 'Delete the 2 selected items?' });
  await expect(confirmation).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const deleted = page.waitForResponse(response => response.url().endsWith('/api/batch-delete') && response.request().method() === 'POST');
  await confirmation.getByRole('button').first().click();
  expect((await (await deleted).json()).results.every((result: { deleted: boolean }) => result.deleted)).toBe(true);
  await expect(page.getByText('Deleted 2 items', { exact: true })).toBeVisible();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: `Select ${directory}`, exact: true })).toHaveCount(0);
});
