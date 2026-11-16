import { expect, test, type Page } from '@playwright/test';

const filename = 'A very long screenshot filename for preview layout regression.png';

async function mockPreview(page: Page, kind: 'image' | 'pdf', failure?: number) {
  await page.addInitScript(() => localStorage.setItem('gothrough.language', 'en'));
  // Generate a real PNG in the browser; no external image fixture or service.
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800; canvas.height = 3000;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#008577'; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === '/api/auth/status') body = { enabled: true, authenticated: true };
    else if (url.pathname === '/api/files') body = { files: [{ name: filename, folder: false, label: filename, size: 20, size_display: '20 B', mtime: '2026-11-16T00:00:00Z' }], directory: '', total: 1, folder_count: 0, total_files: 1, page: 1, page_size: 20, total_pages: 1, total_size_display: '20 B' };
    else if (url.pathname === '/api/disk-info') body = { disk_pct: 0, disk_pct_warning: false, disk_free_display: '1 GB', disk_used_display: '0 B', disk_total_display: '1 GB' };
    else if (url.searchParams.get('preview') === 'info') body = { kind, mime_type: kind === 'image' ? 'image/png' : 'application/pdf', text: '' };
    else if (!failure) {
      await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
      return;
    } else {
      await route.fulfill({ status: failure, contentType: 'application/json', body: JSON.stringify({ code: failure === 401 ? 'AUTH_REQUIRED' : 'FILE_INACCESSIBLE' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/files');
  await page.getByRole('button', { name: `Preview ${filename}`, exact: true }).click();
}

test('image zoom, original size, drag, keyboard and responsive layout', async ({ page, browserName, isMobile }) => {
  await mockPreview(page, 'image');
  const dialog = page.getByRole('dialog');
  const original = dialog.getByRole('button', { name: 'Actual size', exact: true });
  await expect(original).toBeEnabled();
  const stage = page.locator('.image-viewer-stage');
  const image = stage.locator('img');
  const fit = dialog.getByRole('button', { name: 'Fit to window' });
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 600 }, { width: 1280, height: 800 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await fit.click();
    await expect.poll(() => image.evaluate(element => element.getBoundingClientRect().width <= element.parentElement!.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await dialog.getByRole('button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    }
  }
  await page.setViewportSize({ width: 800, height: 800 });
  await original.click();
  await expect(dialog.locator('output')).toHaveText('100%');
  await expect.poll(() => image.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(1800);
  await stage.focus(); await page.keyboard.press('+');
  await expect(dialog.locator('output')).toHaveText('125%');
  await page.keyboard.press('ArrowRight');
  expect(await image.evaluate(element => element.style.transform)).toContain('-40px');
  await page.keyboard.press('0');
  await expect(dialog.locator('output')).not.toHaveText('100%');
  await stage.dblclick();
  await expect(dialog.locator('output')).toHaveText('100%');
  const before = await image.getAttribute('style');
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 40); await page.mouse.up();
  expect(await image.getAttribute('style')).not.toBe(before);
  // Playwright cannot send a native wheel event to mobile WebKit.
  if (browserName === 'webkit' && isMobile) await stage.dispatchEvent('wheel', { deltaY: -100, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 });
  else await page.mouse.wheel(0, -100);
  await expect(dialog.locator('output')).not.toHaveText('100%');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Preview ${filename}`, exact: true })).toBeFocused();
});

test('touch pointers pinch to zoom and release cleanly', async ({ page }) => {
  await mockPreview(page, 'image');
  await expect(page.getByRole('button', { name: 'Actual size', exact: true })).toBeEnabled();
  const stage = page.locator('.image-viewer-stage');
  const before = await page.locator('.image-viewer-toolbar output').textContent();
  // Synthetic pointer events exercise two simultaneous contacts on every engine.
  await stage.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    const send = (type: string, id: number, px: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: px, clientY: y }));
    // Synthetic contacts cannot acquire native capture; retain real event handlers.
    element.setPointerCapture = () => {};
    send('pointerdown', 1, x - 40); send('pointerdown', 2, x + 40);
    send('pointermove', 2, x + 120);
    send('pointerup', 1, x - 40); send('pointercancel', 2, x + 120);
  });
  await expect(page.locator('.image-viewer-toolbar output')).not.toHaveText(before!);
  const zoomed = await page.locator('.image-viewer-stage img').getAttribute('style');
  await stage.dispatchEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 1, clientY: 1 });
  expect(await page.locator('.image-viewer-stage img').getAttribute('style')).toBe(zoomed);
});

test('missing PDF shows a readable error without an iframe', async ({ page }) => {
  await mockPreview(page, 'pdf', 404);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Unable to preview');
  await expect(page.locator('iframe')).toHaveCount(0);
});

for (const kind of ['image', 'pdf'] as const) {
  test(`${kind} resource authentication failure returns to unlock`, async ({ page }) => {
    await mockPreview(page, kind, 401);
    await expect(page.locator('#access-password')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}
