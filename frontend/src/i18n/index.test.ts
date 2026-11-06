import { expect, it } from 'vitest';
import { detectLanguage, LANGUAGE_STORAGE_KEY } from './index';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

it('prefers a saved supported language, then browser languages, then Chinese', () => {
  const saved = { getItem: (key: string) => key === LANGUAGE_STORAGE_KEY ? 'en' : null };
  expect(detectLanguage(saved, ['zh-CN'])).toBe('en');
  expect(detectLanguage({ getItem: () => 'invalid' }, ['fr', 'en-GB'])).toBe('en');
  expect(detectLanguage(undefined, ['zh-TW', 'en'])).toBe('zh-CN');
  expect(detectLanguage(undefined, ['fr'])).toBe('zh-CN');
  expect(detectLanguage({ getItem: () => { throw new Error('storage blocked'); } }, ['en-US'])).toBe('en');
});

it('keeps translation coverage and interpolation parameters aligned', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  const placeholders = (value: string) => [...value.matchAll(/{{\s*(\w+)\s*}}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
    expect(en[key], key).not.toBe('');
    expect(placeholders(en[key]), key).toEqual(placeholders(zhCN[key]));
  }
});
