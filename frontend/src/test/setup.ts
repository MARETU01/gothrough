import { beforeEach } from 'vitest';
import i18n from '@/i18n';

// Existing UI assertions use Chinese. Keep tests independent of host locale.
beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });
