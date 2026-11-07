import { Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, type Language } from '@/i18n';
import { Select } from './ui/select';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function selectLanguage(language: Language) {
    setLoading(true);
    setFailed(false);
    try { await changeLanguage(language); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }
  return (
    <>
      <label className="language-switcher">
        <Languages aria-hidden="true" size={18} />
        <span className="sr-only">{t('language.label')}</span>
        <Select value={i18n.resolvedLanguage} disabled={loading} aria-busy={loading}
          onChange={event => void selectLanguage(event.target.value as Language)}>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
          <option value="en" lang="en">English</option>
        </Select>
      </label>
      {failed && <span role="alert">{t('language.loadFailed')}</span>}
    </>
  );
}
