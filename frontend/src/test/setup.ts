import { beforeEach } from 'vitest';
import i18n from '@/i18n';

// jsdom does not implement native dialog methods. Share a minimal lifecycle shim.
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });

// Existing UI assertions use Chinese. Keep tests independent of host locale.
beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });
