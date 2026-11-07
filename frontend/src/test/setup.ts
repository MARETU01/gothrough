import { beforeEach } from 'vitest';
import { changeLanguage } from '@/i18n';

// jsdom does not implement native dialog methods. Share a minimal lifecycle shim.
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });

// Existing UI assertions use Chinese. Keep tests independent of host locale.
beforeEach(async () => { await changeLanguage('zh-CN'); });
