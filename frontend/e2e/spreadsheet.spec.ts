import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('English workbook controls fit narrow and landscape screens', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('gothrough.language', 'en'));
  const original = await readFile(new URL('./fixtures/basic.xlsx', import.meta.url));
  const name = `English workbook with a long filename-${testInfo.project.name}-${Date.now()}.xlsx`;
  expect((await page.request.post('/api/auth/login', { data: { password: 'e2e-only-password' } })).ok()).toBe(true);
  const initialized = await page.request.post('/api/upload/init', { data: { filename: name, total_size: original.length } });
  expect(initialized.ok()).toBe(true);
  const { session_id } = await initialized.json();
  expect((await page.request.post('/api/upload/chunk', { params: { session_id, chunk_index: 0 }, headers: { 'Content-Type': 'application/octet-stream' }, data: original })).ok()).toBe(true);
  expect((await page.request.post('/api/upload/complete', { data: { session_id } })).ok()).toBe(true);
  await page.goto('/files');
  await page.getByRole('searchbox').fill(name);
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Select cell A2', exact: true })).toHaveText('Apples');
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('Cell content', { exact: true }).fill('A long edited value with <b>literal markup</b> and details to wrap on phones');
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 600 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.locator('.spreadsheet-grid tbody tr').first().evaluate(element => getComputedStyle(element).display)).toBe('table-row');
    await expect(dialog.locator('.spreadsheet-grid thead')).toBeVisible();
    for (const button of await dialog.locator('.spreadsheet-toolbar button, .preview-dialog-header button, .spreadsheet-change-actions button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    }
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await dialog.getByRole('region', { name: 'Changes', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('xlsx-mobile-en.png') });
});

test('uploads, previews, edits and downloads a real multi-sheet XLSX', async ({ page }, testInfo) => {
  const original = await readFile(new URL('./fixtures/basic.xlsx', import.meta.url));
  const name = `workbook-${testInfo.project.name}-${Date.now()}.xlsx`;
  await page.goto('/');
  await page.getByLabel('访问口令', { exact: true }).fill('e2e-only-password');
  await page.getByRole('button', { name: '解锁空间' }).click();
  await page.goto('/upload');
  await page.getByLabel('上传文件', { exact: true }).setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: original });
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await expect(page.getByText('上传成功', { exact: true })).toBeVisible();
  await page.goto('/files');
  await page.getByRole('searchbox').fill(name);
  const trigger = page.getByRole('button', { name: `预览 ${name}`, exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '选择单元格 A2', exact: true })).toHaveText('Apples');
  const grid = dialog.getByRole('region', { name: '工作表内容，可在区域内横向滚动' });
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 600 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.locator('.spreadsheet-grid tbody tr').first().evaluate(element => getComputedStyle(element).display)).toBe('table-row');
    const bounds = (await grid.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '选择单元格 A30', exact: true })).toHaveText('Last row');
  await dialog.getByRole('button', { name: '上一页', exact: true }).click();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  await dialog.getByLabel('单元格地址', { exact: true }).fill('CV100');
  await expect(dialog.getByRole('button', { name: '选择单元格 CV100', exact: true })).toBeInViewport();
  await dialog.getByLabel('单元格内容', { exact: true }).fill('temporary distant edit');
  const review = dialog.getByRole('region', { name: '修改清单', exact: true });
  await review.getByRole('button', { name: 'Sheet1!CV100', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '选择单元格 CV100', exact: true })).toBeFocused();
  await review.getByRole('button', { name: '撤销 Sheet1!CV100 的修改', exact: true }).click();
  await expect(review).toHaveCount(0);
  await dialog.getByLabel('单元格地址', { exact: true }).fill('D2');
  await dialog.getByRole('button', { name: '选择单元格 D2', exact: true }).click();
  await expect(dialog.getByLabel('单元格内容', { exact: true })).toBeDisabled();
  await expect(dialog.getByText('只读公式：=B2*2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '选择单元格 B2', exact: true }).click();
  await dialog.getByLabel('单元格内容', { exact: true }).fill('23.5');
  await dialog.getByLabel('工作表', { exact: true }).selectOption('1');
  await dialog.getByLabel('单元格内容', { exact: true }).fill('0012345');
  await review.getByRole('button', { name: 'Sheet1!B2', exact: true }).click();
  await expect(dialog.getByLabel('单元格地址', { exact: true })).toHaveValue('B2');
  await review.getByRole('button', { name: 'Budget!A1', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(dialog.getByLabel('单元格内容', { exact: true })).toHaveValue('0012345');
  const writes: string[] = [];
  await page.route('**/api/spreadsheets/**', async route => {
    writes.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (writes.length === 1) await route.abort('failed'); // server committed, browser lost response
    else {
      expect((await response.json()).preview).toBeUndefined(); // replay returns the original receipt
      await route.fulfill({ response });
    }
  });
  // Even if status is unavailable, retry must retain the original operation.
  await page.route('**/api/spreadsheet-saves/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'unknown' }) }));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确认保存结果', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('单元格内容', { exact: true })).toBeDisabled();
  await expect(review.getByRole('button', { name: '撤销 Budget!A1 的修改', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '确认保存结果', exact: true }).click();
  await expect(dialog.getByText('文件已保存', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toBe(writes[0]);
  const response = await page.request.get('/api/files/' + encodeURIComponent(name) + '?preview=info');
  expect(response.ok()).toBe(true);
  const preview = await response.json();
  expect(preview.sheets[0].cells.B2.raw).toBe('23.5');
  expect(preview.sheets[0].cells.D2.formula).toBe('B2*2');
  expect(preview.sheets[1].cells.A1.raw).toBe('0012345');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('link', { name: '下载', exact: true }).click();
  const download = await downloading;
  const saved = await readFile((await download.path())!);
  expect(saved.subarray(0, 2).toString()).toBe('PK');
  expect(saved.equals(original)).toBe(false);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(trigger).toBeFocused();
});
